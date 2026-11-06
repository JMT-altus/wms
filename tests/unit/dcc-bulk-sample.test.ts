import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseBulkImport, countLines } from "@/lib/dcc/bulk-import";
import { DCC_BULK_SAMPLE, DCC_BULK_SAMPLE_FILENAME, DCC_BULK_FORMAT_GUIDE } from "@/lib/dcc/bulk-sample";

// The Bulk KPI setup's downloadable sample must paste straight into Checklist Text: the real parser reads every
// tab and KPI in it with no errors, and every frequency and input type is one the parser accepts.
describe("DCC bulk KPI sample", () => {
  it("parses cleanly with the existing parser: two tabs, eight KPIs, no errors or problem lines", () => {
    const parsed = parseBulkImport(DCC_BULK_SAMPLE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groups.map((g) => g.label)).toEqual(["Tab 1 - Employee name", "Tab 2 - Employee name"]);
    expect(parsed.groups.every((g) => g.errors.length === 0)).toBe(true);
    expect(countLines(parsed.groups)).toEqual({ groups: 2, lines: 8, invalid: 0 });
    for (const l of parsed.groups.flatMap((g) => g.lines)) {
      expect(l.errors, `line ${l.line}`).toEqual([]);
      expect(l.inputType).not.toBeNull();
      expect(l.parsed.needsReview, `line ${l.line} frequency "${l.frequency}"`).toBe(false);
    }
  });

  it("keeps the serial numbers and titles exactly, and maps the input types and frequencies as the parser does", () => {
    const [a, b] = parseBulkImport(DCC_BULK_SAMPLE).groups;
    expect(a!.lines.map((l) => [l.sr, l.title, l.inputType])).toEqual([
      ["1", "Tally - Total Value of SO Recd", "number"],
      ["2", "Sales - Weekly Calls Sheet Done? (Y/N)", "yesno"],
      ["9", "Sales - Enquiry Funnel - Updated?", "yesno"],
      ["4.1", "To whom & what brand?", "text"],
    ]);
    expect(a!.lines[2]!.parsed.scheduleKind).toBe("scheduled"); // "Sat / Tues": a day list
    expect(b!.lines[3]!.parsed.scheduleKind).toBe("weekly");
  });

  it("is a plain .txt with Windows line endings (the parser accepts them), and the guide names the parser's words", () => {
    expect(DCC_BULK_SAMPLE_FILENAME).toMatch(/\.txt$/);
    expect(DCC_BULK_SAMPLE).toContain("\r\n");
    const guide = DCC_BULK_FORMAT_GUIDE.map((g) => g.detail).join(" ");
    for (const w of ["Daily", "Weekly", "Monthly", "Number", "Yes/No", "Text", "|"]) expect(guide).toContain(w);
  });

  it("the popup offers the download beside Checklist Text and leaves preview and apply as they were", () => {
    const src = readFileSync(path.resolve(__dirname, "../../components/dcc/dcc-bulk-import-dialog.tsx"), "utf8");
    expect(src).toMatch(/Download sample/);
    expect(src).toMatch(/a\.download = DCC_BULK_SAMPLE_FILENAME/);
    expect(src).toMatch(/previewDccBulkImport\(\{ text, mapping: nextMapping \}\)/);
    expect(src).toMatch(/applyDccBulkImport\(\{ text, mapping, updateDiffering \}\)/);
  });
});
