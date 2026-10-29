/**
 * The Tally customer-summary layout, read from a plain grid of cells. Pure — no
 * `xlsx`, no browser or server APIs — so the browser (to show what it found) and
 * the server (to decide what is imported) run exactly the same code.
 *
 * The layout is fixed, not guessed: a "Particulars" heading, then "Debit" and
 * "Credit" headings in the next few rows, then one row per customer, then a
 * "Grand Total" row. If those headings aren't found the sheet is refused.
 * The reporting period is read from a "<d-Mon-yy> to <d-Mon-yy>" line above the
 * headings when there is one. Nothing is inferred beyond that.
 */
import { cleanText } from "../master/normalize";

export interface BalanceSheetRow {
  /** 1-based row number in the sheet, for messages. */
  rowNo: number;
  name: string;
  /** The Debit / Credit cell as text; "" = blank. Parsed and validated by the plan. */
  debit: string;
  credit: string;
}

export interface BalanceSheet {
  sheet: string;
  /** First non-empty line, e.g. the company and "(from 1-Apr-26)". Shown, never used to match. */
  reportTitle: string | null;
  /** ISO dates; null when the sheet prints no period. */
  periodFrom: string | null;
  periodTo: string | null;
  /** 1-based sheet rows of the Particulars and Debit headings. */
  particularsRow: number;
  debitRow: number;
  rows: BalanceSheetRow[];
  /** The file's own Grand Total, as text; null when there is no such row. */
  sourceTotal: { debit: string; credit: string } | null;
  /** Rows left out because they were blank or a total row. */
  skipped: { blank: number; totals: number };
}

export type BalanceSheetResult = { ok: true; sheet: BalanceSheet } | { ok: false; error: string };

/** Size limits for the grid the browser sends (a server action body is capped at about 1 MB). */
export const GRID_LIMITS = { rows: 15_000, columns: 30, cellChars: 300, jsonBytes: 900_000 } as const;

const key = (v: unknown) => cleanText(v).toLowerCase();
/** "Grand Total" and plain "Total" rows are totals, never companies. */
const isTotalName = (v: unknown) => /^(grand\s*)?total$/i.test(cleanText(v));

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "19-Oct-26" → "2026-10-19"; null if it isn't a real date. */
export function parseTallyDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

const PERIOD = /(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i;

/** A cell as text without changing its value: numbers keep their digits, blanks are "". */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  return cleanText(v);
}

/** Any sheet range as the plain text grid the server is given (blank = ""). */
export function toGrid(rows: unknown[][]): string[][] {
  return rows.map((r) => (r ?? []).map(cellText));
}

export function parseBalanceRows(rows: unknown[][], sheet: string): BalanceSheetResult {
  const limit = Math.min(rows.length, 60);
  let pRow = -1;
  for (let i = 0; i < limit; i++) {
    if ((rows[i] ?? []).some((c) => key(c) === "particulars")) {
      pRow = i;
      break;
    }
  }
  if (pRow < 0) return { ok: false, error: 'This doesn\'t look like the Tally customer summary: no "Particulars" heading was found.' };
  const pCol = (rows[pRow] ?? []).findIndex((c) => key(c) === "particulars");

  // "Debit" and "Credit" headings: on the Particulars row or within the next few rows.
  let dRow = -1;
  let dCol = -1;
  let cCol = -1;
  for (let i = pRow; i < Math.min(rows.length, pRow + 6); i++) {
    const r = rows[i] ?? [];
    const d = r.findIndex((c) => key(c) === "debit");
    const c = r.findIndex((x) => key(x) === "credit");
    if (d >= 0 && c >= 0 && d !== c) {
      dRow = i;
      dCol = d;
      cCol = c;
      break;
    }
  }
  if (dRow < 0) return { ok: false, error: 'The "Debit" and "Credit" headings weren\'t found under "Particulars". Nothing was read.' };

  let reportTitle: string | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  for (let i = 0; i < pRow; i++) {
    for (const c of rows[i] ?? []) {
      const t = cleanText(c);
      if (!t) continue;
      if (reportTitle === null) reportTitle = t;
      const m = PERIOD.exec(t);
      if (m && periodFrom === null) {
        const a = parseTallyDate(m[1]!);
        const b = parseTallyDate(m[2]!);
        if (a && b) {
          periodFrom = a;
          periodTo = b;
        }
      }
    }
  }
  // The period is also printed beside "Particulars" in Tally's own layout.
  if (periodFrom === null) {
    for (const c of rows[pRow] ?? []) {
      const m = PERIOD.exec(cleanText(c));
      const a = m ? parseTallyDate(m[1]!) : null;
      const b = m ? parseTallyDate(m[2]!) : null;
      if (a && b) {
        periodFrom = a;
        periodTo = b;
        break;
      }
    }
  }
  // A period whose ends are the wrong way round is not a period.
  if (periodFrom !== null && periodTo !== null && periodFrom > periodTo) {
    periodFrom = null;
    periodTo = null;
  }

  const out: BalanceSheetRow[] = [];
  const skipped = { blank: 0, totals: 0 };
  let sourceTotal: BalanceSheet["sourceTotal"] = null;
  for (let i = dRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = cleanText(r[pCol]);
    const debit = cellText(r[dCol]);
    const credit = cellText(r[cCol]);
    if (name === "" && debit === "" && credit === "") {
      skipped.blank++;
      continue;
    }
    if (isTotalName(name)) {
      skipped.totals++;
      // Only the Grand Total is a source total; a bare "Total" is skipped, not trusted.
      if (/^grand/i.test(name) && sourceTotal === null) sourceTotal = { debit, credit };
      continue;
    }
    out.push({ rowNo: i + 1, name, debit, credit });
  }
  if (out.length === 0) return { ok: false, error: "The sheet has no customer rows under the headings." };

  return {
    ok: true,
    sheet: { sheet, reportTitle, periodFrom, periodTo, particularsRow: pRow + 1, debitRow: dRow + 1, rows: out, sourceTotal, skipped },
  };
}
