"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { BLUE, BTN, rs } from "@/components/admin/master/incentive-rules/calc-ui";
import { ActionText, CategoryName, Empty, FilterBar, ManageHeader, MonthStatus, NotReadyList, TableCard, approvalsHref, calcHref } from "./manage-ui";
import type { OverviewCategory } from "./overview";
import { CALC_STATUSES } from "./options";
import { fmtDay, fmtMonth, nextAction } from "./stages";

export interface CalculateProps {
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  today: string;
  category: string | null;
  status: string | null;
  categories: OverviewCategory[];
}

const matches = (c: OverviewCategory, status: string | null) => {
  if (!status) return true;
  if (status === "none") return !c.row?.run;
  if (status === "blocked") return c.latest?.status === "blocked";
  return c.row?.status === status;
};

/**
 * Incentive Management → Calculate Incentives: Categories A–G for one programme and month. Each category opens its
 * own Calculation screen — the same screen, engine and permission checks as before — where it is calculated, reviewed,
 * locked and submitted. Nothing is calculated from here.
 */
export function ManageCalculate(p: CalculateProps) {
  const shown = p.categories.filter((c) => (!p.category || c.category === p.category) && matches(c, p.status));
  return (
    <div>
      <ManageHeader section="calculate" keep={{ program: p.programId, month: p.month.slice(0, 7) }} />
      <FilterBar action="/incentive/manage/calculate" programs={p.programs} values={{ program: p.programId, month: p.month, category: p.category, status: p.status }} month="required" category statuses={CALC_STATUSES} />
      <NotReadyList categories={p.categories.filter((c) => !c.ready && (!p.category || c.category === p.category)).map((c) => c.category)} />
      {!p.programId ? (
        <Empty>No incentive programme yet. Programmes and their rules are set up in Admin &amp; Master Setup → Incentive Rules.</Empty>
      ) : (
        <>
          <p className="mb-2 text-[12.5px] text-ink-muted">
            {fmtMonth(p.month)} · {shown.length} of {p.categories.length} categories shown. Calculating, recalculating, locking and submitting happen on each category&apos;s own screen, with its own permission checks.
          </p>
          <TableCard label="Categories for the month" minWidth={1040} head={["Category", "Rules in force", "Latest calculation", "Adopted calculation", "Status", "Next action", ""]}>
            {!shown.length && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-ink-muted">
                  No category matches these filters.
                </td>
              </tr>
            )}
            {shown.map((c) => {
              const facts = { ready: c.ready, rules: c.rules, latest: c.latest, period: c.row ? { status: c.row.status, hasRun: !!c.row.run, releaseOn: c.row.releaseOn } : null, today: p.today };
              const step = c.row && c.row.approvalsDone !== null ? { done: c.row.approvalsDone, required: c.row.approvalsRequired } : null;
              return (
                <tr key={c.category} className="border-t border-hairline align-top" aria-label={`Category ${c.category}`}>
                  <td className="px-3 py-2">
                    <CategoryName category={c.category} />
                  </td>
                  <td className="px-3 py-2">{!c.ready ? <span className="text-ink-subtle">—</span> : c.rules ? <>Version {c.rules.versionNo}<span className="block text-[11.5px] text-ink-subtle">from {fmtDay(c.rules.effectiveFrom)}</span></> : <span className="font-semibold text-[#B91C1C]">None published</span>}</td>
                  <td className="px-3 py-2">
                    {c.latest ? (
                      <>
                        <span className={c.latest.status === "blocked" ? "font-semibold text-[#B91C1C]" : "text-ink-strong"}>{c.latest.status === "blocked" ? "Blocked" : "Computed"}</span>
                        <span className="block text-[11.5px] text-ink-subtle">
                          {fmtDay(c.latest.computedAt)} · as of {fmtDay(c.latest.asOf)}
                        </span>
                        {c.latest.status === "blocked" && !!c.latest.problems.length && <span className="block text-[11.5px] text-[#B91C1C]">{c.latest.problems[0]}{c.latest.problems.length > 1 ? ` (+${c.latest.problems.length - 1} more)` : ""}</span>}
                      </>
                    ) : (
                      <span className="text-ink-subtle">Not calculated</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {c.row?.run ? (
                      <>
                        <span className="font-semibold text-ink-strong">{rs(c.row.approvedTotalPaise)}</span> to {c.row.run.salespeople} {c.row.run.salespeople === 1 ? "salesperson" : "salespeople"}
                        <span className="block text-[11.5px] text-ink-subtle">
                          version {c.row.run.configVersionNo} · as of {fmtDay(c.row.run.asOf)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{c.row ? <MonthStatus status={c.row.status} /> : <span className="text-ink-subtle">—</span>}</td>
                  <td className="px-3 py-2">
                    <ActionText {...nextAction(facts, step)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {c.ready && (
                      <span className="inline-flex flex-col items-end gap-1">
                        <Link href={calcHref(c.category, p.programId, p.month) as Route} className={BTN} style={{ background: BLUE }} aria-label={`Open Category ${c.category} calculation`}>
                          Open calculation
                        </Link>
                        <Link href={approvalsHref(c.category, p.programId) as Route} className="text-[12px] font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }} aria-label={`Category ${c.category} Incentive Approvals`}>
                          Incentive Approvals
                        </Link>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </TableCard>
        </>
      )}
    </div>
  );
}
