import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests on an in-memory PGlite database (./_pglite.ts). Nothing
// here can reach a shared or production database. The Collection Master tables
// come from migration 0112's OWN SQL file, so this proves what that migration
// gives the import and the Tracker:
//   - before 0112: the preview says storage isn't set up, and import and
//     assignment fail honestly (nothing reported as saved);
//   - after 0112: import, recognising existing companies, capability-gated Sales
//     Coordinator assignment (audited), and the Tracker reading it back.
const GRANTED_EMAIL = "granted@example.test";
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, claims: null as null | { email?: string; email_verified?: boolean } };
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
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/session", () => ({ readSession: async () => h.claims }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let pg: Db["pg"];
let bare: Db | null = null;
let master: typeof import("@/app/(forms-module)/forms/collection/master/actions");
let tracker: typeof import("@/app/(forms-module)/forms/collection/actions");
let load: typeof import("@/lib/collections/load");
let queries: typeof import("@/lib/queries/collection-master");
const ids = { admin: "", granted: "" };

const asAdmin = () => {
  h.me = { id: ids.admin, isAdmin: true, isActive: true, email: "admin@example.test", name: "Asha" };
  h.claims = { email: "admin@example.test", email_verified: true };
};
/** An admin explicitly granted collection.coordinator.assign in the permission matrix (a grant row). */
const asGranted = () => {
  h.me = { id: ids.granted, isAdmin: true, isActive: true, email: GRANTED_EMAIL, name: "Granted" };
  h.claims = { email: GRANTED_EMAIL, email_verified: true };
};

const body = (rows: [string, string, string][]) => ({
  fileName: "MasterFile.xlsx",
  sheetName: "Sheet1",
  mapping: { company: "Name", coordinator: "Unnamed column B", paymentTerms: "Payment Terms" },
  confirmedColumns: { coordinator: true },
  rows: rows.map(([company, coordinator, paymentTerms], i) => ({ rowNo: i + 2, company, coordinator, paymentTerms })),
});

const coordinatorOf = async (name: string) =>
  (await pg.query<{ c: string | null }>(`select coordinator_label as c from collection_master_companies where company_name = $1`, [name])).rows[0]?.c;
const companyId = async (name: string) =>
  (await pg.query<{ id: string }>(`select id from collection_master_companies where company_name = $1`, [name])).rows[0]!.id;
const logRows = async () => (await pg.query<{ n: number }>(`select count(*)::int as n from collection_master_imports`)).rows[0]!.n;

beforeAll(async () => {
  // Only what 0112 depends on — the Collection Master tables don't exist yet.
  bare = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants });
  pg = bare.pg;
  h.db = bare.db;
  const emp = async (name: string, email: string) =>
    (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [name, email])).rows[0]!.id;
  ids.admin = await emp("Asha", "admin@example.test");
  ids.granted = await emp("Granted", GRANTED_EMAIL);
  // What a super-admin's "Allow" in the permission matrix stores.
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.coordinator.assign', 'employee', $1, true)`, [ids.granted]);
  master = await import("@/app/(forms-module)/forms/collection/master/actions");
  tracker = await import("@/app/(forms-module)/forms/collection/actions");
  load = await import("@/lib/collections/load");
  queries = await import("@/lib/queries/collection-master");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("before migration 0112 (the cause of “Storage isn't set up”)", () => {
  it("the preview works but can't recognise stored companies — it says so (storageReady: false)", async () => {
    asAdmin();
    const res = await master.previewCollectionMaster(body([["Alpha Traders", "MANGESH", "30 days"]]));
    expect(res.ok && res.preview.storageReady).toBe(false);
    expect(res.ok && res.preview.summary.new).toBe(1);
  });

  it("import fails with a clear message and nothing is reported as imported", async () => {
    asAdmin();
    const res = await master.importCollectionMaster({ ...body([["Alpha Traders", "MANGESH", "30 days"]]), confirm: true });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/migration 0112 is pending/) });
  });

  it("the Tracker reports the master as not ready, and a granted assignment fails honestly", async () => {
    expect(await queries.listAllMasterCompanies()).toEqual({ storageReady: false, rows: [] });
    expect(await queries.listCoordinatorOptions()).toEqual({ storageReady: false, labels: [] });
    asGranted();
    const res = await tracker.assignSalesCoordinator({ companyId: "11111111-1111-4111-8111-111111111111", coordinatorLabel: "MANGESH", expected: null });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/migration 0112 is pending/) });
  });
});

describe("after migration 0112", () => {
  beforeAll(async () => {
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0112_collection_master.sql"), "utf8"));
  });

  it("imports new companies with their Sales Coordinator and Payment Terms", async () => {
    asAdmin();
    const rows: [string, string, string][] = [
      ["Alpha Traders", "MANGESH", "30 days"],
      ["Beta Corp", "XXX", "Advance"],
      ["Gamma Ltd", "Gauri", ""],
    ];
    const preview = await master.previewCollectionMaster(body(rows));
    expect(preview.ok && preview.preview.storageReady).toBe(true);
    const res = await master.importCollectionMaster({ ...body(rows), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals.inserted).toBe(3);
    expect(await coordinatorOf("Beta Corp")).toBeNull(); // placeholder → Unassigned
  });

  it("recognises stored companies on the next preview and imports only the new one", async () => {
    asAdmin();
    const rows: [string, string, string][] = [
      ["alpha traders", "MANGESH", "30 days"],
      ["Delta Inc", "Gauri", "45 days"],
    ];
    const preview = await master.previewCollectionMaster(body(rows));
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.preview.rows.map((r) => [r.companyName, r.status])).toEqual([
      ["alpha traders", "unchanged"],
      ["Delta Inc", "new"],
    ]);
    const res = await master.importCollectionMaster({ ...body(rows), confirm: true });
    expect(res.ok && res.result.totals).toMatchObject({ inserted: 1, unchanged: 1 });
  });

  it("Payment Terms and Sales Coordinator reach the Collection Tracker (Unassigned stays null)", async () => {
    const src = await load.loadCollectionParties();
    expect(src.parties.map((p) => [p.partyName, p.collectionPerson, p.paymentTerms])).toEqual([
      ["Alpha Traders", "MANGESH", "30 days"],
      ["Beta Corp", null, "Advance"],
      ["Delta Inc", "Gauri", "45 days"],
      ["Gamma Ltd", "Gauri", null],
    ]);
  });

  it("an admin without the explicit grant can't assign, even calling the action directly — nothing changes", async () => {
    asAdmin();
    const before = await logRows();
    await expect(tracker.assignSalesCoordinator({ companyId: await companyId("Beta Corp"), coordinatorLabel: "MANGESH", expected: null })).rejects.toThrow("Forbidden");
    expect(await coordinatorOf("Beta Corp")).toBeNull();
    expect(await logRows()).toBe(before);
  });

  it("a granted employee assigns an Unassigned company; it persists, is audited and the Tracker shows it after refresh", async () => {
    asGranted();
    expect((await queries.listCoordinatorOptions()).labels).toEqual(["Gauri", "MANGESH"]);
    const res = await tracker.assignSalesCoordinator({ companyId: await companyId("Beta Corp"), coordinatorLabel: "MANGESH", expected: null });
    expect(res).toEqual({ ok: true, changed: true });
    expect(await coordinatorOf("Beta Corp")).toBe("MANGESH");

    const log = (
      await pg.query<{ imported_by_id: string; column_mapping: { source: string }; changes: unknown[] }>(
        `select imported_by_id, column_mapping, changes from collection_master_imports order by imported_at desc limit 1`,
      )
    ).rows[0]!;
    expect(log.imported_by_id).toBe(ids.granted);
    expect(log.column_mapping.source).toBe("tracker-assignment");
    expect(log.changes).toEqual([expect.objectContaining({ before: { coordinatorLabel: null }, after: { coordinatorLabel: "MANGESH" } })]);
    expect((await queries.listRecentImports(1))[0]).toMatchObject({ source: "tracker-assignment", importedByName: "Granted" });

    const fresh = await load.loadCollectionParties(); // a new request reads the database again
    expect(fresh.parties.find((p) => p.partyName === "Beta Corp")?.collectionPerson).toBe("MANGESH");
  });

  it("refuses a blank, an unknown or a stale choice without changing anything", async () => {
    asGranted();
    const beta = await companyId("Beta Corp");
    const before = await logRows();
    expect(await tracker.assignSalesCoordinator({ companyId: beta, coordinatorLabel: "  ", expected: "MANGESH" })).toEqual({ ok: false, error: "Choose a Sales Coordinator." });
    expect(await tracker.assignSalesCoordinator({ companyId: beta, coordinatorLabel: "Ravi", expected: "MANGESH" })).toEqual({ ok: false, error: expect.stringMatching(/from the list/) });
    expect(await tracker.assignSalesCoordinator({ companyId: beta, coordinatorLabel: "Gauri", expected: null })).toEqual({ ok: false, error: expect.stringMatching(/changed meanwhile/) });
    expect(await coordinatorOf("Beta Corp")).toBe("MANGESH");
    expect(await logRows()).toBe(before);
  });

  it("a granted employee can correct an existing assignment, with its own audit row", async () => {
    asGranted();
    const before = await logRows();
    const res = await tracker.assignSalesCoordinator({ companyId: await companyId("Beta Corp"), coordinatorLabel: "Gauri", expected: "MANGESH" });
    expect(res).toEqual({ ok: true, changed: true });
    expect(await coordinatorOf("Beta Corp")).toBe("Gauri");
    expect(await logRows()).toBe(before + 1);
  });

  it("re-importing never silently overwrites the assignment (blank keeps it; a different name needs acceptance)", async () => {
    asAdmin();
    const blank = await master.importCollectionMaster({ ...body([["Beta Corp", "", "Advance"]]), confirm: true });
    expect(blank.ok && blank.result.rows[0]!.outcome).toBe("unchanged");
    expect(await coordinatorOf("Beta Corp")).toBe("Gauri");

    const other = await master.importCollectionMaster({ ...body([["Beta Corp", "MANGESH", "Advance"]]), confirm: true });
    expect(other.ok && other.result.rows[0]!.outcome).toBe("kept-existing");
    expect(await coordinatorOf("Beta Corp")).toBe("Gauri");
  });
});
