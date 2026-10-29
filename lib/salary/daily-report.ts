import { ATTENDANCE_CODE_LABELS, type AttendanceCode } from "@/db/enums";
import { buildCalendar, CODE_GROUP, type StatusGroup } from "@/lib/attendance/overview";
import type { DayRow, MonthSummary } from "@/lib/queries/attendance-status";

/**
 * What the employee's My Salary page shows about a month, worked out from the
 * figures the salary run stored and the days the attendance grader produced.
 * Pure: no database, no clock. Money is handled in whole PAISE (integers), so
 * the sums are exact; `computeSalary` (lib/salary/compute.ts) stays the only
 * place a salary is decided — nothing here invents a rate or a rule.
 *
 * How a day earns money, as the engine has always done it: the month's pay is
 * the per-day rate (monthly CTC ÷ calendar days) × the sum of each day's
 * day-value (P = 1, H/D = ½, A = 0, HP = 2, …), less the late deduction (every
 * third un-waived late = ½ day). There is NO hours-based pay and no hours
 * target in the attendance policy, so hours are reported, never priced.
 */

export interface RunMoney {
  annualCtc: number;
  daysInMonth: number;
  payableDays: number;
  lateMarks: number;
  lateDeductionDays: number;
  gross: number;
  pt: number;
  tds: number;
  advances: number;
  pendingBalanceIn: number;
  netPayable: number;
  source: string;
}

/** Whole paise from a rupee figure stored with two decimals. */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** Monthly CTC in paise exactly as computeSalary rounds it (annual ÷ 12, to the paisa). */
export const monthlyCtcPaise = (annualCtc: number): number => toPaise(Math.round((annualCtc / 12 + Number.EPSILON) * 100) / 100);

/** `dayValue` days of pay in paise at this run's rate, rounded to the paisa. */
export function dayPaise(run: Pick<RunMoney, "annualCtc" | "daysInMonth">, dayValue: number): number {
  if (run.daysInMonth <= 0) return 0;
  return Math.round((monthlyCtcPaise(run.annualCtc) * dayValue) / run.daysInMonth);
}

// ── the breakdown card ─────────────────────────────────────────────────────

export interface BreakdownLine {
  key: string;
  label: string;
  /** Signed paise: earnings positive, deductions negative. */
  paise: number;
  kind: "earning" | "deduction" | "adjustment";
  note?: string;
}

export interface Breakdown {
  /** The stored gross: per-day rate × (payable days − late deduction days). */
  grossPaise: number;
  lines: BreakdownLine[];
  deductionsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
  /** gross − deductions + adjustments equals the stored net, to the paisa. */
  reconciles: boolean;
  /** Stored net − what the lines add up to (0 when it reconciles). */
  differencePaise: number;
  detail: {
    monthlyCtcPaise: number;
    perDayPaise: number;
    daysInMonth: number;
    payableDays: number;
    lateMarks: number;
    lateDeductionDays: number;
    effectiveDays: number;
  };
}

/**
 * The run's own figures, laid out as the page shows them and checked against
 * the stored net: net = gross − PT − TDS − advances + pending balance carried in.
 */
export function buildBreakdown(run: RunMoney): Breakdown {
  const grossPaise = toPaise(run.gross);
  const all: BreakdownLine[] = [
    { key: "pt", label: "Professional tax", paise: -toPaise(run.pt), kind: "deduction" },
    { key: "tds", label: "TDS", paise: -toPaise(run.tds), kind: "deduction" },
    { key: "advances", label: "Advances taken this month", paise: -toPaise(run.advances), kind: "deduction" },
    {
      key: "pending",
      label: "Balance carried in from an earlier month",
      paise: toPaise(run.pendingBalanceIn),
      kind: "adjustment",
      note: "The part of an earlier month's pay that was not disbursed then.",
    },
  ];
  const lines = all.filter((l) => l.paise !== 0);
  const deductionsPaise = lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.paise, 0);
  const adjustmentsPaise = lines.filter((l) => l.kind === "adjustment").reduce((s, l) => s + l.paise, 0);
  const netPaise = toPaise(run.netPayable);
  const computed = grossPaise + deductionsPaise + adjustmentsPaise;
  const mc = monthlyCtcPaise(run.annualCtc);
  return {
    grossPaise,
    lines,
    deductionsPaise,
    adjustmentsPaise,
    netPaise,
    reconciles: computed === netPaise,
    differencePaise: netPaise - computed,
    detail: {
      monthlyCtcPaise: mc,
      perDayPaise: run.daysInMonth > 0 ? Math.round(mc / run.daysInMonth) : 0,
      daysInMonth: run.daysInMonth,
      payableDays: run.payableDays,
      lateMarks: run.lateMarks,
      lateDeductionDays: run.lateDeductionDays,
      effectiveDays: run.payableDays - run.lateDeductionDays,
    },
  };
}

// ── the attendance summary cards ───────────────────────────────────────────

export interface AttendanceCards {
  /** Full days present (code P). */
  daysWorked: number;
  /** Graded days that were working days: present, half, absent, no check-out, leave, comp-off. */
  workingDays: number;
  halfDays: number;
  absent: number;
  /** Days with a check-in but no check-out — flagged, not paid, not "absent". */
  noCheckOut: number;
  paidLeave: number;
  unpaidLeave: number;
  compOff: number;
  /** Holidays and weekly offs (not worked). */
  offDays: number;
  /** Holidays or weekly offs that were worked (HP, H-H/D). */
  workedOffDays: number;
  payableDays: number;
  lateMarks: number;
}

/** The counts the cards show, straight from the grader's month summary. */
export function attendanceCards(s: MonthSummary): AttendanceCards {
  return {
    daysWorked: s.present,
    workingDays: s.present + s.halfDay + s.absent + s.incomplete + s.paidLeave + s.unpaidLeave + s.compOff,
    halfDays: s.halfDay + s.holidayHalfDay,
    absent: s.absent,
    noCheckOut: s.incomplete,
    paidLeave: s.paidLeave,
    unpaidLeave: s.unpaidLeave,
    compOff: s.compOff,
    offDays: s.holiday + s.weeklyOff,
    workedOffDays: s.holidayPresent + s.holidayHalfDay,
    payableDays: s.payableDays,
    lateMarks: s.late,
  };
}

// ── the daily report ───────────────────────────────────────────────────────

export interface DailyRow {
  date: string;
  /** 0 = Sun … 6 = Sat. */
  weekday: number;
  code: AttendanceCode | null;
  group: StatusGroup | null;
  /** "Present", "Half Day", … or "Upcoming" for a day that hasn't happened. */
  label: string;
  future: boolean;
  isToday: boolean;
  inAt: string | null;
  outAt: string | null;
  workedMinutes: number;
  /** Days of pay this day carries (P = 1, H/D = 0.5, A = 0, HP = 2 …); 0 when not yet graded. */
  dayValue: number;
  /** This day's pay in paise at the run's rate; null when the month has no run. */
  earnedPaise: number | null;
  late: boolean;
  lateWaived: boolean;
}

export interface DailyWeek {
  index: number;
  start: string;
  end: string;
  rows: DailyRow[];
  workedMinutes: number;
  dayValues: number;
  earnedPaise: number | null;
  counts: Partial<Record<StatusGroup, number>> & { upcoming: number };
}

export interface DailyReport {
  weeks: DailyWeek[];
  totals: {
    workedMinutes: number;
    dayValues: number;
    /** Σ of the day rows, in paise; null without a run. */
    earnedPaise: number | null;
    /** −(late deduction days × per-day rate), in paise; 0 without a run. */
    lateDeductionPaise: number;
    /** Stored gross − (Σ days − late deduction): the rounding left over, so the rows add up to the gross exactly. */
    roundingPaise: number;
    /** The run's stored gross, in paise; null without a run. */
    grossPaise: number | null;
    upcomingDays: number;
  };
}

const WEEK_END = (start: string, n: number) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Every day of the month, week by week (Monday → Sunday, as the calendar
 * draws it), with its status, punches, hours and — when the month has a
 * salary run — the pay that day carries at the run's own rate. Days that
 * haven't happened are "Upcoming" and carry nothing. Which code a day shows,
 * and when, is decided by the same `buildCalendar` the calendar uses, so the
 * two can never disagree.
 */
export function buildDailyReport(days: readonly DayRow[], year: number, month: number, today: string, run: RunMoney | null): DailyReport {
  const byDate = new Map(days.map((d) => [d.logDate, d]));
  const weeks = buildCalendar(days, year, month, today);
  const out: DailyWeek[] = [];
  let workedMinutes = 0;
  let dayValues = 0;
  let earned = 0;
  let upcomingDays = 0;

  weeks.forEach((w, i) => {
    const cells = w.cells.filter((c) => c.inMonth);
    if (cells.length === 0) return;
    const rows: DailyRow[] = cells.map((c) => {
      const d = byDate.get(c.date);
      const future = c.date > today;
      const graded = c.code !== null;
      const dayValue = graded && d ? d.dayValue : 0;
      const code = (c.code as AttendanceCode | null) ?? null;
      return {
        date: c.date,
        weekday: new Date(`${c.date}T00:00:00Z`).getUTCDay(),
        code,
        group: c.group,
        label: code ? ATTENDANCE_CODE_LABELS[code] : future ? "Upcoming" : "No record",
        future,
        isToday: c.isToday,
        inAt: c.inAt,
        outAt: c.outAt,
        workedMinutes: c.workedMinutes,
        dayValue,
        earnedPaise: run ? dayPaise(run, dayValue) : null,
        late: Boolean(d?.late),
        lateWaived: Boolean(d?.lateWaived),
      };
    });
    const counts: DailyWeek["counts"] = { upcoming: 0 };
    for (const r of rows) {
      if (r.group) counts[r.group] = (counts[r.group] ?? 0) + 1;
      else if (r.future) counts.upcoming++;
    }
    const wm = rows.reduce((s, r) => s + r.workedMinutes, 0);
    const dv = rows.reduce((s, r) => s + r.dayValue, 0);
    const ep = run ? rows.reduce((s, r) => s + (r.earnedPaise ?? 0), 0) : null;
    workedMinutes += wm;
    dayValues += dv;
    earned += ep ?? 0;
    upcomingDays += counts.upcoming;
    const first = rows[0]!.date;
    const last = rows[rows.length - 1]!.date;
    out.push({ index: i + 1, start: first, end: last, rows, workedMinutes: wm, dayValues: dv, earnedPaise: ep, counts });
  });

  const lateDeductionPaise = run ? -dayPaise(run, run.lateDeductionDays) : 0;
  const grossPaise = run ? toPaise(run.gross) : null;
  const roundingPaise = run ? grossPaise! - (earned + lateDeductionPaise) : 0;
  return {
    weeks: out,
    totals: { workedMinutes, dayValues, earnedPaise: run ? earned : null, lateDeductionPaise, roundingPaise, grossPaise, upcomingDays },
  };
}

/** The legend group of a day code (re-exported for the report's status pills). */
export const groupOfCode = (code: AttendanceCode): StatusGroup => CODE_GROUP[code];

/** "Oct 2026" → the month key "2026-10" is the canonical form; this is the display form used across the page. */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Neighbouring months of a "YYYY-MM" key. */
export function shiftMonthKey(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
