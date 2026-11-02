import * as XLSX from "xlsx";
import { dateParts, type DateInput } from "@/lib/dates";

/**
 * Dates in Excel exports are genuine date cells — sortable, filterable,
 * usable in formulas — displayed as dd/mm/yy, the WMS standard. A text
 * "02/11/26" would sort as text and be read as 11 Feb by a US-locale Excel;
 * a date serial with an explicit format is unambiguous.
 */
export const EXCEL_DATE_FORMAT = "dd/mm/yy";

export type Cell = string | number | Date;

/**
 * The Date SheetJS turns into the right serial for a value: a "yyyy-mm-dd"
 * stays that calendar day; an instant becomes its Indian wall-clock time.
 * SheetJS reads the *local* components of a Date when computing the serial,
 * so the Date is built from components rather than parsed, and the result
 * is the same whatever timezone the server runs in. "" when empty.
 */
export function excelDate(v: DateInput, tz?: string): Date | "" {
  const p = dateParts(v, tz);
  return p ? new Date(p.y, p.m - 1, p.d, p.hh, p.mm) : "";
}

/** A worksheet from rows; every Date cell is written as a date formatted dd/mm/yy. */
export function sheetFromRows(aoa: readonly (readonly Cell[])[], cols?: XLSX.ColInfo[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa as Cell[][], { cellDates: true });
  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        if (cell && cell.t === "d") cell.z = EXCEL_DATE_FORMAT;
      }
    }
  }
  if (cols) ws["!cols"] = cols;
  return ws;
}
