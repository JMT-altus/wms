import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { todayIST } from "@/lib/queries/incentive-calc";
import { employeesOf, fPending, latestRunsFor, monthRowsFor, programOptions } from "@/lib/queries/incentive-manage";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { ManageHeader } from "@/components/incentive/manage/manage-ui";
import { ManageQueue } from "@/components/incentive/manage/queue";
import { queueStatuses } from "@/components/incentive/manage/options";
import { categoryParam, choiceParam, optionalMonth, programsParam } from "@/components/incentive/manage/params";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Review & Incentive Approvals: every month needing review, submission or
 * Incentive Approval across Categories A–G. Needs the approvals or payouts view — the same as each category's
 * Approvals screen; approval decisions show only with the approvals view, payout records only with the payouts view.
 * Acting on a month happens on its Calculation screen, with its existing checks.
 */
export default async function IncentiveApprovalsQueuePage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; category?: string; status?: string; employee?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  if (!rights.approvals && !rights.payouts)
    return (
      <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
        <ManageHeader section="approvals" />
        <NoCalcAccess />
      </main>
    );
  const sp = await searchParams;
  const today = todayIST();
  const programs = await programOptions();
  const { program, selected } = programsParam(sp.program, programs);
  const month = optionalMonth(sp.month);
  const { rows, notReady } = await monthRowsFor(selected, rights);
  // Reviews held by the latest calculation (B, C) are per programme and month: the chosen ones, else the first
  // programme and the current month.
  const reviewProgram = selected[0] ?? null;
  const reviewMonth = month ?? `${today.slice(0, 7)}-01`;
  const [latest, f] = await Promise.all([reviewProgram ? latestRunsFor(reviewProgram.id, reviewMonth) : Promise.resolve({} as Awaited<ReturnType<typeof latestRunsFor>>), fPending()]);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <ManageQueue
        programs={programs}
        program={program}
        rows={rows}
        notReady={notReady}
        today={today}
        filters={{ category: categoryParam(sp.category), status: choiceParam(sp.status, queueStatuses(rights.approvals), "pending"), month, employee: sp.employee || null }}
        employees={employeesOf(rows)}
        showApprovals={rights.approvals}
        reviews={{ month: reviewMonth, programId: reviewProgram?.id ?? null, heldA: latest.A ? latest.A.heldForReview : null, heldB: latest.B ? latest.B.heldForReview : null, heldC: latest.C ? latest.C.heldForReview : null, f }}
      />
    </main>
  );
}
