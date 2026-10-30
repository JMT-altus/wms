import "server-only";
import { notify } from "@/lib/notifications/dispatch";
import { siteUrl } from "@/lib/site-url";
import { weeklyTaskIdsAmong, weeklyUploadStore } from "@/lib/queries/collection-weekly-upload";
import {
  completeWeeklyUploadForSnapshot,
  ensureWeeklyTask,
  isCompulsoryWeeklyTask,
  PROTECTED_TASK_MESSAGE,
  runWeeklyUploadSweep,
  syncOpenWeeksToAssignee,
  type CompleteResult,
  type EnsureResult,
  type SnapshotRef,
  type SweepStats,
  type WeeklyUploadDeps,
} from "@/lib/collections/weekly-upload/service";

/** The service wired to the database and the notification inbox. */
export const weeklyUploadDeps: WeeklyUploadDeps = { store: weeklyUploadStore, notify, siteUrl };

/** The daily cron. */
export const sweepWeeklyUpload = (now: Date = new Date()): Promise<SweepStats> => runWeeklyUploadSweep(now, weeklyUploadDeps);

/**
 * Called by the Bulk Upload import AFTER its transaction committed. Never throws
 * and never fails the upload: if the completion step fails, the daily sweep
 * completes the week from the snapshot on its next run.
 */
export async function completeWeeklyUploadAfterImport(snapshot: SnapshotRef): Promise<CompleteResult | { status: "error" }> {
  try {
    return await completeWeeklyUploadForSnapshot(snapshot, weeklyUploadDeps);
  } catch (err) {
    console.error("[collection-weekly-upload] could not complete the weekly task after an import; the daily sweep will retry", {
      snapshotId: snapshot.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "error" };
  }
}

/** After the responsible employee changes: open weeks follow. */
export const reassignOpenWeeklyTasks = (assigneeId: string, actorId: string, now: Date = new Date()) =>
  syncOpenWeeksToAssignee(assigneeId, actorId, now, weeklyUploadDeps);

/**
 * The Tasks module's guard: a week's compulsory task can't be closed, moved,
 * archived or deleted by hand. Missing storage (migration 0121 not applied)
 * means no task is protected; any other read failure propagates, so a broken
 * read can never quietly let a bypass through.
 */
export const isProtectedWeeklyTask = (taskId: string): Promise<boolean> => isCompulsoryWeeklyTask(taskId, weeklyUploadStore);

/** The same guard for a bulk action: which of `taskIds` are protected. */
export const protectedWeeklyTaskIds = (taskIds: readonly string[]): Promise<Set<string>> => weeklyTaskIdsAmong(taskIds);

/** Create the current week's task now (after an administrator configures the assignee). */
export const ensureCurrentWeeklyTask = (now: Date = new Date()): Promise<EnsureResult> => ensureWeeklyTask(now, weeklyUploadDeps);

export { PROTECTED_TASK_MESSAGE };
