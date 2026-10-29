import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { employees, leaveApprovers, leaveRequests } from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { getFieldAccessFor } from "@/lib/auth/field-access";
import type { LeaveKind, LeaveStatus, LeaveType } from "@/db/enums";
import {
  leaveCycleFor,
  balanceWindow,
  overlapDays,
} from "@/lib/attendance/leave-cycle";

export interface LeaveBalance {
  cycleStart: string;
  cycleEnd: string;
  allowance: number;
  used: number;
  remaining: number;
  beforeProbation: boolean;
  /** Prior-cycle leftover (max(0, allowance - used)), surfaced read-only. The
   *  policy does NOT auto-extend this cycle's allowance with it. */
  carryForward: number;
}

export interface LeaveRow {
  id: string;
  employeeId: string;
  employeeName: string;
  /** Pay treatment; null on a request filed from the Apply-for-Leave form. */
  kind: LeaveKind | null;
  /** Emergency | Planned; null on requests that pre-date the form. */
  leaveType: LeaveType | null;
  approverId: string | null;
  approverName: string | null;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

/** Sum approved PAID leave days that overlap the clamped window, per the
 *  cycle anchored at `probationEnd`. `refTodayISO` is YYYY-MM-DD. */
async function usedPaidDays(
  employeeId: string,
  probationEnd: string,
  cycleStart: string,
  cycleEnd: string,
): Promise<number> {
  const win = balanceWindow(probationEnd, cycleStart, cycleEnd);
  if (!win) return 0;

  // Pull approved paid leaves that could overlap the window, then count the
  // clamped overlap in JS (cheap; leave rows per employee are few).
  const rows = await db
    .select({
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.kind, "paid"),
        eq(leaveRequests.status, "approved"),
        // overlap: start ≤ window.to AND end ≥ window.from
        lte(leaveRequests.startDate, win.to),
        gte(leaveRequests.endDate, win.from),
      ),
    );

  let used = 0;
  for (const r of rows) {
    used += overlapDays(r.startDate, r.endDate, win.from, win.to);
  }
  return used;
}

/**
 * Current-cycle paid-leave balance for an employee. Uses the employee's
 * `probationEnd` as the cycle anchor; counts approved paid leave whose dates
 * fall in [max(cycleStart, probationEnd), cycleEnd]. If the employee has no
 * probationEnd or is still before it, allowance/remaining are 0.
 */
export async function getLeaveBalance(
  employeeId: string,
  refTodayISO: string,
): Promise<LeaveBalance> {
  const emp = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
    columns: { probationEnd: true },
  });
  const probationEnd = emp?.probationEnd ?? null;

  if (!probationEnd) {
    return {
      cycleStart: refTodayISO,
      cycleEnd: refTodayISO,
      allowance: 0,
      used: 0,
      remaining: 0,
      beforeProbation: false,
      carryForward: 0,
    };
  }

  const cycle = leaveCycleFor(probationEnd, refTodayISO);
  if (cycle.beforeProbation) {
    return {
      cycleStart: cycle.cycleStart,
      cycleEnd: cycle.cycleEnd,
      allowance: 0,
      used: 0,
      remaining: 0,
      beforeProbation: true,
      carryForward: 0,
    };
  }

  const used = await usedPaidDays(
    employeeId,
    probationEnd,
    cycle.cycleStart,
    cycle.cycleEnd,
  );
  const remaining = Math.max(0, cycle.allowance - used);

  // Prior cycle: the day before this cycle's start. carryForward is the prior
  // cycle's leftover (read-only; not added to this cycle's allowance).
  let carryForward = 0;
  const priorRefMs = Date.parse(`${cycle.cycleStart}T00:00:00Z`) - 86_400_000;
  if (!Number.isNaN(priorRefMs)) {
    const priorRef = new Date(priorRefMs).toISOString().slice(0, 10);
    if (priorRef >= probationEnd) {
      const prior = leaveCycleFor(probationEnd, priorRef);
      if (!prior.beforeProbation) {
        const priorUsed = await usedPaidDays(
          employeeId,
          probationEnd,
          prior.cycleStart,
          prior.cycleEnd,
        );
        carryForward = Math.max(0, prior.allowance - priorUsed);
      }
    }
  }

  return {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    allowance: cycle.allowance,
    used,
    remaining,
    beforeProbation: false,
    carryForward,
  };
}

/** Shared select + joins for the three list queries. `where` and ordering are
 *  applied by the caller. Returns mapped LeaveRows (days → number). */
async function selectLeaveRows(
  where: SQL | undefined,
  order: "newest" | "by_start",
): Promise<LeaveRow[]> {
  const decider = alias(employees, "decider");
  const approver = alias(employees, "approver");
  const rows = await db
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      employeeName: employees.name,
      kind: leaveRequests.kind,
      leaveType: leaveRequests.leaveType,
      approverId: leaveRequests.approverId,
      approverName: approver.name,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      decidedByName: decider.name,
      decidedAt: leaveRequests.decidedAt,
      decisionNote: leaveRequests.decisionNote,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .leftJoin(decider, eq(leaveRequests.decidedById, decider.id))
    .leftJoin(approver, eq(leaveRequests.approverId, approver.id))
    .where(where)
    .orderBy(
      order === "newest"
        ? desc(leaveRequests.createdAt)
        : asc(leaveRequests.startDate),
    );

  return rows.map((r) => ({
    ...r,
    days: Number(r.days),
    decidedByName: r.decidedByName ?? null,
    approverName: r.approverName ?? null,
  }));
}

/** My leave requests, newest first. */
export async function listMyLeave(employeeId: string): Promise<LeaveRow[]> {
  return selectLeaveRows(eq(leaveRequests.employeeId, employeeId), "newest");
}

/**
 * The pending review queue, oldest start date first.
 *
 * Needs the proof that the caller holds `leave.approvals.view` — the queue
 * can't be read from a path that skipped the check. Without the override proof
 * it is the requests assigned to the viewer; with it, every pending request.
 * The viewer's own requests are never in it.
 */
export async function listPendingLeaveFor(
  viewer: CapabilityProof<"leave.approvals.view">,
  override: CapabilityProof<"leave.approvals.override"> | null,
): Promise<LeaveRow[]> {
  const pending = eq(leaveRequests.status, "pending");
  const rows = await selectLeaveRows(
    override ? pending : and(pending, eq(leaveRequests.approverId, viewer.employeeId)),
    "by_start",
  );
  return rows.filter((r) => r.employeeId !== viewer.employeeId);
}

/** A pending request as the approver reviews it: the row plus who is asking. */
export interface ApprovalRow extends LeaveRow {
  employeeEmail: string | null;
}

/**
 * The review queue on the Leave Approvals page: `listPendingLeaveFor` plus the
 * requester's e-mail, so the reviewer knows exactly who is asking.
 */
export async function listPendingApprovalsFor(
  viewer: CapabilityProof<"leave.approvals.view">,
  override: CapabilityProof<"leave.approvals.override"> | null,
): Promise<ApprovalRow[]> {
  const rows = await listPendingLeaveFor(viewer, override);
  if (rows.length === 0) return [];
  const people = await db
    .select({ id: employees.id, email: employees.email })
    .from(employees)
    .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]));
  const emailOf = new Map(people.map((p) => [p.id, p.email]));
  return rows.map((r) => ({ ...r, employeeEmail: emailOf.get(r.employeeId) ?? null }));
}

/** Active employees an admin can pick as a leave approver, with their e-mail so the right account is chosen. */
export async function listApproverCandidates(): Promise<{ id: string; name: string; email: string }[]> {
  return db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(asc(employees.name));
}

/** Who each pending request is routed to (null = the admins) — for re-routing. */
export async function listPendingRouting(): Promise<{ id: string; employeeId: string; approverId: string | null }[]> {
  return db
    .select({ id: leaveRequests.id, employeeId: leaveRequests.employeeId, approverId: leaveRequests.approverId })
    .from(leaveRequests)
    .where(eq(leaveRequests.status, "pending"));
}

export interface LeaveApproverRow {
  employeeId: string;
  name: string;
  isDefault: boolean;
}

/** Everyone listed as a leave approver, the default first. */
export async function listLeaveApprovers(): Promise<LeaveApproverRow[]> {
  return db
    .select({
      employeeId: leaveApprovers.employeeId,
      name: employees.name,
      isDefault: leaveApprovers.isDefault,
    })
    .from(leaveApprovers)
    .innerJoin(employees, eq(leaveApprovers.employeeId, employees.id))
    .where(eq(employees.isActive, true))
    .orderBy(desc(leaveApprovers.isDefault), asc(employees.name));
}

/** The approver new requests are routed to, or null if none is configured. */
export async function getDefaultLeaveApprover(): Promise<LeaveApproverRow | null> {
  return (await listLeaveApprovers()).find((a) => a.isDefault) ?? null;
}

/** What the settings card and the form need to say about the default approver. */
export type DefaultApproverStatus =
  | { state: "ok"; name: string }
  | { state: "inactive"; name: string }
  | { state: "missing" };

/**
 * Whether new requests have a working default approver. Unlike
 * `getDefaultLeaveApprover` this also sees a default who has since been
 * deactivated, so the page can say why requests are going to the admins.
 */
export async function getDefaultApproverStatus(): Promise<DefaultApproverStatus> {
  const rows = await db
    .select({ name: employees.name, isActive: employees.isActive })
    .from(leaveApprovers)
    .innerJoin(employees, eq(leaveApprovers.employeeId, employees.id))
    .where(eq(leaveApprovers.isDefault, true))
    .limit(1);
  const row = rows[0];
  if (!row) return { state: "missing" };
  return row.isActive ? { state: "ok", name: row.name } : { state: "inactive", name: row.name };
}

/**
 * Which leave-approval permissions the default approver actually holds, from the
 * same resolver the permission matrix previews with. Routing a request to
 * someone who can't see or decide it would strand it, so the settings card
 * warns. Null when there is no active default.
 */
export async function getDefaultApproverAccess(): Promise<{ view: boolean; decide: boolean } | null> {
  const approver = await getDefaultLeaveApprover();
  if (!approver) return null;
  const emp = await db.query.employees.findFirst({ where: eq(employees.id, approver.employeeId) });
  if (!emp) return null;
  const access = await getFieldAccessFor(emp);
  return {
    view: access["leave.approvals.view"]?.allowed === true,
    decide: access["leave.approvals.decide"]?.allowed === true,
  };
}

/**
 * Approved leaves for a set of employees overlapping [start,end] (B7 grid).
 * Overlap = leave.start ≤ end AND leave.end ≥ start.
 */
export async function listEmployeeLeaveForRange(
  employeeIds: string[],
  start: string,
  end: string,
): Promise<LeaveRow[]> {
  if (employeeIds.length === 0) return [];
  return selectLeaveRows(
    and(
      inArray(leaveRequests.employeeId, employeeIds),
      eq(leaveRequests.status, "approved"),
      lte(leaveRequests.startDate, end),
      gte(leaveRequests.endDate, start),
    ),
    "by_start",
  );
}
