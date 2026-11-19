import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Category B: the authoritative Category B calculation (lib/incentives/category-b) for a month —
 * each Sales Order's qualification with its evidence, salesperson-wise amounts, receipts at their own delays,
 * lock / submit / approve / pay. The same screen and services as Admin & Master Setup → Incentive Calculation
 * (Category B); provisional figures need an Incentive Calculation permission, checked on the server — a salesperson
 * sees their approved amounts on My Incentives instead.
 */
export default async function TrackerCategoryBPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryACalculationScreen
        me={me}
        rights={rights}
        searchParams={await searchParams}
        basePath="/incentive/category-b"
        variant="tracker"
        category="B"
        head={<PageHead eyebrow="CATEGORY B · OLD CUSTOMER – NEW PRODUCT / NEW BRAND" title="Category B" sub="The authoritative Category B calculation, from Forms' Sales Orders, Invoices, Receipts and Credit Notes and the published Incentive Rules." />}
      />
    </main>
  );
}
