import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; balances from 0117's SQL, Collection Logs storage from 0119's SQL) that the
// Collection Dashboard follows every change made in the Collection Tracker. Each change goes through the REAL server
// action the screen calls — the Collection Master import, "add missing companies" from an upload, the confirmed
// balance upload, the Sales Coordinator assignment — and after each one the REAL Dashboard and Tracker pages are
// rendered again and compared. Also checked: that every successful change revalidates /collection/dashboard, and that
// a refused one revalidates nothing. Mocked: who is signed in, their Collection scope (it has its own tests), the two
// client components (their props are what is compared), and next/cache (to record what was revalidated).
//
// In this data model the "Collection person" a party is grouped under IS the Sales Coordinator the Collection Master
// holds for it (one stored value, collection_master_companies.coordinator_label): assigning a Sales Coordinator is
// what moves a party between Collection persons. There is no second assignment to keep in step.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
type Scope = { kind: "all" } | { kind: "coordinator"; label: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, scope: { kind: "all" } as Scope, revalidated: [] as string[] };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => h.scope }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    h.revalidated.push(p);
  },
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
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
let master: typeof import("@/app/(collection-module)/collection/master/actions");
let actions: typeof import("@/app/(collection-module)/collection/actions");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
let DashboardPage: (typeof import("@/app/(collection-module)/collection/dashboard/page"))["default"];

let admin: string;
let staff: string;
const as = (id: string, isAdmin: boolean) => (h.me = { id, isAdmin, isActive: true, email: `${id}@example.test`, name: isAdmin ? "Admin" : "Staff", departmentId: null });

// Five companies to start with: three coordinators and one unassigned.
const COMPANIES: [name: string, key: string, coordinator: string | null][] = [
  ["Alpha Traders", "alphatraders", "MANGESH"],
  ["Beta Works", "betaworks", "MANGESH"],
  ["Gamma Pvt Ltd", "gammapvtltd", "RIYA"],
  ["Sigma Tools", "sigmatools", "AJAY"],
  ["Delta Co", "deltaco", null],
];

const cellPaise = (v: string) => {
  const s = v.trim().replace(/,/g, "");
  return s === "" || /^[-–—]$/.test(s) ? 0 : Math.round(Number(s) * 100);
};
type FileRow = [name: string, debit: string, credit: string];
/** The balance sheet's raw cells, as the browser sends them, with a Grand Total that matches the rows. */
const grid = (rows: FileRow[]) => {
  const sum = (i: 1 | 2) => (rows.reduce((t, r) => t + cellPaise(r[i]), 0) / 100).toFixed(2);
  return [["JMT (from 1-Apr-26)", "", ""], ["1-Apr-26 to 31-Oct-26", "", ""], ["Particulars", "", ""], ["", "Debit", "Credit"], ...rows, ["Grand Total", sum(1), sum(2)]];
};
const body = (rows: FileRow[]) => ({ fileName: "Collection.xls", sheetName: "Sundry Debtors", grid: grid(rows) });
/** A confirmed balance upload exactly as the Tracker does it: preview, then import with what the preview showed. */
async function upload(rows: FileRow[]) {
  const p = await bulk.previewCollectionBalances(body(rows));
  if (!p.ok) throw new Error(`preview: ${p.error}`);
  const r = await bulk.importCollectionBalances({ ...body(rows), previousSnapshotId: p.preview.replacement.previous?.id ?? null, expected: p.preview.summary.fingerprint, confirm: true });
  if (!r.ok) throw new Error(`import: ${r.error}`);
  return r.result;
}
/** The Collection Master file, as the import screen sends it. */
const masterBody = (rows: [company: string, coordinator: string, terms: string][]) => ({
  fileName: "CompanyMaster.xlsx",
  sheetName: "Sheet1",
  mapping: { company: "Company", coordinator: "Sales Coordinator", paymentTerms: "Payment Terms" },
  confirmedColumns: { coordinator: true },
  rows: rows.map(([company, coordinator, paymentTerms], i) => ({ rowNo: i + 2, company, coordinator, paymentTerms })),
});

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
type Counts = { total: number; byPerson: Record<string, number> };
/** The Dashboard table's Parties column, by person — the function the table itself renders from. */
async function dashboardCounts(): Promise<Counts> {
  const rows = await dashboardRows();
  return { total: rows.length, byPerson: Object.fromEntries(personSummary(rows).map((r) => [r.unassigned ? UNASSIGNED : r.person, r.parties])) };
}
/** How many parties the Tracker lists for each person: its own Collection person filter, one person at a time. */
async function trackerCounts(): Promise<Counts> {
  const rows = await trackerRows();
  const keys = [...new Set(rows.map((r) => personOf(r) ?? UNASSIGNED_PERSON))];
  const count = (collectionPerson: string) => filterRows(rows, { query: "", collectionPerson, followUp: "" }, "2026-11-13").length;
  return { total: rows.length, byPerson: Object.fromEntries(keys.map((k) => [k === UNASSIGNED_PERSON ? UNASSIGNED : k, count(k)])) };
}
/** 7: after every operation the two screens are rendered again from the database and must agree, party for party. */
async function agreed(): Promise<Counts> {
  const [d, t, dr, tr] = [await dashboardCounts(), await trackerCounts(), await dashboardRows(), await trackerRows()];
  expect(d).toEqual(t);
  expect(dr.map((r) => r.partyName).sort()).toEqual(tr.map((r) => r.partyName).sort());
  expect(Object.values(d.byPerson).reduce((a, b) => a + b, 0)).toBe(t.total);
  return d;
}
const row = async (name: string) => (await dashboardRows()).find((r) => r.partyName === name);
const companyId = async (name: string) => (await pg.query<{ id: string }>(`select id from collection_master_companies where company_name = $1`, [name])).rows[0]!.id;
const assign = async (name: string, to: string, expected: string | null) => actions.assignSalesCoordinator({ companyId: await companyId(name), coordinatorLabel: to, expected });

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
  // What a super-admin's "Allow" in the permission matrix stores. The assignment capability is sensitive: explicit grant only.
  for (const key of ["collection.view", "collection.balances.import", "collection.master.import", "collection.coordinator.assign"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, admin]);
  }
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.view', 'employee', $1, true)`, [staff]);
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [staff]);
  for (const [name, key, coord] of COMPANIES) {
    await pg.query(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3)`, [name, key, coord]);
  }
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  master = await import("@/app/(collection-module)/collection/master/actions");
  actions = await import("@/app/(collection-module)/collection/actions");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  DashboardPage = (await import("@/app/(collection-module)/collection/dashboard/page")).default;
  as(admin, true);
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => {
  h.revalidated.length = 0;
  h.scope = { kind: "all" };
  as(admin, true);
});

describe("the Dashboard follows every change made in the Tracker", () => {
  it("starts in step with the Tracker", async () => {
    expect(await agreed()).toEqual({ total: 5, byPerson: { MANGESH: 2, RIYA: 1, AJAY: 1, [UNASSIGNED]: 1 } });
  });

  it("1: five new parties under different Collection persons (one of them a new person, one unassigned) are counted at once, each under their own person", async () => {
    const res = await master.importCollectionMaster({
      ...masterBody([
        ["Nova One", "MANGESH", "30 days"],
        ["Nova Two", "RIYA", ""],
        ["Nova Three", "AJAY", ""],
        ["Nova Four", "KIRAN", "45 days"],
        ["Nova Five", "", ""],
      ]),
      confirm: true,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals).toMatchObject({ inserted: 5 });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/collection/dashboard", "/collection/tracker"]));
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 2, AJAY: 2, KIRAN: 1, [UNASSIGNED]: 2 } });
    expect(await row("Nova Four")).toMatchObject({ collectionPerson: "KIRAN", debit: null, credit: null });
  });

  it("1: their balances from the next confirmed upload show on the Dashboard's rows; the counts stay", async () => {
    const r = await upload([
      ["Nova One", "1000.00", "0.00"],
      ["Nova Two", "0.00", "2000.00"],
      ["Nova Three", "10.00", "10.00"],
      ["Nova Four", "5.00", "0.00"],
      ["Nova Five", "7.00", "0.00"],
      ["Alpha Traders", "300.00", "0.00"],
    ]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 0, toTracker: 0 });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/collection/dashboard", "/collection/tracker", "/collection/logs"]));
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 2, AJAY: 2, KIRAN: 1, [UNASSIGNED]: 2 } });
    expect(await row("Nova One")).toMatchObject({ debit: 1000, credit: 0 });
    expect(await row("Nova Two")).toMatchObject({ debit: 0, credit: 2000 });
    expect(await row("Alpha Traders")).toMatchObject({ debit: 300, credit: 0 }); // an existing party: its latest figures
  });

  it("1 + 2: companies a Tracker upload names for the first time are added as Unassigned and counted; the ₹0 / ₹0 ones then go to Collection Logs and are not", async () => {
    const file: FileRow[] = [
      ["Fresh Alpha Co", "500.00", "0.00"], // new, with a balance
      ["Fresh Beta Co", "0.00", "0.00"], // new, zero / zero
      ["Beta Works", "0.00", "0.00"], // MANGESH's, zero / zero
      ["Delta Co", "-", "-"], // unassigned, dash / dash
    ];
    const added = await bulk.addMissingBalanceCompanies({ ...body(file), expected: { unmatched: 2 }, confirm: true });
    if (!added.ok) throw new Error(added.error);
    expect(added.result.created).toBe(2);
    expect(h.revalidated).toEqual(expect.arrayContaining(["/collection/dashboard", "/collection/tracker"]));
    // Added, no balance written yet: listed by the Tracker (no balance is not a zero balance), so counted here too.
    expect(await agreed()).toEqual({ total: 12, byPerson: { MANGESH: 3, RIYA: 2, AJAY: 2, KIRAN: 1, [UNASSIGNED]: 4 } });

    h.revalidated.length = 0;
    const r = await upload(file);
    expect(r.movement).toEqual({ status: "ok", toLogs: 3, toTracker: 0 });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/collection/dashboard", "/collection/tracker", "/collection/logs"]));
    // Beta Works (MANGESH), Delta Co and Fresh Beta Co (unassigned) left; Fresh Alpha Co stayed with its balance.
    expect(await agreed()).toEqual({ total: 9, byPerson: { MANGESH: 2, RIYA: 2, AJAY: 2, KIRAN: 1, [UNASSIGNED]: 2 } });
    expect(await row("Fresh Alpha Co")).toMatchObject({ collectionPerson: null, debit: 500, credit: 0 });
    for (const gone of ["Fresh Beta Co", "Beta Works", "Delta Co"]) expect(await row(gone), gone).toBeUndefined();
  });

  it("3: a party in Collection Logs that a later upload gives a balance is counted again, under the same person", async () => {
    const r = await upload([["Beta Works", "100.00", "0.00"]]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 0, toTracker: 1 });
    expect(h.revalidated).toContain("/collection/dashboard");
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 2, AJAY: 2, KIRAN: 1, [UNASSIGNED]: 2 } });
    expect(await row("Beta Works")).toMatchObject({ collectionPerson: "MANGESH", debit: 100, credit: 0 });
  });

  it("4 + 5: assigning a different Sales Coordinator moves the party to that Collection person — one stored value, one move", async () => {
    expect(await assign("Gamma Pvt Ltd", "AJAY", "RIYA")).toEqual({ ok: true, changed: true });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/collection/dashboard", "/collection/tracker", "/collection/master"]));
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 1, AJAY: 3, KIRAN: 1, [UNASSIGNED]: 2 } });
    // The Sales Coordinator the Master holds and the Collection person the screens group by are the same label.
    expect(await row("Gamma Pvt Ltd")).toMatchObject({ collectionPerson: "AJAY", coordinatorLabel: "AJAY" });
    expect((await pg.query<{ c: string }>(`select coordinator_label c from collection_master_companies where company_name = 'Gamma Pvt Ltd'`)).rows[0]!.c).toBe("AJAY");
  });

  it("5 + 6: giving an unassigned party a Sales Coordinator takes it out of Unassigned", async () => {
    expect(await assign("Fresh Alpha Co", "KIRAN", null)).toEqual({ ok: true, changed: true });
    expect(h.revalidated).toContain("/collection/dashboard");
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 1, AJAY: 3, KIRAN: 2, [UNASSIGNED]: 1 } });
  });

  it("a refused or unchanged assignment changes no count and revalidates nothing", async () => {
    const before = await agreed();
    expect(await assign("Gamma Pvt Ltd", "AJAY", "AJAY")).toMatchObject({ ok: true, changed: false }); // already AJAY's
    expect(await assign("Gamma Pvt Ltd", "RIYA", "MANGESH")).toMatchObject({ ok: false }); // the screen was stale
    expect(await assign("Gamma Pvt Ltd", "NOBODY", "AJAY")).toMatchObject({ ok: false }); // not a coordinator the Master holds
    expect(await assign("Gamma Pvt Ltd", "", "AJAY")).toMatchObject({ ok: false }); // 6: an assignment cannot be blanked from the Tracker
    expect(h.revalidated).toEqual([]);
    expect(await agreed()).toEqual(before);
  });

  it("6: a party with no Sales Coordinator is counted under Unassigned on both screens, whatever it was before", async () => {
    // The app has no action that removes a Sales Coordinator (the Tracker refuses a blank, and a Master file without
    // one keeps the existing assignment), so the state is set directly: the screens read what the database holds.
    await pg.query(`update collection_master_companies set coordinator_label = null where company_name = 'Sigma Tools'`);
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 1, AJAY: 2, KIRAN: 2, [UNASSIGNED]: 2 } });
    expect(await row("Sigma Tools")).toMatchObject({ collectionPerson: null });
    // A Master file that leaves the coordinator blank keeps the existing one — and so does the Dashboard.
    const res = await master.importCollectionMaster({ ...masterBody([["Gamma Pvt Ltd", "", ""]]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(await row("Gamma Pvt Ltd")).toMatchObject({ collectionPerson: "AJAY" });
    expect(await agreed()).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 1, AJAY: 2, KIRAN: 2, [UNASSIGNED]: 2 } });
  });

  it("8: someone who sees only their own companies gets a Dashboard of exactly those, and it follows changes made by others", async () => {
    as(staff, false);
    h.scope = { kind: "coordinator", label: "KIRAN" };
    expect(await agreed()).toEqual({ total: 2, byPerson: { KIRAN: 2 } });
    // They hold collection.view only: no assignment, and nothing moves.
    await expect(assign("Nova Five", "KIRAN", null)).rejects.toThrow("Forbidden");
    expect(await agreed()).toEqual({ total: 2, byPerson: { KIRAN: 2 } });

    // An authorised person hands KIRAN another company: KIRAN's next Dashboard render has it.
    as(admin, true);
    h.scope = { kind: "all" };
    expect(await assign("Nova Five", "KIRAN", null)).toEqual({ ok: true, changed: true });
    as(staff, false);
    h.scope = { kind: "coordinator", label: "KIRAN" };
    expect(await agreed()).toEqual({ total: 3, byPerson: { KIRAN: 3 } });
    expect((await dashboardRows()).every((r) => personOf(r) === "KIRAN")).toBe(true);
    // …and it has left nobody else's view by accident: RIYA still sees only RIYA's.
    h.scope = { kind: "coordinator", label: "RIYA" };
    expect(await agreed()).toEqual({ total: 1, byPerson: { RIYA: 1 } });
  });

  it("nothing was deleted along the way: every company is still in the Collection Master, in Collection Logs or in the Tracker", async () => {
    const companies = (await pg.query<{ n: number }>(`select count(*)::int n from collection_master_companies`)).rows[0]!.n;
    expect(companies).toBe(COMPANIES.length + 5 + 2);
    const all = await agreed();
    const logged = (await pg.query<{ n: number }>(`select count(*)::int n from collection_closures where reopened_at is null`)).rows[0]!.n;
    expect(all.total + logged).toBe(companies);
    expect(all).toEqual({ total: 10, byPerson: { MANGESH: 3, RIYA: 1, AJAY: 2, KIRAN: 3, [UNASSIGNED]: 1 } });
  });
});
