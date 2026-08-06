import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, employees } from "@/db/schema";
import type { TaskStatus } from "@/db/enums";

export interface RecurringTemplateRow {
  id: string;
  shortId: string | null;
  title: string;
  subject: string | null;
  rule: string;
  doerName: string | null;
  initiatorName: string | null;
  status: TaskStatus;
  dueAt: Date;
  /** Number of materialized children currently in the system (across
   *  the past + future). Surfaces "this template has spawned N tasks". */
  childCount: number;
  /** Earliest future child due-date, if any — gives admins a sense of
   *  what's coming. */
  nextChildDueAt: Date | null;
}

/**
 * Phase 5.2 surface — list active recurring-template tasks (rule-holders)
 * with each one's child count + next scheduled child. Used by /admin/settings
 * Integrations tab so an admin can audit what's spawning.
 */
export async function listRecurringTemplates(): Promise<RecurringTemplateRow[]> {
  // Two-step approach: pick templates first, then count children +
  // earliest-future-due in a second join — simpler than a 3-way self-join
  // in drizzle's builder.
  const templates = await db
    .select({
      id: tasks.id,
      shortId: tasks.shortId,
      title: tasks.title,
      subject: tasks.subject,
      rule: tasks.recurrenceRule,
      doerId: tasks.doerId,
      initiatorId: tasks.initiatorId,
      status: tasks.status,
      dueAt: tasks.dueAt,
    })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.recurrenceRule),
        isNull(tasks.recurrenceParentId),
        eq(tasks.archived, false),
      ),
    )
    .orderBy(asc(tasks.title));

  if (templates.length === 0) return [];

  // Build doer/initiator name lookup in one round-trip.
  //
  // `doerId` is nullable (migration 0075 — unassigned pool tasks), so the nulls
  // are stripped before the lookup: a null in the id list matches nothing and
  // only widens the parameter list.
  //
  // Uses `inArray`, NOT sql`… = ANY(${ids})`. Interpolating a JS array into a
  // sql`` template expands it to a row constructor — `= ANY(($1, $2))` — which
  // Postgres rejects, because ANY needs an array or a subquery. That threw on
  // every render of /admin/settings as soon as a recurring template existed.
  const peopleIds = Array.from(
    new Set(templates.flatMap((t) => [t.doerId, t.initiatorId])),
  ).filter((id): id is string => id !== null);
  const people =
    peopleIds.length > 0
      ? await db
          .select({ id: employees.id, name: employees.name })
          .from(employees)
          .where(inArray(employees.id, peopleIds))
      : [];
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  // Child counts + earliest future due per template in one query.
  //
  // `now` is passed as an ISO string with an explicit ::timestamptz cast. A raw
  // Date interpolated into a sql`` fragment serialises via .toString() —
  // "Thu Aug 06 2026 14:18:10 GMT+0530 (India Standard Time)" — which Postgres
  // cannot parse. Drizzle only knows to call .toISOString() when the column
  // type is in scope, which it isn't inside an arbitrary fragment. Same trap,
  // same fix as the optimistic-lock predicate in app/(app)/tasks/actions.ts.
  const nowIso = new Date().toISOString();
  const counts = (await db
    .select({
      parentId: tasks.recurrenceParentId,
      n: sql<number>`count(*)::int`,
      nextDue: sql<Date | null>`min(case when ${tasks.dueAt} > ${nowIso}::timestamptz then ${tasks.dueAt} else null end)`,
    })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.recurrenceParentId),
        eq(tasks.archived, false),
      ),
    )
    .groupBy(tasks.recurrenceParentId)) as Array<{
      parentId: string | null;
      n: number;
      nextDue: Date | null;
    }>;
  const countsByParent = new Map(counts.map((c) => [c.parentId, c]));

  return templates.map((t) => {
    const c = countsByParent.get(t.id);
    return {
      id: t.id,
      shortId: t.shortId,
      title: t.title,
      subject: t.subject,
      rule: t.rule ?? "",
      doerName: t.doerId ? nameById.get(t.doerId) ?? null : null,
      initiatorName: nameById.get(t.initiatorId) ?? null,
      status: t.status,
      dueAt: t.dueAt,
      childCount: c?.n ?? 0,
      nextChildDueAt: c?.nextDue ?? null,
    };
  });
}
