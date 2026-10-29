"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { leaveRequests, leaveApprovers, employees, employeeEvents } from "@/db/schema";
import type { NotificationKind } from "@/db/schema";
import { LEAVE_KIND_LABELS, LEAVE_TYPE_LABELS } from "@/db/enums";
import { requireAdmin, requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { notify } from "@/lib/notifications/dispatch";
import { daysInDateRange } from "@/lib/attendance/leave-cycle";
import { getDefaultLeaveApprover, getLeaveBalance, listPendingRouting } from "@/lib/queries/leave";
import { getLeaveCapabilityProofs } from "@/lib/auth/capability";
import { checkCanDecide, inclusiveLeaveDays, requestsToReroute } from "@/lib/leave/workflow";
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
const APPROVALS_PATH = "/attendance/leave/approvals";
const APPROVER_ADMIN_PATH = "/admin/leave-approvers";

/** Today (YYYY-MM-DD) in IST — the org timezone the leave cycle is reckoned in. */
function todayISO(): string {
  return localDateString("Asia/Kolkata");
}

/**
 * A database failure, safely: the details (which can name tables, constraints
 * or connection settings) go to the server log only; the browser gets a plain
 * message that says nothing was changed.
 */
function dbFailure(where: string, err: unknown): { ok: false; error: string } {
  const code = (err as { code?: unknown } | null)?.code;
  console.error(`[leave] ${where} failed${typeof code === "string" ? ` (${code})` : ""}`, err);
  return { ok: false, error: "Something went wrong and nothing was changed. Please try again." };
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
    return dbFailure("reading the default approver", err);
  }
  // No default approver configured — or the default approver applying for
  // themselves (nobody can approve their own leave): the request is filed with
  // no approver. Only a reviewer holding the "Act on any request" override can
  // decide such a request. Applying never depends on the setting.
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
    return dbFailure("filing a leave request", err);
  }
  if (!inserted) return dbFailure("filing a leave request", new Error("insert returned no row"));

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
  revalidatePath(APPROVALS_PATH);
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
 * Authorised on the server from the permission matrix, never from the client or
 * from navigation: the caller must hold "Approve or reject" and the request must
 * be assigned to them (unless they also hold the explicit "Act on any request"
 * override), never the requester, and only while the request is still pending — the update itself is
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

  const caps = await getLeaveCapabilityProofs();
  const allowed = checkCanDecide({
    deciderId: me.id,
    canDecide: caps.decide !== null,
    canOverride: caps.override !== null,
    requestEmployeeId: existing.employeeId,
    requestStatus: existing.status,
    requestApproverId: existing.approverId,
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

  // The write re-asserts, atomically, everything the check above relied on: the
  // request is still pending, is still not the decider's own, and is still
  // assigned to the decider — or, for an override holder, still assigned to
  // whoever it was assigned to when checked. A request withdrawn, decided or
  // re-routed in between matches nothing, so nothing is written. The decision
  // and its audit row are committed together or not at all.
  const stillAssigned =
    caps.override !== null
      ? existing.approverId === null
        ? isNull(leaveRequests.approverId)
        : eq(leaveRequests.approverId, existing.approverId)
      : eq(leaveRequests.approverId, me.id);
  let won: { id: string }[];
  try {
    won = await db.transaction(async (tx) => {
      const rows = await tx
        .update(leaveRequests)
        .set({
          status: parsed.data.verdict,
          decidedById: me.id,
          decidedAt: new Date(),
          decisionNote: parsed.data.note ? parsed.data.note : null,
        })
        .where(
          and(
            eq(leaveRequests.id, parsed.data.id),
            eq(leaveRequests.status, "pending"),
            ne(leaveRequests.employeeId, me.id),
            stillAssigned,
          ),
        )
        .returning({ id: leaveRequests.id });
      if (rows.length === 0) return rows;
      await tx.insert(employeeEvents).values({
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
      return rows;
    });
  } catch (err: unknown) {
    return dbFailure("recording a leave decision", err);
  }
  if (won.length === 0) {
    return { ok: false, error: "This request was already decided, cancelled or re-routed. Reload to see its current state." };
  }

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
  revalidatePath(APPROVALS_PATH);
  return { ok: true };
}

/**
 * Admin: the leave-approver list used for ROUTING — which listed employee new
 * requests go to (the default; there can be only one, replaced atomically).
 * Being listed grants nothing: deciding needs the leave.approvals.*
 * permissions, granted in Field Permissions. Every change is audited
 * (employee_events "leave_approver_changed", before → after) in the same
 * transaction as the change itself.
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
    if (action !== "remove") {
      const emp = await db.query.employees.findFirst({
        where: eq(employees.id, employeeId),
        columns: { isActive: true },
      });
      if (!emp?.isActive) return { ok: false, error: "Choose an active employee." };
    }

    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ isDefault: leaveApprovers.isDefault })
        .from(leaveApprovers)
        .where(eq(leaveApprovers.employeeId, employeeId));
      let previousDefaultId: string | null = null;

      if (action === "remove") {
        await tx.delete(leaveApprovers).where(eq(leaveApprovers.employeeId, employeeId));
      } else if (action === "add") {
        await tx.insert(leaveApprovers).values({ employeeId, createdById: me.id }).onConflictDoNothing();
      } else {
        const [prev] = await tx
          .update(leaveApprovers)
          .set({ isDefault: false })
          .where(and(eq(leaveApprovers.isDefault, true), ne(leaveApprovers.employeeId, employeeId)))
          .returning({ employeeId: leaveApprovers.employeeId });
        previousDefaultId = prev?.employeeId ?? null;
        await tx
          .insert(leaveApprovers)
          .values({ employeeId, isDefault: true, createdById: me.id })
          .onConflictDoUpdate({ target: leaveApprovers.employeeId, set: { isDefault: true } });
      }

      const from = { listed: before !== undefined, isDefault: before?.isDefault ?? false };
      const to =
        action === "remove"
          ? { listed: false, isDefault: false }
          : action === "add"
            ? { listed: true, isDefault: before?.isDefault ?? false }
            : { listed: true, isDefault: true };
      if (from.listed === to.listed && from.isDefault === to.isDefault && previousDefaultId === null) return; // nothing changed
      await tx.insert(employeeEvents).values({
        employeeId,
        actorId: me.id,
        eventType: "leave_approver_changed",
        fromValue: from,
        toValue: { ...to, action, ...(previousDefaultId ? { previousDefaultId } : {}) },
      });
    });
  } catch (err: unknown) {
    return dbFailure("changing the leave approvers", err);
  }

  revalidatePath(PATH);
  revalidatePath(APPROVALS_PATH);
  revalidatePath(APPROVER_ADMIN_PATH);
  return { ok: true };
}

/**
 * Admin: route the pending requests that are not with the current default
 * approver to them — for the ones filed before the default was set or changed.
 *
 * Deliberately a button an admin presses, never something that runs on its own:
 * it touches only PENDING requests (a decision already made is never changed),
 * never routes the default approver's own requests to them (those stay with no
 * approver, decidable only with the override), changes nothing but
 * `approver_id`, and writes one audit event per request (from → to).
 */
export async function reassignPendingLeave(): Promise<
  ActionResult<{ moved: number; routedTo: string }>
> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  let approver;
  try {
    approver = await getDefaultLeaveApprover();
  } catch (err: unknown) {
    return dbFailure("reading the default approver", err);
  }
  if (!approver) return { ok: false, error: "Set an active default approver first." };

  let moved = 0;
  try {
    const todo = requestsToReroute(await listPendingRouting(), approver.employeeId);
    if (todo.length > 0) {
      await db.transaction(async (tx) => {
        const won = await tx
          .update(leaveRequests)
          .set({ approverId: approver.employeeId })
          .where(and(inArray(leaveRequests.id, todo.map((r) => r.id)), eq(leaveRequests.status, "pending")))
          .returning({ id: leaveRequests.id });
        const done = new Set(won.map((w) => w.id));
        const changed = todo.filter((r) => done.has(r.id));
        if (changed.length > 0) {
          await tx.insert(employeeEvents).values(
            changed.map((r) => ({
              employeeId: r.employeeId,
              actorId: me.id,
              eventType: "leave_rerouted",
              fromValue: { approverId: r.approverId },
              toValue: { approverId: approver.employeeId },
            })),
          );
        }
        moved = changed.length;
      });
    }
  } catch (err: unknown) {
    return dbFailure("re-routing pending leave requests", err);
  }

  if (moved > 0) {
    try {
      await notify({
        userId: approver.employeeId,
        kind: "attendance_device" as NotificationKind,
        title: "Leave requests routed to you",
        body: `${moved} pending leave request${moved === 1 ? " was" : "s were"} routed to you for approval.`,
        actorId: me.id,
      });
    } catch (err) {
      console.error("[leave] reroute notification failed", err);
    }
  }

  revalidatePath(PATH);
  revalidatePath(APPROVALS_PATH);
  revalidatePath(APPROVER_ADMIN_PATH);
  return { ok: true, moved, routedTo: approver.name };
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
    return dbFailure("recording an admin leave", err);
  }
  if (!inserted) return dbFailure("recording an admin leave", new Error("insert returned no row"));

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
  revalidatePath(APPROVALS_PATH);
  return { ok: true, id: inserted.id };
}

/**
 * Cancel a leave request.
 *
 * Your OWN request: only while it is still pending — for everyone, admins
 * included, so approved leave is never withdrawn through this ordinary path.
 * Someone else's request: admins only (the existing admin power), in whatever
 * state it was when they looked, except one already cancelled.
 *
 * The update is conditional on exactly what was authorised (the request's
 * owner and the status that was checked), so a request decided in between is
 * not cancelled; the cancellation and its audit row commit together.
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

  const own = existing.employeeId === me.id;
  if (!own && !me.isAdmin) {
    return { ok: false, error: "You can only cancel your own requests." };
  }
  if (own && existing.status !== "pending") {
    return { ok: false, error: "Only pending requests can be cancelled." };
  }
  if (existing.status === "cancelled") {
    return { ok: false, error: "This request is already cancelled." };
  }

  let won: { id: string }[];
  try {
    won = await db.transaction(async (tx) => {
      const rows = await tx
        .update(leaveRequests)
        .set({ status: "cancelled", decidedById: me.id, decidedAt: new Date() })
        .where(
          and(
            eq(leaveRequests.id, parsed.data.id),
            eq(leaveRequests.employeeId, existing.employeeId),
            eq(leaveRequests.status, existing.status),
          ),
        )
        .returning({ id: leaveRequests.id });
      if (rows.length === 0) return rows;
      await tx.insert(employeeEvents).values({
        employeeId: existing.employeeId,
        actorId: me.id,
        eventType: "leave_cancelled",
        fromValue: { status: existing.status },
        toValue: { status: "cancelled" },
      });
      return rows;
    });
  } catch (err: unknown) {
    return dbFailure("cancelling a leave request", err);
  }
  if (won.length === 0) {
    return { ok: false, error: "This request changed meanwhile (it may have been decided). Reload to see its current state." };
  }

  revalidatePath(PATH);
  revalidatePath(APPROVALS_PATH);
  return { ok: true };
}
