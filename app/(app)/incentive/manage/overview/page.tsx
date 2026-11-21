import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { todayIST } from "@/lib/queries/incentive-calc";
import { fPending, monthSummaries, programOptions } from "@/lib/queries/incentive-manage";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { ManageHeader } from "@/components/incentive/manage/manage-ui";
import { ManageOverview } from "@/components/incentive/manage/overview";
import { monthParam } from "@/components/incentive/manage/params";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Overview: every category's month for a programme — rules in force,
 * source data (as the latest calculation found it), calculation, Incentive Approval, release and payment. Reads only;
 * needs an Incentive Calculation right, checked here on the server (as on every category screen).
 */
export default async function IncentiveOverviewPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  if (!rights.view)
    return (
      <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
        <ManageHeader section="overview" />
        <NoCalcAccess />
      </main>
    );
  const sp = await searchParams;
  const today = todayIST();
  const month = monthParam(sp.month, today);
  const programs = await programOptions();
  const program = programs.find((p) => p.id === sp.program) ?? programs[0] ?? null;
  const [categories, f] = program ? await Promise.all([monthSummaries(program, month, rights), fPending()]) : [[], null];
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <ManageOverview programs={programs} programId={program?.id ?? null} month={month} today={today} categories={categories} f={f} showPayouts={rights.payouts} />
    </main>
  );
}
