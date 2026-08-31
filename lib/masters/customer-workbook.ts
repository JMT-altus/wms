/**
 * Customer Master bulk-upload workbook — 3 linked sheets (Basic Details,
 * Account Details, Sales), replacing the old single-sheet CSV/XLSX customer
 * import. Pure/shared: the template builder and parser both run server-side
 * (the upload dialog sends the raw file to a server action; parsing an
 * uploaded workbook in the browser isn't needed here, unlike the old
 * CSV-round-trip path products still uses).
 *
 * Products bulk upload is untouched — this module is customers-only.
 */
import ExcelJS from "exceljs";

export const SHEET_NAMES = {
  basic: "Basic Details",
  account: "Account Details",
  sales: "Sales",
} as const;

export interface WorkbookColumn {
  /** Internal field key — what the parser/importer key rows by. */
  key: string;
  header: string;
  required?: boolean;
  type: "text" | "number" | "date" | "yesno" | "category";
  /** Column width hint for the generated template. */
  width?: number;
  /** True → header is suffixed "(Auto)" and shaded, since the import computes it. */
  calculated?: boolean;
}

/** Basic Details — Customer Identification, Address, Contact, Tax, Commercial. */
export const BASIC_DETAILS_COLUMNS: WorkbookColumn[] = [
  { key: "customerCode", header: "Customer Code", type: "text", width: 16 },
  { key: "customerName", header: "Customer Name", required: true, type: "text", width: 28 },
  { key: "customerParticulars", header: "Customer Particulars", type: "text", width: 24 },
  { key: "customerCategory", header: "Customer Category", type: "category", width: 20 },
  { key: "focusedView", header: "Add to Focused View List", type: "yesno", width: 14 },
  { key: "billingAddress", header: "Billing Address", type: "text", width: 30 },
  { key: "deliveryAddress", header: "Delivery Address", type: "text", width: 30 },
  { key: "invoiceMailingAddress", header: "Invoice Mailing Address", type: "text", width: 30 },
  { key: "purchaseDeptContact", header: "Purchase Department", type: "text", width: 24 },
  { key: "accountsDeptContact", header: "Accounts Department", type: "text", width: 24 },
  { key: "otherContact", header: "Other Contact", type: "text", width: 20 },
  { key: "referenceBy", header: "Reference By", type: "text", width: 18 },
  { key: "contactName", header: "Contact Name", type: "text", width: 20 },
  { key: "phoneNo", header: "Phone No", type: "text", width: 16 },
  { key: "email", header: "Email", type: "text", width: 24 },
  { key: "gstNo", header: "GST No", type: "text", width: 18 },
  { key: "tinNumber", header: "TIN Number", type: "text", width: 16 },
  { key: "panNo", header: "PAN No", type: "text", width: 14 },
  { key: "iecNumber", header: "IEC Number", type: "text", width: 16 },
  { key: "website", header: "Website", type: "text", width: 22 },
  { key: "paymentTerms", header: "Payment Terms", type: "text", width: 18 },
  { key: "salesCoordinator", header: "Sales Coordinator", type: "text", width: 20 },
  { key: "tcsApplicable", header: "TCS Applicable?", type: "yesno", width: 14 },
  { key: "creditLimit", header: "Credit Limit", type: "number", width: 14 },
  { key: "creditPeriod", header: "Credit Period", type: "number", width: 14 },
];

/**
 * Account Details — attaches to the SAME customer_masters row as Basic
 * Details (via Customer Code); no separate table. Columns that overlap
 * Basic Details (GST No, PAN No, TIN Number, IEC Number, Payment Terms,
 * Credit Limit, Credit Period, TCS Applicable?, Sales Coordinator, Website)
 * write to the exact same DB column — a non-blank value here is applied
 * after Basic Details (Step 2 over Step 1, per the import order), never a
 * second conflicting value.
 */
export const ACCOUNT_DETAILS_COLUMNS: WorkbookColumn[] = [
  { key: "customerCode", header: "Customer Code", required: true, type: "text", width: 16 },
  { key: "customerName", header: "Customer Name", type: "text", width: 28 },
  { key: "accountsContactName", header: "Accounts Contact Name", type: "text", width: 22 },
  { key: "accountsContactPhone", header: "Accounts Contact Phone", type: "text", width: 18 },
  { key: "accountsContactEmail", header: "Accounts Contact Email", type: "text", width: 24 },
  { key: "gstNo", header: "GST No", type: "text", width: 18 },
  { key: "panNo", header: "PAN No", type: "text", width: 14 },
  { key: "tinNumber", header: "TIN Number", type: "text", width: 16 },
  { key: "iecNumber", header: "IEC Number", type: "text", width: 16 },
  { key: "paymentTerms", header: "Payment Terms", type: "text", width: 18 },
  { key: "creditLimit", header: "Credit Limit", type: "number", width: 14 },
  { key: "creditPeriod", header: "Credit Period", type: "number", width: 14 },
  { key: "tcsApplicable", header: "TCS Applicable?", type: "yesno", width: 14 },
  { key: "salesCoordinator", header: "Sales Coordinator", type: "text", width: 20 },
  { key: "website", header: "Website", type: "text", width: 22 },
];

/** Sales — one or more PO/material lines per Customer Code. */
export const SALES_COLUMNS: WorkbookColumn[] = [
  { key: "customerCode", header: "Customer Code", required: true, type: "text", width: 16 },
  { key: "customerPoNo", header: "Customer PO No", type: "text", width: 18 },
  { key: "customerPoEmailDate", header: "Customer PO Email Date", type: "date", width: 20 },
  { key: "materialDescription", header: "Material Description", type: "text", width: 30 },
  { key: "qty", header: "Qty", type: "number", width: 10 },
  { key: "rate", header: "Rate", type: "number", width: 12 },
  { key: "total", header: "Total (Auto)", type: "number", width: 14, calculated: true },
  { key: "gstPercent", header: "GST %", type: "number", width: 10 },
  { key: "lineTotal", header: "Line Total (Auto)", type: "number", width: 16, calculated: true },
  { key: "freightCharges", header: "Freight Charges", type: "number", width: 16 },
  { key: "installationCharges", header: "Installation Charges", type: "number", width: 18 },
  { key: "salesTotal", header: "Sales Total (Auto)", type: "number", width: 16, calculated: true },
  { key: "tcRequired", header: "TC Required?", type: "yesno", width: 14 },
  { key: "specialInstruction", header: "Any Special Instruction", type: "text", width: 26 },
  { key: "remarks", header: "Remarks", type: "text", width: 22 },
  { key: "filledBy", header: "Filled By", type: "text", width: 16 },
  { key: "filledByName", header: "Filled By Name", type: "text", width: 18 },
  { key: "filledBySign", header: "Filled By Sign", type: "text", width: 16 },
  { key: "instructedBy", header: "Instructed By", type: "text", width: 18 },
  { key: "enteredVerifiedBy", header: "Entered / Verified By", type: "text", width: 20 },
];

const YES_NO = ["Yes", "No"] as const;

/* ── Template generation ─────────────────────────────────────────────────── */

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0A6CFF" },
};
const CALC_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE9EEF9" },
};

function styleSheet(ws: ExcelJS.Worksheet, columns: WorkbookColumn[]) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? 18;
    if (c.calculated) {
      const cell = header.getCell(i + 1);
      cell.fill = CALC_FILL;
      cell.font = { bold: true, italic: true, color: { argb: "FF334155" } };
    }
    if (c.type === "number") col.numFmt = "#,##0.00";
    if (c.type === "date") col.numFmt = "dd-mm-yyyy";
  });
}

/** Applies a dropdown to rows 2..500 of one column — the standard template-sized range. */
function applyListValidation(ws: ExcelJS.Worksheet, colIndex: number, formulae: string[]) {
  for (let row = 2; row <= 500; row++) {
    ws.getCell(row, colIndex).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae,
      showErrorMessage: true,
      errorStyle: "warning",
      error: "Please choose a value from the dropdown list.",
    };
  }
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: WorkbookColumn[],
  categoryRangeRef: string | null,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  ws.addRow(columns.map((c) => c.header));
  styleSheet(ws, columns);
  columns.forEach((c, i) => {
    if (c.type === "yesno") applyListValidation(ws, i + 1, [`"${YES_NO.join(",")}"`]);
    if (c.type === "category" && categoryRangeRef) applyListValidation(ws, i + 1, [categoryRangeRef]);
  });
  return ws;
}

/**
 * Builds the 3-visible-sheet + 1-hidden-Instructions-sheet template workbook.
 * `categoryOptions` is the live admin-managed Customer Category list
 * (`listLookupOptions(CUSTOMER_CATEGORY_LIST_KEY)`) — the dropdown always
 * reflects whatever is currently configured, never a hardcoded list.
 */
export async function buildCustomerTemplateWorkbook(categoryOptions: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JMT WMS";
  wb.created = new Date(0); // deterministic — avoids a new-Date() ban surprising a caller in a script/test context

  // Hidden lookup sheet backing the Customer Category dropdown — referencing a
  // range handles a longer/variable list better than an inline formula list.
  const lookupWs = wb.addWorksheet("_Lookups", { state: "hidden" });
  categoryOptions.forEach((c, i) => lookupWs.getCell(i + 1, 1).value = c);
  const categoryRangeRef =
    categoryOptions.length > 0 ? `_Lookups!$A$1:$A$${categoryOptions.length}` : null;

  addSheet(wb, SHEET_NAMES.basic, BASIC_DETAILS_COLUMNS, categoryRangeRef);
  addSheet(wb, SHEET_NAMES.account, ACCOUNT_DETAILS_COLUMNS, categoryRangeRef);
  addSheet(wb, SHEET_NAMES.sales, SALES_COLUMNS, categoryRangeRef);

  const instructions = wb.addWorksheet("Instructions", { state: "hidden" });
  instructions.getColumn(1).width = 100;
  [
    "Fill Basic Details first.",
    "Use Customer Code to link the three sheets — it is the only relationship key, not Customer Name.",
    "One Customer Code represents one customer.",
    "For a brand-new customer: leave Customer Code blank in Basic Details if it has no Account Details/Sales rows in this file. If it does, fill in a Customer Code yourself on that Basic Details row so the other sheets can reference it — otherwise the system generates one automatically and nothing else in the file can link to it.",
    "Multiple Sales rows are allowed for one customer (multiple material lines, multiple POs).",
    "Use the dropdown values where provided — typing something else will be rejected.",
    "Do not change header names. Do not delete required columns (Customer Name on Basic Details; Customer Code on Account Details and Sales).",
    "Columns marked \"(Auto)\" on the Sales sheet are calculated by the system — Total, Line Total and Sales Total. Leave them blank; anything typed there is ignored on import.",
  ].forEach((line, i) => (instructions.getCell(i + 1, 1).value = line));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ── Parsing ──────────────────────────────────────────────────────────────── */

export type SheetRow = Record<string, string>;

/** One data row plus its actual Excel row number — a blank row skipped in the
 * middle of the sheet must not shift every later error message's row number. */
export interface NumberedRow {
  row: SheetRow;
  rowNumber: number;
}

function readSheet(wb: ExcelJS.Workbook, sheetName: string, columns: WorkbookColumn[]): NumberedRow[] {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const colByHeader = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => colByHeader.set(norm(cell.value), colNumber));

  const rows: NumberedRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const isBlank = row.cellCount === 0 || row.values === undefined;
    if (isBlank) return;
    const out: SheetRow = {};
    let hasAny = false;
    for (const col of columns) {
      const idx = colByHeader.get(norm(col.header));
      if (!idx) continue;
      const cell = row.getCell(idx);
      let v: unknown = cell.value;
      if (v instanceof Date) {
        // Excel date cell → ISO date string, consistent regardless of the
        // display number format the uploader's copy of Excel used.
        v = v.toISOString().slice(0, 10);
      } else if (v && typeof v === "object" && "result" in v) {
        // A formula cell (e.g. someone typed "=B2*C2") — use its computed value.
        v = (v as { result?: unknown }).result;
      }
      const s = v === null || v === undefined ? "" : String(v).trim();
      if (s.length > 0) hasAny = true;
      out[col.key] = s;
    }
    if (hasAny) rows.push({ row: out, rowNumber });
  });
  return rows;
}

export interface ParsedCustomerWorkbook {
  basic: NumberedRow[];
  account: NumberedRow[];
  sales: NumberedRow[];
  /** Sheets from the template that are missing entirely from the uploaded file. */
  missingSheets: string[];
}

export async function parseCustomerWorkbook(buffer: Buffer): Promise<ParsedCustomerWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const missingSheets = Object.values(SHEET_NAMES).filter((n) => !wb.getWorksheet(n));

  return {
    basic: readSheet(wb, SHEET_NAMES.basic, BASIC_DETAILS_COLUMNS),
    account: readSheet(wb, SHEET_NAMES.account, ACCOUNT_DETAILS_COLUMNS),
    sales: readSheet(wb, SHEET_NAMES.sales, SALES_COLUMNS),
    missingSheets,
  };
}

/* ── Validation ───────────────────────────────────────────────────────────── */

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim().length === 0;
}

function parseNonNegative(raw: string | undefined): number | null | "invalid" {
  if (isBlank(raw)) return null;
  const n = Number(String(raw).replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

function parseYesNoStrict(raw: string | undefined): boolean | null | "invalid" {
  if (isBlank(raw)) return null;
  const n = String(raw).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(n)) return true;
  if (["no", "n", "false", "0"].includes(n)) return false;
  return "invalid";
}

function parseDateLoose(raw: string | undefined): string | null | "invalid" {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();
  // Already ISO (from an Excel date cell, see readSheet) or DD-MM-YYYY / DD/MM/YYYY.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const day = Number(d), month = Number(mo);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }
  return "invalid";
}

export interface ValidatedBasicRow {
  row: SheetRow;
  errors: string[];
}

/** Validates one Basic Details row. `categoryOptions` is the live admin-managed list. */
export function validateBasicRow(row: SheetRow, rowNum: number, categoryOptions: string[]): string[] {
  const errors: string[] = [];
  const sheet = SHEET_NAMES.basic;
  if (isBlank(row.customerName)) errors.push(`${sheet} — Row ${rowNum} — Customer Name is required.`);
  if (!isBlank(row.customerCategory) && !categoryOptions.includes(row.customerCategory ?? "")) {
    errors.push(`${sheet} — Row ${rowNum} — Customer Category is invalid.`);
  }
  if (parseNonNegative(row.creditLimit) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Credit Limit cannot be negative.`);
  }
  if (parseNonNegative(row.creditPeriod) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Credit Period cannot be negative.`);
  }
  if (parseYesNoStrict(row.focusedView) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Add to Focused View List must be Yes or No.`);
  }
  if (parseYesNoStrict(row.tcsApplicable) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — TCS Applicable? must be Yes or No.`);
  }
  return errors;
}

export function validateAccountRow(row: SheetRow, rowNum: number): string[] {
  const errors: string[] = [];
  const sheet = SHEET_NAMES.account;
  if (isBlank(row.customerCode)) errors.push(`${sheet} — Row ${rowNum} — Customer Code is required.`);
  if (parseNonNegative(row.creditLimit) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Credit Limit cannot be negative.`);
  }
  if (parseNonNegative(row.creditPeriod) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Credit Period cannot be negative.`);
  }
  if (parseYesNoStrict(row.tcsApplicable) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — TCS Applicable? must be Yes or No.`);
  }
  return errors;
}

export function validateSalesRow(row: SheetRow, rowNum: number): string[] {
  const errors: string[] = [];
  const sheet = SHEET_NAMES.sales;
  if (isBlank(row.customerCode)) errors.push(`${sheet} — Row ${rowNum} — Customer Code is required.`);
  if (!isBlank(row.qty) && parseNonNegative(row.qty) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Qty must be numeric.`);
  }
  if (!isBlank(row.rate) && parseNonNegative(row.rate) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Rate must be numeric.`);
  }
  if (!isBlank(row.gstPercent) && parseNonNegative(row.gstPercent) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — GST % must be numeric.`);
  }
  if (!isBlank(row.freightCharges) && parseNonNegative(row.freightCharges) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Freight Charges must be numeric.`);
  }
  if (!isBlank(row.installationCharges) && parseNonNegative(row.installationCharges) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Installation Charges must be numeric.`);
  }
  if (parseDateLoose(row.customerPoEmailDate) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — Customer PO Email Date is not a valid date (use DD-MM-YYYY).`);
  }
  if (parseYesNoStrict(row.tcRequired) === "invalid") {
    errors.push(`${sheet} — Row ${rowNum} — TC Required? must be Yes or No.`);
  }
  return errors;
}

/* ── Sales-line calculation ──────────────────────────────────────────────── */

export interface SalesLineAmounts {
  qty: number | null;
  rate: number | null;
  total: number | null;
  gstPercent: number | null;
  gstAmount: number | null;
  lineTotal: number | null;
  freightCharges: number | null;
  installationCharges: number | null;
  salesTotal: number | null;
}

/**
 * Total = Qty × Rate. GST amount = Total × gstPercent/100 (the only GST
 * formula precedent in the app — lib/outstanding/schedule.ts — is the same
 * base × rate/100 style, just applied per Sales row instead of per contract).
 * Line Total = Total + GST amount. Sales Total = Line Total + Freight +
 * Installation, computed per row since the sheet is flat, not a nested PO
 * structure.
 */
export function computeSalesLineAmounts(row: SheetRow): SalesLineAmounts {
  const qty = parseNonNegative(row.qty);
  const rate = parseNonNegative(row.rate);
  const gstPercent = parseNonNegative(row.gstPercent);
  const freightCharges = parseNonNegative(row.freightCharges);
  const installationCharges = parseNonNegative(row.installationCharges);

  const q = typeof qty === "number" ? qty : null;
  const r = typeof rate === "number" ? rate : null;
  const gp = typeof gstPercent === "number" ? gstPercent : null;
  const fr = typeof freightCharges === "number" ? freightCharges : null;
  const inst = typeof installationCharges === "number" ? installationCharges : null;

  const total = q !== null && r !== null ? Math.round(q * r * 100) / 100 : null;
  const gstAmount = total !== null && gp !== null ? Math.round(total * (gp / 100) * 100) / 100 : null;
  const lineTotal = total !== null ? Math.round((total + (gstAmount ?? 0)) * 100) / 100 : null;
  const salesTotal =
    lineTotal !== null ? Math.round((lineTotal + (fr ?? 0) + (inst ?? 0)) * 100) / 100 : null;

  return {
    qty: q,
    rate: r,
    total,
    gstPercent: gp,
    gstAmount,
    lineTotal,
    freightCharges: fr,
    installationCharges: inst,
    salesTotal,
  };
}

export { parseNonNegative, parseYesNoStrict, parseDateLoose };
