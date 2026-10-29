import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// loadLatestBalances: an unavailable balance table must not take the Tracker
// down, a genuine permission / configuration error must stay visible, and any
// other database error must still throw. The database is MOCKED.
const h = vi.hoisted(() => ({
  fail: null as unknown,
  snapshot: null as null | Record<string, unknown>,
  lines: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/collection-master", () => ({
  isMissingTable: (err: unknown) => {
    const e = err as { code?: string; cause?: { code?: string } } | null;
    return e?.code === "42P01" || e?.cause?.code === "42P01";
  },
}));
vi.mock("@/lib/db", () => {
  // select().from().orderBy().limit() → the newest snapshot;  select().from().where() → its lines.
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.orderBy = () => c;
    c.limit = async () => {
      if (h.fail) throw h.fail;
      return h.snapshot ? [h.snapshot] : [];
    };
    c.where = async () => {
      if (h.fail) throw h.fail;
      return h.lines;
    };
    return c;
  };
  return { db: { select: () => chain() } };
});

import { loadLatestBalances } from "@/lib/queries/collection-balances";

const pgError = (code: string, message = "boom") => Object.assign(new Error(message), { code });
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.fail = null;
  h.snapshot = null;
  h.lines = [];
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe("loadLatestBalances", () => {
  it("reads the latest snapshot's lines", async () => {
    h.snapshot = { id: "s1", fileName: "a.xls", sheetName: null, fileHash: null, periodFrom: null, periodTo: null, uploadedAt: new Date(), totals: { matched: 1 } };
    h.lines = [{ companyId: "c1", debit: "100.00", credit: null }];
    const r = await loadLatestBalances();
    expect(r).toMatchObject({ storageReady: true, status: "ok" });
    expect(r.byCompany.get("c1")).toEqual({ debit: 100, credit: null });
  });

  it("no snapshot yet is simply empty", async () => {
    expect(await loadLatestBalances()).toMatchObject({ storageReady: true, status: "ok", snapshot: null });
  });

  it("tables not installed (42P01, also when wrapped) → 'not-installed', empty, not logged as a problem", async () => {
    h.fail = pgError("42P01");
    expect(await loadLatestBalances()).toMatchObject({ storageReady: false, status: "not-installed" });
    h.fail = Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
    expect(await loadLatestBalances()).toMatchObject({ status: "not-installed" });
    expect(logged).not.toHaveBeenCalled();
  });

  it("a permission or configuration error → 'error' with its code, empty, and LOGGED — never silent", async () => {
    h.fail = pgError("42501", "permission denied for table collection_balance_snapshots");
    const r = await loadLatestBalances();
    expect(r).toMatchObject({ storageReady: false, status: "error", errorCode: "42501" });
    expect(r.byCompany.size).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    h.fail = Object.assign(new Error("Failed query"), { cause: { code: "42703" } });
    expect(await loadLatestBalances()).toMatchObject({ status: "error", errorCode: "42703" });
  });

  it("any other database error still throws (connection loss, timeout, bugs are not swallowed)", async () => {
    for (const code of ["57014", "08006", "53300", "23505"]) {
      h.fail = pgError(code);
      await expect(loadLatestBalances()).rejects.toThrow("boom");
    }
    h.fail = new Error("some non-database failure");
    await expect(loadLatestBalances()).rejects.toThrow("some non-database failure");
  });
});
