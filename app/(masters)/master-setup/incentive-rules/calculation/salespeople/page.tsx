import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { listOrderSalespeople, salespeopleChoices } from "@/lib/queries/incentive-inputs";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CalcTabs } from "@/components/admin/master/incentive-rules/calc-ui";
import { OrderSalespeople } from "@/components/admin/master/incentive-rules/order-salespeople";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";

export const dynamic = "force-dynamic";

/** Incentive Calculation → Order salespeople: link Forms Sales Orders to the salespeople they are credited to. */
export default async function OrderSalespeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; search?: string; filter?: string; from?: string; to?: string; order?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Order salespeople" lede={<>Which salesperson each Forms Sales Order is credited to, for Category A. Tally&apos;s import carries no salesperson, so orders without one are listed as needing one.</>} />;
  if (!rights.view) return <div>{head}<NoCalcAccess /></div>;
  const sp = await searchParams;
  const filter = sp.filter === "missing" || sp.filter === "attributed" ? sp.filter : "all";
  const search = (sp.search ?? sp.q ?? "").slice(0, 100);
  const [list, employees] = await Promise.all([listOrderSalespeople({ search, filter, from: sp.from ?? null, to: sp.to ?? null }), rights.inputs ? salespeopleChoices() : Promise.resolve([])]);
  const focus = sp.order && list.rows.some((r) => r.id === sp.order) ? sp.order : null;
  return (
    <div>
      {head}
      <CalcTabs active="Order salespeople" />
      <OrderSalespeople ready={list.ready} canEdit={rights.inputs} rows={list.rows} truncated={list.truncated} employees={employees} filters={{ search, filter, from: sp.from ?? "", to: sp.to ?? "" }} focus={rights.inputs ? focus : null} />
    </div>
  );
}
