"use server";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  dccClients,
  dccItemSubjects,
  dccKpiItems,
  dccSubjects,
  employees,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { getDccScope, canFill, canManageItems, canReview } from "@/lib/dcc/access";
import { writeDccEntry, writeParticipantEntries } from "@/lib/dcc/write";
import { getDccDayDetail } from "@/lib/queries/dcc";
import { parseFrequency, scheduledDueOn, isFilled } from "@/lib/dcc/util";
import {
  SetDccEntrySchema,
  SetParticipantEntriesSchema,
  CreateDccItemSchema,
  UpdateDccItemSchema,
  DeleteDccItemSchema,
  AddParticipantSchema,
  RemoveParticipantSchema,
  RenameParticipantSchema,
  CreateDccClientSchema,
  UpdateDccClientSchema,
  SetDccReviewSchema,
  DccDayDetailSchema,
  ApproveAllDccSchema,
  SummarizeDccDaySchema,
  type SetDccEntryInput,
  type SetParticipantEntriesInput,
  type CreateDccItemInput,
  type UpdateDccItemInput,
  type AddParticipantInput,
  type CreateDccClientInput,
  type SetDccReviewInput,
} from "@/lib/validators/dcc";

type ActionOk<T> = T extends undefined ? { ok: true } : { ok: true } & T;
type ActionResult<T = undefined> = ActionOk<T> | { ok: false; error: string };

function revalidateDcc() {
  revalidatePath("/dcc");
  revalidatePath("/dcc/dashboard");
  revalidatePath("/dcc/ranking");
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
}

/* ══════════════════════════════════════════════════════════════════════
   Fills
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Upsert or clear one fill slot. The board calls this on every status click,
 * number blur and note blur, optimistically — so it must be cheap and must
 * never throw to the UI.
 */
export async function setDccEntry(input: SetDccEntryInput): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SetDccEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const result = await writeDccEntry(
    { id: me.id, email: me.email },
    {
      itemId: data.itemId,
      date: data.date,
      status: data.status,
      value: data.value,
      note: data.note,
      subjectId: data.subjectId,
    },
  );
  if (!result.ok) return result;

  if (!data.silent) revalidateDcc();
  return { ok: true };
}

/** Bulk All Done / All NA / Clear across one participant KPI's whole roster. */
export async function setParticipantEntries(
  input: SetParticipantEntriesInput,
): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SetParticipantEntriesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await writeParticipantEntries(
    { id: me.id, email: me.email },
    parsed.data,
  );
  if (!result.ok) return result;

  revalidateDcc();
  return { ok: true };
}

/* ══════════════════════════════════════════════════════════════════════
   KPI definitions
   ══════════════════════════════════════════════════════════════════════ */

/** Next sort_order for an owner, so a new KPI lands at the bottom. */
async function nextSortOrder(ownerId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${dccKpiItems.sortOrder}), 0)::int` })
    .from(dccKpiItems)
    .where(eq(dccKpiItems.ownerEmployeeId, ownerId));
  return (row?.max ?? 0) + 1;
}

export async function createDccItem(
  input: CreateDccItemInput,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = CreateDccItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const scope = await getDccScope(me);
  if (!canManageItems(scope, data.ownerEmployeeId)) {
    return { ok: false, error: "You can't add KPIs for that person" };
  }

  // The frequency string is the user's; everything scheduling-related is
  // derived from it here so the board can never see a hand-set mask that
  // disagrees with the words next to it.
  const freq = parseFrequency(data.frequency);

  try {
    const [row] = await db
      .insert(dccKpiItems)
      .values({
        ownerEmployeeId: data.ownerEmployeeId,
        section: data.section,
        code: data.code,
        title: data.title,
        frequency: data.frequency,
        weekdays: freq.weekdays,
        scheduleKind: freq.scheduleKind,
        needsReview: freq.needsReview,
        isParticipantList: data.isParticipantList,
        clientId: data.clientId,
        targetNumber: data.targetNumber == null ? null : String(data.targetNumber),
        unit: data.unit,
        sortOrder: await nextSortOrder(data.ownerEmployeeId),
        createdById: me.id,
      })
      .returning({ id: dccKpiItems.id });
    if (!row) return { ok: false, error: "Insert returned no row" };
    revalidateDcc();
    return { ok: true, id: row.id };
  } catch (err) {
    return fail(err);
  }
}

export async function updateDccItem(input: UpdateDccItemInput): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = UpdateDccItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const [existing] = await db
    .select({ ownerEmployeeId: dccKpiItems.ownerEmployeeId })
    .from(dccKpiItems)
    .where(eq(dccKpiItems.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: "KPI not found" };

  const scope = await getDccScope(me);
  if (!canManageItems(scope, existing.ownerEmployeeId)) {
    return { ok: false, error: "You can't edit that KPI" };
  }

  const freq = parseFrequency(data.frequency);

  try {
    await db
      .update(dccKpiItems)
      .set({
        section: data.section,
        code: data.code,
        title: data.title,
        frequency: data.frequency,
        weekdays: freq.weekdays,
        scheduleKind: freq.scheduleKind,
        needsReview: freq.needsReview,
        isParticipantList: data.isParticipantList,
        clientId: data.clientId,
        targetNumber: data.targetNumber == null ? null : String(data.targetNumber),
        unit: data.unit,
        updatedAt: new Date(),
      })
      .where(eq(dccKpiItems.id, data.id));
    revalidateDcc();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Remove a KPI from the board. ARCHIVES rather than deletes — the fills
 * against it are somebody's compliance history, and a cascade delete would
 * silently rewrite last month's numbers.
 */
export async function deleteDccItem(input: { id: string }): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = DeleteDccItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid id" };

  const [existing] = await db
    .select({ ownerEmployeeId: dccKpiItems.ownerEmployeeId })
    .from(dccKpiItems)
    .where(eq(dccKpiItems.id, parsed.data.id))
    .limit(1);
  if (!existing) return { ok: false, error: "KPI not found" };

  const scope = await getDccScope(me);
  if (!canManageItems(scope, existing.ownerEmployeeId)) {
    return { ok: false, error: "You can't remove that KPI" };
  }

  try {
    await db
      .update(dccKpiItems)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(dccKpiItems.id, parsed.data.id));
    revalidateDcc();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Participants
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Add a participant to a KPI by NAME: upsert the subject on
 * (owner, lower(name)), then link it. Re-adding someone previously removed
 * un-archives both the subject and the link, so their history comes back
 * rather than becoming a second "Nikunj".
 */
export async function addParticipant(
  input: AddParticipantInput,
): Promise<ActionResult<{ subjectId: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = AddParticipantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const [item] = await db
    .select({
      ownerEmployeeId: dccKpiItems.ownerEmployeeId,
      isParticipantList: dccKpiItems.isParticipantList,
    })
    .from(dccKpiItems)
    .where(eq(dccKpiItems.id, data.itemId))
    .limit(1);
  if (!item) return { ok: false, error: "KPI not found" };
  if (!item.isParticipantList) {
    return { ok: false, error: "That KPI doesn't track participants" };
  }

  const scope = await getDccScope(me);
  // Adding to your own roster is a fill-time act; adding to someone else's is
  // a management act. Either grant is enough.
  if (!canFill(scope, item.ownerEmployeeId) && !canManageItems(scope, item.ownerEmployeeId)) {
    return { ok: false, error: "You can't change that roster" };
  }

  try {
    const [subject] = await db.execute<{ id: string }>(sql`
      insert into dcc_subjects (owner_employee_id, name, kind)
      values (${item.ownerEmployeeId}::uuid, ${data.name}, ${data.kind})
      on conflict (owner_employee_id, lower(name))
      do update set archived = false,
                    kind = coalesce(excluded.kind, dcc_subjects.kind)
      returning id
    `);
    if (!subject) return { ok: false, error: "Could not save the participant" };

    await db.execute(sql`
      insert into dcc_item_subjects (item_id, subject_id)
      values (${data.itemId}::uuid, ${subject.id}::uuid)
      on conflict (item_id, subject_id) do update set archived = false
    `);

    revalidateDcc();
    return { ok: true, subjectId: subject.id };
  } catch (err) {
    return fail(err);
  }
}

/** Unlink a participant from one KPI. Archives the link; keeps the history. */
export async function removeParticipant(input: {
  itemId: string;
  subjectId: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = RemoveParticipantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const [item] = await db
    .select({ ownerEmployeeId: dccKpiItems.ownerEmployeeId })
    .from(dccKpiItems)
    .where(eq(dccKpiItems.id, parsed.data.itemId))
    .limit(1);
  if (!item) return { ok: false, error: "KPI not found" };

  const scope = await getDccScope(me);
  if (!canFill(scope, item.ownerEmployeeId) && !canManageItems(scope, item.ownerEmployeeId)) {
    return { ok: false, error: "You can't change that roster" };
  }

  try {
    await db
      .update(dccItemSubjects)
      .set({ archived: true })
      .where(
        and(
          eq(dccItemSubjects.itemId, parsed.data.itemId),
          eq(dccItemSubjects.subjectId, parsed.data.subjectId),
        ),
      );
    revalidateDcc();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Rename a participant everywhere they appear (the subject row is shared). */
export async function renameParticipant(input: {
  subjectId: string;
  name: string;
  kind?: string | null;
}): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = RenameParticipantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const [subject] = await db
    .select({ ownerEmployeeId: dccSubjects.ownerEmployeeId })
    .from(dccSubjects)
    .where(eq(dccSubjects.id, parsed.data.subjectId))
    .limit(1);
  if (!subject) return { ok: false, error: "Participant not found" };

  const scope = await getDccScope(me);
  if (!canFill(scope, subject.ownerEmployeeId) && !canManageItems(scope, subject.ownerEmployeeId)) {
    return { ok: false, error: "You can't rename that participant" };
  }

  try {
    await db
      .update(dccSubjects)
      .set({ name: parsed.data.name, kind: parsed.data.kind ?? null })
      .where(eq(dccSubjects.id, parsed.data.subjectId));
    revalidateDcc();
    return { ok: true };
  } catch (err) {
    // The (owner, lower(name)) unique index is the likely failure here.
    return { ok: false, error: "Someone with that name already exists" };
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Section instancing (clients)
   ══════════════════════════════════════════════════════════════════════ */

export async function createDccClient(
  input: CreateDccClientInput,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = CreateDccClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const scope = await getDccScope(me);
  if (!canManageItems(scope, parsed.data.ownerEmployeeId)) {
    return { ok: false, error: "You can't add sections for that person" };
  }

  try {
    const [row] = await db
      .insert(dccClients)
      .values({
        ownerEmployeeId: parsed.data.ownerEmployeeId,
        section: parsed.data.section,
        name: parsed.data.name,
      })
      .returning({ id: dccClients.id });
    if (!row) return { ok: false, error: "Insert returned no row" };
    revalidateDcc();
    return { ok: true, id: row.id };
  } catch {
    return { ok: false, error: "That client already exists in this section" };
  }
}

export async function updateDccClient(input: {
  id: string;
  name: string;
  archived?: boolean;
}): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = UpdateDccClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const [row] = await db
    .select({ ownerEmployeeId: dccClients.ownerEmployeeId })
    .from(dccClients)
    .where(eq(dccClients.id, parsed.data.id))
    .limit(1);
  if (!row) return { ok: false, error: "Client not found" };

  const scope = await getDccScope(me);
  if (!canManageItems(scope, row.ownerEmployeeId)) {
    return { ok: false, error: "You can't edit that client" };
  }

  try {
    await db
      .update(dccClients)
      .set({
        name: parsed.data.name,
        ...(parsed.data.archived === undefined ? {} : { archived: parsed.data.archived }),
      })
      .where(eq(dccClients.id, parsed.data.id));
    revalidateDcc();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Manager review
   ══════════════════════════════════════════════════════════════════════ */

/** Sign off (or clear) one person's one day. Empty status + note deletes. */
export async function setDccReview(input: SetDccReviewInput): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SetDccReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const scope = await getDccScope(me);
  if (!canReview(scope, data.ownerEmployeeId)) {
    return { ok: false, error: "You can't review that person's day" };
  }

  const note = data.note?.trim() ? data.note.trim() : null;

  try {
    if (!data.status && !note) {
      await db.execute(sql`
        delete from dcc_reviews
        where owner_employee_id = ${data.ownerEmployeeId}::uuid
          and review_date = ${data.date}::date
      `);
    } else {
      await db.execute(sql`
        insert into dcc_reviews (owner_employee_id, review_date, reviewer_id, status, note)
        values (${data.ownerEmployeeId}::uuid, ${data.date}::date, ${me.id}::uuid,
                ${data.status}, ${note})
        on conflict (owner_employee_id, review_date)
        do update set reviewer_id = excluded.reviewer_id,
                      status      = excluded.status,
                      note        = excluded.note,
                      updated_at  = now()
      `);
    }
    if (!data.silent) revalidateDcc();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export interface DccReviewDetailRow {
  id: string;
  code: string | null;
  section: string | null;
  title: string;
  frequency: string | null;
  status: string | null;
  valueNumber: string | null;
  note: string | null;
  unit: string | null;
}

/** Items due on a date + their answers, for the review modal. */
export async function getDccReviewDetail(input: {
  ownerId: string;
  date: string;
}): Promise<ActionResult<{ rows: DccReviewDetailRow[] }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "read");
  if (limited) return limited;

  const parsed = DccDayDetailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const scope = await getDccScope(me);
  if (!scope.visibleIds.has(parsed.data.ownerId)) {
    return { ok: false, error: "You can't see that person's DCC" };
  }

  try {
    const { items, entries } = await getDccDayDetail(parsed.data.ownerId, parsed.data.date);
    // Only the item's own row (subjectId null) — participants are summarised
    // by the KPI itself, not listed one by one in the review modal.
    const byItem = new Map(
      entries.filter((e) => e.subjectId == null).map((e) => [e.itemId, e]),
    );
    const rows = items
      .filter((i) => scheduledDueOn(i, parsed.data.date))
      .map((i) => {
        const e = byItem.get(i.id);
        return {
          id: i.id,
          code: i.code,
          section: i.section,
          title: i.title,
          frequency: i.frequency,
          status: e?.status ?? null,
          valueNumber: e?.valueNumber ?? null,
          note: e?.note ?? null,
          unit: i.unit,
        };
      });
    return { ok: true, rows };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Approve every reviewable report for a date in one statement.
 *
 * Deliberately does NOT revalidate: the review gate calls this and then does
 * its own single `router.refresh()`. Revalidating here would re-render the
 * gate mid-action.
 */
export async function approveAllDccReviews(input: {
  date: string;
}): Promise<ActionResult<{ approved: number }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = ApproveAllDccSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid date" };

  const scope = await getDccScope(me);
  const targets = [...scope.visibleIds].filter((id) => canReview(scope, id));
  if (targets.length === 0) return { ok: true, approved: 0 };

  try {
    // ON CONFLICT DO NOTHING: never overwrite a verdict a manager already
    // typed — "approve the rest" must not silently flip a needs_rework.
    await db.execute(sql`
      insert into dcc_reviews (owner_employee_id, review_date, reviewer_id, status)
      select o, ${parsed.data.date}::date, ${me.id}::uuid, 'approved'
      from unnest(${targets}::uuid[]) as o
      on conflict (owner_employee_id, review_date) do nothing
    `);
    return { ok: true, approved: targets.length };
  } catch (err) {
    return fail(err);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   AI day summary
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Ask the LLM for a 2–3 sentence read of one person's day.
 *
 * Optional by design: with no key configured this returns a clean message
 * rather than an error, and the button simply says so.
 */
export async function summarizeDccDay(input: {
  ownerId: string;
  date: string;
}): Promise<ActionResult<{ summary: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SummarizeDccDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const scope = await getDccScope(me);
  if (!scope.visibleIds.has(parsed.data.ownerId)) {
    return { ok: false, error: "You can't see that person's DCC" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI summaries aren't configured on this environment." };
  }

  const { items, entries } = await getDccDayDetail(parsed.data.ownerId, parsed.data.date);
  const byItem = new Map(entries.filter((e) => e.subjectId == null).map((e) => [e.itemId, e]));
  const lines = items
    .map((i) => {
      const e = byItem.get(i.id);
      if (!isFilled(e)) return null;
      const value = e?.valueNumber ? ` (${e.valueNumber}${i.unit ? ` ${i.unit}` : ""})` : "";
      const note = e?.note ? ` — ${e.note}` : "";
      return `- ${i.title}: ${e?.status ?? "—"}${value}${note}`;
    })
    .filter((l): l is string => l !== null);

  if (lines.length === 0) {
    return { ok: false, error: "Nothing is filled for this day yet." };
  }

  const [person] = await db
    .select({ name: employees.name })
    .from(employees)
    .where(eq(employees.id, parsed.data.ownerId))
    .limit(1);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content:
              `Here is ${person?.name ?? "this person"}'s daily compliance checklist for ` +
              `${parsed.data.date}. Write 2-3 plain sentences summarising how the day went: ` +
              `what got done, what slipped, and anything worth a manager's attention. ` +
              `No preamble, no bullet points.\n\n${lines.join("\n")}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `AI request failed (${res.status})` };
    }
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    const summary = json.content?.map((c) => c.text ?? "").join("").trim();
    if (!summary) return { ok: false, error: "The AI returned an empty summary." };
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed" };
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Misc
   ══════════════════════════════════════════════════════════════════════ */

/** Distinct sections for the add/edit dialog's datalist. */
export async function listDccSectionsFor(ownerId: string): Promise<string[]> {
  const me = await requireUser();
  const scope = await getDccScope(me);
  if (!scope.visibleIds.has(ownerId)) return [];
  const rows = await db
    .selectDistinct({ section: dccKpiItems.section })
    .from(dccKpiItems)
    .where(and(eq(dccKpiItems.ownerEmployeeId, ownerId), eq(dccKpiItems.archived, false)))
    .orderBy(asc(dccKpiItems.section));
  return rows.map((r) => r.section).filter((s): s is string => Boolean(s));
}
