import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CategoryBar } from "@/components/incentive/manage/category-bar";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Calculate Incentives → Category A: the authoritative Category A
 * calculation (lib/incentives/category-a) for a month — salesperson-wise amounts, orders, receipts at their own delays,
 * explanations, history, lock / submit / approve / pay. The same screen and services as Admin & Master Setup →
 * Incentive Calculation; provisional figures need an Incentive Calculation permission (checked on the server — a
 * salesperson sees their approved amounts on My Incentives instead).
 */
export default async function TrackerCategoryAPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryBar category="A" view="calculation" program={sp.program} month={sp.month} />
      <CategoryACalculationScreen
        me={me}
        rights={rights}
        searchParams={sp}
        basePath="/incentive/category-a"
        variant="tracker"
        head={<PageHead eyebrow="CATEGORY A · SALES ORDER RECEIVED" title="Category A" sub="The authoritative Category A calculation, from Forms' Sales Orders, Invoices and Receipts and the published Incentive Rules." />}
      />
    </main>
  );
}
