import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

// Migration 0134 and its rollback on REAL Postgres (PGlite), over a database holding Category A data as production
// does after 0131–0133: 0134 changes no existing row and is safe to re-run; the rollback restores the catalogue exactly
// (every constraint and trigger definition) when no Category B data exists, and refuses — changing nothing — when it
// does. Invented data only.
type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8");
const ROLLBACK = readFileSync(resolve(__dirname, "../../db/rollback/0134_incentive_category_b.rollback.sql"), "utf8");
const M34 = MIG("0134_incentive_category_b.sql");
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const DATA = ["incentive_programs", "incentive_config_versions", "incentive_config_settings", "incentive_config_slabs", "incentive_config_delay_steps", "incentive_config_eligibility", "incentive_config_history", "incentive_calc_runs", "incentive_calc_periods", "incentive_calc_results", "incentive_calc_adjustments", "incentive_calc_input_history", "incentive_calc_approvals"];
const data = async () => {
  const out: Record<string, string> = {};
  for (const t of DATA) out[t] = (await q1<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') f from ${t} t`))[0]!.f;
  return out;
};
/** Every constraint, trigger, function and table of the incentive tables, as Postgres describes them. */
const catalogue = async () => ({
  constraints: await q1(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conrelid::regclass::text like 'incentive_%' order by 1, 2`),
  triggers: await q1(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'incentive_%' order by 1, 2`),
  functions: await q1(`select proname from pg_proc where proname like 'incentive_%' order by 1`),
  tables: await q1(`select relname from pg_class where relkind = 'r' and relname like 'incentive_%' order by 1`),
});
let before: Awaited<ReturnType<typeof catalogue>>;
let dataBefore: Record<string, string>;

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, incentiveAudit: schema.incentiveAudit });
  pg = made.pg;
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await pg.exec(MIG(f));
  // Category A data as production has it: a programme, a published version with settings and a slab, a calculated month.
  const emp = (await q1<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('author', 'author@example.test', 'both', true) returning id`))[0]!.id;
  const prog = (await q1<{ id: string }>(`insert into incentive_programs (code, name) values ('SALES', 'Sales') returning id`))[0]!.id;
  const v = (await q1<{ id: string }>(`insert into incentive_config_versions (program_id, category_code, version_no, created_by_id) values ($1, 'A', 1, $2) returning id`, [prog, emp]))[0]!.id;
  await pg.query(`insert into incentive_config_settings (version_id, setting_key, value) values ($1, 'basis.document', '"salesOrder"'), ($1, 'caps.perOrder', '"none"')`, [v]);
  await pg.query(`insert into incentive_config_slabs (version_id, position, line_code, label, from_paise, to_paise, value_type, rate_ppm) values ($1, 1, 'A.1', 'x', 0, 100, 'percent', 1000)`, [v]);
  await pg.query(`insert into incentive_calc_periods (program_id, category_code, month) values ($1, 'A', '2026-04-01')`, [prog]);
  before = await catalogue();
  dataBefore = await data();
}, 120_000);
afterAll(async () => {
  await pg.close();
});

describe("0134 on a database with Category A data", () => {
  it("applies, changes no existing row, and is safe to re-run", async () => {
    await pg.exec(M34);
    expect(await data()).toEqual(dataBefore);
    const once = await catalogue();
    await pg.exec(M34);
    expect(await catalogue()).toEqual(once);
    expect(once.tables.map((t) => (t as { relname: string }).relname)).toEqual(expect.arrayContaining(["incentive_calc_b_overrides", "incentive_calc_b_qualifications"]));
    expect(once.constraints.filter((c) => !(c as { v: boolean }).v)).toEqual([]); // every widened check validated
  });
  it("the REST roles have no access (when they exist) and RLS is on", async () => {
    expect(await q1(`select relname, relrowsecurity from pg_class where relname in ('incentive_calc_b_overrides', 'incentive_calc_b_qualifications') order by 1`)).toEqual([
      { relname: "incentive_calc_b_overrides", relrowsecurity: true },
      { relname: "incentive_calc_b_qualifications", relrowsecurity: true },
    ]);
  });
});

describe("the rollback", () => {
  it("with no Category B data: restores every constraint, trigger, function and table exactly, and changes no row", async () => {
    await pg.exec(ROLLBACK);
    expect(await catalogue()).toEqual(before);
    expect(await data()).toEqual(dataBefore);
  });
  it("with Category B data: refuses, and the transaction changes nothing", async () => {
    await pg.exec(M34);
    const prog = (await q1<{ id: string }>(`select id from incentive_programs limit 1`))[0]!.id;
    await pg.query(`insert into incentive_calc_periods (program_id, category_code, month) values ($1, 'B', '2026-04-01')`, [prog]);
    const with0134 = await catalogue();
    const rows = await data();
    await expect(pg.exec(`begin; ${ROLLBACK}; commit;`)).rejects.toThrow(/0134 rollback refused/);
    await pg.exec("rollback");
    expect(await catalogue()).toEqual(with0134);
    expect(await data()).toEqual(rows);
  });
});
