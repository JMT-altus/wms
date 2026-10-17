import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionFollowups, employees } from "@/db/schema";
import type { FollowUpEntry } from "@/lib/collections/derive";

export interface FollowUpsResult {
  entries: FollowUpEntry[];
  /** False when the follow-up table does not exist yet (migration 0110 not applied). */
  storageReady: boolean;
}

/** Postgres "undefined_table". */
const isMissingTable = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
};

/**
 * Every saved follow-up, newest first. A missing table is reported as
 * `storageReady: false` so the screens can say so, instead of failing the page;
 * any other database error still throws.
 */
export async function listFollowUps(): Promise<FollowUpsResult> {
  try {
    const rows = await db
      .select({
        id: collectionFollowups.id,
        partyName: collectionFollowups.partyName,
        nextFollowupDate: collectionFollowups.nextFollowupDate,
        note: collectionFollowups.note,
        createdByName: employees.name,
        createdAt: collectionFollowups.createdAt,
      })
      .from(collectionFollowups)
      .leftJoin(employees, eq(collectionFollowups.createdById, employees.id))
      .orderBy(desc(collectionFollowups.createdAt));
    return { entries: rows, storageReady: true };
  } catch (err) {
    if (isMissingTable(err)) return { entries: [], storageReady: false };
    throw err;
  }
}
