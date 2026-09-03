/**
 * The effective due date — the single most important derived value in Tasks.
 *
 *   effective due = COALESCE(revised_target_date, due_at)
 *
 * `due_at` is IMMUTABLE after creation: the first committed date is permanent
 * so the audit timeline can always show what was originally promised. Every
 * later reschedule lands in `revised_target_date`. That means EVERY overdue
 * badge, Age figure, date column and due-date sort must key off the COALESCE —
 * read the raw `due_at` and a rescheduled task keeps rendering as overdue
 * forever, which is exactly the bug this module exists to prevent.
 *
 * Pure and client-safe: no DB, no `server-only`, no schema import. The Drizzle
 * SQL fragment lives in ./effective-due-sql so this file can be imported from
 * "use client" components without dragging db/schema into the bundle.
 */

/** Anything with the two date fields — Dates, or the ISO strings a cache
 *  round-trip hands back. Both are accepted; both normalise to a Date. */
export interface DueDateFields {
  dueAt: Date | string | null | undefined;
  revisedTargetDate?: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The date a task is actually judged against: the revised target when one has
 * been set, else the original commitment. Returns null when neither parses.
 */
export function pickEffectiveDue(task: DueDateFields): Date | null {
  return toDate(task.revisedTargetDate) ?? toDate(task.dueAt);
}

/** True when the task has been rescheduled — i.e. the effective date is no
 *  longer the original commitment. Drives the "revised" marker in the UI. */
export function isRevised(task: DueDateFields): boolean {
  const revised = toDate(task.revisedTargetDate);
  if (!revised) return false;
  const original = toDate(task.dueAt);
  return !original || revised.getTime() !== original.getTime();
}

const MS_PER_DAY = 86_400_000;
const TZ = "Asia/Kolkata";

/** yyyy-mm-dd for a Date in IST (lexicographic order == chronological). */
function istDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * Whole days between the effective due date and `now`, by IST calendar day.
 * Negative = overdue by that many days, 0 = due today, positive = days left.
 * Calendar-day comparison (not raw ms) because due dates are stored at noon
 * IST — a raw comparison mis-flags a task finished the same afternoon.
 */
export function daysUntilEffectiveDue(
  task: DueDateFields,
  now: Date = new Date(),
): number | null {
  const due = pickEffectiveDue(task);
  if (!due) return null;
  const a = Date.parse(`${istDay(due)}T00:00:00Z`);
  const b = Date.parse(`${istDay(now)}T00:00:00Z`);
  return Math.round((a - b) / MS_PER_DAY);
}

/**
 * Overdue = the effective due day is strictly before today, and the task is
 * still open. Terminal statuses never read as overdue — finished work isn't
 * on fire, however late it was.
 */
const TERMINAL = new Set<string>([
  "done",
  "approved",
  "not_approved",
  "cancelled",
  "transferred",
]);

export function isOverdue(
  task: DueDateFields & { status: string },
  now: Date = new Date(),
): boolean {
  if (TERMINAL.has(task.status)) return false;
  const days = daysUntilEffectiveDue(task, now);
  return days != null && days < 0;
}
