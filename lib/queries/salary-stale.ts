import "server-only";
import { getMonthDashboard } from "@/lib/queries/attendance-status";
import { localDateString } from "@/lib/format";
import { checkRunAgainstAttendance, type RunInputs, type StaleCheck } from "@/lib/salary/stale";

/**
 * Stale check for every run of a month. Read-only: it reads attendance exactly
 * as salary generation does (lib/salary/generate.ts — same function, same
 * strict policy read) and never writes a salary run.
 *
 * If attendance can't be read (for example the policy is unreadable) every run
 * comes back "unknown" rather than "current", so a failure never hides a stale run.
 */
export async function staleChecksForMonth(
  month: string,
  runs: (RunInputs & { employeeId: string })[],
): Promise<Record<string, StaleCheck>> {
  const out: Record<string, StaleCheck> = {};
  if (runs.length === 0) return out;
  const [y, m] = month.split("-").map(Number) as [number, number];
  let byEmployee: Map<string, { payableDays: number; lateMarks: number }> | null = null;
  try {
    const dashboard = await getMonthDashboard(y, m, localDateString("Asia/Kolkata"), { strictPolicy: true });
    byEmployee = new Map(dashboard.map((r) => [r.employeeId, { payableDays: r.summary.payableDays, lateMarks: r.summary.late }]));
  } catch (err) {
    console.error("[salary] stale check could not read attendance", err);
  }
  for (const r of runs) {
    out[r.employeeId] = byEmployee
      ? checkRunAgainstAttendance(r, byEmployee.get(r.employeeId))
      : r.source === "generated"
        ? { status: "unknown" }
        : { status: "not-applicable" };
  }
  return out;
}
