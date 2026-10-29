import "server-only";
import type { Employee } from "@/db/schema";
import { getEmployeeMonthStatus, type DayRow, type MonthSummary } from "@/lib/queries/attendance-status";
import { getEarliestAttendanceYear } from "@/lib/queries/attendance-overview";
import { getEmployeePayProfile, getRunForEmployeeMonth, listRunsForEmployee, type EmployeePayProfile, type SalaryRunRow } from "@/lib/queries/salary";
import { checkRunAgainstAttendance, type StaleCheck } from "@/lib/salary/stale";

/**
 * Everything the My Salary page needs for ONE employee and ONE month, read in
 * one place so the page makes no second trip. The employee is always the
 * verified session's — the page never takes an id from the URL.
 *
 *   run         the stored salary run for the month (null = not generated yet)
 *   attendance  the month as the attendance grader sees it TODAY — the same
 *               grader Generate Salary reads — for the calendar, the counts
 *               and the daily report; null when it couldn't be read
 *   stale       whether the run still matches that attendance (HR corrections
 *               after generation show up here); null without a run
 *   history     every run this employee has, newest first
 *   bounds      the earliest month worth navigating to and the current month
 */
export interface MySalaryData {
  month: string;
  year: number;
  monthNumber: number;
  run: SalaryRunRow | null;
  profile: EmployeePayProfile;
  attendance: { days: DayRow[]; summary: MonthSummary } | null;
  stale: StaleCheck | null;
  history: SalaryRunRow[];
  bounds: { earliest: string; latest: string };
}

export async function loadMySalary(me: Pick<Employee, "id">, month: string, today: string): Promise<MySalaryData> {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const current = today.slice(0, 7);

  const [run, profile, history, attendance, earliestYear] = await Promise.all([
    getRunForEmployeeMonth(me.id, month),
    getEmployeePayProfile(me.id),
    listRunsForEmployee(me.id),
    getEmployeeMonthStatus(me.id, year, monthNumber, today).catch((err): null => {
      console.error("[my-salary] attendance could not be read", err instanceof Error ? err.message : err);
      return null;
    }),
    getEarliestAttendanceYear(me.id).catch((): null => null),
  ]);

  const stale = run && attendance ? checkRunAgainstAttendance(run, { payableDays: attendance.summary.payableDays, lateMarks: attendance.summary.late }) : null;

  // Navigation reaches back to the first month with either a run or attendance on record, and never past the current month.
  const earliestRun = history.length > 0 ? history[history.length - 1]!.month : null;
  const earliestAttendance = earliestYear ? `${earliestYear}-01` : null;
  const candidates = [earliestRun, earliestAttendance].filter((m): m is string => !!m);
  const earliest = candidates.length ? candidates.sort()[0]! : current;

  return {
    month,
    year,
    monthNumber,
    run,
    profile,
    attendance: attendance ? { days: attendance.days, summary: attendance.summary } : null,
    stale,
    history,
    bounds: { earliest: earliest < current ? earliest : current, latest: current },
  };
}
