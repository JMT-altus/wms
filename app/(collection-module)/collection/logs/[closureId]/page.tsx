import { notFound } from "next/navigation";
import { getCollectionCapability } from "@/lib/auth/capability";
import {
  getClosure,
  listCommitmentHistory,
  listCompanyClosures,
  listConfirmationHistory,
  listEscalationHistory,
} from "@/lib/queries/collection-closures";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { commentsOf, followUpsByParty, partyKey } from "@/lib/collections/derive";
import { CollectionLogDetail, LogsLoadError, LogsShell, type LogHistory } from "@/components/collections/collection-logs";

/**
 * One closure episode and the company's existing history — READ-ONLY.
 *
 * Needs collection.logs.view (otherwise a plain "not found", like an unknown id).
 * Each history part is read only with ITS OWN capability, exactly as elsewhere:
 * comments and confirmations with collection.view (what every Tracker user
 * sees), commitments with collection.commitments.view, escalations and their
 * reasons with collection.escalation.review. Holding collection.logs.view never
 * reveals more than the viewer could already see. Nothing is changed here —
 * open escalations and commitments stay exactly as they are.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CollectionLogPage({ params }: { params: Promise<{ closureId: string }> }) {
  const viewer = await getCollectionCapability("collection.logs.view");
  if (!viewer) notFound();
  const { closureId } = await params;
  if (!UUID.test(closureId)) notFound();

  const [tracker, commitmentsViewer, reviewer] = await Promise.all([
    getCollectionCapability("collection.view"),
    getCollectionCapability("collection.commitments.view"),
    getCollectionCapability("collection.escalation.review"),
  ]);

  const loaded = await (async () => {
    const found = await getClosure(viewer, closureId);
    if (!found.row) return { found, episodes: [], history: null };
    const companyId = found.row.companyId;
    const [episodes, followUps, confirmations, commitments, escalations] = await Promise.all([
      listCompanyClosures(viewer, companyId),
      tracker ? listFollowUps() : null,
      tracker ? listConfirmationHistory(tracker, companyId) : null,
      commitmentsViewer ? listCommitmentHistory(commitmentsViewer, companyId) : null,
      reviewer ? listEscalationHistory(reviewer, companyId) : null,
    ]);
    const comments = followUps
      ? {
          storageReady: followUps.storageReady,
          // The Tracker's own rule: follow-ups belong to the party with the same name.
          entries: commentsOf(followUpsByParty(followUps.entries).get(partyKey(found.row.companyName)) ?? []).map((h) => ({
            id: h.id,
            note: h.note,
            createdAt: h.createdAt,
            createdById: h.createdById,
            createdByName: h.createdByName,
          })),
        }
      : null;
    const history: LogHistory = { comments, confirmations, commitments, escalations };
    return { found, episodes, history };
  })().catch(() => {
    console.error("[collection-logs] could not load a log");
    return null;
  });

  if (!loaded) {
    return (
      <LogsShell back>
        <LogsLoadError />
      </LogsShell>
    );
  }
  const { found, episodes, history } = loaded;
  if (!found.row || !history) notFound();
  return (
    <LogsShell title={found.row.companyName} back>
      <CollectionLogDetail closure={found.row} episodes={episodes} history={history} />
    </LogsShell>
  );
}
