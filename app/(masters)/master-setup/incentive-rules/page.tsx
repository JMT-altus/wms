import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/current";
import { incentiveRuleRights } from "@/lib/auth/incentive-rules";
import { checkContextFor, currentMonthStartIST, listProgramsWithVersions, loadConfig } from "@/lib/queries/incentive-rules";
import { checkConfig } from "@/lib/incentives/rules-config/validate";
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
  // Each category's version being prepared (its latest draft, submitted, approved or rejected version): how complete
  // it is, by the same check that decides whether it can be submitted and published. Reads only.
  const WORKING = ["draft", "submitted", "approved", "rejected"];
  const working = programs.flatMap((p) => [...new Set(p.versions.map((v) => v.categoryCode))].map((c) => p.versions.find((v) => v.categoryCode === c && WORKING.includes(v.status))).filter((v): v is NonNullable<typeof v> => !!v));
  const checks = Object.fromEntries(
    await Promise.all(
      working.map(async (v) => {
        const { problems, missing } = checkConfig(await loadConfig(db, v.id), checkContextFor(v.categoryCode));
        return [v.id, { problems: problems.length, missing: missing.length, messages: [...problems, ...missing].slice(0, 3).map((i) => i.message) }] as const;
      }),
    ),
  );
  return (
    <div>
      {head}
      <IncentiveRulesHome
        ready={ready}
        canEdit={ready && rights.edit}
        currentMonth={currentMonthStartIST()}
        checks={checks}
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
