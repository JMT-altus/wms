import "server-only";
import type { CommitmentView } from "@/components/collections/commitments-table";
import type { OwnerCommitmentRow } from "@/lib/queries/collection-commitments";
import type { ReviewEscalationRow } from "@/lib/queries/collection-review";
import { latestConfirmations, latestConfirmedAmounts } from "@/lib/queries/collection-review";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { commentsOf, followUpsByParty, partyKey } from "@/lib/collections/derive";
import { loadCollectionParties, loadTransactionsByMaster } from "@/lib/collections/load";
import { collectionScopeFor } from "@/lib/collections/scope-server";

/**
 * The rows the Commitments page and the Escalations page show — built the one
 * way the combined page always built them, so splitting the pages changes
 * nothing about a row. Each page passes ONLY its own records: the Commitments
 * page passes commitments (and no escalations), the Escalations page passes
 * open escalations (and no commitments), each already read with its own
 * capability proof. Nothing here reads a commitment or an escalation itself.
 *
 * Around those records it adds what both pages show for a company: the
 * collection person, Collection Amount Confirmation and confirmed amount, the
 * outstanding amount and due dates from the approved source (none yet), and
 * the Tracker comments matched by the Tracker's own rule.
 *
 * Returns null when a read fails (the page shows its load error); the
 * follow-up storage flag is returned for the page's notices.
 */
export async function buildReviewRows(input: {
  commitments: readonly OwnerCommitmentRow[];
  escalations: readonly ReviewEscalationRow[];
}): Promise<{ rows: CommitmentView[]; followUpsReady: boolean } | null> {
  const loaded = await Promise.all([listFollowUps(), collectionScopeFor().then((s) => loadCollectionParties(s))]).catch(() => null);
  if (!loaded) return null;
  const [followUps, source] = loaded;

  // Commitments first (by committed date), then companies that are only escalated (oldest first).
  const base = new Map<string, Pick<CommitmentView, "companyId" | "companyName" | "collectionPerson" | "amount" | "committedDate" | "recordedAt">>();
  for (const r of input.commitments) base.set(r.companyId, r);
  for (const e of input.escalations) {
    if (!base.has(e.companyId)) {
      base.set(e.companyId, { companyId: e.companyId, companyName: e.companyName, collectionPerson: e.collectionPerson, amount: null, committedDate: null, recordedAt: null });
    }
  }
  const ids = [...base.keys()];
  const openByCompany = new Map(input.escalations.map((e) => [e.companyId, e]));
  const outstandingByCompany = new Map(source.parties.filter((p) => p.masterId).map((p) => [p.masterId!, p.outstanding]));
  const byParty = followUpsByParty(followUps.entries);
  // Due dates for the overdue colouring: the same transaction source and company id the Collection Tracker uses.
  const details = await Promise.all([latestConfirmations(ids), loadTransactionsByMaster(ids), latestConfirmedAmounts(ids)]).catch(() => null);
  if (!details) return null;
  const [confirmations, dueByCompany, confirmedAmounts] = details;

  const rows: CommitmentView[] = ids.map((id) => {
    const r = base.get(id)!;
    const e = openByCompany.get(id);
    return {
      ...r,
      // Only what the comments column shows — the note, when, and by whom (employee id and name).
      comments: commentsOf(byParty.get(partyKey(r.companyName)) ?? []).map((h) => ({
        id: h.id,
        note: h.note,
        createdAt: h.createdAt,
        createdById: h.createdById,
        createdByName: h.createdByName,
        reviewerEscalationId: h.reviewerEscalationId ?? null,
      })),
      // Only what the overdue rule reads — not invoice references or amounts.
      due: (dueByCompany.get(id) ?? []).map((t) => ({ dueDate: t.dueDate, status: t.status, outstanding: t.outstanding })),
      confirmation: confirmations.byCompany.get(id)?.value ?? null,
      confirmedAmount: confirmedAmounts.byCompany.get(id)?.amount ?? null,
      outstanding: outstandingByCompany.get(id) ?? null,
      // The reason and the amount snapshot travel with ITS escalation (same row, same company) — never from anyone's browser.
      escalation: e ? { id: e.id, escalatedAt: e.escalatedAt, escalatedByName: e.escalatedByName, confirmationAtEscalation: e.confirmationAtEscalation, confirmedAmountAtEscalation: e.confirmedAmountAtEscalation, reason: e.reason } : null,
    };
  });
  return { rows, followUpsReady: followUps.storageReady };
}
