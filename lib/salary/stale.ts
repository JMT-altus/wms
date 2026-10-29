/**
 * Is a saved salary run out of date with the attendance it was computed from?
 * Pure, no database.
 *
 * Decided by comparison, not by timestamps: `salary_runs.updated_at` also moves
 * when a run is disbursed or its advances are edited, so "corrected after the
 * run was updated" would wrongly clear the flag once a run is paid. Instead the
 * attendance inputs a generated run used (payable days, late marks) are compared
 * with what the same attendance read gives today. Any attendance change that
 * alters pay — an HR correction, an admin edit or removal, a bulk import —
 * shows up; a change that alters nothing does not.
 */

export interface RunInputs {
  /** Only runs WMS generated from attendance are compared ("generated"). */
  source: string;
  payableDays: number;
  lateMarks: number;
}

export interface CurrentInputs {
  payableDays: number;
  lateMarks: number;
}

export type StaleCheck =
  | { status: "current" }
  | { status: "stale"; savedPayableDays: number; nowPayableDays: number; savedLateMarks: number; nowLateMarks: number }
  /** An imported run: computed outside WMS attendance, so there is nothing to compare. */
  | { status: "not-applicable" }
  /** Attendance could not be read for this employee (e.g. now inactive): unknown, not "current". */
  | { status: "unknown" };

/** Payable days are stored with 2 decimals; compare at that precision. */
const cents = (n: number) => Math.round(n * 100);

export function checkRunAgainstAttendance(run: RunInputs, now: CurrentInputs | null | undefined): StaleCheck {
  if (run.source !== "generated") return { status: "not-applicable" };
  if (!now) return { status: "unknown" };
  if (cents(run.payableDays) === cents(now.payableDays) && run.lateMarks === now.lateMarks) return { status: "current" };
  return {
    status: "stale",
    savedPayableDays: run.payableDays,
    nowPayableDays: now.payableDays,
    savedLateMarks: run.lateMarks,
    nowLateMarks: now.lateMarks,
  };
}
