import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 0139 preflight / apply / rollback / verification runners' SAFETY LOGIC (scripts/incentive-0139/core.ts), proven on
// an in-memory PGlite database at the state production will have after 0138 (0131–0138's own SQL, testimonials as 0068
// created it, a synthetic 151-row ledger, RLS on every table) WITH existing Category F Google records and their input
// history, so their preservation is proven. PGlite is ONE connection: this proves the logic, not concurrency (see
// tests/integration/incentive-category-f-concurrency.pg.test.ts for real PostgreSQL). No connection, no .env, no shared
// or production database: the command-line runners are never imported or run.
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import * as core from "@/scripts/incentive-0139/core";
import * as core137 from "@/scripts/incentive-0137/core";
import * as core138 from "@/scripts/incentive-0138/core";

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
let cust = "";
let ravi = "";

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
const at0138 = async () => (await core.present0139(x0())).columns.length === 0;
const fp = (kind: "email" | "letter", s: string) => `${kind}:${createHash("sha256").update(s).digest("hex")}`;
/** A verified email decision (0139's shape) on a fresh review. */
let reviews = 0;
const emailVerify = async (x: core.Exec, o: { mid: string | null; fingerprint: string }) => {
  const r = (await x.query<{ id: string }>(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ($1, 'u', 'x') returning id`, [`files.example.test/mail-${++reviews}.eml`]))[0]!.id;
  await x.query(
    `insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, evidence_message_id, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-11-02', '2026-11-01', $2, $3, $4, true, true, true, $5, 'x', 'x')`,
    [r, o.mid ? `email:mid:${o.mid}` : o.fingerprint, o.mid, o.fingerprint, cust],
  );
  return r;
};

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
  const chain = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", core.FILES.m0136, core.FILES.m0137, core.FILES.m0138];
  for (const f of chain) await pg.exec(LF("migrations", f));
  await pg.exec(`create table public.__schema_applied (filename text primary key, applied_at timestamptz not null default now())`);
  for (const n of [...Array.from({ length: 143 }, (_, i) => `0000_earlier_${String(i).padStart(3, "0")}.sql`), ...chain]) await pg.query(`insert into public.__schema_applied (filename) values ($1) on conflict do nothing`, [n]);
  await pg.exec(`do $$ declare r record; begin for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' loop execute format('alter table public.%I enable row level security', r.relname); end loop; end $$;`);
  // Existing Category F data (as 0138 allows): a Google review, its submission, its verification, its input history.
  const asha = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)).rows[0]!.id;
  ravi = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Ravi', 'ravi@example.test', 'both') returning id`)).rows[0]!.id;
  cust = (await pg.query<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Cust A', $1, 30) returning id`, [asha])).rows[0]!.id;
  googleReview = (await pg.query<{ id: string }>(`insert into incentive_f_reviews (google_review_id, url_key, first_url, created_by_id, created_by_name) values ('ChTESTxxxxxx', 'google.com/maps/r/1', 'https://www.google.com/maps/r/1', $1, 'Asha') returning id`, [asha])).rows[0]!.id;
  await pg.query(`insert into incentive_f_submissions (review_id, link_state, submitted_by_id, submitted_by_name, submitted_url, claimed_rating, claimed_published_on) values ($1, 'new', $2, 'Asha', 'https://www.google.com/maps/r/1', 5, '2026-10-05')`, [googleReview, asha]);
  const d = (await pg.query<{ id: string }>(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, rating, published_on, review_month, named_employee_ids, named_employee_names, reason, created_by_id, created_by_name) values ($1, 'verify', 'google_review', 5, '2026-10-05', '2026-10-01', array[$2]::uuid[], array['Asha'], 'Checked the public review', $3, 'Ravi') returning id`, [googleReview, asha, ravi])).rows[0]!.id;
  await pg.query(`insert into incentive_calc_input_history (entity, entity_id, action, after, note, actor_id, actor_name) values ('f-decision', $1, 'record', '{}'::jsonb, 'Checked the public review', $2, 'Ravi')`, [d, ravi]);
  if ((await ledgerCount()) !== 151) throw new Error("fixture ledger");
  E = { ledger: { before: 151, after: 152 }, tables: (await core.tableCount(x0())).n, role: false };
}, 240_000);
afterAll(async () => {
  await pg?.close();
});

describe("0139 runners: pinned files and the target", () => {
  it("the pins are the files' canonical (LF) bytes; a CRLF checkout matches; any other byte is refused; 0138 / 0137 / 0136 pinned as reviewed", () => {
    expect(core.sha256(core.canonicalBytes(RAW("migrations", core.FILES.migration)))).toBe(core.PINS.migration);
    expect(core.sha256(core.canonicalBytes(RAW("rollback", core.FILES.rollback)))).toBe(core.PINS.rollback);
    expect(core.PINS.m0138).toBe("abdb88095cd496fd5bae2ccf16a708c4e7c4d514e91e650080fd83ac658f7f3b");
    expect(core.PINS.m0137).toBe("cdb113767678f95635b3d03e1090c4e86b3566963bb53b48d484a02fe736962d");
    expect(core.pinned("x.sql", Buffer.from(migration.replace(/\n/g, "\r\n")), core.PINS.migration)).toBe(migration);
    expect(() => core.pinned("x.sql", Buffer.from(`${migration}\n-- extra\n`), core.PINS.migration)).toThrow(/is not the pinned/);
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });
  it("production's expectation is ledger 151 → 152 and 170 tables (after 0138); only production's fingerprint is accepted", () => {
    expect(core.PRODUCTION).toEqual({ ledger: { before: 151, after: 152 }, tables: 170, role: true });
    expect(() => core.assertProduction("postgres://someone:pw@db.example.supabase.co:5432/postgres")).toThrow(/is not production \(ed679a28f0\)/);
  });
});

describe("0139 preflight (read only): refuses every unexpected state", () => {
  it("passes on the expected state and changes nothing", async () => {
    const before = await core137.dataFingerprints(x0());
    await expect(inTx((x) => core.preApply(x, E, ref))).resolves.toMatchObject({ rows: { incentive_f_reviews: 1, incentive_f_submissions: 1, incentive_f_decisions: 1, incentive_f_writeoffs: 0, incentive_calc_input_history: 1 } });
    expect(await core137.dataFingerprints(x0())).toEqual(before);
  });
  it("wrong ledger (0138 not last), a table without RLS", async () => {
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.m0138]);
      await x.query(`insert into public.__schema_applied (filename) values ('0130_x.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/0138_incentive_category_f_testimonials\.sql must be last/);
    });
    await scratch(async (x) => {
      await x.exec(`alter table public.incentive_calc_input_history disable row level security`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/all with RLS/);
    });
  });
  it("0139 already (partly) present, or the database not exactly 0138", async () => {
    await scratch(async (x) => {
      await x.exec(`alter table incentive_f_decisions add column evidence_fingerprint text`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/0139's objects already \(partly\) exist/);
    });
    await scratch(async (x) => {
      await x.exec(`create index extra_f_idx on incentive_f_decisions (evidence_key)`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/differ from the pinned 0138 listing/);
    });
  });
  it("an email or letterhead verification without a derived identity is reported before anything runs (0139 would refuse it)", async () => {
    await scratch(async (x) => {
      const r = (await x.query<{ id: string }>(`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ('files.example.test/m.eml', 'u', 'x') returning id`))[0]!.id;
      await x.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-11-02', '2026-11-01', 'free text', true, true, true, $2, 'x', 'x')`, [r, cust]);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/existing Category F data 0139 would refuse: 1 email \/ letterhead verification/);
      // …and the migration's own guard refuses it too.
      await expect(x.exec(migration)).rejects.toThrow(/0139 refused: an email or letterhead verification exists without a derived identity/);
    });
  });
});

describe("0139 apply: the transaction rolls back on any difference", () => {
  const nothingKept = async () => {
    expect(await at0138()).toBe(true);
    expect(await ledgerCount()).toBe(151);
  };
  it("existing data changed outside Category F → refused, nothing kept", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    await nothingKept();
  });
  it("existing input history changed → refused", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nINSERT INTO incentive_calc_input_history (entity, entity_id, action, actor_name) VALUES ('f-writeoff', gen_random_uuid(), 'record', 'x');`, E, ref))).rejects.toThrow(/existing data changed in: incentive_calc_input_history/);
    await nothingKept();
  });
  it("Category F rows changed beyond the new columns → refused", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nINSERT INTO incentive_f_reviews (url_key, first_url, created_by_name) VALUES ('google.com/maps/r/2', 'u', 'x');`, E, ref))).rejects.toThrow(/Category F rows changed beyond 0139's new columns in: incentive_f_reviews/);
    await nothingKept();
  });
  it("an object outside Category F changed, or another check 0137 established → refused", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nCREATE INDEX extra_idx ON employees (name);`, E, ref))).rejects.toThrow(/an object outside Category F changed/);
    await expect(inTx((x) => core.applyIn(x, `${migration}\nALTER TABLE incentive_calc_adjustments DROP CONSTRAINT incentive_calc_adjustments_writeoff_check;`, E, ref))).rejects.toThrow(/0137 established/);
    await nothingKept();
  });
  it("a 0139 object differing from the pinned listing (the fingerprint index not unique), or a COMMIT inside the text → refused", async () => {
    const loose = migration.replace(`CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_fingerprint_uq"`, `CREATE INDEX IF NOT EXISTS "incentive_f_decisions_fingerprint_uq"`);
    expect(loose).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, loose, E, ref))).rejects.toThrow(/differ from the pinned 0139 listing/);
    await expect(inTx((x) => core.applyIn(x, `COMMIT; BEGIN;\n${migration}`, E, ref))).rejects.toThrow(/ended the transaction/);
    await nothingKept();
  });
  it("applies: every table's data unchanged (Category F without the new columns; the input history), the new columns empty, the entity list + 'f-writeoff', ledger 151 → 152", async () => {
    const before = await core.fFingerprints(x0());
    const hist = await core137.dataFingerprints(x0());
    await expect(inTx((x) => core.applyIn(x, migration, E, ref))).resolves.toMatchObject({ tables: E.tables });
    expect(await core.fFingerprints(x0())).toEqual(before);
    expect((await core137.dataFingerprints(x0())).incentive_calc_input_history).toBe(hist.incentive_calc_input_history);
    expect((await pg.query(`select evidence_message_id, evidence_fingerprint from incentive_f_decisions`)).rows).toEqual([{ evidence_message_id: null, evidence_fingerprint: null }]);
    expect((await pg.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'incentive_calc_input_history_entity_check'`)).rows[0]!.d).toBe(core.ENTITY_0139);
    const v = await inTx((x) => core.verifyApplied(x, E, ref));
    expect(v.filter((c) => !c.ok)).toEqual([]);
    expect(v.map((c) => c.check).join(" | ")).toMatch(/Category F decisions preserved: 1; their input history: 1 rows \| rollback still possible/);
    await expect(inTx((x) => core.preApply(x, { ...E, ledger: { before: 152, after: 153 } }, ref))).rejects.toThrow(/must be last|already recorded|already \(partly\) exist/);
  });
  it("after 0139 the database itself refuses an email without a well-formed identity, and the same email (fingerprint or Message-ID) twice", async () => {
    await scratch(async (x) => {
      await emailVerify(x, { mid: "a1@cust-a.example", fingerprint: fp("email", "one") });
      // The same fingerprint under another Message-ID; the same Message-ID under another fingerprint.
      await expect(emailVerify(x, { mid: "a2@cust-a.example", fingerprint: fp("email", "one") })).rejects.toThrow(/incentive_f_decisions_fingerprint_uq/);
    });
    await scratch(async (x) => {
      await emailVerify(x, { mid: "a1@cust-a.example", fingerprint: fp("email", "one") });
      await expect(emailVerify(x, { mid: "a1@cust-a.example", fingerprint: fp("email", "two") })).rejects.toThrow(/incentive_f_decisions_(message_id|evidence_key)_uq/);
    });
    await scratch(async (x) => {
      await expect(emailVerify(x, { mid: "UPPER@Case.example", fingerprint: fp("email", "three") })).rejects.toThrow(/incentive_f_decisions_identity_check/);
    });
    await scratch(async (x) => {
      await expect(emailVerify(x, { mid: null, fingerprint: "email:not-a-hash" })).rejects.toThrow(/incentive_f_decisions_identity_check/);
    });
    // A retired verification frees its identity (a corrected verification can be recorded again).
    await scratch(async (x) => {
      const r = await emailVerify(x, { mid: null, fingerprint: fp("email", "four") });
      await x.query(`update incentive_f_decisions set retired_at = now(), retired_by_id = $2, retired_reason = 'corrected' where review_id = $1`, [r, ravi]);
      await emailVerify(x, { mid: null, fingerprint: fp("email", "four") });
    });
  });
});

describe("0139 rollback", () => {
  it("refuses while data only 0139 allows exists (an email identity; a write-off in the input history) — and the rollback SQL refuses on its own", async () => {
    await scratch(async (x) => {
      await emailVerify(x, { mid: null, fingerprint: fp("email", "five") });
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/rollback refused: data only 0139 allows exists/);
      await expect(x.exec(rollback)).rejects.toThrow(/0139 rollback refused/);
    });
    await scratch(async (x) => {
      await x.query(`insert into incentive_calc_input_history (entity, entity_id, action, actor_name) values ('f-writeoff', gen_random_uuid(), 'record', 'x')`);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/write-off history/);
      await expect(x.exec(rollback)).rejects.toThrow(/0139 rollback refused/);
    });
    expect((await inTx((x) => core.verifyApplied(x, E, ref))).every((c) => c.ok)).toBe(true);
  });
  it("refuses unless the ledger is 152 with 0139 last", async () => {
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.migration]);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/ledger has 151 rows; expected 152/);
    });
  });
  it("a difference during the rollback → refused; 0139 stays", async () => {
    await expect(inTx((x) => core.rollbackIn(x, `${rollback}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    expect(await at0138()).toBe(false);
  });
  it("rolls back to EXACTLY 0138 (its pinned listing, 0137's entity list), keeps every row, ledger 152 → 151; then 0139 applies again", async () => {
    const before = await core.fFingerprints(x0());
    await expect(inTx((x) => core.rollbackIn(x, rollback, E, ref))).resolves.toMatchObject({ tables: E.tables });
    expect(core.sha256(await core138.canonical0138(x0()))).toBe(core138.CANON_0138);
    expect(await core.fFingerprints(x0())).toEqual(before);
    expect(await ledgerCount()).toBe(151);
    expect((await inTx((x) => core.verifyRolledBack(x, E, ref))).every((c) => c.ok)).toBe(true);
    await expect(inTx((x) => core.applyIn(x, migration, E, ref))).resolves.toMatchObject({ tables: E.tables });
    expect(core.sha256(await core.canonical0139(x0()))).toBe(core.CANON_0139);
  });
});
