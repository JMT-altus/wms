import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 0136 apply / rollback / verification runners' SAFETY LOGIC (scripts/incentive-0136/core.ts), proven on an
// in-memory PGlite database built from db/schema.ts plus 0131–0135's own SQL, with a synthetic ledger and RLS on every
// table as in production. No connection, no .env, no shared or production database can be reached: the command-line
// runners (apply.ts, rollback.ts, verify.ts) are never imported or run here.
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import * as core from "@/scripts/incentive-0136/core";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`));
const ROLLBACK = readFileSync(resolve(__dirname, `../../db/rollback/${core.FILES.rollback}`));
const migration = core.pinned(core.FILES.migration, MIG(core.FILES.migration), core.PINS.migration);
const rollback = core.pinned(core.FILES.rollback, ROLLBACK, core.PINS.rollback);
const ref = core.reference(core.pinned(core.FILES.m0135, MIG(core.FILES.m0135), core.PINS.m0135), migration);
let E: core.Expect;
const SENTINEL = "__undo__";

type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> };
const execOf = (q: Q): core.Exec => ({ query: async <T>(t: string, p: unknown[] = []) => (await q.query(t, p)).rows as T[], exec: async (t: string) => void (await q.exec(t)) });
/** Runs inside one transaction (as the runners do); a throw rolls everything back. */
const inTx = <T>(fn: (x: core.Exec) => Promise<T>) => pg.transaction(async (tx) => fn(execOf(tx as unknown as Q)));
/** Changes the state, runs the check, then undoes everything. */
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
const has = async (rel: string) => (await pg.query<{ ok: boolean }>(`select to_regclass($1) is not null ok`, [`public.${rel}`])).rows[0]!.ok;

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
  // Supabase's REST roles (0136 revokes them), then 0131–0135 exactly as production has them.
  // …with Supabase's default grants to them, so a missing REVOKE is really caught.
  await pg.exec(`create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated;`);
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", core.FILES.m0135]) await pg.exec(MIG(f).toString("utf8"));
  // Production's ledger shape: 148 rows, 0131–0135 last; and RLS on every public table.
  await pg.exec(`create table public.__schema_applied (filename text primary key, applied_at timestamptz not null default now())`);
  const names = [...Array.from({ length: 143 }, (_, i) => `0000_earlier_${String(i).padStart(3, "0")}.sql`), "0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", core.FILES.m0134, core.FILES.m0135];
  for (const n of names) await pg.query(`insert into public.__schema_applied (filename) values ($1) on conflict do nothing`, [n]);
  await pg.exec(`do $$ declare r record; begin for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' loop execute format('alter table public.%I enable row level security', r.relname); end loop; end $$;`);
  await pg.query(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both')`);
  const ledger = (await pg.query<{ n: number; last: string }>(`select count(*)::int n, max(filename) last from public.__schema_applied`)).rows[0]!;
  if (ledger.n !== 148 || ledger.last !== core.FILES.m0135) throw new Error(`fixture ledger ${ledger.n} / ${ledger.last}`);
  const t = await core.tableCount(x0());
  E = { ledger: { before: 148, after: 149 }, tables: { before: t.n, after: t.n + 3 }, role: false };
}, 240_000);
afterAll(async () => {
  await pg?.close();
});

describe("0136 runners: pinned files and the target", () => {
  it("the pins are exactly the files' bytes; any other bytes, or a file with its own transaction control, are refused", () => {
    expect(core.sha256(MIG(core.FILES.migration))).toBe(core.PINS.migration);
    expect(core.sha256(ROLLBACK)).toBe(core.PINS.rollback);
    expect(core.sha256(MIG(core.FILES.m0135))).toBe(core.PINS.m0135);
    expect(() => core.pinned("x.sql", MIG(core.FILES.migration), "0".repeat(64))).toThrow(/is not the pinned/);
    const tampered = Buffer.concat([MIG(core.FILES.migration), Buffer.from("\n-- one more line\n")]);
    expect(() => core.pinned("x.sql", tampered, core.PINS.migration)).toThrow(/is not the pinned/);
    for (const text of ["BEGIN;\nselect 1;\nCOMMIT;\n", "select 1; COMMIT;", "ABORT;", "COMMIT AND CHAIN;", "SAVEPOINT s1;", "RELEASE s1;", "ROLLBACK TO s1;", "PREPARE TRANSACTION 'x';", "START TRANSACTION;", "END;"]) {
      const b = Buffer.from(text);
      expect(() => core.pinned("x.sql", b, core.sha256(b)), text).toThrow(/must not contain its own transaction control/);
    }
    // A PL/pgSQL block's BEGIN / END isn't transaction control.
    const block = Buffer.from("DO $$\nBEGIN\n  PERFORM 1;\nEND\n$$;\n");
    expect(core.pinned("x.sql", block, core.sha256(block))).toContain("PERFORM 1");
  });
  it("the settings lists and function bodies come from the pinned files: 0136 is 0135 plus exactly six keys", () => {
    expect(ref.keys0135).toHaveLength(89);
    expect(ref.keys0136).toHaveLength(95);
    expect(ref.fnBody0136).toContain("'payout.minimumPayable'");
    expect(ref.fnBody0135).not.toContain("payout.");
    expect(() => core.reference(MIG(core.FILES.m0135).toString("utf8"), MIG(core.FILES.m0135).toString("utf8"))).toThrow(/plus exactly its six keys/);
  });
  it("only production's exact fingerprint on a Supabase host is accepted (synthetic URLs; the real one is never read here)", () => {
    expect(() => core.assertProduction("postgres://someone:pw@db.example.supabase.co:5432/postgres")).toThrow(/is not production \(ed679a28f0\)/);
    expect(() => core.assertProduction("postgres://postgres:pw@localhost:5432/postgres")).toThrow(/is not production/);
    expect(core.fingerprintOf("postgres://a:b@h:1/d")).toBe(core.fingerprintOf("postgres://a:other@h:1/d")); // the password never matters
    expect(core.fingerprintOf("postgres://a:b@h:1/d")).toMatch(/^[0-9a-f]{10}$/);
  });
  it("SQL lists are built from constants only", () => {
    expect(core.lit(["a.b", "c_d"])).toBe("'a.b', 'c_d'");
    expect(() => core.lit(["x'; drop table employees; --"])).toThrow(/unsafe identifier/);
  });
});

describe("0136 apply runner: preconditions refuse every unexpected state", () => {
  it("the production role check refuses anything but postgres / BYPASSRLS / database postgres (PGlite's database isn't)", async () => {
    await expect(core.checkRole(x0())).rejects.toThrow(/unexpected role\/db/);
    await expect(inTx((x) => core.preApply(x, { ...E, role: true }, ref))).rejects.toThrow(/unexpected role\/db/);
  });
  it("passes on the expected state (read only: it changes nothing)", async () => {
    const before = await core.dataFingerprints(x0());
    await expect(inTx((x) => core.preApply(x, E, ref))).resolves.toMatchObject({ ledger: expect.any(Array) });
    expect(await core.dataFingerprints(x0())).toEqual(before);
  });
  it("wrong ledger: an extra row, 0135 not last, 0136 already recorded", async () => {
    await scratch(async (x) => {
      await x.query(`insert into public.__schema_applied (filename) values ('0099_extra.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/ledger has 149 rows; expected 148/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.m0135]);
      await x.query(`insert into public.__schema_applied (filename) values ('0130_x.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/last ledger row is 0134_incentive_category_b\.sql; 0135_incentive_categories_c_g\.sql must be last/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = '0000_earlier_000.sql'`);
      await x.query(`insert into public.__schema_applied (filename) values ($1)`, [core.FILES.migration]);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/must be last|already recorded/);
    });
  });
  it("wrong table count, a table without RLS, or 0136's objects already (partly) present", async () => {
    await expect(inTx((x) => core.preApply(x, { ...E, tables: { before: E.tables.before + 1, after: E.tables.after + 1 } }, ref))).rejects.toThrow(/expected \d+ public tables all with RLS/);
    await scratch(async (x) => {
      await x.exec(`alter table public.employees disable row level security`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/all with RLS/);
    });
    await scratch(async (x) => {
      await x.exec(`create table public.incentive_calc_carry (id int); alter table public.incentive_calc_carry enable row level security;`);
      await expect(core.preApply(x, { ...E, tables: { before: E.tables.before + 1, after: E.tables.after + 1 } }, ref)).rejects.toThrow(/0136's objects already \(partly\) exist/);
    });
    await scratch(async (x) => {
      await x.exec(`create function public.incentive_calc_carry_check() returns trigger language plpgsql as $$ begin return new; end $$;`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/already \(partly\) exist/);
    });
  });
  it("anything 0136 changes that isn't exactly 0135's (function, settings list, entity check), or a setting already using 0136's keys", async () => {
    await scratch(async (x) => {
      await x.exec(`CREATE OR REPLACE FUNCTION "incentive_config_settings_category_check"() RETURNS trigger LANGUAGE plpgsql AS $$${ref.fnBody0135}-- edited\n$$;`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/function isn't exactly 0135's/);
    });
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE incentive_calc_input_history DROP CONSTRAINT incentive_calc_input_history_entity_check; ALTER TABLE incentive_calc_input_history ADD CONSTRAINT incentive_calc_input_history_entity_check CHECK (entity IN ('attribution', 'rep-history', 'receipt-event', 'b-override', 'other'));`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/entity check isn't 0134's/);
    });
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE incentive_config_settings DROP CONSTRAINT incentive_config_settings_key_check`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/settings key check isn't exactly 0135's/);
    });
  });
});

describe("0136 apply runner: the transaction rolls back on any difference", () => {
  it("existing data changed by the migration text → refused, nothing kept", async () => {
    const before = await core.dataFingerprints(x0());
    await expect(inTx((x) => core.applyIn(x, `${migration}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    expect(await has("incentive_calc_c_reviews")).toBe(false);
    expect(await core.dataFingerprints(x0())).toEqual(before);
  });
  it("an existing object changed beyond 0136's own → refused, nothing kept", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nCREATE INDEX extra_idx ON employees (name);`, E, ref))).rejects.toThrow(/changed beyond 0136's own/);
    expect(await has("incentive_calc_carry")).toBe(false);
    expect(await has("extra_idx")).toBe(false);
  });
  it("a new object missing or different (RLS left off, an index changed) → refused, nothing kept", async () => {
    await expect(inTx((x) => core.applyIn(x, migration.replace(`ALTER TABLE "incentive_calc_period_voids" ENABLE ROW LEVEL SECURITY;`, ""), E, ref))).rejects.toThrow(/security unexpected on incentive_calc_period_voids/);
    await expect(inTx((x) => core.applyIn(x, migration.replace(`("lot_id", "period_id", "kind") WHERE`, `("lot_id", "period_id") WHERE`), E, ref))).rejects.toThrow(/unique index incentive_calc_carry_consume_uq unexpected/);
    expect(await has("incentive_calc_period_voids")).toBe(false);
  });
  it("a disabled trigger, a changed function attribute (even of the replaced function) or a new comment → refused, nothing kept", async () => {
    for (const extra of [`ALTER TABLE incentive_config_settings DISABLE TRIGGER incentive_config_settings_category;`, `ALTER FUNCTION incentive_config_settings_category_check() SECURITY DEFINER;`, `COMMENT ON TABLE employees IS 'changed';`]) {
      await expect(inTx((x) => core.applyIn(x, `${migration}\n${extra}`, E, ref)), extra).rejects.toThrow(/changed beyond 0136's own/);
    }
    expect(await has("incentive_calc_c_reviews")).toBe(false);
  });
  it("anything else about a new object differing from the pinned listing (a column made nullable) → refused", async () => {
    const loose = migration.replace(`"carried_to_month" date,\n  "summary" jsonb NOT NULL,`, `"carried_to_month" date,\n  "summary" jsonb,`);
    expect(loose).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, loose, E, ref))).rejects.toThrow(/differ from the pinned listing/);
  });
  it("the REST roles left with access (the migration's REVOKE removed) → refused", async () => {
    const noRevoke = migration.replace(/DO \$\$\nDECLARE\n {2}r text;[\s\S]*?END\n\$\$;\n?$/, "");
    expect(noRevoke).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, noRevoke, E, ref))).rejects.toThrow(/security unexpected on incentive_calc_c_reviews/);
  });
  it("text that ends the transaction itself (a COMMIT inside it) → detected and refused; what followed is rolled back", async () => {
    await expect(inTx((x) => core.applyIn(x, `COMMIT; BEGIN;\n${migration}`, E, ref))).rejects.toThrow(/ended the transaction/);
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(false);
    expect((await pg.query<{ n: number }>(`select count(*)::int n from public.__schema_applied`)).rows[0]!.n).toBe(148);
  });
  it("a statement failing halfway → the whole transaction rolls back", async () => {
    await expect(inTx((x) => core.applyIn(x, migration.replace(`CREATE TABLE IF NOT EXISTS "incentive_calc_period_voids"`, `CREATE TABLE IF NOT EXISTS "incentive_calc_period_voids_typo"`), E, ref))).rejects.toThrow();
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(false);
    expect((await pg.query<{ n: number }>(`select count(*)::int n from public.__schema_applied`)).rows[0]!.n).toBe(148);
  });
  it("applies: data and catalogue unchanged outside 0136, every object as pinned, ledger 148 → 149, three new tables", async () => {
    const r = await inTx((x) => core.applyIn(x, migration, E, ref));
    expect(r).toMatchObject({ tables: E.tables.after, keys: 95 });
    const v = await inTx((x) => core.verifyApplied(x, E, ref, { requireEmpty: true }));
    expect(v.every((c) => c.ok)).toBe(true);
    // A second apply is refused (0136 is recorded and present).
    await expect(inTx((x) => core.preApply(x, { ...E, ledger: { before: 149, after: 150 }, tables: { before: E.tables.after, after: E.tables.after + 3 } }, ref))).rejects.toThrow(/last ledger row|already/);
  });
});

describe("0136 rollback runner", () => {
  it("refuses while any data only 0136 allows exists — and the rollback SQL's own refusal still holds on its own", async () => {
    await scratch(async (x) => {
      const [e] = await x.query<{ id: string }>(`select id from employees limit 1`);
      await x.query(`insert into incentive_calc_input_history (entity, entity_id, action, actor_name) values ('c-review', $1, 'record', 'tester')`, [e!.id]);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/rollback refused: data only 0136 allows exists \(c-review input history: 1\)/);
      await expect(x.exec(rollback)).rejects.toThrow(/0136 rollback refused/);
    });
    // A row in each new table, a setting with a new key, a Category C setting with a shared key — each refused alone.
    // (Foreign keys and triggers are switched off for the transaction only to place the rows; the checks read them.)
    const R = (n: number) => `00000000-0000-4000-8000-00000000013${n}`;
    const cases: [string, RegExp][] = [
      [`insert into incentive_calc_c_reviews (document_id, case_kind, decision, reason, created_by_name) values ('${R(1)}', 'order-customer', 'exclude', 'x', 'x')`, /incentive_calc_c_reviews: 1 rows/],
      [`insert into incentive_calc_carry (program_id, category_code, employee_name, month, kind, amount_paise, period_id, run_id, created_by_name) values ('${R(1)}', 'C', 'x', '2026-11-01', 'held', 1, '${R(2)}', '${R(3)}', 'x')`, /incentive_calc_carry: 1 rows/],
      [`insert into incentive_calc_period_voids (period_id, summary, reason, created_by_name) values ('${R(1)}', '{}'::jsonb, 'x', 'x')`, /incentive_calc_period_voids: 1 rows/],
      [`insert into incentive_config_settings (version_id, setting_key, value) values ('${R(1)}', 'c.turnoverBasis', '"invoiced"'::jsonb)`, /settings using 0136's keys: 1/],
      [`insert into incentive_config_versions (id, program_id, category_code, version_no) values ('${R(4)}', '${R(1)}', 'C', 1); insert into incentive_config_settings (version_id, setting_key, value) values ('${R(4)}', 'adjust.creditNote', '"reduceOriginalMonthSales"'::jsonb)`, /Category C settings using Category A's shared keys: 1/],
    ];
    for (const [sql, re] of cases)
      await scratch(async (x) => {
        await x.exec(`set local session_replication_role = replica; ${sql}; set local session_replication_role = origin;`);
        await expect(core.preRollback(x, E, ref), sql).rejects.toThrow(re);
      });
  });
  it("refuses unless 0136 is exactly as pinned (a trigger missing) or the ledger isn't 149 with 0136 last", async () => {
    await scratch(async (x) => {
      await x.exec(`DROP TRIGGER incentive_calc_period_voids_no_change ON incentive_calc_period_voids`);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/triggers unexpected/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.migration]);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/ledger has 148 rows; expected 149/);
    });
  });
  it("a difference during the rollback → refused, 0136 stays exactly as it was", async () => {
    await expect(inTx((x) => core.rollbackIn(x, `${rollback}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(true);
    expect((await inTx((x) => core.verifyApplied(x, E, ref, { requireEmpty: true }))).every((c) => c.ok)).toBe(true);
  });
  it("rolls back: 0135's function, settings list and 0134's entity check exactly; data and catalogue unchanged; ledger 149 → 148; then 0136 applies again", async () => {
    const r = await inTx((x) => core.rollbackIn(x, rollback, E, ref));
    expect(r.tables).toBe(E.tables.before);
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(false);
    await expect(inTx((x) => core.assert0135(x, ref))).resolves.toBeUndefined();
    expect((await pg.query<{ n: number }>(`select count(*)::int n from public.__schema_applied`)).rows[0]!.n).toBe(148);
    await expect(inTx((x) => core.applyIn(x, migration, E, ref))).resolves.toMatchObject({ tables: E.tables.after });
  });
});
