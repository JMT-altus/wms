import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; the balance tables from migration 0117's own SQL) of zero-balance visibility in
// the Collection Tracker, driven by REAL confirmed Bulk Uploads through the real server action, read by the real Tracker
// page with the real module and capability resolvers over real grant rows. Only "who is signed in" is mocked.
//
// The rule: a company whose most recent confirmed line has Debit = 0 AND Credit = 0 is left out of the Tracker; any
// non-zero amount (negative included) lists it; a company a later upload leaves out keeps its previous state; a company
// in no upload at all is never zero-balance. A zero-balance company is NOT removed: the Tracker lists it last and muted.
// Nothing is deleted — the Collection Master row, its coordinator, follow-ups and comments stay, and the row returns to
// the normal list with the next confirmed upload that gives it a balance.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
// Company visibility (lib/collections/scope-server.ts) is not under test here: every company is in scope. The real
// resolver, over real coordinator links, is covered by tests/integration/collection-tracker-scope.db.test.ts.
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
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { orderZeroBalanceLast } from "@/lib/collections/balances/visibility";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let bulk: typeof import("@/app/(collection-module)/collection/tracker/bulk-actions");
let actions: typeof import("@/app/(collection-module)/collection/actions");
let load: typeof import("@/lib/collections/load");
let Page: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];

let admin: string; // every Collection capability granted, Collection module through the admin bypass
let staff: string; // Collection module granted, collection.view only — no balances.import
const as = (id: string, isAdmin: boolean) => (h.me = { id, isAdmin, isActive: true, email: `${id}@example.test`, name: isAdmin ? "Admin" : "Staff", departmentId: null });
const ids: Record<string, string> = {};

/** The sheet's raw cells, as the browser sends them. Data rows start at sheet row 5. */
const grid = (rows: [string, string, string][]) => {
  const sum = (i: 1 | 2) => rows.reduce((t, r) => t + Math.round(Number(r[i] || "0") * 100), 0);
  const money = (p: number) => (p / 100).toFixed(2);
  return [["JMT (from 1-Apr-26)", "", ""], ["1-Apr-26 to 19-Oct-26", "", ""], ["Particulars", "", ""], ["", "Debit", "Credit"], ...rows, ["Grand Total", money(sum(1)), money(sum(2))]];
};
const body = (rows: [string, string, string][], fileName = "Collection.xls") => ({ fileName, sheetName: "Sundry Debtors", grid: grid(rows) });

/** A confirmed upload exactly as the screen does it: preview, then import with what the preview showed. */
async function upload(rows: [string, string, string][], fileName?: string) {
  const p = await bulk.previewCollectionBalances(body(rows, fileName));
  if (!p.ok) throw new Error(`preview: ${p.error}`);
  const r = await bulk.importCollectionBalances({ ...body(rows, fileName), previousSnapshotId: p.preview.replacement.previous?.id ?? null, expected: p.preview.summary.fingerprint, confirm: true });
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
type Row = { partyName: string; masterId: string; zeroBalance?: boolean; collectionPerson: string | null; debit: number | null; credit: number | null; nextFollowupDate: string | null; latestNote?: string | null; notes?: unknown[] };
/** What the Tracker page hands its table: the visible companies, in Master order, and how many it left out. */
async function tracker() {
  const props = (await findProps(await Page(), "CollectionTracker"))!;
  const rows = props.rows as Row[];
  const byName = [...rows].sort((a, b) => a.partyName.localeCompare(b.partyName));
  return {
    names: byName.map((r) => r.partyName), // every company, always
    normal: byName.filter((r) => !r.zeroBalance).map((r) => r.partyName),
    zero: byName.filter((r) => r.zeroBalance).map((r) => r.partyName),
    order: orderZeroBalanceLast(byName).map((r) => r.partyName), // what the table pages through: normal first, zero-balance last
    rows: Object.fromEntries(rows.map((r) => [r.partyName, r])),
    empty: props.emptyMessage as string | undefined,
  };
}
const snapshots = async () => (await pg.query<{ n: number }>(`select count(*)::int n from collection_balance_snapshots`)).rows[0]!.n;
const companyCount = async () => (await pg.query<{ n: number }>(`select count(*)::int n from collection_master_companies`)).rows[0]!.n;
const master = async () => (await pg.query<{ company_name: string; coordinator_label: string | null }>(`select company_name, coordinator_label from collection_master_companies order by company_name`)).rows;

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
  admin = await emp("admin", true);
  staff = await emp("staff", false);
  // Grants exactly as the permission matrix stores them. The sensitive balances.import is an explicit grant even for an admin.
  for (const key of ["collection.view", "collection.balances.import", "collection.followup.write", "collection.coordinator.assign"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, admin]);
  }
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.view', 'employee', $1, true)`, [staff]);
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [staff]);
  for (const [name, key, coord] of [
    ["Alpha Traders", "alphatraders", "MANGESH"],
    ["Beta Works", "betaworks", null],
    ["Gamma Pvt Ltd", "gammapvtltd", null],
    ["Delta Co", "deltaco", null],
    ["Eta Inc", "etainc", null],
    ["Zeta Ltd", "zetaltd", null],
  ] as const) {
    ids[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [name, key, coord])).rows[0]!.id;
  }
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  actions = await import("@/app/(collection-module)/collection/actions");
  load = await import("@/lib/collections/load");
  Page = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  as(admin, true);
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

const ALL = ["Alpha Traders", "Beta Works", "Delta Co", "Eta Inc", "Gamma Pvt Ltd", "Zeta Ltd"];

describe("before any upload", () => {
  it("every company is listed: no balance data is never a zero balance", async () => {
    const t = await tracker();
    expect(t.names).toEqual(ALL);
    expect(t.zero).toEqual([]);
  });
});

describe("the first confirmed upload decides", () => {
  it("Debit = 0 and Credit = 0 hides; a non-zero Debit, a non-zero Credit or a negative amount lists; a company not in the file is untouched", async () => {
    await upload([
      ["Alpha Traders", "5000.00", "0.00"], // visible: debit
      ["Beta Works", "0.00", "5000.00"], // visible: credit
      ["Gamma Pvt Ltd", "0.00", "0.00"], // hidden
      ["Delta Co", "0", ""], // hidden: a blank cell on one side of an otherwise-zero line is zero on that side
      ["Eta Inc", "-10.00", "0.00"], // visible: negative is non-zero
      // Zeta Ltd is in no file at all: — / — and therefore no amount on either side
    ]);
    const t = await tracker();
    expect(t.names).toEqual(ALL); // nobody is removed
    expect(t.normal).toEqual(["Alpha Traders", "Beta Works", "Eta Inc"]);
    expect(t.zero).toEqual(["Delta Co", "Gamma Pvt Ltd", "Zeta Ltd"]); // Zeta: no line in any upload (— / —) = no amount on either side
    expect(t.order).toEqual(["Alpha Traders", "Beta Works", "Eta Inc", "Delta Co", "Gamma Pvt Ltd", "Zeta Ltd"]);
    expect(t.rows["Gamma Pvt Ltd"]).toMatchObject({ debit: 0, credit: 0, zeroBalance: true });
    expect(t.rows["Alpha Traders"]).toMatchObject({ debit: 5000, credit: 0, collectionPerson: "MANGESH" });
    expect(t.rows["Beta Works"]).toMatchObject({ debit: 0, credit: 5000 });
    expect(t.rows["Eta Inc"]).toMatchObject({ debit: -10, credit: 0 });
    expect(t.rows["Zeta Ltd"]).toMatchObject({ debit: null, credit: null });
    // Hidden means left out of the list — not deleted, and still a party to every other reader.
    expect(await companyCount()).toBe(6);
    const all = await load.loadCollectionParties({ kind: "all" });
    expect(all.parties.map((p) => p.partyName).sort()).toEqual(ALL);
    expect(all.parties.find((p) => p.partyName === "Gamma Pvt Ltd")).toMatchObject({ zeroBalance: true, debit: 0, credit: 0 });
  });

  it("a hidden company still takes a follow-up comment and a Sales Coordinator — its record is intact", async () => {
    const saved = await actions.saveFollowUp({ partyName: "Gamma Pvt Ltd", nextFollowupDate: "2099-01-15", note: "Called while hidden" });
    expect(saved).toEqual({ ok: true });
    const assigned = await actions.assignSalesCoordinator({ companyId: ids["Gamma Pvt Ltd"], coordinatorLabel: "MANGESH", expected: null });
    expect(assigned).toMatchObject({ ok: true, changed: true });
    expect((await master()).find((c) => c.company_name === "Gamma Pvt Ltd")?.coordinator_label).toBe("MANGESH");
    expect((await tracker()).zero).toContain("Gamma Pvt Ltd"); // still zero-balance: no upload changed its balance
  });
});

describe("the next confirmed upload re-decides, automatically", () => {
  it("hidden → listed when it gets a balance (its comment and coordinator with it); listed → hidden at 0/0; hidden → hidden at 0/0; missing keeps its state", async () => {
    await upload([
      ["Gamma Pvt Ltd", "7500.00", "0.00"], // hidden → visible
      ["Delta Co", "0.00", "0.00"], // hidden → stays hidden
      ["Alpha Traders", "0.00", "0.00"], // visible → hidden
      ["Beta Works", "0.00", "250.00"], // visible → visible
      // Eta Inc (listed) and Zeta Ltd (never in a file) are missing from this file
    ]);
    const t = await tracker();
    expect(t.normal).toEqual(["Beta Works", "Eta Inc", "Gamma Pvt Ltd"]);
    expect(t.zero).toEqual(["Alpha Traders", "Delta Co", "Zeta Ltd"]);
    expect(t.order).toEqual(["Beta Works", "Eta Inc", "Gamma Pvt Ltd", "Alpha Traders", "Delta Co", "Zeta Ltd"]);
    // Gamma came back with everything it had: nothing was re-created, nothing was lost.
    expect(t.rows["Gamma Pvt Ltd"]).toMatchObject({ masterId: ids["Gamma Pvt Ltd"], debit: 7500, credit: 0, collectionPerson: "MANGESH", nextFollowupDate: "2099-01-15" });
    expect(JSON.stringify(t.rows["Gamma Pvt Ltd"])).toContain("Called while hidden");
    // Eta was left out of this file: still listed, figures blank (never carried forward).
    expect(t.rows["Eta Inc"]).toMatchObject({ debit: null, credit: null });
    expect(await companyCount()).toBe(6);
  });

  it("a hidden company left out of a later partial upload stays hidden; a listed one left out stays listed", async () => {
    await upload([["Beta Works", "100.00", "0.00"]]); // only Beta
    const t = await tracker();
    expect(t.normal).toEqual(["Beta Works", "Eta Inc", "Gamma Pvt Ltd"]); // Alpha and Delta remain empty, Gamma remains normal, Zeta was never in a file
    expect(t.zero).toEqual(["Alpha Traders", "Delta Co", "Zeta Ltd"]);
    expect(t.rows["Beta Works"]).toMatchObject({ debit: 100, credit: 0 });
    expect(t.rows["Gamma Pvt Ltd"]).toMatchObject({ debit: null, credit: null, collectionPerson: "MANGESH" });
  });

  it("the same file again changes nothing and creates no company", async () => {
    const before = await snapshots();
    await upload([["Beta Works", "100.00", "0.00"]], "Collection again.xls");
    expect(await snapshots()).toBe(before + 1); // a snapshot per confirmed upload, same figures
    expect(await companyCount()).toBe(6);
    expect((await tracker()).normal).toEqual(["Beta Works", "Eta Inc", "Gamma Pvt Ltd"]);
  });

  it("a hidden company is listed again by a later upload with a balance on either side — nobody has to unhide it", async () => {
    await upload([
      ["Alpha Traders", "0.00", "1.00"], // hidden → visible by credit
      ["Delta Co", "2.00", "0.00"], // hidden → visible by debit
    ]);
    const t = await tracker();
    expect(t.normal).toEqual(["Alpha Traders", "Beta Works", "Delta Co", "Eta Inc", "Gamma Pvt Ltd"]);
    expect(t.zero).toEqual(["Zeta Ltd"]); // still never in any file
    expect(t.rows["Alpha Traders"]).toMatchObject({ debit: 0, credit: 1, collectionPerson: "MANGESH" });
    expect(t.rows["Delta Co"]).toMatchObject({ debit: 2, credit: 0 });
  });
});

describe("only a committed upload counts", () => {
  it("a preview, a stale confirmation, a changed file and a Grand Total mismatch write nothing and change nobody's visibility", async () => {
    const before = { snapshots: await snapshots(), tracker: await tracker() };
    const zeroAll: [string, string, string][] = [["Alpha Traders", "0.00", "0.00"], ["Beta Works", "0.00", "0.00"], ["Gamma Pvt Ltd", "0.00", "0.00"]];
    // Preview only.
    const p = await bulk.previewCollectionBalances(body(zeroAll));
    expect(p.ok).toBe(true);
    // Another upload landed since the preview.
    expect(await bulk.importCollectionBalances({ ...body(zeroAll), previousSnapshotId: null, expected: p.ok ? p.preview.summary.fingerprint : null, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/Another balance upload/) });
    // The figures changed since the preview.
    expect(await bulk.importCollectionBalances({ ...body(zeroAll), previousSnapshotId: p.ok ? (p.preview.replacement.previous?.id ?? null) : null, expected: { matched: 3, debitPaise: 1, creditPaise: 0 }, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since your preview/) });
    // The rows don't add up to the file's own Grand Total.
    const badTotal = { ...body(zeroAll), grid: [...grid(zeroAll).slice(0, -1), ["Grand Total", "99.00", "0.00"]] };
    const p2 = await bulk.previewCollectionBalances(badTotal);
    expect(p2.ok && p2.preview.summary.verification.status).toBe("mismatch");
    expect(await bulk.importCollectionBalances({ ...badTotal, previousSnapshotId: p2.ok ? (p2.preview.replacement.previous?.id ?? null) : null, expected: p2.ok ? p2.preview.summary.fingerprint : null, confirm: true })).toMatchObject({ ok: false });
    // No confirmation flag.
    expect(await bulk.importCollectionBalances({ ...body(zeroAll), previousSnapshotId: null, expected: { matched: 3, debitPaise: 0, creditPaise: 0 } })).toMatchObject({ ok: false });
    expect(await snapshots()).toBe(before.snapshots);
    expect(await tracker()).toEqual(before.tracker);
  });

  it("a rejected row in an otherwise good file leaves that company's state alone", async () => {
    // Beta's row is unreadable (both cells blank) → rejected; the rest of the file is written.
    const rows: [string, string, string][] = [["Beta Works", "", ""], ["Gamma Pvt Ltd", "0.00", "0.00"]];
    const p = await bulk.previewCollectionBalances(body(rows));
    if (!p.ok) throw new Error(p.error);
    expect(p.preview.summary).toMatchObject({ rejected: 1, matched: 1 });
    const r = await bulk.importCollectionBalances({ ...body(rows), previousSnapshotId: p.preview.replacement.previous?.id ?? null, expected: p.preview.summary.fingerprint, confirm: true });
    expect(r).toMatchObject({ ok: true, result: { written: 1, skipped: { rejected: 1 } } });
    const t = await tracker();
    expect(t.normal).toEqual(["Alpha Traders", "Beta Works", "Delta Co", "Eta Inc"]); // Gamma empty by this upload; Beta kept its previous (normal) state
    expect(t.zero).toEqual(["Gamma Pvt Ltd", "Zeta Ltd"]);
    expect(t.rows["Beta Works"]).toMatchObject({ debit: null, credit: null });
  });
});

describe("permissions stay as they are", () => {
  it("without collection.balances.import nothing can be uploaded, so visibility can't be changed; the Tracker still needs collection.view and the module", async () => {
    as(staff, false);
    const before = { snapshots: await snapshots(), names: (await tracker()).normal }; // staff holds collection.view → the same list
    expect(before.names).toEqual(["Alpha Traders", "Beta Works", "Delta Co", "Eta Inc"]);
    await expect(bulk.previewCollectionBalances(body([["Gamma Pvt Ltd", "1.00", "0.00"]]))).rejects.toThrow("Forbidden");
    await expect(bulk.importCollectionBalances({ ...body([["Gamma Pvt Ltd", "1.00", "0.00"]]), previousSnapshotId: null, expected: { matched: 1, debitPaise: 100, creditPaise: 0 }, confirm: true })).rejects.toThrow("Forbidden");
    expect(await snapshots()).toBe(before.snapshots);
    // Without the Collection module the Tracker itself is refused, whatever the capabilities.
    await pg.exec("delete from module_access_grants");
    await expect(Page()).rejects.toThrow("Forbidden");
    // An admin denied collection.view can't open it either.
    as(admin, true);
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.view' and subject_id = $1`, [admin]);
    await expect(Page()).rejects.toThrow("Forbidden");
    await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.view' and subject_id = $1`, [admin]);
    expect((await tracker()).normal).toEqual(before.names);
  });

  it("nothing was deleted at any point: six companies, every coordinator, the comment", async () => {
    expect(await companyCount()).toBe(6);
    expect((await master()).map((c) => [c.company_name, c.coordinator_label])).toEqual([
      ["Alpha Traders", "MANGESH"],
      ["Beta Works", null],
      ["Delta Co", null],
      ["Eta Inc", null],
      ["Gamma Pvt Ltd", "MANGESH"],
      ["Zeta Ltd", null],
    ]);
    expect((await pg.query(`select note from collection_followups where party_name = 'Gamma Pvt Ltd'`)).rows).toEqual([{ note: "Called while hidden" }]);
  });
});
