"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { collectionWeeklyUploadSettings, settingsEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { isMissingTable } from "@/lib/queries/collection-master";
import { readWeeklyUploadSettings, weeklyUploadStore } from "@/lib/queries/collection-weekly-upload";
import { ASSIGNEE_PROBLEM_TEXT, assigneeProblem } from "@/lib/collections/weekly-upload/service";
import { ensureCurrentWeeklyTask, reassignOpenWeeklyTasks } from "@/lib/collections/weekly-upload/server";
import { WEEKLY_UPLOAD_SETTINGS_SCOPE } from "@/lib/collections/weekly-upload/week";

/**
 * Admin & Master Setup → Weekly Bulk Upload: who is responsible for the weekly
 * Collection Tracker Bulk Upload, and on which weekday it is due.
 *
 * Admin-only (the Master Setup area's own gate, checked again here from the
 * signed session). The chosen employee must be able to actually do it: active,
 * an admin (the Forms area is admin-only) and holding the "Collection Tracker —
 * Bulk Upload" permission — which this setting never grants; a super-admin
 * grants it in Field Permissions. Nothing is ever assigned by code: an empty
 * setting means no task is created and the page says so.
 *
 * Every change is audited in settings_events in the same transaction. When the
 * employee changes, the open week's task moves to them at once (with its own
 * audit row and notification) and the current week's task is created if it
 * doesn't exist yet, so the effect is visible immediately rather than at the
 * next scheduler run.
 */

const Input = z
  .object({
    assigneeId: z.string().uuid("Choose an employee.").nullable(),
    dueDow: z.number().int().min(1).max(7),
  })
  .strict();

export type SaveResult = { ok: true; changed: boolean; taskCreated: boolean; reassigned: number } | { ok: false; error: string };

const NOT_READY = "The weekly Bulk Upload task isn't set up on this database yet (database update 0121 is needed), so nothing was saved.";
const PAGE = "/master-setup/collection-weekly-upload";

export async function saveWeeklyUploadSettings(raw: unknown): Promise<SaveResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { assigneeId, dueDow } = parsed.data;

  const current = await readWeeklyUploadSettings();
  if (!current.storageReady) return { ok: false, error: NOT_READY };
  if (assigneeId) {
    const problem = await assigneeProblem(assigneeId, weeklyUploadStore);
    if (problem) return { ok: false, error: ASSIGNEE_PROBLEM_TEXT[problem] };
  }
  const changed = current.assigneeId !== assigneeId || current.dueDow !== dueDow;
  if (!changed) return { ok: true, changed: false, taskCreated: false, reassigned: 0 };

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(collectionWeeklyUploadSettings)
        .values({ id: 1, assigneeId, dueDow, setById: me.id, updatedAt: new Date() })
        .onConflictDoUpdate({ target: collectionWeeklyUploadSettings.id, set: { assigneeId, dueDow, setById: me.id, updatedAt: new Date() } });
      await tx.insert(settingsEvents).values({
        scope: WEEKLY_UPLOAD_SETTINGS_SCOPE,
        targetId: assigneeId,
        actorId: me.id,
        eventType: "updated",
        fromValue: { assigneeId: current.assigneeId, dueDow: current.dueDow },
        toValue: { assigneeId, dueDow },
        note: assigneeId ? "Responsible employee for the weekly Collection Tracker Bulk Upload set" : "Responsible employee for the weekly Collection Tracker Bulk Upload cleared",
      });
    });
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_READY };
    console.error("[collection-weekly-upload] settings save failed", err);
    return { ok: false, error: "The setting could not be saved, so nothing was changed. Please try again." };
  }

  // Follow-through: open weeks move to the new person; this week's task exists.
  // Both are safe to repeat and neither can undo the saved setting.
  let reassigned = 0;
  let taskCreated = false;
  if (assigneeId) {
    try {
      if (current.assigneeId !== assigneeId) reassigned = (await reassignOpenWeeklyTasks(assigneeId, me.id)).reassigned;
      taskCreated = (await ensureCurrentWeeklyTask()).status === "created";
    } catch (err) {
      console.error("[collection-weekly-upload] follow-through after settings save failed; the daily sweep will catch up", err);
    }
  }
  revalidatePath(PAGE);
  revalidatePath("/master-setup");
  revalidatePath("/tasks");
  return { ok: true, changed: true, taskCreated, reassigned };
}
