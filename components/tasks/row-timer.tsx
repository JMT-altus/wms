"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Play, Square } from "lucide-react";
import {
  getMyRunningTimer,
  startTimer,
  stopTimer,
} from "@/app/(app)/tasks/time-actions";
import { formatClock, formatDuration } from "@/lib/tasks/time-math";

/**
 * The list's Action column — one timer button per row.
 *
 * There is at most ONE running timer per person, so the running task id lives
 * in a single context at the table level rather than in each row. That keeps it
 * to one server read for the whole table instead of one per row, and makes the
 * swap correct for free: starting a timer on row B has to un-light row A, and a
 * shared value cannot get that wrong.
 */
interface TimerState {
  runningTaskId: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  pendingTaskId: string | null;
  toggle: (taskId: string) => void;
}

const TimerContext = React.createContext<TimerState | null>(null);

export function RunningTimerProvider({ children }: { children: React.ReactNode }) {
  const [runningTaskId, setRunningTaskId] = React.useState<string | null>(null);
  const [startedAt, setStartedAt] = React.useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [pendingTaskId, setPendingTaskId] = React.useState<string | null>(null);

  // Pick the running timer back up after a refresh, or in a second tab. Read
  // once on mount — a poll would cost a request a second for a value that only
  // this user changes.
  React.useEffect(() => {
    let cancelled = false;
    void getMyRunningTimer().then((timer) => {
      if (cancelled || !timer) return;
      setRunningTaskId(timer.taskId);
      setStartedAt(timer.startedAt);
      setElapsedSeconds(timer.elapsedSeconds);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick only while something is running. The wall clock is read inside the
  // callback, never during render, so two renders in the same second agree.
  React.useEffect(() => {
    if (!startedAt) return;
    const started = new Date(startedAt).getTime();
    if (Number.isNaN(started)) return;
    const id = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const toggle = React.useCallback(
    (taskId: string) => {
      setPendingTaskId(taskId);
      const wasRunningHere = runningTaskId === taskId;
      void (async () => {
        try {
          if (wasRunningHere) {
            const result = await stopTimer(taskId);
            if (!result.ok) {
              toast.error(result.message ?? "The timer didn't respond.");
              return;
            }
            setRunningTaskId(null);
            setStartedAt(null);
            setElapsedSeconds(0);
            toast.success(`Logged ${formatDuration(result.durationSeconds)}.`);
          } else {
            const result = await startTimer(taskId);
            if (!result.ok) {
              toast.error(result.message ?? "The timer didn't respond.");
              return;
            }
            setRunningTaskId(taskId);
            setStartedAt(result.startedAt);
            setElapsedSeconds(0);
            toast.success(
              result.stoppedTaskId
                ? "Timer started — your other running timer was stopped."
                : "Timer started.",
            );
          }
        } finally {
          setPendingTaskId(null);
        }
      })();
    },
    [runningTaskId],
  );

  const value = React.useMemo(
    () => ({ runningTaskId, startedAt, elapsedSeconds, pendingTaskId, toggle }),
    [runningTaskId, startedAt, elapsedSeconds, pendingTaskId, toggle],
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

/**
 * A single row's start/stop control.
 *
 * Renders nothing outside a provider, so the column is inert rather than broken
 * on any surface that reuses these columns without the wrapper.
 */
export function RowTimerButton({ taskId }: { taskId: string }) {
  const ctx = React.useContext(TimerContext);
  if (!ctx) return null;

  const running = ctx.runningTaskId === taskId;
  const pending = ctx.pendingTaskId === taskId;

  return (
    <button
      type="button"
      onClick={(e) => {
        // The row is a link to the task; timing it is not navigating to it.
        e.stopPropagation();
        e.preventDefault();
        ctx.toggle(taskId);
      }}
      disabled={pending}
      aria-pressed={running}
      aria-label={running ? "Stop the timer on this task" : "Start a timer on this task"}
      title={running ? `Running — ${formatClock(ctx.elapsedSeconds)}` : "Start timer"}
      className="inline-flex items-center gap-1 rounded-chip px-1.5 py-1 disabled:opacity-40"
      style={{
        background: running
          ? "color-mix(in srgb, var(--color-green) 14%, transparent)"
          : "transparent",
        color: running ? "var(--color-green-deep)" : "var(--color-ink-muted)",
      }}
    >
      {pending ? (
        <Loader2 size={13} className="animate-spin" />
      ) : running ? (
        <Square size={12} strokeWidth={2.8} />
      ) : (
        <Play size={12} strokeWidth={2.8} />
      )}
      {running && (
        <span className="tabular-nums font-semibold" style={{ fontSize: 11 }}>
          {formatClock(ctx.elapsedSeconds)}
        </span>
      )}
    </button>
  );
}
