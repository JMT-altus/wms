"use server";

import { and, eq, isNull } from "drizzle-orm";
import { updateTag } from "next/cache";
import { db, tasks, taskEvents } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * Mark a task as read (read-receipt) the first time anyone opens its detail
 * page. Sets first_read_at only when currently NULL, so repeat opens are a
 * cheap no-op. Best-effort: never throws to the caller — the detail page calls
 * this fire-and-forget and must not be blocked or errored by it.
 *
 * Lives in its own file (not tasks/actions.ts) to stay isolated and avoid
 * churn in that large module.
 */
export async function markTaskRead(taskId: string): Promise<void> {
  try {
    await requireUser();
    await db
      .update(tasks)
      .set({ firstReadAt: new Date() })
      .where(and(eq(tasks.id, taskId), isNull(tasks.firstReadAt)));
    updateTag(CACHE_TAGS.tasks);
  } catch (err) {
    console.warn("[markTaskRead] non-fatal:", (err as Error)?.message ?? err);
  }
}

/**
 * Auto-advance "Not Seen" → "Not Started" when the assignee opens their own
 * task. "Not Seen" (`dont_know`) exists to tell an initiator that nobody has
 * looked yet; the moment the doer opens it that's no longer true, so making
 * them tick it off by hand is busywork.
 *
 * Narrow by design — the WHERE clause is the whole guard, and it makes the
 * update atomic and idempotent (a second open matches nothing):
 *   - only the DOER's own visit counts. An initiator or admin peeking at the
 *     task must leave it "Not Seen", or the signal is worthless.
 *   - only from `dont_know`. Never touches a task already in flight.
 *   - never on an archived task.
 *
 * Notifications are deliberately NOT fired: this is a side-effect of reading,
 * not a decision the doer made, and pushing "X changed status" for every task
 * opened would bury the notifications that matter. The task_events row still
 * records it (with a note) so the audit trail is complete.
 *
 * Best-effort like markTaskRead: a failure here must never break the page.
 * Returns true if this call was the one that flipped it.
 */
export async function markTaskSeenByDoer(taskId: string): Promise<boolean> {
  try {
    const me = await requireUser();

    const changed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({ status: "not_started", updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.doerId, me.id),
            eq(tasks.status, "dont_know"),
            eq(tasks.archived, false),
          ),
        )
        .returning({ id: tasks.id });
      if (updated.length === 0) return false;

      await tx.insert(taskEvents).values({
        taskId,
        actorId: me.id,
        eventType: "status_changed",
        fromValue: { status: "dont_know" },
        toValue: { status: "not_started" },
        note: "Auto: doer opened the task",
      });
      return true;
    });

    if (changed) updateTag(CACHE_TAGS.tasks);
    return changed;
  } catch (err) {
    console.warn("[markTaskSeenByDoer] non-fatal:", (err as Error)?.message ?? err);
    return false;
  }
}
