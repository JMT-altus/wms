import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import {
  getDefaultApproverStatus,
  getDefaultLeaveApprover,
  isLeaveApprover,
  listLeaveApprovers,
  listMyLeave,
  listPendingLeaveFor,
} from "@/lib/queries/leave";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { ApproverSettings } from "@/components/attendance/leave/approver-settings";
import { ApplyLeaveForm } from "@/components/attendance/leave/apply-leave-form";
import { withoutCancelled } from "@/lib/leave/workflow";
import { LeaveList } from "@/components/attendance/leave/leave-list";

export const dynamic = "force-dynamic";

export default async function LeavePage() {
  const me = await requireUser();

  const [mine, approver, approverStatus, approvers, listedApprover, people] = await Promise.all([
    listMyLeave(me.id),
    getDefaultLeaveApprover(),
    getDefaultApproverStatus(),
    listLeaveApprovers(),
    isLeaveApprover(me.id),
    me.isAdmin ? listEmployeeOptions() : Promise.resolve([]),
  ]);
  // Who may rule on requests: admins and listed approvers. The actions re-check
  // this on the server; this only decides what is shown.
  const canDecide = me.isAdmin || listedApprover;
  const pending = canDecide
    ? (await listPendingLeaveFor(me.id, me.isAdmin)).filter((r) => r.employeeId !== me.id)
    : [];

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

          {me.isAdmin && (
            <ApproverSettings
              approvers={approvers}
              status={approverStatus}
              people={people.map((p) => ({ id: p.id, name: p.name }))}
            />
          )}

          {canDecide && (
            <section>
              <h2 className="text-[18px] font-semibold text-ink-strong mb-3">
                Pending approvals
                {pending.length > 0 && (
                  <span className="ml-2 text-[14px] font-normal text-ink-subtle tabular-nums">
                    {pending.length}
                  </span>
                )}
              </h2>
              <LeaveList rows={pending} mode="pending" />
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
