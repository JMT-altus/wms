import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 0137 apply / rollback / verification runners' SAFETY LOGIC (scripts/incentive-0137/core.ts), proven on an
// in-memory PGlite database built from db/schema.ts plus 0131–0136's own SQL, with testimonials exactly as 0068 created
// it (NOT NULL, ON DELETE CASCADE), a synthetic 149-row ledger and RLS on every table as in production. No connection,
// no .env, no shared or production database can be reached: the command-line runners (apply.ts, rollback.ts,
// verify.ts) are never imported or run here.
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import * as core from "@/scripts/incentive-0137/core";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`));
const ROLLBACK = readFileSync(resolve(__dirname, `../../db/rollback/${core.FILES.rollback}`));
const migration = core.pinned(core.FILES.migration, MIG(core.FILES.migration), core.PINS.migration);
const rollback = core.pinned(core.FILES.rollback, ROLLBACK, core.PINS.rollback);
const ref = core.reference(core.pinned(core.FILES.m0136, MIG(core.FILES.m0136), core.PINS.m0136), migration);
let E: core.Expect;
const SENTINEL = "__undo__";
let asha = "";
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
const has = async (rel: string) => (await pg.query<{ ok: boolean }>(`select to_regclass($1) is not null ok`, [`public.${rel}`])).rows[0]!.ok;
const ledgerCount = async () => (await pg.query<{ n: number }>(`select count(*)::int n from public.__schema_applied`)).rows[0]!.n;
const link = async () =>
  (
    await pg.query<{ nullable: string; del: string }>(
      `select (select is_nullable from information_schema.columns where table_name = 'testimonials' and column_name = 'employee_id') nullable,
              (select confdeltype::text from pg_constraint where conname = 'testimonials_employee_id_fkey') del`,
    )
  ).rows[0]!;

/** testimonials exactly as 0068_incentive_spine.sql created it (db/schema.ts now describes the 0137 shape). */
const TESTIMONIALS_0068 = (() => {
  const text = MIG("0068_incentive_spine.sql").toString("utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("CREATE TABLE IF NOT EXISTS testimonials (");
  const end = text.indexOf("\n", text.indexOf("CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx", start));
  if (start < 0 || end < 0) throw new Error("0068's testimonials DDL not found");
  return text.slice(start, end);
})();

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
  await pg.exec(TESTIMONIALS_0068);
  await pg.exec(`create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated;`);
  const chain = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", core.FILES.m0136];
  for (const f of chain) await pg.exec(core.canonicalBytes(MIG(f)).toString("utf8")) // as production received it: LF (a Windows checkout has CRLF);
  // Production's ledger shape: 149 rows, 0131–0136 last; and RLS on every public table.
  await pg.exec(`create table public.__schema_applied (filename text primary key, applied_at timestamptz not null default now())`);
  const names = [...Array.from({ length: 143 }, (_, i) => `0000_earlier_${String(i).padStart(3, "0")}.sql`), ...chain];
  for (const n of names) await pg.query(`insert into public.__schema_applied (filename) values ($1) on conflict do nothing`, [n]);
  await pg.exec(`do $$ declare r record; begin for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' loop execute format('alter table public.%I enable row level security', r.relname); end loop; end $$;`);
  asha = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)).rows[0]!.id;
  ravi = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Ravi', 'ravi@example.test', 'both') returning id`)).rows[0]!.id;
  // Existing testimonials (the old engine's): each must keep its data; 0137 only fills their employee's name.
  await pg.query(`insert into testimonials (employee_id, period_month, kind, word_count, star_rating, review_status) values ($1, '2026-10', 'google_review', 60, 5, 'approved'), ($2, '2026-11', 'email', 40, null, 'pending')`, [asha, ravi]);
  const ledger = (await pg.query<{ n: number; last: string }>(`select count(*)::int n, max(filename) last from public.__schema_applied`)).rows[0]!;
  if (ledger.n !== 149 || ledger.last !== core.FILES.m0136) throw new Error(`fixture ledger ${ledger.n} / ${ledger.last}`);
  const t = await core.tableCount(x0());
  E = { ledger: { before: 149, after: 150 }, tables: { before: t.n, after: t.n + 4 }, role: false };
}, 240_000);
afterAll(async () => {
  await pg?.close();
});

describe("0137 runners: pinned files and the target", () => {
  it("the pins are exactly the files' canonical (LF) bytes; a CRLF checkout matches, any other byte is refused", () => {
    expect(core.sha256(core.canonicalBytes(MIG(core.FILES.migration)))).toBe(core.PINS.migration);
    expect(core.sha256(core.canonicalBytes(ROLLBACK))).toBe(core.PINS.rollback);
    expect(core.sha256(core.canonicalBytes(MIG(core.FILES.m0136)))).toBe(core.PINS.m0136);
    const crlf = Buffer.from(MIG(core.FILES.migration).toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
    expect(core.pinned("x.sql", crlf, core.PINS.migration)).toBe(migration);
    expect(() => core.pinned("x.sql", Buffer.concat([MIG(core.FILES.migration), Buffer.from("\n-- one more line\n")]), core.PINS.migration)).toThrow(/is not the pinned/);
    expect(() => core.pinned("x.sql", Buffer.from(migration.replace("'f.minRating'", "'f.minRatinG'")), core.PINS.migration)).toThrow(/is not the pinned/);
  });
  it("the settings lists come from the pinned files: 0137 is 0136 plus exactly its four keys", () => {
    expect(ref.keys0136).toHaveLength(95);
    expect(ref.keys0137).toHaveLength(99);
    expect(ref.keys0137.filter((k) => !ref.keys0136.includes(k)).sort()).toEqual([...core.NEW_KEYS].sort());
    expect(() => core.reference(MIG(core.FILES.m0136).toString("utf8"), MIG(core.FILES.m0136).toString("utf8"))).toThrow(/plus exactly its four keys/);
    // The rollback restores exactly 0136's list.
    const restored = [...rollback.slice(rollback.indexOf("-- settings-key-list-begin"), rollback.indexOf("-- settings-key-list-end")).matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)].map((m) => m[1]!).sort();
    expect(restored).toEqual(ref.keys0136);
  });
  it("only production's exact fingerprint on a Supabase host is accepted (synthetic URLs; the real one is never read here)", () => {
    expect(core.PRODUCTION).toEqual({ ledger: { before: 149, after: 150 }, tables: { before: 166, after: 170 }, role: true });
    expect(() => core.assertProduction("postgres://someone:pw@db.example.supabase.co:5432/postgres")).toThrow(/is not production \(ed679a28f0\)/);
    expect(() => core.assertProduction("postgres://postgres:pw@localhost:5432/postgres")).toThrow(/is not production/);
  });
});

describe("0137 apply runner: preconditions refuse every unexpected state", () => {
  it("the production role check refuses PGlite's role / database", async () => {
    await expect(inTx((x) => core.preApply(x, { ...E, role: true }, ref))).rejects.toThrow(/unexpected role\/db/);
  });
  it("passes on the expected state (read only: it changes nothing)", async () => {
    const before = await core.dataFingerprints(x0());
    await expect(inTx((x) => core.preApply(x, E, ref))).resolves.toMatchObject({ ledger: expect.any(Array) });
    expect(await core.dataFingerprints(x0())).toEqual(before);
  });
  it("wrong ledger: an extra row, 0136 not last, 0137 already recorded", async () => {
    await scratch(async (x) => {
      await x.query(`insert into public.__schema_applied (filename) values ('0099_extra.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/ledger has 150 rows; expected 149/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.m0136]);
      await x.query(`insert into public.__schema_applied (filename) values ('0130_x.sql')`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/0136_incentive_category_c_review\.sql must be last/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = '0000_earlier_000.sql'`);
      await x.query(`insert into public.__schema_applied (filename) values ($1)`, [core.FILES.migration]);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/must be last|already recorded/);
    });
  });
  it("0136 missing, a table without RLS, or 0137's objects (even only testimonials.employee_name) already present", async () => {
    await scratch(async (x) => {
      await x.exec(`alter table public.employees disable row level security`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/all with RLS/);
    });
    await scratch(async (x) => {
      await x.exec(`alter table testimonials add column employee_name text`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/already \(partly\) exist/);
    });
    await scratch(async (x) => {
      await x.exec(`create table public.incentive_f_reviews (id int); alter table public.incentive_f_reviews enable row level security;`);
      await expect(core.preApply(x, { ...E, tables: { before: E.tables.before + 1, after: E.tables.after + 1 } }, ref)).rejects.toThrow(/already \(partly\) exist/);
    });
    await scratch(async (x) => {
      await x.exec(`drop table public.incentive_calc_period_voids`);
      await expect(core.preApply(x, { ...E, tables: { before: E.tables.before - 1, after: E.tables.after - 1 } }, ref)).rejects.toThrow(/0136 isn't applied/);
    });
  });
  it("anything 0137 changes that isn't exactly 0136's: the settings list, entity check, adjustment checks, testimonials' employee link; a setting already using 0137's keys", async () => {
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE incentive_config_settings DROP CONSTRAINT incentive_config_settings_key_check`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/settings key check isn't exactly 0136's/);
    });
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE incentive_calc_input_history DROP CONSTRAINT incentive_calc_input_history_entity_check; ALTER TABLE incentive_calc_input_history ADD CONSTRAINT incentive_calc_input_history_entity_check CHECK (entity IN ('attribution', 'other'));`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/entity check isn't 0136's/);
    });
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE incentive_calc_adjustments DROP CONSTRAINT incentive_calc_adjustments_kind_check; ALTER TABLE incentive_calc_adjustments ADD CONSTRAINT incentive_calc_adjustments_kind_check CHECK (kind IN ('recalc-difference', 'negative-carry', 'write-off', 'salary-recovery', 'other'));`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/adjustment kind \/ target checks aren't 0132's/);
    });
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE testimonials ALTER COLUMN employee_id DROP NOT NULL`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/isn't 0068's/);
    });
    await scratch(async (x) => {
      await x.exec(`ALTER TABLE testimonials DROP CONSTRAINT testimonials_employee_id_fkey; ALTER TABLE testimonials ADD CONSTRAINT testimonials_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;`);
      await expect(core.preApply(x, E, ref)).rejects.toThrow(/isn't 0068's/);
    });
  });
});

describe("0137 apply runner: the transaction rolls back on any difference", () => {
  const nothingKept = async () => {
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(false);
    expect(await ledgerCount()).toBe(149);
    expect(await link()).toEqual({ nullable: "NO", del: "c" });
  };
  it("existing data changed (beyond filling testimonials' employee name) → refused, nothing kept", async () => {
    const before = await core.dataFingerprints(x0());
    await expect(inTx((x) => core.applyIn(x, `${migration}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    await expect(inTx((x) => core.applyIn(x, `${migration}\nUPDATE testimonials SET word_count = word_count + 1;`, E, ref))).rejects.toThrow(/existing data changed in: testimonials/);
    expect(await core.dataFingerprints(x0())).toEqual(before);
    await nothingKept();
  });
  it("an existing object changed beyond 0137's own (an index, a disabled trigger, a comment) → refused, nothing kept", async () => {
    for (const extra of [`CREATE INDEX extra_idx ON employees (name);`, `ALTER TABLE incentive_calc_approvals DISABLE TRIGGER incentive_calc_c_approvals_insert;`, `COMMENT ON TABLE employees IS 'changed';`])
      await expect(inTx((x) => core.applyIn(x, `${migration}\n${extra}`, E, ref)), extra).rejects.toThrow(/changed beyond 0137's own/);
    await nothingKept();
  });
  it("testimonials changed beyond its employee link and kept name (a new index) → refused", async () => {
    await expect(inTx((x) => core.applyIn(x, `${migration}\nCREATE INDEX testimonials_extra_idx ON testimonials (kind);`, E, ref))).rejects.toThrow(/testimonials changed beyond|changed beyond 0137.s own/);
    await nothingKept();
  });
  it("the employee link left CASCADE, or a new object differing from the pinned listing → refused", async () => {
    const cascade = migration.replace(`REFERENCES "employees"("id") ON DELETE SET NULL;\nALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_employee_named_check"`, `REFERENCES "employees"("id") ON DELETE CASCADE;\nALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_employee_named_check"`);
    expect(cascade).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, cascade, E, ref))).rejects.toThrow(/isn't nullable ON DELETE SET NULL/);
    const looseIdx = migration.replace(`CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_reviews_url_uq"`, `CREATE INDEX IF NOT EXISTS "incentive_f_reviews_url_uq"`);
    expect(looseIdx).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, looseIdx, E, ref))).rejects.toThrow(/differ from the pinned listing/);
    await nothingKept();
  });
  it("RLS left off a new table → refused", async () => {
    const noRls = migration.replace(`ALTER TABLE "incentive_f_writeoffs" ENABLE ROW LEVEL SECURITY;`, "");
    expect(noRls).not.toBe(migration);
    await expect(inTx((x) => core.applyIn(x, noRls, E, ref))).rejects.toThrow(/security unexpected on incentive_f_writeoffs|all with RLS/);
    await nothingKept();
  });
  it("text that ends the transaction itself → detected; a statement failing halfway → everything rolls back", async () => {
    await expect(inTx((x) => core.applyIn(x, `COMMIT; BEGIN;\n${migration}`, E, ref))).rejects.toThrow(/ended the transaction/);
    await expect(inTx((x) => core.applyIn(x, migration.replace(`CREATE TABLE IF NOT EXISTS "incentive_f_writeoffs"`, `CREATE TABLE IF NOT EXISTS "incentive_f_writeoffs_typo"`), E, ref))).rejects.toThrow();
    await nothingKept();
  });
  it("applies: data and catalogue unchanged outside 0137, every object as pinned, testimonials named, ledger 149 → 150, four new tables", async () => {
    const r = await inTx((x) => core.applyIn(x, migration, E, ref));
    expect(r).toMatchObject({ tables: E.tables.after, keys: 99 });
    expect((await inTx((x) => core.verifyApplied(x, E, ref, { requireEmpty: true }))).every((c) => c.ok)).toBe(true);
    expect(await link()).toEqual({ nullable: "YES", del: "n" });
    expect((await pg.query<{ n: string }>(`select string_agg(employee_name, ',' order by employee_name) n from testimonials`)).rows[0]!.n).toBe("Asha,Ravi");
    await expect(inTx((x) => core.preApply(x, { ...E, ledger: { before: 150, after: 151 }, tables: { before: E.tables.after, after: E.tables.after + 4 } }, ref))).rejects.toThrow(/last ledger row|already/);
  });
});

describe("0137 rollback runner", () => {
  it("refuses while any data only 0137 allows exists — and the rollback SQL's own refusal still holds on its own", async () => {
    const R = (n: number) => `00000000-0000-4000-8000-00000000013${n}`;
    const cases: [string, RegExp][] = [
      [`insert into incentive_f_reviews (url_key, first_url, created_by_name) values ('google.com/maps/x', 'https://google.com/maps/x', 'x')`, /incentive_f_reviews: 1 rows/],
      [`insert into incentive_calc_input_history (entity, entity_id, action, actor_name) values ('f-decision', '${R(1)}', 'record', 'tester')`, /f-decision input history: 1/],
      [`insert into incentive_config_settings (version_id, setting_key, value) values ('${R(1)}', 'f.minRating', '5'::jsonb)`, /settings using 0137's keys: 1/],
      [`set local session_replication_role = origin; delete from employees where name = 'Ravi'`, /testimonials of a deleted employee: 1/],
      [`update testimonials set employee_name = 'Someone else' where employee_name = 'Asha'`, /kept name differs from their employee's: 1/],
    ];
    for (const [sql, re] of cases)
      await scratch(async (x) => {
        // Foreign keys and triggers are switched off only to place a row; the checks then read it.
        await x.exec(`set local session_replication_role = replica; ${sql}; set local session_replication_role = origin;`);
        await expect(core.preRollback(x, E, ref), sql).rejects.toThrow(re);
        await expect(x.exec(rollback), sql).rejects.toThrow(/0137 rollback refused/);
      });
  });
  it("an employee's deletion after 0137 keeps their testimonials (SET NULL, name kept) — and then blocks the rollback", async () => {
    await scratch(async (x) => {
      await x.query(`delete from employees where id = $1`, [ravi]);
      const [t] = await x.query<{ employee_id: string | null; employee_name: string }>(`select employee_id, employee_name from testimonials where period_month = '2026-11'`);
      expect(t).toEqual({ employee_id: null, employee_name: "Ravi" });
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/testimonials of a deleted employee: 1/);
    });
  });
  it("refuses unless 0137 is exactly as pinned (a trigger missing) or the ledger isn't 150 with 0137 last", async () => {
    await scratch(async (x) => {
      await x.exec(`DROP TRIGGER incentive_f_writeoffs_no_change ON incentive_f_writeoffs`);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/differ from the pinned listing/);
    });
    await scratch(async (x) => {
      await x.query(`delete from public.__schema_applied where filename = $1`, [core.FILES.migration]);
      await expect(core.preRollback(x, E, ref)).rejects.toThrow(/ledger has 149 rows; expected 150/);
    });
  });
  it("a difference during the rollback → refused, 0137 stays exactly as it was", async () => {
    await expect(inTx((x) => core.rollbackIn(x, `${rollback}\nUPDATE employees SET name = name || ' changed';`, E, ref))).rejects.toThrow(/existing data changed in: employees/);
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(true);
    expect((await inTx((x) => core.verifyApplied(x, E, ref, { requireEmpty: true }))).every((c) => c.ok)).toBe(true);
  });
  it("rolls back: 0136's lists, 0132's adjustment checks and testimonials' 0068 link exactly; data unchanged; ledger 150 → 149; then 0137 applies again", async () => {
    const before = await core.dataFingerprints(x0());
    const r = await inTx((x) => core.rollbackIn(x, rollback, E, ref));
    expect(r.tables).toBe(E.tables.before);
    for (const t of core.NEW_TABLES) expect(await has(t)).toBe(false);
    expect(await link()).toEqual({ nullable: "NO", del: "c" });
    expect((await inTx((x) => core.verifyRolledBack(x, E, ref))).every((c) => c.ok)).toBe(true);
    expect(await core.dataFingerprints(x0())).toEqual(before);
    expect(await ledgerCount()).toBe(149);
    await expect(inTx((x) => core.applyIn(x, migration, E, ref))).resolves.toMatchObject({ tables: E.tables.after });
  });
});
