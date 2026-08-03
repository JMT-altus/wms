import { afterResponse } from "@/lib/after";
import { db, tasks } from "@/lib/db";
import { taskEvents, taskAudience } from "@/db/schema";
import { notify } from "@/lib/notifications/dispatch";
import { reconcileTaskEvent } from "@/lib/google/sync";
import { deriveShortId, nextShortIdCandidate } from "@/lib/import/short-id";
import { CreateTaskSchema, type CreateTaskInput } from "@/lib/validators/task";
import type { Visibility } from "@/db/enums";
import { taskLabel } from "@/lib/tasks/set-status";

/**
 * Transport-agnostic core for creating one or more tasks (multi-doer fan-out).
 * Shared by the web Server Action `createTask` and the mobile create API so the
 * short-id derivation, default status, audit event, deferred notifications and
 * Google-Calendar sync stay identical. Auth/rate-limit/revalidate live in the
 * callers.
 */
export async function createTasksCore(
  actor: { id: string; name: string },
  input: CreateTaskInput,
): Promise<{ ok: true; id: string; ids: string[] } | { ok: false; error: string }> {
  let parsed;
  try {
    parsed = CreateTaskSchema.parse(input);
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid input" };
  }

  const doerIds = parsed.doerIds ?? (parsed.doerId ? [parsed.doerId] : []);
  if (doerIds.length === 0) return { ok: false, error: "At least one doer is required" };

  const createdIds: string[] = [];
  const notifyIntents: Array<Parameters<typeof notify>[0]> = [];
  const label = taskLabel({ subject: parsed.subject ?? null, title: parsed.title });

  for (const doerId of doerIds) {
    const taskId = crypto.randomUUID();
    let attempt = 0;
    let row: { id: string } | undefined;
    while (attempt < 23) {
      const shortId =
        attempt === 0 ? deriveShortId(taskId) : nextShortIdCandidate(taskId, attempt);
      if (!shortId) return { ok: false, error: "Could not derive short_id (uuid exhausted)" };
      try {
        [row] = await db
          .insert(tasks)
          .values({
            id: taskId,
            title: parsed.title,
            client: parsed.title,
            description: parsed.description,
            subject: parsed.subject,
            notes: parsed.notes,
            doerId,
            initiatorId: parsed.initiatorId,
            priority: parsed.priority,
            dueAt: parsed.dueAt,
            tags: parsed.tags ?? null,
            startsAt: parsed.startsAt ?? null,
            endsAt: parsed.endsAt ?? null,
            allDay: parsed.allDay ?? false,
            recurrence: parsed.recurrence ?? null,
            recurrenceRule: parsed.recurrenceRule ?? null,
            projectNodeId: parsed.projectNodeId ?? null,
            createdById: actor.id,
            visibility: parsed.visibility,
            shortId,
            status: "dont_know",
          })
          .returning({ id: tasks.id });
        break;
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string; message?: string };
        if (e?.code === "23505" && e?.constraint === "tasks_short_id_uidx") {
          attempt++;
          continue;
        }
        return { ok: false, error: `DB: ${e?.message ?? String(err)}` };
      }
    }
    if (!row) {
      return {
        ok: false,
        error:
          attempt >= 23
            ? "Could not allocate unique short_id after 23 attempts"
            : "Insert returned no row",
      };
    }

    // Audience rows only mean anything for a `restricted` task; the validator
    // already rejects `restricted` with an empty list, so this can't silently
    // create a task nobody but its participants can see.
    if (parsed.visibility === "restricted" && parsed.audience.length > 0) {
      try {
        await db.insert(taskAudience).values(
          parsed.audience.map((a) => ({
            taskId: row!.id,
            kind: a.kind,
            refId: a.kind === "management" ? null : a.refId,
          })),
        );
      } catch (err) {
        console.error("[createTasksCore] audience insert failed", err);
      }
    }

    try {
      await db.insert(taskEvents).values({
        taskId: row.id,
        actorId: actor.id,
        eventType: "created",
        toValue: {
          title: parsed.title,
          visibility: parsed.visibility,
          doerId,
          initiatorId: parsed.initiatorId,
          priority: parsed.priority,
          dueAt: parsed.dueAt.toISOString(),
          tags: parsed.tags ?? null,
        },
      });
    } catch (err) {
      console.warn("[createTask] created-event insert failed (non-fatal):", (err as Error)?.message ?? err);
    }

    if (doerId !== actor.id) {
      notifyIntents.push({
        userId: doerId,
        kind: "task_assigned",
        title: `${actor.name} assigned you '${label}'`,
        taskId: row.id,
        actorId: actor.id,
      });
    }
    if (parsed.initiatorId !== actor.id && parsed.initiatorId !== doerId) {
      notifyIntents.push({
        userId: parsed.initiatorId,
        kind: "task_initiated",
        title: `${actor.name} made you initiator on '${label}'`,
        taskId: row.id,
        actorId: actor.id,
      });
    }

    createdIds.push(row.id);
  }

  if (notifyIntents.length > 0) {
    afterResponse(async () => {
      for (const intent of notifyIntents) await notify(intent);
    });
  }
  for (const id of createdIds) afterResponse(() => reconcileTaskEvent(id));

  return { ok: true, id: createdIds[0]!, ids: createdIds };
}

/** How far out a quick-dumped task's placeholder due date is set (7 days).
 *  It's ownerless for now — the real due is set when Mihir assigns it. */
const QUICK_DUMP_DUE_MS = 7 * 24 * 60 * 60 * 1000;
/** Safety cap so one paste can't spawn a runaway batch. */
const QUICK_DUMP_MAX = 200;

/**
 * Create one or more UNASSIGNED tasks (no doer) from bare titles — the
 * "quick dump" pool. Mihir Veera / Altus Corp capture tasks here fast and
 * assign a doer later. Auth (allowlist) + rate-limit live in the caller.
 * Mirrors createTasksCore's short-id retry + created-event, minus the doer,
 * notifications and calendar sync (an ownerless task has none of those).
 */
export async function createUnassignedTasks(
  actor: { id: string; name: string },
  titles: string[],
  /**
   * Quick Dump is where the personal space actually gets used: capture a
   * thought fast, keep it to yourself. An ownerless PRIVATE task is visible to
   * its creator alone, which is exactly the "personal to-do" case.
   */
  visibility: Visibility = "internal",
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const clean = titles
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, QUICK_DUMP_MAX);
  if (clean.length === 0) return { ok: false, error: "Nothing to add." };

  const dueAt = new Date(Date.now() + QUICK_DUMP_DUE_MS);
  const ids: string[] = [];

  for (const raw of clean) {
    const title = raw.slice(0, 500);
    const taskId = crypto.randomUUID();
    let attempt = 0;
    let row: { id: string } | undefined;
    while (attempt < 23) {
      const shortId =
        attempt === 0 ? deriveShortId(taskId) : nextShortIdCandidate(taskId, attempt);
      if (!shortId) return { ok: false, error: "Could not derive short_id (uuid exhausted)" };
      try {
        [row] = await db
          .insert(tasks)
          .values({
            id: taskId,
            // The dump text is the task's TITLE (shown in the list's Task column
            // via title fallback, and editable later in the Complete panel).
            // Client + description are left blank; filled in on completion.
            title,
            client: null,
            doerId: null, // unassigned — the pool
            initiatorId: actor.id,
            createdById: actor.id,
            priority: "not_imp_not_urgent",
            dueAt,
            status: "dont_know",
            visibility,
            shortId,
          })
          .returning({ id: tasks.id });
        break;
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string; message?: string };
        if (e?.code === "23505" && e?.constraint === "tasks_short_id_uidx") {
          attempt++;
          continue;
        }
        return { ok: false, error: `DB: ${e?.message ?? String(err)}` };
      }
    }
    if (!row) {
      return {
        ok: false,
        error:
          attempt >= 23
            ? "Could not allocate unique short_id after 23 attempts"
            : "Insert returned no row",
      };
    }

    try {
      await db.insert(taskEvents).values({
        taskId: row.id,
        actorId: actor.id,
        eventType: "created",
        toValue: { title, doerId: null, unassigned: true },
      });
    } catch (err) {
      console.warn("[quickDump] created-event insert failed (non-fatal):", (err as Error)?.message ?? err);
    }

    ids.push(row.id);
  }

  return { ok: true, ids };
}
