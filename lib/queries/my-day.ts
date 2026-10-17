import "server-only";
import { and, asc, eq, inArray, isNull, lt, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, tasks } from "@/db/schema";
import { visibleTaskCondition } from "@/lib/auth/task-visibility";
import { effectiveDueAtSql } from "@/lib/tasks/effective-due-sql";
import { PENDING_STATUSES, TASK_PRIORITIES } from "@/db/enums";
import type { TaskStatus, TaskPriority } from "@/db/enums";

export interface MyDayCounts {
  dueToday: number;
  overdue: number;
  doneToday: number;
}

const TZ = "Asia/Kolkata";

/** A task on the Daily Commitments plan board. */
export interface PlanTask {
  id: string;
  title: string;
  subject: string | null;
  client: string | null;
  /** Repeats daily — a standing commitment rather than a one-off task. */
  daily: boolean;
  /** Effective due day (revised date when set, else the original), IST yyyy-mm-dd. */
  dueYmd: string;
  /** The ORIGINAL due day, IST yyyy-mm-dd. */
  originalYmd: string;
  /** Rescheduled: the effective due day differs from the original. */
  revised: boolean;
}

const istYmd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** A task planned for a day, with who it is for — the Daily Commitments list. */
export interface DayPlanTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  doerId: string;
  doerName: string;
  daily: boolean;
  /** The ORIGINAL due day (IST), set when the task was carried forward to this day. */
  carriedFrom: string | null;
  /** Optimistic-lock token for status changes (ISO). */
  updatedAt: string;
}

/**
 * Every task planned for one IST day: the tasks whose effective due date (the
 * revised date when set, else the original) falls on it. This is the same
 * definition the plan board uses, so the two never disagree. Optionally narrowed
 * to some employees; always limited to what the viewer may see.
 */
export async function listDayPlan(opts: { day: string; employeeIds?: string[] }): Promise<DayPlanTask[]> {
  const start = new Date(`${opts.day}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) return [];
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const eff = effectiveDueAtSql();
  const visible = await visibleTaskCondition();

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      doerId: tasks.doerId,
      doerName: employees.name,
      recurrence: tasks.recurrence,
      dueAt: tasks.dueAt,
      revisedTargetDate: tasks.revisedTargetDate,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(employees, eq(tasks.doerId, employees.id))
    .where(
      and(
        eq(tasks.archived, false),
        isNull(tasks.abandonedAt),
        gte(eff, start.toISOString() as unknown as Date),
        lt(eff, end.toISOString() as unknown as Date),
        opts.employeeIds && opts.employeeIds.length > 0
          ? inArray(tasks.doerId, opts.employeeIds)
          : undefined,
        visible,
      ),
    )
    .orderBy(asc(employees.name), asc(eff))
    .limit(500);

  return rows.map((r) => {
    const original = istYmd(r.dueAt);
    const revised = r.revisedTargetDate != null && istYmd(r.revisedTargetDate) !== original;
    return {
      id: r.id,
      title: r.title?.trim() || r.description?.trim() || "Untitled task",
      status: r.status,
      priority: r.priority,
      doerId: r.doerId as string,
      doerName: r.doerName,
      daily: r.recurrence === "daily",
      carriedFrom: revised && original !== opts.day ? original : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/**
 * The open tasks a person plans their days from: assigned to them, not
 * archived, still pending, with an effective due date up to `days` days ahead
 * (overdue ones included). A day's plan is simply the tasks due that day; moving
 * a task into or out of a day is a revised-target-date change.
 */
export async function listPlanTasks(userId: string, days = 14): Promise<PlanTask[]> {
  const { end } = istBoundaries();
  const horizon = new Date(end.getTime() + days * 24 * 60 * 60 * 1000);
  const eff = effectiveDueAtSql();
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      subject: tasks.subject,
      client: tasks.client,
      recurrence: tasks.recurrence,
      dueAt: tasks.dueAt,
      revisedTargetDate: tasks.revisedTargetDate,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.archived, false),
        // Binned work is not work — the same rule every list follows.
        isNull(tasks.abandonedAt),
        eq(tasks.doerId, userId),
        inArray(tasks.status, [...PENDING_STATUSES]),
        // The COALESCE fragment is not a typed column, so the driver will not
        // serialise a Date for it — hand it the ISO string.
        lt(eff, horizon.toISOString() as unknown as Date),
      ),
    )
    .orderBy(asc(eff))
    .limit(300);

  return rows.map((r) => {
    const eff = r.revisedTargetDate ?? r.dueAt;
    return {
      id: r.id,
      title: r.title?.trim() || r.description?.trim() || "Untitled task",
      subject: r.subject,
      client: r.client,
      daily: r.recurrence === "daily",
      dueYmd: istYmd(eff),
      originalYmd: istYmd(r.dueAt),
      revised: r.revisedTargetDate != null && istYmd(r.revisedTargetDate) !== istYmd(r.dueAt),
    };
  });
}

function istBoundaries(now: Date = new Date()): { start: Date; end: Date } {
  // Compute IST midnight + next-IST-midnight as UTC instants.
  const dayLabel = now.toLocaleDateString("en-CA", { timeZone: TZ }); // yyyy-mm-dd
  // IST is UTC+5:30 with no DST — the literal-IST midnight = `<day>T00:00:00+05:30`.
  const start = new Date(`${dayLabel}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Three counters for the dashboard "Your day" card. Pending = anything in
 * the canonical PENDING_STATUSES set; "done today" means status='done'
 * AND completed_at falls within today's IST window.
 *
 * Cheap — three `count(*)` queries that all hit the existing
 * (doer_id, archived, status) index family. No join.
 */
export async function getMyDayCounts(userId: string): Promise<MyDayCounts> {
  const { start, end } = istBoundaries();
  const pendingList = [...PENDING_STATUSES];

  const [dueTodayRow, overdueRow, doneTodayRow] = await Promise.all([
    // Pending tasks whose due_at falls within today (IST).
    db
      .select({ n: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.archived, false),
          eq(tasks.doerId, userId),
          inArray(tasks.status, pendingList),
          gte(tasks.dueAt, start),
          lt(tasks.dueAt, end),
        ),
      ),
    // Pending tasks whose due_at is before today's IST midnight.
    db
      .select({ n: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.archived, false),
          eq(tasks.doerId, userId),
          inArray(tasks.status, pendingList),
          lt(tasks.dueAt, start),
        ),
      ),
    // Tasks I marked done today.
    db
      .select({ n: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.archived, false),
          eq(tasks.doerId, userId),
          eq(tasks.status, "done"),
          gte(tasks.completedAt, start),
          lt(tasks.completedAt, end),
        ),
      ),
  ]);

  return {
    dueToday: dueTodayRow.length,
    overdue: overdueRow.length,
    doneToday: doneTodayRow.length,
  };
}

export interface MyTodayTask {
  id: string;
  taskNo: number | null;
  title: string | null;
  client: string | null;
  subject: string | null;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  /** The task's repeat token ("daily", …) — null when it does not repeat. */
  recurrence?: string | null;
  /** Due before today's IST midnight (vs. due within today). */
  overdue: boolean;
}

// Priority rank in the canonical TASK_PRIORITIES order
// (Critical → Important → Urgent → Normal).
const PRIORITY_RANK = Object.fromEntries(
  TASK_PRIORITIES.map((p, i) => [p, i]),
) as Record<TaskPriority, number>;

/**
 * The mobile "Today" home: every pending task assigned to the user that is
 * overdue or due today (IST), sorted priority-first (Critical → Normal),
 * then by due date. One indexed query — same predicate family as the
 * counters above, so the list always agrees with the counts.
 */
export async function getMyTodayTasks(userId: string): Promise<MyTodayTask[]> {
  const { start, end } = istBoundaries();

  const rows = await db
    .select({
      id: tasks.id,
      taskNo: tasks.taskNo,
      title: tasks.title,
      client: tasks.client,
      subject: tasks.subject,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueAt: tasks.dueAt,
      recurrence: tasks.recurrence,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.archived, false),
        eq(tasks.doerId, userId),
        inArray(tasks.status, [...PENDING_STATUSES]),
        lt(tasks.dueAt, end),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    .limit(200);

  return rows
    .map((r) => ({ ...r, overdue: r.dueAt != null && r.dueAt < start }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0),
    );
}
