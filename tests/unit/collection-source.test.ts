import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MASTER_EMPTY_MESSAGE, MASTER_NOT_READY_MESSAGE } from "@/lib/collections/source";

const h = vi.hoisted(() => ({ master: { storageReady: true, rows: [] as Record<string, unknown>[] } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/collection-master", () => ({ listAllMasterCompanies: async () => h.master }));

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
