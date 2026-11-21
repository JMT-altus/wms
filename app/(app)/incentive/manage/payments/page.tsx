import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { todayIST } from "@/lib/queries/incentive-calc";
import { employeesOf, monthRowsFor, programOptions } from "@/lib/queries/incentive-manage";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { ManageHeader } from "@/components/incentive/manage/manage-ui";
import { ManagePayments } from "@/components/incentive/manage/payments";
import { PAYMENT_STATUSES } from "@/components/incentive/manage/options";
import { categoryParam, choiceParam, optionalMonth, programsParam } from "@/components/incentive/manage/params";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Release & Payments: approved months, their release dates and payouts,
 * across Categories A–G. Needs the approvals or payouts view (as each category's Approvals screen); payout records
 * show only with the payouts view. A payout is recorded on the month's Calculation screen, with its existing checks.
 */
export default async function ReleasePaymentsPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; category?: string; status?: string; employee?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  if (!rights.approvals && !rights.payouts)
    return (
      <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
        <ManageHeader section="payments" />
        <NoCalcAccess />
      </main>
    );
  const sp = await searchParams;
  const programs = await programOptions();
  const { program, selected } = programsParam(sp.program, programs);
  const { rows, notReady } = await monthRowsFor(selected, rights);
  const paidOrApproved = rows.filter((r) => r.status === "approved" || r.status === "paid");
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <ManagePayments
        programs={programs}
        program={program}
        rows={paidOrApproved}
        notReady={notReady}
        today={todayIST()}
        filters={{ category: categoryParam(sp.category), status: choiceParam(sp.status, PAYMENT_STATUSES, "all"), month: optionalMonth(sp.month), employee: sp.employee || null }}
        employees={employeesOf(paidOrApproved)}
        showPayouts={rights.payouts}
      />
    </main>
  );
}
