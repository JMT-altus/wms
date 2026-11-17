import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { listCustomerReps, salespeopleChoices } from "@/lib/queries/incentive-inputs";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CalcTabs } from "@/components/admin/master/incentive-rules/calc-ui";
import { Representatives } from "@/components/admin/master/incentive-rules/representatives";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";

export const dynamic = "force-dynamic";

/** Incentive Calculation → Representatives: who represented each customer, and when. */
export default async function RepresentativesPage({ searchParams }: { searchParams: Promise<{ search?: string; filter?: string }> }) {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Representatives" lede={<>Who represented each customer, and from when to when. The Customer Master keeps only the current representative; these periods are its history.</>} />;
  if (!rights.view) return <div>{head}<NoCalcAccess /></div>;
  const sp = await searchParams;
  const filter = sp.filter === "missing" || sp.filter === "recorded" ? sp.filter : "all";
  const search = (sp.search ?? "").slice(0, 100);
  const [list, employees] = await Promise.all([listCustomerReps({ search, filter }), rights.inputs ? salespeopleChoices() : Promise.resolve([])]);
  return (
    <div>
      {head}
      <CalcTabs active="Representatives" />
      <Representatives ready={list.ready} canEdit={rights.inputs} rows={list.rows} truncated={list.truncated} employees={employees} filters={{ search, filter }} />
    </div>
  );
}
