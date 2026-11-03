import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { collectionEscalations, collectionMasterCompanies, employees } from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { getFieldAccessFor } from "@/lib/auth/field-access";
import type { OwnEscalationCounts } from "@/lib/collections/scorecards";
import { isMissingColumn } from "@/lib/queries/collection-review";

/** The capability that makes someone the escalation reviewer ("every holder is a reviewer"; nobody is named in code). */
const REVIEWER_CAPABILITY = "collection.escalation.review";

/** One escalation record of the salesperson's companies, as both scorecard metrics count it. */
export interface SalespersonEscalation {
  id: string;
  companyId: string;
  companyName: string;
  /** The company's CURRENT Sales Coordinator label (the scorecard's own label). */
  coordinatorLabel: string | null;
  status: "open" | "closed";
  /** Reason for Escalation; null when none was recorded (or before migration 0118). */
  reason: string | null;
  escalatedAt: Date;
  escalatedByName: string | null;
  closedAt: Date | null;
  closedById: string | null;
  closedByName: string | null;
  /** Closed by someone who holds collection.escalation.review — what the "solved" metric counts. */
  resolvedByReviewer: boolean;
}

const isMissingTable = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
};

/**
 * Every escalation record of ONE salesperson's companies — those whose CURRENT
 * Sales Coordinator label is `label` — newest first. The single source of BOTH
 * scorecard metrics and of their detail lists, so a number and its list can
 * never disagree:
 *
 *   escalated          — every record here (each once, open or closed; every
 *                        escalation goes to the reviewers).
 *   resolvedByReviewer — the CLOSED ones whose recorded closer (closed_by_id)
 *                        holds collection.escalation.review, resolved with the
 *                        permission matrix's own resolver. Open escalations, and
 *                        ones closed by someone else or by a removed/inactive
 *                        employee (closer unknown), are not counted.
 *
 * The label is always the signed-in employee's OWN, resolved on the server from
 * the super-admin-kept link — never one sent by a browser. Missing escalation
 * storage reads as no escalations; before migration 0118 reasons read as null.
 */
export async function listEscalationsForSalesperson(
  _viewer: CapabilityProof<"collection.view">,
  label: string,
): Promise<SalespersonEscalation[]> {
  const escalator = alias(employees, "escalator");
  const closer = alias(employees, "closer");
  const base = {
    id: collectionEscalations.id,
    companyId: collectionEscalations.companyId,
    companyName: collectionMasterCompanies.companyName,
    coordinatorLabel: collectionMasterCompanies.coordinatorLabel,
    status: collectionEscalations.status,
    escalatedAt: collectionEscalations.escalatedAt,
    escalatedByName: escalator.name,
    closedAt: collectionEscalations.closedAt,
    closedById: collectionEscalations.closedById,
    closedByName: closer.name,
  };
  const read = (withReason: boolean) =>
    db
      .select(withReason ? { ...base, reason: collectionEscalations.reason } : base)
      .from(collectionEscalations)
      .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, collectionEscalations.companyId))
      .leftJoin(escalator, eq(escalator.id, collectionEscalations.escalatedById))
      .leftJoin(closer, eq(closer.id, collectionEscalations.closedById))
      .where(eq(collectionMasterCompanies.coordinatorLabel, label))
      .orderBy(desc(collectionEscalations.escalatedAt), desc(collectionEscalations.id));

  let rows: (Omit<SalespersonEscalation, "resolvedByReviewer" | "reason"> & { reason?: string | null })[];
  try {
    try {
      rows = await read(true);
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      rows = await read(false);
    }
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }

  const closerIds = [...new Set(rows.filter((r) => r.status === "closed" && r.closedById).map((r) => r.closedById!))];
  const reviewers = new Set<string>();
  if (closerIds.length > 0) {
    const people = await db.select().from(employees).where(and(inArray(employees.id, closerIds), eq(employees.isActive, true)));
    for (const p of people) if ((await getFieldAccessFor(p))[REVIEWER_CAPABILITY]?.allowed === true) reviewers.add(p.id);
  }

  return rows.map((r) => ({
    ...r,
    reason: r.reason ?? null,
    escalatedByName: r.escalatedByName ?? null,
    closedByName: r.closedByName ?? null,
    resolvedByReviewer: r.status === "closed" && !!r.closedById && reviewers.has(r.closedById),
  }));
}

/**
 * Escalation figures for ONE salesperson: the two scorecard counts, derived from
 * listEscalationsForSalesperson — the same records the detail lists show. The
 * caller holds collection.view (the Tracker's own gate); only the two counts
 * leave this function.
 */
export async function escalationCountsForSalesperson(
  viewer: CapabilityProof<"collection.view">,
  label: string,
): Promise<OwnEscalationCounts> {
  const rows = await listEscalationsForSalesperson(viewer, label);
  return { escalated: rows.length, resolvedByReviewer: rows.filter((r) => r.resolvedByReviewer).length };
}
