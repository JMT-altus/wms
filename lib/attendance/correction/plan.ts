/**
 * HR attendance correction — the rules, pure (no database).
 *
 * Used when power failure or a biometric outage meant IN / OUT was not recorded.
 * It adds a missing punch or corrects an existing time. It never deletes a
 * punch, never makes a time up (a blank field means "leave as it is"), and has
 * no overnight support: OUT may not be earlier than IN.
 *
 * Reason and explanation are stored on the punch itself (`attendance_logs.reason`
 * as a code, `attendance_logs.note` as text); the before / after goes to the
 * audit row. See app/(app)/hr/attendance-correction/actions.ts.
 */

export const CORRECTION_REASONS = [
  { code: "power_failure", label: "Power failure" },
  { code: "biometric_unavailable", label: "Biometric machine unavailable" },
  { code: "missed_punch", label: "Missed punch" },
  { code: "other", label: "Other" },
] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number]["code"];
export const CORRECTION_REASON_CODES = CORRECTION_REASONS.map((r) => r.code) as [CorrectionReason, ...CorrectionReason[]];

export const reasonLabel = (code: string): string => CORRECTION_REASONS.find((r) => r.code === code)?.label ?? code;

/** A meaningful explanation: more is asked for "Other", where the reason itself says nothing. */
export const EXPLANATION_MIN = 10;
export const EXPLANATION_MIN_OTHER = 25;
export const EXPLANATION_MAX = 500;

export function explanationError(reason: string, explanation: string): string | null {
  const t = explanation.trim();
  const min = reason === "other" ? EXPLANATION_MIN_OTHER : EXPLANATION_MIN;
  if (t.length === 0) return "Explain what happened. An explanation is required for every correction.";
  if (t.length < min) {
    return reason === "other"
      ? `"Other" needs a fuller explanation (at least ${EXPLANATION_MIN_OTHER} characters) saying exactly what happened.`
      : `Please give a meaningful explanation (at least ${EXPLANATION_MIN} characters).`;
  }
  if (t.length > EXPLANATION_MAX) return `Keep the explanation under ${EXPLANATION_MAX} characters.`;
  return null;
}

/**
 * The note the punch ends up with. An existing note (the employee's own, or an
 * import tag) is NEVER discarded: the HR explanation is appended after it. The
 * full previous note is also kept in the audit row.
 */
export function composeNote(existingNote: string | null, explanation: string): string {
  const text = explanation.trim();
  const prev = (existingNote ?? "").trim();
  return prev ? `${prev} | HR correction: ${text}` : text;
}

export interface ExistingPunch {
  id: string;
  /** HH:mm on the employee's wall clock. */
  time: string;
  /** The stored instant, ISO — used to detect a concurrent change. */
  loggedAt: string;
  note: string | null;
  source: string;
  reason: string | null;
}

export interface PlanInput {
  date: string;
  /** Blank / null = leave this side as it is. */
  inTime: string | null | undefined;
  outTime: string | null | undefined;
  reason: string;
  explanation: string;
  /** Today in the employee's timezone (yyyy-mm-dd). */
  today: string;
  /** The employee's local join day (yyyy-mm-dd) — the same rule grading uses. */
  joinDay: string;
  existing: { in: ExistingPunch | null; out: ExistingPunch | null };
}

export interface PlannedChange {
  kind: "in" | "out";
  action: "add" | "change";
  /** Existing HH:mm, or null when the punch is being added. */
  from: string | null;
  to: string;
  existingId: string | null;
  existingNote: string | null;
}

export type PlanResult =
  | { ok: true; changes: PlannedChange[]; finalIn: string | null; finalOut: string | null }
  | { ok: false; error: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isRealDate(ymd: string): boolean {
  if (!DATE_RE.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const blank = (v: string | null | undefined) => v == null || v.trim() === "";

export function planCorrection(i: PlanInput): PlanResult {
  if (!CORRECTION_REASON_CODES.includes(i.reason as CorrectionReason)) return { ok: false, error: "Choose a reason." };
  const why = explanationError(i.reason, i.explanation);
  if (why) return { ok: false, error: why };

  if (!isRealDate(i.date)) return { ok: false, error: "The date is not valid." };
  if (i.date > i.today) return { ok: false, error: "Attendance can't be entered for a future date." };
  if (i.date < i.joinDay) {
    return { ok: false, error: `This employee joined on ${i.joinDay}. Attendance can't be entered for an earlier date.` };
  }

  for (const [label, v] of [["IN", i.inTime], ["OUT", i.outTime]] as const) {
    if (!blank(v) && !TIME_RE.test(v!.trim())) return { ok: false, error: `${label} time must be HH:mm (for example 09:30).` };
  }
  const wantIn = blank(i.inTime) ? null : i.inTime!.trim();
  const wantOut = blank(i.outTime) ? null : i.outTime!.trim();
  if (!wantIn && !wantOut) return { ok: false, error: "Enter an IN time, an OUT time, or both." };

  const changes: PlannedChange[] = [];
  for (const [kind, want] of [["in", wantIn], ["out", wantOut]] as const) {
    if (!want) continue;
    const cur = i.existing[kind];
    if (!cur) {
      changes.push({ kind, action: "add", from: null, to: want, existingId: null, existingNote: null });
    } else if (cur.time !== want) {
      changes.push({ kind, action: "change", from: cur.time, to: want, existingId: cur.id, existingNote: cur.note });
    }
    // Same time as stored: nothing to do for this side.
  }
  if (changes.length === 0) return { ok: false, error: "Nothing to change: the times you entered are already recorded." };

  const finalIn = wantIn ?? i.existing.in?.time ?? null;
  const finalOut = wantOut ?? i.existing.out?.time ?? null;
  if (finalIn && finalOut && finalOut < finalIn) {
    return { ok: false, error: `OUT (${finalOut}) can't be earlier than IN (${finalIn}). Overnight shifts aren't supported here.` };
  }
  return { ok: true, changes, finalIn, finalOut };
}
