import Link from "next/link";
import type { Route } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { incentiveConfigVersions } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { incentiveRuleRights } from "@/lib/auth/incentive-rules";
import { getVersion, incentiveRulesReady } from "@/lib/queries/incentive-rules";
import { diffConfigs } from "@/lib/incentives/rules-config/validate";
import type { CategoryCode } from "@/lib/incentives/rules-config/spec";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { NoIncentiveRulesAccess } from "@/components/admin/master/incentive-rules/no-access";
import { CompareView } from "@/components/admin/master/incentive-rules/compare-view";

export const dynamic = "force-dynamic";

/** Two versions of one programme side by side: every setting that differs. Read-only. */
export default async function CompareIncentiveVersionsPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  const me = await requireAdmin();
  const rights = await incentiveRuleRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Compare versions" lede={<>Every setting that differs between two versions of a programme.</>} />;
  if (!rights.view) return <div>{head}<NoIncentiveRulesAccess /></div>;
  if (!(await incentiveRulesReady())) return <div>{head}<p className="text-[13px] text-ink-muted">Database update 0131 is needed first.</p></div>;
  const [x, y] = await Promise.all([a ? getVersion(a) : null, b ? getVersion(b) : null]);
  const programId = x?.program.id ?? y?.program.id;
  const versions = programId
    ? await db.select({ id: incentiveConfigVersions.id, versionNo: incentiveConfigVersions.versionNo, status: incentiveConfigVersions.status, categoryCode: incentiveConfigVersions.categoryCode }).from(incentiveConfigVersions).where(eq(incentiveConfigVersions.programId, programId)).orderBy(asc(incentiveConfigVersions.versionNo))
    : [];
  const sameProgram = !!x && !!y && x.program.id === y.program.id;
  return (
    <div>
      {head}
      <Link href={"/master-setup/incentive-rules" as Route} className="text-[12.5px] font-bold" style={{ color: "var(--masters-ink)" }}>
        ← All programmes
      </Link>
      <CompareView
        a={x ? { id: x.version.id, versionNo: x.version.versionNo, status: x.version.status } : null}
        b={y ? { id: y.version.id, versionNo: y.version.versionNo, status: y.version.status } : null}
        versions={versions}
        diffs={x && y && sameProgram && x.version.categoryCode === y.version.categoryCode ? diffConfigs(x.config, y.config, y.version.categoryCode as CategoryCode) : null}
        problem={x && y && !sameProgram ? "Choose two versions of the same programme." : x && y && x.version.categoryCode !== y.version.categoryCode ? "Choose two versions of the same category." : !x || !y ? "Choose the two versions to compare." : null}
      />
    </div>
  );
}
