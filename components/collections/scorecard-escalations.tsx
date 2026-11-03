"use client";

import * as React from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fmtDateTime } from "@/lib/dates";
import { getScorecardEscalations, type ScorecardEscalationRow } from "@/app/(collection-module)/collection/scorecard-actions";

/**
 * One of the scorecard's two escalation metrics, clickable: the number opens
 * the very records it counts (read on the server, for the signed-in
 * salesperson's own card). "escalated" lists every escalation of their
 * companies; "resolved" only those closed by a reviewer. Each list has its own
 * title, columns, empty, loading and error states, and a close action.
 */
export type EscalationMetric = "escalated" | "resolved";

export function EscalationMetricButton({ metric, label, count }: { metric: EscalationMetric; label: string; count: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label}: ${count.toLocaleString("en-IN")}. Show the entries`}
        className="group -mx-1 block w-[calc(100%+0.5rem)] cursor-pointer rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[#F3F6FA] focus-visible:outline-2 focus-visible:outline-[#0A6CFF]"
        data-scorecard-metric={metric}
      >
        <span className="block text-[11px] font-semibold leading-tight text-ink-subtle underline-offset-2 group-hover:underline">{label}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[16px] font-bold tabular-nums text-[#0B4FB8]">
          {count.toLocaleString("en-IN")}
          <ChevronRight size={14} aria-hidden className="opacity-60 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
      {open && <EscalationEntriesDialog metric={metric} label={label} expected={count} onClose={() => setOpen(false)} />}
    </div>
  );
}

type Load = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; rows: ScorecardEscalationRow[]; reasonsVisible: boolean };

function EscalationEntriesDialog({ metric, label, expected, onClose }: { metric: EscalationMetric; label: string; expected: number; onClose: () => void }) {
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    getScorecardEscalations({ metric })
      .then((res) => {
        if (cancelled) return;
        setLoad(res.ok ? { state: "ok", rows: res.rows, reasonsVisible: res.reasonsVisible } : { state: "error", error: res.error });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "error", error: "The entries couldn't be loaded. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [metric, attempt]);

  const solved = metric === "resolved";
  const count = load.state === "ok" ? load.rows.length : expected;
  return (
    <CenterDialog
      open
      title={label}
      subtitle={`${count.toLocaleString("en-IN")} ${count === 1 ? "entry" : "entries"} · ${solved ? "escalations of your companies closed by the reviewer" : "every escalation of your companies, open and closed"}`}
      onClose={onClose}
      accentBar={solved ? "linear-gradient(90deg, #059669 0%, #047857 100%)" : "linear-gradient(90deg, #EA580C 0%, #C2410C 100%)"}
      width={980}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong hover:bg-[#F3F6FA]">
            Back to the Tracker
          </button>
        </div>
      }
    >
      {load.state === "loading" ? (
        <p role="status" className="flex items-center gap-2 py-6 text-[13.5px] text-ink-subtle">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Loading the entries…
        </p>
      ) : load.state === "error" ? (
        <div role="alert" className="py-4 text-[13.5px] font-semibold text-[#B91C1C]">
          {load.error}{" "}
          <button type="button" className="ml-1 underline" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>
            Try again
          </button>
        </div>
      ) : load.rows.length === 0 ? (
        <p className="py-6 text-[13.5px] text-ink-subtle">{solved ? "No escalated entry of your companies has been solved by the reviewer yet." : "None of your companies has been escalated."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]" aria-label={label}>
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
                <th className="px-2 py-1.5">Company</th>
                <th className="px-2 py-1.5">Sales Coordinator</th>
                <th className="px-2 py-1.5">Escalation Reason</th>
                <th className="px-2 py-1.5">Escalated By</th>
                <th className="px-2 py-1.5">Escalated</th>
                <th className="px-2 py-1.5">{solved ? "Solved" : "Status"}</th>
                <th className="px-2 py-1.5">{solved ? "Reviewer Comment" : "Latest Reviewer Comment"}</th>
              </tr>
            </thead>
            <tbody>
              {load.rows.map((r) => (
                <tr key={r.id} className="border-t border-hairline align-top" data-escalation-status={r.status}>
                  <td className="px-2 py-2 font-semibold text-ink-strong">{r.companyName}</td>
                  <td className="px-2 py-2">{r.salesCoordinator ?? <span className="text-ink-subtle">Unassigned</span>}</td>
                  <td className="max-w-[240px] whitespace-pre-wrap break-words px-2 py-2">
                    {load.reasonsVisible ? r.reason ?? <span className="italic text-ink-subtle">Not recorded</span> : <span className="italic text-ink-subtle">Visible to reviewers</span>}
                  </td>
                  <td className="px-2 py-2">{r.escalatedByName ?? <span className="text-ink-subtle">Not on record</span>}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtDateTime(r.escalatedAt)}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {solved ? (
                      <span className="tabular-nums">
                        {r.closedAt ? fmtDateTime(r.closedAt) : "—"}
                        {r.closedByName && <span className="block text-[12px] text-ink-subtle">by {r.closedByName}</span>}
                      </span>
                    ) : r.status === "open" ? (
                      <span className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[11.5px] font-bold text-[#9A3412]">Open</span>
                    ) : (
                      <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11.5px] font-bold text-[#047857]" title={r.closedAt ? `Closed ${fmtDateTime(r.closedAt)}${r.closedByName ? ` by ${r.closedByName}` : ""}` : undefined}>
                        Closed
                      </span>
                    )}
                  </td>
                  <td className="max-w-[260px] whitespace-pre-wrap break-words px-2 py-2">
                    {r.latestReviewerComment ? (
                      <span className="block rounded-md border-l-4 border-[#7C3AED] bg-[#F5F3FF] px-2 py-1">
                        <span className="block text-[11px] font-bold text-[#5B21B6]">{r.latestReviewerComment.byName ?? "Reviewer"} · {fmtDateTime(r.latestReviewerComment.at)}</span>
                        {r.latestReviewerComment.note}
                      </span>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CenterDialog>
  );
}
