"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionMasterCompanies } from "@/db/schema";
import { getCollectionCapability, requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { CommitmentInput } from "@/lib/collections/validate";
import { getCommitment, recordCommitment, type Commitment } from "@/lib/queries/collection-commitments";
import { isMissingTable } from "@/lib/queries/collection-master";
import { CloseEscalationInput } from "@/lib/collections/review";
import { closeEscalationById } from "@/lib/queries/collection-review";

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

/** The current commitment for one Collection Master company. */
export async function getCompanyCommitment(rawCompanyId: unknown): Promise<Result<{ commitment: Commitment | null; storageReady: boolean }>> {
  const viewer = await requireCollectionCapability("collection.commitments.view");
  const id = CompanyId.safeParse(rawCompanyId);
  if (!id.success) return { ok: false, error: "Choose a company." };
  try {
    const r = await getCommitment(viewer, id.data);
    return { ok: true, commitment: r.commitment, storageReady: r.storageReady };
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
  revalidatePath("/collection/tracker");
  return { ok: true };
}
