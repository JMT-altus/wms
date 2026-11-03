import { ATTENDANCE_CODE_LABELS, type AttendanceCode } from "@/db/enums";
import type { DayRow } from "@/lib/queries/attendance-status";
import { buildCalendar, type StatusGroup } from "@/lib/attendance/overview";

/**
 * The Attendance Report, week by week — attendance only. Pure: no database,
 * no clock, no salary data.
 *
 * Built from the employee's graded days (the same DayRow[] the dashboard
 * already loads) through `buildCalendar`, the very rule the attendance
 * calendar uses to decide which status a day shows and when. So the report,
 * the calendar and the dashboard can never disagree, and no status is
 * recomputed here. Weeks run Monday → Sunday like the calendar; the first and
 * last weeks are cut to the month.
 *
 * Totals are plain sums of what is stored: worked minutes and the number of
 * days in each status. Nothing is priced and no new attendance rule is made.
 */

export interface AttendanceReportRow {
  date: string;
  /** 0 = Sun … 6 = Sat. */
  weekday: number;
  code: AttendanceCode | null;
  group: StatusGroup | null;
  /** "Present", "Half Day", … ; "Upcoming" for a day that hasn't happened; "No record" otherwise. */
  label: string;
  future: boolean;
  isToday: boolean;
  inAt: string | null;
  outAt: string | null;
  workedMinutes: number;
  late: boolean;
  lateWaived: boolean;
  leftEarly: boolean;
  /** The graded day itself (for the admin's edit / comp-off actions); undefined before joining. */
  day: DayRow | undefined;
}

export type StatusCounts = Partial<Record<StatusGroup, number>> & { upcoming: number };

export interface AttendanceReportWeek {
  index: number;
  start: string;
  end: string;
  rows: AttendanceReportRow[];
  workedMinutes: number;
  counts: StatusCounts;
}

export interface AttendanceReport {
  weeks: AttendanceReportWeek[];
  totals: { workedMinutes: number; counts: StatusCounts };
}

function count(rows: readonly AttendanceReportRow[]): StatusCounts {
  const c: StatusCounts = { upcoming: 0 };
  for (const r of rows) {
    if (r.group) c[r.group] = (c[r.group] ?? 0) + 1;
    else if (r.future) c.upcoming++;
  }
  return c;
}

export function buildAttendanceReport(days: readonly DayRow[], year: number, month: number, today: string): AttendanceReport {
  const byDate = new Map(days.map((d) => [d.logDate, d]));
  const weeks: AttendanceReportWeek[] = [];
  let index = 0;
  for (const w of buildCalendar(days, year, month, today)) {
    const cells = w.cells.filter((c) => c.inMonth);
    if (cells.length === 0) continue;
    index++;
    const rows: AttendanceReportRow[] = cells.map((c) => {
      const d = byDate.get(c.date);
      const future = c.date > today;
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
        // Hours only for a day with BOTH punches. With a check-out missing the grader measures to the end of the
        // day (or to now, today), which would read as hours worked; such a day shows "—" and adds nothing to totals.
        workedMinutes: c.inAt && c.outAt ? c.workedMinutes : 0,
        late: Boolean(d?.late),
        lateWaived: Boolean(d?.lateWaived),
        leftEarly: Boolean(d?.leftEarly),
        day: d,
      };
    });
    weeks.push({ index, start: rows[0]!.date, end: rows[rows.length - 1]!.date, rows, workedMinutes: rows.reduce((s, r) => s + r.workedMinutes, 0), counts: count(rows) });
  }
  const all = weeks.flatMap((w) => w.rows);
  return { weeks, totals: { workedMinutes: all.reduce((s, r) => s + r.workedMinutes, 0), counts: count(all) } };
}

/** "2 present · 1 absent · 1 weekly off" — only the statuses that occur, in a fixed order. */
const ORDER: (StatusGroup | "upcoming")[] = ["present", "half", "absent", "leave", "compoff", "holiday", "weekoff", "offwork", "open", "upcoming"];
export function countsSummary(c: StatusCounts, labels: Record<StatusGroup, string>): string {
  return ORDER.filter((k) => (c[k] ?? 0) > 0)
    .map((k) => `${c[k]} ${k === "upcoming" ? "upcoming" : labels[k as StatusGroup].toLowerCase()}`)
    .join(" · ");
}
