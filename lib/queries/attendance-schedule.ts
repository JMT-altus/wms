import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employeeDepartments, employees, salaryRuns } from "@/db/schema";
import { getOrgSettings } from "@/lib/queries/org-settings";
import type { OrgSettings } from "@/db/schema";
import { listPolicyChanges } from "@/lib/queries/attendance-policy";
import { PolicyReadError } from "@/lib/attendance/policy-read";
import type { AttendanceSchedule } from "@/lib/attendance/schedule";
import { earliestEffectiveDate, type PolicyChange } from "@/lib/attendance/policy";
import { isShiftKey, resolveShiftSettings, scheduleOn, validateShiftValue, type ScheduleEmployee, type ShiftSettings, type WorkShifts } from "@/lib/attendance/shift-settings";

/**
 * The one place attendance reads a day's schedule (late-after, early-before,
 * full-day and half-day thresholds): grading, the dashboard, salary generation,
 * the attendance emails and the overview all come through here.
 *
 * Inputs: the company times in org settings (the "legacy" schedule, used when no
 * shift applies), the shift / grace settings from Admin Panel → Attendance
 * Settings (effective-dated rows in attendance_policy_changes), and the
 * employee's departments. The rule itself is pure: lib/attendance/shift-settings.ts.
 *
 * Reading modes, as for the attendance policy:
 *  - display (default): if the settings can't be read, or a stored value is
 *    invalid, the page falls back to the legacy schedule and logs it — a
 *    settings problem never takes attendance down;
 *  - strict (salary generation): the same problem throws `PolicyReadError`.
 */

/** Company-wide schedule from org settings (unchanged rule; defaults when unset). */
export function companyDefaults(org: OrgSettings): AttendanceSchedule {
  return {
    lateAfter: org.attLateAfter ?? "10:50",
    earlyBefore: org.attEarlyBefore ?? "19:20",
    fullDayMinutes: Number(org.attFullDayHours ?? 9) * 60,
    halfDayMinutes: Number(org.attHalfDayHours ?? 5) * 60,
  };
}

export interface ScheduleContext {
  legacy: AttendanceSchedule;
  changes: PolicyChange[];
  deptsByEmp: Map<string, string[]>;
  /** Settings per date, memoised (most months have one or two distinct settings). */
  memo: Map<string, ShiftSettings>;
}

export async function loadScheduleContext(opts: { strict?: boolean; employeeIds?: readonly string[]; org?: OrgSettings } = {}): Promise<ScheduleContext> {
  const strict = opts.strict === true;
  const [org, changes] = await Promise.all([
    opts.org ? Promise.resolve(opts.org) : getOrgSettings(),
    listPolicyChanges()
      .then((all) => all.filter((c) => isShiftKey(c.key)))
      .catch((err: unknown) => {
        if (strict) throw new PolicyReadError("The attendance shift settings could not be read, so salary was not generated. Try again.", { cause: err });
        console.error("[attendance] shift settings unreadable; using the company times", err);
        return [] as PolicyChange[];
      }),
  ]);
  // A stored value that fails validation: strict refuses; display drops the row (logged).
  const valid: PolicyChange[] = [];
  for (const c of changes) {
    const r = validateShiftValue(c.key, c.value);
    if (r.ok) valid.push(c);
    else if (strict) throw new PolicyReadError(`Attendance setting "${c.key}" (effective ${c.effectiveFrom}) holds an invalid value (${r.error}).`);
    else console.error(`[attendance] ignoring invalid "${c.key}" setting effective ${c.effectiveFrom}: ${r.error}`);
  }
  // Departments are read only when some saved shift is assigned to a department.
  const needsDepartments = valid.some((c) => c.key === "work_shifts" && (c.value as unknown as WorkShifts).shifts.some((s) => s.departmentIds.length > 0));
  const links: { e: string; d: string }[] =
    !needsDepartments || (opts.employeeIds && opts.employeeIds.length === 0)
      ? []
      : await (opts.employeeIds
          ? db.select({ e: employeeDepartments.employeeId, d: employeeDepartments.departmentId }).from(employeeDepartments).where(inArray(employeeDepartments.employeeId, [...opts.employeeIds]))
          : db.select({ e: employeeDepartments.employeeId, d: employeeDepartments.departmentId }).from(employeeDepartments)
        ).catch((err: unknown) => {
          if (strict) throw new PolicyReadError("Employee departments could not be read, so salary was not generated. Try again.", { cause: err });
          console.error("[attendance] employee departments unreadable; department shifts not applied", err);
          return [] as { e: string; d: string }[];
        });
  const deptsByEmp = new Map<string, string[]>();
  for (const l of links) {
    const arr = deptsByEmp.get(l.e);
    if (arr) arr.push(l.d);
    else deptsByEmp.set(l.e, [l.d]);
  }
  return { legacy: companyDefaults(org), changes: valid, deptsByEmp, memo: new Map() };
}

/** Settings in force on a date (memoised on the context). */
export function settingsOn(ctx: ScheduleContext, ymd: string): ShiftSettings {
  let s = ctx.memo.get(ymd);
  if (!s) {
    s = resolveShiftSettings(ctx.changes, ymd);
    ctx.memo.set(ymd, s);
  }
  return s;
}

/** A per-day schedule function for one employee. */
export function scheduleFor(ctx: ScheduleContext, emp: ScheduleEmployee): (ymd: string) => AttendanceSchedule {
  const depts = ctx.deptsByEmp.get(emp.id) ?? [];
  return (ymd) => {
    const { shift: _shift, ...sched } = scheduleOn(settingsOn(ctx, ymd), ctx.legacy, emp, depts);
    void _shift;
    return sched;
  };
}

/** One employee's schedule on one date (attendance emails, overview). Display mode. */
export async function scheduleForEmployeeOn(emp: ScheduleEmployee, ymd: string): Promise<AttendanceSchedule> {
  const ctx = await loadScheduleContext({ employeeIds: [emp.id] });
  return scheduleFor(ctx, emp)(ymd);
}

/**
 * The earliest date a shift / grace change may take effect: the first day of the
 * current month (the attendance-policy rule), and never inside a month whose
 * salary has already been generated — so a change can't silently re-grade
 * attendance that was paid. Returns the date and, when a salary run pushed it,
 * the month that did.
 */
export async function minShiftEffectiveDate(todayIso: string): Promise<{ date: string; paidThrough: string | null }> {
  const [row] = await db.select({ m: sql<string | null>`max(${salaryRuns.month})` }).from(salaryRuns);
  const paidThrough = row?.m ?? null;
  const policyEarliest = earliestEffectiveDate(todayIso);
  if (!paidThrough) return { date: policyEarliest, paidThrough: null };
  const [y, m] = paidThrough.split("-").map(Number) as [number, number];
  const after = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first day of the next month
  return { date: after > policyEarliest ? after : policyEarliest, paidThrough: after > policyEarliest ? paidThrough : null };
}

/** The same, loading the employee's personal overrides by id. */
export async function scheduleForEmployeeIdOn(employeeId: string, ymd: string): Promise<AttendanceSchedule> {
  const [row] = await db
    .select({ id: employees.id, attLateAfter: employees.attLateAfter, attEarlyBefore: employees.attEarlyBefore })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  return scheduleForEmployeeOn(row ?? { id: employeeId, attLateAfter: null, attEarlyBefore: null }, ymd);
}
