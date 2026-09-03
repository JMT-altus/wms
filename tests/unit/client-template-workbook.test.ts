import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  TEMPLATE_SHEET_NAME,
  buildClientTemplateWorkbook,
} from "@/lib/forms/client-template-workbook";
import {
  STANDARD_COLUMN_KEYS,
  type ClientBulkOptions,
} from "@/lib/forms/client-bulk-columns";

const options: ClientBulkOptions = {
  salesPeople: ["Mihir Veera", "Anita Rao"],
  products: ["Flat Bar 40", "Round Rod 12"],
  customerTypes: ["End User", "Traders", "OEM"],
  industryTypes: ["Automotive", "Textile"],
  gstRegistrationTypes: ["Regular", "Composition"],
  states: ["Gujarat", "Maharashtra"],
  countries: ["India"],
  currencies: ["INR", "USD"],
  paymentTerms: ["100% Advance", "Against Delivery"],
  freightCharges: ["To Pay"],
  transporters: ["VRL"],
  quantityDeviations: ["+/- 5%"],
  grades: [],
  yesNo: [],
  activeStatus: [],
};

/** Load a generated workbook back, the way Sheets or Excel would read it. */
async function build(keys: readonly string[]): Promise<ExcelJS.Workbook> {
  const buffer = await buildClientTemplateWorkbook(keys, options);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

/** The validation on the first data cell of the column with this heading. */
function validationFor(wb: ExcelJS.Workbook, heading: string) {
  const ws = wb.getWorksheet(TEMPLATE_SHEET_NAME)!;
  const headers = ws.getRow(1).values as (string | undefined)[];
  const index = headers.findIndex((h) => h === heading);
  expect(index, `no column headed "${heading}"`).toBeGreaterThan(0);
  return ws.getCell(2, index).dataValidation as ExcelJS.DataValidation | undefined;
}

describe("buildClientTemplateWorkbook", () => {
  let wb: ExcelJS.Workbook;
  beforeAll(async () => {
    wb = await build(STANDARD_COLUMN_KEYS);
  });

  it("puts the data sheet first, because an upload reads sheet one", () => {
    expect(wb.worksheets[0]!.name).toBe(TEMPLATE_SHEET_NAME);
  });

  it("writes the sheet's headings, marking the required one", () => {
    const ws = wb.getWorksheet(TEMPLATE_SHEET_NAME)!;
    expect(ws.getRow(1).values).toEqual([
      undefined,
      "Company *",
      "GSTIN",
      "Sales Co-ordinator",
      "Grade",
      "Tags",
      "Customer Type",
      "Industry Type",
      "Credit Limit",
      "Focused View",
      "Status",
    ]);
  });

  it("carries the live lists on a hidden sheet", () => {
    const lists = wb.getWorksheet("_Lookups")!;
    expect(lists.state).toBe("hidden");
    const column = lists.getColumn(1).values as (string | undefined)[];
    expect(column[1]).toBe("Sales Co-ordinator");
    expect(column.slice(2)).toEqual(["Mihir Veera", "Anita Rao"]);
  });

  it("gives an option-backed column a dropdown over a range, not an inline list", () => {
    const v = validationFor(wb, "Sales Co-ordinator");
    expect(v?.type).toBe("list");
    expect(v?.allowBlank).toBe(true);
    // A range: an inline "A,B,C" formula silently loses the dropdown past 255
    // characters, which a real roster passes.
    expect(v?.formulae?.[0]).toMatch(/^_Lookups!\$[A-Z]+\$2:\$[A-Z]+\$3$/);
  });

  it("rejects an off-list value where the value must resolve to a row or an enum", () => {
    for (const heading of ["Sales Co-ordinator", "Grade", "Status", "Focused View"]) {
      expect(validationFor(wb, heading)?.showErrorMessage, heading).toBe(true);
    }
  });

  it("only suggests where the column is stored as free text or takes several values", async () => {
    const wide = await build([
      "state",
      "paymentTerms",
      "currency",
      "customerTypes",
      "products",
      "exportClient",
    ]);
    for (const heading of [
      "State",
      "Payment Terms",
      "Currency",
      "Customer Type",
      "Product Types",
      "Export",
    ]) {
      const v = validationFor(wide, heading);
      // The dropdown is there…
      expect(v?.type, heading).toBe("list");
      expect(v?.formulae?.[0], heading).toMatch(/^_Lookups!/);
      // …but typing your own value is not blocked. Absent reads as false:
      // exceljs omits the attribute when it writes the XML default.
      expect(v?.showErrorMessage ?? false, heading).toBe(false);
    }
  });

  it("covers every row the import will accept", async () => {
    const ws = wb.getWorksheet(TEMPLATE_SHEET_NAME)!;
    const headers = ws.getRow(1).values as (string | undefined)[];
    const index = headers.findIndex((h) => h === "Grade");
    expect(ws.getCell(501, index).dataValidation?.type).toBe("list");
    expect(ws.getCell(502, index).dataValidation).toBeUndefined();
  });

  it("leaves a column with no options alone", () => {
    // GSTIN is free text with no master behind it — a dropdown would be a lie.
    expect(validationFor(wb, "GSTIN")).toBeUndefined();
  });

  it("builds only the columns it was asked for, in catalogue order", async () => {
    const picked = await build(["isActive", "name", "gstin"]);
    expect(picked.getWorksheet(TEMPLATE_SHEET_NAME)!.getRow(1).values).toEqual([
      undefined,
      "Company *",
      "GSTIN",
      "Status",
    ]);
  });

  it("falls back to the standard columns when asked for nothing usable", async () => {
    const fallback = await build(["not-a-column"]);
    const headers = fallback.getWorksheet(TEMPLATE_SHEET_NAME)!.getRow(1).values as string[];
    expect(headers).toHaveLength(STANDARD_COLUMN_KEYS.length + 1);
    expect(headers[1]).toBe("Company *");
  });

  it("ships the instructions visible — a hidden instruction is no instruction", () => {
    const help = wb.getWorksheet("How to fill this in")!;
    expect(help.state).toBe("visible");
    const lines = (help.getColumn(1).values as (string | undefined)[]).filter(Boolean).join("\n");
    expect(lines).toContain("Company is the only column that must be filled in");
    expect(lines).toContain("type a comma and add the next");
    expect(lines).toContain("Status blank = Active");
  });
});
