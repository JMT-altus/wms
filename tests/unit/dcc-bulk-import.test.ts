import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseBulkImport, normaliseInputType, normaliseTitle, suggestEmployee, countLines } from "@/lib/dcc/bulk-import";
import { parseFrequency, MASK_MON_SAT } from "@/lib/dcc/util";

// The bulk-setup parser: what a pasted checklist becomes before anything is written.
const TUE = 1 << 1;
const SAT = 1 << 5;

describe("format", () => {
  it("groups under '#' headers; Sr No | Title | Frequency | Type with pipes or tabs; Sr No optional", () => {
    const r = parseBulkImport(["# AR – Asha", "1 | Tally - Total Value of SO Recd | Daily | Number", "2\tBook - Quotations Given\tDaily\tNumber", "Weekly review | Weekly | Yes/No", "", "# Second tab", "1 | Something | Daily | Text"].join("\n"));
    expect(r.errors).toEqual([]);
    expect(r.groups.map((g) => [g.label, g.lines.length])).toEqual([
      ["AR – Asha", 3],
      ["Second tab", 1],
    ]);
    const [a, b, c] = r.groups[0]!.lines;
    expect([a!.sr, a!.title, a!.frequency, a!.inputType, a!.errors]).toEqual(["1", "Tally - Total Value of SO Recd", "Daily", "number", []]);
    expect([b!.sr, b!.title, b!.inputType]).toEqual(["2", "Book - Quotations Given", "number"]);
    expect([c!.sr, c!.title, c!.frequency, c!.inputType]).toEqual([null, "Weekly review", "Weekly", "yesno"]);
    expect(c!.parsed.scheduleKind).toBe("weekly");
  });

  it("a sheet copy with trailing empty day cells still reads", () => {
    const r = parseBulkImport("# T\n3\tTally - Total Collection Recd\tprev day\tNumber\t\t\t\t\t");
    expect(r.groups[0]!.lines[0]!.errors).toEqual([]);
    expect(r.groups[0]!.lines[0]!.parsed).toEqual({ scheduleKind: "scheduled", weekdays: MASK_MON_SAT, needsReview: false });
  });

  it("an empty frequency is allowed and NOT invented (ad-hoc tray, flagged for review), with a note", () => {
    const r = parseBulkImport("# T\n4.1 | To whom & what brand? | | Text");
    const l = r.groups[0]!.lines[0]!;
    expect(l.errors).toEqual([]);
    expect(l.frequency).toBeNull();
    expect(l.parsed).toEqual({ scheduleKind: "adhoc", weekdays: null, needsReview: true });
    expect(l.notes[0]).toMatch(/not invented/);
    expect(l.sr).toBe("4.1");
  });

  it("problems are per line and never silently fixed", () => {
    const r = parseBulkImport(["1 | before any header | Daily | Number", "# T", "1 | No type | Daily |", "2 | Bad type | Daily | Emoji", "3 | Bad frequency | Fortnightly-ish | Number", "4 | | Daily | Number", "5 | Dup | Daily | Number", "6 | dup | Daily | Text"].join("\n"));
    expect(r.errors[0]).toMatch(/before any group header/);
    const errs = r.groups[0]!.lines.map((l) => l.errors.join(" "));
    expect(errs[0]).toMatch(/input type is missing/);
    expect(errs[1]).toMatch(/not Number, Yes\/No or Text/);
    expect(errs[2]).toMatch(/not understood/);
    expect(errs[3]).toMatch(/title is missing/);
    expect(errs[4]).toBe("");
    expect(errs[5]).toMatch(/duplicate of an earlier line/);
    expect(countLines(r.groups)).toEqual({ groups: 1, lines: 6, invalid: 5 });
    expect(parseBulkImport("   ").errors[0]).toMatch(/Nothing to import/);
    expect(parseBulkImport("# A\n1|x|Daily|Number\n# a\n1|y|Daily|Number").errors[0]).toMatch(/appears twice/);
  });
});

describe("vocabulary", () => {
  it("input type words", () => {
    expect(["Number", "num", "Count", "value"].map(normaliseInputType)).toEqual(["number", "number", "number", "number"]);
    expect(["Yes/No", "Y/N", "Y/N/NA", "boolean", "yes-no"].map(normaliseInputType)).toEqual(["yesno", "yesno", "yesno", "yesno", "yesno"]);
    expect(["Text", "free text", "string"].map(normaliseInputType)).toEqual(["text", "text", "text"]);
    expect(normaliseInputType("Emoji")).toBeNull();
    expect(normaliseInputType("")).toBeNull();
  });

  it("titles match ignoring case and spacing — the idempotency key", () => {
    expect(normaliseTitle("  Tally -  Total Value of SO Recd ")).toBe(normaliseTitle("tally - total value of so recd"));
    expect(normaliseTitle("SO Done by 5:45pm? Y/N")).not.toBe(normaliseTitle("SO Done by 6:00pm with NO entry w/o prices? Y/N"));
  });

  it("frequencies the sheet uses: Daily, prev day, Sat / Tues, Weekly", () => {
    expect(parseFrequency("Daily")).toEqual({ scheduleKind: "scheduled", weekdays: MASK_MON_SAT, needsReview: false });
    expect(parseFrequency("Previous day")).toEqual({ scheduleKind: "scheduled", weekdays: MASK_MON_SAT, needsReview: false });
    expect(parseFrequency("prev. day")).toEqual({ scheduleKind: "scheduled", weekdays: MASK_MON_SAT, needsReview: false });
    expect(parseFrequency("Sat / Tues")).toEqual({ scheduleKind: "scheduled", weekdays: TUE | SAT, needsReview: false });
    expect(parseFrequency("Saturday / Tuesday")).toEqual({ scheduleKind: "scheduled", weekdays: TUE | SAT, needsReview: false });
    expect(parseFrequency("Weekly").scheduleKind).toBe("weekly");
  });
});

describe("suggesting the person a tab means (a suggestion only, never a decision)", () => {
  const people = [
    { id: "1", name: "Asha Rao" },
    { id: "2", name: "Bala Iyer" },
    { id: "3", name: "Chitra Nair" },
    { id: "4", name: "Asha Menon" },
  ];
  it("by first name in the label, by initials, and nobody when ambiguous or unknown", () => {
    expect(suggestEmployee("BI – Bala", people)?.id).toBe("2");
    expect(suggestEmployee("CN", people)?.id).toBe("3");
    expect(suggestEmployee("Chitra Nair (Support)", people)?.id).toBe("3");
    expect(suggestEmployee("AR – Asha", people)?.id).toBe("1"); // initials break the first-name tie
    expect(suggestEmployee("Asha", people)).toBeNull(); // two Ashas, no initials: nobody
    expect(suggestEmployee("NM_1 (no employee on the tab)", people)).toBeNull();
    expect(suggestEmployee("", people)).toBeNull();
  });
});

describe("the prepared checklist file (docs/dcc-kpi-import-2026-06.txt)", () => {
  const text = readFileSync(path.join(process.cwd(), "docs/dcc-kpi-import-2026-06.txt"), "utf8");
  const r = parseBulkImport(text);
  it("parses cleanly: six groups with the sheet's counts, every line valid", () => {
    expect(r.errors).toEqual([]);
    expect(r.groups.map((g) => [g.label.split(" ")[0], g.lines.length])).toEqual([
      ["BH", 17],
      ["JY", 17],
      ["NM", 16], // 15 numbered KPIs plus the 4.1 sub-detail
      ["SV", 14],
      ["GR", 13],
      ["NM_1", 15],
    ]);
    expect(countLines(r.groups).invalid).toBe(0);
  });
  it("keeps the special cases exactly: prev day, Sat / Tues, the unscheduled 4.1 sub-detail, the weekly GST line, Y/N/NA as the three-option answer", () => {
    const [bh, jy, nm, , gr] = r.groups;
    expect(bh!.lines[2]!.frequency).toBe("Previous day");
    expect(bh!.lines[2]!.parsed.scheduleKind).toBe("scheduled");
    expect(jy!.lines[2]!.frequency).toBe("Daily"); // Jyotsna's collection line is daily, as her sheet says
    for (const g of [bh!, jy!]) {
      expect(g.lines[8]!.parsed).toEqual({ scheduleKind: "scheduled", weekdays: TUE | SAT, needsReview: false });
      expect(g.lines[9]!.inputType).toBe("yesno"); // Y/N/NA: the Yes/No cell offers NA
    }
    expect(bh!.lines[15]!.title).toBe("SO Done by 5:45pm? Y/N");
    expect(jy!.lines[15]!.title).toBe("SO Done by 6:00pm with NO entry w/o prices? Y/N");
    const sub = nm!.lines[4]!;
    expect([sub.sr, sub.title, sub.frequency, sub.inputType]).toEqual(["4.1", "To whom & what brand?", null, "text"]);
    expect(gr!.lines[12]!.parsed.scheduleKind).toBe("weekly");
    expect(r.groups.flatMap((g) => g.lines).every((l) => l.inputType)).toBe(true);
  });
});
