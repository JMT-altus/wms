import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CATEGORY_LABEL } from "@/lib/incentives/rules-config/spec";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Incentive Rules → Calculation: Category A for a programme and month, from Forms and the
 * published configuration. Seeing it needs a super-admin or an `incentive.calc.*` permission. The same screen is in
 * the Incentive Tracker (/incentive/category-a).
 */
export default async function IncentiveCalculationPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; category?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  if (sp.category === "B") {
    const headB = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Calculation — Category B" lede={<>Old Customer – New Product / New Brand: each Sales Order&apos;s qualification, its first invoice of at least the minimum, and its receipts at their own delays, with the configuration published for the month.</>} />;
    return <CategoryACalculationScreen me={me} rights={rights} searchParams={sp} basePath="/master-setup/incentive-rules/calculation" variant="master" head={headB} category="B" />;
  }
  const x = (["C", "D", "E", "F", "G"] as const).find((c) => c === sp.category);
  if (x) {
    const headX = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title={`Calculation — Category ${x}`} lede={<>{CATEGORY_LABEL[x]}: worked out with the configuration published for the month. Every calculation is kept with the version it used; nothing applies until a complete version is approved and published.</>} />;
    return <CategoryACalculationScreen me={me} rights={rights} searchParams={sp} basePath="/master-setup/incentive-rules/calculation" variant="master" head={headX} category={x} />;
  }
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Calculation — Category A" lede={<>Sales Order Received, worked out from Forms&apos; Sales Orders, Invoices and Receipts with the configuration published for the month. Every calculation is kept with the version it used.</>} />;
  return <CategoryACalculationScreen me={me} rights={rights} searchParams={sp} basePath="/master-setup/incentive-rules/calculation" variant="master" head={head} />;
}
