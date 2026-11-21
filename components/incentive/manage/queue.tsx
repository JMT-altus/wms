"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { BLUE, BTN, rs, type CalcCat } from "@/components/admin/master/incentive-rules/calc-ui";
import type { FPending, MonthRow } from "@/lib/queries/incentive-manage";
import { ActionText, CategoryName, Empty, FilterBar, ManageHeader, MonthStatus, NotReadyList, TableCard, TwoApprovals, approvalsHref, calcHref } from "./manage-ui";
import { ReviewsWaiting } from "./overview";
import { queueMatches, queueStatuses } from "./options";
import { fmtDay, fmtMonth, nextAction } from "./stages";

export interface QueueProps {
  programs: { id: string; code: string; name: string }[];
  /** A programme's id, or "all". */
  program: string;
  rows: MonthRow[];
  notReady: CalcCat[];
  today: string;
  filters: { category: string | null; status: string; month: string | null; employee: string | null };
  employees: { key: string; name: string }[];
  showApprovals: boolean;
  /** The month the B / C review counts are for (the month filter, else the current month). */
  reviews: { month: string; programId: string | null; heldA?: number | null; heldB: number | null; heldC: number | null; f: FPending | null };
}

/**
 * Incentive Management → Review & Incentive Approvals: every month that needs review, submission or Incentive
 * Approval, across Categories A–G. Acting on a month opens its Calculation screen, where the existing controls and
 * checks are: the submitter never approves, each step needs a different approver, a rejection needs a reason, and
 * every decision is kept.
 */
export function ManageQueue(p: QueueProps) {
  const f = p.filters;
  const shown = p.rows.filter((r) => (!f.category || r.category === f.category) && (!f.month || r.month.slice(0, 7) === f.month.slice(0, 7)) && (!f.employee || r.employees.some((e) => e.key === f.employee)) && queueMatches(r, f.status));
  const person = f.employee ? p.employees.find((e) => e.key === f.employee) : null;
  return (
    <div>
      <ManageHeader section="approvals" keep={{ program: p.program, month: f.month?.slice(0, 7) }} />
      <TwoApprovals />
      <FilterBar action="/incentive/manage/approvals" programs={p.programs} values={{ program: p.program, month: f.month, category: f.category, status: f.status, employee: f.employee }} allPrograms month="optional" category statuses={queueStatuses(p.showApprovals)} employees={p.employees} />
      <NotReadyList categories={p.notReady} />
      <div className="mb-3">
        <ReviewsWaiting heldA={p.reviews.heldA ?? null} heldB={p.reviews.heldB} heldC={p.reviews.heldC} f={p.reviews.f} programId={p.reviews.programId} month={p.reviews.month} />
      </div>
      {!p.programs.length ? (
        <Empty>No incentive programme yet.</Empty>
      ) : (
        <>
          <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
            Incentive Approval queue <span className="font-normal text-ink-muted">· {shown.length} month{shown.length === 1 ? "" : "s"}{person ? ` · ${person.name}` : ""}</span>
          </h2>
          <TableCard label="Incentive Approval queue" minWidth={1080} head={["Month", "Programme", "Category", person ? "Salesperson" : "Salespeople", person ? "Payable" : "Amount", "Status", "Pending action", ""]}>
            {!shown.length && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-ink-muted">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
            {shown.map((r) => {
              const mine = person ? r.employees.find((e) => e.key === person.key) : null;
              const rejection = p.showApprovals ? [...r.decisions].reverse().find((d) => d.decision === "reject") : undefined;
              // The queue doesn't look up the rules or the latest calculation: their state is on the month's screen.
              const next = nextAction({ ready: true, rules: { versionNo: r.run?.configVersionNo ?? 0 }, latest: null, period: { status: r.status, hasRun: !!r.run, releaseOn: r.releaseOn }, today: p.today }, r.approvalsDone !== null ? { done: r.approvalsDone, required: r.approvalsRequired } : null);
              return (
                <tr key={r.key} className="border-t border-hairline align-top" aria-label={`Category ${r.category} ${r.month.slice(0, 7)}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink-strong">{fmtMonth(r.month)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.programCode}</td>
                  <td className="px-3 py-2">
                    <CategoryName category={r.category} />
                  </td>
                  <td className="px-3 py-2">
                    {mine ? (
                      mine.name
                    ) : r.employees.length ? (
                      <details>
                        <summary className="cursor-pointer">
                          {r.employees.length} {r.employees.length === 1 ? "salesperson" : "salespeople"}
                        </summary>
                        <ul className="mt-1 text-[11.5px] text-ink-muted">
                          {r.employees.map((e) => (
                            <li key={e.key}>
                              {e.name}: {rs(e.payablePaise)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {mine ? (
                      <>
                        <span className="font-semibold text-ink-strong">{rs(mine.payablePaise)}</span>
                        <span className="block text-[11.5px] text-ink-subtle">in the calculation</span>
                      </>
                    ) : (
                      <span className="font-semibold text-ink-strong">{rs(r.approvedTotalPaise)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <MonthStatus status={r.status} />
                    {r.submittedAt && r.status === "submitted" && <span className="mt-0.5 block text-[11.5px] text-ink-subtle">by {r.submittedByName ?? "—"}, {fmtDay(r.submittedAt)}</span>}
                    {rejection && r.status !== "approved" && r.status !== "paid" && (
                      <span className="mt-0.5 block text-[11.5px] text-[#B91C1C]">
                        Rejected by {rejection.actorName} ({fmtDay(rejection.at)}): {rejection.reason}
                      </span>
                    )}
                    {r.voided && <span className="mt-0.5 block text-[11.5px] text-ink-muted">{r.voided.reason}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <ActionText {...next} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="inline-flex flex-col items-end gap-1">
                      <Link href={calcHref(r.category, r.programId, r.month) as Route} className={BTN} style={{ background: BLUE }} aria-label={`Open Category ${r.category}, ${fmtMonth(r.month)}`}>
                        Open to act
                      </Link>
                      <Link href={approvalsHref(r.category, r.programId) as Route} className="text-[12px] font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
                        Approval history
                      </Link>
                    </span>
                  </td>
                </tr>
              );
            })}
          </TableCard>
          <p className="mt-2 text-[12px] text-ink-muted">
            Locking, submitting, approving, rejecting and withdrawing happen on the month&apos;s Calculation screen, with the same checks as before: the person who submitted a month can&apos;t approve it, each further step needs someone who hasn&apos;t approved it yet, a rejection needs a reason, and every decision is kept in the month&apos;s history. Each needs its Incentive Calculation permission in Field Permissions.
          </p>
        </>
      )}
    </div>
  );
}
