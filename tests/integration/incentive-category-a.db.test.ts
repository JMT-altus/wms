import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running migrations 0131 and 0132's own SQL) for the Category A calculation:
// it reads Forms' documents and the published configuration, records every run with its version and hashes, adopts
// only while a month is open, never changes a locked or paid month, carries a difference once, and leaves Forms and
// the live Incentive Tracker untouched. Invented data only; only the session is mocked.
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
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import { resultHash } from "@/lib/incentives/category-a/hash";
import type { CategoryAInput } from "@/lib/incentives/category-a/types";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let rules: typeof import("@/lib/queries/incentive-rules");
const PEOPLE = ["root", "runner", "viewer", "locker", "plainAdmin", "staff", "rep", "author", "checker", "approver1", "approver2", "payer"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], viewer: ["view"], locker: ["lock", "submit"], approver1: ["approve"], approver2: ["approve"], payer: ["pay"] };
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k.toLowerCase()}@example.test`, name: k, isActive: true, isAdmin: k !== "staff" && k !== "rep", departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const count = async (sql: string, params: unknown[] = []) => Number((await q1<{ n: number }>(sql, params))[0]!.n);
const fingerprint = async (tables: string[]) => {
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await q1<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as f from ${t} t`))[0]!.f;
  return out;
};
const TRACKER = ["customers", "sales_orders", "invoices", "receipts", "incentive_periods", "incentive_ledger", "payout_runs"];
let trackerBefore: Record<string, string> = {};
let formsBefore: Record<string, string> = {};
let programId = "";
let customer = "";
let batch = "";
const receiptIds: string[] = [];

async function doc(type: string, no: string, date: string, total: number, extra: Record<string, unknown> = {}) {
  const r = await q1<{ id: string }>(
    `insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row)
     values ($1, $2, $3, $4, $5, '2026-27', 'Customer One', 'customer one', $6, $7, $7, $8, $9, $10, $11, 1) returning id`,
    [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, total, extra.ref ?? null, extra.due ?? null, JSON.stringify(extra.lines ?? []), batch],
  );
  return r[0]!.id;
}
const day = (days: number) => new Date(Date.parse("2026-04-05T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
async function formsOrders(month: "04" | "05", payments: Pay[][]) {
  for (const [i, pays] of payments.entries()) {
    const n = `${month}-${i + 1}`;
    const date = `2026-${month}-05`;
    const order = await doc("sales-orders", `SO ${n}`, date, L(10), { lines: [{ item: "Drive", quantity: 1, ratePaise: L(10), amountPaise: L(10) }] });
    const inv = await doc("sales-invoices", `INV ${n}`, date, L(10), { ref: order, due: date });
    for (const [k, [fraction, days]] of pays.entries()) receiptIds.push(await doc("customer-receipts", `RC ${n}.${k + 1}`, month === "04" ? day(days) : new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10), Math.round(L(10) * fraction), { ref: inv }));
  }
}
async function publishVersion(config: ReturnType<typeof aprilConfig>, from: string) {
  const author = { id: who.author, name: "author" }, checker = { id: who.checker, name: "checker" };
  const d = await rules.createDraft(author, { programId, category: "A", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(author, d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(author, d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(checker, d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(checker, d.versionId, ap.rowVersion, from, { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
  return d.versionId;
}
const forRep = (c: ReturnType<typeof aprilConfig>) => ({ ...c, eligibility: [{ subjectType: "employee" as const, subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include" as const, effectiveFrom: "2026-01-01", effectiveTo: null }] });
let v1 = "";
let v2 = "";

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
  for (const k of PEOPLE) who[k] = (await q1<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k.toLowerCase()}@example.test`, k !== "staff" && k !== "rep"]))[0]!.id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.calc.${r}`, who[k as Who]]);

  // The live tracker's records, with a paid period: they must never change. The paid month precedes the April
  // cut-over: a Category A version is never published over a month the old engine already paid.
  const cust = (await q1<{ id: string }>(`insert into customers (name) values ('Tracker Customer') returning id`))[0]!.id;
  const order = (await q1<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, 100000000, 'A', '2026-04-05', true) returning id`, [cust, who.rep]))[0]!.id;
  await pg.query(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days) values ($1, 100000000, '2026-04-05', 30)`, [order]);
  const paid = (await q1<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-03', 'paid') returning id`))[0]!.id;
  await pg.query(`insert into payout_runs (period_id, total_paise) values ($1, 900000)`, [paid]);
  await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref) values ($1, $2, 'A.1', 'A', 'accrual', 200000, 'slab:A.1')`, [who.rep, paid]);
  trackerBefore = await fingerprint(TRACKER);

  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0131_incentive_rule_config.sql"), "utf8"));
  const M = readFileSync(resolve(__dirname, "../../db/migrations/0132_incentive_category_a_calculation.sql"), "utf8");
  await pg.exec(M);
  await pg.exec(M); // safe to re-run
  // 0133 (inputs, approvals, payouts) completes 0132; the app needs both.
  const M33 = readFileSync(resolve(__dirname, "../../db/migrations/0133_incentive_category_a_inputs_approvals.sql"), "utf8");
  await pg.exec(M33);
  await pg.exec(M33);

  customer = (await q1<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Customer One', $1, 30) returning id`, [who.rep]))[0]!.id;
  batch = (await q1<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`))[0]!.id;
  await formsOrders("04", EXAMPLE_2);
  formsBefore = await fingerprint(["tally_documents", "customer_masters"]);

  act = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  rules = await import("@/lib/queries/incentive-rules");
  const p = await rules.createProgram({ id: who.author, name: "author" }, { code: "SALES", name: "Sales team", description: null });
  if (!p.ok) throw new Error(p.error);
  programId = p.programId;
  v1 = await publishVersion(forRep(aprilConfig()), "2026-04-01");
}, 180_000);
afterAll(async () => {
  await pg.close();
});

describe("migrations 0132 and 0133 themselves", () => {
  it("create thirteen tables (nine + four), all with row-level security, and change nothing that existed", async () => {
    const t = await q1<{ relname: string; rls: boolean }>(`select relname, relrowsecurity as rls from pg_class where relname like 'incentive_calc_%' and relkind = 'r' order by 1`);
    expect(t.map((x) => x.relname)).toEqual(["incentive_calc_adjustments", "incentive_calc_approvals", "incentive_calc_attributions", "incentive_calc_input_history", "incentive_calc_order_credits", "incentive_calc_payout_lines", "incentive_calc_payouts", "incentive_calc_periods", "incentive_calc_receipt_credits", "incentive_calc_receipt_events", "incentive_calc_rep_history", "incentive_calc_results", "incentive_calc_runs"]);
    expect(t.every((x) => x.rls)).toBe(true);
    expect(await fingerprint(TRACKER)).toEqual(trackerBefore);
  });
});

describe("permissions", () => {
  it("only a super-admin or a holder of the calculate permission can calculate", async () => {
    for (const k of ["plainAdmin", "viewer", "locker", "staff"] as const) {
      signIn(k);
      await expect(act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-09-30" })).rejects.toThrow("Forbidden");
    }
    signIn("runner");
    await expect(act.setCategoryAMonthLocked({ programId, month: "2026-04-01", lock: true, rowVersion: 1 })).rejects.toThrow("Forbidden");
    expect(await count(`select count(*)::int n from incentive_calc_runs`)).toBe(0);
  });
});

describe("calculating April from Forms", () => {
  it("reproduces ₹925.00 from Forms' orders, invoices and receipts, and records the version used", async () => {
    signIn("runner");
    const r = await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-09-30" });
    expect(r).toMatchObject({ ok: true, status: "computed", adopted: true, unchanged: false });
    const [run] = await q1<{ id: string; config_version_id: string; config_version_no: number; engine_version: string; adopted: boolean; computed_by_name: string }>(`select * from incentive_calc_runs`);
    expect(run).toMatchObject({ config_version_id: v1, config_version_no: 1, engine_version: "category-a/1", adopted: true, computed_by_name: "runner" });
    const [res] = await q1(`select employee_id, earned_paise::text, payable_paise::text, sales_paise::text from incentive_calc_results where run_id = $1`, [run!.id]);
    expect(res).toMatchObject({ employee_id: who.rep, earned_paise: "92500", payable_paise: "92500", sales_paise: String(L(120)) });
    expect(await count(`select count(*)::int n from incentive_calc_order_credits where run_id = $1`, [run!.id])).toBe(12);
    expect(await count(`select count(*)::int n from incentive_calc_receipt_credits where run_id = $1 and status = 'credited'`, [run!.id])).toBe(receiptIds.length);
    expect((await q1<{ current_run_id: string; status: string }>(`select * from incentive_calc_periods where month = '2026-04-01'`))[0]).toMatchObject({ current_run_id: run!.id, status: "open" });
    expect(await count(`select count(*)::int n from incentive_audit where action = 'calculated'`)).toBe(1);
  });
  it("is reproducible: the stored inputs give the stored result again", async () => {
    const [run] = await q1<{ inputs: CategoryAInput; result_hash: string }>(`select inputs, result_hash from incentive_calc_runs order by computed_at limit 1`);
    expect(resultHash(calculateCategoryA(run!.inputs))).toBe(run!.result_hash);
  });
  it("calculating again with nothing changed records nothing twice", async () => {
    signIn("root");
    const r = await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-09-30" });
    expect(r).toMatchObject({ ok: true, unchanged: true });
    expect(await count(`select count(*)::int n from incentive_calc_runs`)).toBe(1);
  });
  it("the database refuses a second credit of the same receipt part in one run", async () => {
    const [p] = await q1<Record<string, unknown>>(`select * from incentive_calc_receipt_credits where status = 'credited' limit 1`);
    await expect(pg.query(`insert into incentive_calc_receipt_credits (run_id, employee_id, receipt_document_id, invoice_document_id, unit_document_id, receipt_no, receipt_date, amount_paise, earned_exact, status, note) values ($1, $2, $3, $4, $5, 'x', '2026-04-10', 1, '0', 'credited', 'dup')`, [p!.run_id, p!.employee_id, p!.receipt_document_id, p!.invoice_document_id, p!.unit_document_id])).rejects.toThrow(/duplicate key/);
  });
  it("runs and their results are append-only", async () => {
    await expect(pg.query(`update incentive_calc_runs set outcome = 'changed'`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`delete from incentive_calc_results`)).rejects.toThrow(/append-only/);
  });
});

describe("missing configuration and effective dates", () => {
  it("a month with no published version is blocked with the reason and nothing is adopted", async () => {
    signIn("runner");
    const r = await act.calculateCategoryAMonth({ programId, month: "2026-03-01", asOf: "2026-04-30" });
    expect(r).toMatchObject({ ok: true, status: "blocked", adopted: false });
    if (r.ok) expect(r.problems.join(" ")).toMatch(/No published Category A/);
    expect((await q1<{ current_run_id: string | null }>(`select current_run_id from incentive_calc_periods where month = '2026-03-01'`))[0]!.current_run_id).toBeNull();
  });
  it("a version published from May applies to May only; April keeps version 1", async () => {
    v2 = await publishVersion(forRep(aprilConfig({ "eligibility.threshold": L(150) })), "2026-05-01");
    await formsOrders("05", Array(12).fill([[1, 5]]));
    signIn("runner");
    const may = await act.calculateCategoryAMonth({ programId, month: "2026-05-01", asOf: "2026-09-30" });
    expect(may).toMatchObject({ ok: true, status: "computed" });
    const [run] = await q1<{ config_version_id: string; id: string }>(`select id, config_version_id from incentive_calc_runs where month = '2026-05-01'`);
    expect(run!.config_version_id).toBe(v2);
    expect((await q1(`select qualified, payable_paise::text from incentive_calc_results where run_id = $1`, [run!.id]))[0]).toMatchObject({ qualified: false, payable_paise: "0" });
    const april = await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-09-30" });
    expect(april).toMatchObject({ ok: true, unchanged: true });
  });
});

describe("locked and paid months", () => {
  it("a locked month is never changed: a refund later is kept for the record and its difference carried once", async () => {
    const period = (await q1<{ row_version: number; current_run_id: string }>(`select row_version, current_run_id from incentive_calc_periods where month = '2026-04-01'`))[0]!;
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: "2026-04-01", lock: true, rowVersion: period.row_version })).toMatchObject({ ok: true });
    // SO 04-4 (paid in full, on time) is refunded half after the lock.
    const so4 = (await q1<{ id: string }>(`select id from tally_documents where document_no = 'RC 04-4.1'`))[0]!.id;
    await pg.query(`insert into incentive_calc_receipt_events (document_id, kind, amount_paise, event_date) values ($1, 'refund', $2, '2026-10-01')`, [so4, L(5)]);
    signIn("runner");
    const r = await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-10-05" });
    expect(r).toMatchObject({ ok: true, status: "computed", adopted: false });
    if (r.ok) expect(r.outcome).toMatch(/locked.*carried into 2026-10/);
    expect((await q1<{ current_run_id: string; status: string }>(`select current_run_id, status from incentive_calc_periods where month = '2026-04-01'`))[0]).toMatchObject({ current_run_id: period.current_run_id, status: "locked" });
    // The refund leaves SO 04-4 half collected, so (payable only once fully collected) its whole ₹166.67 stops being
    // payable: payable 925.00 → 758.33, a difference of −₹166.67 carried into the open month.
    expect(await q1(`select kind, amount_paise::int as amount, to_month::text from incentive_calc_adjustments`)).toEqual([{ kind: "recalc-difference", amount: -16667, to_month: "2026-10-01" }]);
    // Again, a day later: the same figures — nothing recorded or carried twice.
    const again = await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-10-06" });
    expect(again).toMatchObject({ ok: true, unchanged: true });
    expect(await count(`select count(*)::int n from incentive_calc_adjustments`)).toBe(1);
  });
  it("an approved or paid month never changes, whatever writes to it", async () => {
    // Straight from locked to approved is refused: it must be submitted and approved.
    await expect(pg.query(`update incentive_calc_periods set status = 'approved', approved_at = now(), release_on = current_date, row_version = row_version + 1 where month = '2026-04-01'`)).rejects.toThrow(/can.t move from locked to approved|approvals/);
    const rv = async () => (await q1<{ row_version: number }>(`select row_version from incentive_calc_periods where month = '2026-04-01'`))[0]!.row_version;
    signIn("locker");
    expect(await act.submitCategoryAMonth({ programId, month: "2026-04-01", rowVersion: await rv() })).toMatchObject({ ok: true, approvalsRequired: 2 });
    signIn("approver1");
    const step1 = await act.decideCategoryAMonth({ programId, month: "2026-04-01", rowVersion: await rv(), decision: "approve", reason: null });
    expect(step1, JSON.stringify(step1)).toMatchObject({ ok: true, status: "submitted" });
    signIn("approver2");
    expect(await act.decideCategoryAMonth({ programId, month: "2026-04-01", rowVersion: await rv(), decision: "approve", reason: null })).toMatchObject({ ok: true, status: "approved" });
    signIn("payer");
    const release = (await q1<{ r: string }>(`select release_on::text r from incentive_calc_periods where month = '2026-04-01'`))[0]!.r;
    expect(await act.recordCategoryAPayout({ programId, month: "2026-04-01", rowVersion: await rv(), reference: "PAY-APR-1", paidOn: release, amountPaise: 92500, note: null })).toMatchObject({ ok: true });
    const other = (await q1<{ id: string }>(`select id from incentive_calc_runs where month = '2026-04-01' and not adopted and status = 'computed' limit 1`))[0]!.id;
    await expect(pg.query(`update incentive_calc_periods set current_run_id = $1, row_version = row_version + 1 where month = '2026-04-01'`, [other])).rejects.toThrow(/paid incentive month is final/);
    await expect(pg.query(`update incentive_calc_periods set status = 'open', row_version = row_version + 1 where month = '2026-04-01'`)).rejects.toThrow(/final/);
    await expect(pg.query(`delete from incentive_calc_periods where month = '2026-04-01'`)).rejects.toThrow(/never deleted/);
    signIn("locker");
    const p = (await q1<{ row_version: number }>(`select row_version from incentive_calc_periods where month = '2026-04-01'`))[0]!;
    expect(await act.setCategoryAMonthLocked({ programId, month: "2026-04-01", lock: false, rowVersion: p.row_version })).toMatchObject({ ok: false, error: expect.stringMatching(/paid month can't be reopened/) });
  });
  it("an open month's adopted run can't be a run of another month", async () => {
    const may = (await q1<{ id: string }>(`select id from incentive_calc_runs where month = '2026-05-01' limit 1`))[0]!.id;
    await expect(pg.query(`update incentive_calc_periods set current_run_id = $1, row_version = row_version + 1 where month = '2026-03-01'`, [may])).rejects.toThrow(/same programme, category and month/);
  });
});

describe("nothing else is touched", () => {
  it("Forms' documents and the live Incentive Tracker are exactly as they were", async () => {
    expect(await fingerprint(TRACKER)).toEqual(trackerBefore);
    const forms = await fingerprint(["customer_masters"]);
    expect(forms.customer_masters).toBe(formsBefore.customer_masters);
    // tally_documents: every April row byte-for-byte as before (May's were added by this test).
    const april = (await q1<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as f from tally_documents t where document_no like '% 04-%'`))[0]!.f;
    expect(april).toBe(formsBefore.tally_documents);
  });
});
