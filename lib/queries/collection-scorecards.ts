import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionEscalations, collectionMasterCompanies, employees } from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { getFieldAccessFor } from "@/lib/auth/field-access";
import type { OwnEscalationCounts } from "@/lib/collections/scorecards";

/** The capability that makes someone the escalation reviewer ("every holder is a reviewer"; nobody is named in code). */
const REVIEWER_CAPABILITY = "collection.escalation.review";

/**
 * Escalation figures for ONE salesperson — the companies whose CURRENT Sales
 * Coordinator label is `label`. The caller holds collection.view (the Tracker's
 * own gate, which already shows those companies' open escalations row by row)
 * and the label is the signed-in employee's OWN, resolved on the server from the
 * super-admin-kept link; no other label's figures are read, and only two counts
 * leave this function — never who escalated or closed what.
 *
 *   escalated          — every escalation record of those companies (each record
 *                        once, open or closed; every escalation goes to the reviewers).
 *   resolvedByReviewer — of those, the CLOSED ones whose recorded closer
 *                        (closed_by_id) holds collection.escalation.review. Open
 *                        escalations, and ones closed by someone else or by a
 *                        removed employee (closer unknown), are not counted.
 *
 * One grouped query; the few distinct closers are then resolved with the
 * permission matrix's own resolver. A closed escalation is never reopened (a
 * later escalation is a new record), so a resolved count can't go back.
 * Missing escalation storage reads as no escalations.
 */
export async function escalationCountsForSalesperson(
  _viewer: CapabilityProof<"collection.view">,
  label: string,
): Promise<OwnEscalationCounts> {
  let rows: { status: string; closedById: string | null; n: number }[];
  try {
    rows = await db
      .select({
        status: collectionEscalations.status,
        closedById: collectionEscalations.closedById,
        n: sql<number>`count(distinct ${collectionEscalations.id})::int`,
      })
      .from(collectionEscalations)
      .innerJoin(collectionMasterCompanies, eq(collectionMasterCompanies.id, collectionEscalations.companyId))
      .where(eq(collectionMasterCompanies.coordinatorLabel, label))
      .groupBy(collectionEscalations.status, collectionEscalations.closedById);
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if (e?.code === "42P01" || e?.cause?.code === "42P01") return { escalated: 0, resolvedByReviewer: 0 };
    throw err;
  }

  const closerIds = [...new Set(rows.filter((r) => r.status === "closed" && r.closedById).map((r) => r.closedById!))];
  const reviewers = new Set<string>();
  if (closerIds.length > 0) {
    const people = await db.select().from(employees).where(and(inArray(employees.id, closerIds), eq(employees.isActive, true)));
    for (const p of people) if ((await getFieldAccessFor(p))[REVIEWER_CAPABILITY]?.allowed === true) reviewers.add(p.id);
  }

  const out: OwnEscalationCounts = { escalated: 0, resolvedByReviewer: 0 };
  for (const r of rows) {
    out.escalated += r.n;
    if (r.status === "closed" && r.closedById && reviewers.has(r.closedById)) out.resolvedByReviewer += r.n;
  }
  return out;
}
