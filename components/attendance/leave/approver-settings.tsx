"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import type { DefaultApproverStatus, LeaveApproverRow } from "@/lib/queries/leave";
import { reassignPendingLeave, setLeaveApprover } from "@/app/(app)/attendance/leave/actions";

/**
 * Admin only: who may decide leave and who new requests go to. The page renders
 * it for admins alone, and `setLeaveApprover` re-checks admin on the server.
 *
 * It works even when the automatic seed found nobody: any active employee can be
 * chosen here. No person is named in code.
 */
export function ApproverSettings({
  approvers,
  status,
  people,
  reassignable = 0,
  defaultName = null,
  defaultAccess = null,
}: {
  approvers: LeaveApproverRow[];
  status: DefaultApproverStatus;
  /** `email` is shown beside the name so the right account is picked. */
  people: { id: string; name: string; email?: string | null }[];
  /** Pending requests that are not routed to the default approver. */
  reassignable?: number;
  defaultName?: string | null;
  /** The default approver's leave-approval permissions (null = unknown / none set). */
  defaultAccess?: { view: boolean; decide: boolean } | null;
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [pending, startTransition] = useTransition();

  function run(employeeId: string, action: "make_default" | "add" | "remove") {
    startTransition(async () => {
      const res = await setLeaveApprover({ employeeId, action });
      if (!res.ok) {
        fireToast({ message: res.error, type: "error" });
        return;
      }
      fireToast({ message: "Leave approvers updated.", type: "success" });
      setPick("");
      router.refresh();
    });
  }

  function reassign() {
    startTransition(async () => {
      const res = await reassignPendingLeave();
      if (!res.ok) {
        fireToast({ message: res.error, type: "error" });
        return;
      }
      fireToast({
        message: res.moved === 0 ? "Nothing needed re-routing." : `${res.moved} pending request${res.moved === 1 ? "" : "s"} routed to ${res.routedTo}.`,
        type: "success",
      });
      router.refresh();
    });
  }

  const listed = new Set(approvers.map((a) => a.employeeId));
  const candidates = people.filter((p) => !listed.has(p.id));

  return (
    <section
      className="rounded-section bg-surface-card p-5 max-md:p-4"
      style={{ border: "1px solid var(--color-hairline)" }}
    >
      <h2 className="text-[16px] font-semibold text-ink-strong">Leave approvers</h2>
      <p className="text-[13.5px] text-ink-subtle mt-0.5">
        New leave applications are routed to the default approver. Who can see and decide requests is set in Field Permissions (Leave approvals).
      </p>

      {status.state !== "ok" && (
        <p role="alert" className="mt-3 rounded-md bg-[#FFFBEB] border border-[#FCD9A0] px-3 py-2 text-[14px] text-[#92400E]">
          {status.state === "inactive"
            ? `The default approver (${status.name}) is no longer an active employee, so new requests are going to the admins. Choose a new default below.`
            : "No default approver is set, so new requests are going to the admins. Choose one below."}
        </p>
      )}

      {status.state === "ok" && defaultAccess && (!defaultAccess.view || !defaultAccess.decide) && (
        <p role="alert" className="mt-3 rounded-md bg-[#FFFBEB] border border-[#FCD9A0] px-3 py-2 text-[14px] text-[#92400E]">
          {status.name} is the default approver but{" "}
          {!defaultAccess.view && !defaultAccess.decide
            ? "holds neither the “View queue” nor the “Approve or reject” permission"
            : !defaultAccess.view
              ? "doesn’t hold the “View queue” permission"
              : "doesn’t hold the “Approve or reject” permission"}
          , so requests routed to them can’t be handled. A super-admin grants these under Admin &amp; Master Setup → Field
          Permissions → Leave approvals.
        </p>
      )}

      {approvers.length > 0 && (
        <ul className="mt-3 divide-y divide-hairline">
          {approvers.map((a) => (
            <li key={a.employeeId} className="flex items-center justify-between gap-3 py-2">
              <span className="text-[14.5px] text-ink-strong">
                {a.name}
                {a.isDefault && (
                  <span className="ml-2 rounded-pill px-2 py-0.5 text-[11px] font-bold bg-[#E6F5EC] text-[#15803D]">
                    Default
                  </span>
                )}
              </span>
              <span className="flex gap-3">
                {!a.isDefault && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(a.employeeId, "make_default")}
                    className="text-[13px] font-semibold text-ink-strong underline underline-offset-2 disabled:opacity-50"
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(a.employeeId, "remove")}
                  className="text-[13px] font-semibold text-ink-subtle underline underline-offset-2 disabled:opacity-50"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <label htmlFor="lv-add-approver" className="sr-only">
          Choose an employee
        </label>
        <select
          id="lv-add-approver"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] min-w-56"
        >
          <option value="">Choose an employee…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.email ? `${p.name} (${p.email})` : p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !pick}
          onClick={() => run(pick, status.state === "ok" ? "add" : "make_default")}
          className="rounded-md px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #12B3A0, #0C7C6F)" }}
        >
          {status.state === "ok" ? "Add approver" : "Set as default approver"}
        </button>
      </div>

      {reassignable > 0 && defaultName && (
        <div className="mt-4 rounded-md bg-[#F8FAFC] border border-hairline px-3 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13.5px] text-ink-soft">
            {reassignable} pending request{reassignable === 1 ? " is" : "s are"} not routed to {defaultName}. Decisions already made are never changed.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Route ${reassignable} pending leave request${reassignable === 1 ? "" : "s"} to ${defaultName}?`)) reassign();
            }}
            className="rounded-md px-3.5 py-2 text-[13px] font-semibold text-ink-strong disabled:opacity-50"
            style={{ border: "1px solid var(--color-hairline)" }}
          >
            Route pending to {defaultName}
          </button>
        </div>
      )}
    </section>
  );
}
