import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRows,
  filterRows,
  outstandingByPerson,
  partyKey,
  personSummary,
  sortRows,
  topByOutstanding,
  type FollowUpEntry,
} from "@/lib/collections/derive";
import { FollowUpInput, followUpDateError } from "@/lib/collections/validate";
import type { CollectionParty } from "@/lib/collections/source";

const party = (over: Partial<CollectionParty> = {}): CollectionParty => ({
  partyName: "Alpha Traders",
  debit: 1000,
  credit: 400,
  outstanding: 600,
  collectionPerson: "Asha",
  ...over,
});
const fu = (over: Partial<FollowUpEntry> = {}): FollowUpEntry => ({
  id: "f1",
  partyName: "Alpha Traders",
  nextFollowupDate: "2026-11-10",
  note: "Called, will pay",
  createdById: "emp-admin",
  createdByName: "Admin",
  createdAt: new Date("2026-10-12T10:00:00Z"),
  ...over,
});

describe("joining parties with their follow-ups", () => {
  it("matches names ignoring case and spacing, newest entry first", () => {
    const rows = buildRows(
      [party()],
      [
        fu({ id: "old", partyName: "alpha traders ", createdAt: new Date("2026-10-01"), nextFollowupDate: "2026-10-20" }),
        fu({ id: "new", createdAt: new Date("2026-10-12") }),
      ],
    );
    expect(rows[0]!.history.map((h) => h.id)).toEqual(["new", "old"]);
    expect(partyKey(" ABC ")).toBe(partyKey("abc"));
  });
  it("the next follow-up date is the latest entry that has one, not a note-only entry", () => {
    const rows = buildRows(
      [party()],
      [fu({ id: "a", nextFollowupDate: "2026-11-10", createdAt: new Date("2026-10-10") }), fu({ id: "b", nextFollowupDate: null, note: "just a note", createdAt: new Date("2026-10-12") })],
    );
    expect(rows[0]!.nextFollowupDate).toBe("2026-11-10");
  });
  it("a party with no follow-ups has none, and nothing is invented for it", () => {
    const r = buildRows([party()], [])[0]!;
    expect(r.nextFollowupDate).toBeNull();
    expect(r.history).toEqual([]);
  });
});

describe("filtering and sorting the tracker", () => {
  const rows = buildRows(
    [
      party({ partyName: "Beta", collectionPerson: "Ravi", debit: 50 }),
      party({ partyName: "Alpha", collectionPerson: "Asha", debit: 900 }),
      party({ partyName: "Gamma", collectionPerson: null, debit: null }),
    ],
    [fu({ partyName: "Alpha", nextFollowupDate: "2026-10-01", note: "Promised cheque" })],
  );
  const none = { query: "", collectionPerson: "", followUp: "" } as const;

  it("searches party, person and notes", () => {
    expect(filterRows(rows, { ...none, query: "cheque" }, "2026-10-13").map((r) => r.partyName)).toEqual(["Alpha"]);
    expect(filterRows(rows, { ...none, query: "ravi" }, "2026-10-13").map((r) => r.partyName)).toEqual(["Beta"]);
  });
  it("filters by collection person and by follow-up state", () => {
    expect(filterRows(rows, { ...none, collectionPerson: "Asha" }, "2026-10-13")).toHaveLength(1);
    expect(filterRows(rows, { ...none, followUp: "due" }, "2026-10-13").map((r) => r.partyName)).toEqual(["Alpha"]);
    expect(filterRows(rows, { ...none, followUp: "none" }, "2026-10-13")).toHaveLength(2);
  });
  it("sorts both ways and always puts blanks last", () => {
    expect(sortRows(rows, "party", "asc").map((r) => r.partyName)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortRows(rows, "debit", "desc").map((r) => r.partyName)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortRows(rows, "debit", "asc").map((r) => r.partyName)).toEqual(["Beta", "Alpha", "Gamma"]);
  });
});

describe("rankings use only the outstanding the source supplied", () => {
  const ps = [
    party({ partyName: "A", outstanding: 100, collectionPerson: "X" }),
    party({ partyName: "B", outstanding: 400, collectionPerson: "Y" }),
    party({ partyName: "C", outstanding: null, collectionPerson: "X" }),
    party({ partyName: "D", outstanding: 200, collectionPerson: "X" }),
  ];
  it("ranks supplied figures and leaves unknowns out rather than treating them as zero", () => {
    expect(topByOutstanding(ps, 2).map((p) => p.partyName)).toEqual(["B", "D"]);
    expect(topByOutstanding(ps, 10).map((p) => p.partyName)).not.toContain("C");
  });
  it("totals per collection person from those same figures", () => {
    expect(outstandingByPerson(ps)).toEqual([
      { person: "Y", total: 400 },
      { person: "X", total: 300 },
    ]);
  });
  it("summarises each collection person: parties held and the supplied outstanding", () => {
    expect(personSummary(ps)).toEqual([
      { person: "Y", parties: 1, total: 400 },
      { person: "X", parties: 3, total: 300 },
    ]);
    // A person whose parties supplied no figure has no total, not a zero.
    expect(personSummary([party({ outstanding: null, collectionPerson: "Z" })])).toEqual([
      { person: "Z", parties: 1, total: null },
    ]);
  });
  it("never derives outstanding from debit and credit", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/collections/derive.ts"), "utf8");
    expect(src).not.toMatch(/debit\s*-\s*\w*\.?credit|\.debit\s*-\s*/);
  });
});

describe("follow-up validation", () => {
  it("needs a party and either a date or a note", () => {
    expect(FollowUpInput.safeParse({ partyName: "A", nextFollowupDate: "2026-11-01" }).success).toBe(true);
    expect(FollowUpInput.safeParse({ partyName: "A", note: " Called " }).success).toBe(true);
    expect(FollowUpInput.safeParse({ partyName: "A" }).success).toBe(false);
    expect(FollowUpInput.safeParse({ partyName: "A", note: "   " }).success).toBe(false);
    expect(FollowUpInput.safeParse({ partyName: "  ", note: "x" }).success).toBe(false);
  });
  it("rejects a date that doesn't exist, over-long notes, and fields the client must not set", () => {
    expect(FollowUpInput.safeParse({ partyName: "A", nextFollowupDate: "2026-02-31" }).success).toBe(false);
    expect(FollowUpInput.safeParse({ partyName: "A", note: "x".repeat(2001) }).success).toBe(false);
    for (const extra of [{ createdById: "x" }, { debit: 5 }, { outstanding: 5 }]) {
      expect(FollowUpInput.safeParse({ partyName: "A", note: "x", ...extra }).success).toBe(false);
    }
  });
  it("a follow-up can't be dated in the past", () => {
    expect(followUpDateError("2026-10-12", "2026-10-13")).toMatch(/past/);
    expect(followUpDateError("2026-10-13", "2026-10-13")).toBeNull();
    expect(followUpDateError(null, "2026-10-13")).toBeNull();
  });
});

// ── the server action, with its collaborators replaced ──────────────────────
const insertValues = vi.fn();
const requireAdmin = vi.fn();
const loadParties = vi.fn();
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
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: (v: unknown) => insertValues(v) }) } }));
/** The signed session. `isAdmin` also decides the (mocked) Collection module gate above. */
const session = { id: "admin-1", isAdmin: true, isActive: true };
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: () => requireAdmin(),
  getCurrentEmployee: async () => session,
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries(["collection.followup.write"].map((k) => [k, { allowed: true, source: "admin" }])),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/format", () => ({ localDateString: () => "2026-10-13" }));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: () => loadParties(),
}));

describe("saveFollowUp (server action)", () => {
  beforeEach(() => {
    insertValues.mockReset().mockResolvedValue(undefined);
    requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", isAdmin: true, isActive: true });
    loadParties.mockReset().mockResolvedValue({ connected: true, parties: [party()] });
  });
  const run = async (input: unknown) => (await import("@/app/(collection-module)/collection/actions")).saveFollowUp(input);

  it("saves for a listed party, with the author from the session and the source's spelling of the name", async () => {
    const res = await run({ partyName: "alpha traders", nextFollowupDate: "2026-11-10", note: " Will pay " });
    expect(res).toEqual({ ok: true });
    expect(insertValues).toHaveBeenCalledWith({
      partyName: "Alpha Traders",
      nextFollowupDate: "2026-11-10",
      note: "Will pay",
      createdById: "admin-1",
    });
  });
  it("refuses a party the source doesn't list, and saves nothing", async () => {
    const res = await run({ partyName: "Made Up Co", note: "x" });
    expect(res.ok).toBe(false);
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("with no accounting source connected, nothing can be saved", async () => {
    loadParties.mockResolvedValue({ connected: false, parties: [] });
    expect((await run({ partyName: "Alpha Traders", note: "x" })).ok).toBe(false);
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("refuses a past date and an empty follow-up", async () => {
    expect((await run({ partyName: "Alpha Traders", nextFollowupDate: "2026-10-01" })).ok).toBe(false);
    expect((await run({ partyName: "Alpha Traders" })).ok).toBe(false);
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("needs the Collection module: the gate runs first and a refusal stops everything", async () => {
    session.isAdmin = false; // neither an admin nor granted the module
    try {
      await expect(run({ partyName: "Alpha Traders", note: "x" })).rejects.toThrow("Forbidden");
      expect(insertValues).not.toHaveBeenCalled();
    } finally {
      session.isAdmin = true;
    }
  });
  it("reports a missing table honestly instead of claiming success", async () => {
    insertValues.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    const res = await run({ partyName: "Alpha Traders", note: "x" });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/nothing was saved/i);
  });
  it("never takes the author or the time from the browser: such fields are rejected and nothing is saved", async () => {
    for (const extra of [
      { createdById: "someone-else" },
      { createdByName: "Someone Else" },
      { createdAt: "2020-01-01T00:00:00Z" },
      { userId: "someone-else" },
    ]) {
      const res = await run({ partyName: "Alpha Traders", note: "x", ...extra });
      expect(res.ok).toBe(false);
    }
    expect(insertValues).not.toHaveBeenCalled();
    // A normal save carries ONLY party, date, note and the session's employee id — no timestamp (the database sets it).
    await run({ partyName: "Alpha Traders", note: "x" });
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(Object.keys(insertValues.mock.calls[0]![0] as object).sort()).toEqual(["createdById", "nextFollowupDate", "note", "partyName"]);
    expect((insertValues.mock.calls[0]![0] as { createdById: string }).createdById).toBe("admin-1");
  });
  it("a database failure returns a fixed message — never the database's own text", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    insertValues.mockRejectedValue(Object.assign(new Error('new row for relation "collection_followups" violates check constraint "x" at postgres://u:secret@host/db'), { code: "23514" }));
    const res = await run({ partyName: "Alpha Traders", note: "x" });
    expect(res).toEqual({ ok: false, error: "The follow-up could not be saved, so nothing was changed. Please try again." });
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/secret|collection_followups|violates/);
    errSpy.mockRestore();
  });
});
