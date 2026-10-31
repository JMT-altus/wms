/**
 * Reading Tally's cell text. Pure. Nothing here guesses: a value that can't be
 * read exactly returns null and the row says why.
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const real = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
};
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * yyyy-mm-dd, or null. Accepts Tally's 1-Apr-26 / 1-Apr-2026, dd-mm-yyyy (and
 * dd/mm/yyyy, dd.mm.yyyy — day first, as Tally and India write it), yyyy-mm-dd
 * and Excel's date serial numbers.
 */
export function parseTallyDateValue(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    return month ? real(fullYear(m[3]!), month, Number(m[1])) : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return real(fullYear(m[3]!), Number(m[2]), Number(m[1]));
  // Excel serial: days since 1899-12-30. The range is roughly 2000 to 2060.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 36526 || serial > 58000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

export type ParsedTallyAmount = { paise: number; side: "dr" | "cr" | null };

/**
 * Exact paise, or null. Accepts 1,23,456.78, a currency sign, a trailing Dr or
 * Cr, and (brackets) or a leading minus for negatives. More than two decimals
 * is refused: rounding a financial figure silently is not this file's call.
 */
export function parseTallyAmount(raw: string): ParsedTallyAmount | null {
  let s = raw.trim().replace(/^(₹|rs\.?|inr)\s*/i, "");
  if (!s) return null;
  let side: "dr" | "cr" | null = null;
  const sideMatch = /\s*(dr|cr)\.?$/i.exec(s);
  if (sideMatch) {
    side = sideMatch[1]!.toLowerCase() as "dr" | "cr";
    s = s.slice(0, sideMatch.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/,/g, "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) {
    // A spreadsheet can hold 1234.5000000001 for 1234.50: accept only binary noise, never real extra precision.
    if (!/^\d{1,13}\.\d{3,}$/.test(s)) return null;
    const n = Number(s);
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
    s = n.toFixed(2);
  }
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) return null;
  return { paise: negative ? -paise : paise, side };
}

export function parseTallyNumber(raw: string): number | null {
  const m = /^-?[\d,]*\.?\d+/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "2025-26" for any date from 1 Apr 2025 to 31 Mar 2026: the Indian financial year Tally uses. */
export function financialYear(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const start = Number(ymd.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Document numbers keep their punctuation (INV/1 and INV-1 differ); only case and spacing are ignored. */
export const documentKey = (v: string): string => v.trim().replace(/\s+/g, " ").toUpperCase();

export const partyKey = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, "");
