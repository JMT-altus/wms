import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// GENUINELY CONCURRENT tests of Category B on a REAL PostgreSQL server (each transaction on its OWN connection): two
// approvals of the same step, two payouts, two manual decisions on one order, and Category A and Category B months of
// one programme calculated at the same moment. Runs only when TEST_PG_URL names a throwaway server on localhost (it
// refuses anything else, and production's fingerprint); creates its own database there and drops it afterwards.
// Without TEST_PG_URL its tests are reported as SKIPPED — never silently passed. Synthetic data only.
const URL_ = process.env.TEST_PG_URL ?? "";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const target = (() => {
  if (!URL_) return null;
  const u = new URL(URL_);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) throw new Error("TEST_PG_URL must be a server on localhost");
  if (sha(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}${u.pathname}`).slice(0, 10) === "ed679a28f0") throw new Error("TEST_PG_URL is production");
  return u;
})();

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

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { isPgEnum } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/db/schema";
import { bConfig, RS } from "../fixtures/category-b";
import { aprilConfig } from "../fixtures/category-a";

const DB_NAME = `wms_cat_b_conc_${randomBytes(4).toString("hex")}`;
let admin: ReturnType<typeof postgres>;
let pool: ReturnType<typeof postgres>;
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
let qualify: typeof import("@/lib/queries/incentive-b-qualify");
const who: Record<string, string> = {};
const actor = (k: string) => ({ id: who[k]!, name: k });
let programId = "";
const APR = "2026-04-01";
const docs: Record<string, string> = {};
const one = async <T>(q: Promise<T[]>) => (await q)[0]!;
const rv = async () => Number(((await one(pool`select row_version from incentive_calc_periods where category_code = 'B' and month = ${APR}`)) as { row_version: number }).row_version);

async function publish(category: "A" | "B", config: ReturnType<typeof bConfig>) {
  const d = await rules.createDraft(actor("author"), { programId, category, startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, APR, { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
}

describe.skipIf(!target)("Category B under genuinely concurrent sessions (real PostgreSQL)", () => {
  beforeAll(async () => {
    admin = postgres(URL_, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${DB_NAME}`);
    const url = new URL(URL_);
    url.pathname = `/${DB_NAME}`;
    pool = postgres(url.toString(), { max: 8, onnotice: () => {} });
    h.db = drizzle(pool, { schema });
    const enums = Object.fromEntries(Object.entries(schema).filter(([, v]) => isPgEnum(v)));
    const tables = { employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants, customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures, products: schema.products, productCategories: schema.productCategories, incentiveAudit: schema.incentiveAudit };
    await pool.unsafe("create extension if not exists pg_trgm");
    for (const s of await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ ...enums, ...tables }))) {
      try {
        await pool.unsafe(s);
      } catch (e) {
        if (!(/FOREIGN KEY/i.test(s) && /does not exist/i.test((e as Error).message))) throw e;
      }
    }
    for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql"]) await pool.unsafe(readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8"));
    for (const k of ["runner", "submitter", "a1", "a2", "payerA", "payerB", "q1", "q2", "rep", "author", "checker"]) who[k] = ((await one(pool`insert into employees (name, email, role, is_admin) values (${k}, ${`${k}@example.test`}, 'both', true) returning id`)) as { id: string }).id;
    calc = await import("@/lib/queries/incentive-calc");
    rules = await import("@/lib/queries/incentive-rules");
    qualify = await import("@/lib/queries/incentive-b-qualify");
    const p = await rules.createProgram(actor("author"), { code: "CONC", name: "Concurrency", description: null });
    if (!p.ok) throw new Error(p.error);
    programId = p.programId;
    const elig = [{ subjectType: "employee" as const, subjectId: who.rep!, role: null, subjectLabel: "rep", mode: "include" as const, effectiveFrom: "2024-01-01", effectiveTo: null }];
    await publish("B", { ...bConfig({ "payout.approvalSteps": 2, "payout.release": "afterApproval" }), eligibility: elig });
    await publish("A", { ...aprilConfig(), eligibility: elig });
    const customer = ((await one(pool`insert into customer_masters (name, sales_rep_id) values ('Customer One', ${who.rep!}) returning id`)) as { id: string }).id;
    const batch = ((await one(pool`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 't.xlsx', 'x') returning id`)) as { id: string }).id;
    const drive = ((await one(pool`insert into products (name, brand) values ('Drive', 'Alpha') returning id`)) as { id: string }).id;
    const motor = ((await one(pool`insert into products (name, brand) values ('Motor', 'Beta') returning id`)) as { id: string }).id;
    const doc = async (type: string, no: string, date: string, total: number, taxable: number, ref: string | null, due: string | null, lines: unknown[] = []) => {
      docs[no] = ((await one(pool`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values (${`${type}|${no}`}, ${type}, ${no}, ${no.toLowerCase()}, ${date}, '2026-27', 'Customer One', 'customer one', ${customer}, ${total}, ${taxable}, ${ref}, ${due}, ${JSON.stringify(lines)}::jsonb, ${batch}, 1) returning id`)) as { id: string }).id;
      return docs[no]!;
    };
    await doc("sales-orders", "SO H", "2025-06-10", RS(59_000), RS(50_000), null, null, [{ item: "Drive", quantity: 1, ratePaise: RS(50_000), amountPaise: RS(50_000), productId: drive }]);
    const so = await doc("sales-orders", "SO 1", "2026-04-02", RS(1_41_600), RS(1_20_000), null, null, [{ item: "Motor", quantity: 1, ratePaise: RS(1_20_000), amountPaise: RS(1_20_000), productId: motor }]);
    const inv = await doc("sales-invoices", "INV 1", "2026-04-05", RS(1_41_600), RS(1_20_000), so, "2026-05-05");
    await doc("customer-receipts", "RC 1", "2026-05-01", RS(1_41_600), RS(1_41_600), inv, null);
  }, 300_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
      await admin.end();
    }
  });

  it("Category A and Category B months of one programme are calculated at the same moment, each in its own period", async () => {
    const [a, b] = await Promise.all([calc.calculate(actor("runner"), programId, APR, "2026-05-31", "A"), calc.calculate(actor("runner"), programId, APR, "2026-05-31", "B")]);
    expect(a).toMatchObject({ ok: true, status: "computed" });
    expect(b).toMatchObject({ ok: true, status: "computed", adopted: true });
    expect(await pool`select category_code from incentive_calc_periods where month = ${APR} order by 1`).toEqual([{ category_code: "A" }, { category_code: "B" }]);
  });
  it("two manual decisions on the same order at once: exactly one is recorded", async () => {
    const r = await Promise.all([qualify.recordOverride(actor("q1"), { orderId: docs["SO 1"]!, decision: "exclude", reason: "one" }), qualify.recordOverride(actor("q2"), { orderId: docs["SO 1"]!, decision: "exclude", reason: "two" })]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(((await one(pool`select count(*)::int n from incentive_calc_b_overrides where retired_at is null`)) as { n: number }).n).toBe(1);
    const active = (await one(pool`select id from incentive_calc_b_overrides where retired_at is null`)) as { id: string };
    expect(await qualify.retireOverride(actor("q1"), active.id, "test done")).toMatchObject({ ok: true });
  });
  it("two approvals of the same step at once: exactly one is recorded", async () => {
    expect(await calc.setLocked(actor("runner"), programId, APR, true, await rv(), "B")).toMatchObject({ ok: true });
    expect(await calc.submitMonth(actor("submitter"), programId, APR, await rv(), "B")).toMatchObject({ ok: true });
    const v = await rv();
    const r = await Promise.all([calc.decideMonth(actor("a1"), programId, APR, v, "approve", null, undefined, "B"), calc.decideMonth(actor("a2"), programId, APR, v, "approve", null, undefined, "B")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(((await one(pool`select count(*)::int n from incentive_calc_approvals`)) as { n: number }).n).toBe(1);
  });
  it("two payouts at once: exactly one is recorded, for the approved amount", async () => {
    const second = (await one(pool`select actor_id from incentive_calc_approvals limit 1`)) as { actor_id: string };
    const next = second.actor_id === who.a1 ? "a2" : "a1";
    expect(await calc.decideMonth(actor(next), programId, APR, await rv(), "approve", null, undefined, "B")).toMatchObject({ ok: true, status: "approved" });
    const p = (await one(pool`select row_version, release_on::text r from incentive_calc_periods where category_code = 'B' and month = ${APR}`)) as { row_version: number; r: string };
    const r = await Promise.all(["payerA", "payerB"].map((k) => calc.recordPayout(actor(k), programId, APR, Number(p.row_version), { reference: `PAY-${k}`, paidOn: p.r, amountPaise: RS(1_200), note: null }, p.r, "B")));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(await pool`select count(*)::int n, sum(total_paise)::int t from incentive_calc_payouts`).toEqual([{ n: 1, t: RS(1_200) }]);
  });
});
