import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests on an in-memory PGlite database (./_pglite.ts) with
// made-up companies — nothing here can reach a shared or production database.
// Covers: import → stored coordinators → Collection Tracker rows, and the
// commitments table (collection.commitments.view / .edit) created from the REVIEW migration 0114 itself.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: { id: "", isAdmin: true, isActive: true, email: "admin@example.test", name: "Admin" } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({ requireAdmin: async () => h.me, getCurrentEmployee: async () => h.me }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import type { CapabilityProof } from "@/lib/auth/capability";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let importAction: typeof import("@/app/(collection-module)/collection/master/actions");
let load: typeof import("@/lib/collections/load");
let derive: typeof import("@/lib/collections/derive");
let commitments: typeof import("@/lib/queries/collection-commitments");

beforeAll(async () => {
  // Everything except the commitments table, which comes from the migration file under review.
  const made = await createTestDb({
    // The permission tables: the import action resolves collection.master.import against them.
    departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0114_collection_commitments.sql"), "utf8"));
  const [admin] = await made.db
    .insert(schema.employees)
    .values({ name: "Admin", email: "admin@example.test", role: "both", isAdmin: true } as typeof schema.employees.$inferInsert)
    .returning({ id: schema.employees.id });
  h.me.id = admin!.id;
  importAction = await import("@/app/(collection-module)/collection/master/actions");
  load = await import("@/lib/collections/load");
  derive = await import("@/lib/collections/derive");
  commitments = await import("@/lib/queries/collection-commitments");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

const body = (rows: [string, string][]) => ({
  fileName: "MasterFile.xlsx",
  sheetName: "Sheet1",
  mapping: { company: "Name", coordinator: "Unnamed column B", paymentTerms: null },
  ignoredColumns: [{ column: "D", header: null, filled: 2 }],
  confirmedColumns: { coordinator: true },
  rows: rows.map(([company, coordinator], i) => ({ rowNo: i + 2, company, coordinator, paymentTerms: "" })),
});

describe("import → Collection Tracker (real SQL)", () => {
  it("stores one spelling per coordinator and the tracker shows it as the collection person", async () => {
    const preview = await importAction.previewCollectionMaster(body([["Alpha Traders", "MANGESH"], ["Beta Corp", "mangesh"], ["Gamma Ltd", "XXX"], ["Delta Inc", "42"], ["Epsilon Co", "Gauri"]]));
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.preview.summary).toMatchObject({ invalidCoordinators: 1, coordinatorSpellingsUnified: 1, newCoordinatorLabels: ["Gauri", "MANGESH"] });

    const res = await importAction.importCollectionMaster({ ...body([["Alpha Traders", "MANGESH"], ["Beta Corp", "mangesh"], ["Gamma Ltd", "XXX"], ["Delta Inc", "42"], ["Epsilon Co", "Gauri"]]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals.inserted).toBe(5);
    const stored = await pg.query<{ company_name: string; coordinator_label: string | null }>(`select company_name, coordinator_label from collection_master_companies order by company_name`);
    expect(stored.rows).toEqual([
      { company_name: "Alpha Traders", coordinator_label: "MANGESH" },
      { company_name: "Beta Corp", coordinator_label: "MANGESH" },
      { company_name: "Delta Inc", coordinator_label: null },
      { company_name: "Epsilon Co", coordinator_label: "Gauri" },
      { company_name: "Gamma Ltd", coordinator_label: null },
    ]);

    const source = await load.loadCollectionParties();
    const rows = derive.buildRows(source.parties, []);
    expect(rows.map((r) => [r.partyName, r.collectionPerson])).toEqual([
      ["Alpha Traders", "MANGESH"],
      ["Beta Corp", "MANGESH"],
      ["Delta Inc", null],
      ["Epsilon Co", "Gauri"],
      ["Gamma Ltd", null],
    ]);
    const f = { query: "", collectionPerson: "MANGESH", followUp: "" as const };
    expect(derive.filterRows(rows, f, "2026-10-19").map((r) => r.partyName)).toEqual(["Alpha Traders", "Beta Corp"]);
    expect(derive.filterRows(rows, { ...f, collectionPerson: derive.UNASSIGNED_PERSON }, "2026-10-19").map((r) => r.partyName)).toEqual(["Delta Inc", "Gamma Ltd"]);
  });

  it("re-import keeps the stored spelling and the stored person unless a change is accepted", async () => {
    const preview = await importAction.previewCollectionMaster(body([["Alpha Traders", "Mangesh"], ["Epsilon Co", "Mihir"]]));
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.preview.rows.map((r) => [r.status, r.coordinatorLabel])).toEqual([["unchanged", "MANGESH"], ["changed", "Mihir"]]);
    const res = await importAction.importCollectionMaster({ ...body([["Alpha Traders", "Mangesh"], ["Epsilon Co", "Mihir"]]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.rows.map((r) => r.outcome)).toEqual(["unchanged", "kept-existing"]);
    const e = await pg.query<{ c: string }>(`select coordinator_label as c from collection_master_companies where company_name = 'Epsilon Co'`);
    expect(e.rows[0]!.c).toBe("Gauri");
  });
});

describe("commitments table from migration 0114 (real SQL)", () => {
  // The queries take capability proofs (what requireCapability returns after checking a grant).
  const viewer = () => ({ employeeId: h.me.id, capability: "collection.commitments.view" }) as CapabilityProof<"collection.commitments.view">;
  const editor = () => ({ employeeId: h.me.id, capability: "collection.commitments.edit" }) as CapabilityProof<"collection.commitments.edit">;
  const idOf = async (name: string) =>
    (await pg.query<{ id: string }>(`select id from collection_master_companies where company_name = $1`, [name])).rows[0]!.id;

  it("appends; the newest row is the current commitment; the owner's list joins company and collection person", async () => {
    const alpha = await idOf("Alpha Traders");
    const epsilon = await idOf("Epsilon Co");
    await commitments.recordCommitment(editor(), { companyId: alpha, amount: "100000.00", committedDate: "2026-11-05" });
    await new Promise((r) => setTimeout(r, 5));
    await commitments.recordCommitment(editor(), { companyId: alpha, amount: "125000.50", committedDate: "2026-11-10" });
    await commitments.recordCommitment(editor(), { companyId: epsilon, amount: "40000.00", committedDate: "2026-10-25" });

    expect((await commitments.getCommitment(viewer(), alpha)).commitment).toMatchObject({ amount: "125000.50", committedDate: "2026-11-10" });
    const n = await pg.query<{ n: number }>(`select count(*)::int as n from collection_commitments where company_id = $1`, [alpha]);
    expect(n.rows[0]!.n).toBe(2); // history kept

    const list = await commitments.listOwnerCommitments(viewer());
    expect(list.rows.map((r) => [r.companyName, r.amount, r.committedDate, r.collectionPerson])).toEqual([
      ["Epsilon Co", "40000.00", "2026-10-25", "Gauri"],
      ["Alpha Traders", "125000.50", "2026-11-10", "MANGESH"],
    ]);
  });

  it("large and maximum amounts round-trip through numeric(14,2) exactly", async () => {
    const gamma = await idOf("Gamma Ltd");
    for (const amount of ["311855013.28", "100000000.01", "999999999999.99"]) {
      await commitments.recordCommitment(editor(), { companyId: gamma, amount, committedDate: "2026-12-01" });
      expect((await commitments.getCommitment(viewer(), gamma)).commitment?.amount).toBe(amount);
      await new Promise((r) => setTimeout(r, 3));
    }
  });

  it("the migration's constraints hold: positive amounts only, real companies only", async () => {
    const alpha = await idOf("Alpha Traders");
    await expect(pg.query(`insert into collection_commitments (company_id, committed_amount, committed_date) values ($1, 0, '2026-11-01')`, [alpha])).rejects.toThrow(/amount_positive/);
    await expect(pg.query(`insert into collection_commitments (company_id, committed_amount, committed_date) values ('00000000-0000-4000-8000-000000000000', 10, '2026-11-01')`)).rejects.toThrow(/foreign key/i);
    await expect(pg.query(`delete from collection_master_companies where id = $1`, [alpha])).rejects.toThrow(/foreign key/i); // history can't be orphaned
  });

  it("RLS is on and REST roles have no access (where those roles exist)", async () => {
    const r = await pg.query<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where relname = 'collection_commitments'`);
    expect(r.rows[0]!.rls).toBe(true);
    await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;`);
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0114_collection_commitments.sql"), "utf8")); // idempotent re-run revokes from anon
    await pg.exec(`grant usage on schema public to anon`);
    await pg.exec(`set role anon`);
    let denied = false;
    try {
      await pg.query(`select * from collection_commitments`);
    } catch (e) {
      denied = /permission denied/i.test((e as Error).message);
    } finally {
      await pg.exec(`reset role`);
    }
    expect(denied).toBe(true);
  });
});
