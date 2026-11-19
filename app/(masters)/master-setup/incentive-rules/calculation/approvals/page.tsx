import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";

export const dynamic = "force-dynamic";

/** Incentive Calculation → Approvals: each month's approval and payout state. Needs the approvals or payouts view (or an action right that includes it). */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ program?: string; category?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Approvals" lede={<>Each calculated month&apos;s approval and payout: who submitted it, which step it is at, who approved or rejected it and why, and its payout record. The WMS records payouts; it moves no money.</>} />;
  return <CategoryAApprovalsScreen rights={rights} searchParams={sp} basePath="/master-setup/incentive-rules/calculation" variant="master" head={head} category={(["B", "C", "D", "E", "F", "G"] as const).find((c) => c === sp.category) ?? "A"} />;
}
