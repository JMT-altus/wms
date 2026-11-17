import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Category A: the authoritative Category A calculation (lib/incentives/category-a) for a month —
 * salesperson-wise amounts, orders, receipts at their own delays, explanations, history, lock / submit / approve /
 * pay. The same screen and services as Admin & Master Setup → Incentive Calculation; provisional figures need an
 * Incentive Calculation permission (checked on the server — a salesperson sees their approved amounts on
 * My Incentives instead).
 */
export default async function TrackerCategoryAPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryACalculationScreen
        me={me}
        rights={rights}
        searchParams={await searchParams}
        basePath="/incentive/category-a"
        variant="tracker"
        head={<PageHead eyebrow="CATEGORY A · SALES ORDER RECEIVED" title="Category A" sub="The authoritative Category A calculation, from Forms' Sales Orders, Invoices and Receipts and the published Incentive Rules." />}
      />
    </main>
  );
}
