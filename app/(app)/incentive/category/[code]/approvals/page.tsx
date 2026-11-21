import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";
import { CategoryBar } from "@/components/incentive/manage/category-bar";

export const dynamic = "force-dynamic";

/** Incentive Tracker → Incentive Management → Review & Incentive Approvals → Categories C–G: each month's Incentive Approval steps, rejections, release and payout records. */
export default async function TrackerCategoryApprovalsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ program?: string }> }) {
  const code = (await params).code.toUpperCase();
  const category = (["C", "D", "E", "F", "G"] as const).find((c) => c === code);
  if (!category) notFound();
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryBar category={category} view="approvals" program={sp.program} />
      <CategoryAApprovalsScreen rights={rights} searchParams={sp} basePath={`/incentive/category/${category.toLowerCase()}`} variant="tracker" category={category} head={<PageHead eyebrow={`CATEGORY ${category} · INCENTIVE APPROVAL AND PAYOUT`} title={`Category ${category} · Incentive Approvals`} sub="Each category is approved separately. The WMS records payouts; it moves no money." />} />
    </main>
  );
}
