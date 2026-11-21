import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 0138 preflight / apply / rollback / verification runners' SAFETY LOGIC (scripts/incentive-0138/core.ts), proven on
// an in-memory PGlite database at production's 0137 state (0131–0137's own SQL, testimonials as 0068 created it, a
// synthetic 150-row ledger, RLS on every table) WITH existing Category F Google records, so their preservation is
// proven. No connection, no .env, no shared or production database: the command-line runners are never imported or run.
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import * as core from "@/scripts/incentive-0138/core";
import * as core137 from "@/scripts/incentive-0137/core";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
const RAW = (dir: string, f: string) => readFileSync(resolve(__dirname, `../../db/${dir}/${f}`));
const LF = (dir: string, f: string) => core.canonicalBytes(RAW(dir, f)).toString("utf8");
const migration = core.pinned(core.FILES.migration, RAW("migrations", core.FILES.migration), core.PINS.migration);
const rollback = core.pinned(core.FILES.rollback, RAW("rollback", core.FILES.rollback), core.PINS.rollback);
const ref = core.reference(core.pinned(core.FILES.m0136, RAW("migrations", core.FILES.m0136), core.PINS.m0136), core.pinned(core.FILES.m0137, RAW("migrations", core.FILES.m0137), core.PINS.m0137));
let E: core.Expect;
const SENTINEL = "__undo__";
let googleReview = "";

type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> };
const execOf = (q: Q): core.Exec => ({ query: async <T>(t: string, p: unknown[] = []) => (await q.query(t, p)).rows as T[], exec: async (t: string) => void (await q.exec(t)) });
const inTx = <T>(fn: (x: core.Exec) => Promise<T>) => pg.transaction(async (tx) => fn(execOf(tx as unknown as Q)));
const scratch = (fn: (x: core.Exec) => Promise<void>) =>
  pg
    .transaction(async (tx) => {
      await fn(execOf(tx as unknown as Q));
      throw new Error(SENTINEL);
    })
    .catch((e: Error) => {
      if (e.message !== SENTINEL) throw e;
    });
const x0 = () => execOf(pg as unknown as Q);
const ledgerCount = async () => (await pg.query<{ n: number }>(`select count(*)::int n from public.__schema_applied`)).rows[0]!.n;
const at0137 = async () => (await core.present0138(x0())).columns.length === 0;

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
  const t68 = LF("migrations", "0068_incentive_spine.sql");
  await pg.exec(t68.slice(t68.indexOf("CREATE TABLE IF NOT EXISTS testimonials ("), t68.indexOf("\n", t68.indexOf("CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx"))));
  await pg.exec(`create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated;`);
  const chain = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", core.FILES.m0136, core.FILES.m0137];
  for (const f of chain) await pg.exec(LF("migrations", f));
  await pg.exec(`create table public.__schema_applied (filename text primary key, applied_at timestamptz not null default now())`);
  for (const n of [...Array.from({ length: 143 }, (_, i) => `0000_earlier_${String(i).padStart(3, "0")}.sql`), ...chain]) await pg.query(`insert into public.__schema_applied (filename) values ($1) on conflict do nothing`, [n]);
  await pg.exec(`do $$ declare r record; begin for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' loop execute format('alter table public.%I enable row level security', r.relname); end loop; end $$;`);
  // Existing Category F data (as 0137 allows): a Google review, its submission, its verification by another person.
  const asha = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)).rows[0]!.id;
  const ravi = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Ravi', 'ravi@example.test', 'both') returning id`)).rows[0]!.id;
  await pg.query(`insert into testimonials (employee_id, period_month, kind, word_count, star_rating, review_status) values ($1, '2026-10', 'google_review', 60, 5, 'approved')`, [asha]);
  googleReview = (await pg.query<{ id: string }>(`insert into incentive_f_reviews (google_review_id, url_key, first_url, created_by_id, created_by_name) values ('ChTESTxxxxxx', 'google.com/maps/r/1', 'https://www.google.com/maps/r/1', $1, 'Asha') returning id`, [asha])).rows[0]!.id;
  await pg.query(`insert into incentive_f_submissions (review_id, link_state, submitted_by_id, submitted_by_name, submitted_url, claimed_rating, claimed_published_on) values ($1, 'new', $2, 'Asha', 'https://www.google.com/maps/r/1', 5, '2026-10-05')`, [googleReview, asha]);
  await pg.query(`insert into incentive_f_decisions (review_id, kind, rating, published_on, review_month, named_employee_ids, named_employee_names, reason, created_by_id, created_by_name) values ($1, 'verify', 5, '2026-10-05', '2026-10-01', array[$2]::uuid[], array['Asha'], 'Checked the public review', $3, 'Ravi')`, [googleReview, asha, ravi]);
  if ((await ledgerCount()) !== 150) throw new Error("fixture ledger");
  E = { ledger: { before: 150, after: 151 }, tables: (await core.tableCount(x0())).n, role: false };
}, 240_000);
afterAll(async () => {
  await pg?.close();
});

describe("0138 runners: pinned files and the target", () => {
  it("the pins are the files' canonical (LF) bytes; a CRLF checkout matches; any other byte is refused", () => {
    expect(core.sha256(core.canonicalBytes(RAW("migrations", core.FILES.migration)))).toBe(core.PINS.migration);
    expect(core.sha256(core.canonicalBytes(RAW("rollback", core.FILES.rollback)))).toBe(core.PINS.rollback);
    expect(core.PINS.m0137).toBe("cdb113767678f95635b3d03e1090c4e86b3566963bb53b48d484a02fe736962d");
    expect(core.pinned("x.sql", Buffer.from(migration.replace(/\n/g, "\r\n")), core.PINS.migration)).toBe(migration);
    expect(() => core.pinned("x.sql", Buffer.from(`${migration}\n-- extra\n`), core.PINS.migration)).toThrow(/is not the pinned/);
    expect(ref.keys0137).toHaveLength(99);
  });
  it("production's expectation is ledger 150 → 151 and 170 tables; only production's fingerprint on a Supabase host is accepted", () => {
    expect(core.PRODUCTION).toEqual({ ledger: { before: 150, after: 151 }, tables: 170, role: true });
    expect(() => core.assertProduction("postgres://someone:pw@db.example.supabase.co:5432/postgres")).toThrow(/is not production \(ed679a28f0\)/);
  });
});

describe("0138 preflight (read only): refuses every unexpected state", () => {
  it("passes on the expected state and changes nothing", async () => {
    const before = await core137.dataFingerprints(x0());
    await expect(inTx((x) => core.preApply(x, E, ref))).resolves.toMatchObject({ rows: { incentive_f_reviews: 1, incentive_f_submissions: 1, incentive_f_decisions: 1, incentive_f_writeoffs: 0 } });
    expect(await core137.dataFingerprints(x0())).toEqual(before);
  });
  it("wrong role, wrong ledger, a table without RLS", async () => {
    await expect(inTx((x) => core.preApply(x, { ...E, role: true }, ref))).rejects.toThrow(/unexpected role\/db/);
    await scratch(async (x) => {
      await x.query(`insert into public.__schema_applied (filename) values ('0099_extra.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/ledger has 151 rows; expected 150/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.m0137]);
      await x.query(`insert into public.__schema_applied (filename) values ('0130_x.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/0137_incentive_category_f_reviews\.sql must be last/);
    });
    await scratch(async (x) => {
      await x.exec(`alter table public.employees disable row level security`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/all with RLS/);
    });
  });
  it("0138 already (partly) present, or the database not exactly 0137", async () => {
    await scratch(async (x) => {
      await x.exec(`alter table incentive_f_submissions add column claimed_kind text`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/0138's objects already \(partly\) exist/);
    });
    await scratch(async (x) => {
      await x.exec(`create index extra_f_idx on incentive_f_reviews (source)`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/differ from the pinned listing/);
    });
  });
  it("existing Category F data 0138's stricter checks would refuse (a NULL rating 0137 let through) is reported before anything runs", async () => {
    await scratch(async (x) => {
      const r = (await x.query<{ id: string }>(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ('google.com/maps/r/null', 'u', 'x') returning id`))[0]!.id;
      await x.query(`insert into incentive_f_decisions (review_id, kind, rating, published_on, review_month, reason, created_by_name) values ($1, 'verify', null, '2026-10-05', '2026-10-01', 'x', 'x')`, [r]);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/existing Category F data 0138's checks would refuse: 1 Google verification\(s\) without a valid rating/);
    });
  });
});

describe("0138 apply: the transaction rolls back on any difference", () => {
  const nothingKept = async () => {
    expect(await at0137()).toBe(true);
    expect(await ledgerCount()).toBe(150);
  };
  it("existing data changed outside Category F → refused, nothing kept", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    await nothingKept();
  });
  it("Category F rows changed beyond the new columns → refused", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nINSERT INTO incentive_f_reviews (url_key, first_url, created_by_name) VALUES ('google.com/maps/r/2', 'u', 'x');`, E, ref))).rejects.toThrow(/Category F rows changed beyond 0138's new columns in: incentive_f_reviews/);
    await nothingKept();
  });
  it("an object outside Category F changed, or a check 0137 established → refused", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nCREATE INDEX extra_idx ON employees (name);`, E, ref))).rejects.toThrow(/an object outside Category F changed/);
    await expect(inTx((x) => core.applyIn(x, `${migration}\nALTER TABLE testimonials DROP CONSTRAINT testimonials_employee_named_check;`, E, ref))).rejects.toThrow(/testimonials changed|0137 established/);
    await nothingKept();
  });
  it("a 0138 object differing from the pinned listing (the identity index not unique), or a COMMIT inside the text → refused", async () => {
    const loose = migration.replace(`CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_evidence_key_uq"`, `CREATE INDEX IF NOT EXISTS "incentive_f_decisions_evidence_key_uq"`);
    expect(loose).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, loose, E, ref))).rejects.toThrow(/differ from the pinned 0138 listing/);
    await expect(inTx((x) => core.applyIn(x, `COMMIT; BEGIN;\n${migration}`, E, ref))).rejects.toThrow(/ended the transaction/);
    await nothingKept();
  });
  it("applies: every table's data unchanged (Category F without the new columns), existing Google records typed google_review, ledger 150 → 151", async () => {
    const before = await core.fFingerprints(x0());
    await expect(inTx((x) => core.applyIn(x, migration, E, ref))).resolves.toMatchObject({ tables: E.tables });
    expect(await core.fFingerprints(x0())).toEqual(before);
    expect((await pg.query<{ k: string }>(`select testimonial_kind k from incentive_f_decisions where review_id = $1`, [googleReview])).rows).toEqual([{ k: "google_review" }]);
    expect((await pg.query<{ k: string }>(`select claimed_kind k from incentive_f_submissions`)).rows).toEqual([{ k: "google_review" }]);
    const v = await inTx((x) => core.verifyApplied(x, E, ref));
    expect(v.every((c) => c.ok)).toBe(true);
    expect(v.map((c) => c.check).join(" | ")).toMatch(/rollback still possible/);
    await expect(inTx((x) => core.preApply(x, { ...E, ledger: { before: 151, after: 152 } }, ref))).rejects.toThrow(/must be last|already recorded|already \(partly\) exist/);
  });
});

describe("0138 rollback", () => {
  it("refuses while data only 0138 allows exists (an email submission, an appreciation) — and the rollback SQL refuses on its own", async () => {
    await scratch(async (x) => {
      await x.query(`insert into incentive_f_submissions (link_state, submitted_by_name, submitted_url, claimed_kind, claimed_rating, claimed_published_on) values ('unresolved', 'x', 'https://files.example.test/m.eml', 'email', null, '2026-11-02')`);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/rollback refused: data only 0138 allows exists \(email \/ letterhead/);
      await expect(x.exec(rollback)).rejects.toThrow(/0138 rollback refused/);
    });
    const verifyApplied = await inTx((x) => core.verifyApplied(x, E, ref));
    expect(verifyApplied.every((c) => c.ok)).toBe(true);
  });
  it("refuses unless the ledger is 151 with 0138 last", async () => {
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.migration]);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/ledger has 150 rows; expected 151/);
    });
  });
  it("a difference during the rollback → refused; 0138 stays", async () => {
    await expect(inTx((x) => core.rollbackIn(x, `${rollback}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    expect(await at0137()).toBe(false);
  });
  it("rolls back to EXACTLY 0137 (its pinned listing), keeps every row, ledger 151 → 150; then 0138 applies again", async () => {
    const before = await core.fFingerprints(x0());
    await expect(inTx((x) => core.rollbackIn(x, rollback, E, ref))).resolves.toMatchObject({ tables: E.tables });
    expect(core137.sha256(await core137.canonical0137(x0()))).toBe(core137.CANON_0137);
    expect(await core.fFingerprints(x0())).toEqual(before);
    expect(await ledgerCount()).toBe(150);
    expect((await inTx((x) => core.verifyRolledBack(x, E, ref))).every((c) => c.ok)).toBe(true);
    await expect(inTx((x) => core.applyIn(x, migration, E, ref))).resolves.toMatchObject({ tables: E.tables });
  });
});
