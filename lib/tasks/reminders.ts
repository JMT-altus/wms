import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db, tasks } from "@/lib/db";
import { PENDING_STATUSES } from "@/db/enums";
import { effectiveDueAtSql } from "@/lib/tasks/effective-due-sql";
import { notify } from "@/lib/notifications/dispatch";
import { taskLabel } from "@/lib/tasks/set-status";
import { reconcileAbandonedTimers } from "@/lib/tasks/time-store";

/**
 * The daily task-reminder sweep.
 *
 * Two jobs that both belong to "keep the module honest overnight":
 *
 *   1. Remind each doer about work due TOMORROW, so a deadline is never a
 *      surprise on the morning of.
 *   2. Close timers left running, so a forgotten clock doesn't bill an
 *      overnight to a task.
 *
 * The reminder window keys off the EFFECTIVE due date — `COALESCE(revised,
 * due)`. Reading the raw `due_at` here would chase people about deadlines that
 * were formally moved, which is precisely the bug the revised-date column
 * exists to prevent.
 */

export interface ReminderStats {
  /** Tasks that matched the due-tomorrow window. */
  due: number;
  /** Reminders actually dispatched (one per task, to its doer). */
  notified: number;
  /** Forgotten timers the reconciler closed. */
  timersClosed: number;
}

/** IST midnight for the day `offsetDays` from `now`, as a UTC instant. */
function istDayStart(now: Date, offsetDays: number): Date {
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate() + offsetDays;
  // Midnight IST is 18:30 UTC the previous day.
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

export async function runTaskReminders(
  now: Date = new Date(),
): Promise<ReminderStats> {
  // Timers first: a stretch closed here lands in today's report rather than
  // hanging over into another day.
  const { closed } = await reconcileAbandonedTimers(now);

  const from = istDayStart(now, 1);
  const to = istDayStart(now, 2);
  const effectiveDue = effectiveDueAtSql();

  const due = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      subject: tasks.subject,
      doerId: tasks.doerId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.archived, false),
        // Binned work is not work. Same rule every list follows.
        isNull(tasks.abandonedAt),
        // Only open work gets chased — a finished task is not a deadline.
        inArray(tasks.status, [...PENDING_STATUSES]),
        gte(effectiveDue, from),
        lt(effectiveDue, to),
      ),
    );

  let notified = 0;
  for (const task of due) {
    // An unassigned pool task has nobody to remind.
    if (!task.doerId) continue;
    const label = taskLabel({ subject: task.subject, title: task.title });
    // `notify` is best-effort and never throws, so one bad recipient cannot
    // stop the sweep partway through.
    await notify({
      userId: task.doerId,
      taskId: task.id,
      kind: "nudge",
      title: `Due tomorrow: '${label}'`,
      body: JSON.stringify({ note: "This task is due tomorrow." }),
    });
    notified += 1;
  }

  return { due: due.length, notified, timersClosed: closed };
}
