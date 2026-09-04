"use server";

import { and, asc, eq, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, tasks } from "@/lib/db";
import { taskChecklistItems, taskEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { canComment } from "@/lib/auth/task-permissions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ContentSchema = z.string().trim().min(1).max(500);

export type ChecklistResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid" | "not-found" | "forbidden";
      message?: string;
    };

export interface ChecklistItemRow {
  id: string;
  content: string;
  done: boolean;
  doneById: string | null;
  doneAt: string | null;
  sortOrder: number;
}

/**
 * Checklist items are the sub-steps inside one task — no doer, no due date, no
 * status lifecycle. Anyone who can comment on a task can work its checklist:
 * ticking a step is the lightest possible progress report, and gating it more
 * tightly than a comment would just push people back to writing "done step 3"
 * in the timeline.
 *
 * Every mutation appends a `checklist_updated` audit event, like every other
 * write in the module.
 */
type LoadedTask =
  | { error: "invalid" | "not-found" | "forbidden"; message?: string }
  | {
      me: { id: string; isAdmin: boolean };
      task: { id: string };
    };

async function loadTaskForActor(taskId: string): Promise<LoadedTask> {
  if (!UUID_RE.test(taskId)) return { error: "invalid" };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { error: "invalid", message: limited.error };

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: {
      id: true,
      createdById: true,
      initiatorId: true,
      doerId: true,
      status: true,
    },
  });
  if (!task) return { error: "not-found" };

  const permitted = canComment({
    employee: { id: me.id, isAdmin: me.isAdmin },
    task: {
      createdById: task.createdById,
      initiatorId: task.initiatorId,
      doerId: task.doerId,
      status: task.status,
    },
  });
  if (!permitted) return { error: "forbidden" };

  return { me: { id: me.id, isAdmin: me.isAdmin }, task: { id: task.id } };
}

/** Append one step to the end of a task's checklist. */
export async function addChecklistItem(
  taskId: string,
  content: string,
): Promise<ChecklistResult> {
  const loaded = await loadTaskForActor(taskId);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error, message: loaded.message };
  }
  const { me } = loaded;

  let text: string;
  try {
    text = ContentSchema.parse(content);
  } catch {
    return { ok: false, error: "invalid", message: "Write something first." };
  }

  // Append at the end. Computed inside the transaction so two people adding at
  // once can't land on the same sort_order and render in an arbitrary order.
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ maxOrder: max(taskChecklistItems.sortOrder) })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId));
    const nextOrder = (row?.maxOrder ?? -1) + 1;

    await tx.insert(taskChecklistItems).values({
      taskId,
      content: text,
      sortOrder: nextOrder,
      createdById: me.id,
    });
    await tx.insert(taskEvents).values({
      taskId,
      actorId: me.id,
      eventType: "checklist_updated",
      toValue: { action: "added", content: text },
    });
  });

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

/**
 * Tick or un-tick a step.
 *
 * `doneById` / `doneAt` are cleared on un-tick, so the pair never describes
 * someone who no longer stands behind it.
 */
export async function toggleChecklistItem(
  taskId: string,
  itemId: string,
  done: boolean,
): Promise<ChecklistResult> {
  if (!UUID_RE.test(itemId)) {
    return { ok: false, error: "invalid", message: "Bad item id" };
  }
  const loaded = await loadTaskForActor(taskId);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error, message: loaded.message };
  }
  const { me } = loaded;

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(taskChecklistItems)
      .set({
        done,
        doneById: done ? me.id : null,
        doneAt: done ? now : null,
        updatedAt: now,
      })
      // Scoped by taskId as well as id: an item id from another task must not
      // be editable just because the caller can see this one.
      .where(
        and(
          eq(taskChecklistItems.id, itemId),
          eq(taskChecklistItems.taskId, taskId),
        ),
      )
      .returning({ content: taskChecklistItems.content });
    if (rows.length === 0) return null;

    await tx.insert(taskEvents).values({
      taskId,
      actorId: me.id,
      eventType: "checklist_updated",
      toValue: {
        action: done ? "checked" : "unchecked",
        content: rows[0]?.content ?? null,
      },
    });
    return rows[0];
  });
  if (!updated) return { ok: false, error: "not-found" };

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

/** Remove a step. Hard delete — a checklist line has no history worth keeping,
 *  and the audit event records that it went. */
export async function deleteChecklistItem(
  taskId: string,
  itemId: string,
): Promise<ChecklistResult> {
  if (!UUID_RE.test(itemId)) {
    return { ok: false, error: "invalid", message: "Bad item id" };
  }
  const loaded = await loadTaskForActor(taskId);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error, message: loaded.message };
  }
  const { me } = loaded;

  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(taskChecklistItems)
      .where(
        and(
          eq(taskChecklistItems.id, itemId),
          eq(taskChecklistItems.taskId, taskId),
        ),
      )
      .returning({ content: taskChecklistItems.content });
    if (rows.length === 0) return null;
    await tx.insert(taskEvents).values({
      taskId,
      actorId: me.id,
      eventType: "checklist_updated",
      fromValue: { content: rows[0]?.content ?? null },
      toValue: { action: "removed" },
    });
    return rows[0];
  });
  if (!removed) return { ok: false, error: "not-found" };

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

/** Every step on a task, in order. */
export async function listChecklistItems(
  taskId: string,
): Promise<ChecklistItemRow[]> {
  if (!UUID_RE.test(taskId)) return [];
  const rows = await db
    .select({
      id: taskChecklistItems.id,
      content: taskChecklistItems.content,
      done: taskChecklistItems.done,
      doneById: taskChecklistItems.doneById,
      doneAt: taskChecklistItems.doneAt,
      sortOrder: taskChecklistItems.sortOrder,
    })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.id));

  return rows.map((r) => ({
    ...r,
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
  }));
}
