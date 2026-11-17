import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { incentiveConfigVersions } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { incentiveRuleRights } from "@/lib/auth/incentive-rules";
import { currentMonthStartIST, eligibilityChoices, getVersion, incentiveRulesReady, loadConfig, versionHistory } from "@/lib/queries/incentive-rules";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { IncentiveVersionEditor } from "@/components/admin/master/incentive-rules/version-editor";
import { NoIncentiveRulesAccess } from "@/components/admin/master/incentive-rules/no-access";

export const dynamic = "force-dynamic";

/** One configuration version: its settings, the workflow, a preview and (with the history right) its history. */
export default async function IncentiveVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const me = await requireAdmin();
  const rights = await incentiveRuleRights(me);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules" title="Configuration version" lede={<>Edit a draft, submit it, have it approved by someone else and publish it. A published version never changes.</>} />;
  if (!rights.view) return <div>{head}<NoIncentiveRulesAccess /></div>;
  if (!(await incentiveRulesReady())) notFound();
  const detail = await getVersion(versionId);
  if (!detail) notFound();
  const { version: v, program, config, writers, inForce } = detail;
  const [choices, history, published, inForceConfig] = await Promise.all([
    eligibilityChoices(),
    rights.history ? versionHistory(db, v.id) : Promise.resolve(null),
    db
      .select({ id: incentiveConfigVersions.id, versionNo: incentiveConfigVersions.versionNo, effectiveFrom: incentiveConfigVersions.effectiveFrom, effectiveTo: incentiveConfigVersions.effectiveTo })
      .from(incentiveConfigVersions)
      .where(and(eq(incentiveConfigVersions.programId, v.programId), eq(incentiveConfigVersions.categoryCode, v.categoryCode), eq(incentiveConfigVersions.status, "published")))
      .orderBy(asc(incentiveConfigVersions.effectiveFrom)),
    inForce && inForce.id !== v.id ? loadConfig(db, inForce.id) : Promise.resolve(null),
  ]);
  return (
    <div>
      {head}
      <IncentiveVersionEditor
        version={{
          id: v.id,
          programId: program.id,
          programCode: program.code,
          programName: program.name,
          categoryCode: v.categoryCode,
          versionNo: v.versionNo,
          status: v.status,
          effectiveFrom: v.effectiveFrom === null ? null : String(v.effectiveFrom),
          effectiveTo: v.effectiveTo === null ? null : String(v.effectiveTo),
          rowVersion: v.rowVersion,
          changeNote: v.changeNote,
          rejectionReason: v.rejectionReason,
          createdByName: v.createdByName,
          approvedByName: v.approvedByName,
          publishedByName: v.publishedByName,
        }}
        config={config}
        inForce={inForce && inForceConfig ? { versionNo: inForce.versionNo, config: inForceConfig } : null}
        published={published.map((p) => ({ id: p.id, versionNo: p.versionNo, effectiveFrom: String(p.effectiveFrom), effectiveTo: p.effectiveTo === null ? null : String(p.effectiveTo) }))}
        history={history ? history.map((h) => ({ eventNo: h.eventNo, action: h.action, actorName: h.actorName, at: h.at.toISOString(), note: h.note, before: h.before, after: h.after })) : null}
        choices={choices}
        rights={{ edit: rights.edit, submit: rights.submit, approve: rights.approve, publish: rights.publish, backdate: rights.backdate, history: rights.history }}
        meIsWriter={writers.includes(me.id)}
        currentMonth={currentMonthStartIST()}
      />
    </div>
  );
}
