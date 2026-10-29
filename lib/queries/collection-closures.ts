import "server-only";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  collectionAmountConfirmations,
  collectionClosures,
  collectionCommitments,
  collectionEscalations,
  collectionMasterCompanies,
  employees,
} from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { isMissingTable } from "@/lib/queries/collection-master";
import { isMissingColumn } from "@/lib/queries/collection-review";
import type { ConfirmationValue } from "@/lib/collections/review";

/**
 * Collection Logs — READ-ONLY. Closure episodes (migration 0119) and the
 * history that already exists for a company. Nothing in this file writes: there
 * is no close, reopen, edit or delete here, and automatic closure is not built
 * (no outstanding-balance source is approved yet).
 *
 * Each read takes a proof of its own capability (lib/auth/capability.ts):
 * collection.logs.view for the log itself; restricted history keeps its own
 * sensitive capability — commitments need collection.commitments.view and
 * escalations collection.escalation.review — so the log never widens access.
 * A missing table reads as `storageReady: false`, like the other Collection queries.
 */

export interface ClosureRow {
  id: string;
  companyId: string;
  companyName: string;
  collectionPerson: string | null;
  closedAt: Date;
  closeReason: "outstanding_zero";
  closeSourceKey: string;
  closeSourceRef: string | null;
  /** Exact decimal text as stored (numeric(16,2)); never a float. */
  finalOutstanding: string;
  finalDebit: string | null;
  finalCredit: string | null;
  /** YYYY-MM-DD, as the source states it. */
  asOfDate: string | null;
  closedByName: string | null;
  reopenedAt: Date | null;
  reopenReason: "outstanding_positive" | null;
  reopenSourceRef: string | null;
  reopenedByName: string | null;
}

const closer = alias(employees, "closer");
const reopener = alias(employees, "reopener");
const closureFields = {
  id: collectionClosures.id,
  companyId: collectionClosures.companyId,
  companyName: collectionMasterCompanies.companyName,
  collectionPerson: collectionMasterCompanies.coordinatorLabel,
  closedAt: collectionClosures.closedAt,
  closeReason: collectionClosures.closeReason,
  closeSourceKey: collectionClosures.closeSourceKey,
  closeSourceRef: collectionClosures.closeSourceRef,
  finalOutstanding: collectionClosures.finalOutstanding,
  finalDebit: collectionClosures.finalDebit,
  finalCredit: collectionClosures.finalCredit,
  asOfDate: collectionClosures.asOfDate,
  closedByName: closer.name,
  reopenedAt: collectionClosures.reopenedAt,
  reopenReason: collectionClosures.reopenReason,
  reopenSourceRef: collectionClosures.reopenSourceRef,
  reopenedByName: reopener.name,
};
const closureQuery = () =>
  db
    .select(closureFields)
    .from(collectionClosures)
    .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, collectionClosures.companyId))
    .leftJoin(closer, eq(closer.id, collectionClosures.closedById))
    .leftJoin(reopener, eq(reopener.id, collectionClosures.reopenedById));
const tidy = (r: Awaited<ReturnType<typeof closureQuery>>[number]): ClosureRow => ({
  ...r,
  finalOutstanding: String(r.finalOutstanding),
  finalDebit: r.finalDebit === null ? null : String(r.finalDebit),
  finalCredit: r.finalCredit === null ? null : String(r.finalCredit),
  closedByName: r.closedByName ?? null,
  reopenedByName: r.reopenedByName ?? null,
});

/** Every closure episode, newest first (open and reopened alike). */
export async function listClosures(_viewer: CapabilityProof<"collection.logs.view">): Promise<{ storageReady: boolean; rows: ClosureRow[] }> {
  try {
    const rows = await closureQuery().orderBy(desc(collectionClosures.closedAt), collectionMasterCompanies.companyName);
    return { storageReady: true, rows: rows.map(tidy) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

/** One closure episode by id, or null. */
export async function getClosure(_viewer: CapabilityProof<"collection.logs.view">, closureId: string): Promise<{ storageReady: boolean; row: ClosureRow | null }> {
  try {
    const [row] = await closureQuery().where(eq(collectionClosures.id, closureId)).limit(1);
    return { storageReady: true, row: row ? tidy(row) : null };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, row: null };
    throw err;
  }
}

/** Every closure episode of the same company, newest first — the company's whole closing history. */
export async function listCompanyClosures(_viewer: CapabilityProof<"collection.logs.view">, companyId: string): Promise<ClosureRow[]> {
  const rows = await closureQuery().where(eq(collectionClosures.companyId, companyId)).orderBy(desc(collectionClosures.closedAt));
  return rows.map(tidy);
}

export interface CommitmentHistoryRow {
  id: string;
  amount: string;
  committedDate: string;
  recordedAt: Date;
  recordedByName: string | null;
}

/** All commitments ever recorded for a company, newest first (collection.commitments.view). */
export async function listCommitmentHistory(
  _viewer: CapabilityProof<"collection.commitments.view">,
  companyId: string,
): Promise<{ storageReady: boolean; rows: CommitmentHistoryRow[] }> {
  try {
    const rows = await db
      .select({
        id: collectionCommitments.id,
        amount: collectionCommitments.committedAmount,
        committedDate: collectionCommitments.committedDate,
        recordedAt: collectionCommitments.recordedAt,
        recordedByName: employees.name,
      })
      .from(collectionCommitments)
      .leftJoin(employees, eq(employees.id, collectionCommitments.recordedById))
      .where(eq(collectionCommitments.companyId, companyId))
      .orderBy(desc(collectionCommitments.recordedAt));
    return { storageReady: true, rows: rows.map((r) => ({ ...r, amount: String(r.amount), recordedByName: r.recordedByName ?? null })) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

export interface ConfirmationHistoryRow {
  id: string;
  value: ConfirmationValue;
  recordedAt: Date;
  recordedByName: string | null;
}

/** Every Collection Amount Confirmation for a company, newest first (visible to Tracker users: collection.view). */
export async function listConfirmationHistory(
  _viewer: CapabilityProof<"collection.view">,
  companyId: string,
): Promise<{ storageReady: boolean; rows: ConfirmationHistoryRow[] }> {
  try {
    const rows = await db
      .select({
        id: collectionAmountConfirmations.id,
        value: collectionAmountConfirmations.value,
        recordedAt: collectionAmountConfirmations.recordedAt,
        recordedByName: employees.name,
      })
      .from(collectionAmountConfirmations)
      .leftJoin(employees, eq(employees.id, collectionAmountConfirmations.recordedById))
      .where(eq(collectionAmountConfirmations.companyId, companyId))
      .orderBy(desc(collectionAmountConfirmations.recordedAt));
    return { storageReady: true, rows: rows.map((r) => ({ ...r, recordedByName: r.recordedByName ?? null })) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

export interface EscalationHistoryRow {
  id: string;
  status: "open" | "closed";
  escalatedAt: Date;
  escalatedByName: string | null;
  confirmationAtEscalation: ConfirmationValue | null;
  closedAt: Date | null;
  closedByName: string | null;
  /** Reason for Escalation (0118); null when none was recorded. */
  reason: string | null;
}

/**
 * Every escalation of a company — open and closed, newest first, with its
 * reason (collection.escalation.review). Before 0118 the reason column is
 * missing: the escalations are still listed, without reasons.
 */
export async function listEscalationHistory(
  _viewer: CapabilityProof<"collection.escalation.review">,
  companyId: string,
): Promise<{ storageReady: boolean; reasonStorageReady: boolean; rows: EscalationHistoryRow[] }> {
  const by = alias(employees, "escalated_by");
  const closedBy = alias(employees, "closed_by");
  const base = {
    id: collectionEscalations.id,
    status: collectionEscalations.status,
    escalatedAt: collectionEscalations.escalatedAt,
    escalatedByName: by.name,
    confirmationAtEscalation: collectionEscalations.confirmationAtEscalation,
    closedAt: collectionEscalations.closedAt,
    closedByName: closedBy.name,
  };
  const tidyE = (r: { escalatedByName: string | null; closedByName: string | null; confirmationAtEscalation: ConfirmationValue | null }) => ({
    escalatedByName: r.escalatedByName ?? null,
    closedByName: r.closedByName ?? null,
    confirmationAtEscalation: r.confirmationAtEscalation ?? null,
  });
  try {
    try {
      const rows = await db
        .select({ ...base, reason: collectionEscalations.reason })
        .from(collectionEscalations)
        .leftJoin(by, eq(by.id, collectionEscalations.escalatedById))
        .leftJoin(closedBy, eq(closedBy.id, collectionEscalations.closedById))
        .where(eq(collectionEscalations.companyId, companyId))
        .orderBy(desc(collectionEscalations.escalatedAt));
      return { storageReady: true, reasonStorageReady: true, rows: rows.map((r) => ({ ...r, ...tidyE(r), reason: r.reason ?? null })) };
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      const rows = await db
        .select(base)
        .from(collectionEscalations)
        .leftJoin(by, eq(by.id, collectionEscalations.escalatedById))
        .leftJoin(closedBy, eq(closedBy.id, collectionEscalations.closedById))
        .where(eq(collectionEscalations.companyId, companyId))
        .orderBy(desc(collectionEscalations.escalatedAt));
      return { storageReady: true, reasonStorageReady: false, rows: rows.map((r) => ({ ...r, ...tidyE(r), reason: null })) };
    }
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, reasonStorageReady: false, rows: [] };
    throw err;
  }
}
