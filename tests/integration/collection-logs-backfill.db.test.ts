import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; 0114 commitments, 0117 balances, 0119 closures from their own SQL) of the
// one-time clean-up that moves EXISTING "— / —" and "₹0 / ₹0" Tracker companies into Collection Logs, followed by
// the automatic restoration a later confirmed upload performs. The clean-up runs the very SQL the script runs
// (lib/collections/balances/logs-backfill.ts); uploads, the Tracker page and the Logs page are the real ones.
// Mocked: who is signed in, and the Collection scope.
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
vi.mock("@/components/collections/collection-logs", () => ({ CollectionLogsList: () => null, LogsLoadError: () => null, LogsShell: ({ children }: { children: ReactNode }) => children }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { applyBackfill, applyRestore, countBackfill, BACKFILL_SOURCE_KEY, type Exec } from "@/lib/collections/balances/logs-backfill";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let exec: Exec;
let bulk: typeof import("@/app/(collection-module)/collection/tracker/bulk-actions");
let actions: typeof import("@/app/(collection-module)/collection/actions");
let commitments: typeof import("@/app/(collection-module)/collection/commitments/actions");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
let LogsPage: (typeof import("@/app/(collection-module)/collection/logs/page"))["default"];
let admin: string;
const ids: Record<string, string> = {};

// [name, key, coordinator, payment terms]
const COMPANIES: [string, string, string | null, string | null][] = [
  ["A 1 Pharma Ind.", "a1pharmaind", "RIYA", "30 days"], // in an earlier upload, absent from the latest → — / —
  ["A One Punch", "aonepunch", "RIYA", null], // latest line 0 / 0
  ["A One Steel Traders", "aonesteeltraders", "MANGESH", "Advance"], // never in any upload → — / —
  ["Balance Co", "balanceco", "MANGESH", null], // a balance in the latest upload
  ["Dash Co", "dashco", null, null], // latest line "-" / "-"
];
const ALL = COMPANIES.map((c) => c[0]).sort();

const cellPaise = (v: string) => {
  const s = v.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  return s === "" || /^[-–—]$/.test(s) ? 0 : Math.round(Number(s) * 100);
};
const grid = (rows: [string, string, string][]) => {
  const sum = (i: 1 | 2) => (rows.reduce((t, r) => t + cellPaise(r[i]), 0) / 100).toFixed(2);
  return [["JMT (from 1-Apr-26)", "", ""], ["1-Apr-26 to 31-Oct-26", "", ""], ["Particulars", "", ""], ["", "Debit", "Credit"], ...rows, ["Grand Total", sum(1), sum(2)]];
};
const body = (rows: [string, string, string][]) => ({ fileName: "Collection.xls", sheetName: "Sundry Debtors", grid: grid(rows) });
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
type Row = { partyName: string; masterId: string; collectionPerson: string | null; paymentTerms?: string | null; debit: number | null; credit: number | null; history: { note: string | null }[]; commitment?: { amount: string } | null };
async function tracker() {
  const rows = (findProps(await TrackerPage(), "CollectionTracker")!.rows as Row[]);
  return { names: rows.map((r) => r.partyName).sort(), rows: Object.fromEntries(rows.map((r) => [r.partyName, r])) };
}
async function logsOpen() {
  const rows = findProps((await LogsPage()) as ReactNode, "CollectionLogsList")!.rows as { companyName: string; reopenedAt: Date | null; closeSourceKey: string }[];
  return rows.filter((r) => r.reopenedAt === null).map((r) => r.companyName).sort();
}
const n = async (q: string) => Number((await pg.query<{ n: number }>(q)).rows[0]!.n);

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
    collectionAmountConfirmations: schema.collectionAmountConfirmations,
    collectionConfirmedAmounts: schema.collectionConfirmedAmounts,
    collectionEscalations: schema.collectionEscalations,
  });
  pg = made.pg;
  h.db = made.db;
  exec = async (text, params) => (await pg.query<Record<string, unknown>>(text, params as unknown[])).rows;
  for (const m of ["0114_collection_commitments.sql", "0117_collection_balances.sql", "0119_collection_closures.sql"]) {
    await pg.exec(readFileSync(resolve(__dirname, `../../db/migrations/${m}`), "utf8"));
  }
  admin = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('Admin', 'admin@example.test', 'both', true) returning id`)).rows[0]!.id;
  for (const key of ["collection.view", "collection.balances.import", "collection.followup.write", "collection.logs.view", "collection.commitments.view", "collection.commitments.edit", "collection.escalation.create"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, admin]);
  }
  for (const [name, key, coord, terms] of COMPANIES) {
    ids[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label, payment_terms) values ($1, $2, $3, $4) returning id`, [name, key, coord, terms])).rows[0]!.id;
  }
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  actions = await import("@/app/(collection-module)/collection/actions");
  commitments = await import("@/app/(collection-module)/collection/commitments/actions");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  LogsPage = (await import("@/app/(collection-module)/collection/logs/page")).default;
  h.me = { id: admin, isAdmin: true, isActive: true, email: "admin@example.test", name: "Admin", departmentId: null };
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("before the clean-up", () => {
  it("with no confirmed upload there are no figures to go by: nothing counts and nothing can move", async () => {
    const c = await countBackfill(exec);
    expect(c.hasUpload).toBe(false);
    await expect(applyBackfill(exec, ["never-uploaded"])).rejects.toThrow(/No balance upload has been confirmed/);
    expect(await n(`select count(*)::int n from collection_closures`)).toBe(0);
  });

  it("the state the screenshot shows: — / — and ₹0 / ₹0 companies still in the Tracker, with their history", async () => {
    // An older upload (before 0 / 0 moved anyone) that still had A 1 Pharma with a balance.
    await upload([["A 1 Pharma Ind.", "1000", ""], ["Balance Co", "5", ""]]);
    // Recreate the pre-fix state: no closures from these uploads (the earlier importer didn't write any).
    await pg.exec(`delete from collection_closures`);
    await upload([["A One Punch", "0", "0"], ["Balance Co", "50,000", "-"], ["Dash Co", "-", "-"]]);
    await pg.exec(`delete from collection_closures`);
    // History that must survive both movements.
    expect(await actions.saveFollowUp({ partyName: "A 1 Pharma Ind.", nextFollowupDate: "2099-01-15", note: "Spoke to accounts" })).toEqual({ ok: true });
    expect(await commitments.saveCompanyCommitment({ companyId: ids["A 1 Pharma Ind."], amount: "100000", committedDate: "2026-11-04" })).toMatchObject({ ok: true });
    const t = await tracker();
    expect(t.names).toEqual(ALL);
    expect(t.rows["A 1 Pharma Ind."]).toMatchObject({ debit: null, credit: null }); // — / —
    expect(t.rows["A One Steel Traders"]).toMatchObject({ debit: null, credit: null }); // — / —
    expect(t.rows["A One Punch"]).toMatchObject({ debit: 0, credit: 0 });
    expect(await logsOpen()).toEqual([]);
  });
});

describe("the clean-up of existing entries", () => {
  it("counts exactly the — / — and ₹0 / ₹0 companies, by kind; a company with a balance is not among them", async () => {
    const c = await countBackfill(exec);
    expect(c).toMatchObject({ hasUpload: true, companies: 5, alreadyInLogs: 0, withBalance: 1 });
    expect(c.byBucket).toEqual({ "zero-line": 2, "absent-from-latest": 1, "never-uploaded": 1 });
  });

  it("moves them into Collection Logs and out of the Tracker; the company with a balance stays", async () => {
    const moved = await applyBackfill(exec, ["zero-line", "absent-from-latest", "never-uploaded"]);
    expect(moved).toBe(4);
    expect((await tracker()).names).toEqual(["Balance Co"]);
    expect(await logsOpen()).toEqual(["A 1 Pharma Ind.", "A One Punch", "A One Steel Traders", "Dash Co"]);
    expect(await n(`select count(*)::int n from collection_closures where close_source_key = '${BACKFILL_SOURCE_KEY}' and closed_by_id is null`)).toBe(4);
  });

  it("running it again moves nobody and creates nothing", async () => {
    expect(await applyBackfill(exec, ["zero-line", "absent-from-latest", "never-uploaded"])).toBe(0);
    expect(await n(`select count(*)::int n from collection_closures`)).toBe(4);
    expect(await n(`select count(*)::int n from collection_master_companies`)).toBe(5);
  });

  it("a chosen subset moves only that kind", async () => {
    await pg.exec(`delete from collection_closures where company_id = '${ids["A One Steel Traders"]}'`);
    expect(await applyBackfill(exec, ["zero-line"])).toBe(0); // the zero-line companies are already logged
    expect(await logsOpen()).not.toContain("A One Steel Traders");
    expect(await applyBackfill(exec, ["never-uploaded"])).toBe(1);
    expect(await logsOpen()).toContain("A One Steel Traders");
  });
});

describe("the clean-up of existing Logs entries", () => {
  it("returns a logged company whose latest upload gives it a balance; a logged company absent from the latest upload stays", async () => {
    // Balance Co has ₹50,000 in the latest upload but was put in Logs (as a stale state would leave it).
    await pg.query(`insert into collection_closures (company_id, close_reason, close_source_key, final_outstanding) values ($1, 'outstanding_zero', 'test', 0)`, [ids["Balance Co"]]);
    expect((await tracker()).names).toEqual([]);
    const c = await countBackfill(exec);
    expect(c.toRestore).toBe(1); // A 1 Pharma is logged and absent from the latest upload: not counted
    expect(await applyRestore(exec)).toBe(1);
    expect((await tracker()).names).toEqual(["Balance Co"]);
    expect(await logsOpen()).toEqual(["A 1 Pharma Ind.", "A One Punch", "A One Steel Traders", "Dash Co"]);
    // Reopened, not deleted: the episode stays in the history.
    expect(await n(`select count(*)::int n from collection_closures where company_id = '${ids["Balance Co"]}' and reopened_at is not null and reopen_reason = 'outstanding_positive'`)).toBe(1);
    expect(await applyRestore(exec)).toBe(0);
    expect((await countBackfill(exec)).toRestore).toBe(0);
  });
});

describe("automatic restoration after a later upload", () => {
  it("Credit 50000 or Debit 25000 brings a company back; blank / blank keeps it in Logs; a company absent from the file stays where it is", async () => {
    const r = await upload([
      ["A 1 Pharma Ind.", "-", "50000"], // Credit 50000 → Tracker
      ["A One Punch", "25,000", "—"], // Debit 25000 → Tracker
      ["A One Steel Traders", "", ""], // both blank → stays in Logs
      // Dash Co (in Logs) and Balance Co (in the Tracker) are absent → unchanged
    ]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 0, toTracker: 2 });
    const t = await tracker();
    expect(t.names).toEqual(["A 1 Pharma Ind.", "A One Punch", "Balance Co"]);
    expect(await logsOpen()).toEqual(["A One Steel Traders", "Dash Co"]);
    expect(t.rows["A 1 Pharma Ind."]).toMatchObject({ debit: 0, credit: 50000 });
    expect(t.rows["A One Punch"]).toMatchObject({ debit: 25000, credit: 0 });
  });

  it("the restored company is the same record, with its coordinator, payment terms, comment and commitment", async () => {
    const t = await tracker();
    expect(t.rows["A 1 Pharma Ind."]).toMatchObject({ masterId: ids["A 1 Pharma Ind."], collectionPerson: "RIYA", paymentTerms: "30 days" });
    expect(t.rows["A 1 Pharma Ind."]!.history.map((x) => x.note)).toContain("Spoke to accounts");
    expect(t.rows["A 1 Pharma Ind."]!.commitment).toMatchObject({ amount: "100000.00" });
    expect((await pg.query(`select company_name, coordinator_label, payment_terms from collection_master_companies order by company_name`)).rows).toEqual(
      [...COMPANIES].sort((a, b) => a[0].localeCompare(b[0])).map(([company_name, , coordinator_label, payment_terms]) => ({ company_name, coordinator_label, payment_terms })),
    );
  });

  it("the same upload again changes nothing; no company or episode is duplicated", async () => {
    const before = await n(`select count(*)::int n from collection_closures`);
    const r = await upload([["A 1 Pharma Ind.", "-", "50000"], ["A One Punch", "25,000", "—"], ["A One Steel Traders", "", ""]]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 0, toTracker: 0 });
    expect(await n(`select count(*)::int n from collection_closures`)).toBe(before);
    expect(await n(`select count(*)::int n from collection_closures where reopened_at is null`)).toBe(2);
    expect(await n(`select count(*)::int n from collection_master_companies`)).toBe(5);
  });

  it("a Sales Coordinator still sees only their own companies, in both sections", async () => {
    h.scope = { kind: "coordinator", label: "MANGESH" };
    expect((await tracker()).names).toEqual(["Balance Co"]);
    expect(await logsOpen()).toEqual(["A One Steel Traders"]);
    h.scope = { kind: "all" };
  });
});
