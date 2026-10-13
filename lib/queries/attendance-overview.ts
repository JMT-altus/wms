import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendanceLogs } from "@/db/schema";
import {
  companyDefaults,
  getEmployeeMonthStatus,
  type DayRow,
} from "@/lib/queries/attendance-status";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { listHolidays, type HolidayRow } from "@/lib/queries/holidays";
import {
  computeOverview,
  monthRange,
  selectUpcomingHolidays,
  type OverviewKpis,
} from "@/lib/attendance/overview";

/**
 * Everything the employee Attendance overview needs, for ONE employee and ONE
 * calendar month.
 *
 * The caller passes the signed-in employee's own id: nothing here looks anyone
 * else up, so the page cannot be pointed at another person's attendance.
 *
 * No new calculation lives here. The month comes from `getEmployeeMonthStatus`
 * — the same grader the admin dashboard and the salary run use, which is asked
 * for exactly the selected (year, month) — and the KPI maths is
 * `computeOverview`, which is pure and tested.
 */
export interface AttendanceOverviewData {
  kpis: OverviewKpis;
  /** Every graded day of the selected month. */
  days: DayRow[];
  /** The org Full-Day Hours, in minutes — what "expected" is measured in. */
  fullDayMinutes: number;
}

export async function loadAttendanceOverview(input: {
  employeeId: string;
  /** Today in the employee's timezone, YYYY-MM-DD. */
  today: string;
  year: number;
  month: number;
}): Promise<AttendanceOverviewData> {
  const { employeeId, today, year, month } = input;

  const [org, status] = await Promise.all([
    getOrgSettings(),
    getEmployeeMonthStatus(employeeId, year, month, today),
  ]);

  const fullDayMinutes = companyDefaults(org).fullDayMinutes;
  return {
    kpis: computeOverview(status.days, monthRange(year, month, today), fullDayMinutes),
    days: status.days,
    fullDayMinutes,
  };
}

/**
 * The year of the employee's earliest attendance record, or null when they
 * have none. Read from the real log, so the year dropdown starts where their
 * history does instead of at a number someone typed in.
 */
export async function getEarliestAttendanceYear(employeeId: string): Promise<number | null> {
  const [row] = await db
    .select({ first: sql<string | null>`min(${attendanceLogs.logDate})` })
    .from(attendanceLogs)
    .where(eq(attendanceLogs.employeeId, employeeId));
  const year = row?.first ? Number(String(row.first).slice(0, 4)) : NaN;
  return Number.isInteger(year) ? year : null;
}

/**
 * Active holidays from today onward, soonest first.
 *
 * Holidays are organisation-wide (the admin list is the only place they are
 * edited), so this is the same data every employee already sees reflected in
 * their calendar. It is NOT tied to the selected month: "upcoming" always
 * means after today. Two calendar years are read so December still shows
 * January.
 */
export async function listUpcomingHolidays(today: string, limit = 12): Promise<HolidayRow[]> {
  const year = Number(today.slice(0, 4));
  const [a, b] = await Promise.all([listHolidays(year), listHolidays(year + 1)]);
  return selectUpcomingHolidays([...a, ...b], today, limit);
}
