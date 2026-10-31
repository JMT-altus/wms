import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias, type SelectedFields } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { collectionAmountConfirmations, collectionConfirmedAmounts, collectionEscalations, collectionMasterCompanies, employees } from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { isMissingTable } from "@/lib/queries/collection-master";
import type { ConfirmationValue } from "@/lib/collections/review";

/**
 * Collection Amount Confirmation + escalations for review (migration 0115). A missing table reads as `storageReady: false`, the same
 * convention as the other Collection queries.
 *
 * Confirmations and open-escalation STATUS are for every Tracker user. Writes,
 * the reviewers' list and closing take a capability proof
 * (lib/auth/capability.ts) for their own capability, so they can't be reached
 * from a path that skipped the check. Every holder of
 * collection.escalation.review is a reviewer — no reviewer is named.
 */

export interface ConfirmationState {
  value: ConfirmationValue;
  recordedAt: Date;
  recordedByName: string | null;
}

export interface OpenEscalation {
  id: string;
  companyId: string;
  escalatedAt: Date;
  escalatedByName: string | null;
  confirmationAtEscalation: ConfirmationValue | null;
}

/** The current confirmed amount (newest row) for a company: canonical "x.yy" rupees text. */
export interface ConfirmedAmountState {
  amount: string;
  recordedAt: Date;
  recordedByName: string | null;
}

/** Current confirmed amount per company (migration 0123). No entry = not entered; `storageReady` false while 0123 isn't installed. */
export async function latestConfirmedAmounts(companyIds?: string[]): Promise<{ storageReady: boolean; byCompany: Map<string, ConfirmedAmountState> }> {
  const byCompany = new Map<string, ConfirmedAmountState>();
  if (companyIds && companyIds.length === 0) return { storageReady: true, byCompany };
  try {
    const rows = await db
      .selectDistinctOn([collectionConfirmedAmounts.companyId], {
        companyId: collectionConfirmedAmounts.companyId,
        amount: collectionConfirmedAmounts.amount,
        recordedAt: collectionConfirmedAmounts.recordedAt,
        recordedByName: employees.name,
      })
      .from(collectionConfirmedAmounts)
      .leftJoin(employees, eq(employees.id, collectionConfirmedAmounts.recordedById))
      .where(companyIds ? inArray(collectionConfirmedAmounts.companyId, companyIds) : undefined)
      .orderBy(collectionConfirmedAmounts.companyId, desc(collectionConfirmedAmounts.recordedAt), desc(collectionConfirmedAmounts.id));
    for (const r of rows) byCompany.set(r.companyId, { amount: r.amount, recordedAt: r.recordedAt, recordedByName: r.recordedByName ?? null });
    return { storageReady: true, byCompany };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, byCompany };
    throw err;
  }
}

/** Append a confirmed amount (canonical "x.yy" text, already validated); never updates or deletes, and never touches the Yes/No history. */
export async function recordConfirmedAmount(actor: CapabilityProof<"collection.confirmation.set">, companyId: string, amount: string): Promise<void> {
  await db.insert(collectionConfirmedAmounts).values({ companyId, amount, recordedById: actor.employeeId });
}

/** Current confirmation (newest row) per company. No entry = "Not set". */
export async function latestConfirmations(companyIds?: string[]): Promise<{ storageReady: boolean; byCompany: Map<string, ConfirmationState> }> {
  const byCompany = new Map<string, ConfirmationState>();
  if (companyIds && companyIds.length === 0) return { storageReady: true, byCompany };
  try {
    const rows = await db
      .selectDistinctOn([collectionAmountConfirmations.companyId], {
        companyId: collectionAmountConfirmations.companyId,
        value: collectionAmountConfirmations.value,
        recordedAt: collectionAmountConfirmations.recordedAt,
        recordedByName: employees.name,
      })
      .from(collectionAmountConfirmations)
      .leftJoin(employees, eq(employees.id, collectionAmountConfirmations.recordedById))
      .where(companyIds ? inArray(collectionAmountConfirmations.companyId, companyIds) : undefined)
      .orderBy(collectionAmountConfirmations.companyId, desc(collectionAmountConfirmations.recordedAt));
    for (const r of rows) byCompany.set(r.companyId, { value: r.value, recordedAt: r.recordedAt, recordedByName: r.recordedByName ?? null });
    return { storageReady: true, byCompany };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, byCompany };
    throw err;
  }
}

/** Append a confirmation (never updates or deletes). */
export async function recordConfirmation(actor: CapabilityProof<"collection.confirmation.set">, companyId: string, value: ConfirmationValue): Promise<void> {
  await db.insert(collectionAmountConfirmations).values({ companyId, value, recordedById: actor.employeeId });
}

/** Open escalations, by company. */
export async function openEscalations(companyIds?: string[]): Promise<{ storageReady: boolean; byCompany: Map<string, OpenEscalation> }> {
  const byCompany = new Map<string, OpenEscalation>();
  if (companyIds && companyIds.length === 0) return { storageReady: true, byCompany };
  try {
    const rows = await db
      .select({
        id: collectionEscalations.id,
        companyId: collectionEscalations.companyId,
        escalatedAt: collectionEscalations.escalatedAt,
        escalatedByName: employees.name,
        confirmationAtEscalation: collectionEscalations.confirmationAtEscalation,
      })
      .from(collectionEscalations)
      .leftJoin(employees, eq(employees.id, collectionEscalations.escalatedById))
      .where(
        and(
          eq(collectionEscalations.status, "open"),
          companyIds ? inArray(collectionEscalations.companyId, companyIds) : undefined,
        ),
      );
    for (const r of rows) byCompany.set(r.companyId, { ...r, escalatedByName: r.escalatedByName ?? null, confirmationAtEscalation: r.confirmationAtEscalation ?? null });
    return { storageReady: true, byCompany };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, byCompany };
    throw err;
  }
}

export type EscalateOutcome = { ok: true; escalationId: string } | { ok: false; reason: "already-open" };

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null &&
  ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505");

/** Postgres "undefined_column" — here: the `reason` column of migration 0118, or the amount column of 0123, is not installed yet. */
export const isMissingColumn = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42703" || e?.cause?.code === "42703";
};

/**
 * Escalate a company with its Reason for Escalation: snapshot the confirmation
 * (Yes/No) AND the confirmed amount in force, then insert one row. The
 * one-open-per-company index refuses a duplicate atomically; that comes back as
 * "already-open", never as a second row. The caller has already validated
 * `reason` (EscalationInput); the escalating employee comes from the capability
 * proof and the time from the database.
 *
 * While migration 0123 isn't installed (no amounts table, or no
 * confirmed_amount_at_escalation column) the escalation is still recorded, with
 * the Yes/No snapshot and the reason exactly as before and no amount — the first
 * attempt's failed transaction is rolled back whole before the second is made.
 * That second attempt names its columns explicitly: the schema builder would
 * otherwise list the 0123 column (as DEFAULT) and fail on a database without it.
 */
export async function escalateCompany(actor: CapabilityProof<"collection.escalation.create">, companyId: string, reason: string): Promise<EscalateOutcome> {
  const attempt = (withAmount: boolean) =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select({ value: collectionAmountConfirmations.value })
        .from(collectionAmountConfirmations)
        .where(eq(collectionAmountConfirmations.companyId, companyId))
        .orderBy(desc(collectionAmountConfirmations.recordedAt))
        .limit(1);
      const confirmation = current?.value ?? null;
      if (!withAmount) {
        const res = await tx.execute<{ id: string }>(
          sql`insert into collection_escalations (company_id, escalated_by_id, confirmation_at_escalation, reason) values (${companyId}, ${actor.employeeId}, ${confirmation}, ${reason}) returning id`,
        );
        const id = ((res as unknown as { rows?: { id: string }[] }).rows ?? (res as unknown as { id: string }[]))[0]!.id;
        return { ok: true as const, escalationId: id };
      }
      const [amount] = await tx
        .select({ amount: collectionConfirmedAmounts.amount })
        .from(collectionConfirmedAmounts)
        .where(eq(collectionConfirmedAmounts.companyId, companyId))
        .orderBy(desc(collectionConfirmedAmounts.recordedAt), desc(collectionConfirmedAmounts.id))
        .limit(1);
      const [row] = await tx
        .insert(collectionEscalations)
        .values({ companyId, escalatedById: actor.employeeId, confirmationAtEscalation: confirmation, reason, confirmedAmountAtEscalation: amount?.amount ?? null })
        .returning({ id: collectionEscalations.id });
      return { ok: true as const, escalationId: row!.id };
    });
  try {
    try {
      return await attempt(true);
    } catch (err) {
      if (!isMissingTable(err) && !isMissingColumn(err)) throw err;
      return await attempt(false);
    }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "already-open" };
    throw err;
  }
}

/**
 * Close one OPEN escalation (collection.escalation.close). Only the closing fields change; the
 * escalation fields stay as recorded. False when it isn't open (or doesn't exist).
 */
export async function closeEscalationById(closer: CapabilityProof<"collection.escalation.close">, escalationId: string): Promise<boolean> {
  const updated = await db
    .update(collectionEscalations)
    .set({ status: "closed", closedById: closer.employeeId, closedAt: new Date() })
    .where(and(eq(collectionEscalations.id, escalationId), eq(collectionEscalations.status, "open")))
    .returning({ id: collectionEscalations.id });
  return updated.length === 1;
}

export interface ReviewEscalationRow extends OpenEscalation {
  companyName: string;
  collectionPerson: string | null;
  /** Reason for Escalation as recorded with THIS escalation; null = raised before reasons were recorded (or 0118 not installed). */
  reason: string | null;
  /** The confirmed amount in force when THIS escalation was raised ("x.yy" rupees); null = none entered, raised before 0123, or 0123 not installed. */
  confirmedAmountAtEscalation: string | null;
}

/**
 * Every OPEN escalation with its company and its Reason for Escalation — for the
 * reviewers (collection.escalation.review). `reasonStorageReady` is false while
 * migration 0118 is not installed: the escalations are still listed (without
 * reasons) rather than failing the page.
 */
export async function listOpenEscalationsForReview(
  _reviewer: CapabilityProof<"collection.escalation.review">,
): Promise<{ storageReady: boolean; reasonStorageReady: boolean; rows: ReviewEscalationRow[] }> {
  const escalator = alias(employees, "escalator");
  const base = {
    id: collectionEscalations.id,
    companyId: collectionEscalations.companyId,
    escalatedAt: collectionEscalations.escalatedAt,
    escalatedByName: escalator.name,
    confirmationAtEscalation: collectionEscalations.confirmationAtEscalation,
    companyName: collectionMasterCompanies.companyName,
    collectionPerson: collectionMasterCompanies.coordinatorLabel,
  };
  const tidy = (r: { escalatedByName: string | null; confirmationAtEscalation: ConfirmationValue | null }) => ({
    escalatedByName: r.escalatedByName ?? null,
    confirmationAtEscalation: r.confirmationAtEscalation ?? null,
  });
  const list = <T extends SelectedFields>(extra: T) =>
    db
      .select({ ...base, ...extra })
      .from(collectionEscalations)
      .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, collectionEscalations.companyId))
      .leftJoin(escalator, eq(escalator.id, collectionEscalations.escalatedById))
      .where(eq(collectionEscalations.status, "open"))
      .orderBy(collectionEscalations.escalatedAt);
  try {
    try {
      const rows = await list({ reason: collectionEscalations.reason, confirmedAmountAtEscalation: collectionEscalations.confirmedAmountAtEscalation });
      return { storageReady: true, reasonStorageReady: true, rows: rows.map((r) => ({ ...r, ...tidy(r), reason: r.reason ?? null, confirmedAmountAtEscalation: r.confirmedAmountAtEscalation ?? null })) };
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      try {
        // 0123 not installed yet: the same list without the amount snapshot.
        const rows = await list({ reason: collectionEscalations.reason });
        return { storageReady: true, reasonStorageReady: true, rows: rows.map((r) => ({ ...r, ...tidy(r), reason: r.reason ?? null, confirmedAmountAtEscalation: null })) };
      } catch (err2) {
        if (!isMissingColumn(err2)) throw err2;
        // 0118 not installed yet either: the same list without reasons.
        const rows = await list({});
        return { storageReady: true, reasonStorageReady: false, rows: rows.map((r) => ({ ...r, ...tidy(r), reason: null, confirmedAmountAtEscalation: null })) };
      }
    }
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, reasonStorageReady: false, rows: [] };
    throw err;
  }
}
