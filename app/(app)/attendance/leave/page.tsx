import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
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
      <main className="mx-auto max-w-[860px] px-8 max-md:px-4 pt-8 pb-16">
        <header className="mb-6">
          <h1 className="text-display-lg text-ink-strong">Apply for Leave</h1>
          <p className="text-body-lg text-ink-subtle mt-1">
            Apply for leave and follow its approval.
          </p>
        </header>

        <div className="space-y-6">
          <ApplyLeaveForm employeeName={me.name} approverName={approver?.name ?? null} />

          {caps.view && (
            <section>
              <h2 className="text-[18px] font-semibold text-ink-strong mb-3">
                Pending approvals
                {pending.length > 0 && (
                  <span className="ml-2 text-[14px] font-normal text-ink-subtle tabular-nums">
                    {pending.length}
                  </span>
                )}
              </h2>
              <LeaveList rows={pending} mode="pending" canDecide={caps.decide !== null} />
            </section>
          )}

          <section>
            <h2 className="text-[18px] font-semibold text-ink-strong mb-3">
              My leave applications
            </h2>
            <LeaveList rows={withoutCancelled(mine)} mode="mine" />
          </section>
        </div>
      </main>
      <DashboardFooter />
    </>
  );
}
