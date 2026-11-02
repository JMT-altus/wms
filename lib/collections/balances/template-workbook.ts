import ExcelJS from "exceljs";
import {
  BALANCE_TEMPLATE_HEADERS,
  BALANCE_TEMPLATE_PERIOD_LABEL,
  BALANCE_TEMPLATE_SAMPLE_PERIOD,
  BALANCE_TEMPLATE_SHEETS,
  BALANCE_TEMPLATE_TOTAL_LABEL,
  SAMPLE_BALANCE_ROWS,
  SAMPLE_ROW_PREFIX,
} from "./template";

/**
 * The downloadable Collection Tracker Bulk Upload sample workbook.
 *
 * Sheet 1 "Collection Data" is laid out exactly as the importer reads it:
 *   row 1  Reporting period | 1-Apr-26 to 31-Oct-26          (optional)
 *   row 2  Particulars | Debit | Credit                       (the headings)
 *   rows   SAMPLE - … company rows                            (delete before uploading)
 *   last   Grand Total | =SUM(…) | =SUM(…)
 * The Grand Total adds every row between the headings and itself, wherever
 * rows are inserted or deleted, so it stays right as people fill the sheet.
 * Its value is also written into the file, so the template uploads as it is.
 *
 * Sheet 2 "Instructions" explains every column and rule in plain words. It
 * never repeats a heading on its own in a cell, so the importer (which takes
 * the first sheet that has the headings) can never mistake it for data.
 */

const BLUE = "FF0A6CFF";
const INK = "FF1E293B";
const SOFT = "FF64748B";
const SAMPLE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7D6" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEF9" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF4FF" } };
const MONEY_FMT = "#,##0.00";
const THIN = { style: "thin" as const, color: { argb: "FFD6DEEA" } };
const BOX: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** Rows the number check covers: well past any realistic customer summary. */
const VALIDATED_ROWS = 5000;

const sumAbove = (col: "B" | "C") => `SUM(${col}2:INDEX(${col}:${col},ROW()-1))`;

function addDataSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet(BALANCE_TEMPLATE_SHEETS.data, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  ws.getColumn(2).numFmt = MONEY_FMT;
  ws.getColumn(3).numFmt = MONEY_FMT;

  // Row 1 — optional reporting period, in the form the importer reads.
  const period = ws.getRow(1);
  period.getCell(1).value = BALANCE_TEMPLATE_PERIOD_LABEL;
  period.getCell(1).font = { bold: true, color: { argb: INK } };
  period.getCell(2).value = BALANCE_TEMPLATE_SAMPLE_PERIOD;
  period.getCell(2).numFmt = "@";
  period.getCell(2).font = { color: { argb: INK } };
  period.getCell(3).value = "Optional. See the Instructions sheet.";
  period.getCell(3).font = { italic: true, color: { argb: SOFT } };

  // Row 2 — the headings, exactly as the importer looks for them.
  const header = ws.getRow(2);
  BALANCE_TEMPLATE_HEADERS.forEach((h, i) => {
    const c = header.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = HEADER_FILL;
    c.border = BOX;
    c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right" };
  });
  header.height = 20;

  // Sample rows — clearly marked, and blank where a value is optional.
  SAMPLE_BALANCE_ROWS.forEach((r, i) => {
    const row = ws.getRow(3 + i);
    row.getCell(1).value = r.name;
    if (r.debit !== null) row.getCell(2).value = r.debit;
    if (r.credit !== null) row.getCell(3).value = r.credit;
    for (let c = 1; c <= 3; c++) {
      const cell = row.getCell(c);
      cell.fill = SAMPLE_FILL;
      cell.border = BOX;
      cell.font = { italic: true, color: { argb: INK } };
    }
  });

  // Grand Total — a formula over every row between the headings and itself, with its value cached.
  const sum = (k: "debit" | "credit") => SAMPLE_BALANCE_ROWS.reduce((t, r) => t + Math.round((r[k] ?? 0) * 100), 0) / 100;
  const total = ws.getRow(3 + SAMPLE_BALANCE_ROWS.length);
  total.getCell(1).value = BALANCE_TEMPLATE_TOTAL_LABEL;
  total.getCell(2).value = { formula: sumAbove("B"), result: sum("debit") };
  total.getCell(3).value = { formula: sumAbove("C"), result: sum("credit") };
  for (let c = 1; c <= 3; c++) {
    const cell = total.getCell(c);
    cell.font = { bold: true, color: { argb: INK } };
    cell.fill = TOTAL_FILL;
    cell.border = BOX;
  }

  // Debit and Credit accept numbers only (negative allowed: the importer keeps and flags them).
  for (const col of ["B", "C"]) {
    for (let r = 3; r <= VALIDATED_ROWS; r++) {
      ws.getCell(`${col}${r}`).dataValidation = {
        type: "decimal",
        operator: "between",
        allowBlank: true,
        formulae: [-999999999999.99, 999999999999.99],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Numbers only",
        error: "Enter the amount as a number, for example 125000 or 48500.50. No ₹ sign, no Dr/Cr, no text.",
      };
    }
  }
  return ws;
}

type Line = [topic: string, text: string] | [section: string];

function addInstructionsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet(BALANCE_TEMPLATE_SHEETS.instructions);
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 70;
  ws.getColumn(4).width = 26;

  let r = 1;
  const title = ws.getCell(r, 1);
  title.value = "How to fill in the Collection Tracker bulk upload file";
  title.font = { bold: true, size: 14, color: { argb: INK } };
  r += 1;
  ws.getCell(r, 1).value =
    "Fill in the Collection Data sheet, save the file, and upload it from Collection Tracker, Bulk Upload. The layout is the same as the Tally Sundry Debtors customer summary, so a Tally export can also be uploaded directly.";
  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(r).height = 32;
  r += 2;

  // The columns.
  const colHead = ["Column on Collection Data", "Required?", "What to enter", "Example"];
  colHead.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = HEADER_FILL;
    c.border = BOX;
  });
  r += 1;
  const columns: [string, string, string, string][] = [
    ["Particulars (column A)", "Required", "The company name, spelled as it is in the Collection Master.", "Example Traders Pvt Ltd"],
    ["Debit (column B)", "Debit or Credit, or both", "The amount the company owes us, in rupees.", "125000.00"],
    ["Credit (column C)", "Debit or Credit, or both", "Any amount in the company's favour, for example an advance or a credit note, in rupees.", "2000.00"],
    ["Grand Total row", "Required, keep it last", "Leave the formula as it is. It adds up every row above it. The upload is refused if the rows do not add up to it.", "Calculated for you"],
    ["Reporting period (cell B1)", "Optional", "The period the balances cover, written as day-month-year to day-month-year with the month as three letters.", BALANCE_TEMPLATE_SAMPLE_PERIOD],
  ];
  for (const line of columns) {
    line.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.border = BOX;
      c.alignment = { wrapText: true, vertical: "top" };
      if (i === 0) c.font = { bold: true, color: { argb: INK } };
    });
    r += 1;
  }
  r += 1;

  const rules: Line[] = [
    ["Before you start"],
    ["Sample rows", `The yellow rows whose names start with "${SAMPLE_ROW_PREFIX}" are examples only. Delete them before uploading. They match no real company, so if one is left in it is skipped and listed as "Not in Master" in the preview.`],
    ["Headings", "Do not change, move or rename the headings in row 2 of Collection Data, and do not add rows or columns above them."],
    ["Adding companies", "Insert new rows anywhere between the headings and the Grand Total row (right-click a row, Insert). The Grand Total updates by itself."],
    ["Dates"],
    ["Reporting period", `The only date in this file is the optional reporting period in cell B1. Write it in Tally's style, for example ${BALANCE_TEMPLATE_SAMPLE_PERIOD}. The preview shows it as 01/04/26 to 31/10/26. A period written another way, such as 01/04/26 to 31/10/26, is not read, and the preview then says the period is not printed in the file. You can also leave B1 empty.`],
    ["Amounts"],
    ["Numbers", "Type digits only, with up to two decimal places, for example 125000 or 48500.50. Do not type a rupee sign, Dr, Cr or any text. Commas are fine."],
    ["Negative amounts", "A minus sign is kept as it is and the preview flags the row so you can check it."],
    ["Company names"],
    ["Spelling", "Use the company name as it is in the Collection Master. Capital letters, extra spaces and punctuation do not matter."],
    ["New companies", "A company that is not in the Collection Master is skipped, never created. Someone allowed to import the Collection Master can add those companies from the preview as Unassigned, after a separate confirmation."],
    ["Sales Coordinator"],
    ["Not part of this file", "This file has no Sales Coordinator column. Coordinators are set in the Collection Master and the Collection Tracker, and an upload never changes them. A coordinator column added to this file would be ignored."],
    ["Blank values"],
    ["Empty cells", "Leave a cell empty when there is no amount. Each company needs at least a Debit or a Credit. Completely empty rows are ignored."],
    ["Zero", "Type 0 only when the balance really is zero. Do not type a dash or nil."],
    ["Avoiding duplicates"],
    ["One row per company", "List each company once. If the same company appears twice with the same amounts, the second row is ignored. If the amounts differ, both rows are refused."],
    ["Uploading again", "Each upload replaces the balances the Collection Tracker shows. It does not add to the previous upload. A company left out of the new file shows no balance."],
    ["Uploading the file"],
    ["1. Save", "Save the file as Excel (.xlsx). A CSV file of the Collection Data sheet also works."],
    ["2. Choose", "In the Collection Tracker, click Bulk Upload and choose your file."],
    ["3. Preview", "Click Preview upload and check the rows, the totals and any rows marked Not in Master or Invalid."],
    ["4. Confirm", "Tick the confirmation and click Upload balances. Nothing is saved until you do."],
  ];
  for (const line of rules) {
    if (line.length === 1) {
      const c = ws.getCell(r, 1);
      c.value = line[0];
      c.font = { bold: true, color: { argb: INK } };
      for (let i = 1; i <= 4; i++) ws.getCell(r, i).fill = SECTION_FILL;
      r += 1;
      continue;
    }
    const [topic, text] = line;
    ws.getCell(r, 1).value = topic;
    ws.getCell(r, 1).font = { bold: true, color: { argb: SOFT } };
    ws.getCell(r, 1).alignment = { vertical: "top" };
    ws.getCell(r, 2).value = text;
    ws.mergeCells(r, 2, r, 4);
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = Math.max(18, Math.ceil(text.length / 105) * 15);
    r += 1;
  }
  return ws;
}

/** The sample workbook as .xlsx bytes. */
export async function buildBalanceTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JMT WMS";
  wb.created = new Date(0);
  addDataSheet(wb);
  addInstructionsSheet(wb);
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
