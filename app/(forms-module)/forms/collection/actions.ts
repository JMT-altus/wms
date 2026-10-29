"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionFollowups, employeeEvents } from "@/db/schema";
import { requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { loadCollectionParties } from "@/lib/collections/load";
import { partyKey } from "@/lib/collections/derive";
import { DeleteCommentInput, EditCommentInput, FollowUpInput, followUpDateError } from "@/lib/collections/validate";
import { COMMENT_DELETED_EVENT, COMMENT_EDITED_EVENT } from "@/lib/queries/collection-followups";
import { CONFIRMATION_UNAVAILABLE, ConfirmationInput, EscalationInput, confirmationAvailable } from "@/lib/collections/review";
import { escalateCompany, isMissingColumn, recordConfirmation } from "@/lib/queries/collection-review";
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
 * The author is ALWAYS the signed-in employee from the session and the time is
 * the database's clock: the input accepts only party, date and note (anything
 * else, such as an author or a timestamp, is rejected).
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
    // Never echo a database message (it can name tables, constraints or connection details).
    console.error("[collection-followups] save failed");
    return { ok: false, error: "The follow-up could not be saved, so nothing was changed. Please try again." };
  }

  revalidatePath("/forms/collection/tracker");
  revalidatePath("/forms/collection/dashboard");
  return { ok: true };
}

/**
 * Edit the text of one comment (a follow-up's note). Needs
 * collection.followup.write, and only the comment's own author may edit it —
 * the author is the stored `created_by_id`, the editor is the session, and
 * neither comes from the input.
 *
 * One transaction: the row is locked, its current note must still equal the
 * text the editor started from (`expectedNote`) — otherwise someone changed it
 * meanwhile and nothing is overwritten — then the note is updated and an
 * employee_events row records the editor, the time (database clock) and the
 * text before and after. If either write fails, neither happens. Sending the
 * same edit twice saves once: the second finds the new text already stored.
 */
export async function editFollowUpComment(input: unknown): Promise<ActionResult> {
  const me = await requireCollectionCapability("collection.followup.write");
  const limited = rateLimitOrError(me.employeeId, "write");
  if (limited) return limited;

  const parsed = EditCommentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { id, expectedNote, note } = parsed.data;

  type Outcome = { ok: true; changed: boolean } | { ok: false; error: string };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [row] = await tx
        .select({ note: collectionFollowups.note, createdById: collectionFollowups.createdById, partyName: collectionFollowups.partyName })
        .from(collectionFollowups)
        .where(eq(collectionFollowups.id, id))
        .for("update");
      if (!row) return { ok: false, error: "That comment no longer exists, so nothing was changed." };
      if (row.createdById !== me.employeeId) return { ok: false, error: "You can only edit your own comments." };
      if (!row.note) return { ok: false, error: "This entry has no comment to edit." };
      if (await isCommentDeleted(tx, id)) return { ok: false, error: "That comment has been deleted, so it can't be edited." };
      if (row.note === note) return { ok: true, changed: false };
      if (row.note !== expectedNote) {
        return { ok: false, error: "This comment was changed by someone else after you opened it. Nothing was saved — reload to see the latest text." };
      }
      await tx.update(collectionFollowups).set({ note }).where(eq(collectionFollowups.id, id));
      await tx.insert(employeeEvents).values({
        employeeId: me.employeeId,
        actorId: me.employeeId,
        eventType: COMMENT_EDITED_EVENT,
        fromValue: { followupId: id, partyName: row.partyName, note: row.note },
        toValue: { followupId: id, note },
        note: `Collection comment edited (${row.partyName})`,
      });
      return { ok: true, changed: true };
    });
  } catch {
    // Never echo a database message (it can name tables, constraints or connection details).
    console.error("[collection-followups] comment edit failed");
    return { ok: false, error: "The comment could not be saved, so nothing was changed. Please try again." };
  }
  if (!outcome.ok) return outcome;
  if (outcome.changed) {
    revalidatePath("/forms/collection/tracker");
    revalidatePath("/forms/collection/commitments");
    revalidatePath("/forms/collection/dashboard");
  }
  return { ok: true };
}

/** Whether a deletion of this follow-up's comment is already recorded (read inside the caller's transaction). */
async function isCommentDeleted(tx: Pick<typeof db, "select">, followupId: string): Promise<boolean> {
  const [hit] = await tx
    .select({ id: employeeEvents.id })
    .from(employeeEvents)
    .where(and(eq(employeeEvents.eventType, COMMENT_DELETED_EVENT), sql`${employeeEvents.toValue}->>'followupId' = ${followupId}`))
    .limit(1);
  return !!hit;
}

/**
 * Delete one comment — SOFT: the follow-up row is never changed or removed. Needs
 * collection.view (the Tracker) and collection.followup.write, and only the
 * comment's own author may delete it (the same rule as editing). The comment must
 * belong to the company it was shown under, and its text must still be what the
 * person confirmed deleting.
 *
 * One transaction: the row is locked (so an edit or a second delete can't
 * interleave), then an employee_events row records who deleted it, when (database
 * clock), the company, the original author and time, and the full text. That
 * event is what hides the comment everywhere (lib/queries/collection-followups.ts);
 * the text stays in the follow-up row and in the event. Deleting an already
 * deleted comment changes nothing.
 */
export async function deleteFollowUpComment(input: unknown): Promise<ActionResult> {
  await requireCollectionCapability("collection.view");
  const me = await requireCollectionCapability("collection.followup.write");
  const limited = rateLimitOrError(me.employeeId, "write");
  if (limited) return limited;

  const parsed = DeleteCommentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { id, partyName, expectedNote } = parsed.data;

  type Outcome = { ok: true; changed: boolean } | { ok: false; error: string };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [row] = await tx
        .select({
          note: collectionFollowups.note,
          createdById: collectionFollowups.createdById,
          partyName: collectionFollowups.partyName,
          nextFollowupDate: collectionFollowups.nextFollowupDate,
          createdAt: collectionFollowups.createdAt,
        })
        .from(collectionFollowups)
        .where(eq(collectionFollowups.id, id))
        .for("update");
      if (!row) return { ok: false, error: "That comment no longer exists, so nothing was deleted." };
      if (partyKey(row.partyName) !== partyKey(partyName)) return { ok: false, error: "That comment doesn't belong to this company, so nothing was deleted." };
      if (row.createdById !== me.employeeId) return { ok: false, error: "You can only delete your own comments." };
      if (!row.note) return { ok: false, error: "This entry has no comment to delete." };
      if (await isCommentDeleted(tx, id)) return { ok: true, changed: false };
      if (row.note !== expectedNote) {
        return { ok: false, error: "This comment was changed after you opened it. Nothing was deleted — reload to see the latest text." };
      }
      await tx.insert(employeeEvents).values({
        employeeId: me.employeeId,
        actorId: me.employeeId,
        eventType: COMMENT_DELETED_EVENT,
        fromValue: {
          followupId: id,
          partyName: row.partyName,
          note: row.note,
          nextFollowupDate: row.nextFollowupDate,
          createdById: row.createdById,
          createdAt: row.createdAt.toISOString(),
        },
        toValue: { followupId: id, deleted: true },
        note: `Collection comment deleted (${row.partyName})`,
      });
      return { ok: true, changed: true };
    });
  } catch {
    // Never echo a database message (it can name tables, constraints or connection details).
    console.error("[collection-followups] comment delete failed");
    return { ok: false, error: "The comment could not be deleted, so nothing was changed. Please try again." };
  }
  if (!outcome.ok) return outcome;
  if (outcome.changed) {
    revalidatePath("/forms/collection/tracker");
    revalidatePath("/forms/collection/commitments");
    revalidatePath("/forms/collection/dashboard");
  }
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

const REASON_NOT_READY = "Escalation reasons can't be stored yet (migration 0118 is pending), so nothing was escalated.";

/**
 * Escalate a company for review, with a Reason for Escalation. Every employee
 * holding collection.escalation.review is a reviewer; nobody is named (the
 * button's wording is a label only). One open escalation per company.
 * The reason is validated HERE (required, trimmed, at most 1,000 characters) —
 * the dialog's check is a convenience, not a safeguard. The escalating person
 * and the time still come from the session and the database.
 */
export async function escalateForReview(input: unknown): Promise<ActionResult> {
  const me = await requireCollectionCapability("collection.escalation.create");
  const limited = rateLimitOrError(me.employeeId, "write");
  if (limited) return limited;
  const parsed = EscalationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { companyId, reason } = parsed.data;

  const source = await loadCollectionParties();
  if (!source.parties.some((p) => p.masterId === companyId)) {
    return { ok: false, error: "That company isn't in the Collection Master, so nothing was escalated." };
  }

  try {
    const outcome = await escalateCompany(me, companyId, reason);
    if (!outcome.ok) {
      return { ok: false, error: "This company already has an open escalation awaiting review. Nothing new was created." };
    }
  } catch (err) {
    if (isMissingColumn(err)) return { ok: false, error: REASON_NOT_READY };
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
