/**
 * Reading an uploaded Tally export in the browser — the only part that needs
 * `xlsx`. Workbooks are parsed here rather than on the server (same reason as the
 * Tracker Bulk Upload: the installed `xlsx` has known advisories), and only cell
 * text is sent on. Macros are never read: bookVBA stays off, formulas are ignored
 * in favour of their stored values, and .xlsm/.xls are refused outright.
 */
import * as XLSX from "xlsx";
import { TALLY_LIMITS } from "./categories";

export type TallyFileResult = { ok: true; sheet: string; grid: string[][]; /** Every sheet that has data, in workbook order. */ sheets: string[] } | { ok: false; error: string };

const cellText = (v: unknown): string => (v == null ? "" : String(v)).slice(0, TALLY_LIMITS.cellChars);

/** Text from a CSV's bytes: Tally writes UTF-8, or UTF-16 with a byte-order mark. */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  return new TextDecoder().decode(bytes);
}

export function checkTallyFile(name: string, size: number): string | null {
  if (!/\.(xlsx|csv)$/i.test(name)) return "Choose an Excel (.xlsx) or CSV (.csv) file. Other formats, including .xls and macro-enabled workbooks, aren't accepted.";
  if (size === 0) return "This file is empty.";
  if (size > TALLY_LIMITS.fileBytes) return `This file is larger than ${TALLY_LIMITS.fileBytes / (1024 * 1024)} MB. Export a shorter period, or split it by financial year.`;
  return null;
}

/** Reads the first sheet that has data, or `wanted` when the person chose another one. */
export function readTallyBytes(name: string, bytes: Uint8Array, wanted?: string): TallyFileResult {
  const isCsv = /\.csv$/i.test(name);
  if (!isCsv && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) return { ok: false, error: "This file isn't a valid .xlsx workbook, even though it is named like one." };
  let wb: XLSX.WorkBook;
  try {
    wb = isCsv
      ? XLSX.read(decodeCsv(bytes), { type: "string", raw: true, sheetRows: TALLY_LIMITS.rows + 40 })
      : XLSX.read(bytes, { type: "array", raw: true, bookVBA: false, cellFormula: false, cellHTML: false, sheetRows: TALLY_LIMITS.rows + 40 });
  } catch {
    return { ok: false, error: "This file could not be read. It may be damaged or password-protected." };
  }
  const filled: { sheet: string; grid: string[][]; tooWide: boolean }[] = [];
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: true });
    // Empty cells past the last filled one don't count. A column beyond the limit is never cut off silently:
    // the sheet is refused instead, so nothing the file says can go missing on the way in.
    const grid = rows.map((r) => {
      const cells = (r ?? []).map(cellText);
      let end = cells.length;
      while (end > 0 && !cells[end - 1]!.trim()) end--;
      return cells.slice(0, end);
    });
    if (grid.some((r) => r.filter((c) => c.trim()).length >= 2)) filled.push({ sheet, grid, tooWide: grid.some((r) => r.length > TALLY_LIMITS.columns) });
  }
  const chosen = filled.find((f) => f.sheet === wanted) ?? filled[0];
  if (!chosen) return { ok: false, error: "No sheet in this file has any data in it." };
  if (chosen.tooWide) return { ok: false, error: `Sheet "${chosen.sheet}" has more than ${TALLY_LIMITS.columns} columns. Remove the columns you don't need and upload it again.` };
  return { ok: true, sheet: chosen.sheet, grid: chosen.grid, sheets: filled.map((f) => f.sheet) };
}

/** A plain .xlsx of text cells, for the downloadable import template. Nothing is read here. */
export function writeWorkbook(sheets: readonly { name: string; rows: string[][] }[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    ws["!cols"] = (sheet.rows[0] ?? []).map((h) => ({ wch: Math.max(14, Math.min(48, h.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** SHA-256 of the cells, so the same export is recognised whatever the file is called. */
export async function hashGrid(grid: readonly string[][]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(grid)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
