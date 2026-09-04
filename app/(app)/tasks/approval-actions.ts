"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { db, tasks } from "@/lib/db";
import { employees, taskEvents } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { optimisticLockMatches, taskLabel } from "@/lib/tasks/set-status";
import { archiveIfApproved } from "@/lib/tasks/auto-archive";
import { notifyManyForTask } from "@/lib/notifications/dispatch";
import {
  canSignOff,
  levelAfterDecision,
  SIGN_OFF_BLOCK_MESSAGES,
} from "@/lib/tasks/approval-levels";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DecideApprovalSchema = z.object({
  decision: z.enum(["approved", "not_approved"]),
  note: z.string().trim().max(2000).optional(),
});
export type DecideApprovalInput = z.input<typeof DecideApprovalSchema>;

export type DecideApprovalResult =
  | { ok: true; level: "none" | "manager" | "admin"; stage: "manager" | "admin" }
  | {
      ok: false;
      error: "invalid" | "not-found" | "forbidden" | "stale";
      message?: string;
    };

/**
 * Rule on finished work, and move it one rung up the two-stage ladder.
 *
 * The manager's verdict and the sign-off stage are different columns and this
 * is the only action that writes both together:
 *
 *   approval_status — approved / not_approved (the verdict)
 *   approval_level  — none → manager → admin  (how far it has travelled)
 *
 * Who may grant which stage is decided entirely by `canSignOff` in
 * lib/tasks/approval-levels.ts — the same pure function the detail page calls
 * to decide whether to render the button, so the UI and the server can never
 * disagree about who may approve what. Final sign-off is the founder's alone.
 *
 * The legacy single-stage columns (approved_by_id / approved_at /
 * approval_note) are still written on every decision, exactly as `approveTask`
 * writes them, so every existing screen that reads them keeps working
 * unchanged. This action adds a stage; it does not replace the old flow.
 */
export async function decideTaskApproval(
  taskId: string,
  input: DecideApprovalInput,
  expectedUpdatedAt: string,
): Promise<DecideApprovalResult> {
  if (!UUID_RE.test(taskId)) {
    return { ok: false, error: "invalid", message: "Bad task id" };
  }

  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { ok: false, error: "invalid", message: limited.error };

  let parsed: z.output<typeof DecideApprovalSchema>;
  try {
    parsed = DecideApprovalSchema.parse(input);
  } catch (err) {
    return {
      ok: false,
      error: "invalid",
      message: err instanceof Error ? err.message : "Invalid input",
    };
  }

  const current = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!current) return { ok: false, error: "not-found" };

  // Permission is re-derived from the DB, never taken from the client: the
  // direct-manager link is resolved here, exactly as `approveTask` does it.
  let isDoersManager = false;
  if (current.doerId) {
    const doer = await db.query.employees.findFirst({
      where: eq(employees.id, current.doerId),
      columns: { managerId: true },
    });
    isDoersManager = !!doer?.managerId && doer.managerId === me.id;
  }

  const decision = canSignOff(
    {
      doerId: current.doerId,
      initiatorId: current.initiatorId,
      status: current.status,
      approvalStatus: current.approvalStatus,
      approvalLevel: current.approvalLevel,
    },
    {
      id: me.id,
      isAdmin: me.isAdmin,
      isSuperAdmin: isSuperAdmin(me.email),
      isDoersManager,
    },
  );
  if (!decision.allowed) {
    return {
      ok: false,
      error: "forbidden",
      message: SIGN_OFF_BLOCK_MESSAGES[decision.reason],
    };
  }
  const { stage } = decision;

  const expectedDate = new Date(expectedUpdatedAt);
  if (Number.isNaN(expectedDate.getTime())) {
    return { ok: false, error: "invalid", message: "Bad expectedUpdatedAt" };
  }

  const nextLevel = levelAfterDecision(
    current.approvalLevel,
    parsed.decision,
    stage,
  );
  const note = parsed.note?.trim() || null;
  const now = new Date();

  // Atomic: the task UPDATE and its audit event commit or roll back together.
  // Notification and auto-archive run afterwards, outside the txn, so neither
  // holds the row lock.
  const stale = await db.transaction(async (tx) => {
    const updated = await tx
      .update(tasks)
      .set({
        approvalStatus: parsed.decision,
        approvalLevel: nextLevel,
        // The legacy trio — who pressed the button, whatever the stage.
        approvedById: me.id,
        approvedAt: now,
        approvalNote: note,
        // Stage-specific columns, so "who accepted it" and "who signed it
        // off" stay separately answerable.
        ...(stage === "manager"
          ? {
              managerApprovedById: me.id,
              managerApprovedAt: now,
              managerApprovalNote: note,
            }
          : {
              adminApprovedById: me.id,
              adminApprovedAt: now,
              adminApprovalNote: note,
            }),
        // Mirror `approveTask`: stage one moves `status` onto the verdict so
        // every existing list, board and count behaves exactly as before.
        // Stage two leaves it alone — the founder is signing off work that is
        // already marked approved, and re-writing it would emit a pointless
        // second status change on the timeline.
        ...(stage === "manager" ? { status: parsed.decision } : {}),
        updatedAt: now,
      })
      .where(and(eq(tasks.id, taskId), optimisticLockMatches(expectedDate)))
      .returning({ id: tasks.id });
    if (updated.length === 0) return true;

    await tx.insert(taskEvents).values({
      taskId,
      actorId: me.id,
      eventType: "approval_decided",
      fromValue: {
        approvalStatus: current.approvalStatus,
        approvalLevel: current.approvalLevel,
      },
      toValue: { approvalStatus: parsed.decision, approvalLevel: nextLevel, stage },
      note,
    });
    return false;
  });
  if (stale) return { ok: false, error: "stale" };

  const label = taskLabel({ subject: current.subject, title: current.title });
  const verb =
    parsed.decision === "not_approved"
      ? "declined"
      : stage === "admin"
        ? "gave final sign-off on"
        : "approved";
  await notifyManyForTask(taskId, {
    actorId: me.id,
    kind: "status_changed",
    title: `${me.name} ${verb} '${label}'`,
    body: JSON.stringify({
      approvalStatus: parsed.decision,
      approvalLevel: nextLevel,
      stage,
      ...(note ? { note } : {}),
    }),
    recipients: [current.createdById, current.initiatorId, current.doerId],
  });

  // Same rule the rest of the module already follows: approving archives
  // immediately when the org setting is on. Only on the stage that actually
  // moves the task into "approved" — the founder's countersignature must not
  // re-archive something already filed away.
  if (parsed.decision === "approved" && stage === "manager") {
    await archiveIfApproved(taskId);
  }

  revalidatePath("/tasks");
  revalidatePath("/archived");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/");
  updateTag(CACHE_TAGS.tasks);

  return { ok: true, level: nextLevel, stage };
}
