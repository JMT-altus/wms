import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { todayIST } from "@/lib/queries/incentive-calc";
import { monthSummaries, programOptions } from "@/lib/queries/incentive-manage";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { ManageHeader } from "@/components/incentive/manage/manage-ui";
import { ManageCalculate } from "@/components/incentive/manage/calculate";
import { CALC_STATUSES } from "@/components/incentive/manage/options";
import { categoryParam, choiceParam, monthParam } from "@/components/incentive/manage/params";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Calculate Incentives: Categories A–G for a programme and month, each
 * opening its own Calculation screen (/incentive/category-a, /incentive/category-b, /incentive/category/c…g) — the same
 * screens, engines and permission checks as before. Reads only; needs an Incentive Calculation right.
 */
export default async function CalculateIncentivesPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; category?: string; status?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  if (!rights.view)
    return (
      <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
        <ManageHeader section="calculate" />
        <NoCalcAccess />
      </main>
    );
  const sp = await searchParams;
  const today = todayIST();
  const month = monthParam(sp.month, today);
  const programs = await programOptions();
  const program = programs.find((p) => p.id === sp.program) ?? programs[0] ?? null;
  const categories = program ? await monthSummaries(program, month, rights) : [];
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <ManageCalculate programs={programs} programId={program?.id ?? null} month={month} today={today} category={categoryParam(sp.category)} status={choiceParam(sp.status, CALC_STATUSES, "") || null} categories={categories} />
    </main>
  );
}
