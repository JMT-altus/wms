"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { decideCategoryAMonth, recordCategoryAPayout, submitCategoryAMonth, withdrawCategoryAMonth } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BLUE, BTN, BTN_PLAIN, CARD, FIELD, Notice, day, rs } from "./calc-ui";

/**
 * A calculated month's approval and payout: submit a LOCKED month; the configured number of approvals follow, each by
 * a different person and never the submitter (the server and the database both refuse it); a rejection (with its
 * reason) returns it to locked; the last approval sets its release date as configured; then the payout is RECORDED
 * with its reference — the WMS moves no money. A paid month is final.
 */

export interface WorkflowProps {
  programId: string;
  month: string;
  me: string;
  rights: { submit: boolean; approve: boolean; pay: boolean; approvals: boolean; payouts: boolean };
  /** What the payout must total; the payer enters the amount paid and it must match. */
  approvedTotalPaise: number | null;
  period: { status: string; rowVersion: number; submissionNo: number; approvalsRequired: number | null; submittedByName: string | null; submittedById: string | null; submittedAt: string | null; releaseOn: string | null; payoutReference: string | null };
  approvals: { id: string; submissionNo: number; stepNo: number; decision: "approve" | "reject"; reason: string | null; actorName: string; actorId: string | null; at: string }[];
  payout: { reference: string; releaseOn: string; paidOn: string; totalPaise: number; recordedByName: string; note: string | null; lines: { employeeName: string; payablePaise: number; adjustmentsPaise: number; amountPaise: number }[] } | null;
  /** The category (absent: Category A). */
  category?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
}

export function CalcWorkflow(p: WorkflowProps) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pay, setPay] = React.useState({ reference: "", paidOn: p.period.releaseOn ?? "", amount: "", note: "" });
  const base = { programId: p.programId, month: p.month, rowVersion: p.period.rowVersion, ...(p.category && p.category !== "A" ? { category: p.category } : {}) };
  const current = p.approvals.filter((a) => a.submissionNo === p.period.submissionNo);
  const iSubmitted = p.period.submittedById === p.me;
  const iApproved = current.some((a) => a.actorId === p.me);

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "bad", text: r.error });
    setMsg({ tone: "ok", text: done });
    setReason("");
    router.refresh();
  }

  const s = p.period.status;
  return (
    <section aria-label="Approval and payout" className="rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Approval and payout</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        {s === "open" && "Lock the month before it can be submitted for approval."}
        {s === "locked" && (p.period.submissionNo ? "Returned to locked; it can be submitted again." : "Locked: it can be submitted for approval.")}
        {s === "submitted" && `Submitted by ${p.period.submittedByName ?? "—"} on ${day(p.period.submittedAt)}: ${current.length} of ${p.period.approvalsRequired} approval${p.period.approvalsRequired === 1 ? "" : "s"} so far.`}
        {s === "approved" && `Approved for ${rs(p.approvedTotalPaise)}. Released on ${day(p.period.releaseOn)}; record the payout once it has been paid (this records it — the WMS moves no money).`}
        {s === "paid" && `Paid — reference ${p.period.payoutReference}. A paid month is final.`}
        {s === "voided" && "Voided — it is never submitted, approved or paid. Its calculations and approval history are kept for the record."}
      </p>
      {msg && (
        <div className="mt-2">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {s === "locked" && p.rights.submit && (
          <button type="button" disabled={busy} className={BTN} style={{ background: BLUE }} onClick={() => run(() => submitCategoryAMonth(base), "Submitted for approval.")}>
            Submit for approval
          </button>
        )}
        {s === "submitted" && p.rights.submit && iSubmitted && !current.length && (
          <button type="button" disabled={busy} className={BTN_PLAIN} onClick={() => run(() => withdrawCategoryAMonth(base), "Submission withdrawn.")}>
            Withdraw
          </button>
        )}
        {s === "submitted" && p.rights.approve && (iSubmitted || iApproved ? (
          <span className="text-[12px] text-ink-subtle">{iSubmitted ? "You submitted it, so another person approves it." : "You approved a step; the next step needs someone else."}</span>
        ) : (
          <>
            <button type="button" disabled={busy} className={BTN} style={{ background: "#047857" }} onClick={() => run(() => decideCategoryAMonth({ ...base, decision: "approve", reason: reason.trim() || null }), "Approved.")}>
              Approve step {current.length + 1}
            </button>
            <input className={`${FIELD} w-64`} placeholder="Reason (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Approval note or rejection reason" maxLength={1000} />
            <button type="button" disabled={busy || !reason.trim()} className={BTN} style={{ background: "#B91C1C" }} onClick={() => run(() => decideCategoryAMonth({ ...base, decision: "reject", reason: reason.trim() }), "Rejected: the month is back to locked.")}>
              Reject
            </button>
          </>
        ))}
        {s === "approved" && p.rights.pay && (
          <>
            <input className={`${FIELD} w-56`} placeholder="Payout reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} aria-label="Payout reference" maxLength={200} />
            <label className="text-[12px] text-ink-muted">
              Paid on <input type="date" className={FIELD} value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} aria-label="Paid on" />
            </label>
            <input className={`${FIELD} w-32`} type="number" min={0} step="0.01" placeholder="Amount paid ₹" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} aria-label="Amount paid" />
            <input className={`${FIELD} w-48`} placeholder="Note (optional)" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} aria-label="Payout note" maxLength={1000} />
            <button type="button" disabled={busy || !pay.reference.trim() || !pay.paidOn || pay.amount === ""} className={BTN} style={{ background: BLUE }} onClick={() => run(() => recordCategoryAPayout({ ...base, reference: pay.reference.trim(), paidOn: pay.paidOn, amountPaise: Math.round(Number(pay.amount) * 100), note: pay.note.trim() || null }), "Payout recorded. The month is paid and final.")}>
              Record payout
            </button>
          </>
        )}
      </div>
      {p.rights.approvals && !!p.approvals.length && (
        <ul className="mt-3 grid gap-0.5 text-[12.5px] text-ink-muted" aria-label="Approval history">
          {p.approvals.map((a) => (
            <li key={a.id}>
              Submission {a.submissionNo}, step {a.stepNo}: <strong className={a.decision === "approve" ? "text-[#047857]" : "text-[#B91C1C]"}>{a.decision === "approve" ? "approved" : "rejected"}</strong> by {a.actorName} on {day(a.at)}
              {a.reason ? ` — ${a.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
      {p.rights.payouts && p.payout && (
        <div className="mt-3 text-[12.5px]">
          <p className="text-ink-muted">
            Payout {p.payout.reference} · released {day(p.payout.releaseOn)} · paid {day(p.payout.paidOn)} · recorded by {p.payout.recordedByName} · total <strong className="text-ink-strong">{rs(p.payout.totalPaise)}</strong>
            {p.payout.note ? ` · ${p.payout.note}` : ""}
          </p>
          <table className="mt-1 w-full max-w-xl" aria-label="Payout lines">
            <thead>
              <tr className="text-left text-ink-subtle">
                {["Salesperson", "Payable", "Carried in", "Paid"].map((h) => (
                  <th key={h} className="px-2 py-1 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.payout.lines.map((l) => (
                <tr key={l.employeeName} className="border-t border-hairline">
                  <td className="px-2 py-1">{l.employeeName}</td>
                  <td className="px-2 py-1 tabular-nums">{rs(l.payablePaise)}</td>
                  <td className="px-2 py-1 tabular-nums">{rs(l.adjustmentsPaise)}</td>
                  <td className="px-2 py-1 font-semibold tabular-nums">{rs(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
