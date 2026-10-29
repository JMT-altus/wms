import { daysInDateRange } from "@/lib/attendance/leave-cycle";

/**
 * The Apply-for-Leave rules that need no database, kept pure so the server action
 * and the tests share one definition.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-31). */
export function isRealIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * Calendar days from `from` to `to`, BOTH ends counted: 15 → 21 Sept is 7.
 *
 * Deliberately a plain calendar count. Sundays, public and optional holidays are
 * NOT taken out here — that is attendance/payroll policy, kept separate and
 * configurable. Null when either date is not real or `to` is before `from`.
 */
export function inclusiveLeaveDays(from: string, to: string): number | null {
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || to < from) return null;
  return daysInDateRange(from, to);
}

/**
 * The applications an employee sees listed. A cancelled application is the
 * employee's own withdrawn request, so it is not shown; the row itself stays in
 * the database and its cancellation stays in the audit trail.
 */
export function withoutCancelled<T extends { status: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.status !== "cancelled");
}

export type LeavePay = "paid" | "unpaid";

/** The part of a leave row the pay classification needs. */
export interface LeaveCover {
  /** Explicit pay kind; null on a request filed from the Apply-for-Leave form. */
  kind: LeavePay | null;
  startDate: string;
  endDate: string;
  /** When present, only an 'approved' row ever covers a day. */
  status?: string;
}

/**
 * Whether `ymd` is covered by approved leave, and how that leave is paid.
 *
 * - An explicit legacy `kind` ('paid' / 'unpaid') is honoured exactly as before.
 * - A request with NO kind (the Apply-for-Leave form) takes its pay from
 *   `nullKindAs`, which the caller reads from the attendance policy setting
 *   `approved_leave_payment`. Emergency/Planned is a request type, not a pay
 *   class, and plays no part here.
 * - Pending, rejected and cancelled rows never cover a day.
 * - If an explicitly-paid and any other leave overlap the same day, paid wins.
 */
export function leaveKindOn(
  ymd: string,
  leaves: LeaveCover[],
  nullKindAs: LeavePay,
): LeavePay | null {
  let unpaid: "unpaid" | null = null;
  for (const lv of leaves) {
    if (lv.status !== undefined && lv.status !== "approved") continue;
    if (ymd < lv.startDate || ymd > lv.endDate) continue;
    const pay = lv.kind ?? nullKindAs;
    if (pay === "paid") return "paid";
    unpaid = "unpaid";
  }
  return unpaid;
}

export interface DecideContext {
  deciderId: string;
  /** Holds `leave.approvals.decide` (resolved from the permission matrix on the server). */
  canDecide: boolean;
  /** Holds `leave.approvals.override`: may act on requests assigned to someone else, or to nobody. */
  canOverride: boolean;
  requestEmployeeId: string;
  requestStatus: string;
  /** Who the request was routed to when it was filed; null = routed to nobody in particular. */
  requestApproverId: string | null;
}

/**
 * May this person rule on this request right now?
 *
 * They must hold the "approve or reject" permission AND the request must be
 * assigned to them — unless they also hold the explicit override permission.
 * The override only widens WHICH requests; it is worth nothing without the
 * permission to decide. Nobody decides their own request, override or not.
 * Only a PENDING request can be decided, so a second, conflicting decision is
 * refused.
 *
 * Pure: it knows no names, e-mail addresses or ids — only what the caller
 * resolved from the signed session and the stored request.
 */
export function checkCanDecide(c: DecideContext): { ok: true } | { ok: false; error: string } {
  const assignedToDecider = c.requestApproverId !== null && c.requestApproverId === c.deciderId;
  if (!c.canDecide || (!assignedToDecider && !c.canOverride)) {
    return { ok: false, error: "You are not authorised to decide this leave request." };
  }
  if (c.deciderId === c.requestEmployeeId) {
    return { ok: false, error: "You can't decide your own leave request." };
  }
  if (c.requestStatus !== "pending") {
    return { ok: false, error: `This request has already been ${c.requestStatus}.` };
  }
  return { ok: true };
}

/** Why a pending request is or isn't routed to the current default approver. */
export interface RoutingRow {
  id: string;
  employeeId: string;
  approverId: string | null;
}

/**
 * The pending requests that are not routed to `defaultApproverId` and could be.
 * A request the default approver filed themselves stays with the admins (nobody
 * approves their own leave), and one already routed to the default is left alone.
 */
export function requestsToReroute(rows: RoutingRow[], defaultApproverId: string): RoutingRow[] {
  return rows.filter((r) => r.employeeId !== defaultApproverId && r.approverId !== defaultApproverId);
}
