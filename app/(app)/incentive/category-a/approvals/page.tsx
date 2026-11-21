import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";
import { CategoryBar } from "@/components/incentive/manage/category-bar";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Incentive Management → Review & Incentive Approvals → Category A: every calculated month with
 * its Incentive Approval steps, rejections (with reasons), release date and payout record. The same screen and
 * rights as Admin & Master Setup → Incentive Calculation → Incentive Approvals; acting on a month happens on its
 * Calculation screen.
 */
export default async function TrackerCategoryAApprovalsPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <CategoryBar category="A" view="approvals" program={sp.program} />
      <CategoryAApprovalsScreen
        rights={rights}
        searchParams={sp}
        basePath="/incentive/category-a"
        variant="tracker"
        head={<PageHead eyebrow="CATEGORY A · INCENTIVE APPROVAL AND PAYOUT" title="Category A · Incentive Approvals" sub="Submitted months, each Incentive Approval step, rejections with their reasons, release dates and payout records. The WMS records payouts; it moves no money." />}
      />
    </main>
  );
}
