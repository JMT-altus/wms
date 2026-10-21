/**
 * Reading the company master workbook in the browser. Pure apart from `xlsx`.
 *
 * The file is never sent anywhere to be read. The header row is found
 * automatically (it can be overridden), every column is described — including
 * columns with NO header, which are labelled "Unnamed column B" etc. — and the
 * three fields are auto-mapped only from real header text. A column without a
 * header is never auto-mapped: the admin has to pick it, and confirm it.
 */
import * as XLSX from "xlsx";
import { cleanText } from "./normalize";
import { COLLECTION_RULES, type CollectionRules } from "../config";

export type MasterField = "company" | "coordinator" | "paymentTerms";

/** How a column with a blank header is labelled ("Unnamed column B"). Shared with the server check. */
export const UNNAMED_COLUMN_LABEL = "Unnamed column";

export const FIELD_LABELS: Record<MasterField, string> = {
  company: "Company name",
  coordinator: "Sales Coordinator",
  paymentTerms: "Payment Terms",
};

const SYNONYMS: Record<MasterField, string[]> = {
  company: ["company", "companyname", "name", "party", "partyname", "client", "clientname", "customer", "customername"],
  coordinator: ["salescoordinator", "coordinator", "salescoord", "salesperson", "salesrep", "executive", "salesexecutive"],
  paymentTerms: ["paymentterms", "paymentterm", "terms", "creditterms", "credit"],
};

const headerKey = (v: unknown) => cleanText(v).toLowerCase().replace(/[^a-z0-9]/g, "");

export interface SheetColumn {
  index: number;
  /** Spreadsheet letter: A, B, … AA. */
  letter: string;
  /** Header text, or null when the header cell is blank. */
  header: string | null;
  /** What the screens call it. */
  label: string;
  /** Non-blank cells below the header row. */
  filled: number;
  /** Most frequent values below the header row (for the preview). */
  topValues: { value: string; count: number }[];
  distinctValues: number;
}

export interface ReadSheet {
  sheet: string;
  headerRow: number; // 0-based index in `rows`
  columns: SheetColumn[];
  /** Every row of the sheet's used range, blank rows included, so index = sheet row − origin. */
  rows: unknown[][];
  /** 0-based sheet row of `rows[0]` (the used range may not start at row 1). */
  origin: number;
}

export const columnLetter = (i: number): string => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export function readWorkbook(data: ArrayBuffer | Uint8Array | string): XLSX.WorkBook {
  if (typeof data === "string") return XLSX.read(data, { type: "string", raw: true });
  return XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: "array", raw: true });
}

export function sheetRows(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  const ws = wb.Sheets[sheet];
  if (!ws) return [];
  // Blank rows are kept so an index always maps back to the real sheet row.
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

function sheetOrigin(wb: XLSX.WorkBook, sheet: string): number {
  const ref = wb.Sheets[sheet]?.["!ref"];
  return ref ? XLSX.utils.decode_range(ref).s.r : 0;
}

/** First row (of the first 30) where a company-name header appears; else the first non-empty row. */
export function detectHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    if ((rows[i] ?? []).some((c) => SYNONYMS.company.includes(headerKey(c)))) return i;
  }
  for (let i = 0; i < limit; i++) if ((rows[i] ?? []).some((c) => cleanText(c) !== "")) return i;
  return 0;
}

export function describeColumns(rows: unknown[][], headerRow: number): SheetColumn[] {
  const width = rows.reduce((w, r) => Math.max(w, r?.length ?? 0), 0);
  const header = rows[headerRow] ?? [];
  const body = rows.slice(headerRow + 1);
  const out: SheetColumn[] = [];
  for (let c = 0; c < width; c++) {
    const h = cleanText(header[c]);
    const counts = new Map<string, number>();
    let filled = 0;
    for (const r of body) {
      const v = cleanText(r?.[c]);
      if (!v) continue;
      filled++;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // A column with neither a header nor any data is not a column worth showing.
    if (!h && filled === 0) continue;
    const letter = columnLetter(c);
    out.push({
      index: c,
      letter,
      header: h || null,
      label: h ? `${letter} · ${h}` : `${UNNAMED_COLUMN_LABEL} ${letter}`,
      filled,
      topValues: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count })),
      distinctValues: counts.size,
    });
  }
  return out;
}

export function readSheet(wb: XLSX.WorkBook, sheet: string, headerRow?: number): ReadSheet {
  const rows = sheetRows(wb, sheet);
  const h = headerRow ?? detectHeaderRow(rows);
  return { sheet, headerRow: h, columns: describeColumns(rows, h), rows, origin: sheetOrigin(wb, sheet) };
}

export type ColumnMapping = Record<MasterField, number | null>;

/** Map fields from header text only. Unnamed columns are never auto-mapped. */
export function autoMap(columns: SheetColumn[]): ColumnMapping {
  const map: ColumnMapping = { company: null, coordinator: null, paymentTerms: null };
  for (const f of Object.keys(SYNONYMS) as MasterField[]) {
    const hit = columns.find((c) => c.header && SYNONYMS[f].includes(headerKey(c.header)) && !Object.values(map).includes(c.index));
    map[f] = hit ? hit.index : null;
  }
  return map;
}

export interface CoordinatorSuggestion {
  /** The column to use, or null when no column — or more than one — qualifies. */
  index: number | null;
  /** Why, in words the admin sees next to the mapping. */
  reason: string;
}

/**
 * Find the Sales Coordinator column from its CONTENTS, for files whose header
 * cell is blank (the company master file is one). Never a fixed position: only
 * a column WITHOUT a header can be suggested this way — a named column ("City",
 * "Zone", …) is something else even if its values look like names — and only
 * by the configured fill / variety / letters thresholds
 * (COLLECTION_RULES.coordinatorColumnDetection); a single qualifying column is
 * suggested, otherwise none. Whatever is chosen, the admin must confirm the
 * coordinator column explicitly (coordinatorConfirmationRequired) and the
 * server refuses an unconfirmed mapping.
 */
export function suggestCoordinatorColumn(
  read: ReadSheet,
  mapping: ColumnMapping,
  rules: CollectionRules = COLLECTION_RULES,
): CoordinatorSuggestion {
  if (mapping.coordinator !== null) return { index: mapping.coordinator, reason: "Chosen from the column header." };
  const { minFillRatio, maxDistinctValues, minLetterRatio } = rules.coordinatorColumnDetection;
  const body = read.rows.slice(read.headerRow + 1).filter((r) => (r ?? []).some((c) => cleanText(c) !== ""));
  const total = body.length;
  if (total === 0) return { index: null, reason: "The sheet has no data rows." };
  const used = new Set(Object.values(mapping).filter((v): v is number => v !== null));
  const otherField = (h: string | null) =>
    !!h && (Object.keys(SYNONYMS) as MasterField[]).some((f) => f !== "coordinator" && SYNONYMS[f].includes(headerKey(h)));

  const qualifying = read.columns.filter((c) => {
    if (used.has(c.index) || c.header !== null || otherField(c.header)) return false;
    const values = body.map((r) => cleanText(r?.[c.index])).filter((v) => v !== "");
    if (values.length / total < minFillRatio) return false;
    if (new Set(values.map((v) => v.toLowerCase())).size > maxDistinctValues) return false;
    return values.filter((v) => /\p{L}/u.test(v)).length / values.length >= minLetterRatio;
  });
  if (qualifying.length === 1) {
    const c = qualifying[0]!;
    return {
      index: c.index,
      reason: `${c.label} looks like a list of people: filled on ${c.filled} of ${total} rows with ${c.distinctValues} different values.`,
    };
  }
  if (qualifying.length > 1) {
    return { index: null, reason: `More than one unnamed column could be the Sales Coordinator (${qualifying.map((c) => c.letter).join(", ")}). Choose it yourself.` };
  }
  return { index: null, reason: "No unnamed column looks like a Sales Coordinator list, and no header says Sales Coordinator. Choose it yourself if the file has one." };
}

export interface MasterSourceRow {
  /** 1-based spreadsheet row number, for messages. */
  rowNo: number;
  company: string;
  coordinator: string;
  paymentTerms: string;
}

/** Rows below the header, reduced to the mapped fields. Fully blank rows are dropped. */
export function extractRows(read: ReadSheet, mapping: ColumnMapping): MasterSourceRow[] {
  const out: MasterSourceRow[] = [];
  const cell = (r: unknown[], i: number | null) => (i == null ? "" : cleanText(r?.[i]));
  read.rows.slice(read.headerRow + 1).forEach((r, i) => {
    const row = {
      // 1-based spreadsheet row, as the admin sees it in Excel.
      rowNo: (read.origin ?? 0) + read.headerRow + 2 + i,
      company: cell(r, mapping.company),
      coordinator: cell(r, mapping.coordinator),
      paymentTerms: cell(r, mapping.paymentTerms),
    };
    if (!row.company && !row.coordinator && !row.paymentTerms) return;
    out.push(row);
  });
  return out;
}

/** Columns that will not be imported (not mapped to any field), for the preview. */
export function unmappedColumns(columns: SheetColumn[], mapping: ColumnMapping): SheetColumn[] {
  const used = new Set(Object.values(mapping).filter((v): v is number => v != null));
  return columns.filter((c) => !used.has(c.index) && c.filled > 0);
}

/**
 * Fields whose mapped column the admin must confirm before preview and import:
 * the Sales Coordinator column ALWAYS (whether matched by header, suggested, or
 * picked by hand — a wrong column would assign every company to the wrong
 * person), and any field mapped to a column without a header.
 * The server applies the same rule (missingColumnConfirmations).
 */
export function fieldsNeedingConfirmation(columns: SheetColumn[], mapping: ColumnMapping): MasterField[] {
  return (Object.keys(mapping) as MasterField[]).filter((f) => {
    const col = columns.find((c) => c.index === mapping[f]);
    return !!col && (f === "coordinator" || col.header === null);
  });
}

/** Server-side form of the same rule, from the column labels the browser sends. */
export function missingColumnConfirmations(
  mapping: Record<MasterField, string | null>,
  confirmed: Partial<Record<MasterField, boolean>>,
): MasterField[] {
  return (Object.keys(mapping) as MasterField[]).filter((f) => {
    const label = mapping[f];
    if (label === null) return false;
    const needs = f === "coordinator" || label.startsWith(UNNAMED_COLUMN_LABEL);
    return needs && confirmed[f] !== true;
  });
}

/** Mapped columns that have no header — each needs the admin's explicit confirmation. */
export function unnamedMappedColumns(columns: SheetColumn[], mapping: ColumnMapping): { field: MasterField; column: SheetColumn }[] {
  return (Object.keys(mapping) as MasterField[])
    .map((field) => ({ field, column: columns.find((c) => c.index === mapping[field]) }))
    .filter((x): x is { field: MasterField; column: SheetColumn } => !!x.column && x.column.header === null);
}
