import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// REAL-POSTGRES checks for migration 0117 (balance snapshots) on an in-memory
// PGlite database built from db/schema.ts plus the migration's own SQL — the same
// convention as the 0115 tests in collection-review.db.test.ts. No shared or
// production database can be reached.
//
// NOT RUN as part of the change that added it (database integration tests were
// out of bounds); tests/unit/collection-balances-migration.test.ts is the
// no-database counterpart that was run.
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

const SQL = readFileSync(resolve(__dirname, "../../db/migrations/0117_collection_balances.sql"), "utf8");
const TABLES = ["collection_balance_snapshots", "collection_balance_lines"];

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let alpha = "";
let beta = "";
let emp = "";

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
  });
  pg = made.pg;
  await pg.exec(SQL);
  emp = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)).rows[0]!.id;
  const co = async (name: string) =>
    (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key) values ($1, $2) returning id`, [name, name.toLowerCase().replace(/[^a-z0-9]/g, "")])).rows[0]!.id;
  alpha = await co("Alpha Traders");
  beta = await co("Beta Works");
});
afterAll(async () => {
  await pg?.close();
});

const snapshot = async (over: Partial<Record<string, string | null>> = {}) =>
  (
    await pg.query<{ id: string }>(
      `insert into collection_balance_snapshots (period_from, period_to, imported_total_debit, imported_total_credit, uploaded_by_id)
       values ($1, $2, '300.00', '50.00', $3) returning id`,
      [over.from ?? null, over.to ?? null, emp],
    )
  ).rows[0]!.id;

describe("migration 0117 behaves as the schema says", () => {
  it("is idempotent: applying it twice changes nothing and raises nothing", async () => {
    await pg.exec(SQL);
  });

  it("RLS is on for both tables", async () => {
    const r = await pg.query<{ relname: string; rls: boolean }>(`select relname, relrowsecurity as rls from pg_class where relname = any($1) order by relname`, [TABLES]);
    expect(r.rows).toEqual(TABLES.slice().sort().map((relname) => ({ relname, rls: true })));
  });

  it("the schema code declares the same constraints and indexes as the SQL", async () => {
    const fromDb = async (db: typeof pg) =>
      (
        await db.query<{ name: string }>(
          `select conname as name from pg_constraint where conrelid in ('collection_balance_snapshots'::regclass, 'collection_balance_lines'::regclass) and contype in ('c','u')
           union select indexname from pg_indexes where tablename in ('collection_balance_snapshots','collection_balance_lines') and indexname not like '%_pkey'
           order by 1`,
        )
      ).rows.map((r) => r.name);
    const viaSchema = await createTestDb({
      employees: schema.employees,
      customerMasters: schema.customerMasters,
      collectionMasterImports: schema.collectionMasterImports,
      collectionMasterCompanies: schema.collectionMasterCompanies,
      collectionBalanceSnapshots: schema.collectionBalanceSnapshots,
      collectionBalanceLines: schema.collectionBalanceLines,
    });
    try {
      expect(await fromDb(viaSchema.pg)).toEqual(await fromDb(pg));
      const idx = async (db: typeof pg) => (await db.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = 'collection_balance_snapshots_at_idx'`)).rows[0]!.def.replace(/^.* USING /, "");
      expect(await idx(viaSchema.pg)).toBe(await idx(pg));
      expect(await idx(pg)).toMatch(/uploaded_at DESC/);
      expect(await idx(viaSchema.pg)).not.toMatch(/NULLS LAST/); // plain DESC is NULLS FIRST in Postgres
    } finally {
      await viaSchema.pg.close();
    }
    // Builds a second in-memory database, so it needs more than vitest's 5 s default when the whole suite is running.
  }, 60_000);

  it("a company appears once per snapshot, and the same company may appear in a later snapshot", async () => {
    const s1 = await snapshot();
    await pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, debit) values ($1, $2, 'Alpha Traders', 5, '100.00')`, [s1, alpha]);
    await expect(pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, debit) values ($1, $2, 'Alpha Traders', 9, '1.00')`, [s1, alpha])).rejects.toThrow(/snapshot_company_uq/);
    const s2 = await snapshot();
    await pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, debit) values ($1, $2, 'Alpha Traders', 5, '100.00')`, [s2, alpha]);
  });

  it("a line needs a Debit or a Credit; negatives are kept as written", async () => {
    const s = await snapshot();
    await expect(pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row) values ($1, $2, 'Beta Works', 6)`, [s, beta])).rejects.toThrow(/value_check/);
    await pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, credit) values ($1, $2, 'Beta Works', 6, '-12.50')`, [s, beta]);
    expect((await pg.query<{ credit: string }>(`select credit from collection_balance_lines where snapshot_id = $1`, [s])).rows[0]!.credit).toBe("-12.50");
  });

  it("amounts keep exactly two decimals", async () => {
    const s = await snapshot();
    await pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, debit) values ($1, $2, 'Beta Works', 6, '1062797.2')`, [s, beta]);
    expect((await pg.query<{ debit: string }>(`select debit from collection_balance_lines where snapshot_id = $1`, [s])).rows[0]!.debit).toBe("1062797.20");
  });

  it("a snapshot's period must run forwards (or be absent)", async () => {
    await expect(snapshot({ from: "2026-10-19", to: "2026-04-01" })).rejects.toThrow(/period_check/);
    await snapshot({ from: "2026-04-01", to: "2026-10-19" });
    await snapshot({ from: null, to: null });
  });

  it("snapshots and companies can't be deleted while lines point at them (history is kept)", async () => {
    const s = await snapshot();
    await pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, debit) values ($1, $2, 'Alpha Traders', 5, '1.00')`, [s, alpha]);
    await expect(pg.query(`delete from collection_balance_snapshots where id = $1`, [s])).rejects.toThrow(/foreign key/i);
    await expect(pg.query(`delete from collection_master_companies where id = $1`, [alpha])).rejects.toThrow(/foreign key/i);
  });
});
