import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { adjustmentsFor, carryFor, employeesOf, monthRowsFor, programOptions, runCountsFor } from "@/lib/queries/incentive-manage";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { ManageHeader } from "@/components/incentive/manage/manage-ui";
import { ManageHistory, type HistoryAdjustment } from "@/components/incentive/manage/history";
import { historyStatuses } from "@/components/incentive/manage/options";
import { categoryParam, choiceParam, optionalMonth, programsParam } from "@/components/incentive/manage/params";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → History & Reconciliation: every month of Categories A–G with its
 * calculations, Incentive Approval decisions, voids and payouts, and every adjustment and carried-forward balance.
 * Reads only; needs an Incentive Calculation right. Approval decisions show only with the approvals view and payout
 * records only with the payouts view (as on each category's Approvals screen).
 */
export default async function IncentiveHistoryPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; category?: string; status?: string; employee?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  if (!rights.view)
    return (
      <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
        <ManageHeader section="history" />
        <NoCalcAccess />
      </main>
    );
  const sp = await searchParams;
  const programs = await programOptions();
  const { program, selected } = programsParam(sp.program, programs);
  const { rows, notReady } = await monthRowsFor(selected, rights);
  const runCounts: Record<string, { runs: number; blocked: number }> = {};
  const adjustments: HistoryAdjustment[] = [];
  const carry: React.ComponentProps<typeof ManageHistory>["carry"] = [];
  for (const p of selected) {
    const [counts, adj, bal] = await Promise.all([runCountsFor(p.id), adjustmentsFor(p.id), carryFor(p.id)]);
    for (const [k, v] of counts) runCounts[`${p.id}|${k}`] = v;
    adjustments.push(...adj.map((a) => ({ ...a, programCode: p.code, createdAt: a.createdAt.toISOString() })));
    carry.push(...bal.map((b) => ({ ...b, programCode: p.code, programId: p.id })));
  }
  adjustments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const names = employeesOf(rows);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <ManageHistory
        programs={programs}
        program={program}
        rows={rows}
        notReady={notReady}
        filters={{ category: categoryParam(sp.category), status: choiceParam(sp.status, historyStatuses(rights.approvals), "all"), month: optionalMonth(sp.month), employee: sp.employee || null }}
        employees={names}
        runCounts={runCounts}
        adjustments={adjustments}
        carry={carry}
        showApprovals={rights.approvals}
        showPayouts={rights.payouts}
      />
    </main>
  );
}
