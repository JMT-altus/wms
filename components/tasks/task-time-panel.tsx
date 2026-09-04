"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play, Square, Timer } from "lucide-react";
import { startTimer, stopTimer } from "@/app/(app)/tasks/time-actions";
import {
  compareToEstimate,
  formatClock,
  formatDuration,
} from "@/lib/tasks/time-math";
import type { TaskSessionRow } from "@/lib/tasks/time-store";

interface Props {
  taskId: string;
  /** Sessions on this task, newest first. */
  sessions: TaskSessionRow[];
  /** Cached total from task_time_rollup, in seconds. */
  totalSeconds: number;
  estimatedMinutes: number | null;
  /** The open session for the current viewer, if the clock is running. */
  runningSince: string | null;
  /** Elapsed on that open session as of the server render — the seed the
   *  local clock ticks on from, so nothing impure runs during render. */
  initialElapsedSeconds: number;
  canTrack: boolean;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Estimated vs Actual, plus the timer itself.
 *
 * The running clock ticks locally from `runningSince` rather than polling the
 * server: the browser already knows when the session started, so a second-by-
 * second readout costs nothing and stays correct across a tab left open.
 *
 * Every figure comes from lib/tasks/time-math — the same functions the reports
 * and the list column use, so a duration can never render two ways in two
 * places.
 */
export function TaskTimePanel({
  taskId,
  sessions,
  totalSeconds,
  estimatedMinutes,
  runningSince,
  initialElapsedSeconds,
  canTrack,
}: Props) {
  const router = useRouter();
  const [pending, start] = React.useTransition();

  const running = runningSince != null;

  // Seeded from the server, then advanced by the interval. Reading the clock
  // during render would make the component non-idempotent — two renders in the
  // same second would disagree — so the wall clock is only ever read inside
  // the timer callback.
  const [liveSeconds, setLiveSeconds] = React.useState(initialElapsedSeconds);

  // One interval, only while something is actually running — a timer nobody
  // started should not wake the tab every second.
  React.useEffect(() => {
    if (!runningSince) return;
    const startedAt = new Date(runningSince).getTime();
    if (Number.isNaN(startedAt)) return;
    const id = setInterval(() => {
      setLiveSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [runningSince]);

  // The stored rollup already counts the open session as of its last write, so
  // the live figure is the rollup with that stale slice swapped for a fresh one.
  const openStored = React.useMemo(() => {
    const open = sessions.find((s) => s.endedAt == null);
    return open ? open.durationSeconds : 0;
  }, [sessions]);

  const actualSeconds = running
    ? Math.max(0, totalSeconds - openStored) + liveSeconds
    : totalSeconds;

  const comparison = compareToEstimate(estimatedMinutes, actualSeconds);

  function toggle() {
    // Branched rather than ternary'd into one `result`: start and stop return
    // different shapes, and collapsing them loses the narrowing.
    start(async () => {
      if (running) {
        const result = await stopTimer(taskId);
        if (!result.ok) {
          toast.error(result.message ?? "The timer didn't respond.");
          return;
        }
        toast.success(`Logged ${formatDuration(result.durationSeconds)}.`);
      } else {
        const result = await startTimer(taskId);
        if (!result.ok) {
          toast.error(result.message ?? "The timer didn't respond.");
          return;
        }
        // Starting here stops a timer elsewhere. Saying so is the whole
        // point — a silent swap is how people lose an afternoon.
        toast.success(
          result.stoppedTaskId
            ? "Timer started — your other running timer was stopped."
            : "Timer started.",
        );
      }
      router.refresh();
    });
  }

  return (
    <section
      className="rounded-section border border-hairline bg-surface-card px-5 py-4"
      style={{
        boxShadow:
          "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2
          className="inline-flex items-center gap-2 uppercase font-bold tracking-[0.08em] text-ink-subtle"
          style={{ fontSize: 10.5 }}
        >
          <Timer size={13} strokeWidth={2.4} />
          Time
        </h2>
        {running && (
          <span
            className="tabular-nums font-semibold"
            style={{ fontSize: 12, color: "var(--color-green-deep)" }}
          >
            {formatClock(liveSeconds)}
          </span>
        )}
      </div>

      {/* Estimated vs Actual. Two figures side by side, tabular so they line
          up, with the overrun called out only when there is one. */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div
          className="rounded-chip px-2.5 py-2"
          style={{ background: "var(--color-surface-soft)" }}
        >
          <span
            className="block uppercase font-bold tracking-[0.08em] text-ink-muted"
            style={{ fontSize: 9.5 }}
          >
            Estimated
          </span>
          <span
            className="block tabular-nums font-semibold text-ink-strong"
            style={{ fontSize: 15 }}
          >
            {comparison.estimatedSeconds == null
              ? "—"
              : formatDuration(comparison.estimatedSeconds)}
          </span>
        </div>
        <div
          className="rounded-chip px-2.5 py-2"
          style={{ background: "var(--color-surface-soft)" }}
        >
          <span
            className="block uppercase font-bold tracking-[0.08em] text-ink-muted"
            style={{ fontSize: 9.5 }}
          >
            Actual
          </span>
          <span
            className="block tabular-nums font-semibold"
            style={{
              fontSize: 15,
              color: comparison.over
                ? "var(--color-red-deep)"
                : "var(--color-ink-strong)",
            }}
          >
            {formatDuration(actualSeconds)}
          </span>
        </div>
      </div>

      {comparison.over && (
        <p
          className="mb-3 tabular-nums"
          style={{ fontSize: 12, color: "var(--color-red-deep)" }}
        >
          {formatDuration(comparison.overBySeconds)} over estimate.
        </p>
      )}

      {canTrack && (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={running}
          aria-label={running ? "Stop the timer" : "Start the timer"}
          className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          style={{
            background: running
              ? "linear-gradient(135deg, var(--color-red), var(--color-red-deep))"
              : "linear-gradient(135deg, var(--color-green), var(--color-green-deep))",
          }}
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : running ? (
            <Square size={13} strokeWidth={2.6} />
          ) : (
            <Play size={13} strokeWidth={2.6} />
          )}
          {running ? "Stop timer" : "Start timer"}
        </button>
      )}

      {sessions.length === 0 ? (
        <p className="text-ink-muted" style={{ fontSize: 12.5 }}>
          No time tracked yet.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {sessions.slice(0, 6).map((s) => (
            <li
              key={s.id}
              className="flex items-baseline justify-between gap-2 rounded-chip px-2.5 py-1.5"
              style={{ background: "var(--color-surface-soft)" }}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate font-semibold text-ink-strong"
                  style={{ fontSize: 12.5 }}
                >
                  {s.employeeName ?? "Someone"}
                </span>
                <span
                  className="block truncate text-ink-subtle"
                  style={{ fontSize: 11 }}
                >
                  {timeLabel(s.startedAt)}
                  {/* An auto-closed session is a forgotten timer, not a long
                      day — label it so nobody reads it as effort. */}
                  {s.autoClosed && " · auto-closed"}
                  {s.endedAt == null && " · running"}
                </span>
              </span>
              <span
                className="shrink-0 tabular-nums font-semibold text-ink-strong"
                style={{ fontSize: 12.5 }}
              >
                {formatDuration(s.durationSeconds)}
              </span>
            </li>
          ))}
          {sessions.length > 6 && (
            <li className="text-ink-muted" style={{ fontSize: 11.5 }}>
              +{sessions.length - 6} earlier {sessions.length - 6 === 1 ? "session" : "sessions"}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
