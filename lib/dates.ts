/**
 * WMS date display and entry — one vocabulary for the whole app.
 *
 * The standard is DD/MM/YY: 2026-11-02 shows as "02/11/26". Everything here
 * is pure and deterministic (explicit timezone, fixed English month names),
 * so server and client render the same text and nothing depends on the
 * machine's locale.
 *
 * Storage is untouched: dates stay ISO ("yyyy-mm-dd") and timestamps stay
 * instants. A calendar date ("yyyy-mm-dd") is formatted by reading its
 * digits, never by going through `new Date()`, so it cannot slip a day in
 * UTC. An instant (Date) is shown on the Indian clock unless a timezone is
 * given.
 */

export const IST = "Asia/Kolkata";

/** Placeholder for every date entry field. */
export const DATE_PLACEHOLDER = "dd/mm/yy";

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type DateInput = Date | string | number | null | undefined;

export interface DateParts {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
  /** Wall-clock hour 0-23 (0 for a calendar date). */
  hh: number;
  mm: number;
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

/** True for a real calendar date written "yyyy-mm-dd" (no 31 Feb, no 2026-13-01). */
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

const two = (n: number) => String(n).padStart(2, "0");

/** "yyyy-mm-dd" from parts. */
export function toYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${two(m)}-${two(d)}`;
}

const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    partsFmtCache.set(tz, f);
  }
  return f;
}

const DOW_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The parts of any date-ish value, or null when it is empty or unreadable.
 * - "yyyy-mm-dd" (optionally followed by a time) → read from the digits, no timezone involved.
 * - Date / epoch ms / other date strings → the wall clock in `tz`.
 */
export function dateParts(v: DateInput, tz: string = IST): DateParts | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const s = v.trim();
    const m = YMD.exec(s);
    // A bare calendar date, or a date-time with no zone: read the digits as written.
    if (m && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
      const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo))) return null;
      const t = /T(\d{2}):(\d{2})/.exec(s);
      return { y, m: mo, d, hh: t ? +t[1]! : 0, mm: t ? +t[2]! : 0, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
    }
  }
  const date = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(date.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const p of partsFmt(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    y: +parts.year!,
    m: +parts.month!,
    d: +parts.day!,
    hh: +parts.hour! % 24,
    mm: +parts.minute!,
    dow: DOW_INDEX[parts.weekday!] ?? date.getUTCDay(),
  };
}

/** Calendar day ("yyyy-mm-dd") of an instant in `tz`; "" when empty. */
export function ymdOf(v: DateInput, tz: string = IST): string {
  const p = dateParts(v, tz);
  return p ? toYmd(p.y, p.m, p.d) : "";
}

export interface FmtOptions {
  tz?: string;
  /** Four-digit year for formal documents; the default is the compact two-digit year. */
  fullYear?: boolean;
}

function dmy(p: DateParts, fullYear?: boolean): string {
  return `${two(p.d)}/${two(p.m)}/${fullYear ? String(p.y).padStart(4, "0") : two(p.y % 100)}`;
}

/** "02/11/26" — the standard compact date. "" when empty or unreadable. */
export function fmtDate(v: DateInput, o: FmtOptions = {}): string {
  const p = dateParts(v, o.tz);
  return p ? dmy(p, o.fullYear) : "";
}

/** "02/11/2026" — for formal reports and statements. */
export function fmtDateLong(v: DateInput, o: Omit<FmtOptions, "fullYear"> = {}): string {
  return fmtDate(v, { ...o, fullYear: true });
}

/** "03:45 PM". */
export function fmtTime(v: DateInput, o: Omit<FmtOptions, "fullYear"> = {}): string {
  const p = dateParts(v, o.tz);
  if (!p) return "";
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${two(h12)}:${two(p.mm)} ${p.hh < 12 ? "AM" : "PM"}`;
}

/** "02/11/26, 03:45 PM". */
export function fmtDateTime(v: DateInput, o: FmtOptions = {}): string {
  const p = dateParts(v, o.tz);
  return p ? `${dmy(p, o.fullYear)}, ${fmtTime(v, o)}` : "";
}

/** "Monday" / "Mon". */
export function fmtWeekday(v: DateInput, style: "long" | "short" = "long", tz?: string): string {
  const p = dateParts(v, tz);
  return p ? (style === "long" ? WEEKDAY_LONG : WEEKDAY_SHORT)[p.dow]! : "";
}

/** "Monday, 02/11/26" (or "Mon, 02/11/26" with style "short"). */
export function fmtDateWithWeekday(v: DateInput, style: "long" | "short" = "long", o: FmtOptions = {}): string {
  const p = dateParts(v, o.tz);
  return p ? `${(style === "long" ? WEEKDAY_LONG : WEEKDAY_SHORT)[p.dow]}, ${dmy(p, o.fullYear)}` : "";
}

/** "Nov 2026" (long: "November 2026"). Accepts "yyyy-mm", "yyyy-mm-dd" or an instant. */
export function fmtMonth(v: DateInput, style: "short" | "long" = "short", tz?: string): string {
  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v.trim())) {
    const [y, m] = v.trim().split("-").map(Number) as [number, number];
    if (m < 1 || m > 12) return "";
    return `${(style === "long" ? MONTH_LONG : MONTH_SHORT)[m - 1]} ${y}`;
  }
  const p = dateParts(v, tz);
  return p ? `${(style === "long" ? MONTH_LONG : MONTH_SHORT)[p.m - 1]} ${p.y}` : "";
}

/** "01/11/26 – 30/11/26"; one date when both ends are the same day or one end is missing. */
export function fmtDateRange(from: DateInput, to: DateInput, o: FmtOptions = {}): string {
  const a = fmtDate(from, o);
  const b = fmtDate(to, o);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a || b;
}

/**
 * Read a date a person typed. Accepts dd/mm/yy, dd/mm/yyyy, d/m/yy, with
 * "/", "-", "." or a space between the parts, and "yyyy-mm-dd" as pasted
 * from elsewhere. Day always comes first — the field says so — so there is
 * no dd/mm vs mm/dd ambiguity. Two-digit years 00–69 are 2000–2069,
 * 70–99 are 1970–1999. Returns "yyyy-mm-dd", or null for anything that is
 * not a real calendar date (31/02/26, 00/01/26, 12/13/26 …).
 */
export function parseDmy(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.trim();
  if (!s) return null;
  if (isValidYmd(s)) return s;
  const m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const d = +m[1]!, mo = +m[2]!;
  let y = +m[3]!;
  if (m[3]!.length === 2) y += y <= 69 ? 2000 : 1900;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return toYmd(y, mo, d);
}

/** Today's calendar date in `tz` ("yyyy-mm-dd"). */
export function todayYmd(tz: string = IST, now: Date = new Date()): string {
  return ymdOf(now, tz);
}
