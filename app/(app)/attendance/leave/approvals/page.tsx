import { notFound } from "next/navigation";
import { DashboardHeader } from "@/components/layout/header";
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
      <main className="emp-compact-page mx-auto w-full max-w-[1480px] px-10 max-lg:px-6 max-md:px-4 pt-4 pb-12">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-[#0B1F44]">Leave Approvals</h1>
            <p className="mt-1 text-[12.5px] text-[#5B6B85]">Leave requests waiting for your decision.</p>
          </div>
          {!failed && rows.length > 0 && (
            <span className="rounded-full border border-[#F6DDA6] bg-[#FFF7E6] px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-[#B45309]">
              {rows.length} pending
            </span>
          )}
        </header>
        {!failed && caps.decide === null && (
          <p className="mb-3 rounded-lg border border-[#DCE4F0] bg-[#F5F8FC] px-3 py-2 text-[12.5px] text-[#475569]">
            You can view these requests but not approve or reject them.
          </p>
        )}
        {failed ? (
          <p role="alert" className="rounded-lg border border-[#FCD9A0] bg-[#FFFBEB] px-3 py-2 text-[13px] text-[#92400E]">
            The leave requests could not be loaded. Nothing has been changed — please refresh in a moment.
          </p>
        ) : (
          <LeaveList rows={rows} mode="pending" canDecide={caps.decide !== null} layout="table" />
        )}
      </main>
    </>
  );
}
