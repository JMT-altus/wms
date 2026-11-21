import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";
import { CategoryBar } from "@/components/incentive/manage/category-bar";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Review & Incentive Approvals → Category B: each month's Incentive
 * Approval steps, rejections, release and payout records (approved separately from Category A).
 */
export default async function TrackerCategoryBApprovalsPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryBar category="B" view="approvals" program={sp.program} />
      <CategoryAApprovalsScreen
        rights={rights}
        searchParams={sp}
        basePath="/incentive/category-b"
        variant="tracker"
        category="B"
        head={<PageHead eyebrow="CATEGORY B · INCENTIVE APPROVAL AND PAYOUT" title="Category B · Incentive Approvals" sub="Submitted months, each Incentive Approval step, rejections with their reasons, release dates and payout records. Category B is approved separately from Category A. The WMS records payouts; it moves no money." />}
      />
    </main>
  );
}
