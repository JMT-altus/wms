"use server";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { db, tasks } from "@/lib/db";
import { employees, taskEvents } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { notify } from "@/lib/notifications/dispatch";
import { taskLabel } from "@/lib/tasks/set-status";
import { pickEffectiveDue } from "@/lib/tasks/effective-due";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SimpleResult = { ok: true } | { ok: false; error: string };

function revalidateTaskRoutes(): void {
  revalidatePath("/tasks");
  revalidatePath("/archived");
  revalidatePath("/");
  updateTag(CACHE_TAGS.tasks);
}

/**
 * Move a task to the Recycle Bin.
 *
 * The third disposal option, and the one that should be reached for by
 * default. Archive means "this is finished, file it"; Delete means "this row
 * should never have existed" and is irreversible. Abandoning means "this is
 * not going to happen" — the row and its whole audit timeline survive, it just
 * stops appearing anywhere, and any mistake is one click from undone.
 *
 * Admin-only, matching archiveTask and deleteTask.
 */
export async function abandonTask(
  taskId: string,
  reason?: string,
): Promise<SimpleResult> {
  if (!UUID_RE.test(taskId)) return { ok: false, error: "Invalid task id." };
  const me = await requireUser();
  if (!me.isAdmin) {
    return { ok: false, error: "Only admins can move a task to the Recycle Bin." };
  }
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const note = reason?.trim() || null;
  const now = new Date();

  try {
    const found = await db.transaction(async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({ abandonedAt: now, abandonedById: me.id, updatedAt: now })
        // Guarded on "not already abandoned" so a double-click doesn't
        // overwrite who binned it, or when.
        .where(and(eq(tasks.id, taskId), sql`${tasks.abandonedAt} IS NULL`))
        .returning({ id: tasks.id });
      if (updated.length === 0) return false;
      await tx.insert(taskEvents).values({
        taskId,
        actorId: me.id,
        eventType: "abandoned",
        toValue: { action: "abandoned" },
        note,
      });
      return true;
    });
    if (!found) {
      return { ok: false, error: "Task not found, or already in the Recycle Bin." };
    }
  } catch (err) {
    return { ok: false, error: `Could not abandon: ${(err as Error).message}` };
  }

  revalidateTaskRoutes();
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

/** Pull a task back out of the Recycle Bin, exactly as it went in. */
export async function restoreAbandonedTask(taskId: string): Promise<SimpleResult> {
  if (!UUID_RE.test(taskId)) return { ok: false, error: "Invalid task id." };
  const me = await requireUser();
  if (!me.isAdmin) {
    return { ok: false, error: "Only admins can restore a task." };
  }
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const now = new Date();
  try {
    const found = await db.transaction(async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({ abandonedAt: null, abandonedById: null, updatedAt: now })
        .where(and(eq(tasks.id, taskId), isNotNull(tasks.abandonedAt)))
        .returning({ id: tasks.id });
      if (updated.length === 0) return false;
      await tx.insert(taskEvents).values({
        taskId,
        actorId: me.id,
        eventType: "restored",
        toValue: { action: "restored-from-bin" },
      });
      return true;
    });
    if (!found) {
      return { ok: false, error: "Task not found, or not in the Recycle Bin." };
    }
  } catch (err) {
    return { ok: false, error: `Could not restore: ${(err as Error).message}` };
  }

  revalidateTaskRoutes();
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export interface AbandonedTaskRow {
  id: string;
  taskNo: number | null;
  title: string;
  client: string | null;
  subject: string | null;
  doerName: string | null;
  abandonedAt: string;
  abandonedByName: string | null;
}

/** Everything in the Recycle Bin, most recently binned first. */
export async function listAbandonedTasks(): Promise<AbandonedTaskRow[]> {
  const me = await requireUser();
  if (!me.isAdmin) return [];

  const doer = employees;
  const rows = await db
    .select({
      id: tasks.id,
      taskNo: tasks.taskNo,
      title: tasks.title,
      client: tasks.client,
      subject: tasks.subject,
      doerName: doer.name,
      abandonedAt: tasks.abandonedAt,
      abandonedByName: sql<string | null>`(
        SELECT e2.name FROM employees e2 WHERE e2.id = ${tasks.abandonedById}
      )`,
    })
    .from(tasks)
    .leftJoin(doer, eq(doer.id, tasks.doerId))
    .where(isNotNull(tasks.abandonedAt))
    .orderBy(desc(tasks.abandonedAt));

  return rows.map((r) => ({
    ...r,
    // Non-null by the WHERE clause; the type just doesn't know it.
    abandonedAt: r.abandonedAt ? r.abandonedAt.toISOString() : "",
  }));
}

export type NudgeResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Poke the doer about a task.
 *
 * Deliberately writes an audit event as well as sending the notification: a
 * nudge is a thing that happened between two people, and a chaser that leaves
 * no trace is how the same task gets nudged by four people in a morning.
 *
 * Only the people with standing to chase — the initiator, the creator or an
 * admin — may nudge, and nobody may nudge themselves.
 */
export async function nudgeTask(
  taskId: string,
  message?: string,
): Promise<NudgeResult> {
  if (!UUID_RE.test(taskId)) return { ok: false, error: "Invalid task id." };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: {
      id: true,
      title: true,
      subject: true,
      doerId: true,
      initiatorId: true,
      createdById: true,
      dueAt: true,
      revisedTargetDate: true,
      archived: true,
    },
  });
  if (!task) return { ok: false, error: "Task not found." };

  if (!task.doerId) {
    return { ok: false, error: "This task isn't assigned to anyone yet." };
  }
  if (task.archived) {
    return { ok: false, error: "This task is archived." };
  }
  if (task.doerId === me.id) {
    return { ok: false, error: "You can't nudge yourself." };
  }

  const permitted =
    me.isAdmin || me.id === task.initiatorId || me.id === task.createdById;
  if (!permitted) {
    return { ok: false, error: "Only the initiator or an admin can nudge." };
  }

  const note = message?.trim().slice(0, 500) || null;
  const label = taskLabel({ subject: task.subject, title: task.title });

  await db.insert(taskEvents).values({
    taskId,
    actorId: me.id,
    eventType: "nudged",
    toValue: { doerId: task.doerId },
    note,
  });

  // Outside any transaction, like every other dispatch in the module — a slow
  // send must never hold a row lock.
  const due = pickEffectiveDue(task);
  // Formatted here, not in the template: the deadline that matters is the
  // EFFECTIVE one, and the notification body is the only place that
  // distinction survives the trip to email / Slack / WhatsApp.
  const dueLabel = due
    ? due.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : undefined;
  await notify({
    userId: task.doerId,
    actorId: me.id,
    taskId,
    kind: "nudge",
    title: `${me.name} nudged you about '${label}'`,
    body: JSON.stringify({
      ...(note ? { note } : {}),
      ...(dueLabel ? { dueLabel } : {}),
    }),
  });

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}
