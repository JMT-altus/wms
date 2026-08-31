import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  dccEntries,
  dccItemSubjects,
  dccKpiItems,
  dccSubjects,
  type DccKpiItem,
} from "@/db/schema";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import type { DccStatus } from "@/lib/dcc/util";

/**
 * The entry-write core.
 *
 * Takes an EXPLICIT actor rather than reading the session, so the web server
 * actions and any mobile/JSON API share one implementation of "what actually
 * happens to the row". This layer owns exactly two things: the ownership
 * check and the SQL. Callers own auth, rate-limiting, input validation and
 * cache revalidation.
 */

export interface DccActor {
  id: string;
  email: string;
}

export type WriteResult = { ok: true } | { ok: false; error: string };

/** The sentinel the entries unique index COALESCEs a null subject to. */
const NULL_SUBJECT = "00000000-0000-0000-0000-000000000000";

/**
 * Load an item and decide whether `actor` may write fills against it.
 *
 * Re-read from the DB every time: the client sends an item id, and an id from
 * the client is a claim, not a fact. Filling is owner-only (plus super-admin)
 * — a manager filling for a report would make compliance meaningless.
 */
async function loadFillableItem(
  itemId: string,
  actor: DccActor,
): Promise<{ ok: true; item: DccKpiItem } | { ok: false; error: string }> {
  const [item] = await db
    .select()
    .from(dccKpiItems)
    .where(eq(dccKpiItems.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: "KPI not found" };
  if (item.archived) return { ok: false, error: "This KPI has been removed" };
  if (item.ownerEmployeeId !== actor.id && !isSuperAdmin(actor.email)) {
    return { ok: false, error: "You can only fill your own DCC" };
  }
  return { ok: true, item };
}

export interface WriteEntryInput {
  itemId: string;
  date: string;
  status?: DccStatus | null;
  value?: number | null;
  note?: string | null;
  subjectId?: string | null;
}

/**
 * Upsert (or clear) one fill slot.
 *
 * The uniqueness that makes this safe is an EXPRESSION index —
 * `(item_id, entry_date, COALESCE(subject_id, <zero-uuid>))` — because a plain
 * unique over a nullable column does not dedupe NULLs in Postgres. Drizzle's
 * `onConflictDoUpdate` cannot express a COALESCE target, so the upsert is raw
 * SQL and its ON CONFLICT clause must stay character-for-character in step
 * with the index in migration 0099.
 *
 * An entry with no status, no value and no note is not an empty answer, it is
 * the absence of one — so we DELETE the row rather than storing a blank.
 */
export async function writeDccEntry(
  actor: DccActor,
  input: WriteEntryInput,
): Promise<WriteResult> {
  const loaded = await loadFillableItem(input.itemId, actor);
  if (!loaded.ok) return loaded;

  const status = input.status ?? null;
  const value = input.value ?? null;
  const note = input.note?.trim() ? input.note.trim() : null;
  const subjectId = input.subjectId ?? null;

  // A subject must belong to the same owner, or one person could write fills
  // onto another person's roster by guessing an id.
  if (subjectId) {
    const [subject] = await db
      .select({ ownerEmployeeId: dccSubjects.ownerEmployeeId })
      .from(dccSubjects)
      .where(eq(dccSubjects.id, subjectId))
      .limit(1);
    if (!subject) return { ok: false, error: "Participant not found" };
    if (subject.ownerEmployeeId !== loaded.item.ownerEmployeeId) {
      return { ok: false, error: "Participant belongs to a different person" };
    }
  }

  try {
    if (status === null && value === null && note === null) {
      await db
        .delete(dccEntries)
        .where(
          and(
            eq(dccEntries.itemId, input.itemId),
            eq(dccEntries.entryDate, input.date),
            sql`coalesce(${dccEntries.subjectId}, ${NULL_SUBJECT}::uuid) = coalesce(${subjectId}::uuid, ${NULL_SUBJECT}::uuid)`,
          ),
        );
      return { ok: true };
    }

    await db.execute(sql`
      insert into dcc_entries
        (item_id, entry_date, status, value_number, note, filled_by_id, subject_id)
      values
        (${input.itemId}::uuid, ${input.date}::date, ${status}, ${value},
         ${note}, ${actor.id}::uuid, ${subjectId}::uuid)
      on conflict (item_id, entry_date, coalesce(subject_id, ${NULL_SUBJECT}::uuid))
      do update set
        status       = excluded.status,
        value_number = excluded.value_number,
        note         = excluded.note,
        filled_by_id = excluded.filled_by_id,
        updated_at   = now()
    `);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Set the same status for every active participant of one participant-list
 * KPI on one date. A null status clears them all.
 *
 * One statement per direction rather than a loop over the roster — a 30-person
 * mentee list would otherwise be 30 round-trips behind a single "All Done".
 */
export async function writeParticipantEntries(
  actor: DccActor,
  input: { itemId: string; date: string; status: DccStatus | null },
): Promise<WriteResult> {
  const loaded = await loadFillableItem(input.itemId, actor);
  if (!loaded.ok) return loaded;
  if (!loaded.item.isParticipantList) {
    return { ok: false, error: "That KPI has no participants" };
  }

  const links = await db
    .select({ subjectId: dccItemSubjects.subjectId })
    .from(dccItemSubjects)
    .where(
      and(
        eq(dccItemSubjects.itemId, input.itemId),
        eq(dccItemSubjects.archived, false),
      ),
    );
  if (links.length === 0) return { ok: true };
  const subjectIds = links.map((l) => l.subjectId);

  try {
    if (input.status === null) {
      await db.execute(sql`
        delete from dcc_entries
        where item_id = ${input.itemId}::uuid
          and entry_date = ${input.date}::date
          and subject_id = any(${subjectIds}::uuid[])
      `);
      return { ok: true };
    }

    await db.execute(sql`
      insert into dcc_entries
        (item_id, entry_date, status, filled_by_id, subject_id)
      select ${input.itemId}::uuid, ${input.date}::date, ${input.status},
             ${actor.id}::uuid, s
      from unnest(${subjectIds}::uuid[]) as s
      on conflict (item_id, entry_date, coalesce(subject_id, ${NULL_SUBJECT}::uuid))
      do update set
        status       = excluded.status,
        filled_by_id = excluded.filled_by_id,
        updated_at   = now()
    `);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }
}
