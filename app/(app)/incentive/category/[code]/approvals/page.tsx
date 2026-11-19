import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";

export const dynamic = "force-dynamic";

/** Incentive Tracker → Categories C–G → Approvals: each month's approval steps, rejections, release and payout records. */
export default async function TrackerCategoryApprovalsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ program?: string }> }) {
  const code = (await params).code.toUpperCase();
  const category = (["C", "D", "E", "F", "G"] as const).find((c) => c === code);
  if (!category) notFound();
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryAApprovalsScreen rights={rights} searchParams={await searchParams} basePath={`/incentive/category/${category.toLowerCase()}`} variant="tracker" category={category} head={<PageHead eyebrow={`CATEGORY ${category} · APPROVAL AND PAYOUT`} title={`Category ${category} approvals`} sub="Each category is approved separately. The WMS records payouts; it moves no money." />} />
    </main>
  );
}
