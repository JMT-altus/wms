import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running 0131–0133) of the Incentive Tracker ↔ Category A integration:
//   · the old engine stops calculating Category A for a month once a published Category A configuration covers it,
//     leaves its own earlier Category A rows exactly as they were, keeps calculating B–G, and never touches a paid
//     month;
//   · the old payout never includes Category A for such a month (nothing paid twice);
//   · My Incentives shows a salesperson only their OWN Category A, only once approved or paid.
// Invented data only; nothing here reaches a real database.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { aprilConfig, EXAMPLE_2, L } from "../fixtures/category-a";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let load: typeof import("@/lib/incentives/load");
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
let incentives: typeof import("@/lib/queries/incentives");
let views: typeof import("@/lib/queries/incentive-views");
const who: Record<string, string> = {};
const actor = (k: string) => ({ id: who[k]!, name: k });
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q1<T>(sql, params))[0]!;
const ledger = async (month: string) => q1<{ id: string; category: string; rule_line_code: string; amount_paise: number; explanation: string }>(`select l.id, l.category, l.rule_line_code, l.amount_paise::int amount_paise, l.explanation from incentive_ledger l join incentive_periods p on p.id = l.period_id where p.month = $1 and l.employee_id = $2 order by l.rule_line_code`, [month, who.rep]);
const fp = async (sql: string) => (await one<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') f from (${sql}) t`)).f;
let programId = "";

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures,
    customers: schema.customers, salesOrders: schema.salesOrders, invoices: schema.invoices, receipts: schema.receipts,
    leadBatches: schema.leadBatches, leadConversions: schema.leadConversions, clientMeetings: schema.clientMeetings, testimonials: schema.testimonials,
    incentiveSchemes: schema.incentiveSchemes, ruleVersions: schema.ruleVersions, incentivePeriods: schema.incentivePeriods, incentiveLedger: schema.incentiveLedger, payoutRuns: schema.payoutRuns, incentiveAudit: schema.incentiveAudit,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of ["rep", "other", "runner", "submitter", "a1", "a2", "payer", "author", "checker"]) who[k] = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [k, `${k}@example.test`])).id;
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await pg.exec(readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8"));
  load = await import("@/lib/incentives/load");
  calc = await import("@/lib/queries/incentive-calc");
  rules = await import("@/lib/queries/incentive-rules");
  incentives = await import("@/lib/queries/incentives");
  views = await import("@/lib/queries/incentive-views");

  // The OLD tracker's own records for the rep: June 2026 — ₹1.2 Cr category-A sales (paid on time) and a ₹2 L
  // category-B order; March 2026 — a PAID month with its ledger and payout run (before the April cut-over: a
  // Category A version is never published over a month the old engine already paid).
  const cust = (await one<{ id: string }>(`insert into customers (name) values ('Tracker Customer') returning id`)).id;
  const sale = async (cat: string, value: number, date: string) => {
    const o = (await one<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, $3, $4, $5, true) returning id`, [cust, who.rep, value, cat, date])).id;
    const i = (await one<{ id: string }>(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days, due_date) values ($1, $2, $3, 30, ($3::date + 30)) returning id`, [o, value, date])).id;
    await pg.query(`insert into receipts (invoice_id, amount_paise, received_at) values ($1, $2, $3::date + 10)`, [i, value, date]);
  };
  await sale("A", L(120), "2026-06-05");
  await sale("B", L(2), "2026-06-06");
  await load.computePeriodForEmployee(who.rep!, "2026-06", new Date("2026-08-01T00:00:00Z"));
  const paidMonth = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-03', 'paid') returning id`)).id;
  await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref) values ($1, $2, 'A.1', 'A', 'accrual', 150000, 'slab:A.1'), ($1, $2, 'B.1', 'B', 'accrual', 50000, 'crosssell:x')`, [who.rep, paidMonth]);
  await pg.query(`insert into payout_runs (period_id, total_paise) values ($1, 200000)`, [paidMonth]);
}, 180_000);
afterAll(async () => {
  await pg.close();
});

describe("before any Category A configuration is published: the old engine is unchanged", () => {
  it("June has the old engine's Category A slab lines and its B line (the old engine counts every confirmed order towards sales: ₹1.22 Cr)", async () => {
    const rows = await ledger("2026-06");
    expect(rows.map((r) => [r.rule_line_code, r.amount_paise])).toEqual([["A.1", 200000], ["A.2", 30000], ["B.1", 150000]]); // B.1: 1% of ₹2 L capped at ₹1,500 a time
    expect(await load.newCategoryAAuthoritative("2026-06")).toBe(false);
    expect((await incentives.getPeriodPayout("2026-06")).grandTotalPaise).toBe(380000); // A.1 + A.2 + B.1
  });
});

describe("once Category A is published from April: the new engine is authoritative", () => {
  let juneA: Awaited<ReturnType<typeof ledger>>;
  let paidBefore = "";
  it("publishing a Category A configuration makes April onwards authoritative", async () => {
    juneA = (await ledger("2026-06")).filter((r) => r.category === "A");
    paidBefore = await fp(`select l.* from incentive_ledger l join incentive_periods p on p.id = l.period_id where p.month = '2026-03'`) + (await fp(`select * from incentive_periods where month = '2026-03'`)) + (await fp(`select * from payout_runs`));
    const author = actor("author"), checker = actor("checker");
    const p = await rules.createProgram(author, { code: "SALES", name: "Sales team", description: null });
    if (!p.ok) throw new Error(p.error);
    programId = p.programId;
    const config = aprilConfig({ "payout.approvalSteps": 2, "payout.release": "afterApproval" });
    config.eligibility = [{ subjectType: "employee", subjectId: who.rep!, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }];
    const d = await rules.createDraft(author, { programId, category: "A", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s = await rules.saveDraft(author, d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(author, d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(checker, d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(checker, d.versionId, ap.rowVersion, "2026-04-01", { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
    expect(await load.newCategoryAAuthoritative("2026-03")).toBe(false);
    expect(await load.newCategoryAAuthoritative("2026-04")).toBe(true);
    expect(await load.newCategoryAAuthoritative("2026-06")).toBe(true);
  });
  it("recomputing June: the old Category A row is kept exactly as it was, B–G are still calculated, nothing new for A", async () => {
    // A new B order arrives, so the recompute has something to change in B.
    const cust = (await one<{ id: string }>(`select id from customers limit 1`)).id;
    const o = (await one<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, $3, 'B', '2026-06-20', true) returning id`, [cust, who.rep, L(3)])).id;
    await pg.query(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days, due_date) values ($1, $2, '2026-06-20', 30, '2026-07-20')`, [o, L(3)]);
    const r = await load.computePeriodForEmployee(who.rep!, "2026-06", new Date("2026-08-01T00:00:00Z"));
    expect(r.lines.some((l) => l.category === "A")).toBe(false); // the old engine calculates no Category A
    const rows = await ledger("2026-06");
    expect(rows.filter((x) => x.category === "A")).toEqual(juneA); // same id, amount and explanation: untouched
    expect(rows.filter((x) => x.category === "B").length).toBe(2); // B recalculated, with the new order
  });
  it("the old payout for June leaves Category A out, so it can never be paid twice", async () => {
    const p = await incentives.getPeriodPayout("2026-06");
    const b = (await ledger("2026-06")).filter((x) => x.category === "B").reduce((s, x) => s + x.amount_paise, 0);
    expect(p.grandTotalPaise).toBe(b);
  });
  it("the paid March month (the old engine's, before the cut-over) is untouched by recomputing it", async () => {
    await load.computePeriodForEmployee(who.rep!, "2026-03", new Date("2026-04-15T00:00:00Z"));
    const after = await fp(`select l.* from incentive_ledger l join incentive_periods p on p.id = l.period_id where p.month = '2026-03'`) + (await fp(`select * from incentive_periods where month = '2026-03'`)) + (await fp(`select * from payout_runs`));
    expect(after).toBe(paidBefore);
  });
  it("history keeps historical Category A apart from the rest", async () => {
    const hist = await views.getMyHistory(who.rep!);
    const june = hist.find((x) => x.period === "2026-06")!;
    expect(june.categoryAPaise).toBe(juneA.reduce((s, x) => s + x.amount_paise, 0));
    expect(june.totalPaise - june.categoryAPaise).toBe((await ledger("2026-06")).filter((x) => x.category !== "A").reduce((s, x) => s + x.amount_paise, 0));
  });
});

describe("My Incentives: a salesperson sees only their own Category A, only once approved or paid", () => {
  it("while being calculated, locked or submitted: named as awaiting, never valued", async () => {
    // Forms: April example 2 for the rep (via the Customer Master's representative).
    const customer = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id) values ('Customer One', $1) returning id`, [who.rep])).id;
    const batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 't.xlsx', 'x') returning id`)).id;
    const doc = async (type: string, no: string, date: string, total: number, ref: string | null, due: string | null) =>
      (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2026-27', 'Customer One', 'customer one', $6, $7, $7, $8, $9, '[]'::jsonb, $10, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, total, ref, due, batch])).id;
    for (const [i, pays] of EXAMPLE_2.entries()) {
      const order = await doc("sales-orders", `SO ${i + 1}`, "2026-04-05", L(10), null, null);
      const inv = await doc("sales-invoices", `INV ${i + 1}`, "2026-04-05", L(10), order, "2026-04-05");
      for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `RC ${i + 1}.${k + 1}`, new Date(Date.parse("2026-04-05T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10), Math.round(L(10) * fraction), inv, null);
    }
    expect(await calc.calculate(actor("runner"), programId, "2026-04-01", "2026-09-30")).toMatchObject({ ok: true, adopted: true });
    expect(await calc.myCategoryA(who.rep!)).toEqual({ ready: true, months: [], awaiting: ["2026-04-01"] });
    const rv = async () => Number((await one<{ row_version: number }>(`select row_version from incentive_calc_periods where month = '2026-04-01'`)).row_version);
    expect(await calc.setLocked(actor("runner"), programId, "2026-04-01", true, await rv())).toMatchObject({ ok: true });
    expect(await calc.submitMonth(actor("submitter"), programId, "2026-04-01", await rv())).toMatchObject({ ok: true });
    expect(await calc.decideMonth(actor("a1"), programId, "2026-04-01", await rv(), "approve", null)).toMatchObject({ ok: true, status: "submitted" });
    expect((await calc.myCategoryA(who.rep!)).months).toEqual([]); // one of two approvals: still not shown
  });
  it("approved: the person's own amount and status — and nobody else's", async () => {
    const rv = Number((await one<{ row_version: number }>(`select row_version from incentive_calc_periods where month = '2026-04-01'`)).row_version);
    expect(await calc.decideMonth(actor("a2"), programId, "2026-04-01", rv, "approve", null)).toMatchObject({ ok: true, status: "approved" });
    const mine = await calc.myCategoryA(who.rep!);
    expect(mine.months).toHaveLength(1);
    expect(mine.months[0]).toMatchObject({ month: "2026-04-01", programCode: "SALES", status: "approved", amountPaise: 92500, paidOn: null, payoutReference: null });
    expect(mine.months[0]!.explanation.join(" ")).toMatch(/threshold/);
    expect(mine.awaiting).toEqual([]);
    expect(await calc.myCategoryA(who.other!)).toEqual({ ready: true, months: [], awaiting: [] });
  });
  it("paid: the amount actually paid, with its date and reference", async () => {
    const p = await one<{ row_version: number; release_on: string }>(`select row_version, release_on::text from incentive_calc_periods where month = '2026-04-01'`);
    expect(await calc.recordPayout(actor("payer"), programId, "2026-04-01", Number(p.row_version), { reference: "NEFT-APR", paidOn: p.release_on, amountPaise: 92500, note: null }, p.release_on)).toMatchObject({ ok: true });
    expect((await calc.myCategoryA(who.rep!)).months[0]).toMatchObject({ status: "paid", amountPaise: 92500, paidOn: p.release_on, payoutReference: "NEFT-APR" });
    // The Approvals screen's payout history carries the salesperson-wise payout lines of that payout.
    const list = await calc.listApprovalPeriods(programId);
    const april = list.periods.find((x) => x.month === "2026-04-01")!;
    expect(april.payout).toMatchObject({ reference: "NEFT-APR", totalPaise: 92500, lines: [{ employeeName: "rep", payablePaise: 92500, adjustmentsPaise: 0, amountPaise: 92500 }] });
    expect(april.approvedTotalPaise).toBe(92500);
  });
  it("the new and old Category A stay apart: April has no old-engine Category A, June keeps its historical one", async () => {
    expect((await ledger("2026-04")).length).toBe(0);
    expect((await ledger("2026-06")).filter((x) => x.category === "A").length).toBe(2);
  });
});
