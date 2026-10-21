"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { collectionFollowups } from "@/db/schema";
import { requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { loadCollectionParties } from "@/lib/collections/load";
import { partyKey } from "@/lib/collections/derive";
import { FollowUpInput, followUpDateError } from "@/lib/collections/validate";
import { CONFIRMATION_UNAVAILABLE, ConfirmationInput, EscalationInput, confirmationAvailable } from "@/lib/collections/review";
import { escalateCompany, recordConfirmation } from "@/lib/queries/collection-review";
import { assignCoordinatorLabel, isMissingTable } from "@/lib/queries/collection-master";
import { CoordinatorAssignmentInput } from "@/lib/collections/coordinator";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Save one follow-up for a party: a next follow-up date, a note, or both.
 *
 * Append-only — each save is a new row with its author and time, so earlier
 * notes and dates are never overwritten. Needs collection.followup.write (and,
 * like all of Forms, an admin) — checked here because a page guard does not
 * protect a server action.
 * The party must be one the accounting source actually lists, so no free-typed
 * names get stored; with no source connected, nothing can be saved.
 */
export async function saveFollowUp(input: unknown): Promise<ActionResult> {
  const me = await requireCollectionCapability("collection.followup.write");
  const limited = rateLimitOrError(me.employeeId, "write");
  if (limited) return limited;

  const parsed = FollowUpInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { partyName, nextFollowupDate, note } = parsed.data;

  const dateError = followUpDateError(nextFollowupDate, localDateString("Asia/Kolkata"));
  if (dateError) return { ok: false, error: dateError };

  const source = await loadCollectionParties();
  const party = source.parties.find((p) => partyKey(p.partyName) === partyKey(partyName));
  if (!party) {
    return { ok: false, error: "That party isn't in the collection data, so nothing was saved." };
  }

  try {
    await db.insert(collectionFollowups).values({
      partyName: party.partyName,
      nextFollowupDate: nextFollowupDate ?? null,
      note: note && note.length > 0 ? note : null,
      createdById: me.employeeId,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string; cause?: { code?: string } } | null);
    if (code?.code === "42P01" || code?.cause?.code === "42P01") {
      return { ok: false, error: "Follow-up storage isn't set up yet (migration 0110 is pending), so nothing was saved." };
    }
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath("/forms/collection/tracker");
  revalidatePath("/forms/collection/dashboard");
  return { ok: true };
}

// ── Collection Amount Confirmation + escalation (migration 0115) ──────────────
//
// Each action needs its own capability (collection.confirmation.set /
// collection.escalation.create), checked here because a page guard does not
// protect a server action. The actor always comes from the session. A company
// must be one the Collection Master lists (by id).

const REVIEW_NOT_READY = "Confirmation and escalation storage isn't set up yet (migration 0115 is pending), so nothing was saved.";

/** Set (append) the Collection Amount Confirmation for a company — Yes or No. */
export async function setCollectionConfirmation(input: unknown): Promise<ActionResult> {
  const me = await requireCollectionCapability("collection.confirmation.set");
  const limited = rateLimitOrError(me.employeeId, "write");
  if (limited) return limited;
  const parsed = ConfirmationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { companyId, value } = parsed.data;

  const source = await loadCollectionParties();
  const party = source.parties.find((p) => p.masterId === companyId);
  if (!party) return { ok: false, error: "That company isn't in the Collection Master, so nothing was saved." };
  // Only an amount the approved transaction source actually supplies can be confirmed.
  if (!confirmationAvailable(party.outstanding)) return { ok: false, error: CONFIRMATION_UNAVAILABLE };

  try {
    await recordConfirmation(me, companyId, value);
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: REVIEW_NOT_READY };
    console.error("[collection-review] confirmation save failed");
    return { ok: false, error: "The confirmation could not be saved, so nothing was changed. Please try again." };
  }
  revalidatePath("/forms/collection/tracker");
  revalidatePath("/forms/collection/commitments");
  return { ok: true };
}

/**
 * Escalate a company for review. Every employee holding
 * collection.escalation.review is a reviewer; nobody is named. One open
 * escalation per company.
 */
export async function escalateForReview(input: unknown): Promise<ActionResult> {
  const me = await requireCollectionCapability("collection.escalation.create");
  const limited = rateLimitOrError(me.employeeId, "write");
  if (limited) return limited;
  const parsed = EscalationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { companyId } = parsed.data;

  const source = await loadCollectionParties();
  if (!source.parties.some((p) => p.masterId === companyId)) {
    return { ok: false, error: "That company isn't in the Collection Master, so nothing was escalated." };
  }

  try {
    const outcome = await escalateCompany(me, companyId);
    if (!outcome.ok) {
      return { ok: false, error: "This company already has an open escalation awaiting review. Nothing new was created." };
    }
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: REVIEW_NOT_READY };
    console.error("[collection-review] escalation failed");
    return { ok: false, error: "The escalation could not be saved, so nothing was changed. Please try again." };
  }
  revalidatePath("/forms/collection/tracker");
  revalidatePath("/forms/collection/commitments");
  return { ok: true };
}

const COORDINATOR_NOT_READY =
  "Collection Master storage isn't set up yet (migration 0112 is pending), so the Sales Coordinator couldn't be saved.";

/**
 * Set or correct a company's Sales Coordinator from the Collection Tracker.
 *
 * Needs collection.coordinator.assign — a sensitive capability: an explicit
 * grant only, never implied by admin or super-admin status. Checked from the
 * signed session BEFORE anything is read or written; every other caller —
 * through the page or calling this action directly — gets "Forbidden" and
 * nothing happens. The choice must be a coordinator already in
 * the Collection Master, can't be blank, and is saved only if the company still
 * has the coordinator the screen showed. Each change is logged with its
 * before/after values.
 */
export async function assignSalesCoordinator(input: unknown): Promise<ActionResult & { changed?: boolean }> {
  const proof = await requireCollectionCapability("collection.coordinator.assign");
  const limited = rateLimitOrError(proof.employeeId, "write");
  if (limited) return limited;

  const p = CoordinatorAssignmentInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Choose a Sales Coordinator." };

  try {
    const outcome = await assignCoordinatorLabel(proof, p.data);
    if (!outcome.ok) {
      return {
        ok: false,
        error:
          outcome.reason === "not-found"
            ? "That company isn't in the Collection Master, so nothing was saved."
            : outcome.reason === "stale"
              ? "This company's Sales Coordinator was changed meanwhile. Refresh to see the current one; nothing was saved."
              : "Choose a Sales Coordinator from the list. Nothing was saved.",
      };
    }
    if (outcome.changed) {
      revalidatePath("/forms/collection/tracker");
      revalidatePath("/forms/collection/dashboard");
      revalidatePath("/forms/collection/commitments");
      revalidatePath("/forms/collection/master");
    }
    return { ok: true, changed: outcome.changed };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: COORDINATOR_NOT_READY };
    console.error("[collection-master] coordinator assignment failed");
    return { ok: false, error: "The Sales Coordinator could not be saved, so nothing was changed. Please try again." };
  }
}
