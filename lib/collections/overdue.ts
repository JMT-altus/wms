import { COLLECTION_RULES, type CollectionRules } from "./config";

/**
 * Overdue status for a collection record. Pure: no clock, no database, no UI.
 *
 * Dates are calendar dates (YYYY-MM-DD) in the business timezone. Both sides of
 * the subtraction are turned into UTC midnights of those calendar dates, so the
 * difference is a whole number of days and can never be shifted by the server's
 * or the browser's own timezone.
 */

export type OverdueLevel = "none" | "warning" | "critical";

export type OverdueReason =
  | "no-due-date"
  | "invalid-due-date"
  | "settled"
  | "fully-paid"
  | "not-due"
  | "overdue";

export interface OverdueInput {
  /** YYYY-MM-DD in the business calendar, or null when the source has none. */
  dueDate: string | null | undefined;
  /** The source's payment status, if it has one. */
  status?: string | null;
  /** Amount still owed, if the source supplies it. Zero or less means fully paid. */
  outstanding?: number | null;
}

export interface OverdueResult {
  level: OverdueLevel;
  /** Whole calendar days past the due date (negative = not yet due), or null. */
  daysOverdue: number | null;
  reason: OverdueReason;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC milliseconds of a real calendar date, or null for anything that isn't one. */
export function ymdToUtc(ymd: string | null | undefined): number | null {
  if (typeof ymd !== "string") return null;
  const m = YMD.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

/** Whole calendar days from `fromYmd` to `toYmd` (positive when `toYmd` is later). */
export function calendarDaysBetween(fromYmd: string, toYmd: string): number | null {
  const a = ymdToUtc(fromYmd);
  const b = ymdToUtc(toYmd);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

/** The calendar date (YYYY-MM-DD) of `now` in the business timezone. */
export function businessDate(now: Date, timeZone: string = COLLECTION_RULES.timeZone): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Milliseconds from `now` until the next midnight in the business timezone (at least 1 s). */
export function msUntilNextBusinessDay(now: Date, timeZone: string = COLLECTION_RULES.timeZone): number {
  const today = businessDate(now, timeZone);
  // Step forward in whole minutes until the business date changes; the
  // midnight boundary is always within 24 h (25 h around a DST change).
  const minute = 60_000;
  let lo = 0;
  let hi = 26 * 60 * minute;
  while (hi - lo > minute) {
    const mid = Math.floor((lo + hi) / 2 / minute) * minute;
    if (businessDate(new Date(now.getTime() + mid), timeZone) === today) lo = mid;
    else hi = mid;
  }
  return Math.max(1000, hi);
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function evaluateOverdue(
  input: OverdueInput,
  todayYmd: string,
  rules: CollectionRules = COLLECTION_RULES,
): OverdueResult {
  if (input.dueDate == null || String(input.dueDate).trim() === "") {
    return { level: "none", daysOverdue: null, reason: "no-due-date" };
  }
  if (ymdToUtc(input.dueDate) === null) return { level: "none", daysOverdue: null, reason: "invalid-due-date" };
  const status = norm(input.status);
  if (status && rules.settledStatuses.some((s) => norm(s) === status)) {
    return { level: "none", daysOverdue: null, reason: "settled" };
  }
  if (typeof input.outstanding === "number" && Number.isFinite(input.outstanding) && input.outstanding <= 0) {
    return { level: "none", daysOverdue: null, reason: "fully-paid" };
  }
  const days = calendarDaysBetween(input.dueDate, todayYmd);
  if (days === null) return { level: "none", daysOverdue: null, reason: "invalid-due-date" };
  if (days >= rules.overdue.criticalFromDays) return { level: "critical", daysOverdue: days, reason: "overdue" };
  if (days >= rules.overdue.warningFromDays) return { level: "warning", daysOverdue: days, reason: "overdue" };
  return { level: "none", daysOverdue: days, reason: days > 0 ? "overdue" : "not-due" };
}

/** The more severe of two levels. */
export function worstLevel(a: OverdueLevel, b: OverdueLevel): OverdueLevel {
  const rank = { none: 0, warning: 1, critical: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/**
 * A company's highlight: the worst level across its transactions, and the most
 * days overdue among those that qualify. No transactions → "none"; a company
 * is never highlighted without a due date behind it.
 */
export function partyOverdue(
  transactions: readonly OverdueInput[] | undefined,
  todayYmd: string,
  rules: CollectionRules = COLLECTION_RULES,
): { level: OverdueLevel; daysOverdue: number | null } {
  let level: OverdueLevel = "none";
  let daysOverdue: number | null = null;
  for (const t of transactions ?? []) {
    const r = evaluateOverdue(t, todayYmd, rules);
    if (r.level === "none") continue;
    level = worstLevel(level, r.level);
    daysOverdue = Math.max(daysOverdue ?? 0, r.daysOverdue ?? 0);
  }
  return { level, daysOverdue };
}
