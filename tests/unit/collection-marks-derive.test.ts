import { describe, expect, it } from "vitest";
import { MarksInput, markStateOf, marksMessage, type CompanyMarks } from "@/lib/collections/marks";
import { buildRows, filterRows, sortRows, type PartyRow } from "@/lib/collections/derive";
import type { CollectionParty } from "@/lib/collections/source";

// MARK AS PRIORITY / COLLECTION DONE in the Tracker's pure rules: the precedence (done beats priority), the three
// groups the list is sorted into (priority on top, pending, done at the bottom — ordinary column sorting only within
// a group), the Status filter working together with the other filters, and the action's input.
const at = new Date("2026-11-01T06:00:00Z");
const mark = (p: boolean, d: boolean): CompanyMarks => ({ priority: p ? { setAt: at, setByName: "Asha" } : null, done: d ? { setAt: at, setByName: "Asha" } : null });
const party = (name: string, debit: number | null, person: string | null, marks?: CompanyMarks | null): PartyRow => ({
  ...(buildRows([{ partyName: name, debit, credit: 0, outstanding: null, collectionPerson: person, coordinatorLabel: person, masterId: `id-${name}`, transactions: [] } as CollectionParty], [])[0]!),
  marks,
});
const names = (rows: PartyRow[]) => rows.map((r) => r.partyName);

describe("markStateOf — the one precedence rule", () => {
  it("no marks = pending; priority alone = priority; done beats priority", () => {
    expect(markStateOf(undefined)).toBe("pending");
    expect(markStateOf(null)).toBe("pending");
    expect(markStateOf(mark(false, false))).toBe("pending");
    expect(markStateOf(mark(true, false))).toBe("priority");
    expect(markStateOf(mark(false, true))).toBe("done");
    expect(markStateOf(mark(true, true))).toBe("done");
  });

  it("undoing done on a company that still holds priority puts it back on top", () => {
    const both = mark(true, true);
    expect(markStateOf({ ...both, done: null })).toBe("priority");
  });
});

describe("sortRows — three groups, then the chosen column", () => {
  const rows = [
    party("Delta", 400, "BK", mark(false, true)), // done
    party("Alpha", 100, "BK"), // pending
    party("Echo", 500, "BK", mark(true, true)), // both → done
    party("Charlie", 300, "BK", mark(true, false)), // priority
    party("Bravo", 200, "BK", mark(true, false)), // priority
    party("Foxtrot", null, "BK"), // pending, no debit
  ];

  it("priority first, pending in the middle, done last — each group in the column order", () => {
    expect(names(sortRows(rows, "party", "asc"))).toEqual(["Bravo", "Charlie", "Alpha", "Foxtrot", "Delta", "Echo"]);
    expect(names(sortRows(rows, "debit", "desc"))).toEqual(["Charlie", "Bravo", "Alpha", "Foxtrot", "Echo", "Delta"]);
  });

  it("ordinary sorting never lifts a done row or sinks a priority row, in either direction", () => {
    for (const key of ["party", "debit", "credit", "person", "next"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const out = sortRows(rows, key, dir).map((r) => markStateOf(r.marks));
        expect(out).toEqual(["priority", "priority", "pending", "pending", "done", "done"]);
      }
    }
  });

  it("a company both priority and done appears once, at the bottom", () => {
    const out = sortRows(rows, "party", "asc");
    expect(out.filter((r) => r.partyName === "Echo")).toHaveLength(1);
    expect(out[out.length - 1]!.partyName).toBe("Echo");
  });
});

describe("filterRows — Status with the other filters", () => {
  const rows = [
    party("Alpha", 100, "BK"),
    party("Bravo", 200, "BK", mark(true, false)),
    party("Charlie", 300, "SV", mark(true, false)),
    party("Delta", 400, "SV", mark(false, true)),
    party("Echo", 500, "BK", mark(true, true)),
  ];
  const f = (over: Partial<Parameters<typeof filterRows>[1]>) => names(filterRows(rows, { query: "", collectionPerson: "", followUp: "", ...over }, "2026-11-03"));

  it("'' and undefined show every group; each status shows its own group (done includes both-marked)", () => {
    expect(f({})).toHaveLength(5);
    expect(f({ status: "" })).toHaveLength(5);
    expect(f({ status: "priority" })).toEqual(["Bravo", "Charlie"]);
    expect(f({ status: "pending" })).toEqual(["Alpha"]);
    expect(f({ status: "done" })).toEqual(["Delta", "Echo"]);
  });

  it("works together with the Collection person filter and the search, not instead of them", () => {
    expect(f({ status: "priority", collectionPerson: "SV" })).toEqual(["Charlie"]);
    expect(f({ status: "priority", query: "bra" })).toEqual(["Bravo"]);
    expect(f({ status: "done", collectionPerson: "BK" })).toEqual(["Echo"]);
    expect(f({ status: "pending", collectionPerson: "SV" })).toEqual([]);
  });
});

describe("the action's input and messages", () => {
  it("accepts company ids with a kind and a direction; refuses extras, empties and non-ids", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(MarksInput.safeParse({ companyIds: [id], kind: "priority", active: true }).success).toBe(true);
    expect(MarksInput.safeParse({ companyIds: [], kind: "priority", active: true }).success).toBe(false);
    expect(MarksInput.safeParse({ companyIds: ["x"], kind: "done", active: false }).success).toBe(false);
    expect(MarksInput.safeParse({ companyIds: [id], kind: "later", active: true }).success).toBe(false);
    expect(MarksInput.safeParse({ companyIds: [id], kind: "done", active: true, actorId: "e" }).success).toBe(false);
  });

  it("says what happened, counting skipped companies", () => {
    expect(marksMessage("priority", true, 1, 0)).toBe("Marked 1 company as priority.");
    expect(marksMessage("priority", false, 3, 0)).toBe("Removed priority from 3 companies.");
    expect(marksMessage("done", true, 2, 1)).toBe("Marked 2 companies as collection done. 1 skipped (already in that state, or not in your scope).");
    expect(marksMessage("done", false, 1, 0)).toBe("Undid collection done for 1 company.");
  });
});
