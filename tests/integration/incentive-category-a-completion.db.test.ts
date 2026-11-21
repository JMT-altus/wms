import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Category A COMPLETION (engine category-a/2, migration 0142 prepared only) on an in-memory PGlite database running
// 0131–0133's and 0142's own SQL: held items holding the month at submit / approve / pay and their acknowledgment; the
// separation of duties (calculator, locker, payee, acknowledger, input recorder never approve; an approver never pays)
// in the service AND the database; the two-person negative-balance write-off at lock (by hand and automatically); the
// automatic-lock job; receipt events read as they stood on the calculation date; the all-categories limit across
// programmes and the old engine; the representative-history import; the Rules withdrawal rule; the old engine's
// per-person hand-over; Field Permissions without a super-admin shortcut; and 0142's pinned runner (apply, verify,
// rollback). Invented data only; only the session is mocked. Real PostgreSQL is NOT used.
let simulatedCalls = 0;
async function onDay<T>(day: string, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(Date.parse(`${day}T12:00:00+05:30`) + ++simulatedCalls * 60_000));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null; role: string } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ SUPER_ADMIN_EMAILS: ["root@example.test"], isSuperAdmin: (e: string | null | undefined) => (e ?? "").trim().toLowerCase() === "root@example.test" }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { aprilConfig, L, type Pay } from "../fixtures/category-a";
import * as runner from "../../scripts/incentive-0142/core";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let calcAct: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let inputAct: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions");
let calc: typeof import("@/lib/queries/incentive-calc");
let inputs: typeof import("@/lib/queries/incentive-inputs");
let rules: typeof import("@/lib/queries/incentive-rules");
let load: typeof import("@/lib/incentives/load");
const PEOPLE = ["root", "runner", "locker", "a1", "a2", "payer", "reviewer", "inputter", "rep", "rep2", "author", "checker"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], locker: ["lock", "submit"], a1: ["approve"], a2: ["approve"], payer: ["pay"], reviewer: ["review"], inputter: ["inputs"] };
const actor = (k: Who) => ({ id: who[k], name: k });
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k !== "rep" && k !== "rep2", departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q1<T>(sql, params))[0]!;
const rv = async (program: string, month: string) => Number((await one<{ row_version: number }>(`select row_version from incentive_calc_periods where program_id = $1 and month = $2 and category_code = 'A'`, [program, month])).row_version);
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8");
let customer = "";
let batch = "";

async function doc(type: string, no: string, date: string, total: number, extra: Record<string, unknown> = {}) {
  return (
    await one<{ id: string }>(
      `insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row)
       values ($1, $2, $3, $4, $5, '2026-27', 'Customer One', 'customer one', $6, $7, $7, $8, $9, $10, $11, 1) returning id`,
      [`${type}|${no}`, type, no, no.toLowerCase(), date, extra.customer === undefined ? customer : extra.customer, total, extra.ref ?? null, extra.due ?? null, JSON.stringify(extra.lines ?? []), batch],
    )
  ).id;
}
const plus = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
async function monthForms(month: string, prefix: string, payments: Pay[][]) {
  const d = `${month.slice(0, 7)}-05`;
  for (const [i, pays] of payments.entries()) {
    const n = i + 1;
    const order = await doc("sales-orders", `${prefix}SO ${n}`, d, L(10), { lines: [{ item: "Drive", quantity: 1, ratePaise: L(10), amountPaise: L(10) }] });
    const inv = await doc("sales-invoices", `${prefix}INV ${n}`, d, L(10), { ref: order, due: d });
    for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `${prefix}RC ${n}.${k + 1}`, plus(d, days), Math.round(L(10) * fraction), { ref: inv });
  }
}
async function program(code: string, settings: Record<string, unknown>) {
  const p = await rules.createProgram(actor("author"), { code, name: code, description: null });
  if (!p.ok) throw new Error(p.error);
  const config = aprilConfig(settings as never);
  config.eligibility = [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }];
  const d = await rules.createDraft(actor("author"), { programId: p.programId, category: "A", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, "2026-04-01", { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
  return p.programId;
}
let P1 = "", P2 = "", P3 = "";
const ON_TIME: Pay[][] = Array(12).fill([[1, 5]]);

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters,
    vendorMasters: schema.vendorMasters,
    tallyImportBatches: schema.tallyImportBatches,
    tallyDocuments: schema.tallyDocuments,
    salesOrderPreclosures: schema.salesOrderPreclosures,
    incentivePeriods: schema.incentivePeriods,
    incentiveLedger: schema.incentiveLedger,
    incentiveAudit: schema.incentiveAudit,
    ruleVersions: schema.ruleVersions,
    incentiveSchemes: schema.incentiveSchemes,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of PEOPLE) who[k] = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k}@example.test`, k !== "rep" && k !== "rep2"])).id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.calc.${r}`, who[k as Who]]);
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0142_incentive_category_a_safeguards.sql"]) await pg.exec(MIG(f));
  await pg.exec(MIG("0142_incentive_category_a_safeguards.sql")); // safe to re-run
  customer = (await one<{ id: string }>(`insert into customer_masters (name, code, sales_rep_id, credit_period_days) values ('Customer One', 'C-001', $1, 30) returning id`, [who.rep])).id;
  batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`)).id;
  await monthForms("2026-04-01", "", ON_TIME);
  // An April credit note linked to no invoice: Category A holds it.
  await doc("credit-notes", "CN X", "2026-04-20", L(1));
  calcAct = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  inputAct = await import("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions");
  calc = await import("@/lib/queries/incentive-calc");
  inputs = await import("@/lib/queries/incentive-inputs");
  rules = await import("@/lib/queries/incentive-rules");
  load = await import("@/lib/incentives/load");
  P1 = await program("P1", { "payout.approvalSteps": 1, "payout.release": "afterApproval", "adjust.negativeBalance": "recoverFromNextPayout", "adjust.windowDays": 365, "period.lockMode": "manual", "adjust.creditNote": "reduceOriginalMonthSales" });
  P2 = await program("P2", { "payout.approvalSteps": 1, "payout.release": "afterApproval", "adjust.negativeBalance": "writeOff", "adjust.windowDays": 365, "period.lockMode": "manual" });
  P3 = await program("P3", { "payout.approvalSteps": 1, "payout.release": "afterApproval", "adjust.negativeBalance": "recoverFromNextPayout", "adjust.windowDays": 365, "period.lockMode": "autoAfterDays", "period.autoLockDays": 5 });
}, 240_000);
afterAll(async () => {
  await pg.close();
});

describe("Field Permissions only: no super-admin shortcut", () => {
  it("a super-admin with no grant can't calculate, lock or approve (the right must be granted)", async () => {
    signIn("root");
    await expect(calcAct.calculateCategoryAMonth({ programId: P1, month: "2026-04-01", asOf: "2026-06-30" })).rejects.toThrow("Forbidden");
    await expect(calcAct.decideCategoryAMonth({ programId: P1, month: "2026-04-01", rowVersion: 1, decision: "approve", reason: null })).rejects.toThrow("Forbidden");
  });
});

describe("held items hold the month; acknowledged, it goes on", () => {
  it("the unlinked credit note is held; the month locks but isn't submitted", async () => {
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: P1, month: "2026-04-01", asOf: "2026-06-30" })).toMatchObject({ ok: true, adopted: true, status: "computed" });
    const run = await one<{ result: { held: { code: string; documentNo: string }[]; engineVersion: string } }>(`select r.result from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.program_id = $1`, [P1]);
    expect(run.result.engineVersion).toBe("category-a/2");
    expect(run.result.held).toEqual([expect.objectContaining({ code: "credit-note-unlinked", documentNo: "CN X" })]);
    signIn("locker");
    expect(await calcAct.setCategoryAMonthLocked({ programId: P1, month: "2026-04-01", lock: true, rowVersion: await rv(P1, "2026-04-01") })).toMatchObject({ ok: true });
    expect(await calcAct.submitCategoryAMonth({ programId: P1, month: "2026-04-01", rowVersion: await rv(P1, "2026-04-01") })).toMatchObject({ ok: false, error: expect.stringMatching(/1 item of this month is held: CN X \(credit note not linked to an invoice\).*Nothing was submitted/) });
  });
  it("only the review right acknowledges, always with a reason; the month is then submitted", async () => {
    const cn = (await one<{ id: string }>(`select id from tally_documents where document_no = 'CN X'`)).id;
    signIn("locker");
    await expect(calcAct.acknowledgeCategoryAHold({ documentId: cn, code: "credit-note-unlinked", reason: "x" })).rejects.toThrow("Forbidden");
    signIn("reviewer");
    expect(await calcAct.acknowledgeCategoryAHold({ documentId: cn, code: "credit-note-unlinked", reason: "" })).toMatchObject({ ok: false });
    expect(await calcAct.acknowledgeCategoryAHold({ documentId: cn, code: "receipt", reason: "wrong kind" })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't held that way/) });
    expect(await calcAct.acknowledgeCategoryAHold({ documentId: cn, code: "credit-note-unlinked", reason: "A goodwill credit to the customer's account, not on any order" })).toMatchObject({ ok: true });
    expect(await calcAct.acknowledgeCategoryAHold({ documentId: cn, code: "credit-note-unlinked", reason: "again" })).toMatchObject({ ok: false, error: expect.stringMatching(/already acknowledged/) });
    await expect(pg.query(`update incentive_calc_a_reviews set reason = 'changed'`)).rejects.toThrow(/never changes; retire it/);
    await expect(pg.query(`delete from incentive_calc_a_reviews`)).rejects.toThrow(/never deleted/);
    signIn("locker");
    expect(await calcAct.submitCategoryAMonth({ programId: P1, month: "2026-04-01", rowVersion: await rv(P1, "2026-04-01") })).toMatchObject({ ok: true });
  });
  it("nobody approves a month they calculated, locked, acknowledged a held item of, or that pays them — service and database", async () => {
    const p = await one<{ id: string; current_run_id: string; submission_no: number }>(`select id, current_run_id, submission_no from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [P1]);
    const v = await rv(P1, "2026-04-01");
    for (const [k, why] of [["runner", /You calculated this month/], ["locker", /You submitted this month|You locked this month/], ["reviewer", /You acknowledged a held item of this month/], ["rep", /This month pays you/]] as const) {
      expect(await calc.decideMonth(actor(k), P1, "2026-04-01", v, "approve", null), k).toMatchObject({ ok: false, error: expect.stringMatching(why) });
    }
    for (const [k, why] of [["runner", /calculated a Category A month/], ["reviewer", /acknowledged a held item/], ["rep", /pays them/]] as const)
      await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, $5)`, [p.id, p.current_run_id, p.submission_no, who[k], k]), k).rejects.toThrow(why);
  });
  it("an independent approver approves; the approver never records the payout; the payer does, for exactly the approved amount", async () => {
    signIn("a1");
    expect(await calcAct.decideCategoryAMonth({ programId: P1, month: "2026-04-01", rowVersion: await rv(P1, "2026-04-01"), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "approved" });
    const total = Number((await one<{ t: string }>(`select coalesce(sum(r.payable_paise), 0)::text t from incentive_calc_results r join incentive_calc_periods p on p.current_run_id = r.run_id where p.program_id = $1 and p.month = '2026-04-01'`, [P1])).t);
    const releaseOn = String((await one<{ release_on: string }>(`select release_on::text from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [P1])).release_on);
    const pay = { reference: "NEFT-1", paidOn: releaseOn, amountPaise: total, note: null };
    expect(await calc.recordPayout(actor("a1"), P1, "2026-04-01", await rv(P1, "2026-04-01"), pay)).toMatchObject({ ok: false, error: expect.stringMatching(/You approved a step of this month, so you can't record its payout/) });
    const p = await one<{ id: string; current_run_id: string }>(`select id, current_run_id from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [P1]);
    // The database refuses a future-dated payout, one by an approver, and one whose total isn't its lines' sum.
    await expect(pg.query(`insert into incentive_calc_payouts (period_id, run_id, reference, release_on, paid_on, total_paise, recorded_by_id, recorded_by_name) values ($1, $2, 'X', $3, '2099-01-01', $4, $5, 'payer')`, [p.id, p.current_run_id, releaseOn, total, who.payer])).rejects.toThrow(/never dated in the future/);
    await expect(pg.query(`insert into incentive_calc_payouts (period_id, run_id, reference, release_on, paid_on, total_paise, recorded_by_id, recorded_by_name) values ($1, $2, 'X', $3, $3, $4, $5, 'a1')`, [p.id, p.current_run_id, releaseOn, total, who.a1])).rejects.toThrow(/approved a step of a Category A month never records its payout/);
    await expect(pg.query(`insert into incentive_calc_payouts (period_id, run_id, reference, release_on, paid_on, total_paise, recorded_by_id, recorded_by_name) values ($1, $2, 'X', $3, $3, $4, $5, 'payer')`, [p.id, p.current_run_id, releaseOn, total + 1, who.payer])).rejects.toThrow(/total is exactly the sum of its lines/);
    signIn("payer");
    expect(await calcAct.recordCategoryAPayout({ programId: P1, month: "2026-04-01", rowVersion: await rv(P1, "2026-04-01"), reference: "NEFT-1", paidOn: releaseOn, amountPaise: total, note: null })).toMatchObject({ ok: true, totalPaise: total });
  });
});

describe("a negative balance written off or recovered from salary needs a second person (D30)", () => {
  let run0 = "";
  it("the lock is refused until a second person approves exactly that amount", async () => {
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: P2, month: "2026-05-01", asOf: "2026-06-30" })).toMatchObject({ ok: true, adopted: true });
    // A difference of −₹500 carried into May (as a recalculated, paid April would carry it).
    const src = (await one<{ id: string }>(`select current_run_id id from incentive_calc_periods where program_id = $1 and month = '2026-05-01'`, [P2])).id;
    run0 = src;
    await pg.query(`insert into incentive_calc_adjustments (program_id, category_code, from_month, to_month, employee_id, employee_name, kind, amount_paise, source_run_id, note) values ($1, 'A', '2026-04-01', '2026-05-01', $2, 'rep', 'recalc-difference', -50000, $3, 'test')`, [P2, who.rep, src]);
    signIn("locker");
    expect(await calcAct.setCategoryAMonthLocked({ programId: P2, month: "2026-05-01", lock: true, rowVersion: await rv(P2, "2026-05-01") })).toMatchObject({ ok: false, error: expect.stringMatching(/rep's negative balance of ₹500.00 is to be written off: a second person must approve it first.*Nothing was locked/) });
    expect(await calc.negativeBalancesAtLock(P2, "2026-05-01")).toMatchObject({ ready: true, items: [expect.objectContaining({ outcome: "write-off", amountPaise: 50000, needsSecondPerson: true, approved: false })] });
  });
  it("one person requests, never approves it; a second approves; the lock records the write-off", async () => {
    signIn("locker");
    const req = await calcAct.requestCategoryANegativeDecision({ programId: P2, month: "2026-05-01", employeeId: who.rep, reason: "Customer dispute settled in the company's favour" });
    expect(req).toMatchObject({ ok: true, amountPaise: 50000 });
    const id = (req as { requestId: string }).requestId;
    expect(await calc.decideNegativeDecision(actor("locker"), id, "approve", "self")).toMatchObject({ ok: false, error: expect.stringMatching(/a second person must approve or refuse it/) });
    await expect(pg.query(`insert into incentive_calc_negative_decisions (kind, request_id, period_id, run_id, employee_id, employee_name, outcome, amount_paise, reason, created_by_id, created_by_name) select 'approve', id, period_id, run_id, employee_id, employee_name, outcome, amount_paise, 'self', created_by_id, 'locker' from incentive_calc_negative_decisions where id = $1`, [id])).rejects.toThrow(/never whoever requested it/);
    // A write-off recorded without an approval is refused by the database (at commit).
    await expect(pg.query(`insert into incentive_calc_adjustments (program_id, category_code, from_month, employee_id, employee_name, kind, amount_paise, source_run_id, note) values ($1, 'A', '2026-05-01', $2, 'rep', 'salary-recovery', 50000, $3, 'no approval')`, [P2, who.rep, run0])).rejects.toThrow(/only with a second person's approval/);
    signIn("a1");
    expect(await calcAct.decideCategoryANegativeDecision({ requestId: id, decision: "approve", reason: "Agreed" })).toMatchObject({ ok: true });
    signIn("locker");
    expect(await calcAct.setCategoryAMonthLocked({ programId: P2, month: "2026-05-01", lock: true, rowVersion: await rv(P2, "2026-05-01") })).toMatchObject({ ok: true, notes: [expect.stringMatching(/written off/)] });
    expect(await q1(`select kind, amount_paise::int a from incentive_calc_adjustments where program_id = $1 and from_month = '2026-05-01'`, [P2])).toEqual([{ kind: "write-off", a: 50000 }]);
  });
});

describe("automatic locking (D8, D9)", () => {
  it("the daily job locks an open month only after its lock day, exactly as a lock by hand", async () => {
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: P3, month: "2026-04-01", asOf: "2026-04-30" })).toMatchObject({ ok: true, adopted: true });
    expect((await calc.autoLockDueMonths("2026-05-05")).locked).toEqual([]); // lock day: 5 May
    const r = await calc.autoLockDueMonths("2026-05-06");
    expect(r.locked).toEqual([{ programId: P3, month: "2026-04-01" }]);
    expect(await one(`select status, locked_by_id from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [P3])).toEqual({ status: "locked", locked_by_id: null });
    expect(await one(`select action, detail->>'automatic' automatic from incentive_audit where action = 'locked' and actor_id is null order by created_at desc limit 1`)).toEqual({ action: "locked", automatic: "true" });
    expect((await calc.autoLockDueMonths("2026-05-07")).locked).toEqual([]); // already locked
  });
});

describe("receipt events are read as they stood on the calculation date (D10)", () => {
  it("a hold released on 15 May still held the receipt as of 10 May, and doesn't as of 20 May", async () => {
    const rc = (await one<{ id: string }>(`select id from tally_documents where document_no = 'RC 2.1'`)).id;
    signIn("inputter");
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "hold", invoiceId: null, amountPaise: null, eventDate: "2026-04-20", note: "dispute" })).toMatchObject({ ok: true });
    const ev = (await one<{ id: string }>(`select id from incentive_calc_receipt_events where document_id = $1`, [rc])).id;
    expect(await onDay("2026-05-15", () => inputAct.retireIncentiveInput({ entity: "receipt-event", id: ev, reason: "Dispute resolved" }))).toMatchObject({ ok: true });
    const kinds = async (asOf: string) => (await calc.loadInput(h.db as never, P1, "2026-04-01", asOf)).events.map((e) => e.kind);
    expect(await kinds("2026-05-10")).toEqual(["hold"]);
    expect(await kinds("2026-05-20")).toEqual([]);
  });
});

describe("one all-categories limit per salesperson: every programme, and the old engine (D11)", () => {
  it("another programme's adopted month and the old engine's other categories count against it", async () => {
    const pid = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-04', 'open') returning id`)).id;
    await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref) values ($1, $2, 'C.1', 'C', 'accrual', 300000, 'x'), ($1, $2, 'A.1', 'A', 'accrual', 100000, 'y')`, [who.rep, pid]);
    const input = await calc.loadInput(h.db as never, P1, "2026-04-01", "2026-06-30");
    const others = input.allCategories?.others[who.rep] ?? [];
    expect(others).toEqual(expect.arrayContaining([expect.objectContaining({ category: "A · P3", fixed: true }), expect.objectContaining({ category: "C (old engine)", prePaise: 300000, fixed: true })]));
    expect(others.some((o) => o.category === "A (old engine)")).toBe(false); // never the old engine's own Category A
    expect(input.allCategories?.capPaise).toBe(18_250_00);
  });
});

describe("the old engine's hand-over is per person (D25)", () => {
  it("only the people a published Category A version covers that month leave the old engine's Category A", async () => {
    const covered = await load.newCategoryACovered("2026-04");
    expect(covered?.has(who.rep)).toBe(true);
    expect(covered?.has(who.rep2)).toBe(false);
    expect(await load.newCategoryACovered("2025-12")).toBeNull();
  });
});

describe("representative history from a file (D28)", () => {
  const csv = (rows: string[]) => ["customer,employee,from,to,note", ...rows].join("\n");
  it("checks every row and records nothing while any is wrong", async () => {
    const r = await inputs.importRepPeriods(actor("inputter"), csv(["C-001,rep@example.test,2025-01-01,2025-06-30,first", "Nobody,rep@example.test,2025-01-01,,", "C-001,ghost@example.test,2025-07-01,,", "C-001,rep2@example.test,2025-06-01,2025-12-31,overlaps line 2"]), { commit: true });
    expect(r).toMatchObject({ ok: true, imported: 0 });
    const rows = (r as { rows: { line: number; problem: string | null }[] }).rows;
    expect(rows.map((x) => x.problem === null)).toEqual([false, false, false, false]);
    expect(rows[0]!.problem).toMatch(/Overlaps line 5/);
    expect(rows[1]!.problem).toMatch(/No customer with code or name "Nobody"/);
    expect(rows[2]!.problem).toMatch(/No employee with email/);
    expect(rows[3]!.problem).toMatch(/Overlaps line 2/);
    expect(Number((await one<{ n: number }>(`select count(*)::int n from incentive_calc_rep_history`)).n)).toBe(0);
    expect(await inputs.importRepPeriods(actor("inputter"), "a,b\n1,2", { commit: false })).toMatchObject({ ok: false, error: expect.stringMatching(/column names/) });
  });
  it("records every row together when all are right, each with its history; an overlap with a recorded period is refused", async () => {
    const good = csv(['"C-001",rep@example.test,2025-01-01,2025-06-30,"first, with a comma"', "Customer One,rep2@example.test,2025-07-01,2025-12-31,"]);
    expect(await inputs.importRepPeriods(actor("inputter"), good, { commit: false })).toMatchObject({ ok: true, imported: 0 });
    expect(await inputs.importRepPeriods(actor("inputter"), good, { commit: true })).toMatchObject({ ok: true, imported: 2 });
    expect(await q1(`select effective_from::text f, note from incentive_calc_rep_history order by effective_from`)).toEqual([{ f: "2025-01-01", note: "first, with a comma" }, { f: "2025-07-01", note: null }]);
    expect(Number((await one<{ n: number }>(`select count(*)::int n from incentive_calc_input_history where entity = 'rep-history' and action = 'record'`)).n)).toBe(2);
    const again = await inputs.importRepPeriods(actor("inputter"), csv(["C-001,rep@example.test,2025-03-01,,"]), { commit: true });
    expect((again as { rows: { problem: string | null }[] }).rows[0]!.problem).toMatch(/Overlaps a period already recorded/);
  });
});

describe("Rules: a submitted Category A version is withdrawn only by its submitter (D26)", () => {
  it("anyone else approves or rejects it", async () => {
    const d = await rules.createDraft(actor("author"), { programId: P1, category: "A", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const config = aprilConfig();
    config.eligibility = [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }];
    const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    expect(await rules.withdraw(actor("checker"), d.versionId, sub.rowVersion)).toMatchObject({ ok: false, error: expect.stringMatching(/Only the person who submitted it can withdraw it/) });
    expect(await rules.withdraw(actor("author"), d.versionId, sub.rowVersion)).toMatchObject({ ok: true });
  });
});

describe("0142's pinned runner on a fresh database (apply, verify, rollback)", () => {
  it("applies exactly 0142, changes no existing data or object, and rolls back exactly — refusing while its data exists", async () => {
    const fresh = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments });
    const x: runner.Exec = { query: async <T>(t: string, p: unknown[] = []) => (await fresh.pg.query<T>(t, p)).rows, exec: async (t: string) => void (await fresh.pg.exec(t)) };
    for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await fresh.pg.exec(MIG(f));
    // Production has row-level security on every table; the drizzle-made test tables don't, so it is switched on here.
    for (const t of (await fresh.pg.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`)).rows) await fresh.pg.exec(`alter table "${t.relname}" enable row level security`);
    const e: runner.Expect = { ledger: false, role: false };
    const before = await runner.catalogue(x);
    await runner.preApply(x, e);
    // The pinned files are exactly the ones in the repository (canonical LF bytes).
    const migration = runner.pinned(runner.FILES.migration, readFileSync(resolve(__dirname, `../../db/migrations/${runner.FILES.migration}`)), runner.PINS.migration);
    const rollback = runner.pinned(runner.FILES.rollback, readFileSync(resolve(__dirname, `../../db/rollback/${runner.FILES.rollback}`)), runner.PINS.rollback);
    await fresh.pg.exec("begin");
    const r = await runner.applyIn(x, migration, e);
    await fresh.pg.exec("commit");
    expect(r.tables).toBeGreaterThan(0);
    expect((await runner.verifyApplied(x, e)).every((c) => c.ok)).toBe(true);
    await expect(runner.preApply(x, e)).rejects.toThrow(/already \(partly\) exist/);
    // With an acknowledgment recorded, the rollback is refused (by the runner and by the SQL itself).
    const emp = (await fresh.pg.query<{ id: string }>(`insert into employees (name, email, role) values ('x', 'x@example.test', 'both') returning id`)).rows[0]!.id;
    const b = (await fresh.pg.query<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'f', 'h') returning id`)).rows[0]!.id;
    const d = (await fresh.pg.query<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, total_paise, import_batch_id, source_row) values ('i', 'credit-notes', 'CN', 'cn', '2026-04-01', '2026-27', 'p', 'p', 1, $1, 1) returning id`, [b])).rows[0]!.id;
    await fresh.pg.query(`insert into incentive_calc_a_reviews (document_id, hold_code, decision, reason, created_by_id, created_by_name) values ($1, 'credit-note-unlinked', 'acknowledged', 'r', $2, 'x')`, [d, emp]);
    await expect(runner.preRollback(x, e)).rejects.toThrow(/rollback refused/);
    await expect(fresh.pg.exec(rollback)).rejects.toThrow(/0142 rollback refused/);
    await fresh.pg.exec(`alter table incentive_calc_a_reviews disable trigger incentive_calc_a_reviews_guard; delete from incentive_calc_a_reviews; alter table incentive_calc_a_reviews enable trigger incentive_calc_a_reviews_guard`);
    await fresh.pg.exec("begin");
    await runner.rollbackIn(x, rollback, e);
    await fresh.pg.exec("commit");
    expect((await runner.verifyRolledBack(x, e)).every((c) => c.ok)).toBe(true);
    expect(await runner.catalogue(x)).toBe(before);
    await fresh.pg.close();
  });
});
