import type { MonthRow } from "@/lib/queries/incentive-manage";
import { isReleased } from "./stages";

/**
 * Incentive Management: the status filters of each section and what each one matches. A plain module (not a client
 * one) so the server pages can read the options too. Display only — matching never changes a record.
 */

export const CALC_STATUSES = [
  { value: "", label: "Any status" },
  { value: "none", label: "Not calculated" },
  { value: "blocked", label: "Latest calculation blocked" },
  { value: "open", label: "Open" },
  { value: "locked", label: "Locked" },
  { value: "submitted", label: "Awaiting Incentive Approval" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "voided", label: "Voided" },
] as const;

/** A month whose latest submission was rejected (it is back to Locked). Needs the approvals view (the decisions). */
export const wasRejected = (r: MonthRow) => r.status === "locked" && r.decisions.some((d) => d.submissionNo === r.submissionNo && d.decision === "reject");

export const queueStatuses = (showApprovals: boolean) => [
  { value: "pending", label: "Needs review or Incentive Approval" },
  { value: "submitted", label: "Awaiting Incentive Approval" },
  { value: "locked", label: "Locked — ready to submit" },
  ...(showApprovals ? [{ value: "rejected", label: "Rejected — back to Locked" }] : []),
  { value: "open", label: "Open — to review and lock" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "voided", label: "Voided" },
  { value: "all", label: "Every month" },
];

export function queueMatches(r: MonthRow, status: string) {
  if (status === "all") return true;
  if (status === "pending") return (r.status === "open" && !!r.run) || r.status === "locked" || r.status === "submitted";
  if (status === "rejected") return wasRejected(r);
  return r.status === status;
}

export const PAYMENT_STATUSES = [
  { value: "all", label: "Approved and paid" },
  { value: "waiting", label: "Approved — release date not reached" },
  { value: "released", label: "Released — payout not yet recorded" },
  { value: "paid", label: "Paid" },
] as const;

export function paymentMatches(r: MonthRow, status: string, today: string) {
  if (r.status !== "approved" && r.status !== "paid") return false;
  if (status === "paid") return r.status === "paid";
  if (status === "released") return r.status === "approved" && isReleased(r.status, r.releaseOn, today);
  if (status === "waiting") return r.status === "approved" && !isReleased(r.status, r.releaseOn, today);
  return true;
}

export const historyStatuses = (showApprovals: boolean) => [
  { value: "all", label: "Every month" },
  { value: "open", label: "Open" },
  { value: "locked", label: "Locked" },
  ...(showApprovals ? [{ value: "rejected", label: "Rejected — back to Locked" }] : []),
  { value: "submitted", label: "Awaiting Incentive Approval" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "voided", label: "Voided" },
];

export function historyMatches(r: MonthRow, status: string) {
  if (status === "all") return true;
  if (status === "rejected") return wasRejected(r);
  return r.status === status;
}
