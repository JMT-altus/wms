import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// Commitments need collection.commitments.view (read) / .edit (record) —
// sensitive capabilities granted explicitly in the permission matrix. MOCKED
// session, resolved grants and database: these prove the server-side gates —
// direct action calls, page responses and what the tracker page sends to the
// browser. Real SQL and real grant resolution are covered in
// tests/integration/collection-commitments.db.test.ts and
// tests/integration/collection-permissions.db.test.ts.
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  /** Capabilities the current request holds (what the matrix resolved). */
  caps: new Set<string>(),
  dbCalls: [] as string[],
  selects: [] as unknown[][],
  inserts: [] as Record<string, unknown>[],
  insertFails: null as null | { code: string },
  listCommitments: vi.fn(),
  getCommitment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
vi.mock("@/lib/db", () => {
  const chain = (): unknown => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit", "innerJoin", "as"]) c[k] = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(h.selects.shift() ?? []).then(res);
    return c;
  };
  return {
    db: {
      select: () => {
        h.dbCalls.push("select");
        return chain();
      },
      selectDistinctOn: () => {
        h.dbCalls.push("selectDistinctOn");
        return chain();
      },
      // The Sales Coordinator options for collection.coordinator.assign (no stored coordinators here).
      selectDistinct: () => {
        h.dbCalls.push("selectDistinct");
        const c: Record<string, unknown> = {};
        for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
        c.then = (res: (v: unknown) => unknown) => Promise.resolve([]).then(res);
        return c;
      },
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          h.dbCalls.push("insert");
          if (h.insertFails) throw h.insertFails;
          h.inserts.push(v);
        },
      }),
    },
  };
});

import { getCompanyCommitment, saveCompanyCommitment } from "@/app/(forms-module)/forms/collection/commitments/actions";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ORDINARY = ["collection.view", "collection.followup.write", "collection.confirmation.set", "collection.escalation.create", "collection.master.import"];
/** An admin granted both commitment capabilities explicitly. */
const owner = () => {
  h.me = { id: "emp-granted", email: "granted@example.test", isActive: true, isAdmin: true, name: "Granted" };
  h.caps = new Set([...ORDINARY, "collection.commitments.view", "collection.commitments.edit"]);
};
/** An admin with only the ordinary Collection capabilities. */
const otherAdmin = () => {
  h.me = { id: "emp-other", email: "someone.else@example.test", isActive: true, isAdmin: true, name: "Other" };
  h.caps = new Set(ORDINARY);
};

beforeEach(() => {
  h.me = null;
  h.caps = new Set();
  h.dbCalls = [];
  h.selects = [];
  h.inserts = [];
  h.insertFails = null;
});

describe("server actions refuse anyone without the capability — before touching data", () => {
  const cases: [string, () => void][] = [
    ["an admin with only the ordinary Collection capabilities", otherAdmin],
    ["signed out", () => {}],
    ["granted, but the account is deactivated", () => {
      owner();
      h.me = { ...h.me!, isActive: false };
    }],
    ["granted, but no longer an admin (Forms is admin-only)", () => {
      owner();
      h.me = { ...h.me!, isAdmin: false };
    }],
  ];
  it.each(cases)("%s: get and save are Forbidden with no database call", async (_n, setup) => {
    setup();
    await expect(getCompanyCommitment(COMPANY)).rejects.toThrow("Forbidden");
    await expect(saveCompanyCommitment({ companyId: COMPANY, amount: "50000", committedDate: "2026-11-05" })).rejects.toThrow("Forbidden");
    expect(h.dbCalls).toEqual([]);
  });
});

describe("the actions, with the capabilities", () => {
  it("view-only can read but not record; edit-only can record but gets no figures back", async () => {
    h.me = { id: "emp-v", email: "v@example.test", isActive: true, isAdmin: true, name: "V" };
    h.caps = new Set(["collection.commitments.view"]);
    h.selects = [[]];
    expect((await getCompanyCommitment(COMPANY)).ok).toBe(true);
    await expect(saveCompanyCommitment({ companyId: COMPANY, amount: "5000", committedDate: "2026-11-05" })).rejects.toThrow("Forbidden");
    h.caps = new Set(["collection.commitments.edit"]);
    await expect(getCompanyCommitment(COMPANY)).rejects.toThrow("Forbidden");
    h.selects = [[{ id: COMPANY }]];
    expect(await saveCompanyCommitment({ companyId: COMPANY, amount: "5000", committedDate: "2026-11-05" })).toEqual({ ok: true, commitment: null });
    expect(h.inserts).toEqual([{ companyId: COMPANY, committedAmount: "5000.00", committedDate: "2026-11-05", recordedById: "emp-v" }]);
  });

  it("a revoked grant stops working on the next call", async () => {
    owner();
    h.selects = [[]];
    expect((await getCompanyCommitment(COMPANY)).ok).toBe(true);
    h.caps.delete("collection.commitments.view");
    await expect(getCompanyCommitment(COMPANY)).rejects.toThrow("Forbidden");
  });

  it("read the current commitment", async () => {
    owner();
    h.selects = [[{ amount: "125000.50", committedDate: "2026-11-05", recordedAt: new Date("2026-10-19T05:00:00Z") }]];
    const r = await getCompanyCommitment(COMPANY);
    expect(r).toEqual({ ok: true, storageReady: true, commitment: { amount: "125000.50", committedDate: "2026-11-05", recordedAt: new Date("2026-10-19T05:00:00Z") } });
  });

  it("validate the input on the server", async () => {
    owner();
    for (const bad of [
      { companyId: "nope", amount: "1", committedDate: "2026-11-05" },
      { companyId: COMPANY, amount: "0", committedDate: "2026-11-05" },
      { companyId: COMPANY, amount: "-5", committedDate: "2026-11-05" },
      { companyId: COMPANY, amount: "10.123", committedDate: "2026-11-05" },
      { companyId: COMPANY, amount: 10, committedDate: "2026-11-05" }, // a JS number: already floating point → refused
      { companyId: COMPANY, amount: "10", committedDate: "2026-02-30" },
      { companyId: COMPANY, amount: "10", committedDate: "2026-11-05", recordedById: "x" },
    ]) {
      expect((await saveCompanyCommitment(bad)).ok).toBe(false);
    }
    expect(h.dbCalls).toEqual([]);
  });

  it("save only for a company in the Collection Master, recorded as the signed-in holder", async () => {
    owner();
    h.selects = [[]];
    expect(await saveCompanyCommitment({ companyId: COMPANY, amount: "5000", committedDate: "2026-11-05" })).toEqual({
      ok: false,
      error: "That company isn't in the Collection Master, so nothing was saved.",
    });
    expect(h.inserts).toEqual([]);
    h.selects = [[{ id: COMPANY }], [{ amount: "5000.00", committedDate: "2026-11-05", recordedAt: new Date() }]];
    const r = await saveCompanyCommitment({ companyId: COMPANY, amount: "5000", committedDate: "2026-11-05" });
    expect(r.ok).toBe(true);
    expect(h.inserts).toEqual([{ companyId: COMPANY, committedAmount: "5000.00", committedDate: "2026-11-05", recordedById: "emp-granted" }]);
  });

  it("report missing storage plainly and never log an amount or a date", async () => {
    owner();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.selects = [[{ id: COMPANY }]];
    h.insertFails = { code: "42P01" };
    expect(await saveCompanyCommitment({ companyId: COMPANY, amount: "777777", committedDate: "2026-12-31" })).toEqual({
      ok: false,
      error: expect.stringMatching(/migration 0114 is pending/),
    });
    h.selects = [[{ id: COMPANY }]];
    h.insertFails = { code: "XX000" };
    const r = await saveCompanyCommitment({ companyId: COMPANY, amount: "777777", committedDate: "2026-12-31" });
    expect(r.ok).toBe(false);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toMatch(/777777|2026-12-31/);
    err.mockRestore();
  });
});

// ── pages ─────────────────────────────────────────────────────────────────────
vi.mock("@/lib/queries/collection-commitments", async (orig) => ({
  ...((await orig()) as object),
  listOwnerCommitments: (...a: unknown[]) => h.listCommitments(...a),
}));
vi.mock("@/lib/collections/load", () => ({
  loadTransactionsByMaster: async () => new Map(),
  loadCollectionParties: async () => ({
    connected: true,
    parties: [{ partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: "Mihir", masterId: COMPANY, coordinatorLabel: "Mihir", transactions: [] }],
    transactions: { key: "none", label: "No approved source", approved: false },
  }),
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: [] }) }));
// The scorecard's login ↔ Sales Coordinator lookup (its own table, no commitment data) — mocked like the other loaders,
// so the page itself still makes no direct database call here.
vi.mock("@/lib/collections/salesperson-identity", () => ({ salespersonIdentityFor: async () => ({ status: "unconfigured" }) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  openEscalations: async () => ({ storageReady: true, byCompany: new Map() }),
  listOpenEscalationsForReview: async () => ({ storageReady: true, rows: [] }),
}));
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));
vi.mock("@/components/collections/commitments-table", () => ({ CommitmentsTable: () => null }));

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

describe("commitments page", () => {
  it("is not found without the capability, without reading commitments", async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    otherAdmin();
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listCommitments).not.toHaveBeenCalled();
  });

  it("shows the commitments table, read with the holder's proof", async () => {
    const { default: Page, dynamic } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    expect(dynamic).toBe("force-dynamic");
    owner();
    const rows = [{ companyId: COMPANY, companyName: "Alpha Traders", amount: "5000.00", committedDate: "2026-11-05", recordedAt: new Date(), collectionPerson: "Mihir" }];
    h.listCommitments.mockResolvedValueOnce({ storageReady: true, rows });
    const tree = await Page();
    expect(h.listCommitments).toHaveBeenCalledWith({ employeeId: "emp-granted", capability: "collection.commitments.view" });
    // The page adds each company's Tracker comments (none in this fixture).
    expect(findProps(tree, "CommitmentsTable")).toEqual({
      rows: rows.map((r) => ({ ...r, comments: [], due: [], confirmation: null, outstanding: null, escalation: null })),
      today: expect.any(String),
      showCommitments: true,
      showEscalations: false,
      canClose: false,
      // A commitments-only viewer is told what an empty page means for them.
      emptyMessage: "No commitments recorded yet. Record one from a party's popup in the Collection Tracker.",
    });
  });
});

describe("tracker page payload", () => {
  it("sends users without the capability only canSeeCommitments=false — no commitment figures anywhere in the props", async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    otherAdmin();
    const props = findProps(await Page(), "CollectionTracker")!;
    expect(props.canSeeCommitments).toBe(false);
    const { canSeeCommitments: _flag, canEditCommitments: _edit, ...data } = props;
    expect(JSON.stringify(data)).not.toMatch(/committed|commitment|5000|amount"/i);
    expect(h.dbCalls).toEqual([]);
  });

  it("tells a holder's popup it may fetch, still without putting figures in the page data", async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    owner();
    const props = findProps(await Page(), "CollectionTracker")!;
    expect(props.canSeeCommitments).toBe(true);
    expect(JSON.stringify(props.rows)).not.toMatch(/committed|commitment/i);
    // and the collection person on the row is the Collection Master coordinator
    expect((props.rows as { collectionPerson: string }[])[0]!.collectionPerson).toBe("Mihir");
    // the Sales Coordinator editor needs its own capability (not granted here)
    expect(props.coordinatorEditor).toBeUndefined();
    h.caps.add("collection.coordinator.assign");
    const withAssign = findProps(await Page(), "CollectionTracker")!;
    expect(withAssign.coordinatorEditor).toEqual({ options: [] });
  });

  it("Bulk Upload (canImportBalances) follows collection.balances.import alone — decided from the session, revocation seen on the next request", async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    otherAdmin(); // every ordinary Collection capability, no Bulk Upload grant
    const without = findProps(await Page(), "CollectionTracker")!;
    expect(without.canImportBalances).toBe(false);
    // The other Tracker controls are unaffected by that.
    expect(without.canWriteFollowUps).toBe(true);
    expect(without.canSetConfirmation).toBe(true);
    expect(without.canEscalate).toBe(true);
    expect(without.canAddMasterCompanies).toBe(true);
    h.caps.add("collection.balances.import"); // the super-admin granted it to this person
    expect(findProps(await Page(), "CollectionTracker")!.canImportBalances).toBe(true);
    h.caps.delete("collection.balances.import"); // and revoked it
    expect(findProps(await Page(), "CollectionTracker")!.canImportBalances).toBe(false);
    expect(h.dbCalls).toEqual([]);
  });
});
