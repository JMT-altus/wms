import { beforeEach, describe, expect, it, vi } from "vitest";

// Zero-balance companies and the Collection Tracker: a company whose Debit and
// Credit are both zero in the ACTIVE (latest confirmed) balance snapshot is left
// out of the Tracker's default list — and nothing else. It stays in the
// Collection Master, every other reader still sees it, and the next confirmed
// upload decides again. The Collection Master and balance reads are MOCKED; no
// database is touched and nothing here writes.
const h = vi.hoisted(() => ({
  master: { storageReady: true, rows: [] as Record<string, unknown>[] },
  balances: {
    storageReady: true,
    status: "ok" as "ok" | "not-installed" | "error",
    errorCode: undefined as string | undefined,
    snapshot: null as null | { id: string },
    byCompany: new Map<string, { debit: number | null; credit: number | null }>(),
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/collection-master", () => ({ listAllMasterCompanies: async () => h.master }));
vi.mock("@/lib/queries/collection-balances", () => ({ loadLatestBalances: async () => h.balances }));

import { hiddenZeroBalanceNote, isZeroAmount, isZeroBalanceLine, splitZeroBalance } from "@/lib/collections/balances/visibility";
import { loadCollectionParties } from "@/lib/collections/load";
import { ALL_ZERO_BALANCE_MESSAGE, MASTER_EMPTY_MESSAGE } from "@/lib/collections/source";

const company = (id: string, companyName: string, coordinatorLabel: string | null = "BK") => ({
  id,
  companyName,
  coordinatorLabel,
  paymentTerms: null,
  customerMasterId: null,
  clientMatch: "none",
  updatedAt: new Date(),
});

/** What the loader holds after a confirmed upload: Postgres numeric text read with Number(), as loadLatestBalances does. */
const snapshot = (id: string, lines: Record<string, [string | null, string | null]>) => ({
  storageReady: true,
  status: "ok" as const,
  errorCode: undefined,
  snapshot: { id },
  byCompany: new Map(Object.entries(lines).map(([c, [d, cr]]) => [c, { debit: d === null ? null : Number(d), credit: cr === null ? null : Number(cr) }])),
});

const tracker = () => loadCollectionParties({ hideZeroBalance: true });
const names = (s: { parties: { partyName: string }[] }) => s.parties.map((p) => p.partyName);

beforeEach(() => {
  h.master = { storageReady: true, rows: [company("abc", "ABC Ltd"), company("xyz", "XYZ Ltd"), company("pqr", "PQR Ltd"), company("lmn", "LMN Ltd"), company("def", "DEF Ltd")] };
  h.balances = { storageReady: true, status: "ok", errorCode: undefined, snapshot: null, byCompany: new Map() };
});

describe("isZeroAmount — paise precision, no floating-point surprises", () => {
  it("0, 0.00 and -0.00 are zero", () => {
    for (const text of ["0", "0.00", "-0.00", "-0"]) expect(isZeroAmount(Number(text)), text).toBe(true);
    expect(isZeroAmount(0)).toBe(true);
    expect(isZeroAmount(-0)).toBe(true);
  });
  it("anything that rounds to ₹0.00 is zero; a single paisa is not", () => {
    expect(isZeroAmount(0.004)).toBe(true);
    expect(isZeroAmount(1e-9)).toBe(true);
    expect(isZeroAmount(0.01)).toBe(false);
    expect(isZeroAmount(-0.01)).toBe(false);
    expect(isZeroAmount(0.1 + 0.2 - 0.3)).toBe(true); // binary noise around zero
  });
  it("non-zero and negative amounts are not zero; a blank cell is zero on its side", () => {
    expect(isZeroAmount(5000)).toBe(false);
    expect(isZeroAmount(-2000)).toBe(false);
    expect(isZeroAmount(null)).toBe(true);
    expect(isZeroAmount(Number.NaN)).toBe(false);
  });
});

describe("isZeroBalanceLine — only a line that IS zero on both sides", () => {
  it("both zero → zero-balance; either side non-zero → not", () => {
    expect(isZeroBalanceLine({ debit: 0, credit: 0 })).toBe(true);
    expect(isZeroBalanceLine({ debit: 0, credit: null })).toBe(true); // Tally leaves the other column blank
    expect(isZeroBalanceLine({ debit: null, credit: -0 })).toBe(true);
    expect(isZeroBalanceLine({ debit: 5000, credit: 0 })).toBe(false);
    expect(isZeroBalanceLine({ debit: 0, credit: 3000 })).toBe(false);
    expect(isZeroBalanceLine({ debit: 400, credit: 600 })).toBe(false);
    expect(isZeroBalanceLine({ debit: -0.01, credit: 0 })).toBe(false);
  });
  it("no line at all (missing balance data) is never zero-balance", () => {
    expect(isZeroBalanceLine(undefined)).toBe(false);
  });
  it("splitZeroBalance keeps order and leaves unflagged parties visible", () => {
    const { visible, hidden } = splitZeroBalance([{ n: 1, zeroBalance: false }, { n: 2, zeroBalance: true }, { n: 3 }, { n: 4, zeroBalance: true }]);
    expect(visible.map((p) => p.n)).toEqual([1, 3]);
    expect(hidden.map((p) => p.n)).toEqual([2, 4]);
  });
  it("the note names the count and says they stay in the Master; none when nothing is hidden", () => {
    expect(hiddenZeroBalanceNote(0)).toBeNull();
    expect(hiddenZeroBalanceNote(1)).toMatch(/^1 company with ₹0 Debit and ₹0 Credit .* isn't listed\. It stays in the Collection Master/);
    expect(hiddenZeroBalanceNote(3)).toMatch(/^3 companies .* aren't listed\. They stay in the Collection Master/);
  });
});

describe("the Tracker's list, from the active snapshot", () => {
  it("hides only the companies whose Debit AND Credit are both zero; either side non-zero stays visible", async () => {
    h.balances = snapshot("s1", { abc: ["5000.00", "0.00"], xyz: ["0.00", "3000.00"], pqr: ["0.00", "0.00"], lmn: ["-0.00", "0"], def: ["400.00", "600.00"] });
    const s = await tracker();
    expect(names(s)).toEqual(["ABC Ltd", "XYZ Ltd", "DEF Ltd"]);
    expect(s.hiddenZeroBalance).toBe(2);
    expect(s.connected).toBe(true);
    // The figures themselves are untouched — shown exactly as uploaded.
    expect(s.parties.find((p) => p.masterId === "abc")).toMatchObject({ debit: 5000, credit: 0, zeroBalance: false });
  });

  it("a company with no line in the snapshot (missing data) is not hidden, with or without an upload", async () => {
    expect(names(await tracker())).toHaveLength(5); // no upload yet
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"] }); // the others are not in the file
    const s = await tracker();
    expect(names(s)).toEqual(["XYZ Ltd", "PQR Ltd", "LMN Ltd", "DEF Ltd"]);
    expect(s.parties.every((p) => p.debit === null && p.credit === null && p.zeroBalance === false)).toBe(true);
  });

  it("when the balances can't be read (not installed, or a permission problem) nobody is hidden and the problem is still reported", async () => {
    h.balances = { storageReady: false, status: "not-installed", errorCode: undefined, snapshot: null, byCompany: new Map() };
    expect(names(await tracker())).toHaveLength(5);
    h.balances = { storageReady: false, status: "error", errorCode: "42501", snapshot: null, byCompany: new Map() };
    const s = await tracker();
    expect(names(s)).toHaveLength(5);
    expect(s.hiddenZeroBalance).toBe(0);
    expect(s.balances).toEqual({ status: "error", errorCode: "42501" });
  });

  it("visibility follows the CONFIRMED snapshot: a hidden company reappears when a new upload gives it a balance, and vice versa", async () => {
    // Before: the previous confirmed upload.
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], xyz: ["0.00", "0.00"], pqr: ["2000.00", "0.00"], lmn: ["0.00", "0.00"], def: ["500.00", "700.00"] });
    expect(names(await tracker())).toEqual(["PQR Ltd", "DEF Ltd"]);
    // A preview of the next file writes nothing, so the list is unchanged until it is confirmed.
    expect(names(await tracker())).toEqual(["PQR Ltd", "DEF Ltd"]);
    // After: the new file is confirmed and becomes the active snapshot — the same company records, re-evaluated.
    h.balances = snapshot("s2", { abc: ["5000.00", "0.00"], xyz: ["0.00", "3000.00"], pqr: ["0.00", "0.00"], lmn: ["0.00", "0.00"], def: ["400.00", "600.00"] });
    const after = await tracker();
    expect(names(after)).toEqual(["ABC Ltd", "XYZ Ltd", "DEF Ltd"]);
    expect(after.hiddenZeroBalance).toBe(2);
    // The hidden ones are the very same Collection Master records (same ids), with their coordinator intact.
    expect(h.master.rows.map((r) => r.id)).toEqual(["abc", "xyz", "pqr", "lmn", "def"]);
    const all = await loadCollectionParties();
    expect(all.parties.find((p) => p.masterId === "pqr")).toMatchObject({ partyName: "PQR Ltd", collectionPerson: "BK", zeroBalance: true });
  });

  it("when every company is zero-balance the list is empty and says why — not that the Master is empty", async () => {
    h.master.rows = [company("abc", "ABC Ltd"), company("xyz", "XYZ Ltd")];
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], xyz: ["0", null] });
    const s = await tracker();
    expect(s.parties).toEqual([]);
    expect(s.connected).toBe(false);
    expect(s.message).toBe(ALL_ZERO_BALANCE_MESSAGE);
    expect(s.hiddenZeroBalance).toBe(2);
    h.master.rows = [];
    expect((await tracker()).message).toBe(MASTER_EMPTY_MESSAGE);
  });

  it("every other reader (the default call) still gets every company, flagged but not removed", async () => {
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], def: ["400.00", "600.00"] });
    const s = await loadCollectionParties();
    expect(names(s)).toHaveLength(5);
    expect(s.parties.map((p) => p.zeroBalance)).toEqual([true, false, false, false, false]);
    expect(s.hiddenZeroBalance).toBeUndefined();
  });
});
