import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CalcTabs, CategorySwitch } from "@/components/admin/master/incentive-rules/calc-ui";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { BReview } from "@/components/admin/master/incentive-rules/b-review";
import { findSalesOrders, reviewQueue } from "@/lib/queries/incentive-b-qualify";
import { todayIST } from "@/lib/queries/incentive-calc";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Incentive Calculation → Category B → Review & decisions: the month's Sales Orders that need an
 * admin's review (unmatched customers or products, undecidable novelty, missing taxable values), every order's
 * evidence, invoices with no Sales Order, and the manual decisions with their history. Seeing it needs an Incentive
 * Calculation right; deciding needs the sensitive `incentive.calc.qualify` permission (checked again on the server).
 */
export default async function CategoryBReviewPage({ searchParams }: { searchParams: Promise<{ program?: string; month?: string; all?: string; q?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules · Category B" title="Review & decisions" lede={<>Sales Orders whose Category B qualification needs an admin: an unlinked customer, an unmatched product, a novelty the data can&apos;t decide, a missing taxable value. A decision by hand needs a reason, is kept with its history, and is applied at the month&apos;s next calculation; whoever decides an order never approves that month.</>} />;
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
  const [queue, found] = await Promise.all([reviewQueue(sp.program ?? null, month, sp.all === "1" ? "all" : "review"), sp.q ? findSalesOrders(sp.q) : Promise.resolve([])]);
  return (
    <div>
      {head}
      <CategorySwitch category="B" />
      <CalcTabs active="Review & decisions" category="B" />
      <BReview
        ready={queue.ready}
        canDecide={rights.qualify}
        programs={queue.programs}
        programId={queue.programId}
        month={month}
        all={sp.all === "1"}
        search={sp.q ?? ""}
        source={queue.source}
        rows={queue.rows}
        reviewInvoices={queue.reviewInvoices}
        invoiceReviewsReady={queue.invoiceReviewsReady}
        invoiceReviews={queue.invoiceReviews}
        found={found.map((f) => ({ id: f.id, no: f.no, date: f.date, customerName: f.customerName, override: f.override ? { id: f.override.id, decision: f.override.decision, reason: f.override.reason, byName: f.override.createdByName } : null }))}
      />
    </div>
  );
}
