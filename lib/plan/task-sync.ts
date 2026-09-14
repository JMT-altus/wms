import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectNodes, tasks } from "@/db/schema";
import { hasTask } from "@/lib/plan/levels";

/**
 * The PROJECT a plan row sits under — the root of its branch, and the client
 * that project is for.
 *
 * This is what a plan-made task files itself under as its Client. A task list
 * asking "which client is this for?" about an Action is really asking about
 * the engagement it belongs to, and the row's own name already answers "what
 * is it?" in the Task column — all three columns used to show one string.
 *
 * The CLIENT NAME is the better answer when the project carries one: "Altus
 * Corp" is who the work is for, where "AICL WMS" is only what the project is
 * called. It is asked for on the project and nowhere else, so every task in
 * the branch agrees about it by construction.
 *
 * Walked one level at a time and bounded by the six the tree can have, with a
 * `seen` guard so a corrupted parent cycle stops rather than looping forever
 * — the same shape as `ownerChain` in `lib/plan/actor.ts`.
 *
 * Falls back to the topmost row when no ancestor is actually of kind
 * `project`: an orphaned branch still has a head, and naming it beats naming
 * nothing.
 */
export async function rootProject(
  nodeId: string,
): Promise<{ name: string; clientName: string | null } | null> {
  const seen = new Set<string>();
  let current = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, nodeId),
    columns: { id: true, name: true, kind: true, parentId: true, clientName: true },
  });
  let topmost: { name: string; clientName: string | null } | null = null;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === "project") {
      return { name: current.name, clientName: current.clientName ?? null };
    }
    // Overwritten every rung, so what survives the loop is the HIGHEST row
    // reached — the head of the branch. `??=` would have kept the row we
    // started from, which is the one answer that is never the fallback.
    topmost = { name: current.name, clientName: current.clientName ?? null };
    if (!current.parentId) break;
    current = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, current.parentId),
      columns: { id: true, name: true, kind: true, parentId: true, clientName: true },
    });
  }
  return topmost;
}

/**
 * The RETURN LEG of the plan ↔ task link.
 *
 * `syncNodeTask` (in the plan's actions) pushes a plan row's fields onto the
 * task it owns. This pushes them back: edit the task's dates, its doer, its
 * subject or its description and the plan row it came from says the same
 * thing, instead of quietly keeping whatever it was created with.
 *
 * Without this the two halves drift in one direction only. A due date moved
 * on the task showed the OLD date in the register, and the next edit of any
 * field on the plan row pushed that stale date straight back onto the task —
 * so a reschedule made from the task list could be silently undone by someone
 * renaming the row.
 *
 * ── The loop question ────────────────────────────────────────────────────
 * This NEVER calls `syncNodeTask`, and `syncNodeTask` never calls this. Each
 * leg writes the other side's table directly and stops. The two are wired to
 * different entry points — plan writes call one, task writes call the other —
 * so a round trip is not possible however either is edited.
 *
 * ── What is deliberately NOT mirrored ────────────────────────────────────
 * Status, priority and notes. An executable plan row reports those FROM its
 * task by design (`isExecutable`), so the plan has no copy to correct; the
 * plan's own `status` column describes CONTAINER rows only and a task must
 * never write it.
 *
 * NEVER THROWS. The task edit is committed by the time this runs; a plan
 * hiccup must not roll it back or fail the caller's action.
 */
export async function mirrorTaskToNode(taskId: string): Promise<void> {
  try {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: {
        id: true,
        projectNodeId: true,
        archived: true,
        title: true,
        description: true,
        subject: true,
        dueAt: true,
        startsAt: true,
        endsAt: true,
        estimatedMinutes: true,
        tags: true,
        doerId: true,
        initiatorId: true,
      },
    });
    if (!task?.projectNodeId || task.archived) return;

    const node = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, task.projectNodeId),
      columns: { id: true, kind: true, isArchived: true },
    });
    if (!node || node.isArchived || !hasTask(node.kind)) return;

    /**
     * The task's TITLE is the plan row's name, one to one — `syncNodeTask`
     * sends it out that way, so it comes back the same way.
     *
     * `tasks.client` is deliberately NOT mirrored back. It is DERIVED on the
     * plan side, from the project the row sits under (`rootProjectName`), and
     * writing a derived value into the row's `clientName` intake column would
     * freeze today's project name into a row that then stops following it.
     * The plan owns that column; the task displays it.
     */
    await db
      .update(projectNodes)
      .set({
        name: task.title,
        description: task.description ?? null,
        subject: task.subject ?? null,
        targetDate: task.dueAt ?? null,
        startsAt: task.startsAt ?? null,
        endsAt: task.endsAt ?? null,
        durationMinutes: task.estimatedMinutes ?? null,
        tags: task.tags?.length ? task.tags : null,
        // The task is where the work actually sits, so its doer is the row's
        // owner. `reassignDoer` on the plan side writes the same pair.
        ownerId: task.doerId ?? null,
        initiatorId: task.initiatorId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(projectNodes.id, node.id));
  } catch (err) {
    console.warn(
      "[plan] mirrorTaskToNode failed (non-fatal)",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * The same leg for a bulk task action.
 *
 * One query first to find WHICH of the swept ids actually hang off a plan
 * row, so a 500-task sweep of ordinary tasks costs a single statement instead
 * of 500 no-op round trips. The rest run one at a time — a sweep touches a
 * handful of linked rows at most, and one slow row must not abort the others.
 */
export async function mirrorTasksToNodes(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  let linked: { id: string }[];
  try {
    linked = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          inArray(tasks.id, taskIds),
          eq(tasks.archived, false),
          isNotNull(tasks.projectNodeId),
        ),
      );
  } catch {
    return;
  }
  for (const row of linked) await mirrorTaskToNode(row.id);
}
