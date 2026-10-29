import "server-only";
import { LEAVE_KIND_LABELS, LEAVE_TYPE_LABELS } from "@/db/enums";
import { getLeaveCapabilityProofs } from "@/lib/auth/capability";
import { listPendingLeaveFor, type LeaveRow } from "@/lib/queries/leave";
import { PendingLeavePrompt } from "./pending-leave-prompt";

/**
 * Reads the signed-in person's pending leave decisions straight from the
 * database. A failure here must never break the page it sits on, so it renders
 * nothing — the pending list on the Leave page is the dependable surface.
 */
export async function PendingLeavePromptServer() {
  let pending: LeaveRow[] = [];
  try {
    // Only for someone who may view the queue (the permission matrix); their own
    // requests are never in it.
    const caps = await getLeaveCapabilityProofs();
    if (!caps.view) return null;
    pending = await listPendingLeaveFor(caps.view, caps.override);
  } catch (err) {
    console.error("[leave] pending prompt failed", err);
    return null;
  }
  if (pending.length === 0) return null;

  return (
    <PendingLeavePrompt
      total={pending.length}
      requests={pending.slice(0, 5).map((r) => ({
        id: r.id,
        employeeName: r.employeeName,
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
        typeLabel: r.leaveType
          ? LEAVE_TYPE_LABELS[r.leaveType]
          : r.kind
            ? LEAVE_KIND_LABELS[r.kind]
            : "Leave",
        reason: r.reason,
      }))}
    />
  );
}
