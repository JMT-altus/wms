import { requireAdmin } from "@/lib/auth/current";
import {
  getDefaultApproverAccess,
  getDefaultApproverStatus,
  getDefaultLeaveApprover,
  listApproverCandidates,
  listLeaveApprovers,
  listPendingRouting,
} from "@/lib/queries/leave";
import { requestsToReroute } from "@/lib/leave/workflow";
import { ApproverSettings } from "@/components/attendance/leave/approver-settings";

export const dynamic = "force-dynamic";

/**
 * Leave approvers — where administrators choose who new leave applications are
 * routed to. It lives in the Admin area (not on the employees' Leave page) and
 * is admin-only: the admin layout and this page both require an admin, and each
 * action re-checks on the server.
 *
 * This is ROUTING only. Who may see and decide requests is the permission
 * matrix: Admin & Master Setup → Field Permissions → Leave approvals.
 */
export default async function LeaveApproversPage() {
  await requireAdmin();

  const [approvers, status, approver, people] = await Promise.all([
    listLeaveApprovers(),
    getDefaultApproverStatus(),
    getDefaultLeaveApprover(),
    listApproverCandidates(),
  ]);
  // Admin-only extras; a failed read just hides them.
  const defaultId = approver?.employeeId ?? null;
  const [reassignable, defaultAccess] = await Promise.all([
    defaultId
      ? listPendingRouting()
          .then((rows) => requestsToReroute(rows, defaultId).length)
          .catch(() => 0)
      : Promise.resolve(0),
    getDefaultApproverAccess().catch(() => null),
  ]);

  return (
    <div>
      <header className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">Admin · Attendance</div>
        <h1
          className="mt-1 text-ink-strong"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          Leave approvers
        </h1>
        <p className="text-body-lg text-ink-subtle mt-2 max-w-2xl">
          Who new leave applications are routed to. Who may view and decide them is set in Field Permissions.
        </p>
      </header>
      <div className="max-w-[860px]">
        <ApproverSettings
          approvers={approvers}
          status={status}
          people={people}
          reassignable={reassignable}
          defaultName={approver?.name ?? null}
          defaultAccess={defaultAccess}
        />
      </div>
    </div>
  );
}
