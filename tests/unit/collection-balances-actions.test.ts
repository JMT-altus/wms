import { beforeEach, describe, expect, it, vi } from "vitest";

// The Tracker Bulk Upload server actions with the database, the session and the
// resolved grants MOCKED. No database is touched.
const h = vi.hoisted(() => ({
  caps: new Set<string>(),
  touched: [] as string[],
  inserts: [] as { table: unknown; values: unknown }[],
  latest: null as null | { id: string; fileName: string | null; sheetName: null; fileHash: string | null; periodFrom: null; periodTo: null; uploadedAt: Date; lineCount: number },
  inSnapshot: new Set<string>(),
  master: new Map<string, { id: string; companyName: string; nameKey: string }>(),
  snapSeq: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => ({ id: "emp-1", isActive: true, isAdmin: true }),
  requireAdmin: async () => ({ id: "emp-1", isActive: true, isAdmin: true }),
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
vi.mock("@/lib/db", () => {
  const tx = {
    execute: async () => undefined,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        h.inserts.push({ table, values });
        const rows = [{ id: `00000000-0000-4000-8000-${String(++h.snapSeq).padStart(12, "0")}` }];
        return Object.assign(Promise.resolve(rows), { returning: async () => rows });
      },
    }),
    select: () => {
      h.touched.push("tx.select");
      throw new Error("unexpected select");
    },
    update: () => {
      h.touched.push("tx.update");
      throw new Error("unexpected update");
    },
    delete: () => {
      h.touched.push("tx.delete");
      throw new Error("unexpected delete");
    },
  };
  return { db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), select: () => { throw new Error("direct select"); } } };
});
vi.mock("@/lib/queries/collection-master", () => ({
  isMissingTable: () => false,
  TRACKER_BALANCES_SOURCE: "tracker-balances-upload",
  loadExistingByKeys: async (_q: unknown, keys: string[]) => new Map(keys.filter((k) => h.master.has(k)).map((k) => [k, h.master.get(k)!])),
  loadClientMasterIndex: async () => new Map<string, string[]>(),
}));
vi.mock("@/lib/queries/collection-balances", () => ({
  latestBalanceSnapshot: async () => h.latest,
  companyIdsInSnapshot: async () => h.inSnapshot,
}));

import { addMissingBalanceCompanies, importCollectionBalances, previewCollectionBalances } from "@/app/(forms-module)/forms/collection/tracker/bulk-actions";
import { collectionBalanceLines, collectionBalanceSnapshots } from "@/db/schema";

const company = (id: string, name: string) => h.master.set(name.toLowerCase().replace(/[^a-z0-9]/g, ""), { id, companyName: name, nameKey: name.toLowerCase().replace(/[^a-z0-9]/g, "") });

/** The sheet's raw cells, as the browser sends them. Data rows start at sheet row 5. */
const sheetGrid = (opts: { total?: string[] | null; extra?: string[][] } = {}): string[][] => [
  ["JMT DRIVE SOLUTIONS (from 1-Apr-26)", "", ""],
  ["1-Apr-26 to 19-Oct-26", "", ""],
  ["Particulars", "", ""],
  ["", "Debit", "Credit"],
  ["Alpha Traders", "100", ""],
  ["Beta Works", "200", "50"],
  ["Not In Master", "", ""],
  ...(opts.extra ?? []),
  ...(opts.total === null ? [] : [opts.total ?? ["Grand Total", "300", "50"]]),
];
const file = (over: Record<string, unknown> = {}) => ({ fileName: "Collection 171026.xls", sheetName: "Sundry Debtors", grid: sheetGrid(), ...over });
const expected = { matched: 2, debitPaise: 30_000, creditPaise: 5_000 };
const go = (over: Record<string, unknown> = {}) => importCollectionBalances({ ...file(), previousSnapshotId: null, expected, confirm: true, ...over });
const snapshotValues = () => h.inserts[0]!.values as Record<string, unknown>;
const prev = (over: Record<string, unknown> = {}) => ({
  id: "snap-old",
  fileName: "old.xls",
  sheetName: null,
  fileHash: null as string | null,
  periodFrom: null,
  periodTo: null,
  uploadedAt: new Date("2026-10-01T00:00:00Z"),
  lineCount: 3,
  ...over,
});

beforeEach(() => {
  h.caps = new Set(["collection.balances.import"]);
  h.touched = [];
  h.inserts = [];
  h.latest = null;
  h.inSnapshot = new Set();
  h.master = new Map();
  h.snapSeq = 0;
  company("co-1", "Alpha Traders");
  company("co-2", "Beta Works");
});

describe("permission", () => {
  it("preview and import are refused without collection.balances.import, before anything is read or written", async () => {
    h.caps = new Set(["collection.view", "collection.master.import", "collection.followup.write"]);
    await expect(previewCollectionBalances(file())).rejects.toThrow("Forbidden");
    await expect(go()).rejects.toThrow("Forbidden");
    expect(h.inserts).toHaveLength(0);
  });
});

describe("previewCollectionBalances", () => {
  it("is read-only and reports what the SERVER read: matches, skips, period, title and the replacement", async () => {
    h.latest = prev();
    h.inSnapshot = new Set(["co-1", "co-9"]);
    const r = await previewCollectionBalances(file());
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.summary).toMatchObject({ matched: 2, rejected: 1, unmatched: 0, verification: { status: "ok" } });
    expect(r.preview.report).toEqual({ reportTitle: "JMT DRIVE SOLUTIONS (from 1-Apr-26)", periodFrom: "2026-04-01", periodTo: "2026-10-19" });
    expect(r.preview.replacement.previous).toMatchObject({ id: "snap-old", companies: 2 });
    expect(r.preview.replacement.wouldGoBlank).toBe(1); // co-9 is not in this file
    expect(h.inserts).toHaveLength(0);
  });

  it("the same-sheet warning compares a hash the server computes from the cells — not anything the client says", async () => {
    const first = await previewCollectionBalances(file());
    if (!first.ok) throw new Error(first.error);
    expect(first.preview.replacement.sameFileAsPrevious).toBe(false);
    // A client-sent hash is not read.
    h.latest = prev({ fileHash: "a".repeat(64) });
    const forged = await previewCollectionBalances({ ...file(), fileHash: "a".repeat(64) });
    if (!forged.ok) throw new Error(forged.error);
    expect(forged.preview.replacement.sameFileAsPrevious).toBe(false);
    // The real hash: apply the sheet, then preview it again.
    h.latest = null;
    const done = await go();
    if (!done.ok) throw new Error(done.error);
    h.latest = prev({ fileHash: snapshotValues().fileHash as string });
    const again = await previewCollectionBalances(file());
    if (!again.ok) throw new Error(again.error);
    expect(again.preview.replacement.sameFileAsPrevious).toBe(true);
  });

  it("rejects malformed input and a sheet that isn't the Tally summary", async () => {
    expect((await previewCollectionBalances({ ...file(), grid: [] })).ok).toBe(false);
    expect((await previewCollectionBalances({ ...file(), grid: [[1, 2]] })).ok).toBe(false); // cells must be text
    expect(await previewCollectionBalances({ ...file(), grid: [["Name", "Amount"], ["A", "1"]] })).toMatchObject({ ok: false, error: expect.stringMatching(/Particulars/) });
  });

  it("shows a blocking verification — but still the full preview — when the Grand Total is missing or doesn't add up", async () => {
    const missing = await previewCollectionBalances(file({ grid: sheetGrid({ total: null }) }));
    if (!missing.ok) throw new Error(missing.error);
    expect(missing.preview.summary.verification).toMatchObject({ status: "missing" });
    expect(missing.preview.summary.matched).toBe(2);
    const off = await previewCollectionBalances(file({ grid: sheetGrid({ total: ["Grand Total", "999", "50"] }) }));
    if (!off.ok) throw new Error(off.error);
    expect(off.preview.summary.verification).toMatchObject({ status: "mismatch" });
  });
});

describe("importCollectionBalances", () => {
  it("requires the explicit confirmation", async () => {
    const r = await go({ confirm: undefined });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/confirm/i) });
    expect(h.inserts).toHaveLength(0);
  });

  it("writes ONE snapshot and one line per matched company — nothing else", async () => {
    const r = await go();
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toMatchObject({ written: 2, totals: { debit: 300, credit: 50 }, skipped: { rejected: 1 } });
    expect(h.inserts.map((i) => i.table)).toEqual([collectionBalanceSnapshots, collectionBalanceLines]);
    const lines = h.inserts[1]!.values as { companyId: string; debit: string | null; credit: string | null }[];
    expect(lines.map((l) => [l.companyId, l.debit, l.credit])).toEqual([
      ["co-1", "100.00", null],
      ["co-2", "200.00", "50.00"],
    ]);
    // Never updates or deletes anything (so the Master, follow-ups, commitments etc. are untouched).
    expect(h.touched).toEqual([]);
  });

  it("stores the title, period, source total and hash the SERVER derived — client-sent copies are ignored", async () => {
    const r = await go({
      reportTitle: "FORGED",
      periodFrom: "1999-01-01",
      periodTo: "1999-12-31",
      sourceTotal: { debit: "1", credit: "1" },
      fileHash: "b".repeat(64),
      rows: [{ rowNo: 1, name: "Alpha Traders", debit: "999999", credit: "" }],
    });
    if (!r.ok) throw new Error(r.error);
    expect(snapshotValues()).toMatchObject({
      reportTitle: "JMT DRIVE SOLUTIONS (from 1-Apr-26)",
      periodFrom: "2026-04-01",
      periodTo: "2026-10-19",
      sourceTotalDebit: "300.00",
      sourceTotalCredit: "50.00",
      importedTotalDebit: "300.00",
      importedTotalCredit: "50.00",
    });
    expect(snapshotValues().fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotValues().fileHash).not.toBe("b".repeat(64));
    // The injected 'rows' did not change what was imported.
    expect((h.inserts[1]!.values as { debit: string | null }[]).map((l) => l.debit)).toEqual(["100.00", "200.00"]);
  });

  it("refuses an upload whose rows don't add up to the file's Grand Total, and writes nothing", async () => {
    const r = await go({ grid: sheetGrid({ total: ["Grand Total", "310", "50"] }) });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/don't add up to the file's Grand Total/) });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses an upload with no Grand Total row (completeness can't be checked)", async () => {
    const r = await go({ grid: sheetGrid({ total: null }) });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/no Grand Total/) });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses when a row was dropped after the total was printed", async () => {
    const dropped = sheetGrid();
    dropped.splice(5, 1); // remove Beta Works
    const r = await go({ grid: dropped });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Grand Total/) });
    expect(h.inserts).toHaveLength(0);
  });

  it("allows the documented rounding gap (a few paise) but not more", async () => {
    const within = await go({ grid: sheetGrid({ total: ["Grand Total", "300.01", "50"] }) });
    expect(within.ok).toBe(true); // 1 paisa; the allowed gap for 3 rows is 2 paise
    h.inserts = [];
    const beyond = await go({ grid: sheetGrid({ total: ["Grand Total", "300.05", "50"] }) });
    expect(beyond).toMatchObject({ ok: false });
    expect(h.inserts).toHaveLength(0);
  });

  it("never creates a company: unmatched names are skipped", async () => {
    const grid = sheetGrid({ extra: [["Brand New Co", "9", ""]], total: ["Grand Total", "309", "50"] });
    const r = await go({ grid });
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toMatchObject({ written: 2, skipped: { unmatched: 1 } });
    expect(h.inserts.map((i) => i.table)).toEqual([collectionBalanceSnapshots, collectionBalanceLines]);
  });

  it("a repeated upload is another snapshot with the file's own figures — never added to the previous", async () => {
    const first = await go();
    if (!first.ok) throw new Error(first.error);
    h.latest = prev({ id: first.result.snapshotId, lineCount: 2 });
    h.inserts = [];
    const second = await go({ previousSnapshotId: first.result.snapshotId });
    if (!second.ok) throw new Error(second.error);
    expect(second.result.totals).toEqual({ debit: 300, credit: 50 });
    expect((h.inserts[1]!.values as { debit: string | null }[]).map((l) => l.debit)).toEqual(["100.00", "200.00"]);
  });

  it("refuses when another upload landed since the preview", async () => {
    h.latest = prev({ id: "snap-newer" });
    const r = await go({ previousSnapshotId: null });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Another balance upload/) });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses when the recomputed plan differs from the previewed one", async () => {
    const r = await go({ expected: { matched: 2, debitPaise: 29_999, creditPaise: 5_000 } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/changed since your preview/) });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses an upload where nothing matches the Collection Master", async () => {
    h.master = new Map();
    const r = await go({ expected: { matched: 0, debitPaise: 0, creditPaise: 0 } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to import/) });
    expect(h.inserts).toHaveLength(0);
  });
});

// The real creation path (unique name key, untouched coordinators, repeat requests, Tracker visibility)
// runs against a real Postgres in tests/integration/collection-balances-add-companies.db.test.ts.
// Here: the guards that must hold BEFORE anything is written.
describe("addMissingBalanceCompanies", () => {
  const withNew = () => sheetGrid({ extra: [["Brand New Co", "9", ""]], total: ["Grand Total", "309", "50"] });
  const add = (over: Record<string, unknown> = {}) => addMissingBalanceCompanies({ ...file({ grid: withNew() }), expected: { unmatched: 1 }, confirm: true, ...over });

  it("needs collection.master.import as well as collection.balances.import — refused before anything is read or written", async () => {
    h.caps = new Set(["collection.balances.import"]); // may upload balances, may not create Master companies
    await expect(add()).rejects.toThrow("Forbidden");
    h.caps = new Set(["collection.master.import"]); // may import the Master, may not upload balances
    await expect(add()).rejects.toThrow("Forbidden");
    expect(h.inserts).toHaveLength(0);
    expect(h.touched).toEqual([]);
  });

  it("requires the explicit confirmation", async () => {
    h.caps = new Set(["collection.balances.import", "collection.master.import"]);
    expect(await add({ confirm: undefined })).toMatchObject({ ok: false, error: expect.stringMatching(/confirm/i) });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses when every company is already in the Master, or when the unmatched list changed since the preview — writing nothing", async () => {
    h.caps = new Set(["collection.balances.import", "collection.master.import"]);
    expect(await addMissingBalanceCompanies({ ...file(), expected: { unmatched: 1 }, confirm: true })).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to add/) });
    expect(await add({ expected: { unmatched: 2 } })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since your preview/) });
    expect(h.inserts).toHaveLength(0);
  });

  it("the preview never adds anything, whatever the person may do", async () => {
    h.caps = new Set(["collection.balances.import", "collection.master.import"]);
    const r = await previewCollectionBalances(file({ grid: withNew() }));
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.summary).toMatchObject({ matched: 2, unmatched: 1 });
    expect(h.inserts).toHaveLength(0);
    expect(h.touched).toEqual([]);
  });
});
