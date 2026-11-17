import type * as React from "react";
import type { IncentiveCalcRights } from "@/lib/auth/incentive-calc";
import { listApprovalPeriods, todayIST } from "@/lib/queries/incentive-calc";
import { Approvals } from "./approvals";
import { CalcTabs } from "./calc-ui";
import { NoCalcAccess } from "./no-calc-access";

/**
 * The Category A Approvals screen, shared by Admin & Master Setup and the Incentive Tracker. Approval history needs
 * the approvals view (or Submit / Approve); payout references and salesperson-wise payout lines need the payouts
 * view (or Pay). Acting on a month happens on its Calculation screen.
 */
export async function CategoryAApprovalsScreen({ rights, searchParams, basePath, variant, head }: { rights: IncentiveCalcRights; searchParams: { program?: string }; basePath: string; variant: "master" | "tracker"; head: React.ReactNode }) {
  if (!rights.approvals && !rights.payouts)
    return (
      <div>
        {head}
        <NoCalcAccess />
      </div>
    );
  const list = await listApprovalPeriods(searchParams.program ?? null);
  return (
    <div>
      {head}
      <CalcTabs active="Approvals" variant={variant} />
      <Approvals
        basePath={basePath}
        ready={list.ready}
        today={todayIST()}
        programs={list.programs}
        programId={list.programId}
        showApprovals={rights.approvals}
        showPayouts={rights.payouts}
        periods={list.periods.map((x) => ({
          ...x,
          submittedAt: x.submittedAt ? x.submittedAt.toISOString() : null,
          approvals: rights.approvals ? x.approvals.map((a) => ({ ...a, at: a.at.toISOString() })) : [],
          payout: rights.payouts && x.payout ? { reference: x.payout.reference, paidOn: x.payout.paidOn, totalPaise: x.payout.totalPaise, recordedByName: x.payout.recordedByName, lines: x.payout.lines } : null,
          run: x.run ? { configVersionNo: x.run.configVersionNo, asOf: x.run.asOf, salespeople: x.run.salespeople, payablePaise: x.run.payablePaise } : null,
        }))}
      />
    </div>
  );
}
