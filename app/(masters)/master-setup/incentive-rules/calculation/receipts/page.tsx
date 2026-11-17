import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { listReceiptEvents } from "@/lib/queries/incentive-inputs";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CalcTabs } from "@/components/admin/master/incentive-rules/calc-ui";
import { ReceiptEvents } from "@/components/admin/master/incentive-rules/receipt-events";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "onAccount", "withEvents", "held", "creditNotes"] as const;

/** Incentive Calculation → Receipt events: allocations, refunds, bounced cheques, reversals, holds and sales returns. */
export default async function ReceiptEventsPage({ searchParams }: { searchParams: Promise<{ search?: string; filter?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Receipt events" lede={<>What Tally&apos;s import can&apos;t say about a Forms receipt or credit note. The receipts themselves stay in Forms; nothing here copies or changes them.</>} />;
  if (!rights.view) return <div>{head}<NoCalcAccess /></div>;
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as (typeof FILTERS)[number]) : "all";
  const search = (sp.search ?? "").slice(0, 100);
  const list = await listReceiptEvents({ search, filter });
  return (
    <div>
      {head}
      <CalcTabs active="Receipt events" />
      <ReceiptEvents ready={list.ready} canEdit={rights.inputs} rows={list.rows} truncated={list.truncated} filters={{ search, filter }} />
    </div>
  );
}
