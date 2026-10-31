import { beforeEach, describe, expect, it, vi } from "vitest";

// Empty-balance companies and the Collection Tracker: a company the confirmed
// uploads give no amount on either side — its most recent line is ₹0 / ₹0, or
// it has no line in any upload (shown as — / —) — is flagged `zeroBalance` by
// the loader — never left out — and the Tracker shows it last and muted. It
// stays in the Collection Master, every reader still sees it, and the next
// confirmed upload that includes it decides again. While NO upload has been
// confirmed, or the balances can't be read, nobody is flagged. The Collection
// Master and balance reads are MOCKED; no database is touched and nothing here writes.
const h = vi.hoisted(() => ({
  master: { storageReady: true, rows: [] as Record<string, unknown>[] },
  balances: {
    storageReady: true,
    status: "ok" as "ok" | "not-installed" | "error",
    errorCode: undefined as string | undefined,
    snapshot: null as null | { id: string },
    byCompany: new Map<string, { debit: number | null; credit: number | null }>(),
    latestLineByCompany: new Map<string, { debit: number | null; credit: number | null }>(),
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/collection-master", () => ({ listAllMasterCompanies: async () => h.master }));
vi.mock("@/lib/queries/collection-balances", () => ({ loadLatestBalances: async () => h.balances }));

import { isEmptyBalance, isZeroAmount, isZeroBalanceLine, orderZeroBalanceLast, zeroBalanceNote } from "@/lib/collections/balances/visibility";
import { loadCollectionParties } from "@/lib/collections/load";
import { MASTER_EMPTY_MESSAGE } from "@/lib/collections/source";

const company = (id: string, companyName: string, coordinatorLabel: string | null = "BK") => ({
  id,
  companyName,
  coordinatorLabel,
  paymentTerms: null,
  customerMasterId: null,
  clientMatch: "none",
  updatedAt: new Date(),
});

/**
 * What the loader holds after a confirmed upload: Postgres numeric text read with Number(), as loadLatestBalances does.
 * `earlier` = lines of companies NOT in this file whose most recent line is in an older snapshot (the look-back).
 */
type Lines = Record<string, [string | null, string | null]>;
const toMap = (lines: Lines) => new Map(Object.entries(lines).map(([c, [d, cr]]) => [c, { debit: d === null ? null : Number(d), credit: cr === null ? null : Number(cr) }]));
const snapshot = (id: string, lines: Lines, earlier: Lines = {}) => ({
  storageReady: true,
  status: "ok" as const,
  errorCode: undefined,
  snapshot: { id },
  byCompany: toMap(lines),
  latestLineByCompany: toMap({ ...earlier, ...lines }),
});

const load = () => loadCollectionParties({ kind: "all" });
/** The Tracker's order: normal first, zero-balance last — what the table pages through. */
const order = (s: { parties: { partyName: string; zeroBalance?: boolean }[] }) => orderZeroBalanceLast(s.parties).map((p) => `${p.partyName}${p.zeroBalance ? " (₹0)" : ""}`);
const zeros = (s: { parties: { partyName: string; zeroBalance?: boolean }[] }) => s.parties.filter((p) => p.zeroBalance).map((p) => p.partyName);

beforeEach(() => {
  h.master = { storageReady: true, rows: [company("abc", "ABC Ltd"), company("xyz", "XYZ Ltd"), company("pqr", "PQR Ltd"), company("lmn", "LMN Ltd"), company("def", "DEF Ltd")] };
  h.balances = { storageReady: true, status: "ok", errorCode: undefined, snapshot: null, byCompany: new Map(), latestLineByCompany: new Map() };
});

describe("isZeroAmount — paise precision, no floating-point surprises", () => {
  it("0, 0.00 and -0.00 are zero", () => {
    for (const text of ["0", "0.00", "-0.00", "-0"]) expect(isZeroAmount(Number(text)), text).toBe(true);
    expect(isZeroAmount(0)).toBe(true);
    expect(isZeroAmount(-0)).toBe(true);
  });
  it("anything that rounds to ₹0.00 is zero; a single paisa is not", () => {
    expect(isZeroAmount(0.001)).toBe(true);
    expect(isZeroAmount(0.004)).toBe(true);
    expect(isZeroAmount(0.01)).toBe(false);
    expect(isZeroAmount(-0.01)).toBe(false);
    expect(isZeroAmount(0.1 + 0.2 - 0.3)).toBe(true); // 5.55e-17 is ₹0.00
  });
  it("non-zero and negative amounts are not zero; a blank cell is zero on its side", () => {
    expect(isZeroAmount(5000)).toBe(false);
    expect(isZeroAmount(-10)).toBe(false);
    expect(isZeroAmount(Number.NaN)).toBe(false);
    expect(isZeroAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isZeroAmount(null)).toBe(true);
  });
});

describe("isZeroBalanceLine — only a line that IS zero on both sides", () => {
  it("both zero → zero-balance; either side non-zero → not", () => {
    expect(isZeroBalanceLine({ debit: 0, credit: 0 })).toBe(true);
    expect(isZeroBalanceLine({ debit: 0, credit: null })).toBe(true);
    expect(isZeroBalanceLine({ debit: null, credit: -0 })).toBe(true);
    expect(isZeroBalanceLine({ debit: 5000, credit: 0 })).toBe(false);
    expect(isZeroBalanceLine({ debit: 0, credit: 3000 })).toBe(false);
    expect(isZeroBalanceLine({ debit: -10, credit: 0 })).toBe(false);
    expect(isZeroBalanceLine({ debit: 0.01, credit: 0 })).toBe(false);
  });
  it("no line at all (missing data) is never a ZERO line; isEmptyBalance decides what no line means", () => {
    expect(isZeroBalanceLine(undefined)).toBe(false);
    // With a confirmed upload read: no line = no amount on either side = empty, exactly like ₹0 / ₹0.
    expect(isEmptyBalance(undefined, true)).toBe(true);
    expect(isEmptyBalance({ debit: 0, credit: null }, true)).toBe(true);
    expect(isEmptyBalance({ debit: 5000, credit: null }, true)).toBe(false);
    expect(isEmptyBalance({ debit: null, credit: 0.01 }, true)).toBe(false);
    expect(isEmptyBalance({ debit: -10, credit: 0 }, true)).toBe(false);
    // Without one (no upload yet, tables missing, read failed): nothing is empty — an unavailable source is not a zero.
    expect(isEmptyBalance(undefined, false)).toBe(false);
    expect(isEmptyBalance({ debit: 0, credit: 0 }, false)).toBe(false);
  });
  it("orderZeroBalanceLast keeps each group's order, puts the zero-balance ones last, and drops nothing", () => {
    const rows = [{ n: 1, zeroBalance: true }, { n: 2 }, { n: 3, zeroBalance: false }, { n: 4, zeroBalance: true }, { n: 5 }];
    expect(orderZeroBalanceLast(rows).map((r) => r.n)).toEqual([2, 3, 5, 1, 4]);
    expect(orderZeroBalanceLast([])).toEqual([]);
  });
  it("the note names the count, says they are shown last and stay in the Master; none when nothing is zero-balance", () => {
    expect(zeroBalanceNote(0)).toBeNull();
    expect(zeroBalanceNote(1)).toMatch(/^1 company with no Debit or Credit in the confirmed uploads is shown last, muted\. It stays in the Collection Master/);
    expect(zeroBalanceNote(3)).toMatch(/^3 companies .* are shown last, muted\. They stay in the Collection Master .* return to the list when an upload gives them a balance\.$/);
  });
});

describe("the Tracker's list, from the confirmed uploads", () => {
  it("flags only the companies whose Debit AND Credit are both zero; either side non-zero stays normal; every company is returned", async () => {
    h.balances = snapshot("s1", { abc: ["5000.00", "0.00"], xyz: ["0.00", "3000.00"], pqr: ["0.00", "0.00"], lmn: ["-0.00", "0"], def: ["-400.00", "600.00"] });
    const s = await load();
    expect(s.parties).toHaveLength(5);
    expect(zeros(s)).toEqual(["PQR Ltd", "LMN Ltd"]);
    expect(order(s)).toEqual(["ABC Ltd", "XYZ Ltd", "DEF Ltd", "PQR Ltd (₹0)", "LMN Ltd (₹0)"]);
    expect(s.connected).toBe(true);
    // The figures themselves are untouched — shown exactly as uploaded; negatives are non-zero.
    expect(s.parties.find((p) => p.masterId === "abc")).toMatchObject({ debit: 5000, credit: 0, zeroBalance: false });
    expect(s.parties.find((p) => p.masterId === "def")).toMatchObject({ debit: -400, credit: 600, zeroBalance: false });
  });

  it("with no upload yet, nobody is empty-balance (— / — means the source is unavailable, not zero)", async () => {
    const s = await load();
    expect(zeros(s)).toEqual([]);
    expect(s.parties.every((p) => p.debit === null && p.credit === null && p.zeroBalance === false)).toBe(true);
  });

  it("once an upload is confirmed, a company with no line in any upload (— / — on screen) is empty-balance, exactly like ₹0 / ₹0", async () => {
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], def: ["400.00", "600.00"] }); // the others are not in the file
    const s = await load();
    expect(zeros(s)).toEqual(["ABC Ltd", "XYZ Ltd", "PQR Ltd", "LMN Ltd"]);
    expect(order(s)).toEqual(["DEF Ltd", "ABC Ltd (₹0)", "XYZ Ltd (₹0)", "PQR Ltd (₹0)", "LMN Ltd (₹0)"]);
    expect(s.parties.find((p) => p.masterId === "xyz")).toMatchObject({ debit: null, credit: null, zeroBalance: true }); // shown as — / —, muted
    expect(s.parties.find((p) => p.masterId === "abc")).toMatchObject({ debit: 0, credit: 0, zeroBalance: true });
  });

  it("when the balances can't be read (not installed, or a permission problem) nobody is empty-balance and the problem is still reported", async () => {
    h.balances = { storageReady: false, status: "not-installed", errorCode: undefined, snapshot: null, byCompany: new Map(), latestLineByCompany: new Map() };
    expect(zeros(await load())).toEqual([]);
    h.balances = { storageReady: false, status: "error", errorCode: "42501", snapshot: null, byCompany: new Map(), latestLineByCompany: new Map() };
    const s = await load();
    expect(s.parties).toHaveLength(5);
    expect(zeros(s)).toEqual([]);
    expect(s.balances).toEqual({ status: "error", errorCode: "42501" });
  });

  it("the state follows the CONFIRMED upload: a zero-balance company returns to the normal list when a new upload gives it a balance, and vice versa", async () => {
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], xyz: ["0.00", "0.00"], pqr: ["2000.00", "0.00"], lmn: ["0.00", "0.00"], def: ["500.00", "700.00"] });
    expect(order(await load())).toEqual(["PQR Ltd", "DEF Ltd", "ABC Ltd (₹0)", "XYZ Ltd (₹0)", "LMN Ltd (₹0)"]);
    // A preview of the next file writes nothing, so the list is unchanged until it is confirmed.
    expect(order(await load())).toEqual(["PQR Ltd", "DEF Ltd", "ABC Ltd (₹0)", "XYZ Ltd (₹0)", "LMN Ltd (₹0)"]);
    h.balances = snapshot("s2", { abc: ["5000.00", "0.00"], xyz: ["0.00", "3000.00"], pqr: ["0.00", "0.00"], lmn: ["0.00", "0.00"], def: ["400.00", "600.00"] });
    const after = await load();
    expect(order(after)).toEqual(["ABC Ltd", "XYZ Ltd", "DEF Ltd", "PQR Ltd (₹0)", "LMN Ltd (₹0)"]);
    // The same Collection Master records (same ids), with their coordinator intact.
    expect(h.master.rows.map((r) => r.id)).toEqual(["abc", "xyz", "pqr", "lmn", "def"]);
    expect(after.parties.find((p) => p.masterId === "pqr")).toMatchObject({ partyName: "PQR Ltd", collectionPerson: "BK", zeroBalance: true });
  });

  it("a company a later file leaves out keeps its previous state: zero-balance stays so, normal stays normal, figures blank", async () => {
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], xyz: ["0.00", "0.00"], pqr: ["2000.00", "0.00"], lmn: ["0.00", "5000.00"], def: ["500.00", "700.00"] });
    expect(zeros(await load())).toEqual(["ABC Ltd", "XYZ Ltd"]);
    h.balances = snapshot("s2", { def: ["1.00", "0.00"], xyz: ["0.00", "9.00"] }, { abc: ["0.00", "0.00"], pqr: ["2000.00", "0.00"], lmn: ["0.00", "5000.00"] });
    const s = await load();
    expect(order(s)).toEqual(["XYZ Ltd", "PQR Ltd", "LMN Ltd", "DEF Ltd", "ABC Ltd (₹0)"]);
    expect(s.parties.find((p) => p.masterId === "pqr")).toMatchObject({ debit: null, credit: null, zeroBalance: false }); // figures are never carried forward
    expect(s.parties.find((p) => p.masterId === "xyz")).toMatchObject({ debit: 0, credit: 9, zeroBalance: false });
    h.balances = snapshot("s3", { abc: ["0.00", "5000.00"] }, { xyz: ["0.00", "9.00"], pqr: ["2000.00", "0.00"], lmn: ["0.00", "5000.00"], def: ["1.00", "0.00"] });
    expect(zeros(await load())).toEqual([]);
  });

  it("when every company is zero-balance they are all still listed (last and muted); an empty Master says so", async () => {
    h.master.rows = [company("abc", "ABC Ltd"), company("xyz", "XYZ Ltd")];
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], xyz: ["0", null] });
    const s = await load();
    expect(order(s)).toEqual(["ABC Ltd (₹0)", "XYZ Ltd (₹0)"]);
    expect(s.connected).toBe(true);
    expect(s.message).toBeUndefined();
    h.master.rows = [];
    expect((await load()).message).toBe(MASTER_EMPTY_MESSAGE);
  });

  it("every reader gets every company, flagged but not removed", async () => {
    h.balances = snapshot("s1", { abc: ["0.00", "0.00"], def: ["400.00", "600.00"] });
    const s = await load();
    expect(s.parties).toHaveLength(5);
    expect(s.parties.map((p) => p.zeroBalance)).toEqual([true, true, true, true, false]); // abc ₹0/₹0; xyz, pqr, lmn never in a file
  });
});
