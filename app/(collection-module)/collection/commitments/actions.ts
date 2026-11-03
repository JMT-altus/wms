"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionEscalations, collectionFollowups, collectionMasterCompanies, employeeEvents } from "@/db/schema";
import { getCollectionCapability, requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { CommitmentInput, ReviewerCommentInput } from "@/lib/collections/validate";
import { getCommitment, listCommitments, recordCommitment, type Commitment, type CommitmentEntry } from "@/lib/queries/collection-commitments";
import { isMissingTable } from "@/lib/queries/collection-master";
import { CloseEscalationInput } from "@/lib/collections/review";
import { closeEscalationById } from "@/lib/queries/collection-review";
import { REVIEWER_COMMENT_EVENT } from "@/lib/queries/collection-followups";
import { loadCollectionParties } from "@/lib/collections/load";
import { collectionScopeFor } from "@/lib/collections/scope-server";

/** Whether the company is inside the caller's scope (lib/collections/scope.ts) — a company id from the browser proves nothing. */
async function companyInScope(companyId: string): Promise<boolean> {
  const source = await loadCollectionParties(await collectionScopeFor());
  // With the Master storage missing nothing is listed; the action itself then reports the missing storage.
  return source.masterReady === false || source.parties.some((p) => p.masterId === companyId);
}

/**
 * Collection commitments (committed amount and committed date) and closing
 * escalations.
 *
 * Each action checks its capability from the signed session BEFORE reading or
 * writing anything — collection.commitments.view to read, .edit to record,
 * collection.escalation.close to close. All three are sensitive: an explicit
 * grant only, never implied by admin or super-admin status. Any other caller,
 * calling the action directly or not, gets "Forbidden" and no data. Errors
 * never echo an amount, a date or a database message.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_READY = "Commitment storage isn't set up yet (migration 0114 is pending), so nothing was saved.";
const CompanyId = z.string().uuid("Choose a company.");

/** The current commitment for one Collection Master company, with every earlier one (newest first) — the popup's history. */
export async function getCompanyCommitment(rawCompanyId: unknown): Promise<Result<{ commitment: Commitment | null; history: CommitmentEntry[]; storageReady: boolean }>> {
  const viewer = await requireCollectionCapability("collection.commitments.view");
  const id = CompanyId.safeParse(rawCompanyId);
  if (!id.success) return { ok: false, error: "Choose a company." };
  if (!(await companyInScope(id.data))) return { ok: false, error: "That company isn't in the Collection Master." };
  try {
    const r = await getCommitment(viewer, id.data);
    const h = r.storageReady ? await listCommitments(viewer, id.data) : { rows: [] };
    return { ok: true, commitment: r.commitment, history: h.rows, storageReady: r.storageReady };
  } catch {
    console.error("[collection-commitments] read failed");
    return { ok: false, error: "Could not load the commitment. Please try again." };
  }
}

/**
 * Record a new committed amount and date for a company (append-only). The saved
 * commitment is returned only to someone who may also view commitments.
 */
export async function saveCompanyCommitment(raw: unknown): Promise<Result<{ commitment: Commitment | null }>> {
  const editor = await requireCollectionCapability("collection.commitments.edit");
  const limited = rateLimitOrError(editor.employeeId, "write");
  if (limited) return limited;
  const p = CommitmentInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the commitment." };
  if (!(await companyInScope(p.data.companyId))) return { ok: false, error: "That company isn't in the Collection Master, so nothing was saved." };

  try {
    // Only a company that is in the Collection Master — never a free-typed name.
    const [company] = await db
      .select({ id: collectionMasterCompanies.id })
      .from(collectionMasterCompanies)
      .where(eq(collectionMasterCompanies.id, p.data.companyId))
      .limit(1);
    if (!company) return { ok: false, error: "That company isn't in the Collection Master, so nothing was saved." };
    await recordCommitment(editor, p.data);
    const viewer = await getCollectionCapability("collection.commitments.view");
    const after = viewer ? await getCommitment(viewer, p.data.companyId) : null;
    revalidatePath("/collection/commitments");
    revalidatePath("/collection/escalations");
    revalidatePath("/collection/tracker");
    return { ok: true, commitment: after?.commitment ?? null };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_READY };
    console.error("[collection-commitments] save failed");
    return { ok: false, error: "The commitment could not be saved, so nothing was changed. Please try again." };
  }
}

/**
 * Close an open escalation. Needs collection.escalation.close (reviewing alone
 * isn't enough), verified from the signed session before anything is read or
 * written. Records who closed it and when; the escalation's own fields are
 * never changed, and a later escalation of the same company is a new record.
 */
export async function closeEscalation(raw: unknown): Promise<Result<object>> {
  const closer = await requireCollectionCapability("collection.escalation.close");
  const limited = rateLimitOrError(closer.employeeId, "write");
  if (limited) return limited;
  const p = CloseEscalationInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose an escalation." };
  try {
    const closed = await closeEscalationById(closer, p.data.escalationId);
    if (!closed) return { ok: false, error: "That escalation is already closed or no longer exists." };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: "Escalation storage isn't set up yet (migration 0115 is pending)." };
    console.error("[collection-review] close failed");
    return { ok: false, error: "The escalation could not be closed. Please try again." };
  }
  revalidatePath("/collection/commitments");
  revalidatePath("/collection/escalations");
  revalidatePath("/collection/tracker");
  return { ok: true };
}

/**
 * A reviewer's comment on an OPEN escalation (Escalations → Add Comment). Needs
 * collection.escalation.review — the same capability that opens the Escalations
 * page; every holder is a reviewer and nobody is named — verified from the
 * signed session before anything is read or written.
 *
 * The comment is stored the way every Tracker comment is: a follow-up row for
 * the escalated company, authored by the signed-in reviewer, timestamped by the
 * database, with no follow-up date. So the Tracker's Comments column, the
 * company popup's History and the Escalations page all show the one saved row —
 * nothing is copied. In the same transaction an audit event marks it as a
 * reviewer comment and links it to its escalation, which is how the screens
 * label it. The escalation itself is not changed: it stays open until someone
 * with collection.escalation.close closes it.
 *
 * `token` is made once per dialog: a repeated click (or a retried request)
 * with the same token saves nothing the second time.
 */
export async function addEscalationComment(raw: unknown): Promise<Result<{ duplicate: boolean }>> {
  const reviewer = await requireCollectionCapability("collection.escalation.review");
  const limited = rateLimitOrError(reviewer.employeeId, "write");
  if (limited) return limited;
  const p = ReviewerCommentInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the comment." };
  const { escalationId, note, token } = p.data;

  type Outcome = { ok: true; duplicate: boolean } | { ok: false; error: string };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // One save per token, even when two requests with it arrive together.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`collection-reviewer-comment:${token}`}))`);
      const [seen] = await tx
        .select({ id: employeeEvents.id })
        .from(employeeEvents)
        .where(and(eq(employeeEvents.eventType, REVIEWER_COMMENT_EVENT), sql`${employeeEvents.toValue}->>'token' = ${token}`))
        .limit(1);
      if (seen) return { ok: true, duplicate: true };
      const [esc] = await tx
        .select({ status: collectionEscalations.status, companyId: collectionEscalations.companyId, companyName: collectionMasterCompanies.companyName })
        .from(collectionEscalations)
        .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, collectionEscalations.companyId))
        .where(eq(collectionEscalations.id, escalationId))
        .limit(1);
      if (!esc) return { ok: false, error: "That escalation no longer exists, so the comment was not saved." };
      if (esc.status !== "open") return { ok: false, error: "That escalation has been closed, so the comment was not saved." };
      const [saved] = await tx
        .insert(collectionFollowups)
        .values({ partyName: esc.companyName, nextFollowupDate: null, note, createdById: reviewer.employeeId })
        .returning({ id: collectionFollowups.id });
      await tx.insert(employeeEvents).values({
        employeeId: reviewer.employeeId,
        actorId: reviewer.employeeId,
        eventType: REVIEWER_COMMENT_EVENT,
        toValue: { followupId: saved!.id, escalationId, companyId: esc.companyId, token },
        note: `Reviewer comment on an escalation (${esc.companyName})`,
      });
      return { ok: true, duplicate: false };
    });
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: "Escalation or comment storage isn't set up yet, so the comment was not saved." };
    // Never echo a database message.
    console.error("[collection-review] reviewer comment failed");
    return { ok: false, error: "The comment could not be saved, so nothing was changed. Please try again." };
  }
  if (!outcome.ok) return outcome;
  revalidatePath("/collection/escalations");
  revalidatePath("/collection/tracker");
  revalidatePath("/collection/commitments");
  revalidatePath("/collection/dashboard");
  return { ok: true, duplicate: outcome.duplicate };
}
