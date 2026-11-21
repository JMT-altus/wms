"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { BLUE, rs, type CalcCat } from "@/components/admin/master/incentive-rules/calc-ui";
import type { CarryBalance } from "@/lib/queries/incentive-calc";
import type { MonthRow } from "@/lib/queries/incentive-manage";
import { CategoryName, Empty, FilterBar, ManageHeader, MonthStatus, NotReadyList, TableCard, approvalsHref, calcHref } from "./manage-ui";
import { historyMatches, historyStatuses } from "./options";
import { fmtDay, fmtMonth } from "./stages";

const ADJUSTMENT_KIND: Record<string, string> = {
  "recalc-difference": "Recalculation difference",
  "negative-carry": "Negative balance carried",
  "write-off": "Written off",
  "salary-recovery": "Recovered from salary",
  "recovery-write-off": "Recovery written off",
};
const CARRY_KIND: Record<string, string> = { released: "Released", offset: "Offset against a recovery", expired: "Expired", "written-off": "Written off" };

export interface HistoryAdjustment {
  id: string;
  programCode: string;
  category: string;
  fromMonth: string;
  toMonth: string | null;
  employeeName: string;
  kind: string;
  amountPaise: number;
  monthsLeft: number | null;
  note: string;
  createdAt: string;
}

export interface HistoryProps {
  programs: { id: string; code: string; name: string }[];
  program: string;
  rows: MonthRow[];
  notReady: CalcCat[];
  filters: { category: string | null; status: string; month: string | null; employee: string | null };
  employees: { key: string; name: string }[];
  /** How many times each month was calculated (key: programId|category|yyyy-mm-01). */
  runCounts: Record<string, { runs: number; blocked: number }>;
  adjustments: HistoryAdjustment[];
  carry: { programCode: string; programId: string; category: CalcCat; balances: CarryBalance[] }[];
  showApprovals: boolean;
  showPayouts: boolean;
}

/**
 * Incentive Management → History & Reconciliation: every month of Categories A–G with its calculations, Incentive
 * Approval decisions (rejections included), voids and payouts, and every adjustment and carried-forward balance.
 * Read only: nothing is hidden and nothing can be changed from here.
 */
export function ManageHistory(p: HistoryProps) {
  const f = p.filters;
  const person = f.employee ? p.employees.find((e) => e.key === f.employee) : null;
  const inScope = (category: string, month: string) => (!f.category || category === f.category) && (!f.month || month.slice(0, 7) === f.month.slice(0, 7));
  const months = p.rows.filter((r) => inScope(r.category, r.month) && (!person || r.employees.some((e) => e.key === person.key)) && historyMatches(r, f.status));
  const rejections = months.flatMap((r) => r.decisions.filter((d) => d.decision === "reject").map((d) => ({ r, d })));
  const voids = months.filter((r) => r.voided);
  const adjustments = p.adjustments.filter((a) => (!f.category || a.category === f.category) && (!f.month || a.fromMonth.slice(0, 7) === f.month.slice(0, 7) || a.toMonth?.slice(0, 7) === f.month.slice(0, 7)) && (!person || a.employeeName === person.name));
  const carry = p.carry
    .filter((c) => !f.category || c.category === f.category)
    .flatMap((c) => c.balances.filter((b) => (!person || b.employeeName === person.name) && (!f.month || b.month.slice(0, 7) === f.month.slice(0, 7) || b.entries.some((e) => e.month.slice(0, 7) === f.month!.slice(0, 7)))).map((b) => ({ c, b })));

  return (
    <div>
      <ManageHeader section="history" keep={{ program: p.program, month: f.month?.slice(0, 7) }} />
      <FilterBar action="/incentive/manage/history" programs={p.programs} values={{ program: p.program, month: f.month, category: f.category, status: f.status, employee: f.employee }} allPrograms month="optional" category statuses={historyStatuses(p.showApprovals)} employees={p.employees} />
      <NotReadyList categories={p.notReady} />
      {!p.programs.length ? (
        <Empty>No incentive programme yet.</Empty>
      ) : (
        <div className="grid gap-5">
          <section aria-label="Months">
            <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
              Months <span className="font-normal text-ink-muted">· {months.length}</span>
            </h2>
            <TableCard label="Months and their history" minWidth={1120} head={["Month", "Programme", "Category", "Status", "Calculations", "Adopted calculation", "Incentive Approval", "Payout", ""]}>
              {!months.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-ink-muted">
                    Nothing matches these filters.
                  </td>
                </tr>
              )}
              {months.map((r) => {
                const n = p.runCounts[`${r.programId}|${r.category}|${r.month}`];
                const mine = person ? r.employees.find((e) => e.key === person.key) : null;
                return (
                  <tr key={r.key} className="border-t border-hairline align-top" aria-label={`Category ${r.category} ${r.month.slice(0, 7)}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink-strong">{fmtMonth(r.month)}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.programCode}</td>
                    <td className="px-3 py-2">
                      <CategoryName category={r.category} />
                    </td>
                    <td className="px-3 py-2">
                      <MonthStatus status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      {n ? (
                        <>
                          {n.runs} calculation{n.runs === 1 ? "" : "s"}
                          {n.blocked ? <span className="block text-[11.5px] text-[#B91C1C]">{n.blocked} blocked</span> : null}
                        </>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.run ? (
                        <>
                          <span className="font-semibold text-ink-strong">{mine ? rs(mine.payablePaise) : rs(r.approvedTotalPaise)}</span>
                          {mine ? ` (${mine.name})` : ` to ${r.run.salespeople} ${r.run.salespeople === 1 ? "salesperson" : "salespeople"}`}
                          <span className="block text-[11.5px] text-ink-subtle">
                            version {r.run.configVersionNo} · as of {fmtDay(r.run.asOf)}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-subtle">None adopted</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.submittedAt ? (
                        <>
                          Submission {r.submissionNo}
                          {r.approvalsRequired ? `, ${r.approvalsRequired} step${r.approvalsRequired === 1 ? "" : "s"}` : ""}
                          <span className="block text-[11.5px] text-ink-subtle">
                            last by {r.submittedByName ?? "—"}, {fmtDay(r.submittedAt)}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-subtle">Not submitted</span>
                      )}
                      {p.showApprovals && !!r.decisions.length && (
                        <details className="mt-1 text-[11.5px] text-ink-muted">
                          <summary className="cursor-pointer">Decisions ({r.decisions.length})</summary>
                          <ul>
                            {r.decisions.map((d) => (
                              <li key={`${d.submissionNo}-${d.stepNo}`}>
                                Submission {d.submissionNo}, step {d.stepNo}: {d.decision === "approve" ? "approved" : "rejected"} by {d.actorName}, {fmtDay(d.at)}
                                {d.reason ? ` — ${d.reason}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "paid" ? (
                        p.showPayouts && r.payout ? (
                          <>
                            <span className="font-semibold text-ink-strong">{r.payout.reference}</span> · {rs(r.payout.totalPaise)}
                            <span className="block text-[11.5px] text-ink-subtle">paid {fmtDay(r.payout.paidOn)} · {r.payout.recordedByName}</span>
                          </>
                        ) : (
                          "Paid"
                        )
                      ) : r.status === "voided" ? (
                        <span className="text-ink-subtle">Never paid (voided)</span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-[12px]">
                      <Link href={calcHref(r.category, r.programId, r.month) as Route} className="font-bold underline-offset-2 hover:underline" style={{ color: BLUE }} aria-label={`Open Category ${r.category}, ${fmtMonth(r.month)}`}>
                        Open
                      </Link>
                      <span className="text-ink-subtle"> · </span>
                      <Link href={approvalsHref(r.category, r.programId) as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
                        Approvals
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </TableCard>
            <p className="mt-1.5 text-[12px] text-ink-muted">Every calculation of a month — adopted or not, blocked or not — and its inputs, hashes and explanations are listed on the month&apos;s Calculation screen.</p>
          </section>

          {p.showApprovals && (
            <section aria-label="Rejections">
              <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
                Rejected submissions <span className="font-normal text-ink-muted">· {rejections.length}</span>
              </h2>
              <TableCard label="Rejected submissions" minWidth={820} head={["Month", "Programme", "Category", "Submission", "Rejected by", "On", "Reason"]}>
                {!rejections.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-ink-muted">
                      No rejected submission.
                    </td>
                  </tr>
                )}
                {rejections.map(({ r, d }) => (
                  <tr key={`${r.key}-${d.submissionNo}-${d.stepNo}`} className="border-t border-hairline align-top">
                    <td className="px-3 py-2 font-semibold text-ink-strong">{fmtMonth(r.month)}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.programCode}</td>
                    <td className="px-3 py-2">Category {r.category}</td>
                    <td className="px-3 py-2">
                      {d.submissionNo}, step {d.stepNo}
                    </td>
                    <td className="px-3 py-2">{d.actorName}</td>
                    <td className="px-3 py-2">{fmtDay(d.at)}</td>
                    <td className="px-3 py-2">{d.reason ?? "—"}</td>
                  </tr>
                ))}
              </TableCard>
            </section>
          )}

          <section aria-label="Voided months">
            <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
              Voided months <span className="font-normal text-ink-muted">· {voids.length}</span>
            </h2>
            <TableCard label="Voided months" minWidth={820} head={["Month", "Programme", "Category", "Voided by", "On", "Reason", "Carried into"]}>
              {!voids.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-ink-muted">
                    No voided month.
                  </td>
                </tr>
              )}
              {voids.map((r) => (
                <tr key={r.key} className="border-t border-hairline align-top">
                  <td className="px-3 py-2 font-semibold text-ink-strong">{fmtMonth(r.month)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.programCode}</td>
                  <td className="px-3 py-2">Category {r.category}</td>
                  <td className="px-3 py-2">{r.voided!.byName}</td>
                  <td className="px-3 py-2">{fmtDay(r.voided!.at)}</td>
                  <td className="px-3 py-2">{r.voided!.reason}</td>
                  <td className="px-3 py-2">{r.voided!.carriedToMonth ? fmtMonth(r.voided!.carriedToMonth) : "—"}</td>
                </tr>
              ))}
            </TableCard>
          </section>

          <section aria-label="Adjustments">
            <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
              Adjustments between months <span className="font-normal text-ink-muted">· {adjustments.length}</span>
            </h2>
            <TableCard label="Adjustments between months" minWidth={980} head={["Recorded", "Programme", "Category", "Salesperson", "Kind", "From", "Into", "Amount", "Note"]}>
              {!adjustments.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-ink-muted">
                    No adjustment.
                  </td>
                </tr>
              )}
              {adjustments.map((a) => (
                <tr key={a.id} className="border-t border-hairline align-top">
                  <td className="whitespace-nowrap px-3 py-2">{fmtDay(a.createdAt)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{a.programCode}</td>
                  <td className="px-3 py-2">Category {a.category}</td>
                  <td className="px-3 py-2 text-ink-strong">{a.employeeName}</td>
                  <td className="px-3 py-2">{ADJUSTMENT_KIND[a.kind] ?? a.kind}</td>
                  <td className="px-3 py-2">{fmtMonth(a.fromMonth)}</td>
                  <td className="px-3 py-2">{a.toMonth ? fmtMonth(a.toMonth) : a.monthsLeft !== null ? `pending (${a.monthsLeft} month${a.monthsLeft === 1 ? "" : "s"} left)` : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: a.amountPaise < 0 ? "#B91C1C" : "var(--color-ink-strong)" }}>
                    {rs(a.amountPaise)}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{a.note}</td>
                </tr>
              ))}
            </TableCard>
          </section>

          <section aria-label="Carried-forward balances">
            <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
              Carried-forward balances <span className="font-normal text-ink-muted">· {carry.length}</span>
            </h2>
            <TableCard label="Carried-forward balances" minWidth={900} head={["Programme", "Category", "Salesperson", "Held in", "Held", "Left", "What happened"]}>
              {!carry.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-ink-muted">
                    No balance carried forward.
                  </td>
                </tr>
              )}
              {carry.map(({ c, b }) => (
                <tr key={b.lotId} className="border-t border-hairline align-top">
                  <td className="px-3 py-2 font-mono text-[12px]">{c.programCode}</td>
                  <td className="px-3 py-2">Category {c.category}</td>
                  <td className="px-3 py-2 text-ink-strong">{b.employeeName}</td>
                  <td className="px-3 py-2">{fmtMonth(b.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rs(b.heldPaise)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{rs(b.remainingPaise)}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {b.entries.length
                      ? b.entries.map((e, i) => (
                          <div key={i}>
                            {CARRY_KIND[e.kind] ?? e.kind} in {fmtMonth(e.month)}: {rs(-e.amountPaise)} ({e.byName}, {fmtDay(e.at)}){e.reason ? ` — “${e.reason}”` : ""}
                          </div>
                        ))
                      : "Carried forward"}
                    {b.writeOffRequest && (
                      <div className="font-semibold text-[#B45309]">
                        Write-off of {rs(b.writeOffRequest.amountPaise)} requested by {b.writeOffRequest.byName} ({fmtDay(b.writeOffRequest.at)}) — awaiting a second person
                      </div>
                    )}
                    {(b.writeOffs ?? []).filter((w) => w.kind === "refuse").map((w, i) => (
                      <div key={`r${i}`}>
                        Write-off refused by {w.byName} ({fmtDay(w.at)}) — “{w.reason}”
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </TableCard>
            <p className="mt-1.5 text-[12px] text-ink-muted">Category C&apos;s carried-forward balances are written off, with a reason, on its Calculation screen (Record payout permission).</p>
          </section>
        </div>
      )}
    </div>
  );
}
