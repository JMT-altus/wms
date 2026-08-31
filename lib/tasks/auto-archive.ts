import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getOrgSettings } from "@/lib/queries/org-settings";

/**
 * Move approved tasks to the Archive.
 *
 * ── The rule ──
 *
 * Approval is the ONLY trigger, and it is immediate — there is no waiting
 * period. A task's created and due dates play no part: an approved task
 * archives whether it was approved inside its due date or long after, and a
 * task that is NOT approved never archives however old or overdue it gets.
 * `due_at` and `created_at` appear nowhere in the predicate below.
 *
 * One setting, `auto_archive_approved_enabled`, is the on/off switch.
 *
 * ── Two ways this runs ──
 *
 * `archiveIfApproved` does the common case: the moment a task is approved, the
 * action that approved it archives the row in the same breath. That is what
 * makes the move feel instant rather than waiting for a nightly job.
 *
 * `autoArchiveApprovedTasks` is the backstop, run by the daily cron. It
 * catches anything approved while the setting was off, or through a path that
 * bypasses those actions — bulk import, a direct DB edit, or a status change
 * made before this feature existed.
 *
 * Both are idempotent: already-archived rows are excluded, so re-running
 * changes nothing.
 */export interface AutoArchiveResult {
  enabled: boolean;
  /** Rows moved to the Archive by this run. */
  archived: number;
  skipped: "disabled" | null;
}

export async function autoArchiveApprovedTasks(): Promise<AutoArchiveResult> {
  const settings = await getOrgSettings();
  if (settings.autoArchiveApprovedEnabled !== true) {
    return { enabled: false, archived: 0, skipped: "disabled" };
  }

  // Raw SQL rather than the query builder: the effective approval date is a
  // COALESCE over a column and a correlated subquery, which the builder can
  // only express as an opaque `sql` fragment anyway.
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE tasks t
       SET archived = true,
           updated_at = now()
     WHERE t.archived = false
       AND (t.approval_status = 'approved' OR t.status = 'approved')
    RETURNING t.id
  `);

  // postgres-js returns the rows array itself; drizzle's pg driver wraps them
  // in { rows }. Handle both so this doesn't depend on which is configured.
  const list = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows?: unknown[] }).rows ?? []);

  return { enabled: true, archived: list.length, skipped: null };
}

/**
 * Archive one task if it has just become approved and the setting is on.
 *
 * Called from the actions that approve a task, inside their own flow, so the
 * row lands in the Archive at the same moment the badge flips to Approved.
 * Never throws: archiving is a convenience on top of the approval, and a
 * failure here must not roll back the approval itself.
 */
export async function archiveIfApproved(taskId: string): Promise<boolean> {
  try {
    const settings = await getOrgSettings();
    if (settings.autoArchiveApprovedEnabled !== true) return false;

    const rows = await db.execute<{ id: string }>(sql`
      UPDATE tasks t
         SET archived = true,
             updated_at = now()
       WHERE t.id = ${taskId}
         AND t.archived = false
         AND (t.approval_status = 'approved' OR t.status = 'approved')
      RETURNING t.id
    `);
    const list = Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows?: unknown[] }).rows ?? []);
    return list.length > 0;
  } catch (err) {
    console.error("[archiveIfApproved] failed", { taskId, err });
    return false;
  }
}
