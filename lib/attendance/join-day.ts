/**
 * The first day an employee's attendance is graded, or can be entered or
 * corrected. Pure: safe to import anywhere.
 *
 * `employees.joined_at` is NOT an employment start date: it is stamped at the
 * employee's first sign-in to the WMS (app/api/auth/session/route.ts), and
 * while it is null the record's `created_at` is used instead. Attendance
 * recorded before that — for example an import of earlier months — proves the
 * employee was already working, so the effective join day is the EARLIER of:
 *
 *   - the account's join day (joined_at, else created_at, as a date in the
 *     employee's timezone), and
 *   - the employee's first recorded attendance date (attendance_logs.log_date).
 *
 * Days before BOTH stay "not joined": nothing before the first recorded punch
 * is treated as an attendance day.
 */
export function effectiveJoinDay(accountJoinDay: string, firstLogDate: string | null | undefined): string {
  return firstLogDate && firstLogDate < accountJoinDay ? firstLogDate : accountJoinDay;
}
