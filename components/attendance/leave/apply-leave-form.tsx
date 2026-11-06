"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { DateField } from "@/components/ui/date-field";
import { LEAVE_TYPES, LEAVE_TYPE_LABELS, type LeaveType } from "@/db/enums";
import { applyForLeave } from "@/app/(app)/attendance/leave/actions";
import { inclusiveLeaveDays } from "@/lib/leave/workflow";

/*
 * The WMS module's white-and-blue language: navy text, pale blue-grey borders and
 * fills, the WMS blue (#0A6CFF) for focus, selection and the primary button.
 * Compact: 38px controls, 13.5px text, 13px labels.
 */
const FIELD =
  "h-[38px] w-full rounded-lg border border-[#D6DEEB] bg-white px-3 text-[13.5px] text-[#0B1F44] transition-[border-color,box-shadow] duration-150 placeholder:text-[#94A3B8] hover:border-[#B9C6DB] focus:border-[#0A6CFF] focus:outline-none focus:ring-[3px] focus:ring-[#0A6CFF]/15";
/** Shown, never edited (the server takes these from the session and the configured approver). `!` so it beats FIELD. */
const READONLY = "cursor-default !border-[#E1E7F0] !bg-[#F5F8FC] !text-[#475569] focus:!ring-0";
const BLUE = "#0A6CFF";

/**
 * Apply for Leave.
 *
 * The name and approver are shown, not edited: the server takes the employee from
 * the session and the approver from the configured default, so nothing here can
 * file leave for someone else or route it elsewhere. The day count is the
 * inclusive calendar span, shown live; the server recomputes it.
 */
export function ApplyLeaveForm({
  employeeName,
  approverName,
}: {
  employeeName: string;
  /** The configured default approver, or null — then requests go to the admins. */
  approverName: string | null;
}) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A second click inside the same tick can land before `pending` re-renders.
  const inFlight = useRef(false);

  const days = from && to ? inclusiveLeaveDays(from, to) : null;
  const datesBackwards = Boolean(from && to && to < from);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!from || !to) return setError("Choose both leave dates.");
    if (datesBackwards) return setError("Leave To Date can't be before Leave From Date.");
    if (!leaveType) return setError("Choose Emergency or Planned.");
    if (!reason.trim()) return setError("Reason for leave is required.");

    inFlight.current = true;
    startTransition(async () => {
      try {
        const res = await applyForLeave({
          startDate: from,
          endDate: to,
          leaveType,
          reason: reason.trim(),
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        fireToast({
          message: res.notified
            ? `Leave application submitted to ${res.routedTo}.`
            : `Leave application saved for ${res.routedTo}, but they could not be notified — it is in their pending list.`,
          type: res.notified ? "success" : "info",
        });
        setFrom("");
        setTo("");
        setLeaveType("");
        setReason("");
        router.refresh();
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="new-leave-heading" className="min-w-0">
      {/* Same heading style as "My leave applications" beside it, so the two columns line up. */}
      <h2 id="new-leave-heading" className="mb-2 text-[15px] font-semibold text-[#0B1F44]">
        New application
      </h2>
      <div className="rounded-xl bg-white" style={{ border: "1px solid #DCE4F0", boxShadow: "0 1px 2px rgba(11,31,68,0.05)" }}>
      <form onSubmit={onSubmit} noValidate aria-label="Leave application">
        <div className="grid grid-cols-12 gap-x-3.5 gap-y-3.5 px-5 pb-4 pt-4 max-md:grid-cols-1 max-md:px-4">
          {/* Row 1 — who */}
          <Field label="Employee Name" htmlFor="lv-name" className="col-span-6">
            <input id="lv-name" value={employeeName} readOnly className={`${FIELD} ${READONLY}`} />
          </Field>
          <Field label="Approver" htmlFor="lv-approver" className="col-span-6">
            <input id="lv-approver" readOnly value={approverName ?? "Admins"} className={`${FIELD} ${READONLY}`} />
            {!approverName && <Hint>No default approver is set, so your application will go to the admins.</Hint>}
          </Field>

          {/* Row 2 — when */}
          <Field label="Leave From Date" htmlFor="lv-from" className="col-span-4">
            <DateField
              id="lv-from"
              required
              value={from}
              onChange={(v) => {
                setFrom(v);
                if (to && to < v) setTo(v);
              }}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
          <Field label="Leave To Date" htmlFor="lv-to" className="col-span-4">
            <DateField
              id="lv-to"
              required
              value={to}
              min={from || undefined}
              onChange={setTo}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
          <Field label="Number of Leave Days" htmlFor="lv-days" className="col-span-4">
            <output
              id="lv-days"
              aria-live="polite"
              className="flex h-[38px] items-center rounded-lg px-3 text-[13.5px] font-semibold tabular-nums"
              style={days === null ? { background: "#F5F8FC", color: "#94A3B8", border: "1px solid #E1E7F0" } : { background: "#EEF4FF", color: "#0B4FB8", border: "1px solid #C9DAFB" }}
            >
              {days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`}
            </output>
          </Field>
          <p className="col-span-12 -mt-2 text-[12px] text-[#64748B] max-md:col-span-1">
            Both dates are counted. Sundays and holidays are not taken out here.
          </p>

          {/* Row 3 — what kind */}
          <fieldset className="col-span-12 max-md:col-span-1">
            <legend className="mb-1.5 block text-[13px] font-semibold text-[#0B1F44]">Type of Leave</legend>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Type of Leave">
              {LEAVE_TYPES.map((t) => {
                const active = leaveType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setLeaveType(t)}
                    className={`inline-flex h-9 min-w-[132px] items-center gap-2 rounded-lg border px-3 text-[13.5px] font-medium transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20 max-sm:flex-1 ${
                      active ? "border-[#0A6CFF] bg-[#EEF4FF] text-[#0B4FB8]" : "border-[#D6DEEB] bg-white text-[#334155] hover:border-[#B9C6DB] hover:bg-[#F8FAFD]"
                    }`}
                  >
                    {/* radio dot */}
                    <span
                      aria-hidden
                      className="grid size-4 shrink-0 place-items-center rounded-full border transition-colors"
                      style={active ? { borderColor: BLUE, background: "#fff" } : { borderColor: "#B9C6DB", background: "#fff" }}
                    >
                      {active && <span className="size-2 rounded-full" style={{ background: BLUE }} />}
                    </span>
                    {LEAVE_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Remaining — why */}
          <Field label="Reason for Leave" htmlFor="lv-reason" className="col-span-12">
            <textarea
              id="lv-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={3}
              className={`${FIELD} !h-[88px] min-h-[80px] resize-y py-2 leading-snug`}
            />
          </Field>

          {error && (
            <div role="alert" className="col-span-12 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13.5px] text-[#B91C1C] max-md:col-span-1">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-[#E6ECF5] px-5 py-3 max-md:px-4">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#0A6CFF] px-4 text-[13.5px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] transition-[background-color,box-shadow] duration-150 hover:bg-[#0058D6] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/30 disabled:cursor-not-allowed disabled:bg-[#5B9BFF] max-sm:w-full"
          >
            {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {pending ? "Submitting…" : "Submit Leave Application"}
          </button>
        </div>
      </form>
      </div>
    </section>
  );
}

function Field({ label, htmlFor, className = "", children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 max-md:col-span-1 ${className}`}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-[#0B1F44]">
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[12px] leading-snug text-[#64748B]">{children}</p>;
}
