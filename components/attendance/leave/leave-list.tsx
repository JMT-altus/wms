"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { fmtDate } from "@/lib/dates";
import {
  LEAVE_KIND_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  type LeaveStatus,
} from "@/db/enums";
import type { LeaveRow } from "@/lib/queries/leave";
import { decideLeave, cancelLeave } from "@/app/(app)/attendance/leave/actions";

const STATUS_STYLE: Record<LeaveStatus, { bg: string; fg: string }> = {
  pending:   { bg: "rgba(245,158,11,0.12)", fg: "#B45309" },
  approved:  { bg: "rgba(22,163,74,0.12)",  fg: "#15803D" },
  rejected:  { bg: "rgba(10,108,255,0.10)",    fg: "#0751BE" },
  cancelled: { bg: "rgba(15,23,42,0.06)",   fg: "#64748B" },
};

export function LeaveList({
  rows,
  mode,
  canDecide = true,
  layout = "cards",
}: {
  rows: (LeaveRow & { employeeEmail?: string | null })[];
  /** "mine" → show cancel on own pending; "pending" → admin approve/reject. */
  mode: "mine" | "pending";
  /** False for a view-only reviewer: the Approve / Reject controls are not drawn (the action refuses anyway). */
  canDecide?: boolean;
  /** Pending mode only: "table" is the Leave Approvals page's WMS table; "cards" (the default) is the Apply for Leave page's list. */
  layout?: "cards" | "table";
}) {
  if (rows.length === 0) {
    if (mode === "pending" && layout === "table") {
      return (
        <div className="rounded-xl border border-[#DCE4F0] bg-white px-6 py-10 text-center shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
          <CalendarCheck size={26} className="mx-auto mb-2 text-[#94A3B8]" aria-hidden />
          <p className="text-[14px] font-semibold text-[#0B1F44]">No leave requests are awaiting approval.</p>
          <p className="mt-1 text-[12.5px] text-[#64748B]">New requests appear here as soon as they are submitted.</p>
        </div>
      );
    }
    return (
      <p className={mode === "mine" ? "rounded-xl border border-[#DCE4F0] bg-white px-4 py-3 text-[13px] text-[#64748B]" : "text-[15px] text-ink-subtle"}>
        {mode === "pending"
          ? "No leave requests are awaiting approval."
          : "No leave applications yet — submit one with the form above."}
      </p>
    );
  }
  // The employee's own applications: a compact table (the WMS look). Approvers' pending requests: a WMS table on the
  // Leave Approvals page, cards elsewhere — both carry the remarks field and the Approve / Reject buttons.
  if (mode === "mine") return <MineTable rows={rows} />;
  if (layout === "table") return <PendingTable rows={rows} canDecide={canDecide} />;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <LeaveCard key={r.id} row={r} mode={mode} canDecide={canDecide} />
      ))}
    </ul>
  );
}

const leaveLabel = (row: LeaveRow) =>
  row.leaveType ? `${LEAVE_TYPE_LABELS[row.leaveType]} leave` : row.kind ? LEAVE_KIND_LABELS[row.kind] : "Leave";

/**
 * "My leave applications" as a table: Leave, Dates, Days and Status (with Cancel under a pending one). Everything the card
 * showed is still here — the reason, when it was submitted and to whom, who decided and when, and the remarks —
 * as small lines under the leave type. Each row keeps its #leave-<id> anchor.
 */
function MineTable({ rows }: { rows: (LeaveRow & { employeeEmail?: string | null })[] }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white" style={{ border: "1px solid #DCE4F0", boxShadow: "0 1px 2px rgba(11,31,68,0.05)" }}>
      <table className="w-full min-w-[420px] border-collapse text-[13px]" aria-label="My leave applications">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-[#334155]" style={{ background: "#F5F7FB" }}>
            <th scope="col" className="px-3 py-2">Leave</th>
            <th scope="col" className="px-3 py-2">Dates</th>
            <th scope="col" className="px-3 py-2 text-right">Days</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const style = STATUS_STYLE[row.status];
            return (
              <tr key={row.id} id={`leave-${row.id}`} className="scroll-mt-24 border-t border-[#EEF2F7] align-top hover:bg-[#F8FAFF]">
                <td className="px-3 py-2">
                  <span className="block font-semibold text-[#0B1F44]">{leaveLabel(row)}</span>
                  {row.reason && <span className="mt-0.5 block text-[12px] leading-snug text-[#475569]">{row.reason}</span>}
                  <span className="mt-0.5 block text-[11.5px] text-[#64748B]">
                    Submitted {fmtDate(row.createdAt)}
                    {row.approverName ? ` · Approver: ${row.approverName}` : ""}
                  </span>
                  {row.status !== "pending" && row.decidedAt && (
                    <span className="block text-[11.5px] text-[#64748B]">
                      {LEAVE_STATUS_LABELS[row.status]}
                      {row.decidedByName ? ` by ${row.decidedByName}` : ""} on {fmtDate(row.decidedAt)}
                    </span>
                  )}
                  {row.decisionNote && <span className="block text-[11.5px] text-[#64748B]">Remarks: {row.decisionNote}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#334155]">
                  {fmtDate(row.startDate)} → {fmtDate(row.endDate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[#334155]">{row.days}</td>
                <td className="px-3 py-2">
                  <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: style.bg, color: style.fg }}>
                    {LEAVE_STATUS_LABELS[row.status]}
                  </span>
                  {row.status === "pending" && (
                    <span className="mt-1.5 block">
                      <CancelButton id={row.id} />
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Cancel one of the employee's own pending requests — the same action, messages and refresh as before. */
function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function cancel() {
    startTransition(async () => {
      const res = await cancelLeave({ id });
      if (!res.ok) {
        fireToast({ message: res.error, type: "error" });
        return;
      }
      fireToast({ message: "Request cancelled." });
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={cancel}
      className="h-7 rounded-md border border-[#D6DEEB] bg-white px-2.5 text-[12px] font-semibold text-[#334155] hover:border-[#B9C6DB] hover:text-[#0B1F44] disabled:opacity-50"
    >
      Cancel
    </button>
  );
}

/**
 * Approve / reject one request: the remarks, the transition and the decision — the same action, rule ("a reason
 * is required to reject"), messages and refresh for the cards and the table.
 */
function useLeaveDecision(id: string) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(verdict: "approved" | "rejected") {
    if (verdict === "rejected" && !note.trim()) {
      fireToast({ message: "A reason is required to reject a leave request.", type: "error" });
      return;
    }
    startTransition(async () => {
      const res = await decideLeave({ id, verdict, note: note.trim() || undefined });
      if (!res.ok) {
        fireToast({ message: res.error, type: "error" });
        return;
      }
      fireToast({
        message: verdict === "approved" ? "Leave approved." : "Leave rejected.",
        type: verdict === "approved" ? "success" : "info",
      });
      router.refresh();
    });
  }

  return { note, setNote, pending, startTransition, decide };
}

/**
 * The Leave Approvals page's queue as a WMS table: Employee, Leave (with the reason), Dates, Days, Submitted (and to
 * whom), Status and — for a reviewer who may decide — the remarks field with Approve / Reject. Every row keeps its
 * #leave-<id> anchor, which the Hub's reminder links to.
 */
function PendingTable({ rows, canDecide }: { rows: (LeaveRow & { employeeEmail?: string | null })[]; canDecide: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white" style={{ border: "1px solid #DCE4F0", boxShadow: "0 1px 2px rgba(11,31,68,0.05)" }}>
      <table className="w-full min-w-[960px] border-collapse text-[13px]" aria-label="Leave requests awaiting approval">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-[#334155]" style={{ background: "#F5F7FB" }}>
            <th scope="col" className="px-3 py-2">Employee</th>
            <th scope="col" className="px-3 py-2">Leave</th>
            <th scope="col" className="px-3 py-2">Dates</th>
            <th scope="col" className="px-3 py-2 text-right">Days</th>
            <th scope="col" className="px-3 py-2">Submitted</th>
            <th scope="col" className="px-3 py-2">Status</th>
            {canDecide && (
              <th scope="col" className="px-3 py-2">
                Remarks &amp; decision
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PendingRow key={row.id} row={row} canDecide={canDecide} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingRow({ row, canDecide }: { row: LeaveRow & { employeeEmail?: string | null }; canDecide: boolean }) {
  const { note, setNote, pending, decide } = useLeaveDecision(row.id);
  const style = STATUS_STYLE[row.status];
  const showActions = canDecide && row.status === "pending";
  return (
    <tr id={`leave-${row.id}`} className="scroll-mt-24 align-top">
      <td className="w-[196px] max-w-[196px] px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <EmployeeAvatar name={row.employeeName} size="sm" />
          <span className="min-w-0 leading-tight">
            <span className="block break-words font-semibold text-[#0B1F44]">
              {row.employeeName}
            </span>
            {row.employeeEmail && (
              <span className="block truncate text-[11.5px] text-[#64748B]" title={row.employeeEmail}>
                {row.employeeEmail}
              </span>
            )}
          </span>
        </span>
      </td>
      <td className="min-w-[180px] max-w-[280px] px-3 py-2.5">
        <span className="block font-semibold text-[#0B1F44]">{leaveLabel(row)}</span>
        {row.reason && <span className="mt-0.5 block text-[12px] leading-snug text-[#475569]">{row.reason}</span>}
        {row.status !== "pending" && row.decidedAt && (
          <span className="mt-0.5 block text-[11.5px] text-[#64748B]">
            {LEAVE_STATUS_LABELS[row.status]}
            {row.decidedByName ? ` by ${row.decidedByName}` : ""} on {fmtDate(row.decidedAt)}
          </span>
        )}
        {row.decisionNote && <span className="block text-[11.5px] text-[#64748B]">Remarks: {row.decisionNote}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[#334155]">
        {fmtDate(row.startDate)} → {fmtDate(row.endDate)}
      </td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#0B1F44]">{row.days}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-[#334155]">
        <span className="block tabular-nums">{fmtDate(row.createdAt)}</span>
        {row.approverName && <span className="block text-[11.5px] text-[#64748B]">Approver: {row.approverName}</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: style.bg, color: style.fg }}>
          {LEAVE_STATUS_LABELS[row.status]}
        </span>
      </td>
      {canDecide && (
        <td className="px-3 py-2">
          {showActions ? (
            <div className="grid w-[212px] grid-cols-2 gap-1.5">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                placeholder="Remarks (required to reject)"
                aria-label="Remarks"
                className="col-span-2 h-8 w-full rounded-lg border border-[#D6DEEB] bg-white px-2 text-[12px] text-[#0B1F44] placeholder:text-[#94A3B8] focus:border-[#0A6CFF] focus:outline-none focus:ring-[3px] focus:ring-[#0A6CFF]/15"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => decide("approved")}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-[#16A34A] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#15803D] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#16A34A]/25 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => decide("rejected")}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-[#F3C4C4] bg-white px-3 text-[12.5px] font-semibold text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#B91C1C]/15 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          ) : (
            <span className="text-[#94A3B8]">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

function LeaveCard({
  row,
  mode,
  canDecide,
}: {
  row: LeaveRow & { employeeEmail?: string | null };
  mode: "mine" | "pending";
  canDecide: boolean;
}) {
  const router = useRouter();
  const { note, setNote, pending, startTransition, decide } = useLeaveDecision(row.id);
  const style = STATUS_STYLE[row.status];

  function cancel() {
    startTransition(async () => {
      const res = await cancelLeave({ id: row.id });
      if (!res.ok) {
        fireToast({ message: res.error, type: "error" });
        return;
      }
      fireToast({ message: "Request cancelled." });
      router.refresh();
    });
  }

  const canCancelMine = mode === "mine" && row.status === "pending";
  const showAdminActions = mode === "pending" && row.status === "pending" && canDecide;

  return (
    <li
      id={`leave-${row.id}`}
      className="rounded-section bg-surface-card p-5 max-md:p-4 scroll-mt-24"
      style={{
        border: "1px solid var(--color-hairline)",
        boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[16px] font-semibold text-ink-strong">
              {row.leaveType
                ? `${LEAVE_TYPE_LABELS[row.leaveType]} leave`
                : row.kind
                  ? LEAVE_KIND_LABELS[row.kind]
                  : "Leave"}
            </span>
            <span
              className="rounded-pill px-2.5 py-0.5 text-[12px] font-bold"
              style={{ background: style.bg, color: style.fg }}
            >
              {LEAVE_STATUS_LABELS[row.status]}
            </span>
          </div>
          <p className="text-[14px] text-ink-soft mt-1.5 tabular-nums">
            {fmtDate(row.startDate)} → {fmtDate(row.endDate)}
            <span className="text-ink-subtle">
              {" "}· {row.days} day{row.days === 1 ? "" : "s"}
            </span>
          </p>
          {mode === "pending" && (
            <p className="text-[13.5px] text-ink-subtle mt-1">
              {row.employeeName}
              {row.employeeEmail ? ` · ${row.employeeEmail}` : ""}
            </p>
          )}
          {row.reason && (
            <p className="text-[13.5px] text-ink-soft mt-1.5" style={{ lineHeight: 1.5 }}>
              {row.reason}
            </p>
          )}
          <p className="text-[12.5px] text-ink-subtle mt-1.5">
            Submitted {fmtDate(row.createdAt)}
            {row.approverName ? ` · Approver: ${row.approverName}` : ""}
          </p>
          {row.status !== "pending" && row.decidedAt && (
            <p className="text-[12.5px] text-ink-subtle mt-0.5">
              {LEAVE_STATUS_LABELS[row.status]}
              {row.decidedByName ? ` by ${row.decidedByName}` : ""} on{" "}
              {fmtDate(row.decidedAt)}
            </p>
          )}
          {row.decisionNote && (
            <p className="text-[13px] text-ink-subtle mt-1.5">
              Remarks: {row.decisionNote}
            </p>
          )}
        </div>

        {(canCancelMine || showAdminActions) && (
          <div className="flex flex-col items-end gap-2">
            {showAdminActions && (
              <>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  placeholder="Remarks (required to reject)"
                  aria-label="Remarks"
                  className="w-44 rounded-md border border-[#CBD5E1] px-2.5 py-1.5 text-[13px]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide("approved")}
                    className="rounded-md px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #16A34A, #15803D)" }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide("rejected")}
                    className="rounded-md px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50"
                    style={{
                      background: "rgba(10,108,255,0.08)",
                      color: "#0751BE",
                      border: "1px solid rgba(10,108,255,0.25)",
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
            {canCancelMine && (
              <button
                type="button"
                disabled={pending}
                onClick={cancel}
                className="rounded-md px-3.5 py-2 text-[13px] font-semibold text-ink-soft hover:text-ink-strong disabled:opacity-50"
                style={{ border: "1px solid var(--color-hairline)" }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
