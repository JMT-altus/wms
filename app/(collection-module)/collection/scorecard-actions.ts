"use server";

import { z } from "zod";
import { getCurrentEmployee } from "@/lib/auth/current";
import { getCollectionCapability, requireCollectionCapability } from "@/lib/auth/capability";
import { salespersonIdentityFor } from "@/lib/collections/salesperson-identity";
import { listEscalationsForSalesperson } from "@/lib/queries/collection-scorecards";
import { listFollowUps } from "@/lib/queries/collection-followups";

/**
 * The records behind the scorecard's two escalation metrics, for the card's
 * detail views. Same gate and same data as the numbers on the card:
 *
 *   - collection.view (the Tracker's own gate) is checked from the signed
 *     session first;
 *   - whose card it is comes from the super-admin-kept Sales Coordinator link
 *     (salespersonIdentityFor) — never from the browser, which sends only
 *     which metric was clicked;
 *   - the rows come from listEscalationsForSalesperson, the very records the
 *     counts are derived from: "escalated" is all of them, "resolved" only
 *     those closed by a reviewer — so a list always matches its number.
 *
 * Reasons for Escalation are reviewer data (they are shown only on the
 * Escalations page today): they are sent only to holders of
 * collection.escalation.review; anyone else gets the record without its
 * reason. Reviewer comments are ordinary Tracker comments every Tracker user
 * already sees. Read-only: nothing is written.
 */

const Input = z.object({ metric: z.enum(["escalated", "resolved"]) }).strict();

export interface ScorecardEscalationRow {
  id: string;
  companyName: string;
  salesCoordinator: string | null;
  status: "open" | "closed";
  /** null when hidden (not a reviewer) or not recorded — see `reasonsVisible`. */
  reason: string | null;
  escalatedAt: Date;
  escalatedByName: string | null;
  closedAt: Date | null;
  closedByName: string | null;
  /** The latest reviewer comment on THIS escalation (Escalations → Add Comment), if any. */
  latestReviewerComment: { note: string; byName: string | null; at: Date } | null;
}

type Result = { ok: true; rows: ScorecardEscalationRow[]; reasonsVisible: boolean } | { ok: false; error: string };

export async function getScorecardEscalations(raw: unknown): Promise<Result> {
  const viewer = await requireCollectionCapability("collection.view");
  const p = Input.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose a metric." };

  try {
    const identity = await salespersonIdentityFor(await getCurrentEmployee());
    if (identity.status !== "linked") return { ok: false, error: "Your scorecard isn't linked to a Sales Coordinator, so there are no entries to show." };
    const [all, reviewer, followUps] = await Promise.all([
      listEscalationsForSalesperson(viewer, identity.label),
      getCollectionCapability("collection.escalation.review"),
      listFollowUps(),
    ]);
    const chosen = p.data.metric === "resolved" ? all.filter((r) => r.resolvedByReviewer) : all;

    // Newest first already: the first linked reviewer comment per escalation is its latest.
    const latest = new Map<string, ScorecardEscalationRow["latestReviewerComment"]>();
    for (const f of followUps.entries) {
      if (!f.reviewerEscalationId || !f.note || latest.has(f.reviewerEscalationId)) continue;
      latest.set(f.reviewerEscalationId, { note: f.note, byName: f.createdByName ?? null, at: f.createdAt });
    }

    return {
      ok: true,
      reasonsVisible: reviewer !== null,
      rows: chosen.map((r) => ({
        id: r.id,
        companyName: r.companyName,
        salesCoordinator: r.coordinatorLabel,
        status: r.status,
        reason: reviewer ? r.reason : null,
        escalatedAt: r.escalatedAt,
        escalatedByName: r.escalatedByName,
        closedAt: r.closedAt,
        closedByName: r.closedByName,
        latestReviewerComment: latest.get(r.id) ?? null,
      })),
    };
  } catch {
    console.error("[collection-scorecards] could not load the escalation entries");
    return { ok: false, error: "The entries couldn't be loaded. Please try again." };
  }
}
