/**
 * The employee Attendance overview — period ranges, the six KPI figures and the
 * monthly calendar, all derived from the per-day grades the status engine
 * already produces (`getEmployeeMonthStatus`).
 *
 * CLIENT-SAFE and pure: no DB, no clock. "Today" is always passed in, in the
 * employee's own timezone, so every function here is testable with fixed dates.
 *
 * ── The rules this file encodes (agreed, not inferred) ─────────────────────
 *
 *  Expected working day   a day, up to and including today, that is not a
 *                         weekly off, an active holiday or before the join
 *                         date. Approved leave and comp-off days STILL count
 *                         as expected. A worked weekly-off / holiday (HP,
 *                         H-H/D) is extra work, not an expected day.
 *  Expected hours         expected working days × the org Full-Day Hours.
 *  Hrs Balance            hours worked − expected hours.
 *  Effective Days Worked  Σ day-value of days someone actually worked:
 *                         Present 1, Half Day 0.5, Holiday Present 2,
 *                         Holiday Half-Day 1.5. Leave, weekly-offs and
 *                         un-worked holidays are not worked days.
 *  Half Days              days graded Half Day (H/D).
 *  Grace + Condoned       days where a late arrival / early exit was forgiven
 *                         because a full day was still worked (`lateWaived`).
 *  Salary Lost (in DAYS)  absent days + unpaid-leave days + ½ per half day
 *                         + the late deduction (½ day for every 3 un-waived
 *                         lates in the month — the same rule `computeSalary`
 *                         applies). No money figure is ever produced here.
 *
 * Every figure is for ONE calendar month, selected by month + year. The
 * current month reports through today; a past month reports in full; a month
 * that hasn't started reports nothing.
 */

import type { DayRow } from "@/lib/queries/attendance-status";
import type { AttendanceCode } from "@/db/enums";

/* ── The reporting month ─────────────────────────────────────────────────── */

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Inclusive calendar range, YYYY-MM-DD. `end` is never after today. */
export interface DateRange {
  start: string;
  end: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Parse YYYY-MM-DD as a UTC calendar day (no clock, so no timezone drift). */
function utc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
const fmt = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function addDays(ymd: string, n: number): string {
  const d = utc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

function monthStart(year: number, month: number): string {
  return `${year}-${pad(month)}-01`;
}
/** Last calendar day of the month — day 0 of the next month, so leap years and 28/29/30/31 fall out. */
function monthEnd(year: number, month: number): string {
  return fmt(new Date(Date.UTC(year, month, 0)));
}

/** Shift a (year, month) pair by whole months. */
export function shiftMonth(
  year: number,
  month: number,
  by: number,
): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + by;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * The days a selected month reports on: the whole month, but never past today
 * (a day that hasn't happened can't be expected, worked or lost). A month that
 * hasn't started yet comes back with `end < start` — an empty range, which
 * every figure reads as "nothing to report yet".
 */
export function monthRange(year: number, month: number, today: string): DateRange {
  const start = monthStart(year, month);
  const last = monthEnd(year, month);
  return { start, end: last < today ? last : today };
}

/**
 * Read ?y= and ?m= into a valid (year, month), falling back to the current
 * month for anything missing or out of range. A year or month on its own
 * keeps the other at its default rather than rejecting both.
 */
export function parseYearMonth(
  y: string | string[] | undefined,
  m: string | string[] | undefined,
  today: string,
): { year: number; month: number } {
  const [cy, cm] = today.split("-").map(Number) as [number, number];
  const ry = typeof y === "string" ? Number(y) : NaN;
  const rm = typeof m === "string" ? Number(m) : NaN;
  return {
    year: Number.isInteger(ry) && ry >= 2000 && ry <= 2100 ? ry : cy,
    month: Number.isInteger(rm) && rm >= 1 && rm <= 12 ? rm : cm,
  };
}

/**
 * The years the dropdown offers, newest first: from the earliest year with any
 * attendance on record through the current year. The selected year is always
 * included, so a link to a year outside the range still shows what it is on.
 * No future years: nothing is planned or recorded ahead of today.
 */
export function yearOptions(
  earliestYear: number | null,
  currentYear: number,
  selectedYear: number,
): number[] {
  const first = Math.min(earliestYear ?? currentYear, currentYear, selectedYear);
  const last = Math.max(currentYear, selectedYear);
  const out: number[] = [];
  for (let y = last; y >= first; y--) out.push(y);
  return out;
}

/* ── KPIs ────────────────────────────────────────────────────────────────── */

/** Codes that are NOT an expected working day. "–" is "before joining". */
const NOT_EXPECTED = new Set<string>(["W/O", "H", "HP", "H-H/D", "–"]);
/** Codes that mean the person actually worked the day. */
const WORKED_CODES = new Set<string>(["P", "H/D", "HP", "H-H/D"]);

export interface OverviewKpis {
  workedMinutes: number;
  expectedMinutes: number;
  /** worked − expected; negative means behind. */
  balanceMinutes: number;
  expectedDays: number;
  effectiveDays: number;
  halfDays: number;
  graceCondoned: number;
  /** Days of pay lost. See the file header for exactly what it counts. */
  lostDays: number;
  lostBreakdown: {
    absent: number;
    unpaidLeave: number;
    halfDayShortfall: number;
    lateDeduction: number;
  };
}

export function computeOverview(
  days: readonly DayRow[],
  range: DateRange,
  fullDayMinutes: number,
): OverviewKpis {
  const inRange = days.filter((d) => d.logDate >= range.start && d.logDate <= range.end);

  let workedMinutes = 0;
  let expectedDays = 0;
  let effectiveDays = 0;
  let halfDays = 0;
  let graceCondoned = 0;
  let absent = 0;
  let unpaidLeave = 0;
  const unwaivedLateByMonth = new Map<string, number>();

  for (const d of inRange) {
    workedMinutes += d.workedMinutes;
    if (!NOT_EXPECTED.has(d.code)) expectedDays += 1;
    if (WORKED_CODES.has(d.code)) effectiveDays += d.dayValue;
    if (d.code === "H/D") halfDays += 1;
    if (d.lateWaived) graceCondoned += 1;
    if (d.code === "A") absent += 1;
    if (d.code === "LWP") unpaidLeave += 1;
    if (d.late && !d.lateWaived) {
      const k = d.logDate.slice(0, 7);
      unwaivedLateByMonth.set(k, (unwaivedLateByMonth.get(k) ?? 0) + 1);
    }
  }

  // "Every 3rd un-waived late in a month costs half a day." The range is one
  // month, so there is exactly one count to apply it to.
  let lateDeduction = 0;
  for (const n of unwaivedLateByMonth.values()) lateDeduction += Math.floor(n / 3) * 0.5;

  const halfDayShortfall = halfDays * 0.5;
  const expectedMinutes = expectedDays * fullDayMinutes;
  return {
    workedMinutes,
    expectedMinutes,
    balanceMinutes: workedMinutes - expectedMinutes,
    expectedDays,
    effectiveDays,
    halfDays,
    graceCondoned,
    lostDays: absent + unpaidLeave + halfDayShortfall + lateDeduction,
    lostBreakdown: { absent, unpaidLeave, halfDayShortfall, lateDeduction },
  };
}

/** 125 → "2h 5m"; 0 → "0h"; negative keeps its sign. */
export function formatMinutes(min: number, signed = false): string {
  const sign = min < 0 ? "−" : signed && min > 0 ? "+" : "";
  const abs = Math.round(Math.abs(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const body = m === 0 ? `${h}h` : h === 0 ? `${m}m` : `${h}h ${m}m`;
  return `${sign}${body}`;
}

/** 1.5 → "1.5", 2 → "2" (no trailing .0). */
export function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/* ── Calendar ────────────────────────────────────────────────────────────── */

export type StatusGroup =
  | "present"
  | "half"
  | "absent"
  | "holiday"
  | "weekoff"
  | "offwork"
  | "leave"
  | "compoff"
  | "open";

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  present: "Present",
  half: "Half Day",
  absent: "Absent",
  holiday: "Holiday",
  weekoff: "Weekly Off",
  offwork: "Worked on off day",
  leave: "Leave",
  compoff: "Comp Off",
  open: "No check-out",
};

/** Which legend group a day code belongs to. */
export const CODE_GROUP: Record<AttendanceCode, StatusGroup> = {
  P: "present",
  "H/D": "half",
  A: "absent",
  H: "holiday",
  "W/O": "weekoff",
  HP: "offwork",
  "H-H/D": "offwork",
  PL: "leave",
  LWP: "leave",
  CO: "compoff",
  incomplete: "open",
};

/** On a day that hasn't happened, only these are facts rather than "Absent". */
const KNOWN_IN_ADVANCE = new Set<string>(["H", "W/O", "PL", "LWP", "CO"]);

export interface CalendarCell {
  date: string;
  day: number;
  /** False for the lead/trail days of the neighbouring months that fill the grid. */
  inMonth: boolean;
  /** null for a day with nothing to show (future, or before joining). */
  group: StatusGroup | null;
  code: string | null;
  workedMinutes: number;
  isToday: boolean;
  inAt: string | null;
  outAt: string | null;
}

export interface CalendarWeek {
  /** Seven days, Monday first. Days outside the month are real dates, flagged `inMonth: false`. */
  cells: CalendarCell[];
  /** Hours worked on this row's days INSIDE the month only. */
  workedMinutes: number;
}

export function buildCalendar(
  days: readonly DayRow[],
  year: number,
  month: number,
  today: string,
): CalendarWeek[] {
  const byDate = new Map(days.map((d) => [d.logDate, d]));
  const first = monthStart(year, month);
  const last = monthEnd(year, month);
  const lead = (utc(first).getUTCDay() + 6) % 7; // neighbour days before the 1st
  const gridStart = addDays(first, -lead);
  const span = lead + Number(last.slice(8));
  const total = Math.ceil(span / 7) * 7;

  const slots: CalendarCell[] = [];
  for (let i = 0; i < total; i++) {
    const d = addDays(gridStart, i);
    const inMonth = d >= first && d <= last;
    if (!inMonth) {
      // A date from the neighbouring month: shown faded, carrying no status.
      slots.push({
        date: d, day: Number(d.slice(8)), inMonth, group: null, code: null,
        workedMinutes: 0, isToday: d === today, inAt: null, outAt: null,
      });
      continue;
    }
    const row = byDate.get(d);
    const future = d > today;
    const code = row?.code ?? null;
    const shown =
      row && code && code !== "–" && (!future || KNOWN_IN_ADVANCE.has(code));
    slots.push({
      date: d,
      day: Number(d.slice(8)),
      inMonth,
      group: shown ? CODE_GROUP[code as AttendanceCode] : null,
      code: shown ? code : null,
      workedMinutes: row?.workedMinutes ?? 0,
      isToday: d === today,
      inAt: row?.inAt ?? null,
      outAt: row?.outAt ?? null,
    });
  }

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < slots.length; i += 7) {
    const cells = slots.slice(i, i + 7);
    weeks.push({
      cells,
      workedMinutes: cells.reduce((s, c) => s + (c.inMonth ? c.workedMinutes : 0), 0),
    });
  }
  return weeks;
}

/* ── Holidays ────────────────────────────────────────────────────────────── */

/** "Today", "Tomorrow", "In 12 days", "In 3 months" — from whole calendar days. */
export function timeUntil(date: string, today: string): string {
  const days = Math.round((utc(date).getTime() - utc(today).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 60) return `In ${days} days`;
  return `In ${Math.round(days / 30)} months`;
}

/* ── Greeting ────────────────────────────────────────────────────────────── */

/**
 * "Good to see you, Asha" from the signed-in employee's display name (first
 * word of it); "Welcome back" when there is no usable name.
 */
export function greetingFor(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good to see you, ${first}` : "Welcome back";
}

/**
 * The holidays to show as "upcoming": active, on or after today, soonest first.
 *
 * Pure so the rule is testable without a database — and so "upcoming" is
 * decided from `today` on every request, never from a baked-in date. Ties on a
 * date fall back to the label so the order is stable. Past holidays are simply
 * not here; there is no history view to send them to.
 */
export function selectUpcomingHolidays<
  T extends { holidayDate: string; label: string; isActive: boolean },
>(rows: readonly T[], today: string, limit = 12): T[] {
  return rows
    .filter((h) => h.isActive && h.holidayDate >= today)
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate) || a.label.localeCompare(b.label))
    .slice(0, limit);
}
