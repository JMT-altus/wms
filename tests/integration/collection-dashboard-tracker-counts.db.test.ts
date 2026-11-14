import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; balances from 0117's SQL, closures from 0119's SQL) that the Collection
// Dashboard counts exactly the parties the Collection Tracker lists, for every collection person and for Unassigned.
// Both REAL pages run over real rows, with the real capability resolvers; every upload goes through the REAL preview
// and import server actions, so a company reaches Collection Logs only the way it does in the app (a confirmed upload
// that gave it ₹0 Debit and ₹0 Credit). Mocked: who is signed in, their Collection scope (it has its own tests), and
// the two client components (their props are what is compared).
//
// The two sides are worked out the way each screen does it:
//   Dashboard  personSummary(rows)  — what the "Collection person-wise outstanding" table renders in its Parties column.
//   Tracker    filterRows(rows, { collectionPerson })  — what the Tracker's Collection person filter lists.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
type Scope = { kind: "all" } | { kind: "coordinator"; label: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, scope: { kind: "all" } as Scope };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => h.scope }));
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
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));
vi.mock("@/components/collections/collection-dashboard", () => ({ CollectionDashboard: () => null }));

import * as schema from "@/db/schema";
import { UNASSIGNED_PERSON, filterRows, personOf, personSummary, type PartyRow } from "@/lib/collections/derive";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let bulk: typeof import("@/app/(collection-module)/collection/tracker/bulk-actions");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
let DashboardPage: (typeof import("@/app/(collection-module)/collection/dashboard/page"))["default"];

let admin: string;
let staff: string;
const as = (id: string, isAdmin: boolean) => (h.me = { id, isAdmin, isActive: true, email: `${id}@example.test`, name: isAdmin ? "Admin" : "Staff", departmentId: null });

// Ten companies: three coordinators (one of them holds a single company) and four unassigned.
const COMPANIES: [name: string, key: string, coordinator: string | null][] = [
  ["Alpha Traders", "alphatraders", "MANGESH"],
  ["Beta Works", "betaworks", "MANGESH"],
  ["Kappa Mills", "kappamills", "MANGESH"],
  ["Gamma Pvt Ltd", "gammapvtltd", "RIYA"],
  ["Theta Ltd", "thetaltd", "RIYA"],
  ["Sigma Tools", "sigmatools", "AJAY"],
  ["Delta Co", "deltaco", null],
  ["Eta Inc", "etainc", null],
  ["Iota LLP", "iotallp", null],
  ["Zeta Ltd", "zetaltd", null],
];

const cellPaise = (v: string) => {
  const s = v.trim().replace(/,/g, "");
  return s === "" || /^[-–—]$/.test(s) ? 0 : Math.round(Number(s) * 100);
};
/** The sheet's raw cells, as the browser sends them, with a Grand Total that matches the rows. */
const grid = (rows: [string, string, string][]) => {
  const sum = (i: 1 | 2) => (rows.reduce((t, r) => t + cellPaise(r[i]), 0) / 100).toFixed(2);
  return [["JMT (from 1-Apr-26)", "", ""], ["1-Apr-26 to 31-Oct-26", "", ""], ["Particulars", "", ""], ["", "Debit", "Credit"], ...rows, ["Grand Total", sum(1), sum(2)]];
};
const body = (rows: [string, string, string][]) => ({ fileName: "Collection.xls", sheetName: "Sundry Debtors", grid: grid(rows) });
/** A confirmed upload exactly as the screen does it: preview, then import with what the preview showed. */
async function upload(rows: [string, string, string][]) {
  const p = await bulk.previewCollectionBalances(body(rows));
  if (!p.ok) throw new Error(`preview: ${p.error}`);
  const r = await bulk.importCollectionBalances({ ...body(rows), previousSnapshotId: p.preview.replacement.previous?.id ?? null, expected: p.preview.summary.fingerprint, confirm: true });
  if (!r.ok) throw new Error(`import: ${r.error}`);
  return r.result;
}

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
const trackerRows = async () => findProps(await TrackerPage(), "CollectionTracker")!.rows as PartyRow[];
const dashboardRows = async () => findProps(await DashboardPage(), "CollectionDashboard")!.rows as PartyRow[];

const UNASSIGNED = "(unassigned)";
/** The Dashboard table's Parties column, by person. */
async function dashboardCounts() {
  const rows = await dashboardRows();
  return { total: rows.length, byPerson: Object.fromEntries(personSummary(rows).map((r) => [r.unassigned ? UNASSIGNED : r.person, r.parties])) };
}
/** How many parties the Tracker lists for each person: its own Collection person filter, one person at a time. */
async function trackerCounts() {
  const rows = await trackerRows();
  const keys = [...new Set(rows.map((r) => personOf(r) ?? UNASSIGNED_PERSON))];
  const count = (collectionPerson: string) => filterRows(rows, { query: "", collectionPerson, followUp: "" }, "2026-11-13").length;
  return { total: rows.length, byPerson: Object.fromEntries(keys.map((k) => [k === UNASSIGNED_PERSON ? UNASSIGNED : k, count(k)])) };
}
const names = (rows: PartyRow[]) => rows.map((r) => r.partyName).sort();
const tableCounts = async () => {
  const one = async (t: string) => (await pg.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0]!.n;
  return { companies: await one("collection_master_companies"), closures: await one("collection_closures"), snapshots: await one("collection_balance_snapshots"), lines: await one("collection_balance_lines") };
};

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
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0119_collection_closures.sql"), "utf8"));
  const emp = async (name: string, isAdmin: boolean) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, `${name}@example.test`, isAdmin])).rows[0]!.id;
  admin = await emp("admin", true);
  staff = await emp("staff", false);
  for (const key of ["collection.view", "collection.balances.import"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, admin]);
  }
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.view', 'employee', $1, true)`, [staff]);
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [staff]);
  for (const [name, key, coord] of COMPANIES) {
    await pg.query(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3)`, [name, key, coord]);
  }
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  DashboardPage = (await import("@/app/(collection-module)/collection/dashboard/page")).default;
  as(admin, true);
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("Dashboard party counts are the Tracker's", () => {
  it("before any upload: every company is counted on both — a company with no balance is not a zero balance", async () => {
    const d = await dashboardCounts();
    expect(d).toEqual(await trackerCounts());
    expect(d).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 2, AJAY: 1, [UNASSIGNED]: 4 } });
  });

  it("₹0 Debit and ₹0 Credit (0/0, dash/dash, blank/blank) leave both screens; a Debit-only or Credit-only balance and a company the file leaves out stay", async () => {
    await upload([
      ["Alpha Traders", "0.00", "0.00"], // MANGESH: zero / zero → Collection Logs
      ["Beta Works", "25000.00", "0.00"], // MANGESH: Debit only → stays
      ["Gamma Pvt Ltd", "0.00", "50000.00"], // RIYA: Credit only → stays
      ["Theta Ltd", "", ""], // RIYA: named with both cells blank → ₹0 / ₹0 → Collection Logs
      ["Delta Co", "-", "-"], // unassigned: dash / dash → Collection Logs
      ["Eta Inc", "0", ""], // unassigned: a blank beside a zero → Collection Logs
      ["Iota LLP", "1.00", "1.00"], // unassigned: both sides non-zero → stays
    ]);
    const [d, t] = [await dashboardCounts(), await trackerCounts()];
    expect(d).toEqual(t);
    // Was 3 / 2 / 1 / 4 (total 10) while the Dashboard counted every assigned company.
    expect(d).toEqual({ total: 6, byPerson: { MANGESH: 2, RIYA: 1, AJAY: 1, [UNASSIGNED]: 2 } });
    // The same companies, not merely the same number; each exactly once.
    const rows = await dashboardRows();
    expect(names(rows)).toEqual(names(await trackerRows()));
    expect(names(rows)).toEqual(["Beta Works", "Gamma Pvt Ltd", "Iota LLP", "Kappa Mills", "Sigma Tools", "Zeta Ltd"]);
    expect(new Set(rows.map((r) => r.masterId)).size).toBe(rows.length);
    // The rows of the table add up to the Tracker's whole list.
    expect(Object.values(d.byPerson).reduce((a, b) => a + b, 0)).toBe(t.total);
  });

  it("a company that gets a balance again is counted again on both; one that goes to zero is dropped from both", async () => {
    await upload([
      ["Alpha Traders", "0.00", "700.00"], // back to the Tracker
      ["Beta Works", "0.00", "0.00"], // to Collection Logs
    ]);
    const d = await dashboardCounts();
    expect(d).toEqual(await trackerCounts());
    expect(d.byPerson).toEqual({ MANGESH: 2, RIYA: 1, AJAY: 1, [UNASSIGNED]: 2 });
    expect(names(await dashboardRows())).toContain("Alpha Traders");
    expect(names(await dashboardRows())).not.toContain("Beta Works");
  });

  it("a person whose every company is in Collection Logs has no row on either screen", async () => {
    await upload([["Sigma Tools", "0.00", "0.00"], ["Gamma Pvt Ltd", "-", "-"]]);
    const d = await dashboardCounts();
    expect(d).toEqual(await trackerCounts());
    expect(d).toEqual({ total: 4, byPerson: { MANGESH: 2, [UNASSIGNED]: 2 } });
  });

  it("a Sales Coordinator's Dashboard counts only their own Tracker parties", async () => {
    as(staff, false);
    try {
      h.scope = { kind: "coordinator", label: "MANGESH" };
      const d = await dashboardCounts();
      expect(d).toEqual(await trackerCounts());
      expect(d).toEqual({ total: 2, byPerson: { MANGESH: 2 } });
      h.scope = { kind: "coordinator", label: "RIYA" }; // both of RIYA's companies are in Collection Logs
      expect(await dashboardCounts()).toEqual({ total: 0, byPerson: {} });
      expect(await trackerCounts()).toEqual({ total: 0, byPerson: {} });
    } finally {
      h.scope = { kind: "all" };
      as(admin, true);
    }
  });

  it("the Dashboard still needs collection.view, and reading either page writes nothing", async () => {
    const before = await tableCounts();
    await dashboardRows();
    await trackerRows();
    expect(await tableCounts()).toEqual(before);
    expect(before.companies).toBe(COMPANIES.length); // companies in Collection Logs are still in the Collection Master
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.view' and subject_id = $1`, [staff]);
    as(staff, false);
    try {
      await expect(DashboardPage()).rejects.toThrow(/Forbidden/);
    } finally {
      await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.view' and subject_id = $1`, [staff]);
      as(admin, true);
    }
  });
});
