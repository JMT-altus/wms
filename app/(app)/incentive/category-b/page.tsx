import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CategoryBar } from "@/components/incentive/manage/category-bar";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Calculate Incentives → Category B: the authoritative Category B
 * calculation for a month (the same screen and services as Admin & Master Setup → Incentive Calculation). Provisional
 * figures need an Incentive Calculation permission, checked on the server; a salesperson sees their approved and paid
 * amounts on My Incentives instead.
 */
export default async function TrackerCategoryBPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryBar category="B" view="calculation" program={sp.program} month={sp.month} />
      <CategoryACalculationScreen
        me={me}
        rights={rights}
        searchParams={sp}
        basePath="/incentive/category-b"
        variant="tracker"
        category="B"
        head={<PageHead eyebrow="CATEGORY B · OLD CUSTOMER – NEW PRODUCT / NEW BRAND" title="Category B" sub="The authoritative Category B calculation, from Forms' Sales Orders, Invoices, Receipts and Credit Notes and the published Incentive Rules." />}
      />
    </main>
  );
}
