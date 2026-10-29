/**
 * Reading the Tally customer-summary workbook in the browser — the only part
 * that needs `xlsx`. The layout rules live in ./parse (pure, shared with the
 * server, which re-reads the grid itself rather than trusting what is found here).
 */
import * as XLSX from "xlsx";
import { parseBalanceRows, toGrid, type BalanceSheet } from "./parse";

export * from "./parse";

export function readBalanceWorkbook(data: ArrayBuffer | Uint8Array | string): XLSX.WorkBook {
  if (typeof data === "string") return XLSX.read(data, { type: "string", raw: true });
  return XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: "array", raw: true });
}

export type BalanceWorkbookResult = { ok: true; sheet: BalanceSheet; grid: string[][] } | { ok: false; error: string };

/**
 * The first worksheet that has the Tally summary layout, with its cells as the
 * plain text grid the server is sent; otherwise the first sheet's reason.
 */
export function readBalanceSheet(wb: XLSX.WorkBook): BalanceWorkbookResult {
  let firstError: string | null = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const res = parseBalanceRows(rows, name);
    if (res.ok) return { ok: true, sheet: res.sheet, grid: toGrid(rows) };
    firstError ??= res.error;
  }
  return { ok: false, error: firstError ?? "The workbook has no sheets." };
}
