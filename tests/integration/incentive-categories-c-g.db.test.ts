import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running 0131–0135's own SQL) for Categories C–G end to end: migration 0135 and
// its rollback, configuration (category-only settings, G unpublishable until decided), calculation from Forms and from
// the tracker's approved submissions, separate monthly approval and payout per category, a salesperson's own figures
// only once approved/paid, and the old engine's per-category cut-over. SYNTHETIC data only (the old engine's PDF values
// used as TEST values); only the session is mocked.
/**
 * Runs `fn` with the clock on a simulated day (from noon in India), for a calculation AS OF that day: the service refuses
 * a calculation date in the future (Phase 1), and these suites simulate months that haven't come yet. Only `Date` is
 * faked, only for the call; each call starts one minute later than the one before (and the clock keeps moving), so
 * every run's own time stays in order. Real time is restored afterwards, whatever happens.
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
vi.mock("@/lib/auth/super-admin", () => ({ SUPER_ADMIN_EMAILS: [], isSuperAdmin: () => false }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));

import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { completeConfig } from "../fixtures/incentive-config";
import type { CategoryCode, SettingValue } from "@/lib/incentives/rules-config/spec";
import { ENGINE_VERSIONS } from "@/lib/incentives/categories/types";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
let load: typeof import("@/lib/incentives/load");
let incentives: typeof import("@/lib/queries/incentives");
const PEOPLE = ["author", "checker", "runner", "locker", "a1", "payer", "payer2", "rep", "other", "plainAdmin", "reviewer", "voider"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], locker: ["lock", "submit"], a1: ["approve"], payer: ["pay"], payer2: ["pay"], reviewer: ["review", "approve"], voider: ["void"] };
const actor = (k: Who) => ({ id: who[k], name: k });
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k !== "rep" && k !== "other", departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q1<T>(sql, params))[0]!;
const fp = async (sql: string) => (await one<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') f from (${sql}) t`)).f;
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../../db/rollback/0135_incentive_categories_c_g.rollback.sql"), "utf8");
const ROLLBACK_0136 = readFileSync(resolve(__dirname, "../../db/rollback/0136_incentive_category_c_review.rollback.sql"), "utf8");
const ROLLBACK_0141 = readFileSync(resolve(__dirname, "../../db/rollback/0141_incentive_carry_writeoffs.rollback.sql"), "utf8");
const RS = (r: number) => Math.round(r * 100);
const JUN = "2026-06-01";
let programId = "";
const rv = async (cat: string, month = JUN) => Number((await one<{ row_version: number }>(`select row_version from incentive_calc_periods where category_code = $1 and month = $2`, [cat, month])).row_version);
const TEST: Record<string, Record<string, SettingValue>> = {
  C: { "c.newCustomerLookbackMonths": 12, "c.turnoverWindowMonths": 12, "c.turnoverBasis": "invoiced", "collection.dueDateFallback": ["invoiceDueDate"], "payout.minimumPayable": "none", "c.requiredTransactions": 3, "c.minTurnover": RS(2_50_000), "c.amountBasis": "taxable", "c.ratePpm": 10_000, "caps.perOrder": RS(5_000), "attribution.historical": "currentRep" },
  D: { "d.leadsPerUnit": 10, "d.leadUnitAmount": RS(250), "d.leadsMustBeProfiled": "yes", "d.conversionsPerUnit": 5, "d.conversionUnitAmount": RS(250), "d.unitCounting": "perSubmission" },
  E: { "e.minAward": RS(250), "e.maxAward": RS(1_000) },
  F: { "f.googleReviewAmount": RS(100), "f.googleMinWords": 50, "f.googleFiveStarOnly": "yes", "f.googleNeedsEvidence": "yes", "f.emailAmount": RS(100), "f.letterheadAmount": RS(150), "f.namedMultiple": 2 },
};
async function publish(category: CategoryCode, settings: Record<string, SettingValue>, from = "2026-04-01") {
  const c = completeConfig({}, [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], category);
  const config = { ...c, settings: { ...c.settings, "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none", ...settings } };
  const d = await rules.createDraft(actor("author"), { programId, category, startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, from, { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
}

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
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql"]) await pg.exec(MIG(f));
  act = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  calc = await import("@/lib/queries/incentive-calc");
  rules = await import("@/lib/queries/incentive-rules");
  load = await import("@/lib/incentives/load");
  incentives = await import("@/lib/queries/incentives");
  const p = await rules.createProgram(actor("author"), { code: "SALES", name: "Sales team", description: null });
  if (!p.ok) throw new Error(p.error);
  programId = p.programId;
}, 240_000);
afterAll(async () => {
  await pg.close();
});

describe("migration 0135 and its rollback", () => {
  it("before 0135, Categories C–G say they need it and calculate nothing", async () => {
    expect(await calc.calculate(actor("runner"), programId, JUN, "2026-07-31", "D")).toEqual({ ok: false, error: expect.stringMatching(/0135/) });
  });
  it("applies (twice), adds the items table, and the rollback restores 0134's catalogue exactly with no C–G data", async () => {
    const cat = async () => JSON.stringify({ c: await q1(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text like 'incentive_%' order by 1, 2`), f: await q1(`select proname, md5(prosrc) s from pg_proc where proname like 'incentive_%' order by 1`), r: await q1(`select relname from pg_class where relkind = 'r' and relname like 'incentive_%' order by 1`) });
    // A Category A draft with shared settings whose keys merely START with c–g (caps.*, collection.*, eligibility.*),
    // as production has: they are not Category C–G data and must never hold the rollback back.
    const a = await rules.createDraft(actor("author"), { programId, category: "A", startFrom: "blank" });
    if (!a.ok) throw new Error(a.error);
    await pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'caps.perOrder', '"none"'::jsonb), ($1, 'collection.delayFrom', '"dueDate"'::jsonb), ($1, 'eligibility.threshold', '100'::jsonb)`, [a.versionId]);
    const before = await cat();
    await pg.exec(MIG("0135_incentive_categories_c_g.sql"));
    await pg.exec(MIG("0135_incentive_categories_c_g.sql"));
    expect(await q1(`select relrowsecurity from pg_class where relname = 'incentive_calc_items'`)).toEqual([{ relrowsecurity: true }]);
    await pg.exec(ROLLBACK);
    expect(await cat()).toBe(before);
    expect(await q1(`select count(*)::int n from incentive_config_settings where version_id = $1`, [a.versionId])).toEqual([{ n: 3 }]);
    await pg.exec(MIG("0135_incentive_categories_c_g.sql"));
    expect(await rules.discard(actor("author"), a.versionId, 1)).toMatchObject({ ok: true });
  });
  it("a category's own settings belong to its versions only (database)", async () => {
    const d = await rules.createDraft(actor("author"), { programId, category: "E", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'd.leadsPerUnit', '10'::jsonb)`, [d.versionId])).rejects.toThrow(/belongs to Category D versions only/);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'slabs.method', '"marginal"'::jsonb)`, [d.versionId])).rejects.toThrow(/isn't a Category E setting/);
    expect(await rules.discard(actor("author"), d.versionId, 1)).toMatchObject({ ok: true });
  });
});

describe("migration 0136 (Category C corrections) and its rollback", () => {
  const cat = async () => JSON.stringify({ c: await q1(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text like 'incentive_%' order by 1, 2`), f: await q1(`select proname, md5(prosrc) s from pg_proc where proname like 'incentive_%' order by 1`), r: await q1(`select relname from pg_class where relkind = 'r' and relname like 'incentive_%' order by 1`), t: await q1(`select tgname from pg_trigger where not tgisinternal and tgname like 'incentive_%' order by 1`) });
  it("before 0136, Category C says it needs it and calculates nothing", async () => {
    expect(await calc.calculate(actor("runner"), programId, JUN, "2026-07-31", "C")).toEqual({ ok: false, error: expect.stringMatching(/0136/) });
  });
  it("applies (twice) and its rollback restores 0135 exactly — shared caps.* / collection.* / adjust.* settings of other categories never hold it back", async () => {
    const a = await rules.createDraft(actor("author"), { programId, category: "A", startFrom: "blank" });
    if (!a.ok) throw new Error(a.error);
    await pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'caps.perOrder', '"none"'::jsonb), ($1, 'collection.payableWhen', '"orderFullyCollected"'::jsonb), ($1, 'adjust.creditNote', '"reduceOriginalMonthSales"'::jsonb)`, [a.versionId]);
    const before = await cat();
    await pg.exec(MIG("0136_incentive_category_c_review.sql"));
    await pg.exec(MIG("0136_incentive_category_c_review.sql"));
    expect(await q1(`select relrowsecurity from pg_class where relname = 'incentive_calc_c_reviews'`)).toEqual([{ relrowsecurity: true }]);
    await pg.exec(ROLLBACK_0136);
    expect(await cat()).toBe(before);
    expect(await q1(`select count(*)::int n from incentive_config_settings where version_id = $1`, [a.versionId])).toEqual([{ n: 3 }]);
    await pg.exec(MIG("0136_incentive_category_c_review.sql"));
    expect(await rules.discard(actor("author"), a.versionId, 1)).toMatchObject({ ok: true });
  });
  it("its ledger and void indexes, foreign keys and triggers are exactly what the apply script pins", async () => {
    const idx = Object.fromEntries((await q1<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname in ('incentive_calc_carry_held_uq', 'incentive_calc_carry_consume_uq', 'incentive_calc_period_voids_period_uq', 'incentive_calc_c_reviews_active_uq')`)).map((x) => [x.indexname, x.indexdef]));
    expect(idx.incentive_calc_carry_held_uq).toMatch(/^CREATE UNIQUE INDEX .*\(period_id, employee_id\) WHERE \(\(kind = 'held'::text\) AND \(employee_id IS NOT NULL\)\)/);
    expect(idx.incentive_calc_carry_consume_uq).toMatch(/^CREATE UNIQUE INDEX .*\(lot_id, period_id, kind\) WHERE \(\(lot_id IS NOT NULL\) AND \(period_id IS NOT NULL\)\)/);
    expect(idx.incentive_calc_period_voids_period_uq).toMatch(/^CREATE UNIQUE INDEX .*\(period_id\)$/);
    expect(idx.incentive_calc_c_reviews_active_uq).toMatch(/^CREATE UNIQUE INDEX .*\(document_id, case_kind\) WHERE \(retired_at IS NULL\)/);
    const tables = ["incentive_calc_c_reviews", "incentive_calc_carry", "incentive_calc_period_voids"];
    const fks = (await q1<{ x: string }>(`select conrelid::regclass::text || '>' || confrelid::regclass::text || ':' || confdeltype::text x from pg_constraint where contype = 'f' and conrelid::regclass::text = any($1)`, [tables])).map((r) => r.x).sort();
    expect(fks).toEqual(["incentive_calc_c_reviews>employees:n", "incentive_calc_c_reviews>employees:n", "incentive_calc_c_reviews>tally_documents:r", "incentive_calc_carry>employees:n", "incentive_calc_carry>employees:n", "incentive_calc_carry>incentive_calc_carry:r", "incentive_calc_carry>incentive_calc_periods:r", "incentive_calc_carry>incentive_calc_runs:r", "incentive_calc_carry>incentive_programs:r", "incentive_calc_period_voids>employees:n", "incentive_calc_period_voids>incentive_calc_periods:r", "incentive_calc_period_voids>incentive_calc_runs:r"].sort());
    const trg = (await q1<{ x: string }>(`select c.relname || ':' || t.tgname x from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname = any($1)`, [tables])).map((r) => r.x).sort();
    expect(trg).toEqual(["incentive_calc_c_reviews:incentive_calc_c_reviews_guard", "incentive_calc_c_reviews:incentive_calc_c_reviews_insert", "incentive_calc_carry:incentive_calc_carry_insert", "incentive_calc_carry:incentive_calc_carry_no_change", "incentive_calc_period_voids:incentive_calc_period_voids_insert", "incentive_calc_period_voids:incentive_calc_period_voids_no_change"].sort());
    expect((await one<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'incentive_calc_input_history_entity_check'`)).d).toBe("CHECK ((entity = ANY (ARRAY['attribution'::text, 'rep-history'::text, 'receipt-event'::text, 'b-override'::text, 'c-review'::text])))");
  });

  it("only Category C may hold Category A's earning / credit-note / return settings and the minimum payable (database); its rollback then refuses", async () => {
    const c = await rules.createDraft(actor("author"), { programId, category: "C", startFrom: "blank" });
    const d = await rules.createDraft(actor("author"), { programId, category: "D", startFrom: "blank" });
    if (!c.ok || !d.ok) throw new Error("draft");
    await pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'adjust.creditNote', '"reduceOriginalMonthSales"'::jsonb), ($1, 'collection.payableWhen', '"orderFullyCollected"'::jsonb), ($1, 'payout.minimumPayable', '"none"'::jsonb), ($1, 'c.turnoverWindowMonths', '12'::jsonb)`, [c.versionId]);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'adjust.salesReturn', '"reduceOriginalMonthSales"'::jsonb)`, [d.versionId])).rejects.toThrow(/isn't a Category D setting/);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'payout.minimumPayable', '"none"'::jsonb)`, [d.versionId])).rejects.toThrow(/isn't a Category D setting/);
    await expect(pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'c.turnoverBasis', '"invoiced"'::jsonb)`, [d.versionId])).rejects.toThrow(/belongs to Category C versions only/);
    await expect(pg.exec(ROLLBACK_0136)).rejects.toThrow(/0136 rollback refused/);
    expect(await q1(`select to_regclass('public.incentive_calc_c_reviews') is not null ok`)).toEqual([{ ok: true }]);
    expect(await rules.discard(actor("author"), c.versionId, 1)).toMatchObject({ ok: true });
    expect(await rules.discard(actor("author"), d.versionId, 1)).toMatchObject({ ok: true });
  });
});

/** A Google review registered and verified (0137) by the reviewer — published on the 10th of `month`, 5★. */
async function verifiedReview(month: string, n: number, words: number, named: string[], claimFor: string | null) {
  const r = (await one<{ id: string }>(`insert into incentive_f_reviews (google_review_id, first_url, created_by_name) values ($1, $2, 'fixture') returning id`, [`ChCG${month.replace("-", "")}N${n}xxxx`, `https://www.google.com/maps/reviews/cg-${month}-${n}`])).id;
  const text = Array.from({ length: words }, () => "good").join(" ");
  const ids = `{${named.join(",")}}`;
  const names = `{${named.map(() => "rep").join(",")}}`;
  // 0138: a Google review (F.1) that appreciates the salespeople it names (F.4: the reward doubled).
  await pg.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, rating, published_on, review_month, review_text, named_employee_ids, named_employee_names, appreciated_employee_ids, appreciated_employee_names, reason, created_by_id, created_by_name) values ($1, 'verify', 'google_review', 5, $2::date, date_trunc('month', $2::date)::date, $3, $4::uuid[], $5::text[], $4::uuid[], $5::text[], 'fixture', $6, 'reviewer')`, [r, `${month}-10`, text, ids, names, who.reviewer]);
  if (claimFor) await pg.query(`insert into incentive_f_decisions (review_id, kind, credited_employee_id, credited_employee_name, basis, reason, created_by_id, created_by_name) values ($1, 'attribute', $2, 'rep', 'claim', 'fixture claim', $3, 'reviewer')`, [r, claimFor, who.reviewer]);
}

describe("configuration", () => {
  beforeAll(async () => {
    // Category F needs 0137 (its registry and settings), 0138 (email / letterhead testimonials, F.4 appreciation) and
    // 0139 (the email / letterhead identity, write-off history).
    await pg.exec(MIG("0137_incentive_category_f_reviews.sql"));
    await pg.exec(MIG("0138_incentive_category_f_testimonials.sql"));
    await pg.exec(MIG("0139_incentive_category_f_identity.sql"));
    // 0141 (prepared, NOT applied anywhere else): carry-forward write-offs need a second person.
    await pg.exec(MIG("0141_incentive_carry_writeoffs.sql"));
    await pg.exec(MIG("0141_incentive_carry_writeoffs.sql")); // safe to re-run
    await pg.exec(ROLLBACK_0141); // nothing recorded yet: removed…
    await pg.exec(MIG("0141_incentive_carry_writeoffs.sql")); // …and applied again
  });
  it("a Category D draft from the reference template has the PDF values; G's template is empty and can't be submitted", async () => {
    const d = await rules.createDraft(actor("author"), { programId, category: "D", startFrom: "reference" });
    if (!d.ok) throw new Error(d.error);
    expect((await rules.getVersion(d.versionId))!.config.settings).toMatchObject({ "d.leadsPerUnit": 10, "d.leadUnitAmount": RS(250), "d.conversionsPerUnit": 5 });
    expect(await rules.discard(actor("author"), d.versionId, 1)).toMatchObject({ ok: true });
    const g = await rules.createDraft(actor("author"), { programId, category: "G", startFrom: "reference" });
    if (!g.ok) throw new Error(g.error);
    expect((await rules.getVersion(g.versionId))!.config.settings).toEqual({});
    const sub = await rules.submit(actor("author"), g.versionId, 1);
    expect(sub).toMatchObject({ ok: false, error: expect.stringMatching(/Consecutive months of purchases .*isn't set/) });
    expect(await rules.discard(actor("author"), g.versionId, 1)).toMatchObject({ ok: true });
  });
  it("publishes C, D, E and F from April (maker-checker)", async () => {
    for (const c of ["C", "D", "E", "F"] as const) await publish(c, TEST[c]!);
    expect(await q1(`select category_code from incentive_config_versions where status = 'published' order by 1`)).toEqual(["C", "D", "E", "F"].map((c) => ({ category_code: c })));
  });
});

describe("calculating June 2026", () => {
  beforeAll(async () => {
    const m = "2026-06";
    await pg.query(`insert into lead_batches (employee_id, period_month, lead_count, profiled, review_status) values ($1, $2, 25, true, 'approved'), ($1, $2, 40, false, 'approved'), ($1, $2, 30, true, 'pending')`, [who.rep, m]);
    await pg.query(`insert into lead_conversions (employee_id, period_month, converted_count, review_status) values ($1, $2, 11, 'approved')`, [who.rep, m]);
    await pg.query(`insert into client_meetings (employee_id, period_month, potential_band, awarded_paise, review_status) values ($1, $2, 'high', $3, 'approved'), ($1, $2, 'low', 0, 'approved')`, [who.rep, m, RS(1_500)]);
    // The old engine's testimonials (still recorded) earn nothing in Category F/2; verified Google reviews do (0137).
    await pg.query(`insert into testimonials (employee_id, period_month, kind, word_count, star_rating, names_team_member, evidence_url, review_status) values ($1, $2, 'google_review', 60, 5, false, 'x.png', 'approved'), ($1, $2, 'letterhead', 0, null, true, null, 'approved'), ($1, $2, 'google_review', 20, 5, false, 'y.png', 'approved')`, [who.rep, m]);
    await verifiedReview(m, 1, 60, [who.rep], null);
    await verifiedReview(m, 2, 20, [who.rep], null);
    // Forms: a new customer's first three orders (Apr, May, Jun 2026 — ₹1 L taxable each), invoiced and paid on time.
    const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('New Co', $1, 30) returning id`, [who.rep])).id;
    const batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 't.xlsx', 'x') returning id`)).id;
    const doc = async (type: string, no: string, date: string, total: number, taxable: number, ref: string | null, due: string | null) =>
      (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2026-27', 'New Co', 'new co', $6, $7, $8, $9, $10, '[]'::jsonb, $11, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, cust, total, taxable, ref, due, batch])).id;
    for (const [n, d] of [[1, "2026-04-10"], [2, "2026-05-10"], [3, "2026-06-10"]] as const) {
      const so = await doc("sales-orders", `SO ${n}`, d, RS(1_18_000), RS(1_00_000), null, null);
      const due = new Date(Date.parse(`${d}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
      const inv = await doc("sales-invoices", `INV ${n}`, d, RS(1_18_000), RS(1_00_000), so, due);
      await doc("customer-receipts", `RC ${n}`, due, RS(1_18_000), RS(1_18_000), inv, null);
    }
  });
  it("only the run permission calculates", async () => {
    for (const k of ["plainAdmin", "locker", "rep"] as const) {
      signIn(k);
      await expect(act.calculateCategoryAMonth({ programId, month: JUN, asOf: "2026-07-31", category: "D" })).rejects.toThrow("Forbidden");
    }
  });
  it("each category calculates its own month, with the old engine's rules as configured", async () => {
    signIn("runner");
    const payable: Record<string, string> = {};
    for (const c of ["C", "D", "E", "F"] as const) {
      const r = await act.calculateCategoryAMonth({ programId, month: JUN, asOf: "2026-07-31", category: c });
      expect(r, c).toMatchObject({ ok: true, status: "computed", adopted: true });
      payable[c] = (await one<{ p: string }>(`select r.payable_paise::text p from incentive_calc_results r join incentive_calc_periods per on per.current_run_id = r.run_id where per.category_code = $1`, [c])).p;
    }
    // C: 1% × ₹3,00,000 = ₹3,000. D: 25 profiled → 2 × ₹250 + 11 enquiries → 2 × ₹250 = ₹1,000. E (category-e/2):
    // ₹1,500 → ₹1,000; the ₹0 award is LEFT OUT (it used to be raised to ₹250) = ₹1,000, within the template's PDF
    // monthly limit for E. F (Google reviews, F/2): one verified review naming the salesperson, ₹100 (TEST base) + ₹100
    // named = ₹200; the 20-word review is left out; the old engine's testimonials earn nothing here.
    expect(payable).toEqual({ C: String(RS(3_000)), D: String(RS(1_000)), E: String(RS(1_000)), F: String(RS(200)) });
    expect(Number((await one<{ n: number }>(`select count(*)::int n from incentive_calc_items`)).n)).toBe(1 + 2 + 1 + 1);
    expect((await calc.monthView(programId, JUN, undefined, "E")).excludedNotes!.map((x) => x.message).join(" ")).toMatch(/award of ₹0 .* never raised to the smallest award/);
    const view = await calc.monthView(programId, JUN, undefined, "F");
    expect(view.excludedNotes!.map((x) => x.message).join(" ")).toMatch(/20 words/);
  });
  it("the stored run reproduces itself", async () => {
    const { calculateCategoryX } = await import("@/lib/incentives/categories/engine");
    const { resultHashX } = await import("@/lib/incentives/categories/hash");
    for (const r of await q1<{ inputs: never; result_hash: string }>(`select inputs, result_hash from incentive_calc_runs where category_code in ('C','D','E','F')`)) expect(resultHashX(calculateCategoryX(r.inputs))).toBe(r.result_hash);
  });
});

describe("approval, payout and the salesperson's own figures", () => {
  it("each category is locked, submitted, approved and paid on its own; the salesperson sees it only then", async () => {
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: JUN, lock: true, rowVersion: await rv("D"), category: "D" })).toMatchObject({ ok: true });
    // D was calculated before C, E and F changed the shared figures; with "No limit" they don't change D's result, so
    // D can be submitted as calculated.
    expect(await act.submitCategoryAMonth({ programId, month: JUN, rowVersion: await rv("D"), category: "D" })).toMatchObject({ ok: true, approvalsRequired: 1 });
    expect((await calc.myCategoryA(who.rep, undefined, "D")).months).toEqual([]);
    expect((await calc.myCategoryA(who.rep, undefined, "D")).awaiting).toEqual([JUN]);
    signIn("locker");
    await expect(act.decideCategoryAMonth({ programId, month: JUN, rowVersion: await rv("D"), decision: "approve", reason: null, category: "D" })).rejects.toThrow("Forbidden");
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId, month: JUN, rowVersion: await rv("D"), decision: "approve", reason: null, category: "D" })).toMatchObject({ ok: true, status: "approved" });
    const release = (await one<{ r: string }>(`select release_on::text r from incentive_calc_periods where category_code = 'D' and month = $1`, [JUN])).r;
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId, month: JUN, rowVersion: await rv("D"), reference: "PAY-D-JUN", paidOn: release, amountPaise: RS(1_000), note: null, category: "D" })).toMatchObject({ ok: true });
    expect((await calc.myCategoryA(who.rep, undefined, "D")).months).toEqual([expect.objectContaining({ status: "paid", amountPaise: RS(1_000), payoutReference: "PAY-D-JUN" })]);
    expect(await calc.myCategoryA(who.other, undefined, "D")).toEqual({ ready: true, months: [], awaiting: [], voided: [] });
    // The other categories are still open: their months haven't moved.
    expect(await q1(`select category_code, status from incentive_calc_periods where month = $1 order by 1`, [JUN])).toEqual([{ category_code: "C", status: "open" }, { category_code: "D", status: "paid" }, { category_code: "E", status: "open" }, { category_code: "F", status: "open" }]);
  });
  it("whoever approved a submission a month counts (here: a lead batch) never approves or rejects that month — another approver does", async () => {
    const AUG = "2026-08-01";
    await pg.query(`insert into lead_batches (employee_id, period_month, lead_count, profiled, review_status, reviewed_by_id, reviewed_at) values ($1, '2026-08', 10, true, 'approved', $2, now())`, [who.rep, who.reviewer]);
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: AUG, asOf: "2026-09-30", category: "D" })).toMatchObject({ ok: true, status: "computed", adopted: true });
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: AUG, lock: true, rowVersion: await rv("D", AUG), category: "D" })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId, month: AUG, rowVersion: await rv("D", AUG), category: "D" })).toMatchObject({ ok: true });
    signIn("reviewer");
    for (const decision of ["approve", "reject"] as const)
      expect(await act.decideCategoryAMonth({ programId, month: AUG, rowVersion: await rv("D", AUG), decision, reason: "x", category: "D" })).toMatchObject({ ok: false, error: expect.stringMatching(/You approved or rejected a submission counted in this month's calculation, so you can't approve or reject it/) });
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId, month: AUG, rowVersion: await rv("D", AUG), decision: "approve", reason: null, category: "D" })).toMatchObject({ ok: true, status: "approved" });
  });
});

describe("the old engine's cut-over, per category", () => {
  it("from each published category's month the old engine stops calculating it, keeps its rows, and its payout leaves it out", async () => {
    expect([...(await load.authoritativeCategories("2026-06"))].sort()).toEqual(["C", "D", "E", "F"]);
    expect([...(await load.authoritativeCategories("2026-03"))]).toEqual([]);
    const period = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-06', 'open') returning id`)).id;
    await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref, explanation) values ($1, $2, 'D.1', 'D', 'accrual', 50000, 'leads:earlier', 'kept')`, [who.rep, period]);
    const before = await fp(`select * from incentive_ledger where category = 'D'`);
    const r = await load.computePeriodForEmployee(who.rep, "2026-06", new Date("2026-07-15T00:00:00Z"));
    expect(r.lines.filter((l) => ["C", "D", "E", "F"].includes(l.category))).toEqual([]);
    expect(await fp(`select * from incentive_ledger where category = 'D'`)).toBe(before);
    expect((await incentives.getPeriodPayout("2026-06")).grandTotalPaise).toBe(0);
  });
  it("a category can't be published over a month the old engine already paid it for (no double payment)", async () => {
    const paid = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-09', 'paid') returning id`)).id;
    await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref, explanation) values ($1, $2, 'F.1', 'F', 'accrual', 10000, 'testimonial:old', 'paid by the old engine')`, [who.rep, paid]);
    const published = await fp(`select * from incentive_config_versions where status = 'published'`);
    await expect(publish("F", TEST.F!, "2026-09-01")).rejects.toThrow(/old engine's Category F is already paid for 2026-09.*pay Category F twice/);
    expect(await fp(`select * from incentive_config_versions where status = 'published'`)).toBe(published);
    // Another category with no old-engine amount that month is not held back by F's.
    await publish("D", TEST.D!, "2026-09-01");
    expect(await q1(`select count(*)::int n from incentive_config_versions where category_code = 'D' and status = 'published' and effective_from = '2026-09-01'`)).toEqual([{ n: 1 }]);
  });
  it("a LOCKED old-engine month is protected too, for Category A as for the others; the next month is fine", async () => {
    const locked = (await one<{ id: string }>(`insert into incentive_periods (month, status) values ('2026-10', 'locked') returning id`)).id;
    await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref, explanation) values ($1, $2, 'A.1', 'A', 'accrual', 20000, 'slab:old', 'locked by the old engine'), ($1, $2, 'C.1', 'C', 'accrual', 25000, 'customer:old', 'locked by the old engine')`, [who.rep, locked]);
    await expect(publish("A", {}, "2026-10-01")).rejects.toThrow(/old engine's Category A is already locked for 2026-10.*pay Category A twice/);
    await expect(publish("C", TEST.C!, "2026-10-01")).rejects.toThrow(/old engine's Category C is already locked for 2026-10/);
    await publish("A", {}, "2026-11-01");
    expect(await q1(`select count(*)::int n from incentive_config_versions where category_code = 'A' and status = 'published' and effective_from = '2026-11-01'`)).toEqual([{ n: 1 }]);
  });
  it("before the cut-over (March) the old engine still pays them", async () => {
    await pg.query(`insert into lead_batches (employee_id, period_month, lead_count, profiled, review_status) values ($1, '2026-03', 20, true, 'approved')`, [who.rep]);
    const r = await load.computePeriodForEmployee(who.rep, "2026-03", new Date("2026-04-15T00:00:00Z"));
    expect(r.lines.filter((l) => l.category === "D").map((l) => l.finalPaise)).toEqual([RS(500)]);
  });
});

describe("the rollback once Category C–G data exists", () => {
  it("refuses, and changes nothing", async () => {
    const counts = async () => q1(`select (select count(*)::int from incentive_calc_items) i, (select count(*)::int from incentive_calc_runs) r`);
    const before = await counts();
    await expect(pg.exec(ROLLBACK)).rejects.toThrow(/0135 rollback refused: Category C–G data exists/);
    expect(await counts()).toEqual(before);
    expect(await q1(`select to_regclass('public.incentive_calc_items') is not null ok`)).toEqual([{ ok: true }]);
  });
});

describe("the all-categories limit shared between categories", () => {
  it("a month whose share changed because another category was calculated since can't be submitted until recalculated", async () => {
    // From July a new E version sets a ₹1,200 all-categories limit (a TEST value), shared in proportion.
    await publish("E", { ...TEST.E!, "caps.perEmployeeAllCategoriesMonth": RS(1_200), "caps.allCategoriesPolicy": "proportional" }, "2026-07-01");
    const JUL = "2026-07-01";
    await pg.query(`insert into client_meetings (employee_id, period_month, potential_band, awarded_paise, review_status) values ($1, '2026-07', 'high', $2, 'approved')`, [who.rep, RS(1_000)]);
    // F: a verified review appreciating the salesperson it names (F.1 ₹100 × 2, F.4) and one credited by a confirmed claim (₹100) = ₹300.
    await verifiedReview("2026-07", 1, 60, [who.rep], null);
    await verifiedReview("2026-07", 2, 60, [], who.rep);
    signIn("runner");
    // E first (F not yet calculated: E keeps its ₹1,000), then F (₹300; together ₹1,300 > ₹1,200).
    expect(await act.calculateCategoryAMonth({ programId, month: JUL, asOf: "2026-08-31", category: "E" })).toMatchObject({ ok: true, adopted: true });
    expect(await act.calculateCategoryAMonth({ programId, month: JUL, asOf: "2026-08-31", category: "F" })).toMatchObject({ ok: true, adopted: true });
    const payable = async (c: string) => Number((await one<{ p: string }>(`select r.payable_paise::text p from incentive_calc_results r join incentive_calc_periods per on per.current_run_id = r.run_id where per.category_code = $1 and per.month = $2`, [c, JUL])).p);
    // F takes its proportional share (₹300 × 1,200 / 1,300); E's earlier result still says ₹1,000, so together they are
    // over the limit until E is recalculated — which is why E can't be submitted as it stands.
    expect(await payable("E")).toBe(RS(1_000));
    expect(await payable("F")).toBe(27_692);
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: JUL, lock: true, rowVersion: await rv("E", JUL), category: "E" })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId, month: JUL, rowVersion: await rv("E", JUL), category: "E" })).toMatchObject({ ok: false, error: expect.stringMatching(/other categories' figures .* changed .*recalculate/) });
    expect((await one<{ status: string }>(`select status from incentive_calc_periods where category_code = 'E' and month = $1`, [JUL])).status).toBe("locked");
    // Reopened and recalculated, E takes its share and can be submitted; together they stay within the limit.
    expect(await act.setCategoryAMonthLocked({ programId, month: JUL, lock: false, rowVersion: await rv("E", JUL), category: "E" })).toMatchObject({ ok: true });
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: JUL, asOf: "2026-08-31", category: "E" })).toMatchObject({ ok: true, adopted: true });
    expect(await payable("E") + (await payable("F"))).toBeLessThanOrEqual(RS(1_200));
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: JUL, lock: true, rowVersion: await rv("E", JUL), category: "E" })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId, month: JUL, rowVersion: await rv("E", JUL), category: "E" })).toMatchObject({ ok: true });
  });
  it("…and is checked again at APPROVAL: F changes after E was submitted, so E's approval is refused until it is rejected and recalculated", async () => {
    const JUL = "2026-07-01";
    await verifiedReview("2026-07", 3, 60, [who.rep], null);
    signIn("runner");
    expect(await act.calculateCategoryAMonth({ programId, month: JUL, asOf: "2026-08-31", category: "F" })).toMatchObject({ ok: true, adopted: true });
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId, month: JUL, rowVersion: await rv("E", JUL), decision: "approve", reason: null, category: "E" })).toMatchObject({ ok: false, error: expect.stringMatching(/other categories' figures .* changed .* Reject it so it is recalculated and submitted again\. Nothing was approved/) });
    expect((await one<{ status: string }>(`select status from incentive_calc_periods where category_code = 'E' and month = $1`, [JUL])).status).toBe("submitted");
    expect(await act.decideCategoryAMonth({ programId, month: JUL, rowVersion: await rv("E", JUL), decision: "reject", reason: "F changed: recalculate E's share", category: "E" })).toMatchObject({ ok: true, status: "locked" });
  });
});

describe("Category C: Admin Review, recalculation before payout, recovery after payout (0136)", () => {
  // SYNTHETIC records added to June 2026 for the same new customer as above.
  const newDoc = async (type: string, no: string, date: string, totalRs: number, taxableRs: number, ref: string | null, customer: string | null) => {
    const batch = (await one<{ id: string }>(`select id from tally_import_batches limit 1`)).id;
    return (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2026-27', 'New Co', 'new co', $6, $7, $8, $9, null, '[]'::jsonb, $10, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, RS(totalRs), RS(taxableRs), ref, batch])).id;
  };
  const customer = async () => (await one<{ id: string }>(`select id from customer_masters where name = 'New Co'`)).id;
  const payableC = async () => Number((await one<{ p: string }>(`select r.payable_paise::text p from incentive_calc_results r join incentive_calc_periods per on per.current_run_id = r.run_id where per.category_code = 'C' and per.month = $1`, [JUN])).p);
  const calcC = async () => {
    signIn("runner");
    return act.calculateCategoryAMonth({ programId, month: JUN, asOf: "2026-07-31", category: "C" });
  };
  let unlinked = "";

  it("a Sales Order without a customer is held for review and never qualifies; only the review permission decides, with a reason", async () => {
    unlinked = await newDoc("sales-orders", "SO 77", "2026-06-20", 5_90_000, 5_00_000, null, null);
    expect(await calcC()).toMatchObject({ ok: true });
    const { reviewQueueC } = await import("@/lib/queries/incentive-c-review");
    const q = await reviewQueueC(programId, JUN);
    expect(q.rows.map((r) => [r.caseKind, r.documentNo, r.decidable])).toEqual([["order-customer", "SO 77", true]]);
    // Its Tally party is New Co's and it falls in New Co's window: the acquisition is HELD until it is decided — never
    // counted, never linked by its party alone.
    expect(q.rows[0]!.message).toMatch(/Its Tally party matches New Co/);
    expect(await q1(`select r.payable_paise from incentive_calc_results r join incentive_calc_periods per on per.current_run_id = r.run_id where per.category_code = 'C' and per.month = $1`, [JUN])).toEqual([]);
    const held = await one<{ result: { held: { message: string }[] } }>(`select r.result from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.category_code = 'C' and p.month = $1`, [JUN]);
    expect(held.result.held.map((h) => h.message).join(" ")).toMatch(/New customer New Co: held for review — SO 77 \(2026-06-20\) isn't resolved yet/);
    for (const k of ["runner", "plainAdmin", "rep"] as const) {
      signIn(k);
      await expect(act.recordCategoryCDecision({ documentId: unlinked, caseKind: "order-customer", decision: "exclude", targetId: null, reason: "x" })).rejects.toThrow("Forbidden");
    }
    signIn("reviewer");
    expect(await act.recordCategoryCDecision({ documentId: unlinked, caseKind: "order-customer", decision: "link", targetId: await customer(), reason: "  " })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    expect(await act.recordCategoryCDecision({ documentId: unlinked, caseKind: "order-customer", decision: "link", targetId: null, reason: "Its own order" })).toEqual({ ok: false, error: expect.stringMatching(/Choose what it belongs to/) });
    expect(await act.recordCategoryCDecision({ documentId: unlinked, caseKind: "order-customer", decision: "link", targetId: await customer(), reason: "The customer's own order (PO on file)" })).toMatchObject({ ok: true });
    expect(await act.recordCategoryCDecision({ documentId: unlinked, caseKind: "order-customer", decision: "exclude", targetId: null, reason: "again" })).toEqual({ ok: false, error: expect.stringMatching(/already has a decision/) });
  });

  it("decisions are append-only and retire-not-edit, with history; the next calculation applies the one in force", async () => {
    const [d] = await q1<{ id: string }>(`select id from incentive_calc_c_reviews where document_id = $1`, [unlinked]);
    await expect(pg.query(`update incentive_calc_c_reviews set reason = 'changed' where id = $1`, [d!.id])).rejects.toThrow(/never changes/);
    await expect(pg.query(`delete from incentive_calc_c_reviews where id = $1`, [d!.id])).rejects.toThrow(/never deleted/);
    await expect(pg.query(`insert into incentive_calc_c_reviews (document_id, case_kind, decision, target_id, reason, created_by_name) values ($1, 'invoice-order', 'exclude', null, 'wrong kind', 'x')`, [unlinked])).rejects.toThrow(/names a Forms record of the kind/);
    signIn("reviewer");
    expect(await act.retireCategoryCDecision({ id: d!.id, reason: "Linked to the wrong customer" })).toMatchObject({ ok: true });
    expect(await act.recordCategoryCDecision({ documentId: unlinked, caseKind: "order-customer", decision: "exclude", targetId: null, reason: "A sample order, not a sale" })).toMatchObject({ ok: true });
    expect((await q1<{ action: string }>(`select action from incentive_calc_input_history where entity = 'c-review' order by event_no`)).map((x) => x.action)).toEqual(["record", "retire", "record"]);
    expect(await calcC()).toMatchObject({ ok: true });
    const run = await one<{ result: { reviewCases: unknown[]; excluded: { message: string }[] } }>(`select r.result from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.category_code = 'C' and p.month = $1`, [JUN]);
    expect(run.result.reviewCases).toEqual([]);
    expect(run.result.excluded.map((x) => x.message).join(" ")).toMatch(/Sales Order SO 77 is excluded by an admin's review decision/);
    expect(await payableC()).toBe(RS(3_000)); // excluded: the acquisition is no longer held
  });

  it("recalculated before payout: a ₹20,000 credit note on order 2 → ₹2,800 (net)", async () => {
    const inv2 = (await one<{ id: string }>(`select id from tally_documents where document_no = 'INV 2'`)).id;
    await newDoc("credit-notes", "CN 2", "2026-06-25", 23_600, 20_000, inv2, await customer());
    expect(await calcC()).toMatchObject({ ok: true, adopted: true });
    expect(await payableC()).toBe(RS(2_800));
  });

  it("whoever decided a review case of the month never approves it (service and database); another approver can; then it is paid", async () => {
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: JUN, lock: true, rowVersion: await rv("C"), category: "C" })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId, month: JUN, rowVersion: await rv("C"), category: "C" })).toMatchObject({ ok: true });
    signIn("reviewer");
    expect(await act.decideCategoryAMonth({ programId, month: JUN, rowVersion: await rv("C"), decision: "approve", reason: null, category: "C" })).toEqual({ ok: false, error: expect.stringMatching(/You decided a Category C review case of this month/) });
    const p = await one<{ id: string; current_run_id: string }>(`select id, current_run_id from incentive_calc_periods where category_code = 'C' and month = $1`, [JUN]);
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, 1, 1, 'approve', $3, 'reviewer')`, [p.id, p.current_run_id, who.reviewer])).rejects.toThrow(/never approves or rejects that month/);
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId, month: JUN, rowVersion: await rv("C"), decision: "approve", reason: null, category: "C" })).toMatchObject({ ok: true, status: "approved" });
    const release = (await one<{ r: string }>(`select release_on::text r from incentive_calc_periods where category_code = 'C' and month = $1`, [JUN])).r;
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId, month: JUN, rowVersion: await rv("C"), reference: "PAY-C-JUN", paidOn: release, amountPaise: RS(2_800), note: null, category: "C" })).toMatchObject({ ok: true });
  });

  it("after payout: a ₹60,000 return takes net turnover below ₹2,50,000 — the paid month never changes; the difference is recovered later", async () => {
    const paidBefore = await fp(`select p.*, (select count(*) from incentive_calc_payouts x where x.period_id = p.id) n from incentive_calc_periods p where p.category_code = 'C' and p.month = '2026-06-01'`);
    const inv3 = (await one<{ id: string }>(`select id from tally_documents where document_no = 'INV 3'`)).id;
    await newDoc("credit-notes", "CN 3", "2026-07-05", 70_800, 60_000, inv3, await customer());
    expect(await calcC()).toMatchObject({ ok: true });
    expect(await fp(`select p.*, (select count(*) from incentive_calc_payouts x where x.period_id = p.id) n from incentive_calc_periods p where p.category_code = 'C' and p.month = '2026-06-01'`)).toBe(paidBefore);
    expect(await payableC()).toBe(RS(2_800)); // the paid month's adopted result is untouched
    const adj = await q1<{ amount: string; from_month: string }>(`select amount_paise::text amount, from_month::text from incentive_calc_adjustments where category_code = 'C'`);
    expect(adj).toEqual([expect.objectContaining({ amount: String(-RS(2_800)), from_month: "2026-06-01" })]);
  });
});

describe("Category C: below-minimum carry-forward ledger, shared limit, documents, snapshot (0136)", () => {
  // A separate programme (CARRY) with its own Category C version from November 2026 — the smallest amount paid in a
  // month ₹5,000 (a TEST value) — and SYNTHETIC customers and documents.
  let pid = "";
  const ASOF = "2027-03-31";
  const NOV = "2026-11-01", DEC = "2026-12-01", JAN = "2027-01-01", FEB = "2027-02-01", MAR = "2027-03-01";
  async function publishIn(category: CategoryCode, settings: Record<string, SettingValue>, from: string) {
    const c = completeConfig({}, [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], category);
    const config = { ...c, settings: { ...c.settings, "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none", ...settings } };
    const d = await rules.createDraft(actor("author"), { programId: pid, category, startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, from, { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
  }
  const doc = async (type: string, no: string, date: string, totalRs: number, taxableRs: number, ref: string | null, customer: string | null, party: string, due: string | null = null) => {
    const batch = (await one<{ id: string }>(`select id from tally_import_batches limit 1`)).id;
    return (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2026-27', $6, $7, $8, $9, $10, $11, $12, '[]'::jsonb, $13, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, party, party.toLowerCase(), customer, RS(totalRs), RS(taxableRs), ref, due, batch])).id;
  };
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  /** A new customer's three ₹1 L orders, invoiced on their dates (due 30 days later) and paid on the due date. */
  const acquisition = async (name: string, dates: string[]) => {
    const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ($1, $2, 30) returning id`, [name, who.rep])).id;
    for (const [k, d] of dates.entries()) {
      const so = await doc("sales-orders", `${name} SO ${k + 1}`, d, 1_18_000, 1_00_000, null, cust, name);
      const inv = await doc("sales-invoices", `${name} INV ${k + 1}`, d, 1_18_000, 1_00_000, so, cust, name, addDays(d, 30));
      await doc("customer-receipts", `${name} RC ${k + 1}`, addDays(d, 30), 1_18_000, 1_18_000, inv, cust, name);
    }
    return cust;
  };
  const per = async (cat: string, month: string) => one<{ id: string; row_version: number; release_on: string | null; current_run_id: string }>(`select id, row_version, release_on::text, current_run_id from incentive_calc_periods where program_id = $1 and category_code = $2 and month = $3`, [pid, cat, month]);
  const calcIn = async (cat: string, month: string) => {
    signIn("runner");
    const r = await onDay(ASOF, () => act.calculateCategoryAMonth({ programId: pid, month, asOf: ASOF, category: cat as never }));
    if (!r.ok && !/saved at the same moment/.test(r.error)) throw new Error(`calculation refused: ${r.error}`);
    return r;
  };
  const lockSubmitApprove = async (cat: string, month: string) => {
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId: pid, month, lock: true, rowVersion: Number((await per(cat, month)).row_version), category: cat as never })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId: pid, month, rowVersion: Number((await per(cat, month)).row_version), category: cat as never })).toMatchObject({ ok: true });
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId: pid, month, rowVersion: Number((await per(cat, month)).row_version), decision: "approve", reason: null, category: cat as never })).toMatchObject({ ok: true, status: "approved" });
  };
  const pay = async (cat: string, month: string, amountPaise: number) => {
    const p = await per(cat, month);
    signIn("payer");
    return act.recordCategoryAPayout({ programId: pid, month, rowVersion: Number(p.row_version), reference: `PAY-${cat}-${month.slice(0, 7)}`, paidOn: p.release_on!, amountPaise, note: null, category: cat as never });
  };
  const ledger = async () => q1<{ kind: string; month: string; amount: string; lot: string | null }>(`select kind, month::text, amount_paise::text amount, lot_id::text lot from incentive_calc_carry where program_id = $1 order by created_at, kind`, [pid]);

  beforeAll(async () => {
    const p = await rules.createProgram(actor("author"), { code: "CARRY", name: "Carry-forward test", description: null });
    if (!p.ok) throw new Error(p.error);
    pid = p.programId;
    await publishIn("C", { ...TEST.C, "payout.minimumPayable": RS(5_000) }, NOV);
    await acquisition("Carry One", ["2026-09-05", "2026-10-05", "2026-11-05"]); // completes in November: ₹3,000
    await acquisition("Carry Two", ["2026-10-10", "2026-11-10", "2026-12-10"]); // completes in December: ₹3,000
    await acquisition("Carry Three", ["2026-12-15", "2027-01-15", "2027-02-15"]); // completes in February: ₹3,000
  }, 120_000);

  it("calculations run in ONE consistent snapshot (REPEATABLE READ); a serialization failure is retried, then reported — nothing saved", async () => {
    const real = (h.db as { transaction: (...a: unknown[]) => unknown }).transaction.bind(h.db);
    const seen: unknown[] = [];
    (h.db as { transaction: unknown }).transaction = (fn: unknown, config: unknown) => {
      seen.push(config);
      return real(fn, config);
    };
    try {
      expect(await calcIn("C", NOV)).toMatchObject({ ok: true });
      expect(seen[0]).toEqual({ isolationLevel: "repeatable read" });
      // Inside it, the database really is at REPEATABLE READ.
      const level = await real(async (tx: { execute: (q: unknown) => Promise<unknown> }) => tx.execute(sql`select current_setting('transaction_isolation') as l`), { isolationLevel: "repeatable read" });
      expect(JSON.stringify(level)).toMatch(/repeatable read/);
      // Twice a serialization failure, then success: retried. Three times: an actionable error, and no run is saved.
      let fail = 2;
      (h.db as { transaction: unknown }).transaction = (fn: unknown, config: unknown) => (fail-- > 0 ? Promise.reject(Object.assign(new Error("could not serialize access"), { code: "40001" })) : real(fn, config));
      expect(await calcIn("C", DEC)).toMatchObject({ ok: true });
      const runs = Number((await one<{ n: number }>(`select count(*)::int n from incentive_calc_runs where program_id = $1`, [pid])).n);
      (h.db as { transaction: unknown }).transaction = () => Promise.reject(Object.assign(new Error("deadlock"), { cause: { code: "40P01" } }));
      expect(await calcIn("C", JAN)).toEqual({ ok: false, error: expect.stringMatching(/saved at the same moment, so nothing was calculated or saved\. Calculate again/) });
      expect(Number((await one<{ n: number }>(`select count(*)::int n from incentive_calc_runs where program_id = $1`, [pid])).n)).toBe(runs);
    } finally {
      (h.db as { transaction: unknown }).transaction = real;
    }
  });

  it("below the minimum, November's ₹3,000 is held (nothing released), visible and explained", async () => {
    expect(await calcIn("C", NOV)).toMatchObject({ ok: true });
    const r = await one<{ payable_paise: string; explanation: string[] }>(`select payable_paise::text, explanation from incentive_calc_results where run_id = $1`, [(await per("C", NOV)).current_run_id]);
    expect(r.payable_paise).toBe("0");
    expect(r.explanation.join(" ")).toMatch(/The month's total ₹3,000 is below the smallest amount paid in a month \(₹5,000\): nothing is released; it is carried forward/);
  });

  const lock = async (month: string, on = true) => {
    signIn("locker");
    return act.setCategoryAMonthLocked({ programId: pid, month, lock: on, rowVersion: Number((await per("C", month)).row_version), category: "C" });
  };
  const submit = async (month: string) => {
    signIn("locker");
    return act.submitCategoryAMonth({ programId: pid, month, rowVersion: Number((await per("C", month)).row_version), category: "C" });
  };
  const approve = async (month: string) => {
    signIn("a1");
    return act.decideCategoryAMonth({ programId: pid, month, rowVersion: Number((await per("C", month)).row_version), decision: "approve", reason: null, category: "C" });
  };

  it("(1) a later month is never SUBMITTED before an earlier one is paid or voided — so it can't be approved on a carry-forward that will change", async () => {
    // December calculated before November is paid: no balance yet, so it would hold only its own ₹3,000.
    expect(await calcIn("C", DEC)).toMatchObject({ ok: true });
    expect(await lock(DEC)).toMatchObject({ ok: true });
    expect(await submit(DEC)).toEqual({ ok: false, error: expect.stringMatching(/Submit Category C's months in order: 2026-11 isn't paid or voided yet/) });
    expect((await per("C", DEC)).row_version).toBe(Number((await per("C", DEC)).row_version)); // nothing changed
    expect((await one<{ status: string }>(`select status from incentive_calc_periods where program_id = $1 and category_code = 'C' and month = $2`, [pid, DEC])).status).toBe("locked");
  });

  it("(2) paying November writes its held balance once; (3) December's frozen carry-forward is now STALE (a balance appeared): submission refused until it is recalculated", async () => {
    await lockSubmitApprove("C", NOV);
    expect(await pay("C", NOV, 0)).toMatchObject({ ok: true });
    expect(await ledger()).toEqual([expect.objectContaining({ kind: "held", month: NOV, amount: String(RS(3_000)), lot: null })]);
    expect(await submit(DEC)).toEqual({ ok: false, error: expect.stringMatching(/The carried-forward balances or the adjustments carried into 2026-12 changed since this month was calculated: reopen and recalculate it/) });
  });

  it("(4) recalculated, December SEES November's balance — ₹3,000 + ₹3,000 reaches the minimum and is released at once (no delayed release); earned_exact is the available total", async () => {
    expect(await lock(DEC, false)).toMatchObject({ ok: true });
    expect(await calcIn("C", DEC)).toMatchObject({ ok: true, adopted: true });
    const r = await one<{ payable_paise: string; earned_paise: string; earned_exact: string; payable_exact: string }>(`select payable_paise::text, earned_paise::text, earned_exact, payable_exact from incentive_calc_results where run_id = $1`, [(await per("C", DEC)).current_run_id]);
    expect(r).toEqual({ payable_paise: String(RS(6_000)), earned_paise: String(RS(6_000)), earned_exact: String(RS(6_000)), payable_exact: String(RS(6_000)) });
  });

  it("(5) January, calculated while December is unpaid, counts November's balance; it can't be submitted until December is paid; (6) after December's payout it is stale, recalculated, and paid in order — no deadlock", async () => {
    expect(await calcIn("C", JAN)).toMatchObject({ ok: true });
    const janCarry = await one<{ inputs: { carry: { lots: { remainingPaise: number }[] }[] } }>(`select inputs from incentive_calc_runs where id = $1`, [(await per("C", JAN)).current_run_id]);
    expect(janCarry.inputs.carry.flatMap((c) => c.lots.map((l) => l.remainingPaise))).toEqual([RS(3_000)]);
    expect(await lock(JAN)).toMatchObject({ ok: true });
    expect(await submit(JAN)).toEqual({ ok: false, error: expect.stringMatching(/Submit Category C's months in order: 2026-12 isn't paid or voided yet/) });
    await lockSubmitApprove("C", DEC);
    expect(await pay("C", DEC, RS(5_000))).toEqual({ ok: false, error: expect.stringMatching(/doesn't match the approved amount \(₹6000\.00\)/) });
    expect(await pay("C", DEC, RS(6_000))).toMatchObject({ ok: true });
    expect((await ledger()).filter((x) => x.kind === "released").map((x) => [x.month, x.amount])).toEqual([[DEC, String(-RS(3_000))]]);
    // January counted a balance December has now released: stale, so it is reopened and recalculated — never paid twice.
    expect(await submit(JAN)).toEqual({ ok: false, error: expect.stringMatching(/changed since this month was calculated/) });
    expect(await lock(JAN, false)).toMatchObject({ ok: true });
    expect(await calcIn("C", JAN)).toMatchObject({ ok: true, adopted: true });
    expect(await lock(JAN)).toMatchObject({ ok: true });
    expect(await submit(JAN)).toMatchObject({ ok: true });
    expect(await approve(JAN)).toMatchObject({ ok: true, status: "approved" });
    expect(await pay("C", JAN, 0)).toMatchObject({ ok: true });
    expect((await calc.carryBalances(pid, "C")).map((b) => [b.month, b.remainingPaise])).toEqual([[NOV, 0]]);
  });

  it("a held amount uses none of the shared all-categories limit: Category E keeps its full ₹1,000 beside a held ₹3,000 under a ₹3,500 limit", async () => {
    await publishIn("E", { ...TEST.E, "caps.perEmployeeAllCategoriesMonth": RS(3_500), "caps.allCategoriesPolicy": "proportional" }, NOV);
    await pg.query(`insert into client_meetings (employee_id, period_month, potential_band, awarded_paise, review_status) values ($1, '2026-11', 'high', $2, 'approved')`, [who.rep, RS(1_000)]);
    expect(await calcIn("E", NOV)).toMatchObject({ ok: true });
    const e = await one<{ payable_paise: string }>(`select payable_paise::text from incentive_calc_results where run_id = $1`, [(await per("E", NOV)).current_run_id]);
    expect(e.payable_paise).toBe(String(RS(1_000)));
    const shared = await one<{ inputs: { allCategories: { others: Record<string, { category: string; finalPaise: number }[]> } } }>(`select inputs from incentive_calc_runs where id = $1`, [(await per("E", NOV)).current_run_id]);
    expect(shared.inputs.allCategories.others[who.rep]).toEqual([expect.objectContaining({ category: "C", finalPaise: 0 })]);
  });

  it("a balance can't be used twice, edited or deleted; a balance a pending month counts can't be written off", async () => {
    const [novLot] = await q1<{ id: string }>(`select id from incentive_calc_carry where program_id = $1 and kind = 'held' and month = $2`, [pid, NOV]);
    const p = await per("C", JAN);
    await expect(pg.query(`insert into incentive_calc_carry (program_id, category_code, employee_id, employee_name, month, kind, amount_paise, lot_id, period_id, run_id, created_by_name) values ($1, 'C', $2, 'rep', $3, 'released', -100, $4, $5, $6, 'x')`, [pid, who.rep, JAN, novLot!.id, p.id, p.current_run_id])).rejects.toThrow(/used only once|duplicate key/);
    await expect(pg.query(`update incentive_calc_carry set amount_paise = 1 where id = $1`, [novLot!.id])).rejects.toThrow();
    await expect(pg.query(`delete from incentive_calc_carry where id = $1`, [novLot!.id])).rejects.toThrow();
    // February holds Carry Three's ₹3,000 (paid in order); March counts it — so it can't be written off meanwhile.
    expect(await calcIn("C", FEB)).toMatchObject({ ok: true });
    await lockSubmitApprove("C", FEB);
    expect(await pay("C", FEB, 0)).toMatchObject({ ok: true });
    expect(await calcIn("C", MAR)).toMatchObject({ ok: true });
    expect(await lock(MAR)).toMatchObject({ ok: true });
    const [febLot] = await q1<{ id: string }>(`select id from incentive_calc_carry where program_id = $1 and kind = 'held' and month = $2`, [pid, FEB]);
    signIn("payer");
    expect(await act.writeOffCategoryCarry({ lotId: febLot!.id, reason: "Test" })).toEqual({ ok: false, error: expect.stringMatching(/2027-03 counts this balance and awaits payout/) });
  });

  it("ledger: one held balance per salesperson per payout by IDENTITY (two people sharing a name both hold); an offset and an expiry of one balance in one payout are two entries, never more than remains", async () => {
    const p = await per("C", JAN);
    const twin = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('rep', 'rep-twin@example.test', 'both', false) returning id`)).id;
    const held = (e: string, amount: number) => pg.query<{ id: string }>(`insert into incentive_calc_carry (program_id, category_code, employee_id, employee_name, month, kind, amount_paise, period_id, run_id, created_by_name) values ($1, 'C', $2, 'rep', $3, 'held', $4, $5, $6, 'fixture') returning id`, [pid, e, JAN, amount, p.id, p.current_run_id]);
    const a = (await held(who.rep, 1_000)).rows[0]!.id;
    await held(twin, 1_000); // same name, another person: allowed
    await expect(held(who.rep, 1_000)).rejects.toThrow(/duplicate key/); // the same person twice in one payout: refused
    const use = (kind: string, amount: number) => pg.query(`insert into incentive_calc_carry (program_id, category_code, employee_id, employee_name, month, kind, amount_paise, lot_id, period_id, run_id, created_by_name) values ($1, 'C', $2, 'rep', $3, $4, $5, $6, $7, $8, 'fixture')`, [pid, who.rep, JAN, kind, amount, a, p.id, p.current_run_id]);
    await use("offset", -400);
    await use("expired", -600); // the rest of the same balance, in the same payout
    await expect(use("released", -1)).rejects.toThrow(/used only once: 0 paise remain/);
    await expect(use("offset", -1)).rejects.toThrow(/duplicate key|used only once/);
  });

  it("a write-off takes TWO people with the payout right (0141): a request with a reason, then another person's approval or refusal with a reason; every step is kept", async () => {
    const p = await per("C", JAN);
    const lot = (await one<{ id: string }>(`insert into incentive_calc_carry (program_id, category_code, employee_id, employee_name, month, kind, amount_paise, period_id, run_id, created_by_name) values ($1, 'C', $2, 'other', $3, 'held', 70000, $4, $5, 'fixture') returning id`, [pid, who.other, JAN, p.id, p.current_run_id])).id;
    signIn("runner");
    await expect(act.writeOffCategoryCarry({ lotId: lot, reason: "x" })).rejects.toThrow("Forbidden");
    signIn("payer");
    expect(await act.writeOffCategoryCarry({ lotId: lot, reason: "  " })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    const first = await act.writeOffCategoryCarry({ lotId: lot, reason: "Left the company; balance forgone as agreed" });
    expect(first).toEqual({ ok: true, requestId: expect.any(String), amountPaise: 70000 });
    // Nothing is written off yet; a second request for the same balance waits for the first one's decision.
    expect(await q1(`select kind from incentive_calc_carry where lot_id = $1`, [lot])).toEqual([]);
    expect(await act.writeOffCategoryCarry({ lotId: lot, reason: "again" })).toEqual({ ok: false, error: expect.stringMatching(/already awaits its second approval/) });
    const req1 = (first as { requestId: string }).requestId;
    // The requester never decides their own request — service and database.
    expect(await act.decideCategoryCarryWriteOff({ requestId: req1, decision: "approve", reason: "mine" })).toEqual({ ok: false, error: expect.stringMatching(/You requested this write-off: a second person/) });
    await expect(pg.query(`insert into incentive_calc_carry_writeoffs (kind, request_id, lot_id, employee_id, employee_name, amount_paise, reason, created_by_id, created_by_name) values ('refuse', $1, $2, $3, 'other', 70000, 'self', $4, 'payer')`, [req1, lot, who.other, who.payer])).rejects.toThrow(/never whoever requested it/);
    signIn("runner");
    await expect(act.decideCategoryCarryWriteOff({ requestId: req1, decision: "approve", reason: "x" })).rejects.toThrow("Forbidden");
    // A second person refuses it (with the reason): nothing is written off.
    signIn("payer2");
    expect(await act.decideCategoryCarryWriteOff({ requestId: req1, decision: "refuse", reason: " " })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason for your decision/) });
    expect(await act.decideCategoryCarryWriteOff({ requestId: req1, decision: "refuse", reason: "Check the exit settlement first" })).toEqual({ ok: true, amountPaise: 0 });
    expect(await act.decideCategoryCarryWriteOff({ requestId: req1, decision: "approve", reason: "changed my mind" })).toEqual({ ok: false, error: expect.stringMatching(/already decided/) });
    expect(await q1(`select kind from incentive_calc_carry where lot_id = $1`, [lot])).toEqual([]);
    // Asked again (now by payer2), approved by the other person: written off once, with both reasons.
    const second = await act.writeOffCategoryCarry({ lotId: lot, reason: "Exit settlement signed; balance forgone" });
    expect(second).toMatchObject({ ok: true, amountPaise: 70000 });
    signIn("payer");
    expect(await act.decideCategoryCarryWriteOff({ requestId: (second as { requestId: string }).requestId, decision: "approve", reason: "Settlement seen" })).toEqual({ ok: true, amountPaise: 70000 });
    expect(await q1(`select kind, amount_paise::int a, created_by_name, reason from incentive_calc_carry where lot_id = $1`, [lot])).toEqual([{ kind: "written-off", a: -70000, created_by_name: "payer", reason: "Exit settlement signed; balance forgone (requested by payer2; approved by payer: Settlement seen)" }]);
    expect(await q1(`select kind, amount_paise::int a, created_by_name from incentive_calc_carry_writeoffs where lot_id = $1 order by created_at`, [lot])).toEqual([
      { kind: "request", a: 70000, created_by_name: "payer" },
      { kind: "refuse", a: 70000, created_by_name: "payer2" },
      { kind: "request", a: 70000, created_by_name: "payer2" },
      { kind: "approve", a: 70000, created_by_name: "payer" },
    ]);
    expect((await q1<{ action: string }>(`select action from incentive_audit where entity_type = 'incentive-calc-carry' and entity_id = $1 order by created_at`, [lot])).map((x) => x.action)).toEqual(["carry-write-off-requested", "carry-write-off-refused", "carry-write-off-requested", "carry-write-off-approved"]);
    const shown = (await calc.carryBalances(pid, "C")).find((b) => b.lotId === lot)!;
    expect(shown).toMatchObject({ remainingPaise: 0, writeOffRequest: null });
    expect(shown.writeOffs!.map((w) => w.kind)).toEqual(["request", "refuse", "request", "approve"]);
    signIn("payer2");
    expect(await act.writeOffCategoryCarry({ lotId: lot, reason: "again" })).toEqual({ ok: false, error: "Nothing of that balance is left." });
    // History is append-only; and the ledger never takes a write-off without an approved request behind it (0141).
    await expect(pg.query(`update incentive_calc_carry_writeoffs set reason = 'changed' where lot_id = $1`, [lot])).rejects.toThrow(/append-only/);
    await expect(pg.query(`delete from incentive_calc_carry_writeoffs where lot_id = $1`, [lot])).rejects.toThrow(/append-only/);
    const other = (await one<{ id: string }>(`insert into incentive_calc_carry (program_id, category_code, employee_id, employee_name, month, kind, amount_paise, period_id, run_id, created_by_name) values ($1, 'C', $2, 'plainAdmin', $3, 'held', 1000, $4, $5, 'fixture') returning id`, [pid, who.plainAdmin, JAN, p.id, p.current_run_id])).id;
    await expect(pg.query(`insert into incentive_calc_carry (program_id, category_code, employee_id, employee_name, month, kind, amount_paise, lot_id, reason, created_by_name) values ($1, 'C', $2, 'plainAdmin', $3, 'written-off', -1000, $4, 'one person alone', 'payer')`, [pid, who.plainAdmin, JAN, other])).rejects.toThrow(/written off only with a second person's approval/);
    expect(await q1(`select kind from incentive_calc_carry where lot_id = $1`, [other])).toEqual([]);
    await expect(pg.exec(ROLLBACK_0141)).rejects.toThrow(/0141 rollback refused/);
  });

  it("documents are followed through every reference (order → invoice → credit note, whatever their customer link); an unlinked invoice of the same Tally party is proposed for review", async () => {
    const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Chain Co', $1, 30) returning id`, [who.rep])).id;
    const so = await doc("sales-orders", "Chain SO 1", "2027-02-05", 1_18_000, 1_00_000, null, cust, "Chain Co");
    const inv = await doc("sales-invoices", "Chain INV 1", "2027-02-05", 1_18_000, 1_00_000, so, null, "Chain Co Ltd", "2027-03-07");
    const cn = await doc("credit-notes", "Chain CN 1", "2027-02-10", 11_800, 10_000, inv, null, "Chain Co Ltd");
    const stray = await doc("sales-invoices", "Chain INV 9", "2027-02-12", 59_000, 50_000, null, null, "Chain Co");
    const { loadInputX } = await import("@/lib/queries/incentive-calc-x");
    const input = await loadInputX(h.db as never, "C", pid, "2027-02-01", ASOF);
    expect(input.invoices!.map((i) => i.id).filter((x) => [inv, stray].includes(x)).sort()).toEqual([inv, stray].sort());
    expect(input.creditNotes!.map((c) => c.id)).toEqual([cn]);
    expect(input.partyKeys).toMatchObject({ [stray]: "chain co" });
    expect(input.customerPartyKeys![cust]).toEqual(["chain co"]);
  });

  it("0136's rollback refuses while the carry-forward ledger holds anything", async () => {
    await expect(pg.exec(ROLLBACK_0136)).rejects.toThrow(/0136 rollback refused: data only 0136 allows exists \(Category C review decisions, their history, carry-forward ledger entries/);
    expect(await q1(`select to_regclass('public.incentive_calc_carry') is not null ok`)).toEqual([{ ok: true }]);
  });
});

describe("Category C: Void month, the global unattributed-records queue, the reference limit (0136)", () => {
  // Two more programmes: VOIDS (a minimum payable ₹5,000, months paid in order) and QUEUE (no minimum) — Category C from
  // January 2029 — and SYNTHETIC customers and documents dated 2029 and later (outside the earlier tests' ranges).
  const ASOF = "2029-12-31";
  const APR = "2029-04-01", MAY = "2029-05-01", JUN29 = "2029-06-01", JUL = "2029-07-01", AUG = "2029-08-01", OCT = "2029-10-01";
  let vid = "", qid = "", voidOne = "";
  const doc = async (type: string, no: string, date: string, totalRs: number, ref: string | null, customer: string | null, party: string, due: string | null = null) => {
    const batch = (await one<{ id: string }>(`select id from tally_import_batches limit 1`)).id;
    return (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2029-30', $6, $7, $8, $9, $10, $11, $12, '[]'::jsonb, $13, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, party, party.toLowerCase(), customer, RS(totalRs), RS(Math.round(totalRs / 1.18)), ref, due, batch])).id;
  };
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const acquisition = async (name: string, dates: string[]) => {
    const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ($1, $2, 30) returning id`, [name, who.rep])).id;
    const sos: string[] = [];
    for (const [k, d] of dates.entries()) {
      const so = await doc("sales-orders", `${name} SO ${k + 1}`, d, 1_18_000, null, cust, name);
      const inv = await doc("sales-invoices", `${name} INV ${k + 1}`, d, 1_18_000, so, cust, name, plus(d, 30));
      await doc("customer-receipts", `${name} RC ${k + 1}`, plus(d, 30), 1_18_000, inv, cust, name);
      sos.push(so);
    }
    return { cust, sos };
  };
  async function publishIn(program: string, settings: Record<string, SettingValue>, from: string) {
    const c = completeConfig({}, [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], "C");
    const config = { ...c, settings: { ...c.settings, "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none", ...settings } };
    const d = await rules.createDraft(actor("author"), { programId: program, category: "C", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, from, { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
  }
  const per = async (program: string, month: string) => one<{ id: string; row_version: number; status: string; release_on: string | null; current_run_id: string }>(`select id, row_version, status, release_on::text, current_run_id from incentive_calc_periods where program_id = $1 and category_code = 'C' and month = $2`, [program, month]);
  const rvOf = async (program: string, month: string) => Number((await per(program, month)).row_version);
  const calcC = async (program: string, month: string) => {
    signIn("runner");
    return onDay(ASOF, () => act.calculateCategoryAMonth({ programId: program, month, asOf: ASOF, category: "C" }));
  };
  const lockC = async (program: string, month: string, on = true) => {
    signIn("locker");
    return act.setCategoryAMonthLocked({ programId: program, month, lock: on, rowVersion: await rvOf(program, month), category: "C" });
  };
  const submitC = async (program: string, month: string) => {
    signIn("locker");
    return act.submitCategoryAMonth({ programId: program, month, rowVersion: await rvOf(program, month), category: "C" });
  };
  const approveC = async (program: string, month: string) => {
    signIn("a1");
    return act.decideCategoryAMonth({ programId: program, month, rowVersion: await rvOf(program, month), decision: "approve", reason: null, category: "C" });
  };
  const payC = async (program: string, month: string, amountPaise = 0) => {
    const p = await per(program, month);
    signIn("payer");
    return act.recordCategoryAPayout({ programId: program, month, rowVersion: Number(p.row_version), reference: `PAY-${month}`, paidOn: p.release_on!, amountPaise, note: null, category: "C" });
  };
  const voidC = async (month: string, reason: string, rowVersion?: number) => {
    signIn("voider");
    return act.voidCategoryCMonth({ programId: vid, month, rowVersion: rowVersion ?? (await rvOf(vid, month)), category: "C", reason });
  };

  beforeAll(async () => {
    for (const [code, name] of [["VOIDS", "Void test"], ["QUEUE", "Queue test"]] as const) {
      const p = await rules.createProgram(actor("author"), { code, name, description: null });
      if (!p.ok) throw new Error(p.error);
      if (code === "VOIDS") vid = p.programId;
      else qid = p.programId;
    }
    await publishIn(vid, { ...TEST.C, "payout.minimumPayable": RS(5_000) }, "2029-01-01");
    await publishIn(qid, { ...TEST.C, "payout.minimumPayable": "none" }, "2029-01-01");
    voidOne = (await acquisition("Void One", ["2029-02-05", "2029-03-05", "2029-04-05"])).cust; // completes in April: ₹3,000
  }, 120_000);

  it("only the Void permission voids, always with a reason; a month with no calculation has nothing to void", async () => {
    for (const k of ["runner", "locker", "payer", "plainAdmin"] as const) {
      signIn(k);
      await expect(act.voidCategoryCMonth({ programId: vid, month: APR, rowVersion: 1, category: "C", reason: "x" })).rejects.toThrow("Forbidden");
    }
    expect(await voidC(APR, "Abandoned", 1)).toEqual({ ok: false, error: expect.stringMatching(/hasn't been calculated yet: there is nothing to void/) });
    signIn("voider");
    expect(await act.voidCategoryCMonth({ programId: vid, month: APR, rowVersion: 1, category: "D", reason: "x" })).toEqual({ ok: false, error: expect.stringMatching(/Only a Category C month is voided/) });
  });

  it("an abandoned OPEN month is voided with a reason: its ₹3,000 goes to the next (open) month as an adjustment, its runs are kept, and it never calculates, locks or submits again", async () => {
    expect(await calcC(vid, APR)).toMatchObject({ ok: true });
    expect(await calcC(vid, MAY)).toMatchObject({ ok: true });
    expect(await lockC(vid, MAY)).toMatchObject({ ok: true });
    expect(await submitC(vid, MAY)).toEqual({ ok: false, error: expect.stringMatching(/Submit Category C's months in order: 2029-04 isn't paid or voided yet/) });
    expect(await voidC(APR, "   ")).toEqual({ ok: false, error: expect.stringMatching(/Give the reason for voiding the month/) });
    // Its amount is carried into May, which must be open.
    expect(await voidC(APR, "Abandoned: the payroll month was cancelled")).toEqual({ ok: false, error: expect.stringMatching(/2029-05 is locked: this month's amounts are carried into it, so reopen it first\. Nothing was voided/) });
    expect(await lockC(vid, MAY, false)).toMatchObject({ ok: true });
    const runsBefore = await fp(`select * from incentive_calc_runs where program_id = '${vid}' and month = '${APR}'`);
    expect(await voidC(APR, "Abandoned: the payroll month was cancelled")).toMatchObject({ ok: true, carriedToMonth: MAY, carriedPaise: RS(3_000) });
    expect(await fp(`select * from incentive_calc_runs where program_id = '${vid}' and month = '${APR}'`)).toBe(runsBefore);
    expect((await per(vid, APR)).status).toBe("open");
    // The salesperson sees it as VOIDED (and where its amount went), never as awaiting approval.
    const mine = await calc.myCategoryA(who.rep, undefined, "C");
    expect(mine.voided).toEqual(expect.arrayContaining([{ month: APR, carriedToMonth: MAY }]));
    expect(mine.awaiting).not.toContain(APR);
    expect(await q1(`select reason, created_by_name, carried_to_month::text c, (summary->>'carriedPaise')::int paise from incentive_calc_period_voids`)).toEqual([{ reason: "Abandoned: the payroll month was cancelled", created_by_name: "voider", c: MAY, paise: RS(3_000) }]);
    expect(await q1(`select kind, from_month::text f, to_month::text t, amount_paise::int a from incentive_calc_adjustments where program_id = $1`, [vid])).toEqual([{ kind: "recalc-difference", f: APR, t: MAY, a: RS(3_000) }]);
    expect((await one<{ n: number }>(`select count(*)::int n from incentive_audit where action = 'voided'`)).n).toBe(1);
    // Voided: never calculated, locked or voided again; the record is never edited or deleted.
    expect(await calcC(vid, APR)).toEqual({ ok: false, error: expect.stringMatching(/This month was voided/) });
    expect(await lockC(vid, APR)).toEqual({ ok: false, error: expect.stringMatching(/This month was voided/) });
    expect(await voidC(APR, "again")).toEqual({ ok: false, error: "This month is already voided." });
    const v = await one<{ id: string; period_id: string }>(`select id, period_id from incentive_calc_period_voids`);
    await expect(pg.query(`update incentive_calc_period_voids set reason = 'changed' where id = $1`, [v.id])).rejects.toThrow();
    await expect(pg.query(`delete from incentive_calc_period_voids where id = $1`, [v.id])).rejects.toThrow();
    await expect(pg.query(`insert into incentive_calc_period_voids (period_id, summary, reason, created_by_name) values ($1, '{}'::jsonb, 'twice', 'x')`, [v.period_id])).rejects.toThrow(/duplicate key/);
  });

  it("a voided month no longer blocks: May (with April's ₹3,000 carried in) is submitted and paid in order, and the amount is held as a balance — never forfeited", async () => {
    expect(await calcC(vid, MAY)).toMatchObject({ ok: true, adopted: true });
    const r = await one<{ payable_paise: string; explanation: string[] }>(`select payable_paise::text, explanation from incentive_calc_results where run_id = $1`, [(await per(vid, MAY)).current_run_id]);
    expect(r.payable_paise).toBe("0");
    expect(r.explanation.join(" ")).toMatch(/Adjustments carried into 2029-05: ₹3,000/);
    expect(await lockC(vid, MAY)).toMatchObject({ ok: true });
    expect(await submitC(vid, MAY)).toMatchObject({ ok: true });
    expect(await approveC(vid, MAY)).toMatchObject({ ok: true, status: "approved" });
    expect(await payC(vid, MAY)).toMatchObject({ ok: true });
    expect((await calc.carryBalances(vid, "C")).map((b) => [b.month, b.remainingPaise])).toEqual([[MAY, RS(3_000)]]);
  });

  it("submitted, approved and paid months are never voided (the database refuses too); a LOCKED month is, and the balances it counted stay carried forward", async () => {
    expect(await calcC(vid, JUN29)).toMatchObject({ ok: true });
    expect(await lockC(vid, JUN29)).toMatchObject({ ok: true });
    expect(await submitC(vid, JUN29)).toMatchObject({ ok: true });
    expect(await voidC(JUN29, "x")).toEqual({ ok: false, error: expect.stringMatching(/The month is submitted: withdraw it, or have it rejected, first/) });
    expect(await approveC(vid, JUN29)).toMatchObject({ ok: true, status: "approved" });
    expect(await voidC(JUN29, "x")).toEqual({ ok: false, error: expect.stringMatching(/The month is approved: have it rejected first/) });
    expect(await payC(vid, JUN29)).toMatchObject({ ok: true });
    expect(await voidC(JUN29, "x")).toEqual({ ok: false, error: "A paid month is never voided." });
    await expect(pg.query(`insert into incentive_calc_period_voids (period_id, summary, reason, created_by_name) values ($1, '{}'::jsonb, 'direct', 'x')`, [(await per(vid, JUN29)).id])).rejects.toThrow(/Only an open or locked month is voided \(this one is paid\)/);
    expect(await calcC(vid, JUL)).toMatchObject({ ok: true });
    expect(await lockC(vid, JUL)).toMatchObject({ ok: true });
    expect(await voidC(JUL, "Abandoned (nothing of its own)")).toMatchObject({ ok: true, carriedToMonth: null, carriedPaise: 0 });
    expect((await calc.carryBalances(vid, "C")).map((b) => [b.month, b.remainingPaise])).toEqual([[MAY, RS(3_000)]]);
  });

  it("a month with records held for review can't be voided; and a void and a payout of the same month can't both succeed", async () => {
    const stray = await doc("sales-orders", "Void One SO 9", "2029-08-10", 59_000, null, null, "Void One");
    expect(await calcC(vid, AUG)).toMatchObject({ ok: true });
    expect(await voidC(AUG, "x")).toEqual({ ok: false, error: expect.stringMatching(/1 review case is unresolved in this month \(Review & decisions\)/) });
    signIn("reviewer");
    expect(await act.recordCategoryCDecision({ documentId: stray, caseKind: "order-customer", decision: "exclude", targetId: null, reason: "A sample, not a sale" })).toMatchObject({ ok: true });
    expect(await calcC(vid, AUG)).toMatchObject({ ok: true, adopted: true });
    expect(await lockC(vid, AUG)).toMatchObject({ ok: true });
    expect(await submitC(vid, AUG)).toMatchObject({ ok: true }); // in order: July is voided
    expect(await approveC(vid, AUG)).toMatchObject({ ok: true });
    const p = await per(vid, AUG);
    const both = await Promise.all([voidC(AUG, "race", Number(p.row_version)), payC(vid, AUG)]);
    expect(both.filter((x) => x.ok)).toHaveLength(1);
    expect((await per(vid, AUG)).status).toBe("paid");
    expect(await q1(`select 1 from incentive_calc_period_voids where period_id = $1`, [p.id])).toEqual([]);
    await expect(pg.exec(ROLLBACK_0136)).rejects.toThrow(/voided months/);
  });

  it("Approvals shows a voided month as VOIDED (from its void record), keeps its history, and no one can reopen, submit, withdraw, approve, reject or pay it; Categories A and B never read voids", async () => {
    const list = await calc.listApprovalPeriods(vid, undefined, "C");
    const byMonth = Object.fromEntries(list.periods.map((x) => [x.month, x]));
    expect(byMonth[APR]).toMatchObject({ status: "voided", voided: { reason: "Abandoned: the payroll month was cancelled", byName: "voider", carriedToMonth: MAY, recordedStatus: "open" } });
    expect(byMonth[JUL]).toMatchObject({ status: "voided", voided: { reason: "Abandoned (nothing of its own)", carriedToMonth: null, recordedStatus: "locked" } });
    expect(byMonth[MAY]).toMatchObject({ status: "paid", voided: null });
    expect(byMonth[APR]!.run).not.toBeNull(); // its calculation is kept
    // Every action refuses a voided month — the permission holders included.
    const rvJul = await rvOf(vid, JUL);
    const VOID = { ok: false, error: expect.stringMatching(/This month was voided/) };
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId: vid, month: JUL, lock: false, rowVersion: rvJul, category: "C" })).toEqual(VOID);
    expect(await act.submitCategoryAMonth({ programId: vid, month: JUL, rowVersion: rvJul, category: "C" })).toEqual(VOID);
    expect(await act.withdrawCategoryAMonth({ programId: vid, month: JUL, rowVersion: rvJul, category: "C" })).toEqual(VOID);
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId: vid, month: JUL, rowVersion: rvJul, decision: "approve", reason: null, category: "C" })).toEqual(VOID);
    expect(await act.decideCategoryAMonth({ programId: vid, month: JUL, rowVersion: rvJul, decision: "reject", reason: "x", category: "C" })).toEqual(VOID);
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId: vid, month: JUL, rowVersion: rvJul, reference: "X", paidOn: "2026-11-01", amountPaise: 0, note: null, category: "C" })).toEqual(VOID);
    expect((await per(vid, JUL)).status).toBe("locked"); // nothing changed
    // Without the right, nothing is even attempted.
    signIn("runner");
    await expect(act.decideCategoryAMonth({ programId: vid, month: JUL, rowVersion: rvJul, decision: "approve", reason: null, category: "C" })).rejects.toThrow("Forbidden");
    // Categories A and B: same list, no void field set (they never read the void table).
    for (const c of ["A", "B"] as const) expect((await calc.listApprovalPeriods(null, undefined, c)).periods.every((x) => x.voided === null && x.status !== "voided")).toBe(true);
  });

  it("the GLOBAL queue lists every unattributed Forms record of any customer (orders, invoices, credit notes, receipts, an invoice naming no Sales Order) — a party match is a proposal only; searchable by number or party and by status", async () => {
    const { unattributedQueueC } = await import("@/lib/queries/incentive-c-review");
    const so = await doc("sales-orders", "Lost SO 1", "2029-09-01", 11_800, null, null, "Void One");
    await doc("sales-invoices", "Lost INV 1", "2029-09-02", 11_800, null, null, "Stranger Ltd");
    const cn = await doc("credit-notes", "Lost CN 1", "2029-09-03", 1_180, null, null, "Stranger Ltd");
    await doc("customer-receipts", "Lost RC 1", "2029-09-04", 11_800, null, null, "Void One");
    await doc("sales-invoices", "Placed INV 1", "2029-09-05", 11_800, (await one<{ id: string }>(`select id from tally_documents where document_no = 'Void One SO 3'`)).id, null, "Void One"); // placed by its Sales Order
    await doc("sales-invoices", "Bad INV 1", "2029-09-06", 11_800, cn, voidOne, "Void One"); // names a credit note, not a Sales Order
    const all = await unattributedQueueC(qid, OCT, { status: "all" });
    expect(all.rows.map((r) => [r.documentNo, r.caseKind, r.status])).toEqual([
      ["Void One SO 9", "order-customer", "excluded"], // decided earlier (above)
      ["Lost SO 1", "order-customer", "unresolved"],
      ["Lost INV 1", "invoice-order", "unresolved"],
      ["Lost CN 1", "credit-note-invoice", "unresolved"],
      ["Lost RC 1", "receipt-customer", "unresolved"],
      ["Bad INV 1", "invoice-order", "unresolved"],
    ]);
    expect(all.counts).toEqual({ unresolved: 5, linked: 0, excluded: 1 });
    const lostSo = all.rows.find((r) => r.documentId === so)!;
    expect(lostSo.proposals).toEqual([{ id: voidOne, label: "Void One" }]);
    expect(lostSo.targets[0]).toEqual({ id: voidOne, label: "Void One" });
    expect(all.rows.find((r) => r.documentNo === "Bad INV 1")!.message).toMatch(/names a record that isn't a Sales Order in Forms/);
    expect((await unattributedQueueC(qid, OCT, { search: "stranger", status: "all" })).rows.map((r) => r.documentNo)).toEqual(["Lost INV 1", "Lost CN 1"]);
    expect((await unattributedQueueC(qid, OCT, { status: "linked" })).rows).toEqual([]);
  });

  it("while one is unresolved, Category C's month can't be submitted (fail-closed); decided — linked or excluded, with reasons — it can; a linked record is brought into the calculation", async () => {
    expect(await calcC(qid, OCT)).toMatchObject({ ok: true });
    expect(await lockC(qid, OCT)).toMatchObject({ ok: true });
    expect(await submitC(qid, OCT)).toEqual({ ok: false, error: expect.stringMatching(/^5 unattributed Forms records from 2027-09-01 to 2029-12-31 aren't resolved \(Lost SO 1, Lost INV 1, Lost CN 1, Lost RC 1, Bad INV 1\)\. Link or exclude each in Review & decisions → Unattributed records/) });
    const id = async (no: string) => (await one<{ id: string }>(`select id from tally_documents where document_no = $1`, [no])).id;
    signIn("reviewer");
    expect(await act.recordCategoryCDecision({ documentId: await id("Lost SO 1"), caseKind: "order-customer", decision: "link", targetId: voidOne, reason: "Void One's order (PO on file)" })).toMatchObject({ ok: true });
    expect(await act.recordCategoryCDecision({ documentId: await id("Lost RC 1"), caseKind: "receipt-customer", decision: "link", targetId: voidOne, reason: "Void One's payment (bank statement)" })).toMatchObject({ ok: true });
    for (const [no, kind] of [["Lost INV 1", "invoice-order"], ["Lost CN 1", "credit-note-invoice"], ["Bad INV 1", "invoice-order"]] as const) expect(await act.recordCategoryCDecision({ documentId: await id(no), caseKind: kind, decision: "exclude", targetId: null, reason: "Not ours: a duplicate import" })).toMatchObject({ ok: true });
    const { unattributedQueueC } = await import("@/lib/queries/incentive-c-review");
    expect((await unattributedQueueC(qid, OCT, { status: "all" })).counts).toEqual({ unresolved: 0, linked: 2, excluded: 4 });
    expect(await submitC(qid, OCT)).toMatchObject({ ok: true });
    // The calculation reads what an admin linked to one of its customers, whatever its date in the range.
    const { loadInputX } = await import("@/lib/queries/incentive-calc-x");
    const input = await loadInputX(h.db as never, "C", qid, APR, ASOF);
    expect(input.orders!.map((o) => o.id)).toContain(await id("Lost SO 1"));
    expect(input.receipts!.map((r) => r.id)).toContain(await id("Lost RC 1"));
  });

  it("references are followed to a limit (50 rounds); a longer chain is never cut silently: the calculation holds every customer it can't place (fail-closed)", async () => {
    const { loadInputX, C_REFERENCE_ROUNDS } = await import("@/lib/queries/incentive-calc-x");
    const { calculateCategoryX } = await import("@/lib/incentives/categories/engine");
    expect(C_REFERENCE_ROUNDS).toBe(50);
    const { sos } = await acquisition("Deep Co", ["2031-01-05", "2031-02-05", "2031-03-05"]);
    // A chain of 55 unlinked records hanging off the third order: invoice → receipt → receipt → …
    // (Another Tally party: reached only by following the references, never by a party match.)
    let prev = await doc("sales-invoices", "Deep INV X", "2031-03-06", 1_180, sos[2]!, null, "Somebody Else");
    for (let k = 1; k <= 55; k++) prev = await doc("customer-receipts", `Deep RC X${k}`, "2031-03-07", 1, prev, null, "Somebody Else");
    const cut = await loadInputX(h.db as never, "C", qid, "2031-03-01", "2031-12-31");
    expect(cut.incompleteReferences).toEqual({ documentIds: [expect.any(String)], customerIds: [] });
    const r = calculateCategoryX(cut);
    expect(r.items).toEqual([]);
    expect(r.held.map((x) => x.message).join(" ")).toMatch(/New customer Deep Co: held — Forms' linked records \(1 not followed\) go further than the calculation follows/);
    const whole = await loadInputX(h.db as never, "C", qid, "2031-03-01", "2031-12-31", { referenceRounds: 80 });
    expect(whole.incompleteReferences).toBeUndefined();
    expect(whole.receipts!.filter((x) => x.no.startsWith("Deep RC X"))).toHaveLength(55);
  });
});

describe("Category C: held balances keep their own rules; approval and payout re-check what submission checked", () => {
  // Programme RULES (minimum ₹5,000; its settings change in May 2030) and programme REVAL (no minimum), both Category C
  // from January 2030, with SYNTHETIC customers and documents dated 2030 (outside the earlier tests' ranges).
  const ASOF = "2030-12-31";
  const MAR = "2030-03-01", JUN = "2030-06-01", AUG = "2030-08-01", OCT = "2030-10-01";
  let rid = "", qid = "";
  const doc = async (type: string, no: string, date: string, totalRs: number, ref: string | null, customer: string | null, party: string, due: string | null = null) => {
    const batch = (await one<{ id: string }>(`select id from tally_import_batches limit 1`)).id;
    return (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2030-31', $6, $7, $8, $9, $10, $11, $12, '[]'::jsonb, $13, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, party, party.toLowerCase(), customer, RS(totalRs), RS(Math.round(totalRs / 1.18)), ref, due, batch])).id;
  };
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  async function publishIn(program: string, settings: Record<string, SettingValue>, from: string) {
    const c = completeConfig({}, [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], "C");
    const config = { ...c, settings: { ...c.settings, "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none", ...settings } };
    const d = await rules.createDraft(actor("author"), { programId: program, category: "C", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, from, { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
  }
  const per = async (program: string, month: string) => one<{ id: string; row_version: number; status: string; release_on: string | null; current_run_id: string }>(`select id, row_version, status, release_on::text, current_run_id from incentive_calc_periods where program_id = $1 and category_code = 'C' and month = $2`, [program, month]);
  const rvOf = async (program: string, month: string) => Number((await per(program, month)).row_version);
  const calcC = async (program: string, month: string) => {
    signIn("runner");
    return onDay(ASOF, () => act.calculateCategoryAMonth({ programId: program, month, asOf: ASOF, category: "C" }));
  };
  const lockC = async (program: string, month: string, on = true) => {
    signIn("locker");
    return act.setCategoryAMonthLocked({ programId: program, month, lock: on, rowVersion: await rvOf(program, month), category: "C" });
  };
  const submitC = async (program: string, month: string) => {
    signIn("locker");
    return act.submitCategoryAMonth({ programId: program, month, rowVersion: await rvOf(program, month), category: "C" });
  };
  const decideC = async (program: string, month: string, decision: "approve" | "reject" = "approve", reason: string | null = null) => {
    signIn("a1");
    return act.decideCategoryAMonth({ programId: program, month, rowVersion: await rvOf(program, month), decision, reason, category: "C" });
  };
  const payC = async (program: string, month: string, amountPaise = 0) => {
    const p = await per(program, month);
    signIn("payer");
    return act.recordCategoryAPayout({ programId: program, month, rowVersion: Number(p.row_version), reference: `PAY-${program.slice(0, 4)}-${month}`, paidOn: p.release_on!, amountPaise, note: null, category: "C" });
  };
  const exclude = async (documentId: string, caseKind: string) => {
    signIn("reviewer");
    return act.recordCategoryCDecision({ documentId, caseKind, decision: "exclude", targetId: null, reason: "Not a sale of ours (test)" });
  };

  beforeAll(async () => {
    for (const [code, name] of [["RULES", "Held-balance rules test"], ["REVAL", "Revalidation test"]] as const) {
      const p = await rules.createProgram(actor("author"), { code, name, description: null });
      if (!p.ok) throw new Error(p.error);
      if (code === "RULES") rid = p.programId;
      else qid = p.programId;
    }
    // Version 1: a minimum of ₹5,000; balances carried forward and NEVER expiring.
    await publishIn(rid, { ...TEST.C, "payout.minimumPayable": RS(5_000), "payout.belowMinimum": "carryForward", "payout.carryForwardExpiry": "never" }, "2030-01-01");
    await publishIn(qid, { ...TEST.C, "payout.minimumPayable": "none" }, "2030-01-01");
    const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Rules One', $1, 30) returning id`, [who.rep])).id;
    for (const [k, d] of ["2030-01-05", "2030-02-05", "2030-03-05"].entries()) {
      const so = await doc("sales-orders", `Rules One SO ${k + 1}`, d, 1_18_000, null, cust, "Rules One");
      const inv = await doc("sales-invoices", `Rules One INV ${k + 1}`, d, 1_18_000, so, cust, "Rules One", plus(d, 30));
      await doc("customer-receipts", `Rules One RC ${k + 1}`, plus(d, 30), 1_18_000, inv, cust, "Rules One");
    }
  }, 120_000);

  it("a balance held under 'never expires' is NOT expired when a later version says 'after 1 month'; it stays carried and is counted", async () => {
    // March: ₹3,000, below ₹5,000 — held (paid at ₹0), under version 1's rules.
    expect(await calcC(rid, MAR)).toMatchObject({ ok: true });
    expect(await lockC(rid, MAR)).toMatchObject({ ok: true });
    expect(await submitC(rid, MAR)).toMatchObject({ ok: true });
    expect(await decideC(rid, MAR)).toMatchObject({ ok: true, status: "approved" });
    expect(await payC(rid, MAR)).toMatchObject({ ok: true });
    // Version 2 from May: balances expire after ONE month.
    await publishIn(rid, { ...TEST.C, "payout.minimumPayable": RS(5_000), "payout.belowMinimum": "carryForward", "payout.carryForwardExpiry": "afterMonths", "payout.carryForwardExpiryMonths": 1 }, "2030-05-01");
    expect(await calcC(rid, JUN)).toMatchObject({ ok: true });
    const run = await one<{ inputs: { carry: { lots: { month: string; remainingPaise: number; rules: unknown }[] }[] }; result: { configVersionNo: number; employees: { carry: { lots: { outcome: string }[] }; limits: string[]; earnedPaise: number }[] } }>(`select inputs, result from incentive_calc_runs where id = $1`, [(await per(rid, JUN)).current_run_id]);
    expect(run.result.configVersionNo).toBe(2); // June is calculated with version 2…
    expect(run.inputs.carry[0]!.lots).toEqual([{ id: expect.any(String), month: MAR, remainingPaise: RS(3_000), rules: { belowMinimum: "carryForward", expiry: "never", expiryMonths: null } }]); // …but March's balance carries version 1's rules
    expect(run.result.employees[0]!.carry.lots).toEqual([expect.objectContaining({ outcome: "carried", amountPaise: RS(3_000) })]);
    expect(run.result.employees[0]!.limits.join(" ")).not.toMatch(/expired/);
    expect(run.result.employees[0]!.earnedPaise).toBe(RS(3_000)); // still counted in the month's total
    // Paid in order: the ledger records nothing expired.
    expect(await lockC(rid, JUN)).toMatchObject({ ok: true });
    expect(await submitC(rid, JUN)).toMatchObject({ ok: true });
    expect(await decideC(rid, JUN)).toMatchObject({ ok: true });
    expect(await payC(rid, JUN)).toMatchObject({ ok: true });
    expect(await q1(`select kind from incentive_calc_carry where program_id = $1 and kind <> 'held'`, [rid])).toEqual([]);
    expect((await calc.carryBalances(rid, "C")).map((b) => [b.month, b.remainingPaise])).toEqual([[MAR, RS(3_000)]]);
  });

  it("approval re-checks the carry-forward: an adjustment carried in after the submission → approval refused (stale), rejected, recalculated, resubmitted, approved", async () => {
    expect(await calcC(rid, AUG)).toMatchObject({ ok: true });
    expect(await lockC(rid, AUG)).toMatchObject({ ok: true });
    expect(await submitC(rid, AUG)).toMatchObject({ ok: true });
    // After the submission, an amount is carried into August (as a recalculation difference of an earlier month would be).
    const junRun = (await per(rid, JUN)).current_run_id;
    await pg.query(`insert into incentive_calc_adjustments (program_id, category_code, from_month, to_month, employee_id, employee_name, kind, amount_paise, source_run_id, note) values ($1, 'C', $2, $3, $4, 'rep', 'recalc-difference', 100, $5, 'test: carried in after the submission')`, [rid, JUN, AUG, who.rep, junRun]);
    const before = await per(rid, AUG);
    expect(await decideC(rid, AUG)).toEqual({ ok: false, error: expect.stringMatching(/carried into 2030-08 changed since this month was calculated: reopen and recalculate it\. Reject it so it is recalculated and submitted again\. Nothing was approved\./) });
    expect(await per(rid, AUG)).toEqual(before); // nothing changed
    expect(await decideC(rid, AUG, "reject", "The carry-forward changed after the submission")).toMatchObject({ ok: true, status: "locked" });
    expect(await lockC(rid, AUG, false)).toMatchObject({ ok: true });
    expect(await calcC(rid, AUG)).toMatchObject({ ok: true, adopted: true });
    expect(await lockC(rid, AUG)).toMatchObject({ ok: true });
    expect(await submitC(rid, AUG)).toMatchObject({ ok: true });
    expect(await decideC(rid, AUG)).toMatchObject({ ok: true, status: "approved" });
    expect(await payC(rid, AUG)).toMatchObject({ ok: true }); // ₹3,000 + ₹1 is still below ₹5,000: nothing released
  });

  it("approval re-checks the unattributed records: one arriving after the submission → approval refused until decided; nothing about the month changes", async () => {
    expect(await calcC(qid, OCT)).toMatchObject({ ok: true });
    expect(await lockC(qid, OCT)).toMatchObject({ ok: true });
    expect(await submitC(qid, OCT)).toMatchObject({ ok: true });
    const late = await doc("sales-orders", "Late SO 1", "2030-10-15", 11_800, null, null, "Late Co");
    const before = await per(qid, OCT);
    expect(await decideC(qid, OCT)).toEqual({ ok: false, error: expect.stringMatching(/^1 unattributed Forms record from 2028-09-01 to 2030-12-31 isn't resolved \(Late SO 1\)\. Link or exclude it in Review & decisions → Unattributed records; if the decision changes the month's figures, reject it so it is recalculated and submitted again\. Nothing was approved\.$/) });
    expect(await per(qid, OCT)).toEqual(before);
    expect(await exclude(late, "order-customer")).toMatchObject({ ok: true });
    expect(await decideC(qid, OCT)).toMatchObject({ ok: true, status: "approved" });
  });

  it("payout re-checks the unattributed records: one arriving after the approval → payout refused until decided; the approved amount never changes", async () => {
    const late = await doc("customer-receipts", "Late RC 1", "2030-10-20", 5_900, null, null, "Late Co");
    const before = await per(qid, OCT);
    const approved = (await calc.monthView(qid, OCT, undefined, "C")).approvedTotalPaise;
    expect(await payC(qid, OCT)).toEqual({ ok: false, error: expect.stringMatching(/^1 unattributed Forms record from 2028-09-01 to 2030-12-31 isn't resolved \(Late RC 1\)\. Link or exclude it in Review & decisions → Unattributed records before the payout is recorded \(the approved amount is never changed here\)\. Nothing was recorded\.$/) });
    expect(await per(qid, OCT)).toEqual(before);
    expect(await q1(`select 1 from incentive_calc_payouts where period_id = $1`, [before.id])).toEqual([]);
    expect(await exclude(late, "receipt-customer")).toMatchObject({ ok: true });
    expect(await payC(qid, OCT, approved ?? 0)).toMatchObject({ ok: true });
    expect((await per(qid, OCT)).status).toBe("paid");
  });

  it("a rejection is never blocked by the re-checks", async () => {
    // A fresh REVAL month, submitted, then an unattributed record arrives: it can still be rejected.
    const NOV = "2030-11-01";
    expect(await calcC(qid, NOV)).toMatchObject({ ok: true });
    expect(await lockC(qid, NOV)).toMatchObject({ ok: true });
    expect(await submitC(qid, NOV)).toMatchObject({ ok: true });
    const late = await doc("sales-orders", "Late SO 2", "2030-11-05", 11_800, null, null, "Late Co");
    expect(await decideC(qid, NOV, "reject", "A late record must be decided first")).toMatchObject({ ok: true, status: "locked" });
    expect(await exclude(late, "order-customer")).toMatchObject({ ok: true });
  });
});

describe("Phase 1: a recalculation difference skips a VOIDED Category C month and goes to the next open one — once", () => {
  // Its own programme (CVOIDC, Category C from January 2031), its own SYNTHETIC customer and documents dated 2031 —
  // a year no other test calculates — so nothing here depends on an earlier test.
  const APR = "2031-04-01", JUN = "2031-06-01", JUL = "2031-07-01";
  let prog = "";
  let batch = "";
  const doc = async (type: string, no: string, date: string, totalRs: number, taxableRs: number, ref: string | null, customer: string, due: string | null = null) => {
    return (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2030-31', 'Carry Void Co', 'carry void co', $6, $7, $8, $9, $10, '[]'::jsonb, $11, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, RS(totalRs), RS(taxableRs), ref, due, batch])).id;
  };
  const per = async (month: string) => (await q1<{ id: string; status: string; row_version: number; current_run_id: string | null }>(`select id, status, row_version, current_run_id from incentive_calc_periods where program_id = $1 and category_code = 'C' and month = $2`, [prog, month]))[0];
  const calcOn = (month: string, asOf: string) => {
    signIn("runner");
    return onDay(asOf, () => act.calculateCategoryAMonth({ programId: prog, month, asOf, category: "C" }));
  };
  const ownPayable = async (runId: string) => Number((await one<{ p: number | null }>(`select coalesce(sum((e->>'ownPayablePaise')::bigint), 0)::int p from incentive_calc_runs r, jsonb_array_elements(r.result->'employees') e where r.id = $1`, [runId])).p);
  const differences = () => q1<{ from: string; to: string; a: number; run: string }>(`select from_month::text "from", to_month::text "to", amount_paise::int a, source_run_id::text run from incentive_calc_adjustments where program_id = $1 and kind = 'recalc-difference' and from_month = $2 order by created_at`, [prog, APR]);

  beforeAll(async () => {
    // Category C needs 0135 and 0136, which this file's migration tests apply; when this block runs on its own they
    // aren't, so apply them here — only when missing (re-running 0135 would undo what 0137–0139 widened).
    if ((await one<{ ok: boolean }>(`select to_regclass('public.incentive_calc_items') is not null as ok`)).ok === false) await pg.exec(MIG("0135_incentive_categories_c_g.sql"));
    if ((await one<{ ok: boolean }>(`select to_regclass('public.incentive_calc_c_reviews') is not null as ok`)).ok === false) await pg.exec(MIG("0136_incentive_category_c_review.sql"));
    batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'carry-void.xlsx', 'carry-void') returning id`)).id;
    const p = await rules.createProgram(actor("author"), { code: "CVOIDC", name: "Carry past a void", description: null });
    if (!p.ok) throw new Error(p.error);
    prog = p.programId;
    const c = completeConfig({}, [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], "C");
    const config = { ...c, settings: { ...c.settings, ...TEST.C, "payout.minimumPayable": "none", "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none" } };
    const d = await rules.createDraft(actor("author"), { programId: prog, category: "C", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, "2031-01-01", { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
    // A new customer's three ₹1,00,000 orders (Feb, Mar, Apr 2031): the 3rd completes the acquisition in April. The
    // first two are paid on their due dates; the April invoice only on 20 May — after April's first calculation.
    const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Carry Void Co', $1, 30) returning id`, [who.rep])).id;
    for (const [k, [day, paid]] of ([["2031-02-05", "2031-03-07"], ["2031-03-05", "2031-04-04"], ["2031-04-05", "2031-05-20"]] as const).entries()) {
      const so = await doc("sales-orders", `CVC SO ${k + 1}`, day, 1_18_000, 1_00_000, null, cust);
      const due = new Date(Date.parse(`${day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
      const inv = await doc("sales-invoices", `CVC INV ${k + 1}`, day, 1_18_000, 1_00_000, so, cust, due);
      await doc("customer-receipts", `CVC RC ${k + 1}`, paid, 1_18_000, 1_00_000, inv, cust);
    }
  }, 120_000);

  it("April's difference (found as of 10 June) skips voided June and is carried into July; June, April and the void stay exactly as they were; repeated, nothing is carried twice", async () => {
    // April as of 30 April: the April invoice isn't collected yet, so nothing is payable (C pays once all are collected).
    expect(await calcOn(APR, "2031-04-30")).toMatchObject({ ok: true, adopted: true });
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId: prog, month: APR, lock: true, rowVersion: Number((await per(APR))!.row_version), category: "C" })).toMatchObject({ ok: true });
    // June: calculated (nothing of its own) and VOIDED with a reason.
    expect(await calcOn(JUN, "2031-06-10")).toMatchObject({ ok: true, adopted: true });
    signIn("voider");
    expect(await act.voidCategoryCMonth({ programId: prog, month: JUN, rowVersion: Number((await per(JUN))!.row_version), category: "C", reason: "Abandoned month (test)" })).toMatchObject({ ok: true });
    const aprBefore = (await per(APR))!;
    const junBefore = (await per(JUN))!;
    const julBefore = await per(JUL); // may not exist yet
    const voids = async () => (await one<{ n: number }>(`select count(*)::int n from incentive_calc_period_voids where period_id = $1`, [junBefore.id])).n;
    expect(await voids()).toBe(1);
    // April recalculated as of 10 June: the April invoice is now collected — a difference. June (the calculation date's
    // month) is voided, so the first eligible month is July.
    const r = await calcOn(APR, "2031-06-10");
    expect(r).toMatchObject({ ok: true, adopted: false, unchanged: false });
    if (r.ok) expect(r.outcome).toMatch(/The difference is carried into 2031-07 \(the first open month from 2031-06\)\./);
    const found = (await one<{ id: string }>(`select id::text from incentive_calc_runs where program_id = $1 and category_code = 'C' and month = $2 order by computed_at desc limit 1`, [prog, APR])).id;
    const diff = (await ownPayable(found)) - (await ownPayable(aprBefore.current_run_id!));
    expect(diff).toBeGreaterThan(0); // a real difference — and it is not dropped:
    expect(await differences()).toEqual([{ from: APR, to: JUL, a: diff, run: found }]);
    expect((await one<{ n: number }>(`select count(*)::int n from incentive_calc_adjustments where program_id = $1 and to_month = $2`, [prog, JUN])).n).toBe(0);
    // The voided month, the locked month and the void record are untouched; July went up once (created by the carry
    // at row version 1 and raised to 2, or raised by one if it existed).
    expect(await per(JUN)).toEqual(junBefore);
    expect(await voids()).toBe(1);
    expect(await per(APR)).toEqual(aprBefore);
    const jul = (await per(JUL))!;
    expect(jul.status).toBe("open");
    expect(jul.row_version).toBe(julBefore ? julBefore.row_version + 1 : 2);
    // Again (unchanged) and on a later day (new inputs, the same result): nothing is carried twice.
    expect(await calcOn(APR, "2031-06-10")).toMatchObject({ ok: true, unchanged: true, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await calcOn(APR, "2031-06-11")).toMatchObject({ ok: true, adopted: false });
    expect(await differences()).toEqual([{ from: APR, to: JUL, a: diff, run: found }]);
    expect((await per(JUL))!.row_version).toBe(jul.row_version);
    expect(await per(JUN)).toEqual(junBefore);
    expect(await per(APR)).toEqual(aprBefore);
  });
});

describe("Phase 1: after an engine change, a same-day calculation is recorded with the CURRENT engine (never short-circuited against an earlier engine's run)", () => {
  // Four programmes (CENG1 open, CENG2 locked, CENG3 paid, CENG4 locked then reopened; Category C from January 2034), each calculating ONE month of
  // its own, and three SYNTHETIC customers whose acquisitions complete in March, June and September 2034 — a year no
  // other test calculates, so the unattributed-records check (about two years back) sees nothing of other tests. An
  // "earlier engine" is simulated by stamping results with category-c/3 (the engine that preceded category-c/4) for a
  // calculation; the registered engine stays category-c/4, as after a deployment.
  const CURRENT = ENGINE_VERSIONS.C;
  const EARLIER = "category-c/3";
  const MAR = "2034-03-01", JUN = "2034-06-01", SEP = "2034-09-01";
  const ASOF = "2034-12-31";
  let batch = "";
  const programs: Record<string, string> = {};
  const doc = async (type: string, no: string, date: string, ref: string | null, customer: string, party: string, due: string | null = null) =>
    (await one<{ id: string }>(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values ($1, $2, $3, $4, $5, '2033-34', $6, $7, $8, $9, $10, $11, $12, '[]'::jsonb, $13, 1) returning id`, [`${type}|${no}`, type, no, no.toLowerCase(), date, party, party.toLowerCase(), customer, RS(1_18_000), RS(1_00_000), ref, due, batch])).id;
  const per = async (prog: string, month: string) => (await q1<{ id: string; status: string; row_version: number; current_run_id: string | null }>(`select id, status, row_version, current_run_id from incentive_calc_periods where program_id = $1 and category_code = 'C' and month = $2`, [prog, month]))[0];
  const runs = (prog: string, month: string) => q1<{ id: string; engine_version: string; adopted: boolean }>(`select id::text, engine_version, adopted from incentive_calc_runs where program_id = $1 and category_code = 'C' and month = $2 order by computed_at`, [prog, month]);
  const differences = (prog: string) => q1(`select from_month::text, to_month::text, amount_paise::int from incentive_calc_adjustments where program_id = $1 and kind = 'recalc-difference'`, [prog]);
  const calcOn = (prog: string, month: string, asOf = ASOF) => {
    signIn("runner");
    return onDay(asOf, () => act.calculateCategoryAMonth({ programId: prog, month, asOf, category: "C" }));
  };
  /** A calculation whose results are stamped by the EARLIER engine (the registered engine is unchanged). */
  const calcEarlier = async (prog: string, month: string, asOf = ASOF) => {
    ENGINE_VERSIONS.C = EARLIER;
    try {
      return await calcOn(prog, month, asOf);
    } finally {
      ENGINE_VERSIONS.C = CURRENT;
    }
  };
  const lockC = async (prog: string, month: string, lock = true) => {
    signIn("locker");
    return act.setCategoryAMonthLocked({ programId: prog, month, lock, rowVersion: Number((await per(prog, month))!.row_version), category: "C" });
  };
  const submitC = async (prog: string, month: string) => {
    signIn("locker");
    return act.submitCategoryAMonth({ programId: prog, month, rowVersion: Number((await per(prog, month))!.row_version), category: "C" });
  };

  beforeAll(async () => {
    expect(CURRENT).toBe("category-c/4");
    // Category C needs 0135 and 0136 (applied by this file's migration tests; here only when missing, as above).
    if ((await one<{ ok: boolean }>(`select to_regclass('public.incentive_calc_items') is not null as ok`)).ok === false) await pg.exec(MIG("0135_incentive_categories_c_g.sql"));
    if ((await one<{ ok: boolean }>(`select to_regclass('public.incentive_calc_c_reviews') is not null as ok`)).ok === false) await pg.exec(MIG("0136_incentive_category_c_review.sql"));
    batch = (await one<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'engine-change.xlsx', 'engine-change') returning id`)).id;
    for (const code of ["CENG1", "CENG2", "CENG3", "CENG4"]) {
      const p = await rules.createProgram(actor("author"), { code, name: `Engine change ${code}`, description: null });
      if (!p.ok) throw new Error(p.error);
      programs[code] = p.programId;
      const c = completeConfig({}, [{ subjectType: "employee", subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], "C");
      const config = { ...c, settings: { ...c.settings, ...TEST.C, "payout.minimumPayable": "none", "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none" } };
      const d = await rules.createDraft(actor("author"), { programId: p.programId, category: "C", startFrom: "blank" });
      if (!d.ok) throw new Error(d.error);
      const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
      if (!s.ok) throw new Error(s.error);
      const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
      if (!sub.ok) throw new Error(sub.error);
      const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
      if (!ap.ok) throw new Error(ap.error);
      const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, "2034-01-01", { canBackdate: true });
      if (!pub.ok) throw new Error(pub.error);
    }
    // Three new customers, three ₹1,00,000 orders each, every invoice paid on its due date.
    for (const [name, months] of [["Engine One", ["2034-01-05", "2034-02-05", "2034-03-05"]], ["Engine Two", ["2034-04-05", "2034-05-05", "2034-06-05"]], ["Engine Three", ["2034-07-05", "2034-08-05", "2034-09-05"]]] as const) {
      const cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ($1, $2, 30) returning id`, [name, who.rep])).id;
      for (const [k, day] of months.entries()) {
        const so = await doc("sales-orders", `${name} SO ${k + 1}`, day, null, cust, name);
        const due = new Date(Date.parse(`${day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
        const inv = await doc("sales-invoices", `${name} INV ${k + 1}`, day, so, cust, name, due);
        await doc("customer-receipts", `${name} RC ${k + 1}`, due, inv, cust, name);
      }
    }
  }, 180_000);

  it("an OPEN month: the earlier engine's run (refused at submission) is followed, the same day, by a current-engine run that is recorded and adopted; submission accepts it; a repeat under the current engine still short-circuits", async () => {
    const P = programs.CENG1!;
    // Calculated by the earlier engine, adopted, locked: submission refuses a run of an earlier engine.
    expect(await calcEarlier(P, MAR)).toMatchObject({ ok: true, adopted: true });
    const [old] = await runs(P, MAR);
    expect(old).toMatchObject({ engine_version: EARLIER, adopted: true });
    expect(await lockC(P, MAR)).toMatchObject({ ok: true });
    expect(await submitC(P, MAR)).toEqual({ ok: false, error: expect.stringMatching(/calculated by an earlier engine \(category-c\/3\); reopen and recalculate it first/) });
    // Reopened and recalculated THE SAME DAY with the same inputs: a new run of the current engine, adopted.
    expect(await lockC(P, MAR, false)).toMatchObject({ ok: true });
    const r = await calcOn(P, MAR);
    expect(r).toMatchObject({ ok: true, unchanged: false, adopted: true });
    const after = await runs(P, MAR);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ engine_version: CURRENT, adopted: true });
    expect((await per(P, MAR))!.current_run_id).toBe(after[1]!.id);
    // A repeat under the current engine: nothing changed, nothing recorded.
    expect(await calcOn(P, MAR)).toMatchObject({ ok: true, unchanged: true, runId: after[1]!.id, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await runs(P, MAR)).toHaveLength(2);
    // Submission now accepts the current-engine run.
    expect(await lockC(P, MAR)).toMatchObject({ ok: true });
    expect(await submitC(P, MAR)).toMatchObject({ ok: true });
    const submitted = (await per(P, MAR))!;
    expect(submitted.status).toBe("submitted");
    // A SUBMITTED month is never adopted into: recalculated the same day, nothing changes (and nothing is recorded).
    expect(await calcOn(P, MAR)).toMatchObject({ ok: true, unchanged: true, adopted: false });
    expect(await per(P, MAR)).toEqual(submitted);
    expect(await runs(P, MAR)).toHaveLength(2);
  });

  it("LOCKED with an earlier-engine run, recalculated while locked (a current-engine run recorded, NOT adopted), then REOPENED the same day: the next calculation is adopted — not held back by the non-adopted run", async () => {
    const P = programs.CENG4!;
    expect(await calcEarlier(P, JUN)).toMatchObject({ ok: true, adopted: true });
    expect(await lockC(P, JUN)).toMatchObject({ ok: true });
    expect(await calcOn(P, JUN)).toMatchObject({ ok: true, unchanged: false, adopted: false });
    const [old, notAdopted] = await runs(P, JUN);
    expect([old!.engine_version, old!.adopted, notAdopted!.engine_version, notAdopted!.adopted]).toEqual([EARLIER, true, CURRENT, false]);
    expect((await per(P, JUN))!.current_run_id).toBe(old!.id);
    // Reopened the same day; recalculated with the same inputs: a current-engine run is recorded and ADOPTED.
    expect(await lockC(P, JUN, false)).toMatchObject({ ok: true });
    const r = await calcOn(P, JUN);
    expect(r).toMatchObject({ ok: true, unchanged: false, adopted: true });
    const all = await runs(P, JUN);
    expect(all.map((x) => [x.engine_version, x.adopted])).toEqual([[EARLIER, true], [CURRENT, false], [CURRENT, true]]);
    expect((await per(P, JUN))!.current_run_id).toBe(all[2]!.id);
    // Now the latest run IS the adopted one: a repeat short-circuits, nothing recorded.
    expect(await calcOn(P, JUN)).toMatchObject({ ok: true, unchanged: true, runId: all[2]!.id, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await runs(P, JUN)).toHaveLength(3);
    expect(await differences(P)).toEqual([]);
    // And the month goes on: locked and submitted with the current-engine run.
    expect(await lockC(P, JUN)).toMatchObject({ ok: true });
    expect(await submitC(P, JUN)).toMatchObject({ ok: true });
  });

  it("a LOCKED month keeps its adopted earlier-engine run: the same-day current-engine run is recorded but never adopted, and carries no difference (the amounts are the same)", async () => {
    const P = programs.CENG2!;
    expect(await calcEarlier(P, JUN)).toMatchObject({ ok: true, adopted: true });
    expect(await lockC(P, JUN)).toMatchObject({ ok: true });
    const before = (await per(P, JUN))!;
    const r = await calcOn(P, JUN);
    expect(r).toMatchObject({ ok: true, unchanged: false, adopted: false });
    if (r.ok) expect(r.outcome).toMatch(/not adopted: the month is locked\. No difference to carry\./);
    const all = await runs(P, JUN);
    expect(all.map((x) => [x.engine_version, x.adopted])).toEqual([[EARLIER, true], [CURRENT, false]]);
    expect(await per(P, JUN)).toEqual(before); // the adopted run, status and row version are unchanged
    expect(await differences(P)).toEqual([]);
    // A repeat under the current engine short-circuits against the current-engine run.
    expect(await calcOn(P, JUN)).toMatchObject({ ok: true, unchanged: true, outcome: expect.stringMatching(/Nothing changed/) });
    expect(await runs(P, JUN)).toHaveLength(2);
    expect(await per(P, JUN)).toEqual(before);
  });

  it("a PAID month keeps its paid run and payout: an earlier-engine run, then a same-day current-engine run, are recorded but never adopted, with no difference carried", async () => {
    const P = programs.CENG3!;
    // Paid as calculated on 30 December; the later runs are of 31 December (the simulated clock follows the calculation
    // date, and the month's latest run is the latest by its own time — as in real life).
    expect(await calcOn(P, SEP, "2034-12-30")).toMatchObject({ ok: true, adopted: true });
    expect(await lockC(P, SEP)).toMatchObject({ ok: true });
    expect(await submitC(P, SEP)).toMatchObject({ ok: true });
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId: P, month: SEP, rowVersion: Number((await per(P, SEP))!.row_version), decision: "approve", reason: null, category: "C" })).toMatchObject({ ok: true, status: "approved" });
    const approved = (await one<{ id: string; row_version: number; current_run_id: string; release_on: string }>(`select id, row_version, current_run_id, release_on::text from incentive_calc_periods where program_id = $1 and category_code = 'C' and month = $2`, [P, SEP]));
    const total = (await calc.payoutLines(h.db as never, P, SEP, approved.current_run_id, "C")).reduce((s, l) => s + l.amountPaise, 0);
    expect(total).toBeGreaterThan(0);
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId: P, month: SEP, rowVersion: Number(approved.row_version), reference: "PAY-ENG-SEP", paidOn: approved.release_on, amountPaise: total, note: null, category: "C" })).toMatchObject({ ok: true });
    const paid = (await per(P, SEP))!;
    expect(paid.status).toBe("paid");
    const payout = await q1(`select run_id::text, total_paise::int, reference from incentive_calc_payouts where period_id = $1`, [paid.id]);
    // The month's latest run becomes an earlier engine's (another calculation date, so not "unchanged") …
    expect(await calcEarlier(P, SEP)).toMatchObject({ ok: true, unchanged: false, adopted: false });
    // … and the same day, with the same inputs, the current engine's run is recorded — not adopted, nothing carried.
    const r = await calcOn(P, SEP);
    expect(r).toMatchObject({ ok: true, unchanged: false, adopted: false });
    if (r.ok) expect(r.outcome).toMatch(/not adopted: the month is paid\. No difference to carry\./);
    expect((await runs(P, SEP)).map((x) => [x.engine_version, x.adopted])).toEqual([[CURRENT, true], [EARLIER, false], [CURRENT, false]]);
    expect(await per(P, SEP)).toEqual(paid);
    expect(await q1(`select run_id::text, total_paise::int, reference from incentive_calc_payouts where period_id = $1`, [paid.id])).toEqual(payout);
    expect(await differences(P)).toEqual([]);
    // And the paid month itself can't be changed.
    await expect(pg.query(`update incentive_calc_periods set status = 'approved', row_version = row_version + 1 where id = $1`, [paid.id])).rejects.toThrow(/final/);
  });
});
