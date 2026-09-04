/**
 * Pure arithmetic behind task time tracking — durations, roll-ups, formatting
 * and the forgotten-timer rule. No DB, no `server-only`, no schema import, so
 * the live timer in the list row and the report tables share one implementation.
 *
 * The storage side lives in ./time-store. The split matters: this file is the
 * part with all the edge cases (clock skew, a missing stop, an open session
 * that has to keep counting on screen) and therefore the part worth testing
 * exhaustively without a database.
 */

/** A resolved span. `endedAt: null` means the timer is still running. */
export interface WorkSpan {
  startedAt: Date | string;
  endedAt?: Date | string | null;
  durationSeconds?: number | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * How long a span lasted, in whole seconds.
 *
 * A stored `durationSeconds` wins when present — it was computed at close
 * time against the real clock, and recomputing it from the timestamps would
 * quietly change history if the row was ever adjusted.
 *
 * An OPEN span is measured against `now`, which is what makes the on-screen
 * timer tick. Never negative: a clock that jumped backwards should read as
 * zero elapsed, not as negative work.
 */
export function spanSeconds(span: WorkSpan, now: Date = new Date()): number {
  if (span.durationSeconds != null && Number.isFinite(span.durationSeconds)) {
    return Math.max(0, Math.trunc(span.durationSeconds));
  }
  const start = toDate(span.startedAt);
  if (!start) return 0;
  const end = toDate(span.endedAt) ?? now;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

/** True while the timer is running — no stop recorded yet. */
export function isOpen(span: WorkSpan): boolean {
  return toDate(span.endedAt) == null;
}

/**
 * The cached per-task total, folded from its spans.
 *
 * Mirrors the `task_time_rollup` row exactly, so rebuilding the cache is this
 * function plus an UPSERT and nothing else. Open spans count toward
 * `totalSeconds` (the number on screen should include the timer you are
 * watching run) but never move `lastEndedAt`, which describes finished work.
 */
export interface TimeRollup {
  totalSeconds: number;
  sessionCount: number;
  firstStartedAt: Date | null;
  lastEndedAt: Date | null;
}

export function foldRollup(
  spans: readonly WorkSpan[],
  now: Date = new Date(),
): TimeRollup {
  let totalSeconds = 0;
  let firstStartedAt: Date | null = null;
  let lastEndedAt: Date | null = null;

  for (const span of spans) {
    totalSeconds += spanSeconds(span, now);
    const start = toDate(span.startedAt);
    if (start && (!firstStartedAt || start < firstStartedAt)) firstStartedAt = start;
    const end = toDate(span.endedAt);
    if (end && (!lastEndedAt || end > lastEndedAt)) lastEndedAt = end;
  }

  return {
    totalSeconds,
    sessionCount: spans.length,
    firstStartedAt,
    lastEndedAt,
  };
}

/**
 * How long an open session may run before the reconciler closes it.
 *
 * Ten hours: comfortably longer than any real stretch of focused work, short
 * enough that a timer left on overnight doesn't silently bill 14 hours to a
 * task. Sessions closed this way are flagged `auto_closed` so a report can
 * show them as "forgotten" rather than as effort.
 */
export const AUTO_CLOSE_AFTER_SECONDS = 10 * 60 * 60;

/** True when an open span has outlived the auto-close window. */
export function shouldAutoClose(
  span: WorkSpan,
  now: Date = new Date(),
): boolean {
  if (!isOpen(span)) return false;
  return spanSeconds(span, now) >= AUTO_CLOSE_AFTER_SECONDS;
}

/**
 * Compact duration for a table cell or a chip: `4h 05m`, `45m`, `0m`.
 *
 * Minute-resolution because that is the unit people plan in — `estimated_minutes`
 * is minutes, so showing actuals in seconds would invite a comparison between
 * two different units. Use `formatClock` for the live ticking timer, where
 * seconds are the whole point.
 */
export function formatDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** `H:MM:SS` (or `MM:SS` under an hour) for the running timer readout. */
export function formatClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Estimated vs Actual, as the detail panel needs it.
 *
 * `ratio` is null when nothing was estimated — the honest answer to "how are
 * we tracking?" with no estimate is "we don't know", not 0% and not Infinity.
 * `overBy` is only ever positive, so the panel can render an overrun without
 * re-deriving the sign.
 */
export interface EstimateComparison {
  estimatedSeconds: number | null;
  actualSeconds: number;
  /** actual / estimated, or null when there is no estimate. */
  ratio: number | null;
  over: boolean;
  overBySeconds: number;
}

export function compareToEstimate(
  estimatedMinutes: number | null | undefined,
  actualSeconds: number,
): EstimateComparison {
  const actual = Math.max(0, Math.trunc(actualSeconds));
  const hasEstimate =
    estimatedMinutes != null &&
    Number.isFinite(estimatedMinutes) &&
    estimatedMinutes > 0;

  if (!hasEstimate) {
    return {
      estimatedSeconds: null,
      actualSeconds: actual,
      ratio: null,
      over: false,
      overBySeconds: 0,
    };
  }

  const estimatedSeconds = Math.trunc(estimatedMinutes) * 60;
  return {
    estimatedSeconds,
    actualSeconds: actual,
    ratio: actual / estimatedSeconds,
    over: actual > estimatedSeconds,
    overBySeconds: Math.max(0, actual - estimatedSeconds),
  };
}

/**
 * Pair a raw start/stop log back into spans.
 *
 * The reconciliation path: `task_time_events` is the evidence and this is how
 * it becomes `task_work_sessions` when the two ever disagree. Deliberately
 * forgiving, because the raw log is written by phones with flaky connections:
 *
 *   - a second `start` while one is open closes the first (you moved on)
 *   - a `stop` with nothing open is dropped (a duplicate tap)
 *   - a trailing `start` yields an open span, which is correct — the timer
 *     really is running
 *
 * Events are sorted by `at` first, so an out-of-order arrival can't strand a
 * session.
 */
export interface RawTimeEvent {
  kind: string;
  at: Date | string;
}

export function pairEvents(events: readonly RawTimeEvent[]): WorkSpan[] {
  const sorted = [...events]
    .map((e) => ({ kind: e.kind, at: toDate(e.at) }))
    .filter((e): e is { kind: string; at: Date } => e.at != null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const spans: WorkSpan[] = [];
  let openStart: Date | null = null;

  for (const event of sorted) {
    if (event.kind === "start") {
      // A start while one is already open means the previous stretch ended
      // here — the person moved on and the stop never arrived.
      if (openStart) spans.push({ startedAt: openStart, endedAt: event.at });
      openStart = event.at;
    } else if (event.kind === "stop") {
      if (!openStart) continue; // duplicate tap; nothing to close
      spans.push({ startedAt: openStart, endedAt: event.at });
      openStart = null;
    }
  }

  if (openStart) spans.push({ startedAt: openStart, endedAt: null });
  return spans;
}
