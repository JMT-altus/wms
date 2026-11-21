import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Category A through its SERVICES, on an in-memory PGlite database running 0131–0133's own SQL and — only inside this
// throwaway database, as the completion test does — 0142's (for its safeguards and second-person approvals). Each
// test carries the Category A audit's inventory number. Every programme works on its own month of invented Forms
// documents, so one test's events never reach another's figures. Only the session is mocked; real PostgreSQL is not used.
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
import type { EligibilityRow } from "@/lib/incentives/rules-config/spec";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let calcAct: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let inputAct: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions");
let calc: typeof import("@/lib/queries/incentive-calc");
let inputs: typeof import("@/lib/queries/incentive-inputs");
let rules: typeof import("@/lib/queries/incentive-rules");
const PEOPLE = ["runner", "locker", "a1", "a2", "payer", "inputter", "rep", "rep2", "author", "checker"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], locker: ["lock", "submit"], a1: ["approve"], a2: ["approve"], payer: ["pay"], inputter: ["inputs"] };
const actor = (k: Who) => ({ id: who[k], name: k });
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k !== "rep" && k !== "rep2", departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q1<T>(sql, params))[0]!;
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params)).n);
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8");
const period = (program: string, month: string) => one<{ id: string; status: string; row_version: number; current_run_id: string | null; submission_no: number; locked_by_id: string | null }>(`select * from incentive_calc_periods where program_id = $1 and month = $2 and category_code = 'A'`, [program, month]);
const rv = async (program: string, month: string) => Number((await period(program, month)).row_version);
const resultsOf = (program: string, month: string) => q1<{ employee_id: string; sales_paise: string; earned_paise: string; payable_paise: string }>(`select r.employee_id, r.sales_paise::text, r.earned_paise::text, r.payable_paise::text from incentive_calc_results r join incentive_calc_periods p on p.current_run_id = r.run_id where p.program_id = $1 and p.month = $2`, [program, month]);
const adjustments = (program: string) => q1<{ kind: string; a: number; from: string; to: string | null; m: number | null }>(`select kind, amount_paise::int a, from_month::text "from", to_month::text "to", months_left m from incentive_calc_adjustments where program_id = $1 order by from_month, kind`, [program]);
const docId = async (no: string) => (await one<{ id: string }>(`select id from tally_documents where document_no = $1`, [no])).id;
let customer = "";
let batch = "";

async function doc(type: string, no: string, date: string, total: number, extra: Record<string, unknown> = {}) {
  return (
    await one<{ id: string }>(
      `insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row)
       values ($1, $2, $3, $4, $5, '2026-27', 'Customer One', 'customer one', $6, $7, $7, $8, $9, $10, $11, 1) returning id`,
      [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, total, extra.ref ?? null, extra.due ?? null, JSON.stringify(extra.lines ?? []), batch],
    )
  ).id;
}
const plus = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** 12 orders of ₹10 L on the 5th of the month, each invoiced that day (due that day) and paid as `payments` say. */
async function monthForms(month: string, prefix: string, payments: Pay[][] = Array(12).fill([[1, 5]])) {
  const d = `${month.slice(0, 7)}-05`;
  for (const [i, pays] of payments.entries()) {
    const n = i + 1;
    const order = await doc("sales-orders", `${prefix}SO ${n}`, d, L(10), { lines: [{ item: "Drive", quantity: 1, ratePaise: L(10), amountPaise: L(10) }] });
    const inv = await doc("sales-invoices", `${prefix}INV ${n}`, d, L(10), { ref: order, due: d });
    for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `${prefix}RC ${n}.${k + 1}`, plus(d, days), Math.round(L(10) * fraction), { ref: inv });
  }
}
const BASE = { "payout.approvalSteps": 1, "payout.release": "afterApproval", "adjust.negativeBalance": "recoverFromNextPayout", "adjust.windowDays": 365, "period.lockMode": "manual", "period.lateReceipts": "adjustInCurrentOpenMonth", "adjust.lockedOrPaidMonths": "adjustInCurrentMonth", "adjust.openMonths": "recalculate", "period.recalcUntil": "untilLocked" };
const repRow = (id: string, label: string): EligibilityRow => ({ subjectType: "employee", subjectId: id, role: null, subjectLabel: label, mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null });
async function program(code: string, settings: Record<string, unknown>, eligibility: EligibilityRow[] = [repRow(who.rep, "rep")]) {
  const p = await rules.createProgram(actor("author"), { code, name: code, description: null });
  if (!p.ok) throw new Error(p.error);
  const config = aprilConfig({ ...BASE, ...settings } as never);
  config.eligibility = eligibility;
  const d = await rules.createDraft(actor("author"), { programId: p.programId, category: "A", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, "2026-01-01", { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
  return p.programId;
}
const calcMonth = async (programId: string, month: string, asOf: string) => {
  signIn("runner");
  return calcAct.calculateCategoryAMonth({ programId, month, asOf });
};
const lockMonth = async (programId: string, month: string) => {
  signIn("locker");
  return calcAct.setCategoryAMonthLocked({ programId, month, lock: true, rowVersion: await rv(programId, month) });
};
const submitMonth = async (programId: string, month: string) => {
  signIn("locker");
  return calcAct.submitCategoryAMonth({ programId, month, rowVersion: await rv(programId, month) });
};
/** Calculate, lock, submit, approve (one step) and pay a month, all on `day` (release on approval = that day). */
async function payMonth(programId: string, month: string, day: string) {
  await onDay(day, async () => {
    expect(await calcMonth(programId, month, day)).toMatchObject({ ok: true, adopted: true });
    expect(await lockMonth(programId, month)).toMatchObject({ ok: true });
    expect(await submitMonth(programId, month)).toMatchObject({ ok: true });
    signIn("a1");
    expect(await calcAct.decideCategoryAMonth({ programId, month, rowVersion: await rv(programId, month), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "approved" });
    const p = await period(programId, month);
    const total = (await calc.payoutLines(h.db as never, programId, month, p.current_run_id!)).reduce((s, l) => s + l.amountPaise, 0);
    signIn("payer");
    expect(await calcAct.recordCategoryAPayout({ programId, month, rowVersion: p.row_version, reference: `PAY-${month}`, paidOn: day, amountPaise: total, note: null })).toMatchObject({ ok: true });
  });
}
/** A difference of `paise` carried into `toMonth` (as a recalculated, paid earlier month would carry it). */
async function carriedInto(programId: string, toMonth: string, paise: number) {
  const run = (await period(programId, toMonth)).current_run_id;
  await pg.query(`insert into incentive_calc_adjustments (program_id, category_code, from_month, to_month, employee_id, employee_name, kind, amount_paise, source_run_id, note) values ($1, 'A', $2, $3, $4, 'rep', 'recalc-difference', $5, $6, 'carried in (test)')`, [programId, `${Number(toMonth.slice(0, 4)) - 1}-12-01`, toMonth, who.rep, paise, run]);
}
const refund = async (receiptNo: string, day: string) => {
  signIn("inputter");
  expect(await inputAct.recordReceiptEvent({ documentId: await docId(receiptNo), kind: "refund", invoiceId: null, amountPaise: L(5), eventDate: day, note: "Partial refund" })).toMatchObject({ ok: true });
};
const ONE_REFUND = -Math.round(2_000_00 / 12); // half of one order refunded: it is no longer fully collected (−₹166.67)

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
  customer = (await one<{ id: string }>(`insert into customer_masters (name, code, sales_rep_id, credit_period_days) values ('Customer One', 'C-001', $1, 30) returning id`, [who.rep])).id;
  batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`)).id;
  // One month of documents per area tested (see each test). September has none on purpose.
  await monthForms("2026-01-01", "J");
  await monthForms("2026-02-01", "F");
  await monthForms("2026-03-01", "M");
  await monthForms("2026-04-01", "A");
  await monthForms("2026-05-01", "Y");
  await monthForms("2026-06-01", "U");
  await monthForms("2026-07-01", "L");
  await monthForms("2026-08-01", "G");
  await monthForms("2026-10-01", "O");
  calcAct = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  inputAct = await import("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions");
  calc = await import("@/lib/queries/incentive-calc");
  inputs = await import("@/lib/queries/incentive-inputs");
  rules = await import("@/lib/queries/incentive-rules");
}, 300_000);
afterAll(async () => {
  await pg.close();
});

describe("Test 5 · pre-closures recorded in Forms, read by the service", () => {
  it("a pre-closed half line deducts ₹5 L from the order's month (₹1.15 Cr → ₹1,500); one naming a missing line is held", async () => {
    const P = await program("PRE", { "basis.preClosure": "deductPreClosedValue" });
    const so1 = await docId("JSO 1"), so2 = await docId("JSO 2");
    const add = (order: string, line: number, qty: string, day: string) =>
      pg.query(`insert into sales_order_preclosures (document_id, line_no, allocation_no, item, ordered_quantity, quantity, reason, preclose_date, request_id, recorded_by_id, recorded_by_name) values ($1, $2, 1, 'Drive', '1', $3, 'Customer cancelled the rest', $4, $5, $6, 'inputter')`, [order, line, qty, day, randomUUID(), who.inputter]);
    await add(so1, 1, "0.5", "2026-01-20");
    await add(so2, 5, "1", "2026-01-21");
    expect(await calcMonth(P, "2026-01-01", "2026-02-28")).toMatchObject({ ok: true, status: "computed", adopted: true });
    expect(await resultsOf(P, "2026-01-01")).toEqual([expect.objectContaining({ employee_id: who.rep, sales_paise: String(L(115)), earned_paise: "150000" })]);
    const run = await one<{ inputs: { preclosures: unknown[]; preclosureProblems: { orderNo: string; reason: string }[] }; result: { held: { code: string; documentNo: string }[] } }>(`select inputs, result from incentive_calc_runs where id = $1`, [(await period(P, "2026-01-01")).current_run_id]);
    expect(run.inputs.preclosures).toEqual([{ orderId: so1, date: "2026-01-20", itemsValuePaise: L(5) }]);
    expect(run.inputs.preclosureProblems).toEqual([expect.objectContaining({ orderNo: "JSO 2", reason: "it names line 5, which the order doesn't have." })]);
    expect(run.result.held).toEqual([expect.objectContaining({ code: "preclosure-incomplete", documentNo: "JSO 2" })]);
    // Held: the month isn't submitted until it is resolved or acknowledged.
    expect(await lockMonth(P, "2026-01-01")).toMatchObject({ ok: true });
    expect(await submitMonth(P, "2026-01-01")).toMatchObject({ ok: false, error: expect.stringMatching(/JSO 2 \(pre-closure that can't be valued\)/) });
  });
});

describe("Test 24 · credit notes recorded in Forms, read by the service", () => {
  it("one in February and one in March, on February invoices: the original month, or each in its own month, as configured", async () => {
    const inv1 = await docId("FINV 1"), inv2 = await docId("FINV 2");
    await doc("credit-notes", "FCN 1", "2026-02-20", L(1), { ref: inv1 });
    await doc("credit-notes", "FCN 2", "2026-03-03", L(1), { ref: inv2 });
    const ORIGINAL = await program("CN1", { "adjust.creditNote": "reduceOriginalMonthSales" });
    const ISSUE = await program("CN2", { "adjust.creditNote": "reduceInIssueMonth" });
    expect(await calcMonth(ORIGINAL, "2026-02-01", "2026-03-31")).toMatchObject({ ok: true, adopted: true });
    expect((await resultsOf(ORIGINAL, "2026-02-01"))[0]).toMatchObject({ sales_paise: String(L(118)) });
    const credits = await q1<{ document_no: string; collectible_paise: string }>(`select c.document_no, c.collectible_paise::text from incentive_calc_order_credits c join incentive_calc_periods p on p.current_run_id = c.run_id where p.program_id = $1 and c.document_no in ('FSO 1', 'FSO 2') order by 1`, [ORIGINAL]);
    expect(credits).toEqual([{ document_no: "FSO 1", collectible_paise: String(L(9)) }, { document_no: "FSO 2", collectible_paise: String(L(9)) }]);
    expect(await calcMonth(ISSUE, "2026-02-01", "2026-03-31")).toMatchObject({ ok: true, adopted: true });
    expect((await resultsOf(ISSUE, "2026-02-01"))[0]).toMatchObject({ sales_paise: String(L(119)) });
    expect(await calcMonth(ISSUE, "2026-03-01", "2026-03-31")).toMatchObject({ ok: true, adopted: true });
    // March: its own ₹1.2 Cr of orders, less the March credit note on a February invoice.
    expect((await resultsOf(ISSUE, "2026-03-01")).find((r) => r.employee_id === who.rep)).toMatchObject({ sales_paise: String(L(119)) });
  });
});

describe("Test 30 · \"Keep the last calculation\" (an open month is frozen), through the service", () => {
  it("a later change is kept for the record but not adopted; the month keeps its figures", async () => {
    const P = await program("FREEZE", { "adjust.openMonths": "freezeAtLastCompute" });
    expect(await calcMonth(P, "2026-03-01", "2026-04-10")).toMatchObject({ ok: true, adopted: true });
    const first = (await period(P, "2026-03-01")).current_run_id;
    await refund("MRC 1.1", "2026-04-12");
    const r = await calcMonth(P, "2026-03-01", "2026-04-15");
    expect(r).toMatchObject({ ok: true, adopted: false, unchanged: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.outcome).toMatch(/Kept for the record, not adopted: the month keeps its last calculation/);
    expect((await period(P, "2026-03-01")).current_run_id).toBe(first);
    expect((await resultsOf(P, "2026-03-01"))[0]).toMatchObject({ payable_paise: "200000" });
    expect(await count(`select count(*)::int n from incentive_calc_runs where program_id = $1`, [P])).toBe(2);
  });
});

describe("Test 31 · \"No adjustment\" for a locked month, through the service", () => {
  let P = "";
  it("the difference is found, kept for the record, and NOT carried", async () => {
    P = await program("NOADJ", { "adjust.lockedOrPaidMonths": "noAdjustment" });
    expect(await calcMonth(P, "2026-05-01", "2026-06-10")).toMatchObject({ ok: true, adopted: true });
    expect(await lockMonth(P, "2026-05-01")).toMatchObject({ ok: true });
    await refund("YRC 1.1", "2026-06-12");
    const r = await calcMonth(P, "2026-05-01", "2026-06-15");
    expect(r).toMatchObject({ ok: true, adopted: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.outcome).toMatch(/the month is locked\. It differs; no adjustment is made \(configured\)/);
    expect(await adjustments(P)).toEqual([]);
  });
  it("receipt-event recorder: whoever recorded a receipt event the month uses never approves it — the service and the database (0142)", async () => {
    expect(await submitMonth(P, "2026-05-01")).toMatchObject({ ok: true });
    const p = await period(P, "2026-05-01");
    expect(await calc.decideMonth(actor("inputter"), P, "2026-05-01", p.row_version, "approve", null)).toMatchObject({ ok: false, error: expect.stringMatching(/You recorded or retired a receipt event used by this month's calculation/) });
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, 'inputter')`, [p.id, p.current_run_id, p.submission_no, who.inputter])).rejects.toThrow(/Whoever recorded or retired an input a Category A month uses never approves or rejects it/);
  });
});

describe("Test 32 · the correction window after payout, through the service", () => {
  it("5 days: a difference found 9 days after payment isn't carried (the payout became final)", async () => {
    const P = await program("WIN5", { "adjust.windowDays": 5 });
    await payMonth(P, "2026-06-01", "2026-07-01");
    await refund("URC 1.1", "2026-07-08");
    const r = await calcMonth(P, "2026-06-01", "2026-07-10");
    expect(r).toMatchObject({ ok: true, adopted: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.outcome).toMatch(/the payout became final on 2026-07-06/);
    expect(await adjustments(P)).toEqual([]);
  });
  it("30 days: the same difference is carried into July, once", async () => {
    const P = await program("WIN30", { "adjust.windowDays": 30 });
    await payMonth(P, "2026-06-01", "2026-07-01"); // as of 1 July: the refund of 8 July isn't seen yet
    const r = await calcMonth(P, "2026-06-01", "2026-07-10");
    if (!r.ok) throw new Error(r.error);
    expect(r.outcome).toMatch(/The difference is carried into 2026-07/);
    expect(await adjustments(P)).toEqual([{ kind: "recalc-difference", a: ONE_REFUND, from: "2026-06-01", to: "2026-07-01", m: null }]);
    expect(await calcMonth(P, "2026-06-01", "2026-07-10")).toMatchObject({ ok: true, unchanged: true });
    expect(await adjustments(P)).toHaveLength(1);
  });
});

describe("Test 33 · a negative balance recovered from the next payout, through the service", () => {
  it("a paid month's refund carried into September makes it negative; locking carries it into October, whose payout is reduced", async () => {
    const P = await program("NEXT", {});
    await payMonth(P, "2026-08-01", "2026-09-01");
    await refund("GRC 1.1", "2026-09-05");
    const back = await calcMonth(P, "2026-08-01", "2026-09-05");
    if (!back.ok) throw new Error(back.error);
    expect(back.outcome).toMatch(/carried into 2026-09/);
    expect(await calcMonth(P, "2026-09-01", "2026-09-30")).toMatchObject({ ok: true, adopted: true }); // no September orders
    expect(await lockMonth(P, "2026-09-01")).toMatchObject({ ok: true, notes: [expect.stringMatching(/recovered from the next payout \(2026-10\)/)] });
    expect((await adjustments(P)).filter((a) => a.kind === "negative-carry")).toEqual([{ kind: "negative-carry", a: ONE_REFUND, from: "2026-09-01", to: "2026-10-01", m: null }]);
    expect(await calcMonth(P, "2026-10-01", "2026-10-31")).toMatchObject({ ok: true, adopted: true });
    const lines = await calc.payoutLines(h.db as never, P, "2026-10-01", (await period(P, "2026-10-01")).current_run_id!);
    expect(lines).toEqual([expect.objectContaining({ employeeId: who.rep, payablePaise: 200000, adjustmentsPaise: ONE_REFUND, amountPaise: 200000 + ONE_REFUND })]);
  });
});

describe("Test 35 · a negative balance recovered from salary, through the service", () => {
  it("refused at lock until a second person approves exactly it; then recorded once, with nothing carried", async () => {
    const P = await program("SALARY", { "adjust.negativeBalance": "recoverFromSalary" });
    expect(await calcMonth(P, "2026-09-01", "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    await carriedInto(P, "2026-09-01", -30000);
    expect(await lockMonth(P, "2026-09-01")).toMatchObject({ ok: false, error: expect.stringMatching(/rep's negative balance of ₹300.00 is to be recovered from salary: a second person must approve it first/) });
    signIn("locker");
    const req = await calcAct.requestCategoryANegativeDecision({ programId: P, month: "2026-09-01", employeeId: who.rep, reason: "Agreed with the salesperson" });
    expect(req).toMatchObject({ ok: true, amountPaise: 30000 });
    signIn("a1");
    expect(await calcAct.decideCategoryANegativeDecision({ requestId: (req as { requestId: string }).requestId, decision: "approve", reason: "Approved" })).toMatchObject({ ok: true });
    expect(await lockMonth(P, "2026-09-01")).toMatchObject({ ok: true, notes: [expect.stringMatching(/recovered from salary/)] });
    expect((await adjustments(P)).filter((a) => a.kind !== "recalc-difference")).toEqual([{ kind: "salary-recovery", a: 30000, from: "2026-09-01", to: null, m: null }]);
  });
});

describe("Test 36 · a negative balance carried for two months, then written off, through the service", () => {
  it("September → October (1 left) → November (0 left) → written off, with a second person's approval", async () => {
    const P = await program("CARRY2", { "adjust.negativeBalance": "carryForwardMonths", "adjust.carryForwardMonths": 2 });
    expect(await calcMonth(P, "2026-09-01", "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    await carriedInto(P, "2026-09-01", -3_000_00);
    expect(await lockMonth(P, "2026-09-01")).toMatchObject({ ok: true });
    // October has its own ₹2,000: −₹3,000 + ₹2,000 = −₹1,000 is carried on.
    expect(await calcMonth(P, "2026-10-01", "2026-10-31")).toMatchObject({ ok: true, adopted: true });
    expect(await lockMonth(P, "2026-10-01")).toMatchObject({ ok: true });
    const today = calc.todayIST();
    expect(await calcMonth(P, "2026-11-01", today)).toMatchObject({ ok: true, adopted: true });
    expect(await lockMonth(P, "2026-11-01")).toMatchObject({ ok: false, error: expect.stringMatching(/rep's negative balance of ₹1,000.00|rep's negative balance of ₹1000.00/) });
    signIn("locker");
    const req = await calcAct.requestCategoryANegativeDecision({ programId: P, month: "2026-11-01", employeeId: who.rep, reason: "Carried for the configured two months" });
    expect(req).toMatchObject({ ok: true, amountPaise: 1_000_00 });
    signIn("a2");
    expect(await calcAct.decideCategoryANegativeDecision({ requestId: (req as { requestId: string }).requestId, decision: "approve", reason: "Approved" })).toMatchObject({ ok: true });
    expect(await lockMonth(P, "2026-11-01")).toMatchObject({ ok: true });
    expect((await adjustments(P)).filter((a) => a.kind !== "recalc-difference")).toEqual([
      { kind: "negative-carry", a: -3_000_00, from: "2026-09-01", to: "2026-10-01", m: 1 },
      { kind: "negative-carry", a: -1_000_00, from: "2026-10-01", to: "2026-11-01", m: 0 },
      { kind: "write-off", a: 1_000_00, from: "2026-11-01", to: null, m: null },
    ]);
  });
});

describe("Test 38 · the representative on the order's date, from periods recorded in the WMS", () => {
  let P = "";
  it("July's orders (5 July) are rep2's: rep's period ended on 4 July — the Customer Master's current representative (rep) isn't used", async () => {
    signIn("inputter");
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.rep, from: "2026-01-01", to: "2026-07-04", note: null })).toMatchObject({ ok: true });
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.rep2, from: "2026-07-05", to: null, note: "Handover" })).toMatchObject({ ok: true });
    const both = [repRow(who.rep, "rep"), repRow(who.rep2, "rep2")];
    P = await program("REPDATE", { "attribution.historical": "repAtOrderDate" }, both);
    const NOW = await program("REPNOW", { "attribution.historical": "currentRep" }, both);
    expect(await calcMonth(P, "2026-07-01", "2026-08-10")).toMatchObject({ ok: true, adopted: true });
    expect((await resultsOf(P, "2026-07-01")).map((r) => [r.employee_id, r.sales_paise])).toEqual([[who.rep2, String(L(120))]]);
    expect(await calcMonth(NOW, "2026-07-01", "2026-08-10")).toMatchObject({ ok: true, adopted: true });
    expect((await resultsOf(NOW, "2026-07-01")).map((r) => r.employee_id)).toEqual([who.rep]);
  });
  it("representative-period recorder: never approves that month — the service and the database (0142)", async () => {
    expect(await lockMonth(P, "2026-07-01")).toMatchObject({ ok: true });
    expect(await submitMonth(P, "2026-07-01")).toMatchObject({ ok: true });
    const p = await period(P, "2026-07-01");
    expect(await calc.decideMonth(actor("inputter"), P, "2026-07-01", p.row_version, "approve", null)).toMatchObject({ ok: false, error: expect.stringMatching(/You recorded or retired a customer's representative period used by this month's calculation/) });
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, 'inputter')`, [p.id, p.current_run_id, p.submission_no, who.inputter])).rejects.toThrow(/Whoever recorded or retired an input a Category A month uses never approves or rejects it/);
    // An independent approver can (the database's other checks pass too).
    signIn("a1");
    expect(await calcAct.decideCategoryAMonth({ programId: P, month: "2026-07-01", rowVersion: p.row_version, decision: "approve", reason: null })).toMatchObject({ ok: true, status: "approved" });
  });
});

describe("order-salesperson recorder: never approves the month (service and database, 0142)", () => {
  it("whoever recorded an order's salesperson used by the month is refused; the database refuses it too", async () => {
    const P = await program("ATTR", { "attribution.source": "orderSalesperson" });
    signIn("inputter");
    for (let n = 1; n <= 12; n++) expect(await inputAct.recordOrderSalesperson({ documentId: await docId(`LSO ${n}`), employeeId: who.rep, sharePpm: 1_000_000, note: null })).toMatchObject({ ok: true });
    expect(await calcMonth(P, "2026-07-01", "2026-08-10")).toMatchObject({ ok: true, adopted: true });
    expect((await resultsOf(P, "2026-07-01"))[0]).toMatchObject({ employee_id: who.rep, payable_paise: "200000" });
    expect(await lockMonth(P, "2026-07-01")).toMatchObject({ ok: true });
    expect(await submitMonth(P, "2026-07-01")).toMatchObject({ ok: true });
    const p = await period(P, "2026-07-01");
    expect(await calc.decideMonth(actor("inputter"), P, "2026-07-01", p.row_version, "reject", "x")).toMatchObject({ ok: false, error: expect.stringMatching(/You recorded or retired an order's salespeople used by this month's calculation/) });
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, reason, actor_id, actor_name) values ($1, $2, $3, 1, 'reject', 'x', $4, 'inputter')`, [p.id, p.current_run_id, p.submission_no, who.inputter])).rejects.toThrow(/Whoever recorded or retired an input a Category A month uses never approves or rejects it/);
  });
});

describe("Test 42 · \"A number of days after the month ends\" (10), through the service", () => {
  it("changes are adopted until 10 May; after that they are kept for the record, not adopted", async () => {
    const P = await program("FIXED", { "period.recalcUntil": "fixedDaysAfterMonthEnd", "period.recalcDays": 10 });
    expect(await calcMonth(P, "2026-04-01", "2026-05-05")).toMatchObject({ ok: true, adopted: true });
    await refund("ARC 1.1", "2026-05-07");
    expect(await calcMonth(P, "2026-04-01", "2026-05-10")).toMatchObject({ ok: true, adopted: true }); // the last day: still adopted
    expect((await resultsOf(P, "2026-04-01"))[0]).toMatchObject({ payable_paise: String(200000 + ONE_REFUND) });
    await refund("ARC 2.1", "2026-05-15");
    const r = await calcMonth(P, "2026-04-01", "2026-05-20");
    expect(r).toMatchObject({ ok: true, adopted: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.outcome).toMatch(/recalculation ended 10 days after the month \(2026-05-10\)/);
    expect((await resultsOf(P, "2026-04-01"))[0]).toMatchObject({ payable_paise: String(200000 + ONE_REFUND) });
  });
});

describe("Test 43 · automatic locking with a negative balance", () => {
  it("the daily job: the negative balance is handled exactly as at a lock by hand (carried into the next payout)", async () => {
    const P = await program("AUTO", { "period.lockMode": "autoAfterDays", "period.autoLockDays": 5 });
    expect(await calcMonth(P, "2026-09-01", "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    await carriedInto(P, "2026-09-01", -10000);
    const W = await program("AUTOWO", { "period.lockMode": "autoAfterDays", "period.autoLockDays": 5, "adjust.negativeBalance": "writeOff" });
    expect(await calcMonth(W, "2026-09-01", "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    await carriedInto(W, "2026-09-01", -10000);
    const r = await calc.autoLockDueMonths("2026-10-06");
    expect(r.locked).toContainEqual({ programId: P, month: "2026-09-01" });
    expect((await period(P, "2026-09-01"))).toMatchObject({ status: "locked", locked_by_id: null });
    expect((await adjustments(P)).filter((a) => a.kind === "negative-carry")).toEqual([{ kind: "negative-carry", a: -10000, from: "2026-09-01", to: "2026-10-01", m: null }]);
    // A write-off waits for its second person: the month stays open, and the job says why.
    expect(r.waiting).toContainEqual({ programId: W, month: "2026-09-01", why: expect.stringMatching(/rep's negative balance of ₹100.00 is to be written off: a second person must approve it first/) });
    expect((await period(W, "2026-09-01")).status).toBe("open");
    expect((await adjustments(W)).filter((a) => a.kind !== "recalc-difference")).toEqual([]);
  });
  it("at a calculation after the lock day: the month locks first, with its negative balance handled the same way", async () => {
    const P = await program("AUTOCALC", { "period.lockMode": "autoAfterDays", "period.autoLockDays": 5 });
    expect(await calcMonth(P, "2026-10-01", "2026-10-31")).toMatchObject({ ok: true, adopted: true });
    await carriedInto(P, "2026-10-01", -3_000_00); // October earns ₹2,000: net −₹1,000
    await refund("ORC 1.1", "2026-11-08"); // a change, so the next calculation records a run
    const r = await calcMonth(P, "2026-10-01", "2026-11-10");
    expect(r).toMatchObject({ ok: true, adopted: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.outcome).toMatch(/locked automatically now/);
    expect((await period(P, "2026-10-01"))).toMatchObject({ status: "locked", locked_by_id: null });
    expect((await adjustments(P)).filter((a) => a.kind === "negative-carry")).toEqual([{ kind: "negative-carry", a: -1_000_00, from: "2026-10-01", to: "2026-11-01", m: null }]);
  });
});

describe("Test 48 · an impossible, early or future calculation date on an open month, through the service", () => {
  it("is refused with the reason, and nothing is recorded", async () => {
    const P = await program("DATES", {});
    const tomorrow = new Date(Date.parse(`${calc.todayIST()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(await calcMonth(P, "2026-02-01", "2026-02-30")).toMatchObject({ ok: false, error: "The calculation date must be on or after the month's first day." });
    expect(await calcMonth(P, "2026-04-01", "2026-03-31")).toMatchObject({ ok: false, error: "The calculation date must be on or after the month's first day." });
    expect(await calcMonth(P, "2026-04-01", tomorrow)).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`The calculation date \\(${tomorrow}\\) can't be in the future`)) });
    expect(await calcMonth(P, "2026-04-15", "2026-04-30")).toMatchObject({ ok: false, error: "Choose a programme and a month." });
    expect(await count(`select count(*)::int n from incentive_calc_runs where program_id = $1`, [P])).toBe(0);
    expect(await count(`select count(*)::int n from incentive_calc_periods where program_id = $1`, [P])).toBe(0);
  });
});

describe("Test 51 · a rejection at step 1 of 1", () => {
  it("needs a reason; returns the month to locked; it is submitted again (submission 2) and approved by someone else", async () => {
    const P = await program("REJECT", {});
    expect(await calcMonth(P, "2026-07-01", "2026-08-10")).toMatchObject({ ok: true, adopted: true });
    expect(await lockMonth(P, "2026-07-01")).toMatchObject({ ok: true });
    expect(await submitMonth(P, "2026-07-01")).toMatchObject({ ok: true, approvalsRequired: 1 });
    signIn("a1");
    expect(await calcAct.decideCategoryAMonth({ programId: P, month: "2026-07-01", rowVersion: await rv(P, "2026-07-01"), decision: "reject", reason: "  " })).toMatchObject({ ok: false, error: "Give the reason for rejecting it." });
    expect(await calcAct.decideCategoryAMonth({ programId: P, month: "2026-07-01", rowVersion: await rv(P, "2026-07-01"), decision: "reject", reason: "Check order LSO 3 first" })).toMatchObject({ ok: true, status: "locked", step: 1 });
    expect(await period(P, "2026-07-01")).toMatchObject({ status: "locked", submission_no: 1 });
    expect(await submitMonth(P, "2026-07-01")).toMatchObject({ ok: true });
    signIn("a2");
    expect(await calcAct.decideCategoryAMonth({ programId: P, month: "2026-07-01", rowVersion: await rv(P, "2026-07-01"), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "approved", step: 1 });
    expect(await q1(`select a.submission_no, a.step_no, a.decision, a.reason, a.actor_name from incentive_calc_approvals a join incentive_calc_periods p on p.id = a.period_id where p.program_id = $1 order by a.submission_no`, [P])).toEqual([
      { submission_no: 1, step_no: 1, decision: "reject", reason: "Check order LSO 3 first", actor_name: "a1" },
      { submission_no: 2, step_no: 1, decision: "approve", reason: null, actor_name: "a2" },
    ]);
    expect(await q1(`select action from incentive_audit where entity_id = $1 and action in ('submitted', 'rejected', 'approved') order by created_at`, [(await period(P, "2026-07-01")).id])).toEqual([{ action: "submitted" }, { action: "rejected" }, { action: "submitted" }, { action: "approved" }]);
  });
});
