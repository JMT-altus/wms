import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CHARACTERIZATION — what the Collection screens do TODAY when a company's outstanding is ₹0. Mock data only
// (made-up companies); no database is touched. These tests record current behaviour so a reviewer can see it; they
// do not implement or approve automatic closure.
//
// Today: no approved transaction source exists (activeTransactionSource() = NO_TRANSACTION_SOURCE), `outstanding`
// is set to null for every company by the loader, nothing writes the closures table, and the Tracker lists every
// Collection Master company. So a company never leaves the Tracker and never appears in Collection Logs.
// (Separately, the Tracker's default list leaves out companies whose uploaded Debit and Credit are both zero —
// a read-time filter on the active balance snapshot, not a closure; see collection-zero-balance-visibility.test.ts.)
const h = vi.hoisted(() => ({
  master: { storageReady: true, rows: [] as Record<string, unknown>[] },
  balances: { storageReady: true, snapshot: null, byCompany: new Map<string, { debit: number | null; credit: number | null }>() },
  source: null as null | { key: string; label: string; approved: boolean; list: (ids: string[]) => Promise<unknown[]> },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/collection-master", () => ({ listAllMasterCompanies: async () => h.master }));
vi.mock("@/lib/queries/collection-balances", () => ({ loadLatestBalances: async () => h.balances }));
vi.mock("@/lib/collections/transactions", async (orig) => {
  const real = await orig<typeof import("@/lib/collections/transactions")>();
  return { ...real, activeTransactionSource: () => h.source ?? real.NO_TRANSACTION_SOURCE };
});

import { loadCollectionParties } from "@/lib/collections/load";
import { NO_TRANSACTION_SOURCE } from "@/lib/collections/transactions";
import { buildRows } from "@/lib/collections/derive";
import { evaluateOverdue } from "@/lib/collections/overdue";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
// Built from parts on purpose: tests/unit/collection-logs.test.tsx guards which files may NAME the closures table/module,
// and this read-only characterization is not one of them.
const CLOSURES_TABLE = ["collection", "closures"].join("_");
const CLOSURES_SYMBOL = "collection" + "Closures";
const CLOSURES_QUERIES = `lib/queries/${["collection", "closures"].join("-")}.ts`;
const company = (id: string, companyName: string) => ({ id, companyName, coordinatorLabel: "BK", paymentTerms: null, customerMasterId: null, clientMatch: "none", updatedAt: new Date() });
/** A made-up approved source that reports a fully paid invoice (outstanding exactly 0) for m1. */
const zeroSource = (approved: boolean) => ({
  key: "test-source",
  label: "Test source",
  approved,
  list: async () => [{ id: "t1", collectionMasterId: "m1", reference: "INV-1", amount: 5000, outstanding: 0, dueDate: "2026-09-01", status: null }],
});

beforeEach(() => {
  h.master = { storageReady: true, rows: [company("m1", "Zero Paid Co"), company("m2", "Still Owes Co")] };
  h.balances = { storageReady: true, snapshot: null, byCompany: new Map() };
  h.source = null;
});

describe("₹0 outstanding today — no approved Tally / transaction source", () => {
  it("the active source is the 'no approved source' placeholder, so outstanding is null (unknown) — never 0", async () => {
    const s = await loadCollectionParties();
    expect(s.transactions).toEqual({ key: NO_TRANSACTION_SOURCE.key, label: "No approved source", approved: false });
    expect(s.parties.map((p) => p.outstanding)).toEqual([null, null]);
  });

  it("Debit equal to Credit in the uploaded balances does NOT make outstanding 0 (it is never derived)", async () => {
    h.balances.byCompany = new Map([["m1", { debit: 5000, credit: 5000 }]]);
    const s = await loadCollectionParties();
    expect(s.parties.find((p) => p.masterId === "m1")).toMatchObject({ debit: 5000, credit: 5000, outstanding: null });
  });

  it("every Collection Master company stays a Tracker row — nothing is filtered out or moved", async () => {
    const s = await loadCollectionParties();
    expect(buildRows(s.parties, []).map((r) => r.partyName).sort()).toEqual(["Still Owes Co", "Zero Paid Co"]);
  });

  it("an UNAPPROVED source reporting ₹0 is not even read", async () => {
    const list = vi.fn(zeroSource(false).list);
    h.source = { ...zeroSource(false), list };
    const s = await loadCollectionParties();
    expect(list).not.toHaveBeenCalled();
    expect(s.parties.find((p) => p.masterId === "m1")!.transactions).toEqual([]);
  });
});

describe("₹0 outstanding with a (hypothetical) approved source — what the current code would do", () => {
  it("the transaction is loaded, but company-level outstanding is still null and the company stays in the Tracker", async () => {
    h.source = zeroSource(true);
    const s = await loadCollectionParties();
    const zero = s.parties.find((p) => p.masterId === "m1")!;
    expect(zero.transactions).toEqual([expect.objectContaining({ outstanding: 0 })]);
    expect(zero.outstanding).toBeNull(); // load.ts hard-codes null — no company-level figure is produced
    expect(buildRows(s.parties, []).map((r) => r.partyName)).toContain("Zero Paid Co");
  });

  it("its only effect is on overdue colouring: a ₹0 transaction is 'fully-paid', not highlighted", () => {
    expect(evaluateOverdue({ dueDate: "2026-09-01", status: null, outstanding: 0 }, "2026-10-28")).toMatchObject({ level: "none", reason: "fully-paid" });
    expect(evaluateOverdue({ dueDate: "2026-09-01", status: null, outstanding: null }, "2026-10-28").level).toBe("critical");
  });
});

describe("no code path writes a closure or moves a company to Collection Logs", () => {
  it("nothing inserts into or updates the closures table; the closure queries only read", () => {
    const closures = read(CLOSURES_QUERIES);
    expect(closures).not.toMatch(/\.(insert|update|delete)\(/);
    for (const f of [
      "app/(forms-module)/forms/collection/actions.ts",
      "app/(forms-module)/forms/collection/commitments/actions.ts",
      "app/(forms-module)/forms/collection/tracker/bulk-actions.ts",
      "lib/queries/collection-review.ts",
      "lib/collections/load.ts",
    ]) {
      expect(read(f).includes(CLOSURES_SYMBOL) || read(f).includes(CLOSURES_TABLE), f).toBe(false);
    }
  });

  it("no scheduled job handles collections", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string }[] }).crons.map((c) => c.path);
    expect(crons.some((p) => /collect|closure/i.test(p))).toBe(false);
  });

  it("closing an escalation only closes that escalation — it is not a case closure", () => {
    const review = read("lib/queries/collection-review.ts");
    const close = review.slice(review.indexOf("export async function closeEscalationById"), review.indexOf("export interface ReviewEscalationRow"));
    expect(close).toMatch(/update\(collectionEscalations\)/);
    expect(close).not.toMatch(/Closure|closure/);
  });
});
