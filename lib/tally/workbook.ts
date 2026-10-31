/**
 * Reading an uploaded Tally export in the browser — the only part that needs
 * `xlsx`. Workbooks are parsed here rather than on the server (same reason as the
 * Tracker Bulk Upload: the installed `xlsx` has known advisories), and only cell
 * text is sent on. Macros are never read: bookVBA stays off, formulas are ignored
 * in favour of their stored values, and .xlsm/.xls are refused outright.
 */
import * as XLSX from "xlsx";
import { TALLY_LIMITS } from "./categories";

export type TallyFileResult = { ok: true; sheet: string; grid: string[][] } | { ok: false; error: string };

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

export function readTallyBytes(name: string, bytes: Uint8Array): TallyFileResult {
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
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: true });
    const grid = rows.map((r) => (r ?? []).slice(0, TALLY_LIMITS.columns).map(cellText));
    if (grid.some((r) => r.filter((c) => c.trim()).length >= 2)) return { ok: true, sheet, grid };
  }
  return { ok: false, error: "No sheet in this file has any data in it." };
}

/** SHA-256 of the cells, so the same export is recognised whatever the file is called. */
export async function hashGrid(grid: readonly string[][]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(grid)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
