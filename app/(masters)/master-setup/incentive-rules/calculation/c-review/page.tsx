import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CalcTabs, CategorySwitch } from "@/components/admin/master/incentive-rules/calc-ui";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { CReview } from "@/components/admin/master/incentive-rules/c-review";
import { reviewQueueC, unattributedQueueC } from "@/lib/queries/incentive-c-review";
import { todayIST } from "@/lib/queries/incentive-calc";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Incentive Calculation → Category C → Review & decisions: every record the month's calculation
 * held (a Sales Order without a customer, an invoice without a Sales Order, a credit note without an invoice, a sales
 * return not on a credit note, a new customer nobody can be credited for), never qualified automatically. Seeing it
 * needs an Incentive Calculation right; deciding needs the sensitive `incentive.calc.review` permission (checked again
 * on the server).
 */
export default async function CategoryCReviewPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; uq?: string; us?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules · Category C" title="Review & decisions" lede={<>Records Category C couldn&apos;t place are held here and never qualify by themselves. Link each to what it belongs to, or exclude it — always with a reason; the decision is kept with its history and applied at the month&apos;s next calculation. Whoever decides a case never approves that month.</>} />;
  if (!rights.view)
    return (
      <div>
        {head}
        <NoCalcAccess />
      </div>
    );
  const sp = await searchParams;
  const today = todayIST();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
  const queue = await reviewQueueC(sp.program ?? null, month);
  // Every unattributed Forms record in the range Category C looks at for the month (global; decided once).
  const unattributed = await unattributedQueueC(queue.programId, month, { search: sp.uq, status: sp.us ?? "unresolved" });
  return (
    <div>
      {head}
      <CategorySwitch category="C" />
      <CalcTabs active="Review & decisions" category="C" />
      <CReview ready={queue.ready} canDecide={rights.review} programs={queue.programs} programId={queue.programId} month={month} source={queue.source} rows={queue.rows} unattributed={unattributed} search={sp.uq ?? ""} status={sp.us ?? "unresolved"} />
    </div>
  );
}
