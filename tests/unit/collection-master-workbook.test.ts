import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  autoMap,
  columnLetter,
  extractRows,
  readSheet,
  readWorkbook,
  unmappedColumns,
  unnamedMappedColumns,
} from "@/lib/collections/master/workbook";
import { coordinatorLabel, isUnassignedCoordinator, nameKey, paymentTermsText } from "@/lib/collections/master/normalize";

/** A workbook shaped like the real master file: Name | (no header) | Payment Terms | (no header). */
function book(rows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readWorkbook(buf);
}

const MASTER = [
  ["Name", null, "Payment Terms", null],
  ["Alpha Traders", "BK", null, "BH"],
  ["Beta Corp", "XXX", null, null],
  ["Gamma Ltd", "-", null, "GR"],
  ["Delta Inc", null, null, null],
];

describe("header mapping", () => {
  it("finds the header row and maps only real headers", () => {
    const r = readSheet(book([["Company master"], [], ...MASTER]), "Sheet1");
    expect(r.rows[r.headerRow]?.[0]).toBe("Name");
    const m = autoMap(r.columns);
    expect(m.company).toBe(0);
    expect(m.paymentTerms).toBe(2);
    // Column B holds coordinators but has no header: never picked automatically.
    expect(m.coordinator).toBeNull();
  });

  it("labels unnamed columns and shows their values", () => {
    const r = readSheet(book(MASTER), "Sheet1");
    const b = r.columns.find((c) => c.index === 1)!;
    expect(b.header).toBeNull();
    expect(b.label).toBe("Unnamed column B");
    expect(b.filled).toBe(3);
    expect(b.topValues.map((v) => v.value).sort()).toEqual(["-", "BK", "XXX"]);
    const d = r.columns.find((c) => c.index === 3)!;
    expect(d.label).toBe("Unnamed column D");
    expect(d.topValues).toEqual(expect.arrayContaining([{ value: "BH", count: 1 }, { value: "GR", count: 1 }]));
  });

  it("an unnamed column left unmapped is listed as not imported; mapping one needs confirmation", () => {
    const r = readSheet(book(MASTER), "Sheet1");
    const auto = autoMap(r.columns);
    expect(unmappedColumns(r.columns, auto).map((c) => c.letter)).toEqual(["B", "D"]);
    expect(unnamedMappedColumns(r.columns, auto)).toEqual([]);
    const chosen = { ...auto, coordinator: 1 };
    expect(unnamedMappedColumns(r.columns, chosen).map((x) => [x.field, x.column.letter])).toEqual([["coordinator", "B"]]);
    expect(unmappedColumns(r.columns, chosen).map((c) => c.letter)).toEqual(["D"]);
  });

  it("recognises common header spellings", () => {
    const r = readSheet(book([["Party Name", "Sales Coordinator", "Payment terms"], ["A", "X", "30 days"]]), "Sheet1");
    expect(autoMap(r.columns)).toEqual({ company: 0, coordinator: 1, paymentTerms: 2 });
  });

  it("extracts only the mapped fields, with real sheet row numbers, and drops blank rows", () => {
    const r = readSheet(
      book([...MASTER.slice(0, 2), [null, null, null, null], [null, "BK", null, null], [null, null, null, "BH"], ...MASTER.slice(2)]),
      "Sheet1",
    );
    const rows = extractRows(r, { company: 0, coordinator: 1, paymentTerms: 2 });
    // Row 3 is blank and row 5 has a value only in unmapped column D: nothing to import.
    expect(rows.map((x) => x.company)).toEqual(["Alpha Traders", "", "Beta Corp", "Gamma Ltd", "Delta Inc"]);
    expect(rows[0]).toEqual({ rowNo: 2, company: "Alpha Traders", coordinator: "BK", paymentTerms: "" });
    // The blank-name row is kept, with its real sheet row number, so the plan can reject it.
    expect(rows[1]).toMatchObject({ rowNo: 4, company: "", coordinator: "BK" });
    expect(rows[2]!.rowNo).toBe(6);
    // Column D was not mapped, so its values never reach a row.
    expect(JSON.stringify(rows)).not.toContain("GR");
  });

  it("column letters past Z", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});

describe("placeholders and blank values", () => {
  it("blank, XXX and - all mean Unassigned", () => {
    for (const v of ["", "   ", "XXX", "xxx", " - ", null]) {
      expect(coordinatorLabel(v)).toBeNull();
    }
    expect(isUnassignedCoordinator("XXX")).toBe(true);
    expect(isUnassignedCoordinator("BK")).toBe(false);
  });
  it("a real label is kept as text — never turned into an employee", () => {
    expect(coordinatorLabel("  BK ")).toBe("BK");
    expect(coordinatorLabel("Monica Veera")).toBe("Monica Veera");
  });
  it("payment terms stay as written; blank is null, never guessed", () => {
    expect(paymentTermsText("")).toBeNull();
    expect(paymentTermsText("  30 days  ")).toBe("30 days");
    expect(paymentTermsText("Advance")).toBe("Advance");
  });
  it("company identity ignores case, spacing and punctuation", () => {
    expect(nameKey("ABC Traders Pvt. Ltd.")).toBe(nameKey(" abc  traders pvt ltd "));
    expect(nameKey("!!!")).toBe("");
  });
});
