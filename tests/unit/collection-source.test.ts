import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MASTER_EMPTY_MESSAGE, MASTER_NOT_READY_MESSAGE } from "@/lib/collections/source";

const h = vi.hoisted(() => ({
  master: { storageReady: true, rows: [] as Record<string, unknown>[] },
  balances: { storageReady: true, snapshot: null, byCompany: new Map<string, { debit: number | null; credit: number | null }>() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/collection-master", () => ({ listAllMasterCompanies: async () => h.master }));
vi.mock("@/lib/queries/collection-balances", () => ({ loadLatestBalances: async () => h.balances }));

import { loadCollectionParties } from "@/lib/collections/load";
import { activeTransactionSource, NO_TRANSACTION_SOURCE } from "@/lib/collections/transactions";

const company = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  companyName: "Alpha Traders",
  coordinatorLabel: "BK",
  paymentTerms: null,
  customerMasterId: null,
  clientMatch: "none",
  updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  h.master = { storageReady: true, rows: [] };
  h.balances = { storageReady: true, snapshot: null, byCompany: new Map() };
});

describe("transaction source", () => {
  it("defaults to no approved source, which returns nothing", async () => {
    const s = activeTransactionSource();
    expect(s).toBe(NO_TRANSACTION_SOURCE);
    expect(s.approved).toBe(false);
    expect(await s.list(["m1"])).toEqual([]);
  });

  it("is not wired to the incentive demo data or the Outstanding module", () => {
    for (const f of ["lib/collections/transactions.ts", "lib/collections/load.ts"]) {
      const src = readFileSync(resolve(__dirname, "../..", f), "utf8");
      expect(src).not.toMatch(/incentive|outstanding_|outstandingEntries|receipts|invoices/i);
    }
  });
});

describe("loadCollectionParties", () => {
  it("lists companies from the Collection Master with no invented figures", async () => {
    h.master.rows = [company(), company({ id: "m2", companyName: "Beta", coordinatorLabel: null, customerMasterId: "c1", paymentTerms: "30 days" })];
    const s = await loadCollectionParties();
    expect(s.connected).toBe(true);
    expect(s.transactions).toEqual({ key: "none", label: "No approved source", approved: false });
    expect(s.parties).toEqual([
      expect.objectContaining({ partyName: "Alpha Traders", masterId: "m1", coordinatorLabel: "BK", paymentTerms: null, clientMasterLinked: false, transactions: [] }),
      expect.objectContaining({ partyName: "Beta", masterId: "m2", coordinatorLabel: null, paymentTerms: "30 days", clientMasterLinked: true, transactions: [] }),
    ]);
    for (const p of s.parties) {
      expect([p.debit, p.credit, p.outstanding]).toEqual([null, null, null]);
    }
    // The collection person is the Sales Coordinator the master holds (null = unassigned).
    expect(s.parties.map((p) => p.collectionPerson)).toEqual(["BK", null]);
  });

  it("fills Debit and Credit from the latest balance snapshot only; a company missing from it stays blank; outstanding is never derived", async () => {
    h.master.rows = [company(), company({ id: "m2", companyName: "Beta" }), company({ id: "m3", companyName: "Gamma" })];
    h.balances.byCompany = new Map([
      ["m1", { debit: 100, credit: 25 }],
      ["m2", { debit: null, credit: 40 }],
    ]);
    const s = await loadCollectionParties();
    expect(s.parties.map((p) => [p.partyName, p.debit, p.credit, p.outstanding])).toEqual([
      ["Alpha Traders", 100, 25, null],
      ["Beta", null, 40, null],
      ["Gamma", null, null, null],
    ]);
    for (const p of s.parties) expect(p.transactions).toEqual([]); // no invoices, due dates or statuses
  });

  it("an empty master says so", async () => {
    const s = await loadCollectionParties();
    expect(s).toMatchObject({ connected: false, parties: [], message: MASTER_EMPTY_MESSAGE, masterReady: true });
  });

  it("missing storage says so instead of failing", async () => {
    h.master = { storageReady: false, rows: [] };
    const s = await loadCollectionParties();
    expect(s).toMatchObject({ connected: false, parties: [], message: MASTER_NOT_READY_MESSAGE, masterReady: false });
  });
});
