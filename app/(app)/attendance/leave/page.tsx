import { DashboardHeader } from "@/components/layout/header";
import { requireUser } from "@/lib/auth/current";
import { getLeaveCapabilityProofs } from "@/lib/auth/capability";
import { getDefaultLeaveApprover, listMyLeave, listPendingLeaveFor } from "@/lib/queries/leave";
import { ApplyLeaveForm } from "@/components/attendance/leave/apply-leave-form";
import { withoutCancelled } from "@/lib/leave/workflow";
import { LeaveList } from "@/components/attendance/leave/leave-list";

export const dynamic = "force-dynamic";

export default async function LeavePage() {
  const me = await requireUser();

  const caps = await getLeaveCapabilityProofs();
  const [mine, approver] = await Promise.all([listMyLeave(me.id), getDefaultLeaveApprover()]);
  // The review queue comes from the permission matrix (leave.approvals.*): the
  // query needs the view proof, and the decide action checks the grant again.
  const pending = caps.view ? await listPendingLeaveFor(caps.view, caps.override) : [];

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      {/* Uses the width the rail leaves: ~93% of the content area at 1366px, capped on very wide screens. */}
      <main className="mx-auto w-full max-w-[1480px] px-10 pb-10 pt-5 max-lg:px-6 max-md:px-4 max-md:pt-4">
        <header className="mb-4">
          <h1 className="text-[#0B1F44]">Apply for Leave</h1>
          <p className="mt-1 text-[13.5px] text-[#5B6B85]">Submit and track your leave request.</p>
        </header>

        {/* Wide screens: the form and the employee's own applications side by side, so both are in view at 1366×768
            and the fields don't stretch across the whole page. Narrower screens stack them. */}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
          <ApplyLeaveForm employeeName={me.name} approverName={approver?.name ?? null} />

          <section aria-labelledby="my-leave-heading" className="min-w-0">
            <h2 id="my-leave-heading" className="mb-2 text-[15px] font-semibold text-[#0B1F44]">
              My leave applications
            </h2>
            <LeaveList rows={withoutCancelled(mine)} mode="mine" />
          </section>
        </div>

        {caps.view && (
          <section className="mt-6">
            <h2 className="mb-2 text-[15px] font-semibold text-[#0B1F44]">
              Pending approvals
              {pending.length > 0 && (
                <span className="ml-2 text-[13px] font-normal text-ink-subtle tabular-nums">
                  {pending.length}
                </span>
              )}
            </h2>
            <LeaveList rows={pending} mode="pending" canDecide={caps.decide !== null} />
          </section>
        )}
      </main>
    </>
  );
}
