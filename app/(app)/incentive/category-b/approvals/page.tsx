import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";

export const dynamic = "force-dynamic";

/** Incentive Tracker → Category B → Approvals: each month's approval steps, rejections, release and payout records. */
export default async function TrackerCategoryBApprovalsPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryAApprovalsScreen
        rights={rights}
        searchParams={await searchParams}
        basePath="/incentive/category-b"
        variant="tracker"
        category="B"
        head={<PageHead eyebrow="CATEGORY B · APPROVAL AND PAYOUT" title="Category B approvals" sub="Submitted months, each approval step, rejections with their reasons, release dates and payout records. Category B is approved separately from Category A. The WMS records payouts; it moves no money." />}
      />
    </main>
  );
}
