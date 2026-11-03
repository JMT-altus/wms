import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionCompanyMarks, employees } from "@/db/schema";
import type { CapabilityProof } from "@/lib/auth/capability";
import { isMissingTable } from "@/lib/queries/collection-master";
import type { CompanyMarks, MarkKind } from "@/lib/collections/marks";

/**
 * Company marks (migration 0125): the active MARK AS PRIORITY / COLLECTION DONE
 * episodes of Collection Master companies, and the two writes that start or
 * end one. Append-only history: a mark is never deleted — reversing it fills
 * `cleared_at` / `cleared_by_id`, and marking again starts a NEW row — so who
 * did what, and when, stays on record. Before the migration is applied the
 * table is missing: reads report `storageReady: false` (no marks), writes
 * throw the missing-table error for the action to report.
 */

/** Either mark capability: the action passes the proof it checked for the kind being written. */
export type MarkProof = CapabilityProof<"collection.priority.set"> | CapabilityProof<"collection.done.set">;

/** The active marks of `companyIds` (every company when omitted), with who set each and when. */
export async function activeMarks(companyIds?: string[]): Promise<{ storageReady: boolean; byCompany: Map<string, CompanyMarks> }> {
  const byCompany = new Map<string, CompanyMarks>();
  if (companyIds && companyIds.length === 0) return { storageReady: true, byCompany };
  let rows;
  try {
    rows = await db
      .select({
        companyId: collectionCompanyMarks.companyId,
        kind: collectionCompanyMarks.kind,
        setAt: collectionCompanyMarks.setAt,
        setByName: employees.name,
      })
      .from(collectionCompanyMarks)
      .leftJoin(employees, eq(employees.id, collectionCompanyMarks.setById))
      .where(and(isNull(collectionCompanyMarks.clearedAt), companyIds ? inArray(collectionCompanyMarks.companyId, companyIds) : undefined));
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, byCompany };
    throw err;
  }
  for (const r of rows) {
    const m = byCompany.get(r.companyId) ?? { priority: null, done: null };
    m[r.kind] = { setAt: r.setAt, setByName: r.setByName ?? null };
    byCompany.set(r.companyId, m);
  }
  return { storageReady: true, byCompany };
}

/**
 * Start a mark episode for the company, unless one of that kind is already
 * active — the partial unique index decides, so two simultaneous requests can
 * never create two. The actor is the proof's employee; the time is the
 * database clock.
 */
export async function setCompanyMark(actor: MarkProof, companyId: string, kind: MarkKind): Promise<"set" | "already"> {
  const inserted = await db
    .insert(collectionCompanyMarks)
    .values({ companyId, kind, setById: actor.employeeId })
    .onConflictDoNothing({ target: [collectionCompanyMarks.companyId, collectionCompanyMarks.kind], where: sql`${collectionCompanyMarks.clearedAt} IS NULL` })
    .returning({ id: collectionCompanyMarks.id });
  return inserted.length > 0 ? "set" : "already";
}

/** End the company's active episode of that kind, recording who reversed it and when; "none" when there isn't one. */
export async function clearCompanyMark(actor: MarkProof, companyId: string, kind: MarkKind): Promise<"cleared" | "none"> {
  const updated = await db
    .update(collectionCompanyMarks)
    .set({ clearedAt: sql`now()`, clearedById: actor.employeeId })
    .where(and(eq(collectionCompanyMarks.companyId, companyId), eq(collectionCompanyMarks.kind, kind), isNull(collectionCompanyMarks.clearedAt)))
    .returning({ id: collectionCompanyMarks.id });
  return updated.length > 0 ? "cleared" : "none";
}
