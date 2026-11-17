import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Incentive Rules → Calculation: Category A for a programme and month, from Forms and the
 * published configuration. Seeing it needs a super-admin or an `incentive.calc.*` permission. The same screen is in
 * the Incentive Tracker (/incentive/category-a).
 */
export default async function IncentiveCalculationPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Calculation — Category A" lede={<>Sales Order Received, worked out from Forms&apos; Sales Orders, Invoices and Receipts with the configuration published for the month. Every calculation is kept with the version it used.</>} />;
  return <CategoryACalculationScreen me={me} rights={rights} searchParams={await searchParams} basePath="/master-setup/incentive-rules/calculation" variant="master" head={head} />;
}
