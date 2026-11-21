import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running migrations 0131, 0132 and 0133's own SQL) for Category A's completion:
// managed inputs (order salespeople, representative periods, receipt events) recorded and retired through the real
// server actions, the database's own guards, a calculation that reads them, approval with separate approvers,
// rejection, payout records, negative balances at lock, automatic locking — and that Forms and the live Incentive
// Tracker are untouched. Invented data only; only the session is mocked.
/**
 * Runs `fn` with the clock on a simulated day (from noon in India), for a calculation AS OF a day that hasn't come yet:
 * the service refuses a calculation date in the future (Phase 1). Only `Date` is faked, only for the call, each call a
 * minute later than the one before (the clock keeps moving); real time is restored afterwards, whatever happens.
 */
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
import { aprilConfig, EXAMPLE_2, L, type Pay } from "../fixtures/category-a";
import { monthEnd, nextMonth } from "@/lib/incentives/category-a/settle";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let calcAct: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let inputAct: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions");
let rules: typeof import("@/lib/queries/incentive-rules");
const PEOPLE = ["root", "runner", "viewer", "inputter", "locker", "approver1", "approver2", "payer", "plainAdmin", "rep", "other", "author", "checker"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], viewer: ["view"], inputter: ["inputs"], locker: ["lock", "submit"], approver1: ["approve"], approver2: ["approve"], payer: ["pay"] };
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k.toLowerCase()}@example.test`, name: k, isActive: true, isAdmin: k !== "rep" && k !== "other", departmentId: null, role: "both" };
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
let WF = "";
let AUTO = "";
let customer = "";
let batch = "";
const docId = async (no: string) => (await one<{ id: string }>(`select id from tally_documents where document_no = $1`, [no])).id;
const rv = async (program: string, month: string) => Number((await one<{ row_version: number }>(`select row_version from incentive_calc_periods where program_id = $1 and month = $2`, [program, month])).row_version);
const results = async (program: string, month: string) => q1<{ employee_id: string; earned_paise: string; payable_paise: string }>(`select r.employee_id, r.earned_paise::text, r.payable_paise::text from incentive_calc_results r join incentive_calc_periods p on p.current_run_id = r.run_id where p.program_id = $1 and p.month = $2`, [program, month]);

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
    const n = i + 1;
    const order = await doc("sales-orders", `SO ${n}`, "2026-04-05", L(10), { lines: [{ item: "Drive", quantity: 1, ratePaise: L(10), amountPaise: L(10) }] });
    const inv = await doc("sales-invoices", `INV ${n}`, "2026-04-05", L(10), { ref: order, due: "2026-04-05" });
    for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `RC ${n}.${k + 1}`, day(days), Math.round(L(10) * fraction), { ref: inv });
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
  const pub = await rules.publish(checker, d.versionId, ap.rowVersion, "2026-04-01", { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
  return p.programId;
}
const nextMonthStart = (d: string) => {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

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
  for (const k of PEOPLE) who[k] = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k.toLowerCase()}@example.test`, k !== "rep" && k !== "other"])).id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.calc.${r}`, who[k as Who]]);

  const cust = (await one<{ id: string }>(`insert into customers (name) values ('Tracker Customer') returning id`)).id;
  const order = (await one<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, 100000000, 'A', '2026-04-05', true) returning id`, [cust, who.rep])).id;
  await pg.query(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days) values ($1, 100000000, '2026-04-05', 30)`, [order]);
  const paid = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-04', 'paid') returning id`)).id;
  await pg.query(`insert into payout_runs (period_id, total_paise) values ($1, 900000)`, [paid]);
  trackerBefore = await fingerprint(TRACKER);

  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await pg.exec(readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8"));
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0133_incentive_category_a_inputs_approvals.sql"), "utf8")); // safe to re-run

  customer = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Customer One', $1, 30) returning id`, [who.rep])).id;
  batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`)).id;
  await aprilForms(EXAMPLE_2);
  formsBefore = await fingerprint(["tally_documents", "customer_masters"]);

  calcAct = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  inputAct = await import("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions");
  rules = await import("@/lib/queries/incentive-rules");
  WF = await program("WF", { "attribution.source": "orderSalesperson", "payout.approvalSteps": 2, "payout.release": "withPayrollMonth", "adjust.negativeBalance": "carryForwardMonths", "adjust.carryForwardMonths": 1, "adjust.windowDays": 365 });
  AUTO = await program("AUTO", { "period.lockMode": "autoAfterDays", "period.autoLockDays": 5 });
}, 180_000);
afterAll(async () => {
  await pg.close();
});

describe("migration 0133", () => {
  it("adds four tables with row-level security and no REST access, re-runs safely", async () => {
    const t = await q1<{ relname: string; rls: boolean }>(`select relname, relrowsecurity rls from pg_class where relname in ('incentive_calc_input_history', 'incentive_calc_approvals', 'incentive_calc_payouts', 'incentive_calc_payout_lines') and relkind = 'r' order by 1`);
    expect(t).toEqual([
      { relname: "incentive_calc_approvals", rls: true },
      { relname: "incentive_calc_input_history", rls: true },
      { relname: "incentive_calc_payout_lines", rls: true },
      { relname: "incentive_calc_payouts", rls: true },
    ]);
    expect(await fingerprint(TRACKER)).toEqual(trackerBefore);
  });
});

describe("order salespeople", () => {
  it("before any is recorded, every order is listed as needing one and nobody is credited", async () => {
    signIn("runner");
    const r = await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-30" });
    expect(r).toMatchObject({ ok: true, status: "computed" });
    const run = await one<{ result: { employees: unknown[]; excluded: { message: string }[]; held: { message: string }[] } }>(`select result from incentive_calc_runs where program_id = $1 order by computed_at desc limit 1`, [WF]);
    expect(run.result.employees).toEqual([]);
    // category-a/2: an order nobody is credited with because something is missing is HELD (it holds the month).
    expect(run.result.held).toHaveLength(12);
    expect(run.result.held[0]!.message).toMatch(/No salesperson is recorded for this order/);
  });
  it("only holders of the inputs permission record them", async () => {
    for (const k of ["viewer", "runner", "plainAdmin", "rep"] as const) {
      signIn(k);
      await expect(inputAct.recordOrderSalesperson({ documentId: await docId("SO 1"), employeeId: who.rep, sharePpm: 1_000_000, note: null })).rejects.toThrow("Forbidden");
    }
  });
  it("checks eligibility and one-salesperson-per-order against the published configuration", async () => {
    signIn("inputter");
    expect(await inputAct.recordOrderSalesperson({ documentId: await docId("SO 1"), employeeId: who.other, sharePpm: 1_000_000, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/other isn't included in Salesperson Eligibility/) });
    expect(await inputAct.recordOrderSalesperson({ documentId: await docId("SO 1"), employeeId: who.rep, sharePpm: 500_000, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/one salesperson per order/) });
    expect(await inputAct.recordOrderSalesperson({ documentId: await docId("INV 1"), employeeId: who.rep, sharePpm: 1_000_000, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a Forms Sales Order/) });
    for (let n = 1; n <= 12; n++) expect(await inputAct.recordOrderSalesperson({ documentId: await docId(`SO ${n}`), employeeId: who.rep, sharePpm: 1_000_000, note: n === 1 ? "From the order form" : null })).toMatchObject({ ok: true });
    expect(await inputAct.recordOrderSalesperson({ documentId: await docId("SO 1"), employeeId: who.rep, sharePpm: 1_000_000, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });
    expect(await count(`select count(*)::int n from incentive_calc_input_history where entity = 'attribution' and action = 'record'`)).toBe(12);
  });
  it("the database refuses editing, deleting, a duplicate or more than 100%", async () => {
    const a = await one<{ id: string; document_id: string }>(`select id, document_id from incentive_calc_attributions limit 1`);
    await expect(pg.query(`update incentive_calc_attributions set share_ppm = 500000 where id = $1`, [a.id])).rejects.toThrow(/never changes; retire it/);
    await expect(pg.query(`delete from incentive_calc_attributions where id = $1`, [a.id])).rejects.toThrow(/never deleted/);
    await expect(pg.query(`insert into incentive_calc_attributions (document_id, employee_id, share_ppm) values ($1, $2, 1000000)`, [a.document_id, who.rep])).rejects.toThrow(/more than 100%|duplicate key/);
    await expect(pg.query(`insert into incentive_calc_attributions (document_id, employee_id, share_ppm) values ($1, $2, 1)`, [a.document_id, who.other])).rejects.toThrow(/more than 100%/);
  });
  it("retiring keeps the old record and its history; a new one can then be recorded", async () => {
    signIn("inputter");
    const a = await one<{ id: string }>(`select a.id from incentive_calc_attributions a join tally_documents d on d.id = a.document_id where d.document_no = 'SO 12'`);
    expect(await inputAct.retireIncentiveInput({ entity: "attribution", id: a.id, reason: "" })).toMatchObject({ ok: false });
    expect(await inputAct.retireIncentiveInput({ entity: "attribution", id: a.id, reason: "Entered against the wrong order" })).toMatchObject({ ok: true });
    expect(await inputAct.retireIncentiveInput({ entity: "attribution", id: a.id, reason: "again" })).toMatchObject({ ok: false, error: expect.stringMatching(/already retired/) });
    expect(await inputAct.recordOrderSalesperson({ documentId: await docId("SO 12"), employeeId: who.rep, sharePpm: 1_000_000, note: "Re-entered" })).toMatchObject({ ok: true });
    expect(await count(`select count(*)::int n from incentive_calc_attributions a join tally_documents d on d.id = a.document_id where d.document_no = 'SO 12'`)).toBe(2);
    expect(await q1(`select action, note from incentive_calc_input_history where entity_id = $1 order by event_no`, [a.id])).toEqual([{ action: "record", note: null }, { action: "retire", note: "Entered against the wrong order" }]);
  });
  it("the calculation reads them: ₹925.00 for April example 2, credited to the recorded salesperson", async () => {
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: true });
    expect(await results(WF, "2026-04-01")).toEqual([{ employee_id: who.rep, earned_paise: "92500", payable_paise: "92500" }]);
  });
});

describe("representative periods", () => {
  it("never overlap for one customer; a retired one stays as history", async () => {
    signIn("inputter");
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.rep, from: "2026-01-01", to: null, note: null })).toMatchObject({ ok: true });
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.other, from: "2026-06-01", to: null, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/already has a representative/) });
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.other, from: "2026-06-01", to: "2026-05-01", note: null })).toMatchObject({ ok: false });
    const r = await one<{ id: string }>(`select id from incentive_calc_rep_history where customer_master_id = $1`, [customer]);
    expect(await inputAct.retireIncentiveInput({ entity: "rep-history", id: r.id, reason: "Split at the handover" })).toMatchObject({ ok: true });
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.rep, from: "2026-01-01", to: "2026-05-31", note: null })).toMatchObject({ ok: true });
    expect(await inputAct.recordRepresentativePeriod({ customerId: customer, employeeId: who.other, from: "2026-06-01", to: null, note: "Handover" })).toMatchObject({ ok: true });
    expect(await count(`select count(*)::int n from incentive_calc_rep_history where customer_master_id = $1`, [customer])).toBe(3);
  });
});

describe("receipt events", () => {
  it("the database refuses the wrong document, more than the receipt, or a second marking", async () => {
    signIn("inputter");
    const rc = await docId("RC 4.1");
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "refund", invoiceId: null, amountPaise: L(11), eventDate: "2026-06-01", note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/refunds would exceed/) });
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "salesReturn", invoiceId: null, amountPaise: null, eventDate: "2026-06-01", note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/Credit Note/) });
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "allocation", invoiceId: await docId("SO 1"), amountPaise: L(1), eventDate: "2026-06-01", note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/Sales Invoice/) });
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "hold", invoiceId: null, amountPaise: null, eventDate: "2026-06-01", note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/Say why/) });
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "hold", invoiceId: null, amountPaise: null, eventDate: "2026-06-01", note: "Customer disputes the amount" })).toMatchObject({ ok: true });
    expect(await inputAct.recordReceiptEvent({ documentId: rc, kind: "hold", invoiceId: null, amountPaise: null, eventDate: "2026-06-02", note: "again" })).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });
  });
  it("a hold takes the receipt out until it is retired; the calculation follows", async () => {
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: true });
    // SO 4 (₹166.67 at 100%) is held: 925.00 − 166.67.
    expect((await results(WF, "2026-04-01"))[0]).toMatchObject({ earned_paise: "75833" });
    signIn("inputter");
    const hold = await one<{ id: string }>(`select id from incentive_calc_receipt_events where kind = 'hold' and retired_at is null`);
    // Released on 15 September: a calculation as of a later day no longer sees it (as of an earlier one it would).
    expect(await onDay("2026-09-15", () => inputAct.retireIncentiveInput({ entity: "receipt-event", id: hold.id, reason: "Dispute resolved" }))).toMatchObject({ ok: true });
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: true });
    expect((await results(WF, "2026-04-01"))[0]).toMatchObject({ earned_paise: "92500", payable_paise: "92500" });
  });
});

describe("approval and payout", () => {
  it("a month is submitted only when locked, and only by holders of the submit permission", async () => {
    signIn("locker");
    expect(await calcAct.submitCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01") })).toMatchObject({ ok: false, error: expect.stringMatching(/Only a locked month/) });
    expect(await calcAct.setCategoryAMonthLocked({ programId: WF, month: "2026-04-01", lock: true, rowVersion: await rv(WF, "2026-04-01") })).toMatchObject({ ok: true });
    signIn("approver1");
    await expect(calcAct.submitCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01") })).rejects.toThrow("Forbidden");
    signIn("locker");
    expect(await calcAct.submitCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01") })).toMatchObject({ ok: true, approvalsRequired: 2 });
  });
  it("whoever recorded an input the month's calculation uses (here: its order salespeople) never approves or rejects it — even holding Approve", async () => {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('incentive.calc.approve', 'employee', $1, true)`, [who.inputter]);
    signIn("inputter");
    for (const decision of ["approve", "reject"] as const)
      expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision, reason: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/You recorded or retired an order's salespeople used by this month's calculation, so you can't approve or reject it/) });
    expect(await count(`select count(*)::int n from incentive_calc_approvals`)).toBe(0);
    await pg.query(`update field_permission_grants set allowed = false where subject_id = $1 and field_key = 'incentive.calc.approve'`, [who.inputter]);
  });
  it("needs different approvers, never the submitter; a rejection with its reason returns it to locked", async () => {
    // The database refuses the submitter whatever calls it.
    const p = await one<{ id: string; current_run_id: string; submission_no: number }>(`select id, current_run_id, submission_no from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [WF]);
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, 'locker')`, [p.id, p.current_run_id, p.submission_no, who.locker])).rejects.toThrow(/submitted a month never approves/);
    signIn("payer");
    await expect(calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "approve", reason: null })).rejects.toThrow("Forbidden");
    signIn("approver1");
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "submitted", step: 1 });
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "approve", reason: null })).toMatchObject({ ok: false, error: expect.stringMatching(/needs someone else/) });
    signIn("approver2");
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "reject", reason: "" })).toMatchObject({ ok: false });
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "reject", reason: "Check SO 4's receipt first" })).toMatchObject({ ok: true, status: "locked" });
    expect(await q1(`select submission_no, step_no, decision, reason from incentive_calc_approvals order by submission_no, step_no`)).toEqual([
      { submission_no: 1, step_no: 1, decision: "approve", reason: null },
      { submission_no: 1, step_no: 2, decision: "reject", reason: "Check SO 4's receipt first" },
    ]);
  });
  it("resubmitted, approved by two people, released as configured, paid once with its reference", async () => {
    signIn("locker");
    expect(await calcAct.submitCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01") })).toMatchObject({ ok: true });
    signIn("approver2");
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "submitted" });
    signIn("approver1");
    // A screen that read the month before the first approval can't act on it.
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: (await rv(WF, "2026-04-01")) - 1, decision: "approve", reason: null })).toMatchObject({ ok: false, error: expect.stringMatching(/changed by someone else/) });
    expect(await calcAct.decideCategoryAMonth({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), decision: "approve", reason: "Checked" })).toMatchObject({ ok: true, status: "approved" });
    const release = (await one<{ r: string }>(`select release_on::text r from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [WF])).r;
    expect(release).toBe(nextMonthStart(todayIST())); // "with the next payroll month"
    // Released with the next payroll month: a payout can be recorded only once that day has come. Move the clock there.
    expect(await (async () => { signIn("payer"); return calcAct.recordCategoryAPayout({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), reference: "EARLY", paidOn: todayIST(), amountPaise: 92500, note: null }); })()).toMatchObject({ ok: false, error: expect.stringMatching(/can't be dated before/) });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${release}T06:30:00Z`) });
    signIn("approver1");
    await expect(calcAct.recordCategoryAPayout({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), reference: "X", paidOn: release, amountPaise: 92500, note: null })).rejects.toThrow("Forbidden");
    signIn("payer");
    expect(await calcAct.recordCategoryAPayout({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), reference: "PAY-APR", paidOn: "2026-01-01", amountPaise: 92500, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/can't be dated before/) });
    expect(await calcAct.recordCategoryAPayout({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), reference: "PAY-APR", paidOn: release, amountPaise: 92500, note: "Bank batch 12" })).toMatchObject({ ok: true, totalPaise: 92500 });
    expect(await q1(`select employee_id, payable_paise::int p, adjustments_paise::int a, amount_paise::int amt from incentive_calc_payout_lines`)).toEqual([{ employee_id: who.rep, p: 92500, a: 0, amt: 92500 }]);
    expect(await calcAct.recordCategoryAPayout({ programId: WF, month: "2026-04-01", rowVersion: await rv(WF, "2026-04-01"), reference: "PAY-APR-2", paidOn: release, amountPaise: 92500, note: null })).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });
    vi.useRealTimers();
    const p = await one<{ id: string; current_run_id: string }>(`select id, current_run_id from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [WF]);
    await expect(pg.query(`insert into incentive_calc_payouts (period_id, run_id, reference, release_on, paid_on, total_paise, recorded_by_name) values ($1, $2, 'DUP', current_date, current_date, 1, 'x')`, [p.id, p.current_run_id])).rejects.toThrow(/Only an approved month|duplicate key/);
    await expect(pg.query(`update incentive_calc_payouts set reference = 'Y'`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`update incentive_calc_periods set status = 'open', row_version = row_version + 1 where id = $1`, [p.id])).rejects.toThrow(/final/);
    // 2 submissions + 3 approvals + 1 rejection + 1 payout.
    expect(await count(`select count(*)::int n from incentive_audit where action in ('submitted', 'approved', 'rejected', 'paid')`)).toBe(7);
  });
});

describe("the calculation date of a month that is no longer open", () => {
  it("is never earlier than its adopted calculation's (it would take back collections already paid); an impossible or future date is refused", async () => {
    const before = await count(`select count(*)::int n from incentive_calc_runs where program_id = $1 and month = '2026-04-01'`, [WF]);
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/The month is paid and was calculated as of 2026-09-30: it is never recalculated as of an earlier day \(2026-09-01\)/) });
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-31" })).toMatchObject({ ok: false, error: expect.stringMatching(/on or after the month's first day/) });
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2099-01-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/can't be in the future/) });
    expect(await count(`select count(*)::int n from incentive_calc_runs where program_id = $1 and month = '2026-04-01'`, [WF])).toBe(before);
    // The same day as its adopted calculation (or later) is fine: nothing changed, nothing is recorded twice.
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: false });
  });
});

describe("negative balances at lock", () => {
  it("a later refund on a paid month is carried, and a negative month carries forward, then is written off", async () => {
    signIn("inputter");
    expect(await inputAct.recordReceiptEvent({ documentId: await docId("RC 4.1"), kind: "refund", invoiceId: null, amountPaise: L(5), eventDate: "2026-10-01", note: "Partial refund" })).toMatchObject({ ok: true });
    signIn("runner");
    const r = await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-04-01", asOf: "2026-10-05" });
    expect(r).toMatchObject({ ok: true, adopted: false });
    if (r.ok) expect(r.outcome).toMatch(/paid.*carried into 2026-10/);
    expect(await q1(`select kind, amount_paise::int a, to_month::text t from incentive_calc_adjustments where program_id = $1`, [WF])).toEqual([{ kind: "recalc-difference", a: -16667, t: "2026-10-01" }]);
    // October has no orders: its payable is 0, so its total is −₹166.67. Locking carries it into November (1 month).
    expect(await calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-10-01", asOf: "2026-10-31" })).toMatchObject({ ok: true, status: "computed", adopted: true });
    signIn("locker");
    expect(await calcAct.setCategoryAMonthLocked({ programId: WF, month: "2026-10-01", lock: true, rowVersion: await rv(WF, "2026-10-01") })).toMatchObject({ ok: true });
    expect(await q1(`select kind, amount_paise::int a, to_month::text t, months_left m from incentive_calc_adjustments where program_id = $1 and from_month = '2026-10-01'`, [WF])).toEqual([{ kind: "negative-carry", a: -16667, t: "2026-11-01", m: 0 }]);
    signIn("runner");
    expect(await onDay("2026-11-30", () => calcAct.calculateCategoryAMonth({ programId: WF, month: "2026-11-01", asOf: "2026-11-30" }))).toMatchObject({ ok: true, adopted: true });
    // Carried for its one month, the balance is to be written off — a decision about money that a SECOND person approves
    // (D30, migration 0142). Without 0142 nothing can be approved, so the month isn't locked and nothing is written off;
    // the approved path (0142 applied) is in incentive-category-a-completion.db.test.ts.
    signIn("locker");
    expect(await calcAct.setCategoryAMonthLocked({ programId: WF, month: "2026-11-01", lock: true, rowVersion: await rv(WF, "2026-11-01") })).toMatchObject({ ok: false, error: expect.stringMatching(/rep's negative balance of ₹166.67 is to be written off: a second person approves that, which needs database update 0142. Nothing was locked./) });
    expect(await count(`select count(*)::int n from incentive_calc_adjustments where program_id = $1 and from_month = '2026-11-01'`, [WF])).toBe(0);
    expect((await one<{ status: string }>(`select status from incentive_calc_periods where program_id = $1 and month = '2026-11-01'`, [WF])).status).toBe("open");
  });
});

describe("automatic locking", () => {
  it("a month past its automatic lock date locks itself on the next calculation, which is kept but not adopted", async () => {
    signIn("runner");
    expect(await calcAct.calculateCategoryAMonth({ programId: AUTO, month: "2026-04-01", asOf: "2026-09-30" })).toMatchObject({ ok: true, adopted: true });
    expect((await one<{ status: string }>(`select status from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [AUTO])).status).toBe("open");
    signIn("inputter");
    expect(await inputAct.recordReceiptEvent({ documentId: await docId("RC 5.1"), kind: "bounced", invoiceId: null, amountPaise: null, eventDate: "2026-10-01", note: "Returned unpaid by the bank" })).toMatchObject({ ok: true });
    signIn("runner");
    const r = await calcAct.calculateCategoryAMonth({ programId: AUTO, month: "2026-04-01", asOf: "2026-10-01" });
    expect(r).toMatchObject({ ok: true, adopted: false });
    if (r.ok) expect(r.outcome).toMatch(/locked automatically/);
    expect(await one(`select status, locked_by_id from incentive_calc_periods where program_id = $1 and month = '2026-04-01'`, [AUTO])).toEqual({ status: "locked", locked_by_id: null });
  });
});

describe("recalculation differences (Phase 1): carried into the first open month — never dropped, never twice", () => {
  // Each test has its own programme over the same Forms documents, and records ITS OWN refund (dated 2 October) on a
  // receipt no other test marks — so it never depends on an earlier test. Calculated as of 5 October, April includes it
  // (and any other event dated by then), so it differs from its first calculation (as of 30 September); the difference is
  // read from the stored runs, never assumed.
  const APR = "2026-04-01", OCT = "2026-10-01", NOV = "2026-11-01";
  const refundOn = async (receipt: string) => {
    signIn("inputter");
    expect(await inputAct.recordReceiptEvent({ documentId: await docId(receipt), kind: "refund", invoiceId: null, amountPaise: L(2), eventDate: "2026-10-02", note: `Refund on ${receipt} (Phase 1 test)` })).toMatchObject({ ok: true });
  };
  /** Every month from October 2026 to September 2027 — the twelve months a carry looks at — calculated and locked. */
  const closeTwelveMonths = async (program: string) => {
    for (let m = OCT; m <= "2027-09-01"; m = nextMonth(m)) {
      expect(await calcOn(program, m, monthEnd(m)), m).toMatchObject({ ok: true, adopted: true });
      expect(await setLocked(program, m, true), m).toMatchObject({ ok: true });
    }
  };
  const periodOf = async (program: string, month: string) => one<{ id: string; status: string; row_version: number; current_run_id: string | null }>(`select id, status, row_version, current_run_id from incentive_calc_periods where program_id = $1 and month = $2`, [program, month]);
  const differences = (program: string) => q1<{ from: string; to: string; a: number; run: string }>(`select from_month::text "from", to_month::text "to", amount_paise::int a, source_run_id::text run from incentive_calc_adjustments where program_id = $1 and kind = 'recalc-difference' order by created_at`, [program]);
  const latestRun = (program: string, month: string) => one<{ id: string; adopted: boolean }>(`select id::text, adopted from incentive_calc_runs where program_id = $1 and month = $2 order by computed_at desc limit 1`, [program, month]);
  const runCount = async (program: string, month: string) => count(`select count(*)::int n from incentive_calc_runs where program_id = $1 and month = $2`, [program, month]);
  const payable = async (runId: string) => Number((await one<{ p: number }>(`select coalesce(sum(payable_paise), 0)::int p from incentive_calc_results where run_id = $1`, [runId])).p);
  const calcOn = (program: string, month: string, asOf: string) => {
    signIn("runner");
    return onDay(asOf, () => calcAct.calculateCategoryAMonth({ programId: program, month, asOf }));
  };
  const setLocked = async (program: string, month: string, lock: boolean) => {
    signIn("locker");
    return calcAct.setCategoryAMonthLocked({ programId: program, month, lock, rowVersion: await rv(program, month) });
  };

  it("B — the calculation date's month is closed: the difference goes to the first later OPEN month, once; the closed months never change", async () => {
    const P = await program("CARRYB", {});
    await refundOn("RC 6.1");
    expect(await calcOn(P, APR, "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    expect(await setLocked(P, APR, true)).toMatchObject({ ok: true });
    expect(await calcOn(P, OCT, "2026-10-31")).toMatchObject({ ok: true, adopted: true });
    expect(await setLocked(P, OCT, true)).toMatchObject({ ok: true });
    const aprBefore = await periodOf(P, APR);
    const octBefore = await periodOf(P, OCT);
    // Recalculated as of 5 October: October (the candidate) is locked, so the difference goes to November.
    const r = await calcOn(P, APR, "2026-10-05");
    expect(r).toMatchObject({ ok: true, adopted: false, unchanged: false });
    if (r.ok) expect(r.outcome).toMatch(/The difference is carried into 2026-11 \(the first open month from 2026-10\)\./);
    const found = await latestRun(P, APR);
    const diff = (await payable(found.id)) - (await payable(aprBefore.current_run_id!));
    expect(diff).not.toBe(0); // there IS a difference — and it is not dropped:
    expect(await differences(P)).toEqual([{ from: APR, to: NOV, a: diff, run: found.id }]);
    // The locked months are untouched; November (created by the carry) went up once.
    expect(await periodOf(P, APR)).toEqual(aprBefore);
    expect(await periodOf(P, OCT)).toEqual(octBefore);
    expect(await count(`select count(*)::int n from incentive_calc_adjustments where program_id = $1 and to_month = $2`, [P, OCT])).toBe(0);
    expect(await periodOf(P, NOV)).toMatchObject({ status: "open", row_version: 2, current_run_id: null });
    // Again, the same day (unchanged) and a day later (a new run, the same result): nothing is carried twice.
    expect(await calcOn(P, APR, "2026-10-05")).toMatchObject({ ok: true, unchanged: true, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await calcOn(P, APR, "2026-10-06")).toMatchObject({ ok: true, adopted: false });
    expect(await differences(P)).toEqual([{ from: APR, to: NOV, a: diff, run: found.id }]);
    expect((await periodOf(P, NOV)).row_version).toBe(2);
    expect(await periodOf(P, APR)).toEqual(aprBefore);
  });

  it("A — a difference not carried when it was found (no month open) is carried by the next calculation even though nothing changed — once", async () => {
    const P = await program("CARRYA", {});
    await refundOn("RC 7.1");
    expect(await calcOn(P, APR, "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    expect(await setLocked(P, APR, true)).toMatchObject({ ok: true });
    await closeTwelveMonths(P);
    const aprBefore = await periodOf(P, APR);
    // Found as of 5 October: no month is open to take it — it is NOT carried, and the outcome says so (not written off).
    const first = await calcOn(P, APR, "2026-10-05");
    expect(first).toMatchObject({ ok: true, adopted: false, unchanged: false });
    if (first.ok) expect(first.outcome).toMatch(/no month from 2026-10 on is open to take it, so it isn't carried yet/);
    expect(await differences(P)).toEqual([]);
    const found = await latestRun(P, APR);
    const diff = (await payable(found.id)) - (await payable(aprBefore.current_run_id!));
    expect(diff).not.toBe(0);
    // October is reopened. The SAME calculation again — its inputs and result unchanged, so no new run — now carries the
    // pending difference, from the run that found it.
    expect(await setLocked(P, OCT, false)).toMatchObject({ ok: true });
    const octOpen = await periodOf(P, OCT);
    const runs = await runCount(P, APR);
    const second = await calcOn(P, APR, "2026-10-05");
    expect(second).toMatchObject({ ok: true, unchanged: true, runId: found.id, adopted: false });
    if (second.ok) expect(second.outcome).toMatch(/The difference is carried into 2026-10/);
    expect(await runCount(P, APR)).toBe(runs);
    expect(await differences(P)).toEqual([{ from: APR, to: OCT, a: diff, run: found.id }]);
    expect(await periodOf(P, OCT)).toMatchObject({ status: "open", row_version: octOpen.row_version + 1 });
    expect(await periodOf(P, APR)).toEqual(aprBefore);
    expect(await count(`select count(*)::int n from incentive_audit where action = 'carried-difference' and entity_id = $1`, [aprBefore.id])).toBe(1);
    // Once more: already carried — nothing more, nothing changed.
    expect(await calcOn(P, APR, "2026-10-05")).toMatchObject({ ok: true, unchanged: true, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await differences(P)).toEqual([{ from: APR, to: OCT, a: diff, run: found.id }]);
    expect((await periodOf(P, OCT)).row_version).toBe(octOpen.row_version + 1);
    expect(await periodOf(P, APR)).toEqual(aprBefore);
  });

  it("A2 — the retry's INPUTS differ (a later calculation date) but its RESULT is the same: no new run, the pending difference is carried — once", async () => {
    const P = await program("CARRYR", {});
    await refundOn("RC 8.1");
    expect(await calcOn(P, APR, "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    expect(await setLocked(P, APR, true)).toMatchObject({ ok: true });
    await closeTwelveMonths(P);
    const aprBefore = await periodOf(P, APR);
    const first = await calcOn(P, APR, "2026-10-05");
    expect(first).toMatchObject({ ok: true, adopted: false, unchanged: false });
    if (first.ok) expect(first.outcome).toMatch(/isn't carried yet/);
    expect(await differences(P)).toEqual([]);
    const found = await latestRun(P, APR);
    const diff = (await payable(found.id)) - (await payable(aprBefore.current_run_id!));
    expect(diff).not.toBe(0);
    expect(await setLocked(P, OCT, false)).toMatchObject({ ok: true });
    const octOpen = await periodOf(P, OCT);
    const runs = await runCount(P, APR);
    // As of 6 October — inputs that differ from the run that found the difference (its date) — with the same result:
    // recognised as unchanged by its RESULT, so no new run; the pending difference is carried from the run that found it.
    const retry = await calcOn(P, APR, "2026-10-06");
    expect(retry).toMatchObject({ ok: true, unchanged: true, runId: found.id, adopted: false });
    if (retry.ok) expect(retry.outcome).toMatch(/The difference is carried into 2026-10/);
    expect((await one<{ a: string }>(`select as_of::text a from incentive_calc_runs where id = $1`, [found.id])).a).toBe("2026-10-05"); // the inputs really differed
    expect(await runCount(P, APR)).toBe(runs);
    expect(await differences(P)).toEqual([{ from: APR, to: OCT, a: diff, run: found.id }]);
    expect(await periodOf(P, OCT)).toMatchObject({ status: "open", row_version: octOpen.row_version + 1 });
    expect(await periodOf(P, APR)).toEqual(aprBefore);
    // Once more, a day later still: already carried — nothing more.
    expect(await calcOn(P, APR, "2026-10-07")).toMatchObject({ ok: true, unchanged: true, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await differences(P)).toEqual([{ from: APR, to: OCT, a: diff, run: found.id }]);
    expect((await periodOf(P, OCT)).row_version).toBe(octOpen.row_version + 1);
  });

  it("REOPEN REQUIRED — a difference found while the month is locked isn't carried; reopened the SAME day, the month's recalculation is adopted (not held back by the run that found it), and nothing is carried", async () => {
    const P = await program("REOPEN", { "period.lateReceipts": "reopenRequired" });
    await refundOn("RC 9.1");
    expect(await calcOn(P, APR, "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    expect(await setLocked(P, APR, true)).toMatchObject({ ok: true });
    const adopted = (await periodOf(P, APR)).current_run_id!;
    // Found as of 5 October while locked: kept for the record, not adopted, not carried — the month must be reopened.
    const found = await calcOn(P, APR, "2026-10-05");
    expect(found).toMatchObject({ ok: true, adopted: false, unchanged: false });
    if (found.ok) expect(found.outcome).toMatch(/It differs; reopen the month to take the difference/);
    const foundRun = await latestRun(P, APR);
    expect((await payable(foundRun.id)) - (await payable(adopted))).not.toBe(0);
    expect(await differences(P)).toEqual([]);
    // Reopened the same day, as the outcome says, and recalculated with the same inputs: a new run is recorded and adopted.
    expect(await setLocked(P, APR, false)).toMatchObject({ ok: true });
    const before = await runCount(P, APR);
    expect(await calcOn(P, APR, "2026-10-05")).toMatchObject({ ok: true, unchanged: false, adopted: true });
    const now = await periodOf(P, APR);
    expect(now.status).toBe("open");
    expect([now.current_run_id === adopted, now.current_run_id === foundRun.id]).toEqual([false, false]);
    expect(await runCount(P, APR)).toBe(before + 1);
    expect(await payable(now.current_run_id!)).toBe(await payable(foundRun.id)); // the difference is taken in the month itself
    expect(await differences(P)).toEqual([]); // … never carried
    // A repeat now short-circuits against the adopted run.
    expect(await calcOn(P, APR, "2026-10-05")).toMatchObject({ ok: true, unchanged: true, runId: now.current_run_id, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await runCount(P, APR)).toBe(before + 1);
  });
});

describe("nothing else is touched", () => {
  it("Forms' documents and the live Incentive Tracker are exactly as they were", async () => {
    expect(await fingerprint(TRACKER)).toEqual(trackerBefore);
    expect(await fingerprint(["tally_documents", "customer_masters"])).toEqual(formsBefore);
  });
});
