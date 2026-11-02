import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; the balance tables from 0117's SQL and the closures table from 0119's SQL) of
// the automatic movement between the Collection Tracker and Collection Logs. Every upload goes through the REAL preview
// and import server actions; the Tracker and Collection Logs are the REAL pages with the real capability resolvers over
// real grant rows. Mocked: who is signed in, and which companies their Collection scope covers (the real scope resolver
// has its own tests); everything about movement, matching and storage is real.
//
// The rule: a confirmed upload that gives a company Debit = 0 AND Credit = 0 moves it to Collection Logs (an open closure
// episode); one that gives it a non-zero Debit OR Credit returns it to the Tracker (the episode is marked reopened). Only
// companies in the upload are looked at. Nothing is deleted or re-created.
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

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let bulk: typeof import("@/app/(collection-module)/collection/tracker/bulk-actions");
let actions: typeof import("@/app/(collection-module)/collection/actions");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
let LogsPage: (typeof import("@/app/(collection-module)/collection/logs/page"))["default"];

let admin: string;
let staff: string;
const as = (id: string, isAdmin: boolean) => (h.me = { id, isAdmin, isActive: true, email: `${id}@example.test`, name: isAdmin ? "Admin" : "Staff", departmentId: null });
const ids: Record<string, string> = {};

// Nine companies; two coordinators. "Alpha Traders Pvt Ltd" is a DIFFERENT company from "Alpha Traders".
const COMPANIES: [name: string, key: string, coordinator: string | null, terms: string | null][] = [
  ["Alpha Traders", "alphatraders", "MANGESH", "30 days"],
  ["Alpha Traders Pvt Ltd", "alphatraderspvtltd", null, null],
  ["Beta Works", "betaworks", "MANGESH", "45 days"],
  ["Gamma Pvt Ltd", "gammapvtltd", "RIYA", "Advance"],
  ["Delta Co", "deltaco", null, null],
  ["Eta Inc", "etainc", null, null],
  ["Theta Ltd", "thetaltd", "RIYA", null],
  ["Iota LLP", "iotallp", null, null],
  ["Zeta Ltd", "zetaltd", null, null],
];
const ALL = COMPANIES.map((c) => c[0]).sort();

const cellPaise = (v: string) => (v.trim() === "" || /^[-–—]$/.test(v.trim()) ? 0 : Math.round(Number(v) * 100));
/** The sheet's raw cells, as the browser sends them, with a Grand Total that matches the rows. */
const grid = (rows: [string, string, string][], total?: [string, string]) => {
  const sum = (i: 1 | 2) => (rows.reduce((t, r) => t + cellPaise(r[i]), 0) / 100).toFixed(2);
  return [["JMT (from 1-Apr-26)", "", ""], ["1-Apr-26 to 31-Oct-26", "", ""], ["Particulars", "", ""], ["", "Debit", "Credit"], ...rows, ["Grand Total", ...(total ?? [sum(1), sum(2)])]];
};
const body = (rows: [string, string, string][], total?: [string, string]) => ({ fileName: "Collection.xls", sheetName: "Sundry Debtors", grid: grid(rows, total) });

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
type Row = { partyName: string; masterId: string; collectionPerson: string | null; paymentTerms?: string | null; debit: number | null; credit: number | null; nextFollowupDate: string | null };
/** What the Tracker page lists (names sorted), and its note about Collection Logs. */
async function tracker() {
  const props = (await findProps(await TrackerPage(), "CollectionTracker"))!;
  const rows = props.rows as Row[];
  return {
    names: rows.map((r) => r.partyName).sort(),
    rows: Object.fromEntries(rows.map((r) => [r.partyName, r])),
    logsNote: props.logsNote as { count: number; href: string | null } | undefined,
  };
}
type LogRow = { companyName: string; companyId: string; reopenedAt: Date | null; finalDebit: string | null; finalCredit: string | null; closeSourceKey: string; closeSourceRef: string | null; asOfDate: string | null };
/** What the Collection Logs page lists. */
async function logs() {
  const props = (await findProps((await LogsPage()) as ReactNode, "CollectionLogsList"))!;
  const rows = props.rows as LogRow[];
  return { all: rows, open: rows.filter((r) => r.reopenedAt === null).map((r) => r.companyName).sort() };
}
const closures = async () => (await pg.query<{ company: string; reopened: boolean }>(`select m.company_name company, c.reopened_at is not null reopened from collection_closures c join collection_master_companies m on m.id = c.company_id order by m.company_name, c.closed_at`)).rows;
const openClosures = async () => (await closures()).filter((c) => !c.reopened).map((c) => c.company).sort();
const snapshots = async () => (await pg.query<{ n: number }>(`select count(*)::int n from collection_balance_snapshots`)).rows[0]!.n;
const master = async () => (await pg.query<{ id: string; company_name: string; coordinator_label: string | null; payment_terms: string | null }>(`select id, company_name, coordinator_label, payment_terms from collection_master_companies order by company_name`)).rows;
const inTracker = (names: string[]) => ALL.filter((n) => !names.includes(n));

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
  for (const key of ["collection.view", "collection.balances.import", "collection.followup.write", "collection.coordinator.assign", "collection.logs.view"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, admin]);
  }
  for (const key of ["collection.view", "collection.logs.view"]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, staff]);
  }
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [staff]);
  for (const [name, key, coord, terms] of COMPANIES) {
    ids[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label, payment_terms) values ($1, $2, $3, $4) returning id`, [name, key, coord, terms])).rows[0]!.id;
  }
  bulk = await import("@/app/(collection-module)/collection/tracker/bulk-actions");
  actions = await import("@/app/(collection-module)/collection/actions");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  LogsPage = (await import("@/app/(collection-module)/collection/logs/page")).default;
  as(admin, true);
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("before any upload", () => {
  it("every company is in the Tracker and Collection Logs is empty: no balance is not a zero balance", async () => {
    expect((await tracker()).names).toEqual(ALL);
    expect((await tracker()).logsNote).toBeUndefined();
    expect((await logs()).all).toEqual([]);
  });
});

describe("the first confirmed upload moves", () => {
  it("1–3, 7, 8, 10: 0/0 → Logs; a non-zero Debit or Credit stays; dashes are zero; one blank beside a zero is zero; both blank moves nothing; unmatched rows touch no one", async () => {
    const r = await upload([
      ["Alpha Traders", "0.00", "0.00"], // 1: Tracker → Logs
      ["Beta Works", "500.00", "0.00"], // 2: Debit 500 → stays
      ["Gamma Pvt Ltd", "0.00", "500.00"], // 3: Credit 500 → stays
      ["Delta Co", "-", "-"], // 7: dashes are zero → Logs
      ["Eta Inc", "0", ""], // 8: a blank beside a zero is zero on that side (the importer's own rule) → Logs
      ["Theta Ltd", "", ""], // 8: both blank: the row is rejected, so nothing is known and nothing moves
      ["Kappa Unknown Co", "0.00", "0.00"], // 10: not in the Collection Master: skipped, moves nobody
      ["Iota LLP", "-10.00", "0.00"], // a negative is a balance, not zero → stays
      // Zeta Ltd and Alpha Traders Pvt Ltd are not in the file at all
    ]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 3, toTracker: 0 });
    expect(r.skipped).toMatchObject({ unmatched: 1, rejected: 1 });
    expect(await openClosures()).toEqual(["Alpha Traders", "Delta Co", "Eta Inc"]);
    const t = await tracker();
    expect(t.names).toEqual(inTracker(["Alpha Traders", "Delta Co", "Eta Inc"]));
    expect(t.names).toContain("Alpha Traders Pvt Ltd"); // 11: a similar name is a different company and was not moved
    expect(t.names).toContain("Zeta Ltd"); // absent from the file: not moved
    expect(t.names).toContain("Theta Ltd"); // unknown balance: not moved
    expect(t.logsNote).toEqual({ count: 3, href: "/collection/logs" });
    // 15: Collection Logs lists them, with the upload's figures, source and as-of date.
    const l = await logs();
    expect(l.open).toEqual(["Alpha Traders", "Delta Co", "Eta Inc"]);
    const alpha = l.all.find((x) => x.companyName === "Alpha Traders")!;
    expect(alpha).toMatchObject({ companyId: ids["Alpha Traders"], finalDebit: "0.00", finalCredit: "0.00", closeSourceKey: "tracker-balances-upload", asOfDate: "2026-10-31" });
    expect(alpha.closeSourceRef).toBe(r.snapshotId);
    expect(l.all.find((x) => x.companyName === "Eta Inc")).toMatchObject({ finalDebit: "0.00", finalCredit: null });
  });

  it("12: a logged company keeps its id, coordinator and payment terms, and still takes a follow-up comment", async () => {
    const saved = await actions.saveFollowUp({ partyName: "Alpha Traders", nextFollowupDate: "2099-01-15", note: "Called while in Logs" });
    expect(saved).toEqual({ ok: true });
    const m = (await master()).find((c) => c.company_name === "Alpha Traders")!;
    expect(m).toMatchObject({ id: ids["Alpha Traders"], coordinator_label: "MANGESH", payment_terms: "30 days" });
    expect(await openClosures()).toContain("Alpha Traders"); // a comment moves nothing
  });
});

describe("the next confirmed upload moves them back, automatically", () => {
  it("4–6: Logs → Tracker on a non-zero Credit or Debit; Logs → Logs while still zero (no second episode)", async () => {
    const r = await upload([
      ["Alpha Traders", "0.00", "5000.00"], // 4: Credit → back to the Tracker
      ["Delta Co", "2500.00", "0.00"], // 5: Debit → back to the Tracker
      ["Eta Inc", "-", "-"], // 6 + 7: still zero → stays in Logs
      ["Beta Works", "0.00", "0.00"], // Tracker → Logs
    ]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 1, toTracker: 2 });
    expect(await openClosures()).toEqual(["Beta Works", "Eta Inc"]);
    // Eta has exactly one episode, still open; Alpha and Delta have theirs, reopened.
    expect((await closures()).filter((c) => c.company === "Eta Inc")).toEqual([{ company: "Eta Inc", reopened: false }]);
    expect((await closures()).filter((c) => c.company === "Alpha Traders")).toEqual([{ company: "Alpha Traders", reopened: true }]);
    const t = await tracker();
    expect(t.names).toEqual(inTracker(["Beta Works", "Eta Inc"]));
    // 12: Alpha came back with everything: same id, figures from this upload, coordinator, payment terms, its comment.
    expect(t.rows["Alpha Traders"]).toMatchObject({ masterId: ids["Alpha Traders"], debit: 0, credit: 5000, collectionPerson: "MANGESH", nextFollowupDate: "2099-01-15" });
    expect(JSON.stringify(t.rows["Alpha Traders"])).toContain("Called while in Logs");
    expect(t.rows["Delta Co"]).toMatchObject({ debit: 2500, credit: 0 });
    // 15: the Logs history keeps the reopened episodes.
    const l = await logs();
    expect(l.open).toEqual(["Beta Works", "Eta Inc"]);
    expect(l.all.filter((x) => x.reopenedAt !== null).map((x) => x.companyName).sort()).toEqual(["Alpha Traders", "Delta Co"]);
  });

  it("a company left out of a later partial upload stays where it was, in either section", async () => {
    const r = await upload([["Gamma Pvt Ltd", "0.00", "700.00"]]);
    expect(r.movement).toEqual({ status: "ok", toLogs: 0, toTracker: 0 });
    expect(await openClosures()).toEqual(["Beta Works", "Eta Inc"]);
  });

  it("a company that goes to zero again gets a NEW episode; the old one stays in the history", async () => {
    await upload([["Alpha Traders", "0", "0"]]);
    expect((await closures()).filter((c) => c.company === "Alpha Traders")).toEqual([
      { company: "Alpha Traders", reopened: true },
      { company: "Alpha Traders", reopened: false },
    ]);
    await upload([["Alpha Traders", "1.00", "0"]]);
    expect((await closures()).filter((c) => c.company === "Alpha Traders").every((c) => c.reopened)).toBe(true);
  });

  it("13: the same zero file twice records one episode and creates no company", async () => {
    const before = { closures: (await closures()).length, companies: (await master()).length };
    const a = await upload([["Iota LLP", "0.00", "0.00"]]);
    const b = await upload([["Iota LLP", "0.00", "0.00"]]);
    expect([a.movement.toLogs, b.movement.toLogs]).toEqual([1, 0]);
    expect((await closures()).length).toBe(before.closures + 1);
    expect((await master()).length).toBe(before.companies);
    expect(await openClosures()).toEqual(["Beta Works", "Eta Inc", "Iota LLP"]);
  });
});

describe("matching", () => {
  it("11: a conflicting duplicate moves nobody; case, spacing and punctuation still find the one right company", async () => {
    const before = await openClosures();
    // Beta (in Logs) twice with different figures: every Beta row is rejected, so Beta does not move.
    const r = await upload([
      ["Beta Works", "0.00", "100.00"],
      ["Beta Works", "0.00", "0.00"],
      ["  GAMMA  pvt. ltd ", "0.00", "0.00"], // the same company as "Gamma Pvt Ltd" → Logs
    ]);
    expect(r.skipped.conflicts).toBe(2);
    expect(await openClosures()).toEqual([...before, "Gamma Pvt Ltd"].sort());
    expect(await openClosures()).not.toContain("Alpha Traders Pvt Ltd");
    // Back again for the rest of the file.
    await upload([["Gamma Pvt Ltd", "0.00", "1.00"]]);
  });
});

describe("only a committed upload moves anyone", () => {
  it("9: a preview, a stale confirmation, changed figures, a Grand Total mismatch and a missing confirmation move nobody", async () => {
    const before = { snapshots: await snapshots(), closures: await closures() };
    const zeroAll: [string, string, string][] = [["Alpha Traders", "0.00", "0.00"], ["Gamma Pvt Ltd", "0.00", "0.00"], ["Eta Inc", "5.00", "0.00"]];
    const p = await bulk.previewCollectionBalances(body(zeroAll));
    if (!p.ok) throw new Error(p.error);
    const prev = p.preview.replacement.previous?.id ?? null;
    expect(await bulk.importCollectionBalances({ ...body(zeroAll), previousSnapshotId: null, expected: p.preview.summary.fingerprint, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/Another balance upload/) });
    expect(await bulk.importCollectionBalances({ ...body(zeroAll), previousSnapshotId: prev, expected: { matched: 3, debitPaise: 1, creditPaise: 0 }, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since your preview/) });
    const bad = body(zeroAll, ["99.00", "0.00"]);
    const p2 = await bulk.previewCollectionBalances(bad);
    expect(p2.ok && p2.preview.summary.verification.status).toBe("mismatch");
    expect(await bulk.importCollectionBalances({ ...bad, previousSnapshotId: prev, expected: p2.ok ? p2.preview.summary.fingerprint : { matched: 0, debitPaise: 0, creditPaise: 0 }, confirm: true })).toMatchObject({ ok: false });
    expect(await bulk.importCollectionBalances({ ...body(zeroAll), previousSnapshotId: prev, expected: p.preview.summary.fingerprint })).toMatchObject({ ok: false });
    expect(await snapshots()).toBe(before.snapshots);
    expect(await closures()).toEqual(before.closures);
  });

  it("9: a write that fails part-way rolls the movement back with the balances", async () => {
    const before = { snapshots: await snapshots(), closures: await closures() };
    // Make the closure write fail inside the transaction (a constraint the movement can't satisfy), then restore it.
    await pg.exec(`alter table collection_closures add constraint test_block check (close_source_key = 'nothing') not valid`);
    try {
      const rows: [string, string, string][] = [["Alpha Traders", "0.00", "0.00"]];
      const p = await bulk.previewCollectionBalances(body(rows));
      if (!p.ok) throw new Error(p.error);
      const r = await bulk.importCollectionBalances({ ...body(rows), previousSnapshotId: p.preview.replacement.previous?.id ?? null, expected: p.preview.summary.fingerprint, confirm: true });
      expect(r.ok).toBe(false);
    } finally {
      await pg.exec(`alter table collection_closures drop constraint test_block`);
    }
    expect(await snapshots()).toBe(before.snapshots);
    expect(await closures()).toEqual(before.closures);
  });
});

describe("14: who sees what", () => {
  it("a Sales Coordinator sees only their own companies, in the Tracker and in Collection Logs; a super-admin scope sees all", async () => {
    await upload([["Theta Ltd", "0.00", "0.00"]]); // RIYA's company → Logs
    const allOpen = await openClosures();
    expect(allOpen).toContain("Theta Ltd");
    as(staff, false);
    h.scope = { kind: "coordinator", label: "RIYA" };
    const t = await tracker();
    expect(t.names).toEqual(["Gamma Pvt Ltd"]); // RIYA's other company, in the Tracker
    expect(t.logsNote).toEqual({ count: 1, href: "/collection/logs" });
    expect((await logs()).open).toEqual(["Theta Ltd"]);
    h.scope = { kind: "coordinator", label: "MANGESH" };
    expect((await logs()).open).toEqual(allOpen.filter((n) => ["Alpha Traders", "Beta Works"].includes(n)));
    h.scope = { kind: "all" };
    expect((await logs()).open).toEqual(allOpen);
    as(admin, true);
  });

  it("without collection.logs.view the Logs page is not found, the Tracker note has no link, and nobody can upload without the Bulk Upload permission", async () => {
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.logs.view' and subject_id = $1`, [staff]);
    as(staff, false);
    await expect(LogsPage()).rejects.toThrow();
    expect((await tracker()).logsNote?.href).toBeNull();
    await expect(bulk.previewCollectionBalances(body([["Theta Ltd", "1.00", "0.00"]]))).rejects.toThrow("Forbidden");
    await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.logs.view' and subject_id = $1`, [staff]);
    as(admin, true);
  });
});

describe("nothing is deleted", () => {
  it("12: every company, id, coordinator and payment term is as it was; the comment is there; episodes are only ever added", async () => {
    expect((await master()).map((c) => [c.company_name, c.id, c.coordinator_label, c.payment_terms])).toEqual(
      [...COMPANIES].sort((a, b) => a[0].localeCompare(b[0])).map(([n, , coord, terms]) => [n, ids[n], coord, terms]),
    );
    expect((await pg.query(`select note from collection_followups where party_name = 'Alpha Traders'`)).rows).toEqual([{ note: "Called while in Logs" }]);
    expect((await pg.query<{ n: number }>(`select count(*)::int n from collection_closures where reopened_at is null`)).rows[0]!.n).toBe((await openClosures()).length);
  });
});
