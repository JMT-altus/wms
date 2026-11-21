"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { BLUE, BTN, BTN_PLAIN, rs, type CalcCat } from "@/components/admin/master/incentive-rules/calc-ui";
import type { MonthRow } from "@/lib/queries/incentive-manage";
import { CategoryName, Empty, FilterBar, ManageHeader, MonthStatus, NotReadyList, TableCard, Tile, calcHref } from "./manage-ui";
import { PAYMENT_STATUSES, paymentMatches } from "./options";
import { fmtDay, fmtMonth, isReleased } from "./stages";

export interface PaymentsProps {
  programs: { id: string; code: string; name: string }[];
  program: string;
  rows: MonthRow[];
  notReady: CalcCat[];
  today: string;
  filters: { category: string | null; status: string; month: string | null; employee: string | null };
  employees: { key: string; name: string }[];
  showPayouts: boolean;
}

/**
 * Incentive Management → Release & Payments: approved months, their release dates and their payout records, across
 * Categories A–G. A payout is recorded on the month's Calculation screen (Record payout permission, its own checks);
 * the WMS records payouts and moves no money.
 */
export function ManagePayments(p: PaymentsProps) {
  const f = p.filters;
  const base = p.rows.filter((r) => (!f.category || r.category === f.category) && (!f.month || r.month.slice(0, 7) === f.month.slice(0, 7)) && (!f.employee || r.employees.some((e) => e.key === f.employee)));
  const shown = base.filter((r) => paymentMatches(r, f.status, p.today));
  const person = f.employee ? p.employees.find((e) => e.key === f.employee) : null;
  const waiting = base.filter((r) => paymentMatches(r, "waiting", p.today));
  const released = base.filter((r) => paymentMatches(r, "released", p.today));
  const paid = base.filter((r) => r.status === "paid");
  const sum = (rows: MonthRow[], pick: (r: MonthRow) => number | null | undefined) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  return (
    <div>
      <ManageHeader section="payments" keep={{ program: p.program, month: f.month?.slice(0, 7) }} />
      <FilterBar action="/incentive/manage/payments" programs={p.programs} values={{ program: p.program, month: f.month, category: f.category, status: f.status, employee: f.employee }} allPrograms month="optional" category statuses={PAYMENT_STATUSES} employees={p.employees} />
      <NotReadyList categories={p.notReady} />
      {!p.programs.length ? (
        <Empty>No incentive programme yet.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Tile label="Approved — not yet released" value={waiting.length} sub={`${rs(sum(waiting, (r) => r.approvedTotalPaise))} approved`} />
            <Tile label="Released — payout not recorded" value={released.length} sub={`${rs(sum(released, (r) => r.approvedTotalPaise))} approved`} tone={released.length ? "warn" : "plain"} />
            <Tile label="Paid" value={paid.length} sub={p.showPayouts ? `${rs(sum(paid, (r) => r.payout?.totalPaise))} recorded` : "payout records need the payouts view"} tone="ok" />
          </div>
          <TableCard label="Release and payment by month" minWidth={1000} head={["Month", "Programme", "Category", person ? `${person.name}` : "Approved amount", "Release", "Payout", ""]}>
            {!shown.length && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-ink-muted">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
            {shown.map((r) => {
              const out = isReleased(r.status, r.releaseOn, p.today);
              const mine = person ? r.employees.find((e) => e.key === person.key) : null;
              const myLine = person && r.payout ? r.payout.lines.find((l) => l.employeeName === person.name) : null;
              return (
                <tr key={r.key} className="border-t border-hairline align-top" aria-label={`Category ${r.category} ${r.month.slice(0, 7)}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink-strong">{fmtMonth(r.month)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.programCode}</td>
                  <td className="px-3 py-2">
                    <CategoryName category={r.category} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {person ? (
                      myLine ? (
                        <>
                          <span className="font-semibold text-ink-strong">{rs(myLine.amountPaise)}</span>
                          <span className="block text-[11.5px] text-ink-subtle">paid (payable {rs(myLine.payablePaise)}{myLine.adjustmentsPaise ? `, carried ${rs(myLine.adjustmentsPaise)}` : ""})</span>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-ink-strong">{rs(mine?.payablePaise)}</span>
                          <span className="block text-[11.5px] text-ink-subtle">payable in the calculation</span>
                        </>
                      )
                    ) : (
                      <>
                        <span className="font-semibold text-ink-strong">{rs(r.approvedTotalPaise)}</span>
                        <span className="block text-[11.5px] text-ink-subtle">{r.run ? `${r.run.salespeople} ${r.run.salespeople === 1 ? "salesperson" : "salespeople"}` : ""}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "paid" ? (
                      <span className="text-ink-strong">Released {fmtDay(r.releaseOn)}</span>
                    ) : out ? (
                      <span className="font-semibold text-[#047857]">Released {fmtDay(r.releaseOn)} — eligible for payout</span>
                    ) : (
                      <span className="text-[#B45309]">Releases on {fmtDay(r.releaseOn)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "paid" ? (
                      p.showPayouts && r.payout ? (
                        <>
                          <span className="font-semibold text-ink-strong">{r.payout.reference}</span> · {rs(r.payout.totalPaise)}
                          <span className="block text-[11.5px] text-ink-subtle">
                            paid {fmtDay(r.payout.paidOn)} · recorded by {r.payout.recordedByName}
                          </span>
                          {!!r.payout.lines.length && (
                            <details className="mt-1 text-[11.5px] text-ink-muted">
                              <summary className="cursor-pointer">Payout lines ({r.payout.lines.length})</summary>
                              <ul>
                                {r.payout.lines.map((l) => (
                                  <li key={l.employeeName}>
                                    {l.employeeName}: {rs(l.amountPaise)} (payable {rs(l.payablePaise)}
                                    {l.adjustmentsPaise ? `, carried ${rs(l.adjustmentsPaise)}` : ""})
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </>
                      ) : (
                        <MonthStatus status="paid" />
                      )
                    ) : (
                      <span className="text-ink-subtle">Not yet recorded</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.status === "approved" && out ? (
                      <Link href={calcHref(r.category, r.programId, r.month) as Route} className={BTN} style={{ background: BLUE }} aria-label={`Open Category ${r.category}, ${fmtMonth(r.month)} to record its payout`}>
                        Open to record payout
                      </Link>
                    ) : (
                      <Link href={calcHref(r.category, r.programId, r.month) as Route} className={BTN_PLAIN} aria-label={`Open Category ${r.category}, ${fmtMonth(r.month)}`}>
                        Open
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </TableCard>
          <p className="mt-2 text-[12px] text-ink-muted">A payout is recorded on the month&apos;s Calculation screen once it has been paid, with its reference, date and amount. It needs the Record payout permission, and can&apos;t be dated before the month&apos;s release date or in the future. A paid month is final.</p>
        </>
      )}
    </div>
  );
}
