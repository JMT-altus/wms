import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, tasks } from "@/lib/db";
import {
  employees,
  taskEvents,
  taskTimeEvents,
  taskTimeRollup,
  taskWorkSessions,
} from "@/db/schema";
import {
  AUTO_CLOSE_AFTER_SECONDS,
  foldRollup,
  spanSeconds,
  type WorkSpan,
} from "@/lib/tasks/time-math";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The storage half of task time tracking. The arithmetic lives in
 * ./time-math (pure, exhaustively tested); this file only moves rows.
 *
 * Three tables, three jobs:
 *   task_time_events   raw start/stop presses — append-only evidence
 *   task_work_sessions resolved spans — what reports read
 *   task_time_rollup   one cached total per task — what LISTS read, so 500
 *                      rows don't aggregate raw events 500 times
 *
 * Transport-agnostic, exactly like ./set-status: it takes an explicit actor
 * so the web Server Action and the mobile API share one implementation and
 * the rules can't diverge between the two clients. Auth, rate-limiting and
 * cache revalidation belong to the callers.
 */

/** The acting user, resolved by either auth path (cookie or Bearer token). */
export interface TimeActor {
  id: string;
  name: string;
  isAdmin: boolean;
}

export type TimeResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: "invalid" | "not-found" | "forbidden" | "conflict";
      message?: string;
    };

export interface RunningTimer {
  sessionId: string;
  taskId: string;
  startedAt: string;
  /** Elapsed at the moment of the read; the client keeps ticking from here. */
  elapsedSeconds: number;
}

/* ─────────────────────────────────────────────────── rollup maintenance ─ */

/**
 * Rebuild one task's cached total from its sessions.
 *
 * The rollup is a CACHE, never a source of truth: it is always this function
 * away from being correct again. Called after every start/stop rather than
 * incremented in place, because an increment that misses one write is wrong
 * forever, while a rebuild is only ever as stale as the last call.
 *
 * Open sessions are folded in with `now`, so the stored total already includes
 * the running timer at write time. Lists that want a live figure add the open
 * session's own elapsed on the client instead of re-reading.
 */
export async function rebuildTimeRollup(taskId: string): Promise<void> {
  const rows = await db
    .select({
      startedAt: taskWorkSessions.startedAt,
      endedAt: taskWorkSessions.endedAt,
      durationSeconds: taskWorkSessions.durationSeconds,
    })
    .from(taskWorkSessions)
    .where(eq(taskWorkSessions.taskId, taskId));

  const rollup = foldRollup(rows as WorkSpan[]);
  const now = new Date();

  await db
    .insert(taskTimeRollup)
    .values({
      taskId,
      totalSeconds: rollup.totalSeconds,
      sessionCount: rollup.sessionCount,
      firstStartedAt: rollup.firstStartedAt,
      lastEndedAt: rollup.lastEndedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskTimeRollup.taskId,
      set: {
        totalSeconds: rollup.totalSeconds,
        sessionCount: rollup.sessionCount,
        firstStartedAt: rollup.firstStartedAt,
        lastEndedAt: rollup.lastEndedAt,
        updatedAt: now,
      },
    });
}

/* ─────────────────────────────────────────────────────────── the timer ─ */

/**
 * Start the clock on a task for this person.
 *
 * One running timer per PERSON, not per task: working on two things at once is
 * not a thing a clock can represent honestly, so starting a second timer
 * closes the first and says so. That auto-stop is a real stop — it writes its
 * own `stop` event and closes its session properly — it just wasn't pressed.
 */
export async function startTaskTimer(
  actor: TimeActor,
  taskId: string,
  source = "web",
): Promise<TimeResult<{ sessionId: string; startedAt: string; stoppedTaskId?: string }>> {
  if (!UUID_RE.test(taskId)) {
    return { ok: false, error: "invalid", message: "Bad task id" };
  }

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { id: true, doerId: true, initiatorId: true, createdById: true, archived: true },
  });
  if (!task) return { ok: false, error: "not-found" };

  // You may time work you are involved in. Timing a stranger's task would put
  // hours on a row nobody expects them on.
  const involved =
    actor.isAdmin ||
    task.doerId === actor.id ||
    task.initiatorId === actor.id ||
    task.createdById === actor.id;
  if (!involved) return { ok: false, error: "forbidden" };

  if (task.archived) {
    return { ok: false, error: "invalid", message: "This task is archived." };
  }

  const now = new Date();

  // Close whatever else is running for this person first — including a timer
  // already running on THIS task, which makes a double-press idempotent-ish
  // rather than an error the user has to think about.
  const open = await db
    .select({
      id: taskWorkSessions.id,
      taskId: taskWorkSessions.taskId,
      startedAt: taskWorkSessions.startedAt,
    })
    .from(taskWorkSessions)
    .where(
      and(
        eq(taskWorkSessions.employeeId, actor.id),
        isNull(taskWorkSessions.endedAt),
      ),
    );

  // Already running on this very task — report it rather than restarting, or
  // an accidental second click silently discards the elapsed time.
  const sameTask = open.find((s) => s.taskId === taskId);
  if (sameTask) {
    return {
      ok: true,
      sessionId: sameTask.id,
      startedAt: sameTask.startedAt.toISOString(),
    };
  }

  let stoppedTaskId: string | undefined;
  for (const session of open) {
    await closeSession(session.id, session.startedAt, now, actor.id, session.taskId, {
      autoClosed: true,
      source: "auto",
      note: "Stopped automatically — another timer was started.",
    });
    await rebuildTimeRollup(session.taskId);
    stoppedTaskId = session.taskId;
  }

  const inserted = await db.transaction(async (tx) => {
    await tx.insert(taskTimeEvents).values({
      taskId,
      employeeId: actor.id,
      kind: "start",
      at: now,
      source,
    });
    const [row] = await tx
      .insert(taskWorkSessions)
      .values({
        taskId,
        employeeId: actor.id,
        startedAt: now,
        source,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: taskWorkSessions.id });
    return row ?? null;
  });

  // The partial unique index makes a concurrent double-start impossible, so a
  // missing row here means the INSERT lost that race rather than that anything
  // is wrong — report the session the winner opened.
  if (!inserted) {
    const existing = await db.query.taskWorkSessions.findFirst({
      where: and(
        eq(taskWorkSessions.taskId, taskId),
        eq(taskWorkSessions.employeeId, actor.id),
        isNull(taskWorkSessions.endedAt),
      ),
    });
    if (!existing) return { ok: false, error: "conflict", message: "Couldn't start the timer." };
    return {
      ok: true,
      sessionId: existing.id,
      startedAt: existing.startedAt.toISOString(),
    };
  }

  await rebuildTimeRollup(taskId);

  return {
    ok: true,
    sessionId: inserted.id,
    startedAt: now.toISOString(),
    ...(stoppedTaskId ? { stoppedTaskId } : {}),
  };
}

/**
 * Close one session and log the matching stop event, in one transaction.
 *
 * `durationSeconds` is denormalised here so the rollup stays a plain SUM and
 * reports never re-derive a duration per row.
 */
async function closeSession(
  sessionId: string,
  startedAt: Date,
  endedAt: Date,
  employeeId: string,
  taskId: string,
  opts: { autoClosed?: boolean; source?: string; note?: string } = {},
): Promise<number> {
  const duration = spanSeconds({ startedAt, endedAt });
  await db.transaction(async (tx) => {
    await tx
      .update(taskWorkSessions)
      .set({
        endedAt,
        durationSeconds: duration,
        autoClosed: opts.autoClosed ?? false,
        note: opts.note ?? null,
        updatedAt: new Date(),
      })
      // Guarded on "still open" so two concurrent stops can't both write —
      // the second one finds nothing to close and no-ops.
      .where(and(eq(taskWorkSessions.id, sessionId), isNull(taskWorkSessions.endedAt)));
    await tx.insert(taskTimeEvents).values({
      taskId,
      employeeId,
      kind: "stop",
      at: endedAt,
      source: opts.source ?? "web",
      note: opts.note ?? null,
    });
  });
  return duration;
}

/**
 * Stop this person's timer on a task.
 *
 * Logs a `task_events` row too — time spent is part of what happened to the
 * task, and the audit timeline is meant to hold everything. That event is
 * appended outside the session transaction on purpose: a failure to narrate
 * must never lose the recorded time.
 */
export async function stopTaskTimer(
  actor: TimeActor,
  taskId: string,
  source = "web",
): Promise<TimeResult<{ durationSeconds: number; totalSeconds: number }>> {
  if (!UUID_RE.test(taskId)) {
    return { ok: false, error: "invalid", message: "Bad task id" };
  }

  const open = await db.query.taskWorkSessions.findFirst({
    where: and(
      eq(taskWorkSessions.taskId, taskId),
      eq(taskWorkSessions.employeeId, actor.id),
      isNull(taskWorkSessions.endedAt),
    ),
  });
  if (!open) {
    return { ok: false, error: "conflict", message: "No timer is running on this task." };
  }

  const now = new Date();
  const duration = await closeSession(
    open.id,
    open.startedAt,
    now,
    actor.id,
    taskId,
    { source },
  );
  await rebuildTimeRollup(taskId);

  const [rollup] = await db
    .select({ totalSeconds: taskTimeRollup.totalSeconds })
    .from(taskTimeRollup)
    .where(eq(taskTimeRollup.taskId, taskId));

  await db.insert(taskEvents).values({
    taskId,
    actorId: actor.id,
    eventType: "time_logged",
    fromValue: null,
    toValue: { seconds: duration },
  });

  return { ok: true, durationSeconds: duration, totalSeconds: rollup?.totalSeconds ?? duration };
}

/** This person's running timer, if any. Powers every timer button's render. */
export async function getRunningTimer(
  employeeId: string,
): Promise<RunningTimer | null> {
  const open = await db.query.taskWorkSessions.findFirst({
    where: and(
      eq(taskWorkSessions.employeeId, employeeId),
      isNull(taskWorkSessions.endedAt),
    ),
    orderBy: desc(taskWorkSessions.startedAt),
  });
  if (!open) return null;
  return {
    sessionId: open.id,
    taskId: open.taskId,
    startedAt: open.startedAt.toISOString(),
    elapsedSeconds: spanSeconds({ startedAt: open.startedAt, endedAt: null }),
  };
}

/* ────────────────────────────────────────────────────────────── reading ─ */

/**
 * Cached totals for a page of tasks, in ONE query.
 *
 * This is the entire reason `task_time_rollup` exists — the list calls it once
 * per render with the ids it is showing, instead of aggregating raw events per
 * row. Tasks with no tracked time are simply absent from the map; callers
 * treat a miss as zero rather than needing a row per task.
 */
export async function getTimeTotals(
  taskIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = taskIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      taskId: taskTimeRollup.taskId,
      totalSeconds: taskTimeRollup.totalSeconds,
    })
    .from(taskTimeRollup)
    .where(inArray(taskTimeRollup.taskId, ids));
  return new Map(rows.map((r) => [r.taskId, r.totalSeconds]));
}

export interface TaskSessionRow {
  id: string;
  employeeId: string;
  employeeName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  autoClosed: boolean;
  note: string | null;
}

/** Every session on one task, newest first — the detail page's time panel. */
export async function listTaskSessions(taskId: string): Promise<TaskSessionRow[]> {
  const rows = await db
    .select({
      id: taskWorkSessions.id,
      employeeId: taskWorkSessions.employeeId,
      employeeName: employees.name,
      startedAt: taskWorkSessions.startedAt,
      endedAt: taskWorkSessions.endedAt,
      durationSeconds: taskWorkSessions.durationSeconds,
      autoClosed: taskWorkSessions.autoClosed,
      note: taskWorkSessions.note,
    })
    .from(taskWorkSessions)
    .leftJoin(employees, eq(employees.id, taskWorkSessions.employeeId))
    .where(eq(taskWorkSessions.taskId, taskId))
    .orderBy(desc(taskWorkSessions.startedAt));

  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    // An open session is measured to now, so the panel shows it ticking.
    durationSeconds: spanSeconds({
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationSeconds: r.durationSeconds,
    }),
    autoClosed: r.autoClosed,
    note: r.note,
  }));
}

export interface EmployeeTimeTotal {
  employeeId: string;
  employeeName: string | null;
  totalSeconds: number;
  sessionCount: number;
  taskCount: number;
}

/**
 * Time per person over a window — the manager report.
 *
 * Reads sessions rather than the rollup because the rollup is per TASK and
 * cannot be sliced by person or by date. Open sessions are excluded: a report
 * of a finished period should not change while you look at it.
 */
export async function timeByEmployee(
  from: Date,
  to: Date,
): Promise<EmployeeTimeTotal[]> {
  const rows = await db
    .select({
      employeeId: taskWorkSessions.employeeId,
      employeeName: employees.name,
      totalSeconds: sql<number>`COALESCE(SUM(${taskWorkSessions.durationSeconds}), 0)::int`,
      sessionCount: sql<number>`COUNT(*)::int`,
      taskCount: sql<number>`COUNT(DISTINCT ${taskWorkSessions.taskId})::int`,
    })
    .from(taskWorkSessions)
    .leftJoin(employees, eq(employees.id, taskWorkSessions.employeeId))
    .where(
      and(
        gte(taskWorkSessions.startedAt, from),
        lte(taskWorkSessions.startedAt, to),
        sql`${taskWorkSessions.endedAt} IS NOT NULL`,
      ),
    )
    .groupBy(taskWorkSessions.employeeId, employees.name)
    .orderBy(desc(sql`COALESCE(SUM(${taskWorkSessions.durationSeconds}), 0)`));

  return rows;
}

/* ─────────────────────────────────────────────────────── reconciliation ─ */

/**
 * Close timers that were left running past the window and refresh their
 * rollups. Driven by the reminders cron.
 *
 * Closed at `startedAt + AUTO_CLOSE_AFTER_SECONDS`, NOT at now: the honest
 * claim is "we know they worked at most the window", and stamping `now` would
 * keep inflating a forgotten timer every time the cron ran. Every such row is
 * flagged `auto_closed` so reports can show it as forgotten rather than
 * as effort.
 */
export async function reconcileAbandonedTimers(
  now: Date = new Date(),
): Promise<{ closed: number }> {
  const cutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_SECONDS * 1000);
  const stale = await db
    .select({
      id: taskWorkSessions.id,
      taskId: taskWorkSessions.taskId,
      employeeId: taskWorkSessions.employeeId,
      startedAt: taskWorkSessions.startedAt,
    })
    .from(taskWorkSessions)
    .where(
      and(isNull(taskWorkSessions.endedAt), lte(taskWorkSessions.startedAt, cutoff)),
    );

  for (const session of stale) {
    const endedAt = new Date(
      session.startedAt.getTime() + AUTO_CLOSE_AFTER_SECONDS * 1000,
    );
    await closeSession(
      session.id,
      session.startedAt,
      endedAt,
      session.employeeId,
      session.taskId,
      {
        autoClosed: true,
        source: "auto",
        note: "Closed automatically — the timer was left running.",
      },
    );
    await rebuildTimeRollup(session.taskId);
  }

  return { closed: stale.length };
}
