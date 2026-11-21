import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running 0131–0134's own SQL) for Category B end to end: configuration
// (maker-checker, required values, "No limit"), the cut-over safeguard, calculation from Forms, the review queue and
// authorised manual decisions (Field Permissions, separation of duties), lock → submit → two approvals → payout,
// recovery of a credit note after payout in a later month, the shared all-categories limit with Category A, Category A
// leaving Category B orders out when configured, the old engine's cut-over, and a salesperson's own figures.
// SYNTHETIC data only (TEST rate 1%, TEST per-order limit ₹1,500, TEST monthly limit ₹5,000); only the session is mocked.
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
import { bConfig, RS } from "../fixtures/category-b";
import { aprilConfig } from "../fixtures/category-a";
import { calculateCategoryB } from "@/lib/incentives/category-b/engine";
import { resultHashB } from "@/lib/incentives/category-b/hash";
import type { CategoryBInput } from "@/lib/incentives/category-b/types";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
let qualify: typeof import("@/lib/queries/incentive-b-qualify");
let load: typeof import("@/lib/incentives/load");
let incentives: typeof import("@/lib/queries/incentives");
const PEOPLE = ["root", "author", "checker", "runner", "locker", "a1", "a2", "payer", "qualifier", "invReviewer", "viewer", "plainAdmin", "rep", "other"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], locker: ["lock", "submit"], a1: ["approve"], a2: ["approve"], payer: ["pay"], qualifier: ["qualify", "approve"], invReviewer: ["qualify", "approve"], viewer: ["view"] };
const actor = (k: Who) => ({ id: who[k], name: k });
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k !== "rep" && k !== "other", departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q1<T>(sql, params))[0]!;
const fp = async (sql: string) => (await one<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') f from (${sql}) t`)).f;
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8");
const APR = "2026-04-01";
let programId = "";
let customer = "";
let batch = "";
const doc = {} as Record<string, string>;
const product = {} as Record<string, string>;
const rv = async (month = APR, category = "B") => Number((await one<{ row_version: number }>(`select row_version from incentive_calc_periods where month = $1 and category_code = $2`, [month, category])).row_version);

async function tdoc(type: string, no: string, date: string, total: number, extra: { taxable?: number | null; ref?: string; due?: string; lines?: unknown[]; customer?: string | null; party?: string } = {}) {
  const id = (
    await one<{ id: string }>(
      `insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row)
       values ($1, $2, $3, $4, $5, '2026-27', $6, $7, $8, $9, $10, $11, $12, $13, $14, 1) returning id`,
      [`${type}|${no}`, type, no, no.toLowerCase(), date, extra.party ?? "Customer One", (extra.party ?? "Customer One").toLowerCase(), extra.customer === undefined ? customer : extra.customer, total, extra.taxable === undefined ? total : extra.taxable, extra.ref ?? null, extra.due ?? null, JSON.stringify(extra.lines ?? []), batch],
    )
  ).id;
  doc[no] = id;
  return id;
}
const line = (p: string | null, item: string, amount: number) => ({ item, quantity: 1, ratePaise: amount, amountPaise: amount, productId: p });

async function publish(category: "A" | "B", config: ReturnType<typeof bConfig>, from: string) {
  const d = await rules.createDraft(actor("author"), { programId, category, startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  return { versionId: d.versionId, publish: (f = from) => rules.publish(actor("checker"), d.versionId, ap.rowVersion, f, { canBackdate: true }) };
}
const forRep = <T extends { eligibility: unknown[] }>(c: T): T => ({ ...c, eligibility: [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2024-01-01", effectiveTo: null }] });
let julyOld = "";
let julyId = "";

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures,
    products: schema.products, productCategories: schema.productCategories,
    customers: schema.customers, salesOrders: schema.salesOrders, invoices: schema.invoices, receipts: schema.receipts,
    leadBatches: schema.leadBatches, leadConversions: schema.leadConversions, clientMeetings: schema.clientMeetings, testimonials: schema.testimonials,
    incentiveSchemes: schema.incentiveSchemes, ruleVersions: schema.ruleVersions, incentivePeriods: schema.incentivePeriods, incentiveLedger: schema.incentiveLedger, payoutRuns: schema.payoutRuns, incentiveAudit: schema.incentiveAudit,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of PEOPLE) who[k] = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k}@example.test`, k !== "rep" && k !== "other"])).id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.calc.${r}`, who[k as Who]]);

  // The OLD tracker: a PAID July 2026 (its Category B line is added once April's version is published — see the
  // cut-over safeguard) — never to change.
  julyId = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-07', 'paid') returning id`)).id;
  // A paid old-engine row of a category this file never publishes (a Category A row would rightly stop Category A
  // being published from April: no version is ever published over a month the old engine paid for its category).
  await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref) values ($1, $2, 'C.1', 'C', 'accrual', 200000, 'newcust:x')`, [who.rep, julyId]);
  await pg.query(`insert into payout_runs (period_id, total_paise) values ($1, 350000)`, [julyId]);

  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await pg.exec(MIG(f));
  await pg.exec(MIG("0134_incentive_category_b.sql"));
  await pg.exec(MIG("0134_incentive_category_b.sql")); // safe to re-run

  act = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  calc = await import("@/lib/queries/incentive-calc");
  rules = await import("@/lib/queries/incentive-rules");
  qualify = await import("@/lib/queries/incentive-b-qualify");
  load = await import("@/lib/incentives/load");
  incentives = await import("@/lib/queries/incentives");

  customer = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Customer One', $1, 30) returning id`, [who.rep])).id;
  batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`)).id;
  for (const [name, brand] of [["Drive", "Alpha"], ["Motor", "Beta"]] as const) product[name] = (await one<{ id: string }>(`insert into products (name, brand) values ($1, $2) returning id`, [name, brand])).id;
  // Forms: the customer's earlier order (Jun 2025, a Drive), and April 2026.
  await tdoc("sales-orders", "SO H", "2025-06-10", RS(50_000), { lines: [line(product.Drive!, "Drive", RS(50_000))] });
  // SO 1: a Motor (new product and brand) — INV 1 ₹1,20,000 taxable (₹1,41,600), paid in full on time.
  await tdoc("sales-orders", "SO 1", "2026-04-02", RS(1_41_600), { taxable: RS(1_20_000), lines: [line(product.Motor!, "Motor", RS(1_20_000))] });
  await tdoc("sales-invoices", "INV 1", "2026-04-05", RS(1_41_600), { taxable: RS(1_20_000), ref: doc["SO 1"], due: "2026-05-05" });
  await tdoc("customer-receipts", "RC 1", "2026-05-01", RS(1_41_600), { ref: doc["INV 1"] });
  // SO 2: an item not matched to the Product Master — needs review. INV 2 ₹2,00,000 taxable, paid in full on time.
  await tdoc("sales-orders", "SO 2", "2026-04-03", RS(2_36_000), { taxable: RS(2_00_000), lines: [line(null, "Unmatched spare", RS(2_00_000))] });
  await tdoc("sales-invoices", "INV 2", "2026-04-08", RS(2_36_000), { taxable: RS(2_00_000), ref: doc["SO 2"], due: "2026-05-08" });
  await tdoc("customer-receipts", "RC 2", "2026-04-30", RS(2_36_000), { ref: doc["INV 2"] });
  // INV 9: an April invoice naming no Sales Order — review, never ignored.
  await tdoc("sales-invoices", "INV 9", "2026-04-20", RS(1_18_000), { taxable: RS(1_00_000), due: "2026-05-20" });

  const p = await rules.createProgram(actor("author"), { code: "SALES", name: "Sales team", description: null });
  if (!p.ok) throw new Error(p.error);
  programId = p.programId;
}, 240_000);
afterAll(async () => {
  await pg.close();
});

describe("migration 0134", () => {
  it("adds two tables with row-level security, widens the checks, and refuses settings or slabs on the wrong category", async () => {
    const t = await q1<{ relname: string; rls: boolean }>(`select relname, relrowsecurity rls from pg_class where relname like 'incentive_calc_b_%' and relkind = 'r' order by 1`);
    expect(t).toEqual([{ relname: "incentive_calc_b_overrides", rls: true }, { relname: "incentive_calc_b_qualifications", rls: true }]);
    const draftA = await rules.createDraft(actor("author"), { programId, category: "A", startFrom: "blank" });
    if (!draftA.ok) throw new Error(draftA.error);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'b.minAmount', '100'::jsonb)`, [draftA.versionId])).rejects.toThrow(/belongs to Category B versions only/);
    const draftB = await rules.createDraft(actor("author"), { programId, category: "B", startFrom: "blank" });
    if (!draftB.ok) throw new Error(draftB.error);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'slabs.method', '"marginal"'::jsonb)`, [draftB.versionId])).rejects.toThrow(/isn't a Category B setting/);
    await expect(pg.query(`insert into incentive_config_slabs (version_id, position, line_code, label, from_paise, to_paise, value_type, rate_ppm) values ($1, 1, 'B.1', 'x', 0, 100, 'percent', 1)`, [draftB.versionId])).rejects.toThrow(/Only Category A versions have incentive slabs/);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'b.unknown', '1'::jsonb)`, [draftB.versionId])).rejects.toThrow(/key_check/);
    for (const v of [draftA.versionId, draftB.versionId]) {
      const row = await one<{ row_version: number }>(`select row_version from incentive_config_versions where id = $1`, [v]);
      expect(await rules.discard(actor("author"), v, Number(row.row_version))).toMatchObject({ ok: true });
    }
  });
});

describe("configuration: Category B's rate and limits are never assumed", () => {
  it("a draft from the reference template has the confirmed values, and the rate and both limits empty", async () => {
    const d = await rules.createDraft(actor("author"), { programId, category: "B", startFrom: "reference" });
    if (!d.ok) throw new Error(d.error);
    const v = await rules.getVersion(d.versionId);
    expect(v!.config.settings).toMatchObject({ "b.existingLookbackMonths": 24, "b.minAmount": RS(1_00_000), "b.noveltyWindow": "sameAsExisting" });
    for (const k of ["b.ratePpm", "caps.perOrder", "caps.perEmployeeCategoryMonth"]) expect(v!.config.settings[k], k).toBeUndefined();
    expect(v!.config.slabs).toEqual([]);
    const sub = await rules.submit(actor("author"), d.versionId, 1);
    expect(sub.ok).toBe(false);
    if (!sub.ok) for (const label of ["Incentive rate", "Most one Sales Order can earn from Category B", "Most a salesperson can earn from Category B in a month"]) expect(sub.error).toContain(`${label} (`);
    expect(await rules.discard(actor("author"), d.versionId, 1)).toMatchObject({ ok: true });
  });
  it("\"No limit\" is a deliberate value; a missing monthly limit blocks submission", async () => {
    const c = forRep(bConfig({ "caps.perEmployeeCategoryMonth": "none" }));
    const d = await rules.createDraft(actor("author"), { programId, category: "B", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const missing = { ...c, settings: { ...c.settings } };
    delete missing.settings["caps.perEmployeeCategoryMonth"];
    const s1 = await rules.saveDraft(actor("author"), d.versionId, 1, missing, null);
    expect(s1).toMatchObject({ ok: true, missing: 1 });
    expect(await rules.submit(actor("author"), d.versionId, 2)).toMatchObject({ ok: false });
    const s2 = await rules.saveDraft(actor("author"), d.versionId, 2, c, null);
    expect(s2).toMatchObject({ ok: true, missing: 0 });
    expect(await rules.discard(actor("author"), d.versionId, 3)).toMatchObject({ ok: true });
  });
  it("Category B cancelled orders are always left out: a version that doesn't leave them out is refused", async () => {
    const d = await rules.createDraft(actor("author"), { programId, category: "B", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const r = await rules.saveDraft(actor("author"), d.versionId, 1, forRep(bConfig({ "basis.voucherFilter": [] })), null);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled orders are always left out/) });
    expect(await rules.discard(actor("author"), d.versionId, 1)).toMatchObject({ ok: true });
  });
  it("maker-checker publishes the version from April; its configuration hash is recorded", async () => {
    const v = await publish("B", forRep(bConfig({ "payout.approvalSteps": 2, "payout.release": "afterApproval" })), APR);
    expect(await v.publish()).toMatchObject({ ok: true });
    const pubRow = await one<{ after: { configHash: string; status: string } }>(`select after from incentive_config_history where version_id = $1 and action = 'publish'`, [v.versionId]);
    expect(pubRow.after.status).toBe("published");
    expect(pubRow.after.configHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the cut-over safeguard (never pay Category B twice)", () => {
  it("a version over a month the old engine has PAID with Category B is refused; a later month is fine", async () => {
    // The old engine's paid July holds a Category B line (as production's seeded July 2026 does).
    await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref) values ($1, $2, 'B.1', 'B', 'accrual', 150000, 'crosssell:orphan')`, [who.rep, julyId]);
    julyOld = (await fp(`select l.* from incentive_ledger l join incentive_periods p on p.id = l.period_id where p.month = '2026-07'`)) + (await fp(`select * from incentive_periods where month = '2026-07'`)) + (await fp(`select * from payout_runs`));
    const v2 = await publish("B", forRep(bConfig({ "payout.approvalSteps": 2 })), "2026-06-01");
    expect(await v2.publish("2026-06-01")).toMatchObject({ ok: false, error: expect.stringMatching(/old engine's Category B is already paid for 2026-07.*pay Category B twice/) });
    expect(await v2.publish("2026-08-01")).toMatchObject({ ok: true });
  });
});

describe("calculating April from Forms", () => {
  it("SO 1 qualifies (₹1,200.00), SO 2 needs review, INV 9 needs review — each with its reasons", async () => {
    signIn("runner");
    const r = await act.calculateCategoryAMonth({ programId, month: APR, asOf: "2026-05-31", category: "B" });
    expect(r).toMatchObject({ ok: true, status: "computed", adopted: true });
    const quals = await q1<{ order_no: string; outcome: string; automatic_outcome: string; invoice_no: string | null; base_exact: string | null; in_month: boolean; reasons: string[] }>(`select order_no, outcome, automatic_outcome, invoice_no, base_exact, in_month, reasons from incentive_calc_b_qualifications order by order_no`);
    expect(quals.map((x) => [x.order_no, x.outcome, x.invoice_no, x.base_exact, x.in_month])).toEqual([["SO 1", "qualified", "INV 1", String(RS(1_200)), true], ["SO 2", "needs-review", "INV 2", null, false]]);
    expect(quals[1]!.reasons.join(" ")).toMatch(/Not matched to the Product Master: Unmatched spare/);
    const res = await one<{ payable_paise: string; employee_id: string }>(`select payable_paise::text, employee_id from incentive_calc_results r join incentive_calc_runs u on u.id = r.run_id where u.category_code = 'B'`);
    expect(res).toMatchObject({ payable_paise: String(RS(1_200)), employee_id: who.rep });
    const view = await calc.monthView(programId, APR, undefined, "B");
    expect(view.reviewInvoices!.map((x) => x.invoiceNo)).toEqual(["INV 9"]);
    expect(view.qualifications!.length).toBe(2);
  });
  it("the stored run reproduces itself (engine category-b/1)", async () => {
    const run = await one<{ inputs: CategoryBInput; result_hash: string; engine_version: string }>(`select inputs, result_hash, engine_version from incentive_calc_runs where category_code = 'B' order by computed_at limit 1`);
    expect(run.engine_version).toBe("category-b/1");
    expect(resultHashB(calculateCategoryB(run.inputs))).toBe(run.result_hash);
  });
  it("a Category B month is separate from Category A's month of the same programme", async () => {
    expect(await q1(`select category_code from incentive_calc_periods where month = $1 order by 1`, [APR])).toEqual([{ category_code: "B" }]);
  });
});

describe("manual decisions: Field Permissions, reason, history", () => {
  it("only the qualify permission records a decision; the reason is required; one active decision per order", async () => {
    for (const k of ["runner", "viewer", "plainAdmin", "a1"] as const) {
      signIn(k);
      await expect(act.recordCategoryBDecision({ orderId: doc["SO 2"], decision: "qualify", reason: "x" })).rejects.toThrow("Forbidden");
    }
    signIn("rep");
    await expect(act.recordCategoryBDecision({ orderId: doc["SO 2"], decision: "qualify", reason: "x" })).rejects.toThrow("Forbidden");
    signIn("qualifier");
    expect(await act.recordCategoryBDecision({ orderId: doc["SO 2"], decision: "qualify", reason: "  " })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/) });
    expect(await act.recordCategoryBDecision({ orderId: doc["INV 2"], decision: "qualify", reason: "wrong document" })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a Forms Sales Order/) });
    expect(await act.recordCategoryBDecision({ orderId: doc["SO 2"], decision: "qualify", reason: "Spare is a new product line for this customer (checked)" })).toMatchObject({ ok: true });
    expect(await act.recordCategoryBDecision({ orderId: doc["SO 2"], decision: "exclude", reason: "second" })).toMatchObject({ ok: false, error: expect.stringMatching(/already has a decision/) });
    expect(await q1(`select entity, action from incentive_calc_input_history where entity = 'b-override'`)).toEqual([{ entity: "b-override", action: "record" }]);
    await expect(pg.query(`update incentive_calc_b_overrides set reason = 'changed'`)).rejects.toThrow(/never changes/);
    await expect(pg.query(`delete from incentive_calc_b_overrides`)).rejects.toThrow(/never deleted/);
  });
  it("the next calculation applies it, keeping the automatic outcome beside it: ₹1,200 + ₹1,500 (₹2,000 limited) = ₹2,700", async () => {
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: APR, asOf: "2026-05-31", category: "B" })).toMatchObject({ ok: true, adopted: true });
    const q = await one<{ outcome: string; automatic_outcome: string; override_decision: string; base_exact: string }>(`select outcome, automatic_outcome, override_decision, base_exact from incentive_calc_b_qualifications qq join incentive_calc_periods p on p.current_run_id = qq.run_id where qq.order_no = 'SO 2'`);
    expect(q).toMatchObject({ outcome: "qualified", automatic_outcome: "needs-review", override_decision: "qualify", base_exact: String(RS(1_500)) });
    const queue = await qualify.reviewQueue(programId, APR, "all");
    expect(queue.rows.find((r) => r.orderNo === "SO 2")!.override).toMatchObject({ decision: "qualify", byName: "qualifier" });
    const pay = await one<{ p: string }>(`select r.payable_paise::text p from incentive_calc_results r join incentive_calc_periods per on per.current_run_id = r.run_id where per.category_code = 'B'`);
    expect(pay.p).toBe(String(RS(2_700)));
  });
});

describe("lock, submit, approval with separation of duties, payout", () => {
  it("an invoice with no Sales Order (INV 9) holds the month back until it is reviewed (0140), with a reason, by the qualify permission", async () => {
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: APR, lock: true, rowVersion: await rv(), category: "B" })).toMatchObject({ ok: true });
    // Before 0140 nobody can record that review: the month is refused, saying how to resolve it.
    expect(await act.submitCategoryAMonth({ programId, month: APR, rowVersion: await rv(), category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/1 invoice of this month has no Sales Order .* needs database update 0140/) });
    signIn("invReviewer");
    expect(await act.recordCategoryBInvoiceReview({ invoiceId: doc["INV 9"], reason: "Direct sale" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs database update 0140/) });
    await pg.exec(MIG("0140_incentive_category_b_invoice_reviews.sql"));
    await pg.exec(MIG("0140_incentive_category_b_invoice_reviews.sql")); // safe to re-run
    // Its rollback removes it while nothing is recorded (and it is applied again).
    await pg.exec(readFileSync(resolve(__dirname, "../../db/rollback/0140_incentive_category_b_invoice_reviews.rollback.sql"), "utf8"));
    expect(await q1(`select to_regclass('public.incentive_calc_b_invoice_reviews') is null gone`)).toEqual([{ gone: true }]);
    await pg.exec(MIG("0140_incentive_category_b_invoice_reviews.sql"));
    signIn("locker");
    expect(await act.submitCategoryAMonth({ programId, month: APR, rowVersion: await rv(), category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/invoice of this month with no Sales Order \(INV 9\) hasn't been reviewed/) });
    for (const k of ["runner", "a1", "viewer"] as const) {
      signIn(k);
      await expect(act.recordCategoryBInvoiceReview({ invoiceId: doc["INV 9"], reason: "x" })).rejects.toThrow("Forbidden");
    }
    signIn("invReviewer");
    expect(await act.recordCategoryBInvoiceReview({ invoiceId: doc["INV 9"], reason: "  " })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/) });
    expect(await act.recordCategoryBInvoiceReview({ invoiceId: doc["SO 1"], reason: "wrong document" })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a Forms sales invoice/) });
    expect(await act.recordCategoryBInvoiceReview({ invoiceId: doc["INV 9"], reason: "Direct counter sale: not a Category B sale (checked with accounts)" })).toMatchObject({ ok: true });
    expect(await act.recordCategoryBInvoiceReview({ invoiceId: doc["INV 9"], reason: "again" })).toMatchObject({ ok: false, error: expect.stringMatching(/already reviewed/) });
    await expect(pg.query(`update incentive_calc_b_invoice_reviews set reason = 'changed'`)).rejects.toThrow(/never changes/);
    await expect(pg.query(`delete from incentive_calc_b_invoice_reviews`)).rejects.toThrow(/never deleted/);
    await expect(pg.query(`insert into incentive_calc_b_invoice_reviews (invoice_document_id, decision, reason, created_by_name) values ($1, 'not-category-b', 'x', 'x')`, [doc["SO 2"]])).rejects.toThrow(/recorded on a Forms sales invoice/);
    const queue = await qualify.reviewQueue(programId, APR, "all");
    expect(queue.invoiceReviewsReady).toBe(true);
    expect(queue.invoiceReviews).toEqual([expect.objectContaining({ invoiceId: doc["INV 9"], decision: "not-category-b", byName: "invReviewer", retiredAt: null })]);
    expect(await q1(`select action, entity_id from incentive_audit where action = 'b-invoice-reviewed'`)).toEqual([{ action: "b-invoice-reviewed", entity_id: doc["INV 9"] }]);
    // Once a review exists, the rollback refuses and changes nothing.
    await expect(pg.exec(readFileSync(resolve(__dirname, "../../db/rollback/0140_incentive_category_b_invoice_reviews.rollback.sql"), "utf8"))).rejects.toThrow(/0140 rollback refused/);
    // It changes no calculation: INV 9 is still listed, and still out.
    expect((await calc.monthView(programId, APR, undefined, "B")).reviewInvoices!.map((x) => x.invoiceNo)).toEqual(["INV 9"]);
  });
  it("whoever decided an order or reviewed an invoice by hand can't approve the month (service and database)", async () => {
    signIn("locker");
    expect(await act.submitCategoryAMonth({ programId, month: APR, rowVersion: await rv(), category: "B" })).toMatchObject({ ok: true, approvalsRequired: 2 });
    signIn("invReviewer");
    expect(await act.decideCategoryAMonth({ programId, month: APR, rowVersion: await rv(), decision: "approve", reason: null, category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/reviewed an invoice of this month that has no Sales Order/) });
    const pp = await one<{ id: string; current_run_id: string; submission_no: number }>(`select id, current_run_id, submission_no from incentive_calc_periods where category_code = 'B' and month = $1`, [APR]);
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, 'invReviewer')`, [pp.id, pp.current_run_id, pp.submission_no, who.invReviewer])).rejects.toThrow(/invoice review never approves or rejects that month/);
    signIn("qualifier");
    expect(await act.decideCategoryAMonth({ programId, month: APR, rowVersion: await rv(), decision: "approve", reason: null, category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/decided a Sales Order's Category B qualification by hand/) });
    const p = await one<{ id: string; current_run_id: string; submission_no: number }>(`select id, current_run_id, submission_no from incentive_calc_periods where category_code = 'B' and month = $1`, [APR]);
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, $3, 1, 'approve', $4, 'qualifier')`, [p.id, p.current_run_id, p.submission_no, who.qualifier])).rejects.toThrow(/never approves or rejects that month/);
  });
  it("two other approvers approve; the payout must equal ₹2,700 exactly; the month is then final", async () => {
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId, month: APR, rowVersion: await rv(), decision: "approve", reason: null, category: "B" })).toMatchObject({ ok: true, status: "submitted" });
    signIn("a2");
    expect(await act.decideCategoryAMonth({ programId, month: APR, rowVersion: await rv(), decision: "approve", reason: null, category: "B" })).toMatchObject({ ok: true, status: "approved" });
    const release = (await one<{ r: string }>(`select release_on::text r from incentive_calc_periods where category_code = 'B' and month = $1`, [APR])).r;
    // A review retired after the approval holds the payout back until the invoice is decided again.
    const review = (await one<{ id: string }>(`select id from incentive_calc_b_invoice_reviews where retired_at is null`)).id;
    signIn("invReviewer");
    expect(await act.retireCategoryBInvoiceReview({ id: review, reason: "Accounts found its Sales Order" })).toMatchObject({ ok: true });
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId, month: APR, rowVersion: await rv(), reference: "PAY-B-APR", paidOn: release, amountPaise: RS(2_700), note: null, category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/\(INV 9\) hasn't been reviewed.* Nothing was paid/) });
    signIn("invReviewer");
    expect(await act.recordCategoryBInvoiceReview({ invoiceId: doc["INV 9"], reason: "Its Sales Order isn't in Forms after all: not Category B" })).toMatchObject({ ok: true });
    expect((await qualify.reviewQueue(programId, APR, "all")).invoiceReviews.map((x) => [x.retiredAt === null, x.retiredReason])).toEqual([[false, "Accounts found its Sales Order"], [true, null]]);
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId, month: APR, rowVersion: await rv(), reference: "PAY-B-APR", paidOn: release, amountPaise: RS(2_000), note: null, category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't match the approved amount/) });
    expect(await act.recordCategoryAPayout({ programId, month: APR, rowVersion: await rv(), reference: "PAY-B-APR", paidOn: release, amountPaise: RS(2_700), note: null, category: "B" })).toMatchObject({ ok: true, totalPaise: RS(2_700) });
    await expect(pg.query(`update incentive_calc_periods set status = 'open', row_version = row_version + 1 where category_code = 'B' and month = $1`, [APR])).rejects.toThrow(/final/);
  });
  it("the salesperson sees their own approved/paid Category B only; nobody else's", async () => {
    const mine = await calc.myCategoryB(who.rep);
    expect(mine.months).toEqual([expect.objectContaining({ month: APR, status: "paid", amountPaise: RS(2_700), payoutReference: "PAY-B-APR" })]);
    expect(await calc.myCategoryB(who.other)).toEqual({ ready: true, months: [], awaiting: [], voided: [] });
    expect((await calc.myCategoryA(who.rep)).months).toEqual([]); // Category A is separate
  });
});

describe("an order still needing review never passes silently", () => {
  it("May's SO 5 (an item not in the Product Master, undecided) keeps May from being submitted, naming it", async () => {
    await tdoc("sales-orders", "SO 5", "2026-05-04", RS(1_77_000), { taxable: RS(1_50_000), lines: [line(null, "Unmatched gearbox", RS(1_50_000))] });
    await tdoc("sales-invoices", "INV 5", "2026-05-06", RS(1_77_000), { taxable: RS(1_50_000), ref: doc["SO 5"], due: "2026-06-05" });
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: "2026-05-01", asOf: "2026-06-30", category: "B" })).toMatchObject({ ok: true, adopted: true });
    expect((await qualify.reviewQueue(programId, "2026-05-01")).rows.map((r) => [r.orderNo, r.outcome])).toEqual([["SO 5", "needs-review"]]);
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: "2026-05-01", lock: true, rowVersion: await rv("2026-05-01"), category: "B" })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId, month: "2026-05-01", rowVersion: await rv("2026-05-01"), category: "B" })).toMatchObject({ ok: false, error: expect.stringMatching(/1 Sales Order of this month \(SO 5\) still needs a Category B decision .* Nothing was submitted/) });
    expect((await one<{ status: string }>(`select status from incentive_calc_periods where category_code = 'B' and month = '2026-05-01'`)).status).toBe("locked");
  });
});

describe("a credit note after payout: recovered in a later month, the paid month unchanged", () => {
  it("INV 1 falls below ₹1,00,000 in June: the whole ₹1,200 is carried into June as a recovery", async () => {
    await tdoc("credit-notes", "CN 1", "2026-06-10", RS(35_400), { taxable: RS(30_000), ref: doc["INV 1"] });
    const before = await fp(`select * from incentive_calc_periods where category_code = 'B' and month = '${APR}'`);
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: "2026-06-01", asOf: "2026-06-12", category: "B" })).toMatchObject({ ok: true }); // June is open
    const r = await act.calculateCategoryAMonth({ programId, month: APR, asOf: "2026-06-15", category: "B" });
    expect(r).toMatchObject({ ok: true, adopted: false, status: "computed" });
    if (r.ok) expect(r.outcome).toMatch(/paid.*carried into 2026-06/);
    expect(await q1(`select kind, amount_paise::int a, to_month::text t, category_code c from incentive_calc_adjustments`)).toEqual([{ kind: "recalc-difference", a: -RS(1_200), t: "2026-06-01", c: "B" }]);
    const kept = await one<{ pinned: boolean; base_exact: string }>(`select pinned, base_exact from incentive_calc_b_qualifications qq join incentive_calc_runs u on u.id = qq.run_id where u.month = $1 and not u.adopted and qq.order_no = 'SO 1' order by u.computed_at desc limit 1`, [APR]);
    expect(kept).toEqual({ pinned: true, base_exact: "0" });
    expect(await fp(`select * from incentive_calc_periods where category_code = 'B' and month = '${APR}'`)).toBe(before);
    // June's payout lines carry the recovery (never below zero for the person).
    const lines = await calc.payoutLines(h.db as never, programId, "2026-06-01", (await one<{ current_run_id: string }>(`select current_run_id from incentive_calc_periods where category_code = 'B' and month = '2026-06-01'`)).current_run_id, "B");
    expect(lines).toEqual([expect.objectContaining({ employeeName: "rep", adjustmentsPaise: -RS(1_200), amountPaise: 0 })]);
  });
});

describe("Category A beside Category B", () => {
  it("a Category A version that leaves Category B orders out excludes SO 1 and SO 2, saying why", async () => {
    const a = await publish("A", forRep(aprilConfig({ "basis.categoryBOrders": "exclude", "basis.amount": "taxable" })), APR);
    expect(await a.publish()).toMatchObject({ ok: true });
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: APR, asOf: "2026-05-31" })).toMatchObject({ ok: true, status: "computed" });
    const run = await one<{ result: { excluded: { documentNo: string; message: string }[] }; inputs: { categoryBOrderIds?: string[]; allCategories?: unknown } }>(`select result, inputs from incentive_calc_runs where category_code = 'A' order by computed_at desc limit 1`);
    expect(run.inputs.categoryBOrderIds!.sort()).toEqual([doc["SO 1"], doc["SO 2"]].sort());
    expect(run.result.excluded.filter((x) => /earns Category B/.test(x.message)).map((x) => x.documentNo).sort()).toEqual(["SO 1", "SO 2"]);
    // Category B's version is in force for April, so the all-categories limit is shared (policy from the B version).
    expect(run.inputs.allCategories).toMatchObject({ policy: "proportional", capPaise: RS(18_250) });
  });
});

describe("the old engine's cut-over", () => {
  it("Category B is the new engine's from April (the published configuration's month), not before", async () => {
    expect(await load.newEngineAuthoritative("B", "2026-03")).toBe(false);
    expect(await load.newEngineAuthoritative("B", "2026-04")).toBe(true);
  });
  it("recomputing an April tracker month: no new Category B row, an old one kept, and the payout leaves Category B out", async () => {
    const cust = (await one<{ id: string }>(`insert into customers (name) values ('Tracker Customer') returning id`)).id;
    const o = (await one<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, $3, 'B', '2026-04-20', true) returning id`, [cust, who.rep, RS(2_00_000)])).id;
    await pg.query(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days, due_date) values ($1, $2, '2026-04-20', 30, '2026-05-20')`, [o, RS(2_00_000)]);
    const period = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-04', 'open') returning id`)).id;
    const old = (await one<{ id: string }>(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref, explanation) values ($1, $2, 'B.1', 'B', 'accrual', 150000, 'crosssell:earlier', 'kept') returning id`, [who.rep, period])).id;
    const r = await load.computePeriodForEmployee(who.rep, "2026-04", new Date("2026-06-01T00:00:00Z"));
    expect(r.lines.some((l) => l.category === "B")).toBe(false);
    expect(await q1(`select id, amount_paise::int a, explanation from incentive_ledger where period_id = $1 and category = 'B'`, [period])).toEqual([{ id: old, a: 150000, explanation: "kept" }]);
    expect((await incentives.getPeriodPayout("2026-04")).rows.reduce((s, x) => s + x.totalPaise, 0)).toBe(0);
  });
  it("before the cut-over the old engine still calculates Category B (March)", async () => {
    const cust = (await one<{ id: string }>(`select id from customers limit 1`)).id;
    const o = (await one<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, $3, 'B', '2026-03-10', true) returning id`, [cust, who.rep, RS(2_00_000)])).id;
    await pg.query(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days, due_date) values ($1, $2, '2026-03-10', 30, '2026-04-09')`, [o, RS(2_00_000)]);
    const r = await load.computePeriodForEmployee(who.rep, "2026-03", new Date("2026-03-31T00:00:00Z"));
    expect(r.lines.filter((l) => l.category === "B").length).toBe(1);
  });
  it("the paid July 2026 old-engine month (with its Category B line) is exactly as it was", async () => {
    await load.computePeriodForEmployee(who.rep, "2026-07", new Date("2026-08-15T00:00:00Z"));
    const after = (await fp(`select l.* from incentive_ledger l join incentive_periods p on p.id = l.period_id where p.month = '2026-07'`)) + (await fp(`select * from incentive_periods where month = '2026-07'`)) + (await fp(`select * from payout_runs`));
    expect(after).toBe(julyOld);
  });
});
