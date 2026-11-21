import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running 0131 + 0132 + 0133's own SQL) for Category A's approval and payout
// (Stage 4, step 5): single- and multi-step approval from the published configuration, separation of duties, the
// integrity check of the calculation being approved, payout eligibility and reconciliation, duplicate and concurrent
// attempts, people without permission, attempts to change approved or paid months, audit history — and that the April
// figure, Forms and the live Incentive Tracker are untouched. Invented data only; only the session is mocked.
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
import { aprilConfig, EXAMPLE_2, L, type Pay } from "../fixtures/category-a";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let rules: typeof import("@/lib/queries/incentive-rules");
let auth: typeof import("@/lib/auth/incentive-calc");
const PEOPLE = ["runner", "locker", "dual", "a1", "a2", "a3", "payer", "viewer", "approvalsViewer", "payoutsViewer", "plainAdmin", "rep", "author", "checker"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], locker: ["lock", "submit"], dual: ["submit", "approve"], a1: ["approve"], a2: ["approve"], a3: ["approve"], payer: ["pay"], viewer: ["view"], approvalsViewer: ["approvals"], payoutsViewer: ["payouts"] };
const person = (k: Who) => ({ id: who[k], email: `${k.toLowerCase()}@example.test`, name: k, isActive: true, isAdmin: k !== "rep", departmentId: null, role: "both" });
const signIn = (k: Who) => {
  h.me = person(k);
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q1<T>(sql, params))[0]!;
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params)).n);
const fingerprint = async (tables: string[]) => {
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await one<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as f from ${t} t`)).f;
  return out;
};
const TRACKER = ["customers", "sales_orders", "invoices", "receipts", "incentive_periods", "incentive_ledger", "payout_runs"];
let trackerBefore: Record<string, string> = {};
let formsBefore: Record<string, string> = {};
const P = {} as Record<"ONE" | "THREE" | "CRAFT", string>;
let customer = "";
let batch = "";
const APR = "2026-04-01";
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const nextMonthStart = (d: string) => {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const period = async (program: string, month = APR) => one<{ id: string; status: string; row_version: number; current_run_id: string | null; submission_no: number; release_on: string | null }>(`select id, status, row_version, current_run_id, submission_no, release_on::text from incentive_calc_periods where program_id = $1 and month = $2`, [program, month]);
const base = async (program: string) => ({ programId: program, month: APR, rowVersion: (await period(program)).row_version });

async function doc(type: string, no: string, date: string, total: number, extra: Record<string, unknown> = {}) {
  return (
    await one<{ id: string }>(
      `insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row)
       values ($1, $2, $3, $4, $5, '2026-27', 'Customer One', 'customer one', $6, $7, $7, $8, $9, $10, $11, 1) returning id`,
      [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, total, extra.ref ?? null, extra.due ?? null, JSON.stringify(extra.lines ?? []), batch],
    )
  ).id;
}
const day = (days: number) => new Date(Date.parse("2026-04-05T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
async function aprilForms(payments: Pay[][]) {
  for (const [i, pays] of payments.entries()) {
    const order = await doc("sales-orders", `SO ${i + 1}`, "2026-04-05", L(10), { lines: [{ item: "Drive", quantity: 1, ratePaise: L(10), amountPaise: L(10) }] });
    const inv = await doc("sales-invoices", `INV ${i + 1}`, "2026-04-05", L(10), { ref: order, due: "2026-04-05" });
    for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `RC ${i + 1}.${k + 1}`, day(days), Math.round(L(10) * fraction), { ref: inv });
  }
}
async function program(code: string, settings: Record<string, unknown>) {
  const author = { id: who.author, name: "author" }, checker = { id: who.checker, name: "checker" };
  const p = await rules.createProgram(author, { code, name: code, description: null });
  if (!p.ok) throw new Error(p.error);
  const config = aprilConfig(settings as never);
  config.eligibility = [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }];
  const d = await rules.createDraft(author, { programId: p.programId, category: "A", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(author, d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(author, d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(checker, d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(checker, d.versionId, ap.rowVersion, APR, { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
  return p.programId;
}
async function calculatedAndLocked(program: string) {
  signIn("runner");
  expect(await act.calculateCategoryAMonth({ programId: program, month: APR, asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: true });
  signIn("locker");
  expect(await act.setCategoryAMonthLocked({ ...(await base(program)), lock: true })).toMatchObject({ ok: true });
}

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
    customers: schema.customers,
    salesOrders: schema.salesOrders,
    invoices: schema.invoices,
    receipts: schema.receipts,
    incentivePeriods: schema.incentivePeriods,
    incentiveLedger: schema.incentiveLedger,
    payoutRuns: schema.payoutRuns,
    incentiveAudit: schema.incentiveAudit,
    incentiveSchemes: schema.incentiveSchemes,
    ruleVersions: schema.ruleVersions,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of PEOPLE) who[k] = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k.toLowerCase()}@example.test`, k !== "rep"])).id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.calc.${r}`, who[k as Who]]);
  const cust = (await one<{ id: string }>(`insert into customers (name) values ('Tracker Customer') returning id`)).id;
  await pg.query(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, 100000000, 'A', '2026-04-05', true)`, [cust, who.rep]);
  const paid = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-04', 'paid') returning id`)).id;
  await pg.query(`insert into payout_runs (period_id, total_paise) values ($1, 900000)`, [paid]);
  trackerBefore = await fingerprint(TRACKER);
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await pg.exec(readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8"));
  customer = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id) values ('Customer One', $1) returning id`, [who.rep])).id;
  batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`)).id;
  await aprilForms(EXAMPLE_2);
  formsBefore = await fingerprint(["tally_documents", "customer_masters"]);
  act = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  rules = await import("@/lib/queries/incentive-rules");
  auth = await import("@/lib/auth/incentive-calc");
  P.ONE = await program("ONE", { "payout.approvalSteps": 1, "payout.release": "afterApproval" });
  P.THREE = await program("THREE", { "payout.approvalSteps": 3, "payout.release": "withPayrollMonth" });
  P.CRAFT = await program("CRAFT", { "payout.approvalSteps": 1, "payout.release": "afterApproval" });
}, 180_000);
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await pg.close();
});

describe("permissions", () => {
  it("view rights: approvals and payouts are separate; acting includes seeing what you act on", async () => {
    const r = async (k: Who) => {
      const x = await auth.incentiveCalcRights(person(k) as never);
      return { approvals: x.approvals, payouts: x.payouts, view: x.view };
    };
    expect(await r("approvalsViewer")).toEqual({ approvals: true, payouts: false, view: true });
    expect(await r("payoutsViewer")).toEqual({ approvals: false, payouts: true, view: true });
    expect(await r("a1")).toEqual({ approvals: true, payouts: false, view: true });
    expect(await r("payer")).toEqual({ approvals: false, payouts: true, view: true });
    expect(await r("plainAdmin")).toEqual({ approvals: false, payouts: false, view: false });
  });
});

describe("before approval", () => {
  it("a month that isn't calculated, or isn't locked, can't be submitted", async () => {
    signIn("locker");
    expect(await act.submitCategoryAMonth({ programId: P.ONE, month: APR, rowVersion: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/hasn't been calculated/) });
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId: P.ONE, month: APR, asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: true });
    signIn("locker");
    expect(await act.submitCategoryAMonth(await base(P.ONE))).toMatchObject({ ok: false, error: expect.stringMatching(/Only a locked month/) });
  });
  it("only holders of Submit can submit, and only once", async () => {
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ ...(await base(P.ONE)), lock: true })).toMatchObject({ ok: true });
    for (const k of ["viewer", "a1", "payer", "approvalsViewer", "plainAdmin"] as const) {
      signIn(k);
      await expect(act.submitCategoryAMonth(await base(P.ONE))).rejects.toThrow("Forbidden");
    }
    signIn("locker");
    const b = await base(P.ONE);
    expect(await act.submitCategoryAMonth(b)).toMatchObject({ ok: true, approvalsRequired: 1 });
    expect(await act.submitCategoryAMonth(b)).toMatchObject({ ok: false, error: expect.stringMatching(/changed by someone else/) });
    expect(await act.submitCategoryAMonth(await base(P.ONE))).toMatchObject({ ok: false, error: expect.stringMatching(/Only a locked month/) });
  });
});

describe("single-step approval and payout", () => {
  it("one approval approves it; released straight away as configured", async () => {
    signIn("payer");
    await expect(act.decideCategoryAMonth({ ...(await base(P.ONE)), decision: "approve", reason: null })).rejects.toThrow("Forbidden");
    signIn("a1");
    expect(await act.decideCategoryAMonth({ ...(await base(P.ONE)), decision: "approve", reason: "Checked against Forms" })).toMatchObject({ ok: true, status: "approved", step: 1 });
    expect(await period(P.ONE)).toMatchObject({ status: "approved", release_on: todayIST() });
  });
  it("the payout must reconcile exactly: no partial payout, no other amount, no future date", async () => {
    signIn("payer");
    const pay = async (over: Record<string, unknown>) => act.recordCategoryAPayout({ ...(await base(P.ONE)), reference: "NEFT-001", paidOn: todayIST(), amountPaise: 92500, note: null, ...over });
    expect(await pay({ amountPaise: 50000 })).toMatchObject({ ok: false, error: expect.stringMatching(/₹500\.00\) doesn't match the approved amount \(₹925\.00\)\. Partial payouts aren't permitted/) });
    expect(await pay({ amountPaise: 92501 })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't match/) });
    const tomorrow = new Date(Date.parse(`${todayIST()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(await pay({ paidOn: tomorrow })).toMatchObject({ ok: false, error: expect.stringMatching(/can't be in the future/) });
    expect(await pay({ reference: "   " })).toMatchObject({ ok: false, error: expect.stringMatching(/reference/) });
    expect(await count(`select count(*)::int n from incentive_calc_payouts`)).toBe(0);
    expect(await pay({})).toMatchObject({ ok: true, totalPaise: 92500 });
    const rec = await one<{ reference: string; total: number; lines: number; status: string }>(`select p.reference, p.total_paise::int total, (select count(*)::int from incentive_calc_payout_lines l where l.payout_id = p.id) lines, d.status from incentive_calc_payouts p join incentive_calc_periods d on d.id = p.period_id where d.program_id = $1`, [P.ONE]);
    expect(rec).toEqual({ reference: "NEFT-001", total: 92500, lines: 1, status: "paid" });
  });
  it("a paid month is final: no second payout, no change, no recalculation adopted", async () => {
    signIn("payer");
    expect(await act.recordCategoryAPayout({ ...(await base(P.ONE)), reference: "NEFT-002", paidOn: todayIST(), amountPaise: 92500, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });
    const p = await period(P.ONE);
    await expect(pg.query(`update incentive_calc_periods set status = 'approved', row_version = row_version + 1 where id = $1`, [p.id])).rejects.toThrow(/final/);
    await expect(pg.query(`update incentive_calc_payouts set total_paise = 1`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`delete from incentive_calc_payout_lines`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`update incentive_calc_approvals set reason = 'x'`)).rejects.toThrow(/append-only/);
    signIn("runner");
    const runsBefore = await count(`select count(*)::int n from incentive_calc_runs where program_id = $1 and month = $2`, [P.ONE, APR]);
    const r = await act.calculateCategoryAMonth({ programId: P.ONE, month: APR, asOf: "2026-10-01" });
    // Test 53: unconditional. Nothing changed since its adopted calculation (as of 30 September), so nothing is recorded
    // twice — and whatever is calculated, a paid month never adopts it.
    expect(r).toMatchObject({ ok: true, unchanged: true, adopted: false });
    expect(await count(`select count(*)::int n from incentive_calc_runs where program_id = $1 and month = $2`, [P.ONE, APR])).toBe(runsBefore);
    expect((await period(P.ONE)).current_run_id).toBe(p.current_run_id);
  });
});

describe("three approval levels", () => {
  it("each step by a different person, never the submitter; concurrent decisions on one step: only one lands", async () => {
    await calculatedAndLocked(P.THREE);
    signIn("dual");
    expect(await act.submitCategoryAMonth(await base(P.THREE))).toMatchObject({ ok: true, approvalsRequired: 3 });
    // The submitter holds Approve too, and is still refused — by the server and by the database.
    expect(await act.decideCategoryAMonth({ ...(await base(P.THREE)), decision: "approve", reason: null })).toMatchObject({ ok: false, error: expect.stringMatching(/You submitted this month/) });
    const p = await period(P.THREE);
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, 'dual')`, [p.id, p.current_run_id, p.submission_no, who.dual])).rejects.toThrow(/submitted a month never approves/);
    // Two approvers act on the same screen state at once: one step is recorded, the other is told it changed.
    const b = await base(P.THREE);
    const [x, y] = await Promise.all([
      (async () => {
        signIn("a1");
        return act.decideCategoryAMonth({ ...b, decision: "approve", reason: null });
      })(),
      (async () => {
        signIn("a2");
        return act.decideCategoryAMonth({ ...b, decision: "approve", reason: null });
      })(),
    ]);
    expect([x, y].filter((r) => r.ok)).toHaveLength(1);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ error: expect.stringMatching(/changed by someone else/) });
    expect(await count(`select count(*)::int n from incentive_calc_approvals where period_id = $1`, [p.id])).toBe(1);
    const first = (await one<{ actor_name: string }>(`select actor_name from incentive_calc_approvals where period_id = $1`, [p.id])).actor_name as Who;
    const others = (["a1", "a2", "a3"] as const).filter((k) => k !== first);
    signIn(first);
    expect(await act.decideCategoryAMonth({ ...(await base(P.THREE)), decision: "approve", reason: null })).toMatchObject({ ok: false, error: expect.stringMatching(/needs someone else/) });
    signIn(others[0]!);
    expect(await act.decideCategoryAMonth({ ...(await base(P.THREE)), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "submitted", step: 2 });
    signIn(others[1]!);
    expect(await act.decideCategoryAMonth({ ...(await base(P.THREE)), decision: "reject", reason: "SO 4's refund isn't recorded yet" })).toMatchObject({ ok: true, status: "locked", step: 3 });
    expect(await period(P.THREE)).toMatchObject({ status: "locked", submission_no: 1 });
    expect(await q1(`select step_no, decision, reason from incentive_calc_approvals where period_id = $1 order by step_no`, [p.id])).toEqual([
      { step_no: 1, decision: "approve", reason: null },
      { step_no: 2, decision: "approve", reason: null },
      { step_no: 3, decision: "reject", reason: "SO 4's refund isn't recorded yet" },
    ]);
  });
  it("resubmitted, it needs all three approvals again; released with the next payroll month and payable only from then", async () => {
    signIn("locker");
    expect(await act.submitCategoryAMonth(await base(P.THREE))).toMatchObject({ ok: true });
    for (const [k, step] of [["a3", 1], ["a2", 2], ["a1", 3]] as const) {
      signIn(k);
      expect(await act.decideCategoryAMonth({ ...(await base(P.THREE)), decision: "approve", reason: null })).toMatchObject({ ok: true, step, status: step === 3 ? "approved" : "submitted" });
    }
    const release = nextMonthStart(todayIST());
    expect(await period(P.THREE)).toMatchObject({ status: "approved", submission_no: 2, release_on: release });
    signIn("payer");
    expect(await act.recordCategoryAPayout({ ...(await base(P.THREE)), reference: "SAL-DEC", paidOn: todayIST(), amountPaise: 92500, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/released on .*can't be dated before/) });
    // On the release day, two people record the payout at once: exactly one payout exists.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${release}T06:30:00Z`) });
    const b = await base(P.THREE);
    const results = await Promise.all([1, 2].map((i) => act.recordCategoryAPayout({ ...b, reference: `SAL-DEC-${i}`, paidOn: release, amountPaise: 92500, note: null })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await count(`select count(*)::int n from incentive_calc_payouts p join incentive_calc_periods d on d.id = p.period_id where d.program_id = $1`, [P.THREE])).toBe(1);
    expect((await period(P.THREE)).status).toBe("paid");
  });
});

describe("an invalid or incomplete calculation is never approved", () => {
  it("a calculation whose stored inputs no longer reproduce its result can't be submitted", async () => {
    await calculatedAndLocked(P.CRAFT);
    // Tamper with a COPY: a new run whose stored inputs lack the approval steps (the engine blocks such a
    // configuration) but which claims the old result — then adopt it in a fresh month by hand.
    const src = await one<{ id: string; inputs: { config: { settings: Record<string, unknown> } }; result: object; inputs_hash: string; result_hash: string; config_version_id: string }>(`select r.* from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.program_id = $1`, [P.CRAFT]);
    const inputs = structuredClone(src.inputs);
    delete inputs.config.settings["payout.approvalSteps"];
    const month = "2026-05-01";
    (inputs as unknown as { month: string }).month = month;
    await pg.query(`insert into incentive_calc_periods (program_id, category_code, month) values ($1, 'A', $2)`, [P.CRAFT, month]);
    const run = (await one<{ id: string }>(
      `insert into incentive_calc_runs (program_id, category_code, month, as_of, config_version_id, config_version_no, engine_version, status, adopted, outcome, inputs_hash, result_hash, inputs, result, computed_by_name) values ($1, 'A', $2, '2026-09-30', $3, 1, 'category-a/2', 'computed', true, 'crafted', $4, $5, $6, $7, 'test') returning id`,
      [P.CRAFT, month, src.config_version_id, src.inputs_hash, src.result_hash, JSON.stringify(inputs), JSON.stringify(src.result)],
    )).id;
    await pg.query(`update incentive_calc_periods set current_run_id = $1, row_version = row_version + 1 where program_id = $2 and month = $3`, [run, P.CRAFT, month]);
    await pg.query(`update incentive_calc_periods set status = 'locked', locked_at = now(), row_version = row_version + 1 where program_id = $1 and month = $2`, [P.CRAFT, month]);
    signIn("locker");
    const rv = (await period(P.CRAFT, month)).row_version;
    expect(await act.submitCategoryAMonth({ programId: P.CRAFT, month, rowVersion: rv })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't reproduce its own result|blocked/) });
    expect((await period(P.CRAFT, month)).status).toBe("locked");
  });
  it("a valid month still goes through; April's figure is unchanged", async () => {
    signIn("locker");
    expect(await act.submitCategoryAMonth(await base(P.CRAFT))).toMatchObject({ ok: true });
    for (const p of [P.ONE, P.THREE, P.CRAFT]) expect((await q1(`select r.payable_paise::int p from incentive_calc_results r join incentive_calc_periods d on d.current_run_id = r.run_id where d.program_id = $1 and d.month = $2`, [p, APR]))).toEqual([{ p: 92500 }]);
  });
});

describe("history and preservation", () => {
  it("every step is in the audit trail, and Forms and the live tracker are untouched", async () => {
    const actions = await q1<{ action: string; n: number }>(`select action, count(*)::int n from incentive_audit where action in ('submitted', 'approved', 'rejected', 'paid') group by action order by action`);
    // ONE: submit, approve, pay. THREE: 2 submits, 2+3 approvals, 1 rejection, 1 payout. CRAFT: 1 submit.
    expect(actions).toEqual([
      { action: "approved", n: 6 },
      { action: "paid", n: 2 },
      { action: "rejected", n: 1 },
      { action: "submitted", n: 4 },
    ]);
    expect(await fingerprint(TRACKER)).toEqual(trackerBefore);
    expect(await fingerprint(["tally_documents", "customer_masters"])).toEqual(formsBefore);
  });
});
