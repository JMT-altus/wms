import { notFound } from "next/navigation";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { getLeaveCapabilityProofs } from "@/lib/auth/capability";
import { listPendingApprovalsFor, type ApprovalRow } from "@/lib/queries/leave";
import { LeaveList } from "@/components/attendance/leave/leave-list";

export const dynamic = "force-dynamic";

/**
 * Leave Approvals — the queue of leave requests waiting for the signed-in
 * reviewer, controlled by the permission matrix (Field Permissions):
 *
 *   leave.approvals.view      opens the page; anyone without it gets a 404
 *   leave.approvals.decide    shows the Approve / Reject controls
 *   leave.approvals.override  widens the queue from "assigned to me" to everyone's
 *
 * The queue query needs the view proof and the decide action re-checks the
 * grant, so hiding things here is a courtesy, not the control.
 */
export default async function LeaveApprovalsPage() {
  const caps = await getLeaveCapabilityProofs();
  if (!caps.view) notFound();

  let rows: ApprovalRow[] = [];
  let failed = false;
  try {
    rows = await listPendingApprovalsFor(caps.view, caps.override);
  } catch (err) {
    console.error("[leave] approvals could not be loaded", err);
    failed = true;
  }

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[860px] px-8 max-md:px-4 pt-8 pb-16">
        <header className="mb-6">
          <h1 className="text-display-lg text-ink-strong">Leave Approvals</h1>
          <p className="text-body-lg text-ink-subtle mt-1">
            Leave requests waiting for your decision.
            {!failed && rows.length > 0 && (
              <span className="ml-2 tabular-nums">{rows.length} pending</span>
            )}
          </p>
        </header>
        {!failed && caps.decide === null && (
          <p className="mb-4 rounded-md bg-[#F8FAFC] border border-hairline px-4 py-3 text-[14px] text-ink-soft">
            You can view these requests but not approve or reject them.
          </p>
        )}
        {failed ? (
          <p role="alert" className="rounded-md bg-[#FFFBEB] border border-[#FCD9A0] px-4 py-3 text-[14.5px] text-[#92400E]">
            The leave requests could not be loaded. Nothing has been changed — please refresh in a moment.
          </p>
        ) : (
          <LeaveList rows={rows} mode="pending" canDecide={caps.decide !== null} />
        )}
      </main>
      <DashboardFooter />
    </>
  );
}
