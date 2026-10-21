import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { autoMap, extractRows, readSheet, readWorkbook, suggestCoordinatorColumn } from "@/lib/collections/master/workbook";
import { buildMasterPlan, type ExistingCompany } from "@/lib/collections/master/plan";
import { nameKey } from "@/lib/collections/master/normalize";
import { COLLECTION_RULES } from "@/lib/collections/config";

/**
 * A workbook shaped like the real company master file (headers and value
 * patterns inspected from it; the names here are made up): column A "Name",
 * column B with NO header holding the Sales Coordinator in mixed case plus the
 * XXX / "-" placeholders, column C "Payment Terms" (empty), column D with no
 * header and a few unexplained short codes.
 */
function masterShaped(rows: [string, string | null, string | null][]): ReturnType<typeof readSheet> {
  const aoa: unknown[][] = [["Name", null, "Payment Terms", null]];
  for (const [name, coord, d] of rows) aoa.push([name, coord, null, d]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return readSheet(readWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer), "Sheet1");
}

const COORDS = ["Jyotsna", "XXX", "Mihir", "BHAVISHA", "SAVITA", "MANGESH", "Gauri", "Mangesh", "mangesh", "GAURI", "-", "MIHIR"];
const sample = Array.from({ length: 40 }, (_, i) => [`Company ${i + 1} Pvt Ltd`, COORDS[i % COORDS.length]!, i % 13 === 0 ? (i % 2 ? "GR" : "BH") : null] as [string, string, string | null]);

describe("finding the Sales Coordinator column", () => {
  it("picks the unnamed list-of-people column, not the sparse code column, and says why", () => {
    const r = masterShaped(sample);
    const auto = autoMap(r.columns);
    expect(auto).toEqual({ company: 0, coordinator: null, paymentTerms: 2 }); // header text alone can't find it
    const s = suggestCoordinatorColumn(r, auto);
    expect(s.index).toBe(1); // column B — chosen by its contents, not its position
    expect(s.reason).toMatch(/Unnamed column B looks like a list of people/);
    expect(r.columns.find((c) => c.index === 1)!.header).toBeNull(); // so the import screen still asks for confirmation
  });

  it("a header that says Sales Coordinator always wins", () => {
    const aoa = [["Party Name", "Sales Coordinator", "Notes"], ["A Co", "Mihir", "x"], ["B Co", "Gauri", "y"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "S");
    const r = readSheet(readWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer), "S");
    const auto = autoMap(r.columns);
    expect(auto.coordinator).toBe(1);
    expect(suggestCoordinatorColumn(r, auto)).toEqual({ index: 1, reason: "Chosen from the column header." });
  });

  it("does not guess when two columns qualify or none does", () => {
    const two = masterShaped(sample.map(([n, c]) => [n, c, c]));
    expect(suggestCoordinatorColumn(two, autoMap(two.columns))).toMatchObject({ index: null, reason: expect.stringMatching(/More than one unnamed column.*B, D/) });
    const none = masterShaped(sample.map(([n], i) => [n, i % 5 === 0 ? "Mihir" : null, null]));
    expect(suggestCoordinatorColumn(none, autoMap(none.columns)).index).toBeNull();
  });

  it("the detection thresholds come from the configuration", () => {
    const r = masterShaped(sample);
    const strict = { ...COLLECTION_RULES, coordinatorColumnDetection: { minFillRatio: 0.5, maxDistinctValues: 5, minLetterRatio: 0.9 } };
    expect(suggestCoordinatorColumn(r, autoMap(r.columns), strict).index).toBeNull();
  });
});

describe("coordinator values from the file", () => {
  const plan = (rows: [string, string][], existing: ExistingCompany[] = [], known: string[] = []) =>
    buildMasterPlan(
      rows.map(([company, coordinator], i) => ({ rowNo: i + 2, company, coordinator, paymentTerms: "" })),
      new Map(existing.map((e) => [e.nameKey, e])),
      new Map(),
      { mapped: { coordinator: true, paymentTerms: false }, knownCoordinatorLabels: known },
    );

  it("one person in several capitalisations is stored and shown as one spelling", () => {
    const p = plan([["A", "MANGESH"], ["B", "MANGESH"], ["C", "Mangesh"], ["D", "mangesh"], ["E", "Gauri"]]);
    expect(p.rows.map((r) => r.coordinatorLabel)).toEqual(["MANGESH", "MANGESH", "MANGESH", "MANGESH", "Gauri"]);
    expect(p.summary.coordinatorSpellingsUnified).toBe(2);
    expect(p.summary.coordinatorLabels).toEqual([{ label: "MANGESH", rows: 4 }, { label: "Gauri", rows: 1 }]);
    expect(p.rows[2]!.messages.some((m) => /written "Mangesh" — shown as "MANGESH"/.test(m.text))).toBe(true);
  });

  it("a spelling already in the Collection Master wins, and only unseen people are listed as new", () => {
    const p = plan([["A", "MANGESH"], ["B", "Jyotsna"]], [], ["Mangesh"]);
    expect(p.rows[0]!.coordinatorLabel).toBe("Mangesh");
    expect(p.summary.newCoordinatorLabels).toEqual(["Jyotsna"]);
  });

  it("placeholders and blanks are Unassigned; a cell with no letters is reported, never assigned", () => {
    const p = plan([["A", "XXX"], ["B", "-"], ["C", ""], ["D", "123"], ["E", "??"]]);
    expect(p.rows.map((r) => r.coordinatorLabel)).toEqual([null, null, null, null, null]);
    expect(p.summary.invalidCoordinators).toBe(2);
    expect(p.summary.placeholderCoordinators).toBe(2);
    expect(p.rows[3]!.messages.some((m) => m.level === "warning" && /isn't a name/.test(m.text))).toBe(true);
    expect(p.summary.coordinatorLabels).toEqual([]);
  });

  it("re-import: another capitalisation of the stored person is unchanged, a different person is a change to accept", () => {
    const stored = (name: string, coord: string): ExistingCompany => ({ id: `id-${name}`, companyName: name, nameKey: nameKey(name), coordinatorLabel: coord, paymentTerms: null, customerMasterId: null });
    const p = plan([["Alpha", "MANGESH"], ["Beta", "Gauri"]], [stored("Alpha", "Mangesh"), stored("Beta", "Mihir")], ["Mangesh", "Mihir"]);
    expect(p.rows.map((r) => r.status)).toEqual(["unchanged", "changed"]);
    expect(p.rows[1]!.changes).toEqual([{ field: "coordinatorLabel", from: "Mihir", to: "Gauri" }]);
  });

  it("the same company with two different people is still a conflict, whatever the case", () => {
    const p = plan([["Alpha", "Mihir"], ["alpha", "GAURI"]]);
    expect(p.rows.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(p.summary.conflictGroups).toBe(1);
  });

  it("end to end from the master-shaped file: extraction, suggestion and plan agree", () => {
    const r = masterShaped(sample);
    const auto = autoMap(r.columns);
    const mapping = { ...auto, coordinator: suggestCoordinatorColumn(r, auto).index };
    const rows = extractRows(r, mapping);
    expect(rows[0]).toEqual({ rowNo: 2, company: "Company 1 Pvt Ltd", coordinator: "Jyotsna", paymentTerms: "" });
    const p = buildMasterPlan(rows, new Map(), new Map(), { mapped: { coordinator: true, paymentTerms: true } });
    const labels = p.summary.coordinatorLabels.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Jyotsna", "Mihir", "BHAVISHA", "SAVITA", "MANGESH", "Gauri"]));
    expect(labels.filter((l) => l.toLowerCase() === "mangesh")).toHaveLength(1);
    expect(JSON.stringify(p.rows)).not.toMatch(/"(BH|GR)"/); // column D is never imported
  });
});
