import "server-only";
import { getMonthDashboard, type DashboardRow } from "@/lib/queries/attendance-status";
import { localDateString } from "@/lib/format";
import { checkRunAgainstAttendance, type RunInputs, type StaleCheck } from "@/lib/salary/stale";

/**
 * The month's attendance for the whole active roster, read exactly as salary
 * generation reads it (lib/salary/generate.ts — same function, same strict
 * policy read). Read-only. Null when attendance can't be read (for example the
 * policy is unreadable), so a failure is visible rather than mistaken for an
 * empty month.
 */
export async function readMonthAttendance(month: string): Promise<DashboardRow[] | null> {
  const [y, m] = month.split("-").map(Number) as [number, number];
  try {
    return await getMonthDashboard(y, m, localDateString("Asia/Kolkata"), { strictPolicy: true });
  } catch (err) {
    console.error("[salary] attendance could not be read", err);
    return null;
  }
}

/**
 * Stale check for every run of a month against an attendance read. Pure apart
 * from its inputs. With no attendance (null) every generated run comes back
 * "unknown" rather than "current", so a failure never hides a stale run.
 */
export function staleChecksFrom(runs: readonly (RunInputs & { employeeId: string })[], attendance: readonly DashboardRow[] | null): Record<string, StaleCheck> {
  const out: Record<string, StaleCheck> = {};
  const byEmployee = attendance ? new Map(attendance.map((r) => [r.employeeId, { payableDays: r.summary.payableDays, lateMarks: r.summary.late }])) : null;
  for (const r of runs) {
    out[r.employeeId] = byEmployee
      ? checkRunAgainstAttendance(r, byEmployee.get(r.employeeId))
      : r.source === "generated"
        ? { status: "unknown" }
        : { status: "not-applicable" };
  }
  return out;
}

/** Stale check for every run of a month, reading attendance itself. Never writes a salary run. */
export async function staleChecksForMonth(month: string, runs: (RunInputs & { employeeId: string })[]): Promise<Record<string, StaleCheck>> {
  if (runs.length === 0) return {};
  return staleChecksFrom(runs, await readMonthAttendance(month));
}
