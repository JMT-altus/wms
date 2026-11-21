import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 0138 (Category F: email and letterhead testimonials, F.4 appreciation) and its rollback, on an in-memory
// PGlite database at production's 0137 state (0131–0137's own SQL, testimonials as 0068 created it). It applies on top
// of 0137 (twice: safe to re-run), refuses to roll back while any data only 0138 allows exists, and its rollback restores
// 0137 EXACTLY — proven with 0137's own pinned listing (scripts/incentive-0137/core.ts). No other database is reached.
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import * as core137 from "@/scripts/incentive-0137/core";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
const MIG = (f: string) => core137.canonicalBytes(readFileSync(resolve(__dirname, `../../db/migrations/${f}`))).toString("utf8");
const M0138 = MIG("0138_incentive_category_f_testimonials.sql");
const R0138 = core137.canonicalBytes(readFileSync(resolve(__dirname, "../../db/rollback/0138_incentive_category_f_testimonials.rollback.sql"))).toString("utf8");
const ref = core137.reference(MIG(core137.FILES.m0136), MIG(core137.FILES.migration));
const SENTINEL = "__undo__";
let rep = "";
let cust = "";

type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> };
const execOf = (q: Q): core137.Exec => ({ query: async <T>(t: string, p: unknown[] = []) => (await q.query(t, p)).rows as T[], exec: async (t: string) => void (await q.exec(t)) });
const x0 = () => execOf(pg as unknown as Q);
const one = async <T>(t: string, p: unknown[] = []) => (await pg.query<T>(t, p)).rows[0]!;
/** Changes the state, runs the check, then undoes everything. */
const scratch = (fn: (q: Q) => Promise<void>) =>
  pg
    .transaction(async (tx) => {
      await fn(tx as unknown as Q);
      throw new Error(SENTINEL);
    })
    .catch((e: Error) => {
      if (e.message !== SENTINEL) throw e;
    });
const cols = async (t: string) => (await pg.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).rows.map((r) => r.c);

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures,
    products: schema.products, productCategories: schema.productCategories,
    customers: schema.customers, salesOrders: schema.salesOrders, invoices: schema.invoices, receipts: schema.receipts,
    leadBatches: schema.leadBatches, leadConversions: schema.leadConversions, clientMeetings: schema.clientMeetings,
    incentiveSchemes: schema.incentiveSchemes, ruleVersions: schema.ruleVersions, incentivePeriods: schema.incentivePeriods, incentiveLedger: schema.incentiveLedger, payoutRuns: schema.payoutRuns, incentiveAudit: schema.incentiveAudit,
  });
  pg = made.pg;
  const t68 = MIG("0068_incentive_spine.sql");
  await pg.exec(t68.slice(t68.indexOf("CREATE TABLE IF NOT EXISTS testimonials ("), t68.indexOf("\n", t68.indexOf("CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx"))));
  await pg.exec(`create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated;`);
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", "0136_incentive_category_c_review.sql", core137.FILES.migration]) await pg.exec(MIG(f));
  rep = (await one<{ id: string }>(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)).id;
  cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Cust A', $1, 30) returning id`, [rep])).id;
  // 0137 exactly as pinned before 0138 (the production state).
  await expect(core137.assert0137(x0(), ref)).resolves.toMatchObject({ keys: 99 });
}, 240_000);
afterAll(async () => {
  await pg?.close();
});

describe("0138: Category F's four testimonial rewards on 0137's registry", () => {
  it("the files are LF and carry no transaction control of their own", () => {
    expect(() => core137.pinned("0138", Buffer.from(M0138), core137.sha256(Buffer.from(M0138)))).not.toThrow();
    expect(() => core137.pinned("0138 rollback", Buffer.from(R0138), core137.sha256(Buffer.from(R0138)))).not.toThrow();
  });
  it("applies on top of 0137, twice (safe to re-run): the new columns, checks and the identity index; no table, setting or row added", async () => {
    const tables = await core137.tableCount(x0());
    const before = await core137.dataFingerprints(x0());
    await pg.exec(M0138);
    await pg.exec(M0138);
    expect(await cols("incentive_f_submissions")).toContain("claimed_kind");
    expect(await cols("incentive_f_decisions")).toEqual(expect.arrayContaining(["testimonial_kind", "appreciated_employee_ids", "appreciated_employee_names", "evidence_key", "confirmed_from_customer", "confirmed_type", "confirmed_genuine"]));
    expect((await one<{ n: string }>(`select is_nullable n from information_schema.columns where table_name = 'incentive_f_submissions' and column_name = 'claimed_rating'`)).n).toBe("YES");
    const checks = (await pg.query<{ conname: string; v: boolean }>(`select conname, convalidated v from pg_constraint where conname in ('incentive_f_submissions_rating_check', 'incentive_f_decisions_verify_check', 'incentive_f_decisions_testimonial_kind_check', 'incentive_f_decisions_appreciated_check', 'incentive_f_decisions_evidence_key_check') order by 1`)).rows;
    expect(checks).toEqual(["incentive_f_decisions_appreciated_check", "incentive_f_decisions_evidence_key_check", "incentive_f_decisions_testimonial_kind_check", "incentive_f_decisions_verify_check", "incentive_f_submissions_rating_check"].map((conname) => ({ conname, v: true })));
    expect((await pg.query(`select 1 from pg_indexes where indexname = 'incentive_f_decisions_evidence_key_uq'`)).rows).toHaveLength(1);
    expect(await core137.tableCount(x0())).toEqual(tables);
    expect(await core137.dataFingerprints(x0())).toEqual(before);
    // The settings list is 0137's (F.2–F.4 use keys it already allows).
    const keys = (await one<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'incentive_config_settings_key_check'`)).d;
    for (const k of ["f.emailAmount", "f.letterheadAmount", "f.namedMultiple", "f.googleReviewAmount"]) expect(keys).toContain(`'${k}'`);
  });
  it("the database enforces the types: a Google review keeps its rating; email / letterhead have none, need an identity, all three findings and their customer", async () => {
    const reg = async (q: Q, key: string) => ((await q.query(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ($1, 'https://files.example.test/x', 'x') returning id`, [key])).rows[0] as { id: string }).id;
    const verify = (q: Q, r: string, kind: string | null, rating: number | null, key: string | null, found: boolean, customer: string | null) =>
      q.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, rating, published_on, review_month, evidence_key, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', $2, $3, '2026-09-12', '2026-09-01', $4, $5, $5, $5, $6, 'x', 'x')`, [r, kind, rating, key, found, customer]);
    await scratch(async (q) => {
      await expect(q.query(`insert into incentive_f_submissions (link_state, submitted_by_name, submitted_url, claimed_kind, claimed_rating, claimed_published_on) values ('unresolved', 'x', 'u', 'email', 5, '2026-09-12')`)).rejects.toThrow(/incentive_f_submissions_rating_check/);
    });
    await scratch(async (q) => {
      await expect(q.query(`insert into incentive_f_submissions (link_state, submitted_by_name, submitted_url, claimed_kind, claimed_rating, claimed_published_on) values ('unresolved', 'x', 'u', 'google_review', null, '2026-09-12')`)).rejects.toThrow(/incentive_f_submissions_rating_check/);
    });
    const cases = [
      ["email", 5, "key-1", true, cust, "verify_check"],
      ["email", null, null, true, cust, "verify_check"],
      ["letterhead", null, "key-1", false, cust, "verify_check"],
      ["letterhead", null, "key-1", true, null, "verified against its customer"],
      ["google_review", null, null, false, null, "verify_check"],
      ["google_review", 5, "key-1", false, null, "verify_check"],
      ["fax", null, "key-1", true, cust, "testimonial_kind_check"],
      // NULL-safe: a verification without a type (or a Google review without a rating, above) is refused, never let through.
      [null, 5, null, false, null, "verify_check"],
    ] as const;
    const outcomes: string[] = [];
    for (const [kind, rating, key, found, customer] of cases)
      await scratch(async (q) => {
        const r = await reg(q, `doc:k-${kind}-${rating}-${key}-${found}-${customer}`);
        await q.query("savepoint s");
        outcomes.push(await verify(q, r, kind, rating, key, found, customer).then(() => "accepted", (e: Error) => (/verified against its customer/.test(e.message) ? "verified against its customer" : (e.message.match(/incentive_f_decisions_(\w+_check)/)?.[1] ?? e.message))));
      });
    expect(outcomes).toEqual(cases.map((c) => c[5]));
    await scratch(async (q) => {
      // Valid: a letterhead with all it needs; the same identity verified again (another registry row) is refused.
      await verify(q, await reg(q, "doc:a"), "letterhead", null, "ref ca/77", true, cust);
      await expect(verify(q, await reg(q, "doc:b"), "email", null, "ref ca/77", true, cust)).rejects.toThrow(/duplicate key/);
    });
  });
  it("the rollback refuses while any data only 0138 allows exists — and changes nothing", async () => {
    const cases = [
      `insert into incentive_f_submissions (link_state, submitted_by_name, submitted_url, claimed_kind, claimed_rating, claimed_published_on) values ('unresolved', 'x', 'u', 'email', null, '2026-09-12')`,
      `insert into incentive_f_reviews (id, url_key, first_url, created_by_name) values ('00000000-0000-4000-8000-000000000138', 'doc:z', 'u', 'x'); insert into incentive_f_decisions (review_id, kind, testimonial_kind, rating, published_on, review_month, appreciated_employee_ids, appreciated_employee_names, reason, created_by_name) values ('00000000-0000-4000-8000-000000000138', 'verify', 'google_review', 5, '2026-09-12', '2026-09-01', array['${"00000000-0000-4000-8000-000000000001"}']::uuid[], array['x'], 'x', 'x')`,
    ];
    for (const sql of cases)
      await scratch(async (q) => {
        await q.exec(sql);
        await expect(q.exec(R0138), sql.slice(0, 60)).rejects.toThrow(/0138 rollback refused/);
      });
    expect(await cols("incentive_f_decisions")).toContain("appreciated_employee_ids");
  });
  it("with only Google reviews present, the rollback restores 0137 EXACTLY (its pinned listing) and keeps every row; 0138 then applies again", async () => {
    // A Google review submitted and verified under 0138 — data 0137 allows too.
    const r = (await one<{ id: string }>(`insert into incentive_f_reviews (google_review_id, first_url, created_by_name) values ('ChROLLBACKxx', 'https://www.google.com/maps/r', 'x') returning id`)).id;
    await pg.query(`insert into incentive_f_submissions (review_id, link_state, submitted_by_name, submitted_url, claimed_rating, claimed_published_on) values ($1, 'new', 'x', 'https://www.google.com/maps/r', 5, '2026-09-12')`, [r]);
    await pg.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, rating, published_on, review_month, reason, created_by_name) values ($1, 'verify', 'google_review', 5, '2026-09-12', '2026-09-01', 'x', 'x')`, [r]);
    const before = await core137.dataFingerprints(x0());
    const rows = (await pg.query(`select review_id, kind, rating, published_on::text from incentive_f_decisions order by id`)).rows;
    await pg.transaction(async (tx) => {
      await (tx as unknown as Q).exec(R0138);
    });
    await expect(core137.assert0137(x0(), ref, { requireEmpty: false })).resolves.toMatchObject({ keys: 99 });
    expect(core137.sha256(await core137.canonical0137(x0()))).toBe(core137.CANON_0137);
    expect(await core137.dataFingerprints(x0())).toEqual(before);
    expect((await pg.query(`select review_id, kind, rating, published_on::text from incentive_f_decisions order by id`)).rows).toEqual(rows);
    expect(await cols("incentive_f_decisions")).not.toContain("appreciated_employee_ids");
    await pg.exec(M0138);
    expect(await cols("incentive_f_submissions")).toContain("claimed_kind");
    expect((await one<{ k: string }>(`select testimonial_kind k from incentive_f_decisions where review_id = $1`, [r])).k).toBe("google_review");
  });
});
