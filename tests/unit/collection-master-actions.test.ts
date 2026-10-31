import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExistingCompany } from "@/lib/collections/master/plan";

// The server actions with the database, session and reads all mocked: nothing
// here touches a real database.
const h = vi.hoisted(() => ({
  admin: true,
  existing: new Map<string, ExistingCompany>(),
  clients: new Map<string, string[]>(),
  /** Stored values seen inside the transaction (simulates a change made meanwhile). */
  existingInTx: null as Map<string, ExistingCompany> | null,
  missingTable: false,
  insertConflict: new Set<string>(),
  staleUpdate: false,
  committed: { companies: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[], imports: [] as Record<string, unknown>[], deletes: 0 },
  transactions: 0,
  locked: false,
  knownLabels: [] as string[],
}));

vi.mock("server-only", () => ({}));
// Collection is its own module now (Admin → Access). Its gate is mocked to follow the session's admin flag — the
// admin bypass — so these tests keep exercising the collection.* capabilities exactly as before.
vi.mock("@/lib/auth/module-access", async () => {
  const { getCurrentEmployee } = await import("@/lib/auth/current");
  const inModule = async () => {
    const me = (await getCurrentEmployee()) as { isActive?: boolean; isAdmin?: boolean } | null;
    return !!me && me.isActive !== false && me.isAdmin === true;
  };
  return {
    canAccessModule: inModule,
    requireModuleAccess: async () => {
      const me = await getCurrentEmployee();
      if (!(await inModule())) throw new Error("Forbidden");
      return me;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error("Admin access required");
    return { id: "admin-1", isAdmin: true, isActive: true };
  },
  getCurrentEmployee: async () => ({ id: "admin-1", isAdmin: h.admin, isActive: true }),
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries(["collection.master.import"].map((k) => [k, { allowed: true, source: "admin" }])),
}));
vi.mock("@/lib/queries/collection-master", () => ({
  isMissingTable: (e: { code?: string }) => e?.code === "42P01",
  loadExistingByKeys: async () => {
    if (h.missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    return h.locked && h.existingInTx ? h.existingInTx : h.existing;
  },
  loadClientMasterIndex: async () => h.clients,
  listKnownCoordinatorLabels: async () => h.knownLabels,
}));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.transactions++;
      if (h.missingTable) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      const companies: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      const imports: Record<string, unknown>[] = [];
      const tx = {
        select: () => {
          const c: Record<string, unknown> = {};
          c.from = () => c;
          c.where = () => c;
          c.for = async () => {
            h.locked = true;
            return [];
          };
          return c;
        },
        insert: (table: Record<string, unknown>) => ({
          values: (v: Record<string, unknown>) => {
            const isImport = "columnMapping" in table;
            const chain = {
              onConflictDoNothing: () => chain,
              returning: async () => {
                if (isImport) {
                  imports.push(v);
                  return [{ id: "import-1" }];
                }
                if (h.insertConflict.has(String(v.nameKey))) return [];
                companies.push(v);
                return [{ id: `new-${String(v.nameKey)}` }];
              },
            };
            return chain;
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            const w = {
              where: () => w,
              returning: async () => {
                if (h.staleUpdate) return [];
                updates.push(v);
                return [{ id: "x" }];
              },
              then: (res: (v: unknown) => unknown) => {
                updates.push({ batch: v });
                return Promise.resolve().then(res);
              },
            };
            return w;
          },
        }),
        delete: () => {
          h.committed.deletes++;
          throw new Error("delete must never be called");
        },
      };
      const out = await fn(tx);
      h.committed.companies.push(...companies);
      h.committed.updates.push(...updates);
      h.committed.imports.push(...imports);
      return out;
    },
  },
}));

import { importCollectionMaster, previewCollectionMaster } from "@/app/(collection-module)/collection/master/actions";

const stored = (companyName: string, nameKey: string, coordinatorLabel: string | null, paymentTerms: string | null): ExistingCompany => ({
  id: `id-${nameKey}`,
  companyName,
  nameKey,
  coordinatorLabel,
  paymentTerms,
  customerMasterId: null,
});

const body = (rows: { rowNo: number; company: string; coordinator?: string; paymentTerms?: string }[], over: Record<string, unknown> = {}) => ({
  fileName: "MasterFile.xlsx",
  sheetName: "Sheet1",
  mapping: { company: "Name", coordinator: "Unnamed column B", paymentTerms: "Payment Terms" },
  ignoredColumns: [{ column: "D", header: null, filled: 28 }],
  confirmedColumns: { coordinator: true },
  rows: rows.map((r) => ({ coordinator: "", paymentTerms: "", ...r })),
  ...over,
});

beforeEach(() => {
  h.admin = true;
  h.existing = new Map();
  h.clients = new Map();
  h.existingInTx = null;
  h.missingTable = false;
  h.insertConflict = new Set();
  h.staleUpdate = false;
  h.committed = { companies: [], updates: [], imports: [], deletes: 0 };
  h.transactions = 0;
  h.locked = false;
  h.knownLabels = [];
});

describe("access and validation", () => {
  it("both actions need the Collection module (and then the capability) and stop before reading or writing", async () => {
    h.admin = false; // not an admin and not granted the Collection module → the module gate refuses first
    await expect(previewCollectionMaster(body([{ rowNo: 2, company: "A" }]))).rejects.toThrow(/Forbidden/);
    await expect(importCollectionMaster({ ...body([{ rowNo: 2, company: "A" }]), confirm: true })).rejects.toThrow(/Forbidden/);
    expect(h.transactions).toBe(0);
  });

  it("rejects malformed payloads on the server", async () => {
    expect((await previewCollectionMaster({ rows: [] })).ok).toBe(false);
    expect((await previewCollectionMaster(body([]))).ok).toBe(false);
    expect((await previewCollectionMaster(body([{ rowNo: 0, company: "A" }]))).ok).toBe(false);
    expect((await previewCollectionMaster(body([{ rowNo: 2, company: "x".repeat(1001) }]))).ok).toBe(false);
  });

  it("an import without explicit confirmation writes nothing", async () => {
    const res = await importCollectionMaster(body([{ rowNo: 2, company: "Alpha" }]));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/confirm/i) });
    expect(h.transactions).toBe(0);
  });
});

describe("preview", () => {
  it("is read-only and re-validates the raw cells on the server", async () => {
    const res = await previewCollectionMaster(body([
      { rowNo: 2, company: "Alpha", coordinator: "XXX" },
      { rowNo: 3, company: "" },
      { rowNo: 4, company: "alpha" },
    ]));
    if (!res.ok) throw new Error(res.error);
    expect(res.preview.storageReady).toBe(true);
    expect(res.preview.rows.map((r) => r.status)).toEqual(["new", "rejected", "duplicate"]);
    expect(res.preview.rows[0]!.coordinatorLabel).toBeNull();
    expect(h.transactions).toBe(0);
  });

  it("with the table missing it still previews, flagged as not ready", async () => {
    h.missingTable = true;
    const res = await previewCollectionMaster(body([{ rowNo: 2, company: "Alpha" }]));
    expect(res.ok && res.preview.storageReady).toBe(false);
  });
});

describe("import", () => {
  it("inserts new companies with an audit batch, never touching the Client Master", async () => {
    h.clients = new Map([["alpha", ["cm-1"]]]);
    const res = await importCollectionMaster({ ...body([{ rowNo: 2, company: "Alpha", coordinator: "BK", paymentTerms: "30 days" }, { rowNo: 3, company: "Beta", coordinator: "-" }]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals).toMatchObject({ inserted: 2, updated: 0, rejected: 0 });
    expect(h.committed.imports).toHaveLength(1);
    expect(h.committed.imports[0]).toMatchObject({ fileName: "MasterFile.xlsx", importedById: "admin-1", ignoredColumns: [{ column: "D", header: null, filled: 28 }] });
    expect(h.committed.companies).toEqual([
      expect.objectContaining({ companyName: "Alpha", nameKey: "alpha", coordinatorLabel: "BK", paymentTerms: "30 days", customerMasterId: "cm-1", clientMatch: "linked", createdById: "admin-1" }),
      expect.objectContaining({ companyName: "Beta", coordinatorLabel: null, paymentTerms: null, customerMasterId: null }),
    ]);
    expect(h.committed.deletes).toBe(0);
  });

  it("re-upload: unchanged rows are left alone and changed rows keep stored values unless accepted", async () => {
    h.existing = new Map([
      ["alpha", stored("Alpha", "alpha", "BK", "30 days")],
      ["beta", stored("Beta", "beta", "BK", null)],
      ["gamma", stored("Gamma", "gamma", "GR", null)],
    ]);
    const rows = [
      { rowNo: 2, company: "Alpha", coordinator: "BK", paymentTerms: "30 days" },
      { rowNo: 3, company: "Beta", coordinator: "GR" },
      { rowNo: 4, company: "Gamma", coordinator: "BH" },
    ];
    const res = await importCollectionMaster({ ...body(rows), acceptChanges: [{ rowNo: 4, changes: [{ field: "coordinatorLabel", from: "GR", to: "BH" }] }], confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals).toMatchObject({ inserted: 0, updated: 1, unchanged: 1, keptExisting: 1 });
    expect(res.result.rows.map((r) => r.outcome)).toEqual(["unchanged", "kept-existing", "updated"]);
    const rowUpdates = h.committed.updates.filter((u) => !("batch" in u));
    expect(rowUpdates).toEqual([expect.objectContaining({ coordinatorLabel: "BH", lastImportId: "import-1", updatedById: "admin-1" })]);
    expect(rowUpdates[0]).not.toHaveProperty("paymentTerms");
    expect(h.committed.companies).toEqual([]);
  });

  it("re-plans inside the transaction: a stored value changed since the preview is not overwritten", async () => {
    h.existing = new Map([["alpha", stored("Alpha", "alpha", null, null)]]);
    // Meanwhile someone set GR; the file says BK, so this is now a change the admin hasn't accepted.
    h.existingInTx = new Map([["alpha", stored("Alpha", "alpha", "GR", null)]]);
    const res = await importCollectionMaster({ ...body([{ rowNo: 2, company: "Alpha", coordinator: "BK" }]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.rows[0]!.outcome).toBe("kept-existing");
    expect(h.committed.updates.filter((u) => !("batch" in u))).toEqual([]);
  });

  it("an accepted change whose row was edited meanwhile rolls back the whole import", async () => {
    h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", null)]]);
    h.staleUpdate = true;
    const res = await importCollectionMaster({
      ...body([{ rowNo: 2, company: "Alpha", coordinator: "GR" }, { rowNo: 3, company: "New Co" }]),
      acceptChanges: [{ rowNo: 2, changes: [{ field: "coordinatorLabel", from: "BK", to: "GR" }] }],
      confirm: true,
    });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Nothing was imported/) });
    expect(h.committed.companies).toEqual([]);
    expect(h.committed.imports).toEqual([]);
  });

  describe("stale-preview protection: an accepted row must still be exactly what the preview showed", () => {
    const accept = (rowNo: number, from: string | null, to: string | null) => [{ rowNo, changes: [{ field: "coordinatorLabel" as const, from, to }] }];
    const file = () => body([{ rowNo: 2, company: "Alpha", coordinator: "GR" }, { rowNo: 3, company: "New Co" }]);
    const nothingWritten = () => {
      expect(h.committed.companies).toEqual([]);
      expect(h.committed.updates).toEqual([]);
      expect(h.committed.imports).toEqual([]);
    };

    it("REGRESSION: preview BK→GR accepted, someone sets MX meanwhile → refused, MX is not overwritten, nothing imported", async () => {
      h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", null)]]);
      const preview = await previewCollectionMaster(file());
      if (!preview.ok) throw new Error(preview.error);
      const seen = preview.preview.rows.find((r) => r.rowNo === 2)!;
      expect(seen.changes).toEqual([{ field: "coordinatorLabel", from: "BK", to: "GR" }]);
      h.existingInTx = new Map([["alpha", stored("Alpha", "alpha", "MX", null)]]); // the value read under the lock
      const res = await importCollectionMaster({ ...file(), acceptChanges: [{ rowNo: 2, changes: seen.changes }], confirm: true });
      expect(res).toEqual({ ok: false, error: expect.stringMatching(/\(Alpha\) no longer matches the preview.*Nothing was imported — preview again/) });
      nothingWritten();
    });

    it("an accepted row that is no longer a change (someone already set the same value) is refused, not silently dropped", async () => {
      h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", null)]]);
      h.existingInTx = new Map([["alpha", stored("Alpha", "alpha", "GR", null)]]);
      expect((await importCollectionMaster({ ...file(), acceptChanges: accept(2, "BK", "GR"), confirm: true })).ok).toBe(false);
      nothingWritten();
    });

    it("the same row number with a different expected change (a forged or out-of-date acceptance) is refused", async () => {
      h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", null)]]);
      expect((await importCollectionMaster({ ...file(), acceptChanges: accept(2, "XX", "GR"), confirm: true })).ok).toBe(false);
      expect((await importCollectionMaster({ ...file(), acceptChanges: accept(2, "BK", "ZZ"), confirm: true })).ok).toBe(false);
      nothingWritten();
    });

    it("an accepted row number that isn't a row of this file is refused", async () => {
      h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", null)]]);
      expect((await importCollectionMaster({ ...file(), acceptChanges: accept(99, "BK", "GR"), confirm: true })).ok).toBe(false);
      nothingWritten();
    });

    it("all accepted rows are checked before anything is written: one stale row out of two refuses both", async () => {
      h.existing = new Map([
        ["alpha", stored("Alpha", "alpha", "BK", null)],
        ["beta", stored("Beta", "beta", "BK", null)],
      ]);
      h.existingInTx = new Map([
        ["alpha", stored("Alpha", "alpha", "BK", null)],
        ["beta", stored("Beta", "beta", "MX", null)],
      ]);
      const res = await importCollectionMaster({
        ...body([{ rowNo: 2, company: "Alpha", coordinator: "GR" }, { rowNo: 3, company: "Beta", coordinator: "GR" }]),
        acceptChanges: [...accept(2, "BK", "GR"), ...accept(3, "BK", "GR")],
        confirm: true,
      });
      expect(res).toEqual({ ok: false, error: expect.stringMatching(/\(Beta\)/) });
      nothingWritten();
    });

    it("an unchanged acceptance is still applied (the fix doesn't block valid imports); both fields at once must match", async () => {
      h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", "30 days")]]);
      const res = await importCollectionMaster({
        ...body([{ rowNo: 2, company: "Alpha", coordinator: "GR", paymentTerms: "45 days" }]),
        acceptChanges: [{ rowNo: 2, changes: [{ field: "paymentTerms", from: "30 days", to: "45 days" }, { field: "coordinatorLabel", from: "BK", to: "GR" }] }],
        confirm: true,
      });
      if (!res.ok) throw new Error(res.error);
      expect(h.committed.updates.filter((u) => !("batch" in u))).toEqual([expect.objectContaining({ coordinatorLabel: "GR", paymentTerms: "45 days" })]);
      // Only one of the two changes accepted → no longer the change the preview showed → refused.
      h.committed = { companies: [], updates: [], imports: [], deletes: 0 };
      const partial = await importCollectionMaster({
        ...body([{ rowNo: 2, company: "Alpha", coordinator: "GR", paymentTerms: "45 days" }]),
        acceptChanges: accept(2, "BK", "GR"),
        confirm: true,
      });
      expect(partial.ok).toBe(false);
      nothingWritten();
    });

    it("the old row-number-only payload and duplicate acceptances are rejected by the server", async () => {
      h.existing = new Map([["alpha", stored("Alpha", "alpha", "BK", null)]]);
      expect((await importCollectionMaster({ ...file(), acceptChanges: [2], confirm: true })).ok).toBe(false);
      expect(await importCollectionMaster({ ...file(), acceptChanges: [...accept(2, "BK", "GR"), ...accept(2, "BK", "GR")], confirm: true })).toEqual({
        ok: false,
        error: "Each row can be accepted only once.",
      });
      expect(h.transactions).toBe(0);
      nothingWritten();
    });
  });

  it("a company created by someone else meanwhile is reported, not overwritten", async () => {
    h.insertConflict = new Set(["alpha"]);
    const res = await importCollectionMaster({ ...body([{ rowNo: 2, company: "Alpha" }]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals.conflicts).toBe(1);
    expect(res.result.rows[0]!.outcome).toBe("skipped-conflict");
  });

  it("reports row-level errors for rejected and conflicting rows", async () => {
    const res = await importCollectionMaster({ ...body([{ rowNo: 2, company: "" }, { rowNo: 3, company: "Dup", coordinator: "BK" }, { rowNo: 4, company: "Dup", coordinator: "GR" }]), confirm: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.totals).toMatchObject({ rejected: 3, inserted: 0 });
    expect(res.result.rows.map((r) => [r.rowNo, r.outcome])).toEqual([[2, "rejected"], [3, "rejected"], [4, "rejected"]]);
    expect(res.result.rows[1]!.message).toMatch(/different coordinators/);
  });

  it("with storage missing, nothing is imported and the reason is given", async () => {
    h.missingTable = true;
    const res = await importCollectionMaster({ ...body([{ rowNo: 2, company: "Alpha" }]), confirm: true });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/migration 0112/) });
  });
});
