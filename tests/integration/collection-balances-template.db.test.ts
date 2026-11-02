import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite, the balance tables from migration 0117's own SQL) of the Bulk Upload sample
// template: the downloaded file goes through the REAL preview and import server actions, and the REAL download route is
// called with the real capability resolver over real grant rows. Only "who is signed in" is mocked.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => ({ kind: "all" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { readBalanceSheet, readBalanceWorkbook } from "@/lib/collections/balances/workbook";
import { BALANCE_TEMPLATE_FILENAME } from "@/lib/collections/balances/template";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let bulk: typeof import("@/app/(collection-module)/collection/tracker/bulk-actions");
let route: typeof import("@/app/(collection-module)/collection/tracker/bulk-template.xlsx/route");
let uploader: string; // has collection.balances.import
let viewer: string; // Collection module, collection.view only
const as = (id: string, isAdmin: boolean) => (h.me = { id, isAdmin, isActive: true, email: `${id}@example.test`, name: "x", departmentId: null });

const count = async (table: string) => (await pg.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0]!.n;

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
    collectionFollowups: schema.collectionFollowups,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0117_collection_balances.sql"), "utf8"));
  const emp = async (name: string, isAdmin: boolean) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, `${name}@example.test`, isAdmin])).rows[0]!.id;
  uploader = await emp("uploader", true);
  viewer = await emp("viewer", false);
  for (const key of ["collection.view", "collection.balances.import"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, uploader]);
  }
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.view', 'employee', $1, true)`, [viewer]);
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [viewer]);
  // Real companies, including ones whose names are the sample names without the marker.
  for (const [name, key] of [["Alpha Traders", "alphatraders"], ["Example Traders Pvt Ltd", "exampletraderspvtltd"]] as const) {
    await pg.query(`insert into collection_master_companies (company_name, name_key) values ($1, $2)`, [name, key]);
  }
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  route = await import("@/app/(collection-module)/collection/tracker/bulk-template.xlsx/route");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

/** Download the template as the signed-in person, and read it the way the dialog does. */
async function download() {
  const res = await route.GET();
  return res;
}

describe("downloading the template", () => {
  it("needs exactly the Bulk Upload permission", async () => {
    as(viewer, false);
    expect((await download()).status).toBe(403);
    h.me = null;
    expect((await download()).status).toBe(403);
    as(uploader, true);
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${BALANCE_TEMPLATE_FILENAME}"`);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(5000);
  });

  it("writes nothing", async () => {
    const before = [await count("collection_master_companies"), await count("collection_balance_snapshots"), await count("collection_balance_lines")];
    as(uploader, true);
    await download();
    expect([await count("collection_master_companies"), await count("collection_balance_snapshots"), await count("collection_balance_lines")]).toEqual(before);
  });
});

describe("uploading the template unchanged", () => {
  it("previews cleanly through the real server action: totals agree, every sample row is Not in Master", async () => {
    as(uploader, true);
    const file = new Uint8Array(await (await download()).arrayBuffer());
    const read = readBalanceSheet(readBalanceWorkbook(file));
    if (!read.ok) throw new Error(read.error);
    const p = await bulk.previewCollectionBalances({ fileName: BALANCE_TEMPLATE_FILENAME, sheetName: read.sheet.sheet, grid: read.grid });
    if (!p.ok) throw new Error(p.error);
    expect(p.preview.summary.verification.status).toBe("ok");
    expect(p.preview.summary.rows).toBe(3);
    expect(p.preview.summary.unmatched).toBe(3);
    expect(p.preview.summary.matched).toBe(0);
    expect(p.preview.summary.rejected).toBe(0);
    expect(p.preview.rows.every((r) => r.status === "unmatched")).toBe(true);
  });

  it("cannot be imported: the server refuses and stores nothing", async () => {
    as(uploader, true);
    const file = new Uint8Array(await (await download()).arrayBuffer());
    const read = readBalanceSheet(readBalanceWorkbook(file));
    if (!read.ok) throw new Error(read.error);
    const body = { fileName: BALANCE_TEMPLATE_FILENAME, sheetName: read.sheet.sheet, grid: read.grid };
    const p = await bulk.previewCollectionBalances(body);
    if (!p.ok) throw new Error(p.error);
    const r = await bulk.importCollectionBalances({ ...body, previousSnapshotId: null, expected: p.preview.summary.fingerprint, confirm: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nothing to import/);
    expect(await count("collection_balance_snapshots")).toBe(0);
    expect(await count("collection_balance_lines")).toBe(0);
    expect(await count("collection_master_companies")).toBe(2);
  });
});
