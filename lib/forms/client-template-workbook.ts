/**
 * The Client Master bulk-import template — an .xlsx with the dropdowns baked
 * in, so the lists live in the file rather than only in the app.
 *
 * A CSV cannot carry a dropdown. Opened in Google Sheets or Excel, this
 * workbook gives every option-backed column a real data-validation list built
 * from the live masters: the sales roster, the customer and industry types,
 * the Product Master, the admin-managed State / Payment Terms / Currency
 * lists. Fill it offline, upload it into the sheet, and the values already
 * match what the import expects — which is most of what goes wrong with a
 * hand-typed spreadsheet.
 *
 * Two strengths of dropdown, deliberately:
 *
 *   reject   Sales Co-ordinator, Grade, Status, Focused View and the Yes/No
 *            columns. These resolve to a row or an enum, so a value off the
 *            list is not a preference, it is a broken row. Sheets and Excel
 *            refuse it at the cell.
 *   suggest  State, Payment Terms, Currency, Country and friends, plus every
 *            multi-value column. The dropdown is there, but typing your own
 *            is allowed — these are stored as free text, and a multi-value
 *            cell has to be able to hold "OEM, Traders", which no single-pick
 *            list can express.
 *
 * Server-side only (exceljs is a Node dependency), reached through
 * /forms/client-kyc/client-template.xlsx.
 */

import ExcelJS from "exceljs";
import {
  COLUMN_BY_KEY,
  STANDARD_COLUMN_KEYS,
  optionsFor,
  orderColumns,
  type ClientBulkColumn,
  type ClientBulkOptions,
} from "./client-bulk-columns";

/** The data sheet, and the one an upload reads — it must be the first sheet. */
export const TEMPLATE_SHEET_NAME = "Clients";

/** Rows the dropdowns cover. Matches the import's own 500-row ceiling. */
const TEMPLATE_ROWS = 500;

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF3730A3" },
};
const REQUIRED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E1B4B" },
};

/**
 * A dropdown that refuses anything else.
 *
 * True only where an off-list value cannot be stored: Sales Co-ordinator and
 * Product Types resolve to rows, Grade and Status to fixed sets. Everything
 * else on this sheet is free text on `customer_masters`, so the list is a
 * suggestion — and a multi-value column has to accept a comma-separated
 * answer no single-pick list can offer.
 */
function rejectsOthers(column: ClientBulkColumn): boolean {
  return column.kind === "select" && !column.freeText;
}

/** Excel column letter for a 1-based index. */
function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Our pixel widths are for the browser; Excel counts characters. */
function excelWidth(column: ClientBulkColumn): number {
  return Math.min(46, Math.max(12, Math.round(column.width / 7.5)));
}

/**
 * Build the template for exactly the columns the sheet is showing.
 *
 * Not all 31 every time: the button sits above a sheet the user has already
 * added and removed columns on, and handing back a file with columns they
 * removed would make the round trip lossy in the one direction that matters.
 */
export async function buildClientTemplateWorkbook(
  columnKeys: readonly string[],
  options: ClientBulkOptions,
): Promise<Buffer> {
  const keys = orderColumns(
    columnKeys.filter((k) => COLUMN_BY_KEY.has(k)).length > 0
      ? columnKeys.filter((k) => COLUMN_BY_KEY.has(k))
      : STANDARD_COLUMN_KEYS,
  );
  const columns = keys.map((k) => COLUMN_BY_KEY.get(k)!);

  const wb = new ExcelJS.Workbook();
  wb.creator = "JMT WMS";
  // Deterministic, so two downloads of the same template are byte-identical
  // and a test never has to reason about the clock.
  wb.created = new Date(0);

  /* The data sheet first — an upload reads sheet one, whatever it is called. */
  const ws = wb.addWorksheet(TEMPLATE_SHEET_NAME);
  ws.addRow(columns.map((c) => (c.required ? `${c.label} *` : c.label)));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
  header.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  columns.forEach((column, i) => {
    const col = ws.getColumn(i + 1);
    col.width = excelWidth(column);
    if (column.kind === "number") col.numFmt = "#,##0.##";
    if (column.required) header.getCell(i + 1).fill = REQUIRED_FILL;
  });

  /*
   * The lists, on a hidden sheet, referenced by range.
   *
   * A range rather than an inline `"A,B,C"` formula: the inline form is
   * capped at 255 characters, which the Product Master and the sales roster
   * pass the moment this is used in earnest, and it fails by silently
   * dropping the dropdown rather than by erroring.
   */
  const lists = wb.addWorksheet("_Lookups", { state: "hidden" });
  let listColumn = 0;

  columns.forEach((column, i) => {
    const values = optionsFor(column, options);
    if (values.length === 0) return;

    listColumn += 1;
    const letter = columnLetter(listColumn);
    lists.getCell(1, listColumn).value = column.label;
    values.forEach((v, r) => (lists.getCell(r + 2, listColumn).value = v));
    lists.getColumn(listColumn).width = 28;

    const ref = `_Lookups!$${letter}$2:$${letter}$${values.length + 1}`;
    const strict = rejectsOthers(column);

    for (let row = 2; row <= TEMPLATE_ROWS + 1; row++) {
      ws.getCell(row, i + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [ref],
        // A suggestion list stays silent, which is what leaves the cell open
        // to a value of your own — and to the comma-separated answer a
        // multi-value column needs.
        showErrorMessage: strict,
        errorStyle: "stop",
        errorTitle: `${column.label} is a fixed list`,
        error: `Pick ${column.label} from the dropdown. Anything else cannot be imported.`,
      };
    }
  });

  lists.getRow(1).font = { bold: true };

  /* How to fill it in — visible, because a hidden instruction is no instruction. */
  const help = wb.addWorksheet("How to fill this in");
  help.getColumn(1).width = 112;
  const multiValue = columns.filter((c) => c.kind === "multi").map((c) => c.label);
  const strictColumns = columns.filter((c) => rejectsOthers(c)).map((c) => c.label);

  [
    "Client Master — bulk import template",
    "",
    "One row per client. Company is the only column that must be filled in; everything else can be left blank and added later.",
    "",
    "Dropdowns",
    "  Cells with a dropdown arrow are filled from the live masters — this file was generated with today's lists.",
    strictColumns.length > 0
      ? `  These must come from the list, and anything else is refused: ${strictColumns.join(", ")}.`
      : "",
    "  The rest are suggestions — pick from the list, or type your own value if it is genuinely new.",
    multiValue.length > 0
      ? `  These take more than one value — pick one from the dropdown, then type a comma and add the next: ${multiValue.join(", ")}.`
      : "",
    "",
    "Blank cells",
    "  Focused View blank = No.   Status blank = Active.",
    "  Test Certificate Needed and TCS Applicable blank = No.   Export blank = Domestic.",
    "",
    "Rules",
    "  Do not rename, reorder or delete the headings — the upload matches your file on them.",
    "  Client Code and Created are not in this file. The system fills both when the row is imported.",
    `  Up to ${TEMPLATE_ROWS} rows per upload.`,
    "  A company already in the Client Master is reported and skipped, never overwritten.",
    "",
    "When you are done, open Client Master → Bulk Import → Upload file and choose this workbook.",
    "Your rows land in the sheet, where anything that needs fixing is flagged before it is saved.",
  ]
    .filter((line) => line !== "")
    .forEach((line, i) => {
      const cell = help.getCell(i + 1, 1);
      cell.value = line;
      if (i === 0) cell.font = { bold: true, size: 14 };
      else if (!line.startsWith(" ")) cell.font = { bold: true };
    });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
