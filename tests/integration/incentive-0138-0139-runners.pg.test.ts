import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 0138 and 0139 runners' SAFETY LOGIC (scripts/incentive-0138/core.ts, scripts/incentive-0139/core.ts) on a REAL
// PostgreSQL server — the same functions the production runners call, through postgres.js transactions, against a
// database built to production's 0137 state (0131–0137's own SQL, testimonials as 0068 created it, a synthetic 150-row
// ledger, RLS on every table, anon / authenticated roles) WITH existing Category F Google records:
//   preflight → apply → verify for 0138 and then 0139; the missing-rating refusal; existing data preserved; columns,
//   constraints, indexes, RLS and grants exactly as pinned (the pins were taken on PGlite: a difference here is a real
//   finding); the rollback refusals while F.2 / F.3 data exists; safe rollbacks to exactly 0138 and 0137; and that the
//   apply's locks make a concurrent writer WAIT.
// It runs only when TEST_PG_URL names a throwaway server on localhost (it refuses anything else, and production's
// fingerprint), creates its own database there, and drops it afterwards. Without TEST_PG_URL every test is reported as
// SKIPPED — never silently passed. The command-line runners (which connect to production) are never imported or run.
const URL_ = process.env.TEST_PG_URL ?? "";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const target = (() => {
  if (!URL_) return null;
  const u = new URL(URL_);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) throw new Error("TEST_PG_URL must be a server on localhost");
  if (sha(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}${u.pathname}`).slice(0, 10) === "ed679a28f0") throw new Error("TEST_PG_URL is production");
  return u;
})();

import postgres from "postgres";
import { isPgEnum } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/db/schema";
import * as c137 from "@/scripts/incentive-0137/core";
import * as c138 from "@/scripts/incentive-0138/core";
import * as c139 from "@/scripts/incentive-0139/core";

const DB_NAME = `wms_f_runners_${randomBytes(4).toString("hex")}`;
let admin: ReturnType<typeof postgres>;
let pool: ReturnType<typeof postgres>;
const RAW = (dir: string, f: string) => readFileSync(resolve(__dirname, `../../db/${dir}/${f}`));
const LF = (dir: string, f: string) => c137.canonicalBytes(RAW(dir, f)).toString("utf8");
const m138 = c138.pinned(c138.FILES.migration, RAW("migrations", c138.FILES.migration), c138.PINS.migration);
const r138 = c138.pinned(c138.FILES.rollback, RAW("rollback", c138.FILES.rollback), c138.PINS.rollback);
const m139 = c139.pinned(c139.FILES.migration, RAW("migrations", c139.FILES.migration), c139.PINS.migration);
const r139 = c139.pinned(c139.FILES.rollback, RAW("rollback", c139.FILES.rollback), c139.PINS.rollback);
const ref = c138.reference(c138.pinned(c138.FILES.m0136, RAW("migrations", c138.FILES.m0136), c138.PINS.m0136), c138.pinned(c138.FILES.m0137, RAW("migrations", c138.FILES.m0137), c138.PINS.m0137));
let E138: c138.Expect;
let E139: c139.Expect;
let cust = "";
const SENTINEL = "__undo__";

const execOf = (tx: postgres.TransactionSql): c137.Exec => ({
  query: async <T>(text: string, params: unknown[] = []) => (await tx.unsafe(text, params as never[])) as unknown as T[],
  exec: async (text: string) => {
    await tx.unsafe(text);
  },
});
/** One REPEATABLE READ transaction, as the commit runners use. */
const inTx = <T>(fn: (x: c137.Exec) => Promise<T>) => pool.begin("isolation level repeatable read", (tx) => fn(execOf(tx))) as Promise<T>;
/** A transaction that is always rolled back (to try something and keep nothing). */
const scratch = (fn: (x: c137.Exec) => Promise<void>) =>
  pool
    .begin(async (tx) => {
      await fn(execOf(tx));
      throw new Error(SENTINEL);
    })
    .catch((e: Error) => {
      if (e.message !== SENTINEL) throw e;
    });
const x0 = () => ({ query: async <T>(t: string, p: unknown[] = []) => (await pool.unsafe(t, p as never[])) as unknown as T[], exec: async (t: string) => void (await pool.unsafe(t)) }) as c137.Exec;
const ledgerCount = async () => Number((await pool`select count(*) n from public.__schema_applied`)[0]!.n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stillWaiting = async (p: Promise<unknown>, ms = 600) => {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await sleep(ms);
  return !settled;
};

describe.skipIf(!target)("0138 and 0139 runners on real PostgreSQL", () => {
  beforeAll(async () => {
    admin = postgres(URL_, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${DB_NAME}`);
    // Cluster-wide roles Supabase has; created only when the throwaway server lacks them.
    await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;`);
    const url = new URL(URL_);
    url.pathname = `/${DB_NAME}`;
    pool = postgres(url.toString(), { max: 4, onnotice: () => {} });
    const enums = Object.fromEntries(Object.entries(schema).filter(([, v]) => isPgEnum(v)));
    const tables = {
      employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
      customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures,
      products: schema.products, productCategories: schema.productCategories,
      customers: schema.customers, salesOrders: schema.salesOrders, invoices: schema.invoices, receipts: schema.receipts,
      leadBatches: schema.leadBatches, leadConversions: schema.leadConversions, clientMeetings: schema.clientMeetings,
      incentiveSchemes: schema.incentiveSchemes, ruleVersions: schema.ruleVersions, incentivePeriods: schema.incentivePeriods, incentiveLedger: schema.incentiveLedger, payoutRuns: schema.payoutRuns, incentiveAudit: schema.incentiveAudit,
    };
    await pool.unsafe("create extension if not exists pg_trgm");
    for (const s of await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ ...enums, ...tables }))) {
      try {
        await pool.unsafe(s);
      } catch (e) {
        if (!(/FOREIGN KEY/i.test(s) && /does not exist/i.test((e as Error).message))) throw e;
      }
    }
    const t68 = LF("migrations", "0068_incentive_spine.sql");
    await pool.unsafe(t68.slice(t68.indexOf("CREATE TABLE IF NOT EXISTS testimonials ("), t68.indexOf("\n", t68.indexOf("CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx"))));
    await pool.unsafe(`alter default privileges in schema public grant all on tables to anon, authenticated`);
    const chain = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", c138.FILES.m0136, c138.FILES.m0137];
    for (const f of chain) await pool.unsafe(LF("migrations", f));
    await pool.unsafe(`create table public.__schema_applied (filename text primary key, applied_at timestamptz not null default now())`);
    for (const n of [...Array.from({ length: 143 }, (_, i) => `0000_earlier_${String(i).padStart(3, "0")}.sql`), ...chain]) await pool`insert into public.__schema_applied (filename) values (${n}) on conflict do nothing`;
    await pool.unsafe(`do $$ declare r record; begin for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' loop execute format('alter table public.%I enable row level security', r.relname); end loop; end $$;`);
    // Existing Category F data as 0137 allows it: a Google review, its submission, its verification by another person.
    const asha = (await pool`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)[0]!.id as string;
    const ravi = (await pool`insert into employees (name, email, role) values ('Ravi', 'ravi@example.test', 'both') returning id`)[0]!.id as string;
    cust = (await pool`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Cust A', ${asha}, 30) returning id`)[0]!.id as string;
    await pool`insert into testimonials (employee_id, period_month, kind, word_count, star_rating, review_status) values (${asha}, '2026-10', 'google_review', 60, 5, 'approved')`;
    const g = (await pool`insert into incentive_f_reviews (google_review_id, url_key, first_url, created_by_id, created_by_name) values ('ChTESTxxxxxx', 'google.com/maps/r/1', 'https://www.google.com/maps/r/1', ${asha}, 'Asha') returning id`)[0]!.id as string;
    await pool`insert into incentive_f_submissions (review_id, link_state, submitted_by_id, submitted_by_name, submitted_url, claimed_rating, claimed_published_on) values (${g}, 'new', ${asha}, 'Asha', 'https://www.google.com/maps/r/1', 5, '2026-10-05')`;
    await pool`insert into incentive_f_decisions (review_id, kind, rating, published_on, review_month, named_employee_ids, named_employee_names, reason, created_by_id, created_by_name) values (${g}, 'verify', 5, '2026-10-05', '2026-10-01', array[${asha}]::uuid[], array['Asha'], 'Checked the public review', ${ravi}, 'Ravi')`;
    if ((await ledgerCount()) !== 150) throw new Error("fixture ledger");
    const tablesNow = (await c137.tableCount(x0())).n;
    E138 = { ledger: { before: 150, after: 151 }, tables: tablesNow, role: false };
    E139 = { ledger: { before: 151, after: 152 }, tables: tablesNow, role: false };
  }, 300_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
      await admin.end();
    }
  });

  it("0138 preflight on real PostgreSQL: exactly 0137 (0137's PGlite-taken listing matches), and the missing-rating refusal", async () => {
    expect(c137.sha256(await c137.canonical0137(x0()))).toBe(c137.CANON_0137);
    await expect(inTx((x) => c138.preApply(x, E138, ref))).resolves.toMatchObject({ rows: { incentive_f_reviews: 1, incentive_f_submissions: 1, incentive_f_decisions: 1, incentive_f_writeoffs: 0 } });
    await scratch(async (x) => {
      const r = (await x.query<{ id: string }>(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ('google.com/maps/r/null', 'u', 'x') returning id`))[0]!.id;
      await x.query(`insert into incentive_f_decisions (review_id, kind, rating, published_on, review_month, reason, created_by_name) values ($1, 'verify', null, '2026-10-05', '2026-10-01', 'x', 'x')`, [r]);
      await expect(c138.preApply(x, E138, ref)).rejects.toThrow(/1 Google verification\(s\) without a valid rating/);
    });
  });

  it("0138 applies: data preserved, Google records typed, exactly as pinned (CANON_0138), RLS and grants unchanged; verify passes", async () => {
    const before = await c138.fFingerprints(x0());
    await expect(inTx((x) => c138.applyIn(x, m138, E138, ref))).resolves.toMatchObject({ tables: E138.tables });
    expect(await c138.fFingerprints(x0())).toEqual(before);
    expect((await pool`select testimonial_kind k from incentive_f_decisions`).map((r) => r.k)).toEqual(["google_review"]);
    const v = await inTx((x) => c138.verifyApplied(x, E138, ref));
    expect(v.filter((c) => !c.ok)).toEqual([]);
  });

  it("0139 preflight, apply and verify: data preserved (Category F and the input history), its identity check and unique indexes exactly as pinned (CANON_0139)", async () => {
    await expect(inTx((x) => c139.preApply(x, E139, ref))).resolves.toBeDefined();
    const before = await c139.fFingerprints(x0());
    const all = await c137.dataFingerprints(x0());
    await expect(inTx((x) => c139.applyIn(x, m139, E139, ref))).resolves.toMatchObject({ tables: E139.tables });
    expect(await c139.fFingerprints(x0())).toEqual(before);
    expect((await c137.dataFingerprints(x0())).incentive_calc_input_history).toBe(all.incentive_calc_input_history);
    const v = await inTx((x) => c139.verifyApplied(x, E139, ref));
    expect(v.filter((c) => !c.ok)).toEqual([]);
    expect(await ledgerCount()).toBe(152);
  });

  it("the database enforces the email identity on real PostgreSQL: the same fingerprint or Message-ID twice is refused", async () => {
    const fp = `email:${sha("pg-identity")}`;
    const ins = (x: c137.Exec, mid: string, fingerprint: string) =>
      x.query<{ id: string }>(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ($1, 'u', 'x') returning id`, [`files.example.test/${randomBytes(4).toString("hex")}.eml`]).then(([r]) =>
        x.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, evidence_message_id, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-11-02', '2026-11-01', $2, $3, $4, true, true, true, $5, 'x', 'x')`, [r!.id, `email:mid:${mid}`, mid, fingerprint, cust]),
      );
    await scratch(async (x) => {
      await ins(x, "pg-1@cust-a.example", fp);
      await expect(ins(x, "pg-2@cust-a.example", fp)).rejects.toThrow(/incentive_f_decisions_fingerprint_uq/);
    });
    await scratch(async (x) => {
      await ins(x, "pg-1@cust-a.example", fp);
      await expect(ins(x, "pg-1@cust-a.example", `email:${sha("other")}`)).rejects.toThrow(/incentive_f_decisions_(message_id|evidence_key)_uq/);
    });
  });

  it("while a commit transaction holds the runner's locks, a concurrent writer to Category F WAITS (then proceeds once it ends)", async () => {
    const s1 = await pool.reserve();
    const s2 = await pool.reserve();
    try {
      await s1`begin isolation level repeatable read`;
      await c139.lockFor({ query: async <T>(t: string, p: unknown[] = []) => (await s1.unsafe(t, p as never[])) as unknown as T[], exec: async (t: string) => void (await s1.unsafe(t)) });
      const writer = s2`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ('files.example.test/during-lock.eml', 'u', 'x')`.then(
        () => "inserted",
        (e: Error) => e.message,
      );
      expect(await stillWaiting(writer)).toBe(true);
      await s1`rollback`;
      expect(await writer).toBe("inserted");
    } finally {
      s1.release();
      s2.release();
    }
    await pool`delete from incentive_f_reviews where url_key = 'files.example.test/during-lock.eml'`.catch(() => undefined);
  });

  it("rollbacks refuse while F.2 / F.3 data exists (the runners and the rollback SQL themselves)", async () => {
    await scratch(async (x) => {
      const r = (await x.query<{ id: string }>(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ('files.example.test/rb.eml', 'u', 'x') returning id`))[0]!.id;
      await x.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-11-02', '2026-11-01', $2, $2, true, true, true, $3, 'x', 'x')`, [r, `email:${sha("rb")}`, cust]);
      await expect(c139.preRollback(x, E139, ref)).rejects.toThrow(/rollback refused: data only 0139 allows exists/);
      await expect(x.exec(r139)).rejects.toThrow(/0139 rollback refused/);
    });
  });

  it("safe rollbacks with no incompatible data: 0139 → exactly 0138; 0138 → exactly 0137 (data preserved); then both apply again", async () => {
    // The fixture rows written by earlier tests are Google-only; the lock test's row was removed (or never committed).
    const before = await c139.fFingerprints(x0()); // without 0138's and 0139's columns
    await expect(inTx((x) => c139.rollbackIn(x, r139, E139, ref))).resolves.toBeDefined();
    expect(c137.sha256(await c138.canonical0138(x0()))).toBe(c138.CANON_0138);
    expect((await inTx((x) => c139.verifyRolledBack(x, E139, ref))).every((c) => c.ok)).toBe(true);
    // 0138's rollback refuses while an email submission exists…
    await scratch(async (x) => {
      await x.query(`insert into incentive_f_submissions (link_state, submitted_by_name, submitted_url, claimed_kind, claimed_rating, claimed_published_on) values ('unresolved', 'x', 'https://files.example.test/m.eml', 'email', null, '2026-11-02')`);
      await expect(c138.preRollback(x, E138, ref)).rejects.toThrow(/rollback refused: data only 0138 allows exists/);
      await expect(x.exec(r138)).rejects.toThrow(/0138 rollback refused/);
    });
    // …and with none, restores 0137 exactly.
    await expect(inTx((x) => c138.rollbackIn(x, r138, E138, ref))).resolves.toBeDefined();
    expect(c137.sha256(await c137.canonical0137(x0()))).toBe(c137.CANON_0137);
    expect(await c139.fFingerprints(x0())).toEqual(before);
    expect(await ledgerCount()).toBe(150);
    await expect(inTx((x) => c138.applyIn(x, m138, E138, ref))).resolves.toBeDefined();
    await expect(inTx((x) => c139.applyIn(x, m139, E139, ref))).resolves.toBeDefined();
    expect(c137.sha256(await c139.canonical0139(x0()))).toBe(c139.CANON_0139);
  });
});
