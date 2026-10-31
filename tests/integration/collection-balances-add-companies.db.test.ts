import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; the balance tables from migration 0117's
// own SQL) for "Add missing companies as unassigned" in the Tracker Bulk Upload:
//   - the preview identifies the file's unmatched companies by name key and writes nothing;
//   - the add step needs collection.master.import AND collection.balances.import;
//   - it creates exactly those companies as Unassigned (no coordinator, no terms),
//     linked to the Client Master as a Master import would, with one change-log row;
//   - existing companies, their coordinators and timestamps are untouched;
//   - no duplicates: a company that appears meanwhile (even inside the write) is left as it is,
//     and the same request again adds nothing;
//   - after adding, the preview matches them and the confirmed upload stores their
//     Debit / Credit, replacing (never adding to) the previous snapshot;
//   - the Tracker lists them with no collection person.
// Nothing here can reach a shared or production database; only the session is mocked.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
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
import { missingCompanies } from "@/lib/collections/balances/plan";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let bulk: typeof import("@/app/(collection-module)/collection/tracker/bulk-actions");
let masterQ: typeof import("@/lib/queries/collection-master");
let balancesQ: typeof import("@/lib/queries/collection-balances");

const people = {
  full: { name: "Full Admin", email: "full@example.test" }, // balances.import granted; master.import by the admin default
  balancesOnly: { name: "Balances Only", email: "balances@example.test" }, // balances.import granted; master.import explicitly denied
  masterOnly: { name: "Master Only", email: "master@example.test" }, // no balances.import grant (sensitive: no admin bypass)
};
type Who = keyof typeof people;
const ids = {} as Record<Who, string>;
const as = (k: Who) => {
  h.me = { id: ids[k], isAdmin: true, isActive: true, email: people[k].email, name: people[k].name, departmentId: null };
};
let clientGamma = "";

/** The sheet's raw cells, as the browser sends them. Data rows start at sheet row 5. */
const grid = (rows: string[][], total: string[]) => [["JMT (from 1-Apr-26)", "", ""], ["1-Apr-26 to 19-Oct-26", "", ""], ["Particulars", "", ""], ["", "Debit", "Credit"], ...rows, total];
const FILE = grid(
  [
    ["Alpha Traders", "100", ""],
    ["Beta Works", "200", "50"],
    ["Gamma Pvt Ltd", "300", ""], // not in the Master; exactly one complete Client Master record → linked
    ["Delta Co", "", "40"], // not in the Master
    ["DELTA CO.", "", "40"], // identical repeat of the row above: ignored, never a candidate
  ],
  ["Grand Total", "600", "130"],
);
const body = (g: string[][] = FILE) => ({ fileName: "Collection 191026.xls", sheetName: "Sundry Debtors", grid: g });

const counts = async () => {
  const one = async (sql: string) => (await pg.query<{ n: number }>(sql)).rows[0]!.n;
  return {
    companies: await one(`select count(*)::int as n from collection_master_companies`),
    imports: await one(`select count(*)::int as n from collection_master_imports`),
    snapshots: await one(`select count(*)::int as n from collection_balance_snapshots`),
    lines: await one(`select count(*)::int as n from collection_balance_lines`),
  };
};
const companies = async () =>
  (
    await pg.query<{ company_name: string; name_key: string; coordinator_label: string | null; payment_terms: string | null; client_match: string; customer_master_id: string | null; created_import_id: string | null; updated_at: string }>(
      `select company_name, name_key, coordinator_label, payment_terms, client_match, customer_master_id, created_import_id, updated_at::text from collection_master_companies order by company_name`,
    )
  ).rows;

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
  const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
  return findProps(await Page(), "CollectionTracker")!;
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
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0117_collection_balances.sql"), "utf8"));
  for (const k of Object.keys(people) as Who[]) {
    ids[k] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [people[k].name, people[k].email])).rows[0]!.id;
  }
  // Grants exactly as the permission matrix stores them.
  for (const k of ["full", "balancesOnly"] as Who[]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.balances.import', 'employee', $1, true)`, [ids[k]]);
  }
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.master.import', 'employee', $1, false)`, [ids.balancesOnly]);
  clientGamma = (await pg.query<{ id: string }>(`insert into customer_masters (name, kyc_stage) values ('Gamma Pvt Ltd', 'complete') returning id`)).rows[0]!.id;
  // Two companies already in the Master: one with a coordinator, one Unassigned.
  await pg.query(`insert into collection_master_companies (company_name, name_key, coordinator_label, payment_terms, updated_at) values ('Alpha Traders', 'alphatraders', 'MANGESH', '30 days', '2026-01-01T00:00:00Z')`);
  await pg.query(`insert into collection_master_companies (company_name, name_key) values ('Beta Works', 'betaworks')`);
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  masterQ = await import("@/lib/queries/collection-master");
  balancesQ = await import("@/lib/queries/collection-balances");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("preview", () => {
  it("identifies the companies not in the Collection Master by name key (one each; repeats never count) and writes nothing", async () => {
    as("full");
    const before = await counts();
    const r = await bulk.previewCollectionBalances(body());
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.summary).toMatchObject({ rows: 5, matched: 2, unmatched: 2, duplicates: 1, verification: { status: "ok" } });
    expect(missingCompanies(r.preview.rows)).toEqual([
      { rowNo: 7, name: "Gamma Pvt Ltd", nameKey: "gammapvtltd" },
      { rowNo: 8, name: "Delta Co", nameKey: "deltaco" },
    ]);
    expect(await counts()).toEqual(before);
  });
});

describe("addMissingBalanceCompanies", () => {
  it("is refused without collection.master.import (even with balances.import), and without collection.balances.import — nothing is written", async () => {
    const before = await counts();
    as("balancesOnly");
    await expect(bulk.addMissingBalanceCompanies({ ...body(), expected: { unmatched: 2 }, confirm: true })).rejects.toThrow("Forbidden");
    as("masterOnly");
    await expect(bulk.addMissingBalanceCompanies({ ...body(), expected: { unmatched: 2 }, confirm: true })).rejects.toThrow("Forbidden");
    expect(await counts()).toEqual(before);
  });

  it("needs the explicit confirmation and the previewed count", async () => {
    as("full");
    const before = await counts();
    expect(await bulk.addMissingBalanceCompanies({ ...body(), expected: { unmatched: 2 } })).toMatchObject({ ok: false, error: expect.stringMatching(/confirm/i) });
    expect(await bulk.addMissingBalanceCompanies({ ...body(), expected: { unmatched: 1 }, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since your preview/) });
    expect(await counts()).toEqual(before);
  });

  it("adds exactly the unmatched companies as Unassigned, linked to the Client Master as an import would; existing companies and their coordinators are untouched; one change-log row", async () => {
    as("full");
    const before = await counts();
    const r = await bulk.addMissingBalanceCompanies({ ...body(), expected: { unmatched: 2 }, confirm: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toMatchObject({ created: 2, alreadyExisted: 0, rejected: 0 });
    expect(r.result.companies.map((c) => [c.name, c.outcome, c.clientMatch])).toEqual([
      ["Gamma Pvt Ltd", "created", "linked"],
      ["Delta Co", "created", "none"],
    ]);
    const after = await counts();
    expect(after).toEqual({ ...before, companies: before.companies + 2, imports: before.imports + 1 }); // no balances written here

    const rows = await companies();
    expect(rows.map((c) => [c.company_name, c.coordinator_label, c.payment_terms, c.client_match])).toEqual([
      ["Alpha Traders", "MANGESH", "30 days", "none"],
      ["Beta Works", null, null, "none"],
      ["Delta Co", null, null, "none"],
      ["Gamma Pvt Ltd", null, null, "linked"],
    ]);
    expect(rows.find((c) => c.company_name === "Alpha Traders")!.updated_at).toMatch(/^2026-01-01/); // not re-saved
    expect(rows.find((c) => c.company_name === "Gamma Pvt Ltd")!.customer_master_id).toBe(clientGamma);
    expect(rows.find((c) => c.company_name === "Delta Co")!.created_import_id).toBe(r.result.importId);

    const log = (await pg.query<{ column_mapping: { source: string }; totals: Record<string, number>; changes: { action: string; after: { companyName: string; coordinatorLabel: string | null } }[]; imported_by_id: string }>(`select column_mapping, totals, changes, imported_by_id from collection_master_imports where id = $1`, [r.result.importId])).rows[0]!;
    expect(log.column_mapping.source).toBe(masterQ.TRACKER_BALANCES_SOURCE);
    expect(log.totals).toEqual({ rows: 2, inserted: 2, alreadyExisted: 0, rejected: 0 });
    expect(log.changes.map((c) => [c.action, c.after.companyName, c.after.coordinatorLabel])).toEqual([["inserted", "Gamma Pvt Ltd", null], ["inserted", "Delta Co", null]]);
    expect(log.imported_by_id).toBe(ids.full);
    expect((await masterQ.listRecentImports(1))[0]).toMatchObject({ source: masterQ.TRACKER_BALANCES_SOURCE, importedByName: "Full Admin" });
  });

  it("the same request again adds nothing (every company now exists); the Master is unchanged", async () => {
    as("full");
    const before = await counts();
    const snapshot = await companies();
    expect(await bulk.addMissingBalanceCompanies({ ...body(), expected: { unmatched: 2 }, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to add/) });
    expect(await counts()).toEqual(before);
    expect(await companies()).toEqual(snapshot);
  });

  it("never duplicates a company that appears meanwhile — even between its own check and write: the existing row is left exactly as it is", async () => {
    as("full");
    const g = grid(
      [
        ["Alpha Traders", "100", ""],
        ["Zeta Ltd", "10", ""],
        ["Eta Inc", "20", ""],
      ],
      ["Grand Total", "130", "0"],
    );
    // "Eta Inc" gets added by someone else (spelled differently, same name key) AFTER this step has decided its
    // list and BEFORE it inserts: simulated by a trigger on the change-log row the step writes in between.
    await pg.exec(`
      create function test_add_eta() returns trigger language plpgsql as $$
      begin insert into collection_master_companies (company_name, name_key, coordinator_label) values ('ETA INC.', 'etainc', 'Gauri'); return new; end $$;
      create trigger test_add_eta before insert on collection_master_imports for each row execute function test_add_eta();`);
    try {
      const r = await bulk.addMissingBalanceCompanies({ ...body(g), expected: { unmatched: 2 }, confirm: true });
      if (!r.ok) throw new Error(r.error);
      expect(r.result).toMatchObject({ created: 1, alreadyExisted: 1, rejected: 0 });
      expect(r.result.companies.map((c) => [c.name, c.outcome])).toEqual([["Zeta Ltd", "created"], ["Eta Inc", "already-existed"]]);
    } finally {
      await pg.exec(`drop trigger test_add_eta on collection_master_imports; drop function test_add_eta();`);
    }
    const eta = (await companies()).filter((c) => c.name_key === "etainc");
    expect(eta).toHaveLength(1);
    expect(eta[0]).toMatchObject({ company_name: "ETA INC.", coordinator_label: "Gauri" }); // the other person's row, untouched
    expect((await companies()).filter((c) => c.name_key === "zetaltd")).toHaveLength(1);
  });

  it("a name the Collection Master's own rules refuse is reported as rejected, not created", async () => {
    as("full");
    const long = "L".repeat(201);
    const g = grid([["Alpha Traders", "100", ""], [long, "5", ""]], ["Grand Total", "105", "0"]);
    const before = await counts();
    const r = await bulk.addMissingBalanceCompanies({ ...body(g), expected: { unmatched: 1 }, confirm: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toMatchObject({ created: 0, alreadyExisted: 0, rejected: 1 });
    expect(r.result.companies[0]).toMatchObject({ outcome: "rejected", message: expect.stringMatching(/longer than 200/) });
    expect((await counts()).companies).toBe(before.companies);
  });
});

describe("after adding, the balances import", () => {
  it("previews the added companies as matched, and the confirmed upload stores their Debit / Credit — replacing, never adding to, the earlier snapshot", async () => {
    as("full");
    const p1 = await bulk.previewCollectionBalances(body());
    if (!p1.ok) throw new Error(p1.error);
    expect(p1.preview.summary).toMatchObject({ matched: 4, unmatched: 0, duplicates: 1 });
    const fp1 = p1.preview.summary.fingerprint;
    expect(fp1).toEqual({ matched: 4, debitPaise: 60_000, creditPaise: 9_000 });

    const first = await bulk.importCollectionBalances({ ...body(), previousSnapshotId: p1.preview.replacement.previous?.id ?? null, expected: fp1, confirm: true });
    if (!first.ok) throw new Error(first.error);
    expect(first.result).toMatchObject({ written: 4, skipped: { unmatched: 0, duplicates: 1 }, totals: { debit: 600, credit: 90 } });
    const b1 = await balancesQ.loadLatestBalances();
    const idOf = async (name: string) => (await pg.query<{ id: string }>(`select id from collection_master_companies where company_name = $1`, [name])).rows[0]!.id;
    expect(b1.byCompany.get(await idOf("Gamma Pvt Ltd"))).toEqual({ debit: 300, credit: null });
    expect(b1.byCompany.get(await idOf("Delta Co"))).toEqual({ debit: null, credit: 40 });

    // A later file with new figures for Delta Co: the Tracker shows the new figures, not 40 + 10.
    const g2 = grid([["Alpha Traders", "100", ""], ["Delta Co", "", "10"]], ["Grand Total", "100", "10"]);
    const p2 = await bulk.previewCollectionBalances(body(g2));
    if (!p2.ok) throw new Error(p2.error);
    expect(p2.preview.replacement.previous?.id).toBe(first.result.snapshotId);
    const second = await bulk.importCollectionBalances({ ...body(g2), previousSnapshotId: first.result.snapshotId, expected: p2.preview.summary.fingerprint, confirm: true });
    if (!second.ok) throw new Error(second.error);
    const b2 = await balancesQ.loadLatestBalances();
    expect(b2.snapshot?.id).toBe(second.result.snapshotId);
    expect(b2.byCompany.get(await idOf("Delta Co"))).toEqual({ debit: null, credit: 10 });
    expect(b2.byCompany.get(await idOf("Gamma Pvt Ltd"))).toBeUndefined(); // not in the later file → blank, as documented
    // The Master itself was not touched by either upload.
    expect((await companies()).map((c) => [c.company_name, c.coordinator_label])).toEqual([
      ["Alpha Traders", "MANGESH"],
      ["Beta Works", null],
      ["Delta Co", null],
      ["ETA INC.", "Gauri"],
      ["Gamma Pvt Ltd", null],
      ["Zeta Ltd", null],
    ]);
  });

  it("the Tracker lists the added companies with no collection person, alongside the existing ones", async () => {
    as("full");
    const props = await trackerProps();
    const rows = props.rows as { partyName: string; collectionPerson: string | null; debit: number | null; credit: number | null }[];
    const by = Object.fromEntries(rows.map((r) => [r.partyName, r]));
    expect(by["Gamma Pvt Ltd"]).toMatchObject({ collectionPerson: null });
    expect(by["Delta Co"]).toMatchObject({ collectionPerson: null, credit: 10 });
    expect(by["Alpha Traders"]).toMatchObject({ collectionPerson: "MANGESH", debit: 100 });
    expect(props).toMatchObject({ canImportBalances: true, canAddMasterCompanies: true });
  });
});
