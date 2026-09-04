"use server";

import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import {
  getRunningTimer,
  startTaskTimer,
  stopTaskTimer,
  type RunningTimer,
  type TimeResult,
} from "@/lib/tasks/time-store";

/**
 * Web wrappers around the shared time-tracking core.
 *
 * Same split as `setTaskStatus` / the mobile status route: the rules and the
 * SQL live in lib/tasks/time-store.ts, and these thin actions own only the
 * things that are specific to the web transport — cookie auth, rate limiting
 * and cache revalidation. The mobile API can call the same core and cannot
 * drift from what the browser does.
 */

/** Start the clock on a task. Starting elsewhere stops whatever was running. */
export async function startTimer(
  taskId: string,
): Promise<TimeResult<{ sessionId: string; startedAt: string; stoppedTaskId?: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { ok: false, error: "invalid", message: limited.error };

  const result = await startTaskTimer(
    { id: me.id, name: me.name, isAdmin: me.isAdmin },
    taskId,
    "web",
  );
  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    // A timer that was auto-stopped elsewhere changes that task's panel too.
    if (result.stoppedTaskId) revalidatePath(`/tasks/${result.stoppedTaskId}`);
    updateTag(CACHE_TAGS.tasks);
  }
  return result;
}

/** Stop this person's timer on a task and bank the elapsed time. */
export async function stopTimer(
  taskId: string,
): Promise<TimeResult<{ durationSeconds: number; totalSeconds: number }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { ok: false, error: "invalid", message: limited.error };

  const result = await stopTaskTimer(
    { id: me.id, name: me.name, isAdmin: me.isAdmin },
    taskId,
    "web",
  );
  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    updateTag(CACHE_TAGS.tasks);
  }
  return result;
}

/**
 * What this person currently has running, if anything.
 *
 * Read on mount by the list's timer column so a refresh — or a second tab —
 * picks the running timer back up instead of showing every button as idle.
 */
export async function getMyRunningTimer(): Promise<RunningTimer | null> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "read");
  if (limited) return null;
  return getRunningTimer(me.id);
}
