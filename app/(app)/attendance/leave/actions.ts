"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leaveRequests, leaveApprovers, employees, employeeEvents } from "@/db/schema";
import type { NotificationKind } from "@/db/schema";
import { LEAVE_KIND_LABELS, LEAVE_TYPE_LABELS } from "@/db/enums";
import { requireAdmin, requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { notify } from "@/lib/notifications/dispatch";
import { daysInDateRange } from "@/lib/attendance/leave-cycle";
import { getDefaultLeaveApprover, getLeaveBalance, isLeaveApprover } from "@/lib/queries/leave";
import { checkCanDecide, inclusiveLeaveDays } from "@/lib/leave/workflow";
import { localDateString } from "@/lib/format";
import {
  ApplyForLeave,
  DecideLeave,
  AdminMarkLeave,
  CancelLeave,
  SetLeaveApprover,
} from "@/lib/validators/leave";

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const PATH = "/attendance/leave";

/** Today (YYYY-MM-DD) in IST — the org timezone the leave cycle is reckoned in. */
function todayISO(): string {
  return localDateString("Asia/Kolkata");
}

/**
 * Apply for leave — for YOURSELF only.
 *
 * Everything that matters is derived here, never read from the client: the
 * employee is the signed-in user, the approver is the configured default
 * (`leave_approvers`), the status starts 'pending', and the day count is the
 * inclusive calendar span (no Sundays/holidays taken out — that is attendance
 * and payroll policy, kept separate).
 *
 * The request row is the source of truth. The approver's notification is sent
 * after it is saved; if that fails the request still stands (it sits in the
 * approver's pending list) and the caller is told, rather than being told the
 * approver was notified when they were not.
 */
export async function applyForLeave(
  input: unknown,
): Promise<ActionResult<{ id: string; days: number; notified: boolean; routedTo: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = ApplyForLeave.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const days = inclusiveLeaveDays(parsed.data.startDate, parsed.data.endDate);
  if (days === null) return { ok: false, error: "Check the leave dates." };

  let approver;
  try {
    approver = await getDefaultLeaveApprover();
  } catch (err: unknown) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }
  // No default approver configured: the request is routed to the admins (they
  // see every pending request), exactly as it is for the approver's own request —
  // nobody can approve their own leave. Applying never depends on the setting.
  const approverId = approver && approver.employeeId !== me.id ? approver.employeeId : null;

  let inserted;
  try {
    [inserted] = await db
      .insert(leaveRequests)
      .values({
        employeeId: me.id,
        approverId,
        leaveType: parsed.data.leaveType,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        days: String(days),
        reason: parsed.data.reason,
      })
      .returning({ id: leaveRequests.id });
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return { ok: false, error: "You already have a pending request for these dates." };
    }
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!inserted) return { ok: false, error: "DB: insert returned no row" };

  try {
    await db.insert(employeeEvents).values({
      employeeId: me.id,
      actorId: me.id,
      eventType: "leave_requested",
      toValue: {
        leaveType: parsed.data.leaveType,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        days,
        approverId,
      },
    });
  } catch (err) {
    console.error("[leave] audit event failed", err);
  }

  let notified = false;
  if (approverId) {
    try {
      await notify({
        userId: approverId,
        kind: "attendance_device" as NotificationKind,
        title: `Leave request from ${me.name}`,
        body: `${parsed.data.startDate} → ${parsed.data.endDate} (${days} day${days === 1 ? "" : "s"}, ${LEAVE_TYPE_LABELS[parsed.data.leaveType]}) · ${parsed.data.reason}`,
        actorId: me.id,
      });
      notified = true;
    } catch (err) {
      console.error("[leave] approver notification failed", err);
    }
  }

  revalidatePath(PATH);
  return {
    ok: true,
    id: inserted.id,
    days,
    notified,
    routedTo: approverId && approver ? approver.name : "the admins",
  };
}

/**
 * A verdict on a pending leave request.
 *
 * Authorised on the server: only a listed approver or an admin, never the
 * requester, and only while the request is still pending — the update itself is
 * conditional on 'pending', so two people deciding at once cannot both win.
 * Rejecting needs a reason. On approving a PAID leave we re-validate the balance
 * (a request filed on the Apply-for-Leave form carries no pay kind and is not
 * counted against the allowance).
 */
export async function decideLeave(input: {
  id: string;
  verdict: "approved" | "rejected";
  note?: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = DecideLeave.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await db.query.leaveRequests.findFirst({
    where: eq(leaveRequests.id, parsed.data.id),
  });
  if (!existing) return { ok: false, error: "Leave request not found" };

  const allowed = checkCanDecide({
    deciderId: me.id,
    deciderIsAdmin: me.isAdmin,
    deciderIsListedApprover: me.isAdmin ? false : await isLeaveApprover(me.id),
    requestEmployeeId: existing.employeeId,
    requestStatus: existing.status,
  });
  if (!allowed.ok) return allowed;

  // Concurrency guard: re-check paid balance at approval time.
  if (parsed.data.verdict === "approved" && existing.kind === "paid") {
    const bal = await getLeaveBalance(existing.employeeId, todayISO());
    const reqDays = Number(existing.days);
    if (bal.remaining < reqDays) {
      return {
        ok: false,
        error: `Approving would exceed the employee's paid balance (${bal.remaining} left, request is ${reqDays}).`,
      };
    }
  }

  let won;
  try {
    won = await db
      .update(leaveRequests)
      .set({
        status: parsed.data.verdict,
        decidedById: me.id,
        decidedAt: new Date(),
        decisionNote: parsed.data.note ? parsed.data.note : null,
      })
      .where(and(eq(leaveRequests.id, parsed.data.id), eq(leaveRequests.status, "pending")))
      .returning({ id: leaveRequests.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }
  if (won.length === 0) {
    return { ok: false, error: "This request was already decided or cancelled." };
  }

  await db.insert(employeeEvents).values({
    employeeId: existing.employeeId,
    actorId: me.id,
    eventType: `leave_${parsed.data.verdict}`,
    fromValue: { status: existing.status },
    toValue: {
      status: parsed.data.verdict,
      kind: existing.kind,
      leaveType: existing.leaveType,
      startDate: existing.startDate,
      endDate: existing.endDate,
    },
    note: parsed.data.note ?? null,
  });

  const label = existing.leaveType
    ? `${LEAVE_TYPE_LABELS[existing.leaveType]} leave`
    : existing.kind
      ? LEAVE_KIND_LABELS[existing.kind]
      : "Leave";
  // Inbox-only notification to the employee. `attendance_device` routes to the
  // inbox-only arm (no email template), keeping leave decisions noise-free.
  try {
    await notify({
      userId: existing.employeeId,
      kind: "attendance_device" as NotificationKind,
      title: `${label} ${parsed.data.verdict === "approved" ? "approved" : "rejected"}`,
      body: `${existing.startDate} → ${existing.endDate} (${Number(existing.days)} day${Number(existing.days) === 1 ? "" : "s"})${parsed.data.note ? ` · ${parsed.data.note}` : ""}`,
      actorId: me.id,
    });
  } catch (err) {
    // The decision is saved; the employee still sees it in their history.
    console.error("[leave] decision notification failed", err);
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Admin: who may decide leave, and which of them new requests go to. Replaces
 * the default atomically (there can be only one).
 */
export async function setLeaveApprover(input: {
  employeeId: string;
  action: "make_default" | "add" | "remove";
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SetLeaveApprover.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { employeeId, action } = parsed.data;

  try {
    if (action === "remove") {
      await db.delete(leaveApprovers).where(eq(leaveApprovers.employeeId, employeeId));
    } else {
      const emp = await db.query.employees.findFirst({
        where: eq(employees.id, employeeId),
        columns: { isActive: true },
      });
      if (!emp?.isActive) return { ok: false, error: "Choose an active employee." };

      if (action === "add") {
        await db
          .insert(leaveApprovers)
          .values({ employeeId, createdById: me.id })
          .onConflictDoNothing();
      } else {
        await db.transaction(async (tx) => {
          await tx.update(leaveApprovers).set({ isDefault: false }).where(eq(leaveApprovers.isDefault, true));
          await tx
            .insert(leaveApprovers)
            .values({ employeeId, isDefault: true, createdById: me.id })
            .onConflictDoUpdate({ target: leaveApprovers.employeeId, set: { isDefault: true } });
        });
      }
    }
  } catch (err: unknown) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Admin records an already-approved leave directly for an employee. Paid
 * leaves still validate against the employee's remaining balance.
 */
export async function adminMarkLeave(input: {
  employeeId: string;
  kind: "paid" | "unpaid";
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = AdminMarkLeave.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const days = daysInDateRange(parsed.data.startDate, parsed.data.endDate);

  if (parsed.data.kind === "paid") {
    const bal = await getLeaveBalance(parsed.data.employeeId, todayISO());
    if (bal.remaining < days) {
      return {
        ok: false,
        error: `Exceeds the employee's ${bal.allowance} paid leaves for this cycle (${bal.remaining} left).`,
      };
    }
  }

  let inserted;
  try {
    [inserted] = await db
      .insert(leaveRequests)
      .values({
        employeeId: parsed.data.employeeId,
        kind: parsed.data.kind,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        days: String(days),
        reason: parsed.data.reason ? parsed.data.reason : null,
        status: "approved",
        decidedById: me.id,
        decidedAt: new Date(),
      })
      .returning({ id: leaveRequests.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }
  if (!inserted) return { ok: false, error: "DB: insert returned no row" };

  await db.insert(employeeEvents).values({
    employeeId: parsed.data.employeeId,
    actorId: me.id,
    eventType: "leave_admin_marked",
    toValue: {
      kind: parsed.data.kind,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      days,
    },
  });

  revalidatePath(PATH);
  return { ok: true, id: inserted.id };
}

/**
 * Cancel a leave request. An employee may cancel their OWN PENDING request;
 * an admin may cancel any request in any state.
 */
export async function cancelLeave(input: {
  id: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = CancelLeave.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await db.query.leaveRequests.findFirst({
    where: eq(leaveRequests.id, parsed.data.id),
  });
  if (!existing) return { ok: false, error: "Leave request not found" };

  if (!me.isAdmin) {
    if (existing.employeeId !== me.id) {
      return { ok: false, error: "You can only cancel your own requests." };
    }
    if (existing.status !== "pending") {
      return { ok: false, error: "Only pending requests can be cancelled." };
    }
  }

  try {
    await db
      .update(leaveRequests)
      .set({ status: "cancelled", decidedById: me.id, decidedAt: new Date() })
      .where(eq(leaveRequests.id, parsed.data.id));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }

  await db.insert(employeeEvents).values({
    employeeId: existing.employeeId,
    actorId: me.id,
    eventType: "leave_cancelled",
    fromValue: { status: existing.status },
  });

  revalidatePath(PATH);
  return { ok: true };
}
