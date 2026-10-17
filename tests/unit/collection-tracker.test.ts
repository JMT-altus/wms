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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: (v: unknown) => insertValues(v) }) } }));
vi.mock("@/lib/auth/current", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/format", () => ({ localDateString: () => "2026-10-13" }));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: () => loadParties(),
}));

describe("saveFollowUp (server action)", () => {
  beforeEach(() => {
    insertValues.mockReset().mockResolvedValue(undefined);
    requireAdmin.mockReset().mockResolvedValue({ id: "admin-1" });
    loadParties.mockReset().mockResolvedValue({ connected: true, parties: [party()] });
  });
  const run = async (input: unknown) => (await import("@/app/(forms-module)/forms/collection/actions")).saveFollowUp(input);

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
  it("is admin-only: the check runs first and a refusal stops everything", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin access required"));
    await expect(run({ partyName: "Alpha Traders", note: "x" })).rejects.toThrow();
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("reports a missing table honestly instead of claiming success", async () => {
    insertValues.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    const res = await run({ partyName: "Alpha Traders", note: "x" });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/nothing was saved/i);
  });
});
