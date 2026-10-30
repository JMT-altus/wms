import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  collectionBalanceSnapshots,
  collectionWeeklyUploadSettings,
  collectionWeeklyUploadTasks,
  employees,
  fieldPermissionGrants,
  taskEvents,
  tasks,
} from "@/db/schema";
import { getFieldAccessFor } from "@/lib/auth/field-access";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { resolveFieldAccess } from "@/lib/access/field-permissions";
import { deriveShortId, nextShortIdCandidate } from "@/lib/import/short-id";
import { isMissingTable } from "@/lib/queries/collection-master";
import type {
  CreateWeekTaskInput,
  EmployeeFacts,
  ReminderKind,
  SnapshotRef,
  WeekRow,
  WeeklyUploadSettings,
  WeeklyUploadStore,
} from "@/lib/collections/weekly-upload/service";
import { DEFAULT_DUE_DOW, weeklyTaskState, type WeeklyTaskState } from "@/lib/collections/weekly-upload/week";

/**
 * The database behind the weekly Bulk Upload task (migration 0121). Every
 * read degrades to "not installed" while the tables don't exist; nothing here
 * creates or alters a Collection Master company, a balance snapshot or a grant.
 */

export const BULK_UPLOAD_CAPABILITY = "collection.balances.import";

/** The settings row, or the empty default while nothing is configured. */
export async function readWeeklyUploadSettings(): Promise<WeeklyUploadSettings> {
  try {
    const [row] = await db.select().from(collectionWeeklyUploadSettings).where(eq(collectionWeeklyUploadSettings.id, 1)).limit(1);
    return {
      storageReady: true,
      assigneeId: row?.assigneeId ?? null,
      dueDow: row?.dueDow ?? DEFAULT_DUE_DOW,
      setById: row?.setById ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, assigneeId: null, dueDow: DEFAULT_DUE_DOW, setById: null, updatedAt: null };
    throw err;
  }
}

type Q = Pick<typeof db, "select">;

const weekSelection = {
  weekStart: collectionWeeklyUploadTasks.weekStart,
  taskId: collectionWeeklyUploadTasks.taskId,
  assigneeId: collectionWeeklyUploadTasks.assigneeId,
  doerId: tasks.doerId,
  taskStatus: tasks.status,
  dueAt: collectionWeeklyUploadTasks.dueAt,
  createdAt: collectionWeeklyUploadTasks.createdAt,
  completedAt: collectionWeeklyUploadTasks.completedAt,
  completedSnapshotId: collectionWeeklyUploadTasks.completedSnapshotId,
  completedById: collectionWeeklyUploadTasks.completedById,
  notifiedAssignedAt: collectionWeeklyUploadTasks.notifiedAssignedAt,
  notifiedDueTodayAt: collectionWeeklyUploadTasks.notifiedDueTodayAt,
  notifiedOverdueAt: collectionWeeklyUploadTasks.notifiedOverdueAt,
  notifiedCompletedAt: collectionWeeklyUploadTasks.notifiedCompletedAt,
};

function weekQuery(q: Q) {
  return q.select(weekSelection).from(collectionWeeklyUploadTasks).innerJoin(tasks, eq(tasks.id, collectionWeeklyUploadTasks.taskId));
}

const notInstalledAs =
  <T>(fallback: T) =>
  (err: unknown): T => {
    if (isMissingTable(err)) return fallback;
    throw err;
  };

class ShortIdCollision extends Error {}

/** The store the service runs on in production. */
export const weeklyUploadStore: WeeklyUploadStore = {
  readSettings: readWeeklyUploadSettings,

  async employee(id: string): Promise<EmployeeFacts | null> {
    const [e] = await db
      .select({ id: employees.id, name: employees.name, email: employees.email, isActive: employees.isActive, isAdmin: employees.isAdmin })
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    return e ?? null;
  },

  async holdsBulkUpload(employeeId: string): Promise<boolean> {
    const row = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
    if (!row || !row.isActive) return false;
    const access = await getFieldAccessFor(row);
    return access[BULK_UPLOAD_CAPABILITY]?.allowed === true;
  },

  async getWeek(weekStart: string): Promise<WeekRow | null> {
    const [row] = await weekQuery(db).where(eq(collectionWeeklyUploadTasks.weekStart, weekStart)).limit(1).catch(notInstalledAs([]));
    return row ?? null;
  },

  async weekByTaskId(taskId: string): Promise<WeekRow | null> {
    const [row] = await weekQuery(db).where(eq(collectionWeeklyUploadTasks.taskId, taskId)).limit(1).catch(notInstalledAs([]));
    return row ?? null;
  },

  async listOpenWeeks(): Promise<WeekRow[]> {
    return weekQuery(db)
      .where(isNull(collectionWeeklyUploadTasks.completedAt))
      .orderBy(asc(collectionWeeklyUploadTasks.weekStart))
      .catch(notInstalledAs([]));
  },

  async createWeekTask(input: CreateWeekTaskInput) {
    // The whole thing retries only on a short-id collision (one in millions); the
    // week-row check and both inserts stay inside one transaction and one lock.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('collection_weekly_upload_tasks'))`);
          const [existing] = await weekQuery(tx as unknown as typeof db).where(eq(collectionWeeklyUploadTasks.weekStart, input.weekStart)).limit(1);
          if (existing) return { created: false, row: existing };

          const id = crypto.randomUUID();
          const shortId = attempt === 0 ? deriveShortId(id) : nextShortIdCandidate(id, attempt);
          try {
            await tx.insert(tasks).values({
              id,
              title: input.title,
              client: input.subject,
              subject: input.subject,
              description: input.description,
              doerId: input.assigneeId,
              initiatorId: input.initiatorId,
              createdById: input.initiatorId,
              priority: "imp_urgent",
              status: "not_started",
              dueAt: input.dueAt,
              shortId: shortId ?? null,
              visibility: "private",
            });
          } catch (err) {
            const e = err as { code?: string; constraint?: string };
            if (e?.code === "23505" && e?.constraint === "tasks_short_id_uidx") throw new ShortIdCollision();
            throw err;
          }
          await tx.insert(collectionWeeklyUploadTasks).values({ weekStart: input.weekStart, taskId: id, assigneeId: input.assigneeId, dueAt: input.dueAt });
          await tx.insert(taskEvents).values({
            taskId: id,
            actorId: input.initiatorId,
            eventType: "created",
            toValue: { title: input.title, doerId: input.assigneeId, dueAt: input.dueAt.toISOString(), weeklyUpload: { weekStart: input.weekStart } },
            note: `Compulsory weekly Collection Tracker Bulk Upload for the week of ${input.weekStart}`,
          });
          const [row] = await weekQuery(tx as unknown as typeof db).where(eq(collectionWeeklyUploadTasks.weekStart, input.weekStart)).limit(1);
          return { created: true, row: row! };
        });
      } catch (err) {
        if (err instanceof ShortIdCollision) continue;
        throw err;
      }
    }
    throw new Error("Could not allocate a unique task short id for the weekly upload task.");
  },

  async completeWeek(weekStart, by) {
    return db.transaction(async (tx) => {
      const [current] = await weekQuery(tx as unknown as typeof db).where(eq(collectionWeeklyUploadTasks.weekStart, weekStart)).limit(1).for("update", { of: collectionWeeklyUploadTasks });
      if (!current) return { claimed: false, row: null };
      if (current.completedAt) return { claimed: false, row: current };

      const claimed = await tx
        .update(collectionWeeklyUploadTasks)
        .set({ completedAt: by.at, completedSnapshotId: by.snapshotId, completedById: by.actorId })
        .where(and(eq(collectionWeeklyUploadTasks.weekStart, weekStart), isNull(collectionWeeklyUploadTasks.completedAt)))
        .returning({ weekStart: collectionWeeklyUploadTasks.weekStart });
      if (claimed.length === 0) return { claimed: false, row: current };

      // The task itself: done, unless someone already approved it (approval sits above done).
      await tx
        .update(tasks)
        .set({ status: "done", completedAt: by.at, updatedAt: by.at })
        .where(and(eq(tasks.id, current.taskId), notInArray(tasks.status, ["done", "approved"])));
      await tx.insert(taskEvents).values({
        taskId: current.taskId,
        actorId: by.actorId ?? current.doerId ?? current.assigneeId ?? (await initiatorOf(tx as unknown as typeof db, current.taskId)),
        eventType: "status_changed",
        fromValue: { status: current.taskStatus },
        toValue: { status: "done", weeklyUpload: { weekStart, snapshotId: by.snapshotId } },
        note: `Completed by a confirmed Collection Tracker Bulk Upload (upload ${by.snapshotId})`,
      });
      const [row] = await weekQuery(tx as unknown as typeof db).where(eq(collectionWeeklyUploadTasks.weekStart, weekStart)).limit(1);
      return { claimed: true, row: row ?? null };
    });
  },

  async claimNotification(weekStart, kind, at) {
    const column = NOTIFIED_COLUMN[kind];
    const rows = await db
      .update(collectionWeeklyUploadTasks)
      .set({ [column]: at })
      .where(and(eq(collectionWeeklyUploadTasks.weekStart, weekStart), isNull(collectionWeeklyUploadTasks[column])))
      .returning({ weekStart: collectionWeeklyUploadTasks.weekStart });
    return rows.length > 0;
  },

  async reassignOpenWeeks(assigneeId, actorId, at) {
    return db.transaction(async (tx) => {
      const q = tx as unknown as typeof db;
      const open = await weekQuery(q).where(isNull(collectionWeeklyUploadTasks.completedAt));
      const changed: WeekRow[] = [];
      for (const row of open) {
        if (row.doerId === assigneeId) continue;
        await tx.update(tasks).set({ doerId: assigneeId, transferredFromId: row.doerId, updatedAt: at }).where(eq(tasks.id, row.taskId));
        await tx.update(collectionWeeklyUploadTasks).set({ assigneeId, notifiedAssignedAt: at }).where(eq(collectionWeeklyUploadTasks.weekStart, row.weekStart));
        await tx.insert(taskEvents).values({
          taskId: row.taskId,
          actorId,
          eventType: "reassigned",
          fromValue: { doerId: row.doerId },
          toValue: { doerId: assigneeId, weeklyUpload: { weekStart: row.weekStart } },
          note: "Responsible employee for the weekly Bulk Upload changed in Admin & Master Setup",
        });
        changed.push({ ...row, doerId: assigneeId, assigneeId });
      }
      return changed;
    });
  },

  async snapshotsSince(from: Date): Promise<SnapshotRef[]> {
    return db
      .select({
        id: collectionBalanceSnapshots.id,
        periodTo: collectionBalanceSnapshots.periodTo,
        uploadedAt: collectionBalanceSnapshots.uploadedAt,
        uploadedById: collectionBalanceSnapshots.uploadedById,
      })
      .from(collectionBalanceSnapshots)
      .where(gte(collectionBalanceSnapshots.uploadedAt, from))
      .orderBy(asc(collectionBalanceSnapshots.uploadedAt))
      .catch(notInstalledAs([]));
  },
};

/** Which of `taskIds` are a week's compulsory task (empty while storage isn't installed). */
export async function weeklyTaskIdsAmong(taskIds: readonly string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const rows = await db
    .select({ taskId: collectionWeeklyUploadTasks.taskId })
    .from(collectionWeeklyUploadTasks)
    .where(inArray(collectionWeeklyUploadTasks.taskId, [...taskIds]))
    .catch(notInstalledAs([]));
  return new Set(rows.map((r) => r.taskId));
}

const NOTIFIED_COLUMN = {
  assigned: "notifiedAssignedAt",
  due_today: "notifiedDueTodayAt",
  overdue: "notifiedOverdueAt",
  completed: "notifiedCompletedAt",
} as const satisfies Record<ReminderKind, keyof typeof collectionWeeklyUploadTasks.$inferSelect>;

async function initiatorOf(q: Q, taskId: string): Promise<string> {
  const [t] = await q.select({ initiatorId: tasks.initiatorId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return t!.initiatorId;
}

/* ── Admin & Master Setup → Weekly Bulk Upload ─────────────────────────────── */

export interface WeeklyUploadPerson {
  id: string;
  name: string;
  email: string;
  /** Holds collection.balances.import (an explicit grant — the only way to hold it). */
  holdsPermission: boolean;
}

export interface WeeklyUploadWeekView {
  weekStart: string;
  taskId: string;
  assigneeName: string | null;
  dueAt: Date;
  state: WeeklyTaskState;
  completedAt: Date | null;
  completedSnapshotId: string | null;
  completedFileName: string | null;
  completedByName: string | null;
}

export interface WeeklyUploadOverview {
  storageReady: boolean;
  settings: WeeklyUploadSettings;
  /** The configured employee, with what (if anything) makes them ineligible. */
  assignee: (WeeklyUploadPerson & { isActive: boolean; isAdmin: boolean }) | null;
  /** Active admins — the only people who can open the Collection Tracker — with whether they hold the Bulk Upload permission. */
  people: WeeklyUploadPerson[];
  currentWeek: WeeklyUploadWeekView | null;
  lastCompleted: WeeklyUploadWeekView | null;
  recent: WeeklyUploadWeekView[];
}

/** Everything the admin page shows. Read-only. */
export async function loadWeeklyUploadOverview(now: Date, currentWeekStart: string): Promise<WeeklyUploadOverview> {
  const settings = await readWeeklyUploadSettings();
  const [admins, grants] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name, email: employees.email, isAdmin: employees.isAdmin, isActive: employees.isActive })
      .from(employees)
      .where(and(eq(employees.isActive, true), eq(employees.isAdmin, true)))
      .orderBy(asc(employees.name)),
    db
      .select({ subjectType: fieldPermissionGrants.subjectType, subjectId: fieldPermissionGrants.subjectId, allowed: fieldPermissionGrants.allowed })
      .from(fieldPermissionGrants)
      .where(eq(fieldPermissionGrants.fieldKey, BULK_UPLOAD_CAPABILITY)),
  ]);
  const everyone = Object.fromEntries(grants.filter((g) => g.subjectType === "everyone").map((g) => [BULK_UPLOAD_CAPABILITY, g.allowed]));
  const holds = (p: { id: string; email: string; isAdmin: boolean }) => {
    const own = grants.find((g) => g.subjectType === "employee" && g.subjectId === p.id);
    return resolveFieldAccess(
      BULK_UPLOAD_CAPABILITY,
      { isAdmin: p.isAdmin, isSuperAdmin: isSuperAdmin(p.email) },
      { everyone, department: {}, employee: own ? { [BULK_UPLOAD_CAPABILITY]: own.allowed } : {} },
    ).allowed;
  };
  const people: WeeklyUploadPerson[] = admins.map((a) => ({ id: a.id, name: a.name, email: a.email, holdsPermission: holds(a) }));

  let assignee: WeeklyUploadOverview["assignee"] = null;
  if (settings.assigneeId) {
    const [a] = await db
      .select({ id: employees.id, name: employees.name, email: employees.email, isAdmin: employees.isAdmin, isActive: employees.isActive })
      .from(employees)
      .where(eq(employees.id, settings.assigneeId))
      .limit(1);
    if (a) assignee = { id: a.id, name: a.name, email: a.email, isActive: a.isActive, isAdmin: a.isAdmin, holdsPermission: holds(a) };
  }

  if (!settings.storageReady) return { storageReady: false, settings, assignee, people, currentWeek: null, lastCompleted: null, recent: [] };

  const doer = employees;
  const rows = await db
    .select({
      weekStart: collectionWeeklyUploadTasks.weekStart,
      taskId: collectionWeeklyUploadTasks.taskId,
      doerName: doer.name,
      taskStatus: tasks.status,
      dueAt: collectionWeeklyUploadTasks.dueAt,
      completedAt: collectionWeeklyUploadTasks.completedAt,
      completedSnapshotId: collectionWeeklyUploadTasks.completedSnapshotId,
      completedFileName: collectionBalanceSnapshots.fileName,
      completedById: collectionWeeklyUploadTasks.completedById,
    })
    .from(collectionWeeklyUploadTasks)
    .innerJoin(tasks, eq(tasks.id, collectionWeeklyUploadTasks.taskId))
    .leftJoin(doer, eq(doer.id, tasks.doerId))
    .leftJoin(collectionBalanceSnapshots, eq(collectionBalanceSnapshots.id, collectionWeeklyUploadTasks.completedSnapshotId))
    .orderBy(desc(collectionWeeklyUploadTasks.weekStart))
    .limit(12);
  const completerIds = [...new Set(rows.map((r) => r.completedById).filter((id): id is string => !!id))];
  const completers = new Map(
    completerIds.length === 0
      ? []
      : (await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, completerIds))).map((e) => [e.id, e.name] as const),
  );
  const views: WeeklyUploadWeekView[] = rows.map((r) => ({
    weekStart: r.weekStart,
    taskId: r.taskId,
    assigneeName: r.doerName,
    dueAt: r.dueAt,
    state: weeklyTaskState({ taskStatus: r.taskStatus, completedAt: r.completedAt, dueAt: r.dueAt }, now),
    completedAt: r.completedAt,
    completedSnapshotId: r.completedSnapshotId,
    completedFileName: r.completedFileName,
    completedByName: r.completedById ? (completers.get(r.completedById) ?? null) : null,
  }));
  return {
    storageReady: true,
    settings,
    assignee,
    people,
    currentWeek: views.find((v) => v.weekStart === currentWeekStart) ?? null,
    lastCompleted: views.filter((v) => v.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0] ?? null,
    recent: views,
  };
}
