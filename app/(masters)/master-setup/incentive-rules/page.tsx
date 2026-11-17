import { requireAdmin } from "@/lib/auth/current";
import { incentiveRuleRights } from "@/lib/auth/incentive-rules";
import { currentMonthStartIST, listProgramsWithVersions } from "@/lib/queries/incentive-rules";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { IncentiveRulesHome } from "@/components/admin/master/incentive-rules/home";
import { NoIncentiveRulesAccess } from "@/components/admin/master/incentive-rules/no-access";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Incentive Rules: the incentive programmes and their versioned, approved configurations.
 * Seeing it needs a super-admin or an `incentive.rules.*` permission; every action checks its own right again.
 */
export default async function IncentiveRulesPage() {
  const me = await requireAdmin();
  const rights = await incentiveRuleRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup" title="Incentive Rules" lede={<>The rules incentives are worked out by — every threshold, slab, rate, delay step and policy — configured, approved by a second person and published from a month onwards.</>} />;
  if (!rights.view) return <div>{head}<NoIncentiveRulesAccess /></div>;
  const { ready, programs } = await listProgramsWithVersions();
  return (
    <div>
      {head}
      <IncentiveRulesHome
        ready={ready}
        canEdit={ready && rights.edit}
        currentMonth={currentMonthStartIST()}
        programs={programs.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          isActive: p.isActive,
          versions: p.versions.map((v) => ({
            id: v.id,
            categoryCode: v.categoryCode,
            versionNo: v.versionNo,
            status: v.status,
            effectiveFrom: v.effectiveFrom === null ? null : String(v.effectiveFrom),
            effectiveTo: v.effectiveTo === null ? null : String(v.effectiveTo),
            createdByName: v.createdByName,
            approvedByName: v.approvedByName,
            publishedByName: v.publishedByName,
            updatedAt: v.updatedAt.toISOString(),
          })),
        }))}
      />
    </div>
  );
}
