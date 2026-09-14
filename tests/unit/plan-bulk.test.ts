import { describe, expect, it } from "vitest";
import {
  BULK_MAX_ROWS,
  detectHeader,
  evaluateBulkRows,
  fieldsForLevel,
  matchOwner,
  parseBulkDate,
  parsePastedGrid,
  readBulkGrid,
  templateHeader,
  type BulkRow,
  type RosterEntry,
} from "@/lib/plan/bulk";

const roster: RosterEntry[] = [
  { id: "e1", name: "Manan Vasa", email: "manan@example.com" },
  { id: "e2", name: "Riddhi Shah", email: "riddhi@example.com" },
  { id: "e3", name: "Mihir Veera", email: "mihir@example.com" },
];

describe("fieldsForLevel", () => {
  it("offers Start/End only on scheduled levels", () => {
    expect(fieldsForLevel("action")).toContain("startDate");
    expect(fieldsForLevel("result")).toContain("endDate");
    expect(fieldsForLevel("milestone")).not.toContain("startDate");
    expect(fieldsForLevel("project")).not.toContain("endDate");
  });

  it("templates carry exactly the columns the level can store", () => {
    expect(templateHeader("milestone")).toEqual([
      "Name",
      "Owner",
      "Target Date",
      "Description",
    ]);
    expect(templateHeader("action")).toHaveLength(6);
  });
});

describe("detectHeader", () => {
  const allowed = fieldsForLevel("action");

  it("takes TWO recognised columns as a header", () => {
    const grid = [["Name", "Owner", "Due"], ["Vendor demo", "Manan", "12-Jun-2026"]];
    const h = detectHeader(grid, allowed);
    expect(h.rowIndex).toBe(0);
    expect(h.columns.get(0)).toBe("name");
    expect(h.columns.get(1)).toBe("owner");
    expect(h.columns.get(2)).toBe("targetDate");
  });

  it("skips the title and blank line above a filled-in template", () => {
    // People paste from halfway down a sheet.
    const grid = [
      ["Q3 Action Plan"],
      [""],
      ["Name", "Assignee", "Deadline"],
      ["Install readers", "Riddhi", "2026-07-01"],
    ];
    expect(detectHeader(grid, allowed).rowIndex).toBe(2);
  });

  it("falls back to a single hit when that is all there is", () => {
    const grid = [["Name"], ["Vendor demo"]];
    const h = detectHeader(grid, allowed);
    expect(h.rowIndex).toBe(0);
    expect(h.columns.size).toBe(1);
  });

  it("reports no header for a bare column of names", () => {
    const grid = [["Vendor demo"], ["Install readers"]];
    expect(detectHeader(grid, allowed).rowIndex).toBe(-1);
  });

  it("ignores a column the level cannot store", () => {
    // Start/End are not offered on a milestone.
    const grid = [["Name", "Start", "Owner"]];
    const h = detectHeader(grid, fieldsForLevel("milestone"));
    expect([...h.columns.values()]).toEqual(["name", "owner"]);
  });

  it("matches aliases on a punctuation-free key", () => {
    const grid = [["  NAME ", "Assigned To", "By When"], ["x", "y", "z"]];
    const h = detectHeader(grid, allowed);
    expect([...h.columns.values()]).toEqual(["name", "owner", "targetDate"]);
  });
});

describe("parseBulkDate", () => {
  it("reads DD-MMM-YYYY", () => {
    expect(parseBulkDate("12-Jun-2026")).toBe("2026-06-12");
    expect(parseBulkDate("1 Jan 2026")).toBe("2026-01-01");
    expect(parseBulkDate("05-Sept-2026")).toBe("2026-09-05");
  });

  it("reads YYYY-MM-DD", () => {
    expect(parseBulkDate("2026-06-12")).toBe("2026-06-12");
  });

  it("reads a real Excel serial, as a number or as text", () => {
    // 46185 = 2026-06-12.
    expect(parseBulkDate(46185)).toBe("2026-06-12");
    expect(parseBulkDate("46185")).toBe("2026-06-12");
  });

  it("reads the day-first regional form", () => {
    // Indian business: 03/04/2026 is the third of April.
    expect(parseBulkDate("03/04/2026")).toBe("2026-04-03");
    expect(parseBulkDate("12.06.26")).toBe("2026-06-12");
  });

  it("reads MMM DD, YYYY", () => {
    expect(parseBulkDate("Jun 12, 2026")).toBe("2026-06-12");
  });

  it("rejects an impossible date rather than rolling it forward", () => {
    expect(parseBulkDate("31-Feb-2026")).toBeNull();
    expect(parseBulkDate("2026-13-01")).toBeNull();
  });

  it("is null for blank and for prose", () => {
    expect(parseBulkDate("")).toBeNull();
    expect(parseBulkDate(null)).toBeNull();
    expect(parseBulkDate("next week")).toBeNull();
    // A bare small number is far likelier a typo than 1900-02-14.
    expect(parseBulkDate("45")).toBeNull();
  });
});

describe("matchOwner", () => {
  it("matches an exact name, however it was typed", () => {
    expect(matchOwner("Manan Vasa", roster)).toEqual({
      kind: "matched",
      id: "e1",
      name: "Manan Vasa",
    });
    expect(matchOwner("  manan  vasa ", roster)).toMatchObject({ id: "e1" });
  });

  it("matches an email", () => {
    expect(matchOwner("riddhi@example.com", roster)).toMatchObject({ id: "e2" });
  });

  it("matches a unique prefix", () => {
    // "Manan" finds Manan Vasa when he is the only Manan.
    expect(matchOwner("Manan", roster)).toMatchObject({ id: "e1" });
    expect(matchOwner("Mih", roster)).toMatchObject({ id: "e3" });
  });

  it("NEVER GUESSES between two people", () => {
    // The wrong doer on forty imported actions is forty notifications to the
    // wrong person.
    const two = [...roster, { id: "e4", name: "Manan Doshi" }];
    const m = matchOwner("Manan", two);
    expect(m.kind).toBe("ambiguous");
    if (m.kind === "ambiguous") expect(m.candidates).toHaveLength(2);
  });

  it("is none for blank and for a stranger", () => {
    expect(matchOwner("", roster).kind).toBe("none");
    expect(matchOwner("   ", roster).kind).toBe("none");
    expect(matchOwner("Nobody At All", roster).kind).toBe("none");
  });
});

describe("readBulkGrid", () => {
  const base = { kind: "action" as const, roster, existingNames: [] };

  it("reads a headered grid", () => {
    const grid = [
      ["Name", "Owner", "Target Date", "Description"],
      ["Vendor demo", "Manan", "12-Jun-2026", "Book the slot"],
      ["Install readers", "Riddhi", "2026-07-01", ""],
    ];
    const { rows } = readBulkGrid(grid, base);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Vendor demo",
      ownerId: "e1",
      targetDate: "2026-06-12",
      description: "Book the slot",
    });
    expect(rows[1]!.description).toBeNull();
  });

  it("treats the first column as the name when there is no header", () => {
    const { rows } = readBulkGrid([["Vendor demo"], ["Install readers"]], base);
    expect(rows.map((r) => r.name)).toEqual(["Vendor demo", "Install readers"]);
  });

  it("skips blank lines", () => {
    const { rows } = readBulkGrid([["A"], [""], ["  "], ["B"]], base);
    expect(rows).toHaveLength(2);
  });

  it("refuses more than the cap, with a sentence", () => {
    const grid = Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => [`Row ${i}`]);
    const res = readBulkGrid(grid, base);
    expect(res.rows).toEqual([]);
    expect(res.error).toMatch(/limit is 300/);
  });

  it("accepts exactly the cap", () => {
    const grid = Array.from({ length: BULK_MAX_ROWS }, (_, i) => [`Row ${i}`]);
    expect(readBulkGrid(grid, base).rows).toHaveLength(BULK_MAX_ROWS);
  });
});

describe("parsePastedGrid", () => {
  it("splits Excel's tabs", () => {
    expect(parsePastedGrid("Name\tOwner\nVendor demo\tManan")).toEqual([
      ["Name", "Owner"],
      ["Vendor demo", "Manan"],
    ]);
  });

  it("splits CSV, honouring quotes", () => {
    expect(parsePastedGrid('Vendor demo,"Shah, Riddhi"')).toEqual([
      ["Vendor demo", "Shah, Riddhi"],
    ]);
  });

  it("reads a bare column of names", () => {
    expect(parsePastedGrid("Vendor demo\nInstall readers\n")).toEqual([
      ["Vendor demo"],
      ["Install readers"],
    ]);
  });
});

/* ── Validation ──────────────────────────────────────────────────────────── */

function row(over: Partial<BulkRow> = {}): BulkRow {
  return {
    key: "k1",
    name: "Vendor demo",
    ownerId: "e1",
    ownerText: "Manan",
    targetDate: "2026-06-12",
    startDate: null,
    endDate: null,
    description: null,
    issues: [],
    include: true,
    ...over,
  };
}

describe("evaluateBulkRows", () => {
  const opts = { kind: "action" as const, existingNames: [] as string[] };

  it("blocks a missing name and unticks it", () => {
    const [r] = evaluateBulkRows([row({ name: "  " })], opts);
    expect(r!.issues.some((i) => i.code === "name-missing")).toBe(true);
    expect(r!.include).toBe(false);
  });

  it("blocks an over-long name", () => {
    const [r] = evaluateBulkRows([row({ name: "x".repeat(161) })], opts);
    expect(r!.issues.some((i) => i.code === "name-too-long")).toBe(true);
    expect(r!.include).toBe(false);
  });

  it("blocks an end before its start", () => {
    const [r] = evaluateBulkRows(
      [row({ startDate: "2026-07-01", endDate: "2026-06-01" })],
      opts,
    );
    expect(r!.issues.some((i) => i.code === "end-before-start")).toBe(true);
  });

  it("only the name is required — a bare name is clean", () => {
    const [r] = evaluateBulkRows(
      [row({ ownerId: null, ownerText: "", targetDate: null })],
      { kind: "milestone", existingNames: [] },
    );
    expect(r!.issues).toEqual([]);
    expect(r!.include).toBe(true);
  });

  it("warns without blocking on an unmatched owner", () => {
    const [r] = evaluateBulkRows(
      [row({ ownerId: null, ownerText: "Someone Else" })],
      opts,
    );
    expect(r!.issues.some((i) => i.code === "owner-unmatched")).toBe(true);
    expect(r!.include).toBe(true);
  });

  it("warns 'no task yet' on a task level missing an owner or a date", () => {
    const [r] = evaluateBulkRows([row({ targetDate: null })], opts);
    expect(r!.issues.some((i) => i.code === "not-scheduled")).toBe(true);
    expect(r!.include).toBe(true);
  });

  it("says nothing about scheduling on a container level", () => {
    const [r] = evaluateBulkRows([row({ ownerId: null, ownerText: "" })], {
      kind: "milestone",
      existingNames: [],
    });
    expect(r!.issues.some((i) => i.code === "not-scheduled")).toBe(false);
  });

  it("flags a duplicate of what already sits under the parent", () => {
    const [r] = evaluateBulkRows([row({ name: "Vendor Demo" })], {
      kind: "action",
      existingNames: ["vendor demo"],
    });
    expect(r!.issues.some((i) => i.code === "duplicate-existing")).toBe(true);
  });

  it("flags a repeat within the same file, on the SECOND occurrence", () => {
    const rows = evaluateBulkRows(
      [row({ key: "a" }), row({ key: "b" })],
      opts,
    );
    expect(rows[0]!.issues.some((i) => i.code === "duplicate-file")).toBe(false);
    expect(rows[1]!.issues.some((i) => i.code === "duplicate-file")).toBe(true);
  });

  it("re-evaluates the WHOLE set, so editing one name clears the other's flag", () => {
    const first = evaluateBulkRows([row({ key: "a" }), row({ key: "b" })], opts);
    expect(first[1]!.issues.some((i) => i.code === "duplicate-file")).toBe(true);

    const edited = evaluateBulkRows(
      [first[0]!, { ...first[1]!, name: "Install readers" }],
      { ...opts, previous: first },
    );
    expect(edited[1]!.issues.some((i) => i.code === "duplicate-file")).toBe(false);
  });

  it("KEEPS a clean row's tick through an unrelated edit", () => {
    // Typing in one name box must not silently re-tick forty rows somebody had
    // just unticked.
    const first = evaluateBulkRows([row({ key: "a" }), row({ key: "b", name: "Other" })], opts);
    const unticked = [{ ...first[0]!, include: false }, first[1]!];
    const after = evaluateBulkRows(
      [unticked[0]!, { ...unticked[1]!, name: "Other renamed" }],
      { ...opts, previous: unticked },
    );
    expect(after[0]!.include).toBe(false);
    expect(after[1]!.include).toBe(true);
  });

  it("re-offers a row that just became valid", () => {
    const broken = evaluateBulkRows([row({ key: "a", name: "" })], opts);
    expect(broken[0]!.include).toBe(false);
    const fixed = evaluateBulkRows(
      [{ ...broken[0]!, name: "Now named" }],
      { ...opts, previous: broken },
    );
    expect(fixed[0]!.include).toBe(true);
  });
});
