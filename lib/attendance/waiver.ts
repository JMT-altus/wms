import type { DayCodeResult } from "@/lib/attendance/status";

/**
 * Attendance waivers (0126) — the grading rule. Pure: no database.
 *
 * Approved treatment: an active waiver on a WORKING day grades it "WV — Waived":
 * one payable day (like paid leave), not absent / half-day / no check-out, and no
 * late or early mark (so it never counts toward the every-3rd-late deduction).
 * The recorded punches and the worked minutes they give are kept — no hours are
 * invented. Holidays, weekly offs, leave, comp-off and worked off-days keep their
 * own grade: a waiver has nothing to replace there.
 */
const WAIVABLE_CODES: ReadonlySet<string> = new Set(["P", "H/D", "A", "incomplete"]);

export const isWaivableCode = (code: string): boolean => WAIVABLE_CODES.has(code);

export function applyWaiver(graded: DayCodeResult): DayCodeResult {
  if (!WAIVABLE_CODES.has(graded.code)) return graded;
  return { ...graded, code: "WV", dayValue: 1, late: false, leftEarly: false, lateWaived: false };
}
