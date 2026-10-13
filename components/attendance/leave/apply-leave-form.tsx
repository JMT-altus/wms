"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import { LEAVE_TYPES, LEAVE_TYPE_LABELS, type LeaveType } from "@/db/enums";
import { applyForLeave } from "@/app/(app)/attendance/leave/actions";
import { inclusiveLeaveDays } from "@/lib/leave/workflow";

const FIELD = "w-full rounded-md border border-[#CBD5E1] px-3.5 py-2.5 text-[15px]";

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
    <section
      className="rounded-section bg-surface-card p-6 max-md:p-5"
      style={{ border: "1px solid var(--color-hairline)", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
    >
      <h2 className="text-[18px] font-semibold text-ink-strong mb-5">Apply for Leave</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Employee Name" htmlFor="lv-name">
          <input id="lv-name" value={employeeName} readOnly className={`${FIELD} bg-surface-soft text-ink-soft`} />
        </Field>

        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <Field label="Leave From Date" htmlFor="lv-from">
            <input
              id="lv-from"
              type="date"
              required
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to && to < e.target.value) setTo(e.target.value);
              }}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
          <Field label="Leave To Date" htmlFor="lv-to">
            <input
              id="lv-to"
              type="date"
              required
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
        </div>

        <Field label="Number of Leave Days" htmlFor="lv-days">
          <output
            id="lv-days"
            aria-live="polite"
            className="block rounded-md bg-surface-soft px-3.5 py-2.5 text-[15px] font-semibold tabular-nums text-ink-strong"
          >
            {days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`}
          </output>
          <p className="mt-1 text-[12.5px] text-ink-subtle">
            Both dates are counted. Sundays and holidays are not taken out here.
          </p>
        </Field>

        <fieldset>
          <legend className="block text-[14px] font-semibold text-[#0F172A] mb-1.5">Type of Leave</legend>
          <div className="flex gap-2 flex-wrap">
            {LEAVE_TYPES.map((t) => {
              const active = leaveType === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLeaveType(t)}
                  className="rounded-md px-4 py-2.5 text-[14px] font-semibold transition-colors"
                  style={
                    active
                      ? { background: "linear-gradient(135deg, #12B3A0, #0C7C6F)", color: "#fff" }
                      : {
                          background: "var(--color-surface-soft)",
                          color: "var(--color-ink-soft)",
                          border: "1px solid var(--color-hairline)",
                        }
                  }
                >
                  {LEAVE_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Field label="Reason for Leave" htmlFor="lv-reason">
          <textarea
            id="lv-reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            className={FIELD}
          />
        </Field>

        <Field label="Approver" htmlFor="lv-approver">
          <input
            id="lv-approver"
            readOnly
            value={approverName ?? "Admins"}
            className={`${FIELD} bg-surface-soft text-ink-soft`}
          />
          {!approverName && (
            <p className="mt-1 text-[12.5px] text-ink-subtle">
              No default approver is set, so your application will go to the admins.
            </p>
          )}
        </Field>

        {error && (
          <div role="alert" className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[14px] text-[#B91C1C]">
            {error}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md py-2.5 px-6 text-[14px] font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #12B3A0, #0C7C6F)" }}
          >
            {pending ? "Submitting…" : "Submit Leave Application"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[14px] font-semibold text-[#0F172A] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
