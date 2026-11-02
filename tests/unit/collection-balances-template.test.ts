import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { buildBalanceTemplateWorkbook } from "@/lib/collections/balances/template-workbook";
import { readBalanceSheet, readBalanceWorkbook, parseBalanceRows } from "@/lib/collections/balances/workbook";
import { buildBalancePlan, type BalanceCompany } from "@/lib/collections/balances/plan";
import { nameKey } from "@/lib/collections/master/normalize";
import {
  BALANCE_TEMPLATE_HEADERS,
  BALANCE_TEMPLATE_SHEETS,
  SAMPLE_BALANCE_ROWS,
  countSampleRows,
  isSampleRowName,
} from "@/lib/collections/balances/template";

// The downloadable sample template, read back through the importer's own code:
// the same reader the browser uses, the same parser and plan the server runs.

let buf: Buffer;
beforeAll(async () => {
  buf = await buildBalanceTemplateWorkbook();
});

const master = (...names: string[]): Map<string, BalanceCompany> =>
  new Map(names.map((n, i) => [nameKey(n), { id: `c${i}`, companyName: n }]));

/** Open the template in ExcelJS, change it the way a person would in Excel, and save it again. */
async function filledIn(rows: [string, number | null, number | null][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet(BALANCE_TEMPLATE_SHEETS.data)!;
  // Replace the sample rows: delete them, insert the real rows in their place (above Grand Total).
  ws.spliceRows(3, SAMPLE_BALANCE_ROWS.length, ...rows.map((r) => [r[0], r[1] ?? undefined, r[2] ?? undefined]));
  // Excel recalculates the Grand Total on save; mirror that by storing the new result.
  const totalRow = ws.getRow(3 + rows.length);
  const paise = (i: 1 | 2) => rows.reduce((t, r) => t + Math.round((r[i] ?? 0) * 100), 0) / 100;
  const keep = (c: ExcelJS.Cell, v: number) => (c.value = { formula: (c.value as ExcelJS.CellFormulaValue).formula, result: v });
  keep(totalRow.getCell(2), paise(1));
  keep(totalRow.getCell(3), paise(2));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("the workbook", () => {
  it("has Collection Data first and Instructions second", () => {
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual([BALANCE_TEMPLATE_SHEETS.data, BALANCE_TEMPLATE_SHEETS.instructions]);
  });

  it("puts the importer's exact headings in row 2, with no merged cells in the data sheet", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(BALANCE_TEMPLATE_SHEETS.data)!;
    expect([1, 2, 3].map((c) => ws.getRow(2).getCell(c).value)).toEqual([...BALANCE_TEMPLATE_HEADERS]);
    expect(BALANCE_TEMPLATE_HEADERS).toEqual(["Particulars", "Debit", "Credit"]);
    expect(ws.model.merges ?? []).toEqual([]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 2 });
  });

  it("marks every sample row and leaves optional amounts blank", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(BALANCE_TEMPLATE_SHEETS.data)!;
    SAMPLE_BALANCE_ROWS.forEach((r, i) => {
      const row = ws.getRow(3 + i);
      expect(row.getCell(1).value).toBe(r.name);
      expect(isSampleRowName(String(row.getCell(1).value))).toBe(true);
      expect(row.getCell(2).value ?? null).toBe(r.debit);
      expect(row.getCell(3).value ?? null).toBe(r.credit);
      expect(typeof (row.getCell(2).value ?? 0)).toBe("number");
    });
    // One sample has no Credit and one has no Debit: blank, not 0.
    expect(SAMPLE_BALANCE_ROWS.some((r) => r.credit === null)).toBe(true);
    expect(SAMPLE_BALANCE_ROWS.some((r) => r.debit === null)).toBe(true);
  });

  it("totals with a formula that covers every row above it, its value cached in the file", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(BALANCE_TEMPLATE_SHEETS.data)!;
    const total = ws.getRow(3 + SAMPLE_BALANCE_ROWS.length);
    expect(total.getCell(1).value).toBe("Grand Total");
    const d = total.getCell(2).value as ExcelJS.CellFormulaValue;
    expect(d.formula).toBe("SUM(B2:INDEX(B:B,ROW()-1))");
    expect(d.result).toBe(173500.5);
    expect((total.getCell(3).value as ExcelJS.CellFormulaValue).result).toBe(9250);
  });

  it("checks Debit and Credit are numbers when typed in Excel", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(BALANCE_TEMPLATE_SHEETS.data)!;
    for (const a of ["B3", "C3", "B500", "C4999"]) expect(ws.getCell(a).dataValidation).toMatchObject({ type: "decimal", showErrorMessage: true });
    expect(ws.getCell("A3").dataValidation ?? null).toBeFalsy();
  });

  it("the Instructions sheet covers every topic and can never be read as data", async () => {
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[BALANCE_TEMPLATE_SHEETS.instructions]!, { header: 1, raw: true, defval: null });
    expect(parseBalanceRows(rows, "Instructions").ok).toBe(false);
    const text = rows.flat().filter(Boolean).join(" \n ");
    for (const topic of ["Particulars (column A)", "Debit (column B)", "Credit (column C)", "Required", "Optional", "Reporting period", "Numbers", "Company names", "Sales Coordinator", "Blank values", "Avoiding duplicates", "Uploading the file", "Sample rows", "Preview upload", "Upload balances"]) {
      expect(text).toContain(topic);
    }
  });
});

describe("the importer reads the template exactly as downloaded", () => {
  it("finds the headings, the three sample rows, the period and the Grand Total", () => {
    const res = readBalanceSheet(readBalanceWorkbook(new Uint8Array(buf)));
    if (!res.ok) throw new Error(res.error);
    expect(res.sheet.sheet).toBe(BALANCE_TEMPLATE_SHEETS.data);
    expect(res.sheet.particularsRow).toBe(2);
    expect(res.sheet.periodFrom).toBe("2026-04-01");
    expect(res.sheet.periodTo).toBe("2026-10-31");
    expect(res.sheet.rows.map((r) => [r.name, r.debit, r.credit])).toEqual([
      ["SAMPLE - Example Traders Pvt Ltd", "125000", ""],
      ["SAMPLE - Demo Engineering Works", "48500.5", "2000"],
      ["SAMPLE - Test Industries LLP", "", "7250"],
    ]);
    expect(res.sheet.sourceTotal).toEqual({ debit: "173500.5", credit: "9250" });
    expect(countSampleRows(res.sheet.rows)).toBe(3);
  });

  it("passes the number and total checks, and imports nothing: the sample companies match no one", () => {
    const res = readBalanceSheet(readBalanceWorkbook(new Uint8Array(buf)));
    if (!res.ok) throw new Error(res.error);
    // Even a Master holding a company with the same name minus the marker does not match a sample row.
    const plan = buildBalancePlan(res.sheet.rows, master("Example Traders Pvt Ltd", "Demo Engineering Works", "Test Industries LLP"), res.sheet.sourceTotal);
    expect(plan.summary.verification.status).toBe("ok");
    expect(plan.summary.rejected).toBe(0);
    expect(plan.summary.unmatched).toBe(3);
    expect(plan.summary.matched).toBe(0);
    expect(plan.toWrite).toEqual([]);
  });

  it("also reads as CSV when the Collection Data sheet is saved that way", () => {
    const wb = XLSX.read(buf, { type: "buffer" });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[BALANCE_TEMPLATE_SHEETS.data]!);
    const res = readBalanceSheet(readBalanceWorkbook(csv));
    if (!res.ok) throw new Error(res.error);
    expect(res.sheet.rows).toHaveLength(3);
    expect(res.sheet.periodFrom).toBe("2026-04-01");
  });
});

describe("a completed template uploads", () => {
  it("real companies replace the samples; the plan matches them and the totals agree", async () => {
    const done = await filledIn([
      ["Alpha Traders", 100000, null],
      ["Beta Works", 2500.75, 500],
      ["Gamma Pvt Ltd", null, 1200],
      ["Delta Co", 0, null],
    ]);
    const res = readBalanceSheet(readBalanceWorkbook(new Uint8Array(done)));
    if (!res.ok) throw new Error(res.error);
    expect(countSampleRows(res.sheet.rows)).toBe(0);
    expect(res.sheet.rows.map((r) => r.name)).toEqual(["Alpha Traders", "Beta Works", "Gamma Pvt Ltd", "Delta Co"]);
    const plan = buildBalancePlan(res.sheet.rows, master("Alpha Traders", "Beta Works", "Gamma Pvt Ltd", "Delta Co"), res.sheet.sourceTotal);
    expect(plan.summary.verification.status).toBe("ok");
    expect(plan.summary.matched).toBe(4);
    expect(plan.summary.rejected).toBe(0);
    expect(plan.toWrite.map((r) => [r.name, r.debitPaise, r.creditPaise])).toEqual([
      ["Alpha Traders", 10000000, null],
      ["Beta Works", 250075, 50000],
      ["Gamma Pvt Ltd", null, 120000],
      ["Delta Co", 0, null],
    ]);
  });

  it("with all rows deleted the Grand Total formula stays valid and the importer says there is nothing to read", async () => {
    const done = await filledIn([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(done as unknown as ExcelJS.Buffer);
    const cell = wb.getWorksheet(BALANCE_TEMPLATE_SHEETS.data)!.getCell("B3");
    expect((cell.value as ExcelJS.CellFormulaValue).formula).toBe("SUM(B2:INDEX(B:B,ROW()-1))"); // B2:B2, no self-reference
    const res = readBalanceSheet(readBalanceWorkbook(new Uint8Array(done)));
    expect(res.ok).toBe(false);
  });
});

describe("sample row detection", () => {
  it("is the template's marker only", () => {
    expect(isSampleRowName("SAMPLE - Example Traders Pvt Ltd")).toBe(true);
    expect(isSampleRowName("  sample -   Demo ")).toBe(true);
    expect(isSampleRowName("Sample Industries")).toBe(false);
    expect(isSampleRowName("Example Traders Pvt Ltd")).toBe(false);
  });
});
