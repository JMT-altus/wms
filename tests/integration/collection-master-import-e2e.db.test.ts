import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Collection Master import → Collection Tracker, end to end on an in-memory
// PGlite database (nothing here can reach a shared or production database).
// The Collection Master tables come from migration 0112's OWN SQL, applied on
// its own; 0110 (follow-ups) and 0115 (confirmations/escalations) are NOT
// applied, so this also proves the Tracker works with 0112 alone. Real import
// actions, real Tracker page, real permission resolver; only the session is mocked.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
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
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let master: typeof import("@/app/(forms-module)/forms/collection/master/actions");
let clientId = "";

const body = (rows: [string, string, string][]) => ({
  fileName: "CompanyMaster.xlsx",
  sheetName: "Sheet1",
  mapping: { company: "Company", coordinator: "Unnamed column B", paymentTerms: "Payment Terms" },
  confirmedColumns: { coordinator: true },
  rows: rows.map(([company, coordinator, paymentTerms], i) => ({ rowNo: i + 2, company, coordinator, paymentTerms })),
});
const FILE: [string, string, string][] = [
  ["Alpha Traders", "MANGESH", "30 days"],
  ["", "MANGESH", "15 days"], // rejected: blank company
  ["Beta Corp", "XXX", "Advance"], // placeholder coordinator → Unassigned
  ["alpha traders", "MANGESH", "30 days"], // same company, same values → duplicate, skipped
  ["Gamma Ltd", "Gauri", "45 days"],
  ["Gamma Ltd.", "Ravi", "45 days"], // same company, different coordinator → both rejected
  ["Delta Inc", "gauri", ""], // spelling unified to "Gauri"; no terms
  ["Client One Pvt Ltd", "Ravi", "60 days"], // exact Client Master match → linked
];
const companies = async () =>
  (await pg.query<{ company_name: string; coordinator_label: string | null; payment_terms: string | null; client_match: string }>(
    `select company_name, coordinator_label, payment_terms, client_match from collection_master_companies order by company_name`,
  )).rows;

function findProps(node: ReactNode, name: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el.props;
  const kids = el.props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const f = findProps(k as ReactNode, name);
    if (f) return f;
  }
  return null;
}
const trackerProps = async () => {
  const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
  return findProps(await Page(), "CollectionTracker")!;
};

beforeAll(async () => {
  // Only what 0112 needs, plus the permission tables the guards read. No Collection tables yet.
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
  });
  pg = made.pg;
  h.db = made.db;
  const adminId = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('Asha', 'asha@example.test', 'both', true) returning id`)).rows[0]!.id;
  clientId = (await pg.query<{ id: string }>(`insert into customer_masters (name, kyc_stage) values ('Client One Pvt Ltd', 'complete') returning id`)).rows[0]!.id;
  // An ordinary admin: Collection view and import by the admin default — no grants needed.
  h.me = { id: adminId, email: "asha@example.test", name: "Asha", isActive: true, isAdmin: true, departmentId: null };
  master = await import("@/app/(forms-module)/forms/collection/master/actions");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("without migration 0112 (what the UI reports as “pending”)", () => {
  it("preview says storage isn't set up; import fails clearly and saves nothing; the Tracker says why it's empty", async () => {
    const preview = await master.previewCollectionMaster(body(FILE));
    expect(preview.ok && preview.preview.storageReady).toBe(false);
    expect(await master.importCollectionMaster({ ...body(FILE), confirm: true })).toEqual({ ok: false, error: expect.stringMatching(/migration 0112 is pending/) });
    const props = await trackerProps();
    expect(props).toMatchObject({ connected: false, rows: [], emptyMessage: expect.stringMatching(/migration 0112 is pending/) });
  });
});

describe("with migration 0112 applied on its own", () => {
  beforeAll(async () => {
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0112_collection_master.sql"), "utf8"));
  });

  it("the preview validates every row: new, rejected (with reasons), duplicates and conflicts", async () => {
    const res = await master.previewCollectionMaster(body(FILE));
    if (!res.ok) throw new Error(res.error);
    expect(res.preview.storageReady).toBe(true);
    expect(res.preview.summary).toMatchObject({ rows: 8, new: 4, duplicate: 1, rejected: 3, conflictGroups: 1, clientLinked: 1 });
    const status = Object.fromEntries(res.preview.rows.map((r) => [r.rowNo, r.status]));
    expect(status).toEqual({ 2: "new", 3: "rejected", 4: "new", 5: "duplicate", 6: "rejected", 7: "rejected", 8: "new", 9: "new" });
    expect(res.preview.rows.find((r) => r.rowNo === 3)!.messages[0]!.text).toBe("Company name is blank.");
    expect(res.preview.rows.find((r) => r.rowNo === 6)!.messages[0]!.text).toMatch(/same company with different coordinators/);
  });

  it("imports the valid companies with Sales Coordinator and Payment Terms, links the Client Master match, and reports skipped rows", async () => {
    const res = await master.importCollectionMaster({ ...body(FILE), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals).toMatchObject({ inserted: 4, duplicates: 1, rejected: 3, updated: 0, conflicts: 0 });
    expect(await companies()).toEqual([
      { company_name: "Alpha Traders", coordinator_label: "MANGESH", payment_terms: "30 days", client_match: "none" },
      { company_name: "Beta Corp", coordinator_label: null, payment_terms: "Advance", client_match: "none" },
      { company_name: "Client One Pvt Ltd", coordinator_label: "Ravi", payment_terms: "60 days", client_match: "linked" },
      { company_name: "Delta Inc", coordinator_label: "Gauri", payment_terms: null, client_match: "none" },
    ]);
    const linked = await pg.query<{ customer_master_id: string }>(`select customer_master_id from collection_master_companies where company_name = 'Client One Pvt Ltd'`);
    expect(linked.rows[0]!.customer_master_id).toBe(clientId);
    const audit = await pg.query<{ file_name: string; imported_by_id: string }>(`select file_name, imported_by_id from collection_master_imports`);
    expect(audit.rows).toEqual([{ file_name: "CompanyMaster.xlsx", imported_by_id: h.me!.id }]);
  });

  it("the imported companies appear in Collection Tracker — with only 0112 applied", async () => {
    const props = await trackerProps();
    expect(props.connected).toBe(true);
    expect((props.rows as { partyName: string; collectionPerson: string | null; paymentTerms: string | null }[]).map((r) => [r.partyName, r.collectionPerson, r.paymentTerms])).toEqual([
      ["Alpha Traders", "MANGESH", "30 days"],
      ["Beta Corp", null, "Advance"],
      ["Client One Pvt Ltd", "Ravi", "60 days"],
      ["Delta Inc", "Gauri", null],
    ]);
    // Follow-ups (0110) and review (0115) aren't applied: the Tracker still lists companies and says so.
    expect(props.storageReady).toBe(false);
    expect(props.reviewStorageReady).toBe(false);
  });

  it("re-importing the same file creates no duplicates and changes nothing", async () => {
    const before = await companies();
    const res = await master.importCollectionMaster({ ...body(FILE), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals).toMatchObject({ inserted: 0, updated: 0, unchanged: 4 });
    expect(await companies()).toEqual(before);
  });

  it("a different coordinator for a stored company is not applied unless that row is accepted; a blank never clears", async () => {
    const changed = body([["Alpha Traders", "Gauri", "30 days"], ["Beta Corp", "", ""]]);
    const res = await master.importCollectionMaster({ ...changed, confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.rows.map((r) => [r.companyName, r.outcome])).toEqual([
      ["Alpha Traders", "kept-existing"],
      ["Beta Corp", "unchanged"],
    ]);
    expect((await companies()).find((c) => c.company_name === "Alpha Traders")!.coordinator_label).toBe("MANGESH");
    expect((await companies()).find((c) => c.company_name === "Beta Corp")!.payment_terms).toBe("Advance");

    const accepted = await master.importCollectionMaster({ ...changed, acceptChanges: [2], confirm: true });
    if (!accepted.ok) throw new Error(accepted.error);
    expect(accepted.result.totals.updated).toBe(1);
    expect((await companies()).find((c) => c.company_name === "Alpha Traders")!.coordinator_label).toBe("Gauri");
  });

  it("import requires an explicit confirmation and a confirmed coordinator column", async () => {
    expect((await master.importCollectionMaster(body(FILE))).ok).toBe(false);
    const { confirmedColumns: _c, ...unconfirmed } = body(FILE);
    expect(await master.previewCollectionMaster(unconfirmed)).toEqual({ ok: false, error: expect.stringMatching(/Confirm which column holds the Sales Coordinator/) });
  });
});
