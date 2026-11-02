import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionCommitments, collectionMasterCompanies, employees } from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { isMissingTable } from "@/lib/queries/collection-master";

/**
 * Collection commitments — committed amount and committed date per company.
 *
 * Reads take a proof of collection.commitments.view and writes a proof of
 * collection.commitments.edit, which only lib/auth/capability.ts can produce
 * after checking the session, so these reads and writes can't be reached from
 * a path that skipped the check.
 * Nothing here is cached, and nothing logs an amount or a date.
 *
 * A missing table (migration 0114 not applied) reads as `storageReady: false`.
 */

export interface Commitment {
  /** Exact decimal text as stored (numeric(14,2)), e.g. "311855013.28". Never a float. */
  amount: string;
  /** YYYY-MM-DD */
  committedDate: string;
  recordedAt: Date;
}

/** One recorded commitment with who recorded it — the popup's history and the Tracker column. */
export interface CommitmentEntry extends Commitment {
  id: string;
  recordedByName: string | null;
}

export interface OwnerCommitmentRow extends Commitment {
  companyId: string;
  companyName: string;
  /** The Sales Coordinator / collection person from the Collection Master; null = unassigned. */
  collectionPerson: string | null;
}

/** The current commitment for one company (newest row), or null. */
export async function getCommitment(
  _viewer: CapabilityProof<"collection.commitments.view">,
  companyId: string,
): Promise<{ storageReady: boolean; commitment: Commitment | null }> {
  try {
    const [row] = await db
      .select({
        amount: collectionCommitments.committedAmount,
        committedDate: collectionCommitments.committedDate,
        recordedAt: collectionCommitments.recordedAt,
      })
      .from(collectionCommitments)
      .where(eq(collectionCommitments.companyId, companyId))
      .orderBy(desc(collectionCommitments.recordedAt))
      .limit(1);
    return { storageReady: true, commitment: row ? { ...row, amount: String(row.amount) } : null };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, commitment: null };
    throw err;
  }
}

/**
 * Every commitment ever recorded for one company, newest first — the popup's
 * history. Append-only storage means nothing here was ever overwritten: each
 * row is one "Record" with its amount, date, time and employee.
 */
export async function listCommitments(
  _viewer: CapabilityProof<"collection.commitments.view">,
  companyId: string,
): Promise<{ storageReady: boolean; rows: CommitmentEntry[] }> {
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
      .orderBy(desc(collectionCommitments.recordedAt), desc(collectionCommitments.id));
    return { storageReady: true, rows: rows.map((r) => ({ ...r, amount: String(r.amount), recordedByName: r.recordedByName ?? null })) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

/**
 * The current commitment of each of the given companies — what the Collection
 * Amount Confirmation column shows. Read only with a collection.commitments.view
 * proof, for the companies the caller's Tracker already lists.
 */
export async function latestCommitments(
  _viewer: CapabilityProof<"collection.commitments.view">,
  companyIds: string[],
): Promise<{ storageReady: boolean; byCompany: Map<string, CommitmentEntry> }> {
  const byCompany = new Map<string, CommitmentEntry>();
  if (companyIds.length === 0) return { storageReady: true, byCompany };
  try {
    for (let i = 0; i < companyIds.length; i += 1000) {
      const rows = await db
        .selectDistinctOn([collectionCommitments.companyId], {
          companyId: collectionCommitments.companyId,
          id: collectionCommitments.id,
          amount: collectionCommitments.committedAmount,
          committedDate: collectionCommitments.committedDate,
          recordedAt: collectionCommitments.recordedAt,
          recordedByName: employees.name,
        })
        .from(collectionCommitments)
        .leftJoin(employees, eq(employees.id, collectionCommitments.recordedById))
        .where(inArray(collectionCommitments.companyId, companyIds.slice(i, i + 1000)))
        .orderBy(collectionCommitments.companyId, desc(collectionCommitments.recordedAt), desc(collectionCommitments.id));
      for (const r of rows) byCompany.set(r.companyId, { id: r.id, amount: String(r.amount), committedDate: r.committedDate, recordedAt: r.recordedAt, recordedByName: r.recordedByName ?? null });
    }
    return { storageReady: true, byCompany };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, byCompany };
    throw err;
  }
}

/** Every company's current commitment, with its name and collection person — for the commitments page. */
export async function listOwnerCommitments(
  _viewer: CapabilityProof<"collection.commitments.view">,
): Promise<{ storageReady: boolean; rows: OwnerCommitmentRow[] }> {
  try {
    const latest = db
      .selectDistinctOn([collectionCommitments.companyId], {
        companyId: collectionCommitments.companyId,
        amount: collectionCommitments.committedAmount,
        committedDate: collectionCommitments.committedDate,
        recordedAt: collectionCommitments.recordedAt,
      })
      .from(collectionCommitments)
      .orderBy(collectionCommitments.companyId, desc(collectionCommitments.recordedAt))
      .as("latest");
    const rows = await db
      .select({
        companyId: latest.companyId,
        amount: latest.amount,
        committedDate: latest.committedDate,
        recordedAt: latest.recordedAt,
        companyName: collectionMasterCompanies.companyName,
        collectionPerson: collectionMasterCompanies.coordinatorLabel,
      })
      .from(latest)
      .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, latest.companyId))
      .orderBy(sql`${latest.committedDate} asc`, collectionMasterCompanies.companyName);
    return { storageReady: true, rows: rows.map((r) => ({ ...r, amount: String(r.amount) })) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

/** Record a new commitment (append-only; the newest row becomes current). */
export async function recordCommitment(
  editor: CapabilityProof<"collection.commitments.edit">,
  /** `amount` is the canonical "x.yy" text from CommitmentInput — stored as is, exactly. */
  input: { companyId: string; amount: string; committedDate: string },
): Promise<void> {
  await db.insert(collectionCommitments).values({
    companyId: input.companyId,
    committedAmount: input.amount,
    committedDate: input.committedDate,
    recordedById: editor.employeeId,
  });
}
