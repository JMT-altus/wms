/**
 * DCC — the scheduling engine.
 *
 * Deliberately client-safe: no `server-only`, no db import, no React. The
 * board, the dashboard, the ranking, the server actions and the JSON API all
 * derive due-ness from THESE functions, so web and mobile cannot drift apart.
 *
 * Weekday bitmask convention throughout: bit0 = Monday … bit6 = Sunday.
 * (Not JS `getDay()` order — see `weekdayBit`.)
 */

export const DCC_STATUSES = ["Done", "Not done", "NA", "Pending"] as const;
export type DccStatus = (typeof DCC_STATUSES)[number];

export const SCHEDULE_KINDS = [
  "scheduled",
  "weekly",
  "monthly",
  "adhoc",
  "event",
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Mon–Sat, i.e. everything except Sunday. What "Daily" means here. */
export const MASK_MON_SAT = 0b111111;

/* ────────────────────────────────────────────────────────────────────
   Frequency parsing
   ──────────────────────────────────────────────────────────────────── */

/**
 * Day tokens, in bit order (Mon=0 … Sun=6).
 *
 * Each pattern matches BOTH the abbreviation and the full name. Matching only
 * abbreviations is a real bug that shipped once: "Every Friday" contains no
 * bare "fri" token under `/\bfri\b/`, fell through to null, and a weekly KPI
 * became due every single day. Hence `(day)?` / `(sday)?` everywhere.
 */
const DAY_PATTERNS: readonly RegExp[] = [
  /\bmon(day)?s?\b/i,
  /\btue(s|sday)?s?\b/i,
  /\bwed(nesday)?s?\b/i,
  /\b(thu(rsday|rs|r)?|thr)s?\b/i,
  /\bfri(day)?s?\b/i,
  /\bsat(urday)?s?\b/i,
  /\bsun(day)?s?\b/i,
];

/**
 * Turn a human frequency string into a weekday bitmask.
 * Returns null when nothing is recognised — callers treat null as "always due"
 * ONLY for items already classified `scheduled`; `parseFrequency` below makes
 * sure an unrecognised string never gets that far.
 */
export function parseFrequencyToMask(freq: string | null | undefined): number | null {
  if (!freq) return null;
  const s = freq.trim();
  if (!s) return null;

  if (/\bdaily\b/i.test(s) || /\bevery\s*day\b/i.test(s) || /\beveryday\b/i.test(s)) {
    return MASK_MON_SAT;
  }

  let mask = 0;
  for (let bit = 0; bit < DAY_PATTERNS.length; bit++) {
    if (DAY_PATTERNS[bit]!.test(s)) mask |= 1 << bit;
  }
  return mask === 0 ? null : mask;
}

/** How many bits are set in a mask. */
function bitCount(mask: number): number {
  let n = 0;
  for (let b = 0; b < 7; b++) if (mask & (1 << b)) n++;
  return n;
}

export interface ParsedFrequency {
  scheduleKind: ScheduleKind;
  /** null = no weekday constraint recorded. */
  weekdays: number | null;
  /** True when we could not classify the string and a human should look. */
  needsReview: boolean;
}

/**
 * The single authority on what a frequency string means. Both `createDccItem`
 * and `updateDccItem` run this and persist all three outputs.
 *
 * Order matters and is exactly as listed — earlier rules win.
 *
 * The critical case is #1 and #10: an unparseable or blank frequency becomes
 * `adhoc` + `needsReview`, NEVER a `scheduled` item with a null mask. A null
 * mask on a scheduled item means "due every day", so the naive fallback would
 * silently make every typo a daily obligation that tanks everyone's
 * compliance % and breaks their streak.
 */
export function parseFrequency(raw: string | null | undefined): ParsedFrequency {
  const s = (raw ?? "").trim();

  // 1. Blank → adhoc. Never blocks, never inflates the daily count.
  if (!s) return { scheduleKind: "adhoc", weekdays: null, needsReview: true };

  // 2. Explicitly ad-hoc.
  if (/\badhoc\b/i.test(s) || /\bad[-\s]hoc\b/i.test(s)) {
    return { scheduleKind: "adhoc", weekdays: null, needsReview: false };
  }

  // 3. Event-driven: "as per HH call scheduled", "as and when", "when it happens".
  if (
    /\bas\s+per\b[\s\S]*\b(call|scheduled|schedule|meeting)\b/i.test(s) ||
    /\bas\s+(and\s+)?when\b/i.test(s) ||
    /\bwhen\s+it\s+happens\b/i.test(s)
  ) {
    return { scheduleKind: "event", weekdays: null, needsReview: false };
  }

  // 4. Monthly.
  if (/\bmonthly\b/i.test(s) || /\bevery\s+month\b/i.test(s) || /\bper\s+month\b/i.test(s)) {
    return { scheduleKind: "monthly", weekdays: 0, needsReview: false };
  }

  const mask = parseFrequencyToMask(s);
  const isDailyPhrase =
    /\bdaily\b/i.test(s) || /\bevery\s*day\b/i.test(s) || /\beveryday\b/i.test(s);

  // 5. "Mon or Thu" — one slot satisfiable on either day, so it's weekly, not
  //    two separate daily obligations.
  if (/\bor\b/i.test(s) && mask !== null && bitCount(mask) >= 2) {
    return { scheduleKind: "weekly", weekdays: mask, needsReview: false };
  }

  // 6. Explicitly weekly.
  if (/\bweekly\b/i.test(s) || /\bevery\s+week\b/i.test(s) || /\bper\s+week\b/i.test(s)) {
    return { scheduleKind: "weekly", weekdays: mask ?? 0, needsReview: false };
  }

  // 7. "Every <single weekday>" — one slot a week on that day.
  if (/\bevery\b/i.test(s) && !isDailyPhrase && mask !== null && bitCount(mask) === 1) {
    return { scheduleKind: "weekly", weekdays: mask, needsReview: false };
  }

  // 8. Daily.
  if (isDailyPhrase) {
    return { scheduleKind: "scheduled", weekdays: MASK_MON_SAT, needsReview: false };
  }

  // 9. A plain day list: "Wed & Sat".
  if (mask !== null) {
    return { scheduleKind: "scheduled", weekdays: mask, needsReview: false };
  }

  // 10. Unrecognised. Park it out of the way and flag it.
  return { scheduleKind: "adhoc", weekdays: null, needsReview: true };
}

/* ────────────────────────────────────────────────────────────────────
   Dates
   ──────────────────────────────────────────────────────────────────── */

/**
 * LOCAL yyyy-mm-dd.
 *
 * Never `toISOString().slice(0,10)`: that converts to UTC first, so for anyone
 * east of UTC (this app runs in IST, +05:30) any time before 05:30 local
 * reports YESTERDAY. A DCC filled at 9am would land on the wrong day roughly
 * never, but one filled at 5am would always be wrong — and the streak walk
 * would see a hole that isn't there.
 */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a yyyy-mm-dd string as a LOCAL midnight Date (not UTC). */
export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Today, local. */
export function todayIso(): string {
  return isoDate(new Date());
}

/** Shift a yyyy-mm-dd by N days, staying in local time. */
export function addDays(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Our bit index for a date: JS getDay() is Sun=0, we want Mon=0 … Sun=6. */
export function weekdayBit(date: Date | string): number {
  const d = typeof date === "string" ? fromIsoDate(date) : date;
  const g = d.getDay();
  return g === 0 ? 6 : g - 1;
}

/** ISO-8601 week key, Thursday-anchored: "2026-W27". */
export function isoWeekKey(date: Date | string): string {
  const d = typeof date === "string" ? fromIsoDate(date) : new Date(date);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Move to the Thursday of this week — the year that Thursday falls in is,
  // by definition, the ISO week-year.
  t.setDate(t.getDate() - weekdayBit(t) + 3);
  const isoYear = t.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  firstThursday.setDate(firstThursday.getDate() - weekdayBit(firstThursday) + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** "2026-07". */
export function yearMonthKey(date: Date | string): string {
  const d = typeof date === "string" ? fromIsoDate(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ────────────────────────────────────────────────────────────────────
   Due-ness
   ──────────────────────────────────────────────────────────────────── */

/** Does this weekday mask cover this date? A null/0 mask means "always". */
export function isDueOn(mask: number | null | undefined, date: Date | string): boolean {
  if (mask == null || mask === 0) return true;
  return (mask & (1 << weekdayBit(date))) !== 0;
}

/** The shape `scheduledDueOn` needs — deliberately structural, not the DB row. */
export interface SchedulableItem {
  scheduleKind?: string | null;
  isParticipantList?: boolean | null;
  weekdays?: number | null;
}

/**
 * THE predicate for the daily due-set.
 *
 * This is the only function allowed to decide what counts toward the daily
 * count, the compliance %, the streak, the ranking and any gate. Anywhere you
 * are tempted to call `isDueOn` directly on the daily path, call this instead —
 * `isDueOn` alone would sweep weekly/monthly/adhoc/event and participant-list
 * KPIs into today's obligations, which is the single most damaging bug this
 * module can have.
 */
export function scheduledDueOn(item: SchedulableItem, date: Date | string): boolean {
  if ((item.scheduleKind ?? "scheduled") !== "scheduled") return false;
  if (item.isParticipantList) return false;
  return isDueOn(item.weekdays, date);
}

/** Stable key for one fill slot. subjectId omitted/null = the item's own row. */
export function slotKey(
  itemId: string,
  subjectId: string | null | undefined,
  date: string,
): string {
  return `${itemId}|${subjectId ?? ""}|${date}`;
}

/* ────────────────────────────────────────────────────────────────────
   Presentation
   ──────────────────────────────────────────────────────────────────── */

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Any" | "Daily" | "Mon · Wed · Sat" */
export function maskLabel(mask: number | null | undefined): string {
  if (mask == null || mask === 0) return "Any";
  if (mask === MASK_MON_SAT) return "Daily";
  const days: string[] = [];
  for (let b = 0; b < 7; b++) if (mask & (1 << b)) days.push(DAY_LABELS[b]!);
  return days.join(" · ");
}

export interface StatusTone {
  bg: string;
  fg: string;
  dot: string;
}

/**
 * Status colours, drawn from the app's own status palette tokens so DCC
 * matches every other surface: green Done, red Not done, amber Pending,
 * slate NA.
 */
export function dccStatusTone(status: string | null | undefined): StatusTone {
  switch (status) {
    case "Done":
      return {
        bg: "var(--color-green-bg)",
        fg: "var(--color-green-deep)",
        dot: "var(--color-green)",
      };
    case "Not done":
      return {
        bg: "var(--color-red-bg)",
        fg: "var(--color-red-deep)",
        dot: "var(--color-red)",
      };
    case "Pending":
      return {
        bg: "var(--color-amber-bg)",
        fg: "var(--color-amber-deep)",
        dot: "var(--color-amber)",
      };
    default:
      return {
        bg: "var(--color-slate-bg)",
        fg: "var(--color-slate-deep)",
        dot: "var(--color-slate)",
      };
  }
}

/**
 * The one threshold rule, used by every percentage in the module:
 * ≥80 green, ≥60 amber, below red.
 */
export function pctTone(pct: number): { fg: string; bg: string; solid: string } {
  if (pct >= 80) {
    return {
      fg: "var(--color-green-deep)",
      bg: "var(--color-green-bg)",
      solid: "var(--color-green)",
    };
  }
  if (pct >= 60) {
    return {
      fg: "var(--color-amber-deep)",
      bg: "var(--color-amber-bg)",
      solid: "var(--color-amber)",
    };
  }
  return { fg: "var(--color-red-deep)", bg: "var(--color-red-bg)", solid: "var(--color-red)" };
}

/** Percentage helper that treats "nothing due" as 100 % rather than NaN. */
export function pctOf(done: number, due: number): number {
  if (due <= 0) return 100;
  return Math.round((done / due) * 100);
}

/** "Sat, 12 Jul" — the date stepper's label. */
export function shortDateLabel(iso: string): string {
  const d = fromIsoDate(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** A fill counts as "filled" if it carries any of status, value or note. */
export function isFilled(e: {
  status?: string | null;
  valueNumber?: string | number | null;
  note?: string | null;
} | null | undefined): boolean {
  if (!e) return false;
  return Boolean(e.status) || e.valueNumber != null || Boolean(e.note && e.note.trim());
}
