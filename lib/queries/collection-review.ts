import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { collectionAmountConfirmations, collectionEscalations, collectionMasterCompanies, employees } from "@/db/schema";
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

/**
 * Escalate a company: snapshot the confirmation in force, then insert. The
 * one-open-per-company index refuses a duplicate atomically; that comes back
 * as "already-open", never as a second row.
 */
export async function escalateCompany(actor: CapabilityProof<"collection.escalation.create">, companyId: string): Promise<EscalateOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ value: collectionAmountConfirmations.value })
        .from(collectionAmountConfirmations)
        .where(eq(collectionAmountConfirmations.companyId, companyId))
        .orderBy(desc(collectionAmountConfirmations.recordedAt))
        .limit(1);
      const [row] = await tx
        .insert(collectionEscalations)
        .values({ companyId, escalatedById: actor.employeeId, confirmationAtEscalation: current?.value ?? null })
        .returning({ id: collectionEscalations.id });
      return { ok: true as const, escalationId: row!.id };
    });
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
}

/** Every OPEN escalation with its company — for the reviewers (collection.escalation.review). */
export async function listOpenEscalationsForReview(_reviewer: CapabilityProof<"collection.escalation.review">): Promise<{ storageReady: boolean; rows: ReviewEscalationRow[] }> {
  const escalator = alias(employees, "escalator");
  try {
    const rows = await db
      .select({
        id: collectionEscalations.id,
        companyId: collectionEscalations.companyId,
        escalatedAt: collectionEscalations.escalatedAt,
        escalatedByName: escalator.name,
        confirmationAtEscalation: collectionEscalations.confirmationAtEscalation,
        companyName: collectionMasterCompanies.companyName,
        collectionPerson: collectionMasterCompanies.coordinatorLabel,
      })
      .from(collectionEscalations)
      .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, collectionEscalations.companyId))
      .leftJoin(escalator, eq(escalator.id, collectionEscalations.escalatedById))
      .where(eq(collectionEscalations.status, "open"))
      .orderBy(collectionEscalations.escalatedAt);
    return {
      storageReady: true,
      rows: rows.map((r) => ({ ...r, escalatedByName: r.escalatedByName ?? null, confirmationAtEscalation: r.confirmationAtEscalation ?? null })),
    };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}
