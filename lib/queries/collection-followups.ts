import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { collectionFollowups, employeeEvents, employees } from "@/db/schema";
import { getFieldAccessFor } from "@/lib/auth/field-access";
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

/** The employee_events type written when a comment's note is edited (lib: editFollowUpComment). */
export const COMMENT_EDITED_EVENT = "collection_comment_edited";
/**
 * The employee_events type written when a comment is deleted (deleteFollowUpComment). Deletion is SOFT:
 * the follow-up row is never changed or removed; this event (with the full original comment) hides it.
 */
export const COMMENT_DELETED_EVENT = "collection_comment_deleted";

/** The capability whose holders' comments are highlighted — the escalation reviewer. Nobody is named in code. */
export const HIGHLIGHT_CAPABILITY = "collection.escalation.review";

/**
 * Which of these authors currently hold collection.escalation.review, resolved by
 * the same permission resolver the matrix uses (getFieldAccessFor). A failure
 * highlights nobody rather than failing the page.
 */
async function reviewerAuthorIds(authorIds: string[]): Promise<Set<string>> {
  if (authorIds.length === 0) return new Set();
  try {
    const people = await db.select().from(employees).where(and(inArray(employees.id, authorIds), eq(employees.isActive, true)));
    const held = await Promise.all(
      people.map(async (p) => ((await getFieldAccessFor(p))[HIGHLIGHT_CAPABILITY]?.allowed === true ? p.id : null)),
    );
    return new Set(held.filter((id): id is string => id !== null));
  } catch {
    console.error("[collection-followups] could not resolve reviewer authors");
    return new Set();
  }
}

/**
 * From the audit trail: the latest edit per follow-up (who and when) and which
 * comments were deleted. Deletions must never be silently ignored, so a read
 * failure THROWS (the page shows its error state) rather than showing deleted
 * comments again. Only a missing employee_events table reads as "no events" —
 * then no edit or deletion can ever have been recorded.
 */
async function commentEvents(): Promise<{ edits: Map<string, { editedAt: Date; editedByName: string | null }>; deleted: Set<string> }> {
  const edits = new Map<string, { editedAt: Date; editedByName: string | null }>();
  const deleted = new Set<string>();
  let rows;
  try {
    const editor = alias(employees, "editor");
    rows = await db
      .select({ eventType: employeeEvents.eventType, toValue: employeeEvents.toValue, createdAt: employeeEvents.createdAt, editorName: editor.name })
      .from(employeeEvents)
      .leftJoin(editor, eq(editor.id, employeeEvents.actorId))
      .where(inArray(employeeEvents.eventType, [COMMENT_EDITED_EVENT, COMMENT_DELETED_EVENT]))
      .orderBy(desc(employeeEvents.createdAt));
  } catch (err) {
    if (isMissingTable(err)) return { edits, deleted };
    console.error("[collection-followups] could not read comment edits/deletions");
    throw err;
  }
  for (const r of rows) {
    const id = (r.toValue as { followupId?: unknown } | null)?.followupId;
    if (typeof id !== "string") continue;
    if (r.eventType === COMMENT_DELETED_EVENT) deleted.add(id);
    else if (!edits.has(id)) edits.set(id, { editedAt: r.createdAt, editedByName: r.editorName ?? null });
  }
  return { edits, deleted };
}

/**
 * Every saved follow-up, newest first, with its author's employee id (as stored
 * at save time) and that employee's name, whether that author is the escalation
 * reviewer, and the note's latest edit. A deleted comment is left out; when its
 * follow-up also set a next follow-up date, the entry stays with no note (the
 * date was not deleted). A missing table is reported as
 * `storageReady: false` so the screens can say so, instead of failing the page;
 * any other database error still throws.
 */
export async function listFollowUps(): Promise<FollowUpsResult> {
  let rows;
  try {
    rows = await db
      .select({
        id: collectionFollowups.id,
        partyName: collectionFollowups.partyName,
        nextFollowupDate: collectionFollowups.nextFollowupDate,
        note: collectionFollowups.note,
        createdById: collectionFollowups.createdById,
        createdByName: employees.name,
        createdAt: collectionFollowups.createdAt,
      })
      .from(collectionFollowups)
      .leftJoin(employees, eq(collectionFollowups.createdById, employees.id))
      .orderBy(desc(collectionFollowups.createdAt));
  } catch (err) {
    if (isMissingTable(err)) return { entries: [], storageReady: false };
    throw err;
  }
  const authors = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))];
  const [reviewers, { edits, deleted }] = await Promise.all([reviewerAuthorIds(authors), commentEvents()]);
  const entries: FollowUpEntry[] = [];
  for (const r of rows) {
    const isDeleted = deleted.has(r.id);
    if (isDeleted && !r.nextFollowupDate) continue;
    const edit = isDeleted ? undefined : edits.get(r.id);
    entries.push({
      ...r,
      note: isDeleted ? null : r.note,
      authorIsReviewer: !!r.createdById && reviewers.has(r.createdById),
      editedAt: edit?.editedAt ?? null,
      editedByName: edit?.editedByName ?? null,
    });
  }
  return { entries, storageReady: true };
}
