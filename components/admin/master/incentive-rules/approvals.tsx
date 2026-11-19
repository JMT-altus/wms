"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { BLUE, CARD, FIELD, NotReady, day, rs, type CalcCat } from "./calc-ui";

/**
 * Approvals: every calculated month of a programme — its status, calculation, who submitted it and when, the current
 * approval step and who may take it (by rule: anyone holding Approve except the submitter and earlier approvers —
 * nobody is named), the approval and rejection history with reasons, whether it is eligible for payout (approved and
 * on or after its release date), and its payout reference. Acting on a month happens on its Calculation page.
 */

export interface ApprovalsProps {
  /** Where the Calculation screen lives for month links (Admin & Master Setup or the Incentive Tracker). */
  basePath?: string;
  /** Added to every link (Category B in Admin & Master Setup: "&category=B"). */
  extraQuery?: string;
  /** The category shown, so a missing database update is named correctly (A: 0132/0133; B: 0134; C–G: 0134 + 0135). */
  category?: CalcCat;
  ready: boolean;
  today: string;
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  showApprovals: boolean;
  showPayouts: boolean;
  periods: {
    id: string;
    month: string;
    status: string;
    run: { configVersionNo: number | null; asOf: string; salespeople: number; payablePaise: number } | null;
    approvedTotalPaise: number | null;
    submissionNo: number;
    submittedByName: string | null;
    submittedAt: string | null;
    approvalsRequired: number | null;
    approvals: { submissionNo: number; stepNo: number; decision: string; reason: string | null; actorName: string; at: string }[];
    releaseOn: string | null;
    payout: { reference: string; paidOn: string; totalPaise: number; recordedByName: string; lines?: { employeeName: string; payablePaise: number; adjustmentsPaise: number; amountPaise: number }[] } | null;
    /** Category C: the month was voided (its status then reads "voided"). */
    voided?: { reason: string; byName: string; at: string; carriedToMonth: string | null } | null;
  }[];
}

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "#475569", bg: "#F1F5F9" },
  locked: { label: "Locked", color: "#1E40AF", bg: "#EFF6FF" },
  submitted: { label: "Awaiting approval", color: "#B45309", bg: "#FFFBEB" },
  approved: { label: "Approved", color: "#047857", bg: "#ECFDF5" },
  paid: { label: "Paid", color: "#334155", bg: "#E2E8F0" },
  voided: { label: "Voided", color: "#B91C1C", bg: "#FEF2F2" },
};
const monthLabel = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function Approvals(p: ApprovalsProps) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"all" | "action" | "paid">("all");
  if (!p.ready) return <NotReady category={p.category ?? "A"} />;
  const shown = p.periods.filter((x) => (filter === "action" ? x.status === "submitted" || x.status === "approved" : filter === "paid" ? x.status === "paid" : true));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <select className={FIELD} value={p.programId ?? ""} onChange={(e) => router.push(`${p.basePath ?? "/master-setup/incentive-rules/calculation"}/approvals?program=${e.target.value}${p.extraQuery ?? ""}` as Route)} aria-label="Programme">
          {!p.programs.length && <option value="">No programme yet</option>}
          {p.programs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.code} · {x.name}
            </option>
          ))}
        </select>
        <select className={FIELD} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show">
          <option value="all">All months</option>
          <option value="action">Awaiting approval or payout</option>
          <option value="paid">Paid</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
        <table className="w-full text-[12.5px]" style={{ minWidth: 980 }} aria-label="Months and their approval">
          <thead>
            <tr className="text-left text-ink-subtle">
              {["Month", "Status", "Calculation", "Submitted", "Approval", "Payout"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!shown.length && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-ink-muted">
                  No calculated month to show.
                </td>
              </tr>
            )}
            {shown.map((x) => {
              const st = STATUS[x.status] ?? STATUS.open!;
              const current = x.approvals.filter((a) => a.submissionNo === x.submissionNo);
              const rejection = [...x.approvals].reverse().find((a) => a.decision === "reject");
              const eligible = x.status === "approved" && !!x.releaseOn && x.releaseOn <= p.today;
              return (
                <tr key={x.id} className="border-t border-hairline align-top" aria-label={`Month ${x.month.slice(0, 7)}`}>
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`${p.basePath ?? "/master-setup/incentive-rules/calculation"}?program=${p.programId}&month=${x.month.slice(0, 7)}${p.extraQuery ?? ""}` as Route} className="underline-offset-2 hover:underline" style={{ color: BLUE }}>
                      {monthLabel(x.month)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded px-1.5 py-0.5 text-[11.5px] font-bold" style={{ color: st.color, background: st.bg }}>
                      {st.label}
                    </span>
                    {x.voided && (
                      <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                        by {x.voided.byName}, {day(x.voided.at)}: {x.voided.reason}
                        {x.voided.carriedToMonth ? ` (carried into ${x.voided.carriedToMonth.slice(0, 7)})` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {x.run ? (
                      <>
                        <span className="font-semibold text-ink-strong">{rs(x.approvedTotalPaise)}</span> to {x.run.salespeople} salesperson{x.run.salespeople === 1 ? "" : "s"}
                        <span className="block text-[11.5px] text-ink-subtle">
                          version {x.run.configVersionNo} · as of {day(x.run.asOf)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-subtle">Not calculated</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{x.submittedAt ? <>{x.submittedByName ?? "—"}<span className="block text-[11.5px] text-ink-subtle">{day(x.submittedAt)}{x.submissionNo > 1 ? ` · submission ${x.submissionNo}` : ""}</span></> : "—"}</td>
                  <td className="px-3 py-2">
                    {x.status === "submitted" && (
                      <span className="font-semibold text-[#B45309]">
                        Step {current.length + 1} of {x.approvalsRequired}: any approver other than {[x.submittedByName ?? "the submitter", ...current.map((a) => a.actorName)].join(", ")}
                      </span>
                    )}
                    {(x.status === "approved" || x.status === "paid") && <span className="text-ink-strong">All {x.approvalsRequired} approved</span>}
                    {p.showApprovals && rejection && x.status !== "approved" && x.status !== "paid" && (
                      <span className="block text-[11.5px] text-[#B91C1C]">
                        Rejected by {rejection.actorName} ({day(rejection.at)}): {rejection.reason}
                      </span>
                    )}
                    {p.showApprovals && !!x.approvals.length && (
                      <details className="mt-1 text-[11.5px] text-ink-muted">
                        <summary className="cursor-pointer">History ({x.approvals.length})</summary>
                        <ul>
                          {x.approvals.map((a) => (
                            <li key={`${a.submissionNo}-${a.stepNo}`}>
                              Submission {a.submissionNo}, step {a.stepNo}: {a.decision === "approve" ? "approved" : "rejected"} by {a.actorName}, {day(a.at)}
                              {a.reason ? ` — ${a.reason}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {x.status === "paid" && p.showPayouts && x.payout ? (
                      <>
                        <span className="font-semibold text-ink-strong">{x.payout.reference}</span> · {rs(x.payout.totalPaise)}
                        <span className="block text-[11.5px] text-ink-subtle">
                          paid {day(x.payout.paidOn)} · recorded by {x.payout.recordedByName}
                        </span>
                        {!!x.payout.lines?.length && (
                          <details className="mt-1 text-[11.5px] text-ink-muted">
                            <summary className="cursor-pointer">Payout lines ({x.payout.lines.length})</summary>
                            <ul>
                              {x.payout.lines.map((l) => (
                                <li key={l.employeeName}>
                                  {l.employeeName}: {rs(l.amountPaise)} (payable {rs(l.payablePaise)}{l.adjustmentsPaise ? `, carried ${rs(l.adjustmentsPaise)}` : ""})
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : x.status === "paid" ? (
                      "Paid"
                    ) : x.status === "voided" ? (
                      <span className="text-ink-subtle">Never paid (voided)</span>
                    ) : x.status === "approved" ? (
                      <span className={eligible ? "font-semibold text-[#047857]" : "text-[#B45309]"}>{eligible ? `Eligible since ${day(x.releaseOn)}` : `Eligible from ${day(x.releaseOn)}`}</span>
                    ) : (
                      <span className="text-ink-subtle">Not yet approved</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
