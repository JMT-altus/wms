import { PUNCH_REASONS, type PunchReason } from "@/db/enums";

/**
 * Attendance correction — the rules, pure (no database). Shared by the HR
 * correction screen and the admin day editor.
 *
 * Adds a missing punch, corrects an existing time, or (admin editor only)
 * removes a punch. Never makes a time up (a blank field means "leave as it is")
 * and has no overnight support: OUT may not be earlier than IN.
 *
 * Reason and explanation are stored on the punch itself (`attendance_logs.reason`
 * as a code, `attendance_logs.note` as text); the before / after goes to the
 * audit row. The writes live in lib/attendance/correction/apply.ts.
 */

/** Reasons offered on the HR correction screen. */
export const CORRECTION_REASONS = [
  { code: "power_failure", label: "Power failure" },
  { code: "biometric_unavailable", label: "Biometric machine unavailable" },
  { code: "missed_punch", label: "Missed punch" },
  { code: "other", label: "Other" },
] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number]["code"];
export const CORRECTION_REASON_CODES = CORRECTION_REASONS.map((r) => r.code) as [CorrectionReason, ...CorrectionReason[]];

/** Reasons offered by the admin day editor — the existing punch-reason list. */
export const PUNCH_REASON_LABELS: Record<PunchReason, string> = {
  client_visit: "Client visit",
  wfh: "Work from home",
  forgot: "Forgot to punch",
  correction: "Correction",
};
export const ADMIN_REASON_CODES = PUNCH_REASONS;

export const reasonLabel = (code: string): string =>
  CORRECTION_REASONS.find((r) => r.code === code)?.label ?? PUNCH_REASON_LABELS[code as PunchReason] ?? code;

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
  /**
   * The employee's local join day (yyyy-mm-dd) — the same rule grading uses
   * (lib/attendance/join-day.ts): the account's join day, or their first
   * recorded attendance if that is earlier.
   */
  joinDay: string;
  existing: { in: ExistingPunch | null; out: ExistingPunch | null };
  /** Reason codes this entry point accepts. Default: the HR correction reasons. */
  allowedReasons?: readonly string[];
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

/** Reason, explanation and date rules shared by every correction kind. */
function checkCommon(i: {
  date: string;
  reason: string;
  explanation: string;
  today: string;
  joinDay: string;
  allowedReasons?: readonly string[];
}): string | null {
  const allowed = i.allowedReasons ?? CORRECTION_REASON_CODES;
  if (!allowed.includes(i.reason)) return "Choose a reason.";
  const why = explanationError(i.reason, i.explanation);
  if (why) return why;
  if (!isRealDate(i.date)) return "The date is not valid.";
  if (i.date > i.today) return "Attendance can't be entered for a future date.";
  if (i.date < i.joinDay) return `This employee joined on ${i.joinDay}. Attendance can't be entered for an earlier date.`;
  return null;
}

export function planCorrection(i: PlanInput): PlanResult {
  const common = checkCommon(i);
  if (common) return { ok: false, error: common };

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

export interface DeletionInput {
  date: string;
  kind: "in" | "out";
  reason: string;
  explanation: string;
  today: string;
  joinDay: string;
  existing: { in: ExistingPunch | null; out: ExistingPunch | null };
  allowedReasons?: readonly string[];
}

export type DeletionResult =
  | { ok: true; removed: ExistingPunch; kind: "in" | "out"; finalIn: string | null; finalOut: string | null }
  | { ok: false; error: string };

/** Removing one punch: the same reason, explanation and date rules as any correction. */
export function planDeletion(i: DeletionInput): DeletionResult {
  const common = checkCommon(i);
  if (common) return { ok: false, error: common };
  const removed = i.existing[i.kind];
  if (!removed) return { ok: false, error: `There is no ${i.kind.toUpperCase()} punch on ${i.date} to remove.` };
  return {
    ok: true,
    removed,
    kind: i.kind,
    finalIn: i.kind === "in" ? null : (i.existing.in?.time ?? null),
    finalOut: i.kind === "out" ? null : (i.existing.out?.time ?? null),
  };
}
