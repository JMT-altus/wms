import "server-only";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import {
  dccClients,
  dccEntries,
  dccItemSubjects,
  dccKpiItems,
  dccReviews,
  dccSubjects,
  employees,
} from "@/db/schema";

/**
 * DCC reads.
 *
 * Every roster-shaped read takes an ID LIST and returns rows for all of them
 * in one query. There is deliberately no `listItemsForOwner(id)` that the
 * dashboard could call in a loop — that N+1 is the documented reason the
 * review screen used to take seconds and drain the pool.
 *
 * All reads go through `withDbRetry`: these are the queries behind a page
 * render, and a single dropped pooler socket should not take the screen down.
 */

export interface DccPerson {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  managerId: string | null;
}

/** The roster for the person switcher / dashboard, batched by visible ids. */
export async function listDccPeople(visibleIds: string[]): Promise<DccPerson[]> {
  if (visibleIds.length === 0) return [];
  return withDbRetry("dcc people", () =>
    db
      .select({
        id: employees.id,
        name: employees.name,
        email: employees.email,
        avatarUrl: employees.avatarUrl,
        managerId: employees.managerId,
      })
      .from(employees)
      .where(and(inArray(employees.id, visibleIds), eq(employees.isActive, true)))
      .orderBy(asc(employees.name)),
  );
}

/** Every active KPI definition for one person, in board order. */
export async function listOwnerItems(ownerId: string) {
  return withDbRetry("dcc owner items", () =>
    db
      .select()
      .from(dccKpiItems)
      .where(
        and(eq(dccKpiItems.ownerEmployeeId, ownerId), eq(dccKpiItems.archived, false)),
      )
      .orderBy(asc(dccKpiItems.sortOrder), asc(dccKpiItems.code), asc(dccKpiItems.title)),
  );
}

/** Same, for many owners at once. */
export async function listItemsForOwners(ownerIds: string[]) {
  if (ownerIds.length === 0) return [];
  return withDbRetry("dcc items for owners", () =>
    db
      .select()
      .from(dccKpiItems)
      .where(
        and(
          inArray(dccKpiItems.ownerEmployeeId, ownerIds),
          eq(dccKpiItems.archived, false),
        ),
      )
      .orderBy(asc(dccKpiItems.sortOrder), asc(dccKpiItems.code)),
  );
}

/** One person's fills from `fromDate` (inclusive) onward. */
export async function listOwnerEntries(ownerId: string, fromDate: string) {
  return withDbRetry("dcc owner entries", () =>
    db
      .select({
        id: dccEntries.id,
        itemId: dccEntries.itemId,
        entryDate: dccEntries.entryDate,
        status: dccEntries.status,
        valueNumber: dccEntries.valueNumber,
        note: dccEntries.note,
        subjectId: dccEntries.subjectId,
      })
      .from(dccEntries)
      .innerJoin(dccKpiItems, eq(dccKpiItems.id, dccEntries.itemId))
      .where(
        and(
          eq(dccKpiItems.ownerEmployeeId, ownerId),
          gte(dccEntries.entryDate, fromDate),
        ),
      ),
  );
}

/** Fills for many owners at once — carries ownerId so the caller can group. */
export async function listEntriesForOwners(ownerIds: string[], fromDate: string) {
  if (ownerIds.length === 0) return [];
  return withDbRetry("dcc entries for owners", () =>
    db
      .select({
        ownerId: dccKpiItems.ownerEmployeeId,
        itemId: dccEntries.itemId,
        entryDate: dccEntries.entryDate,
        status: dccEntries.status,
        valueNumber: dccEntries.valueNumber,
        note: dccEntries.note,
        subjectId: dccEntries.subjectId,
      })
      .from(dccEntries)
      .innerJoin(dccKpiItems, eq(dccKpiItems.id, dccEntries.itemId))
      .where(
        and(
          inArray(dccKpiItems.ownerEmployeeId, ownerIds),
          gte(dccEntries.entryDate, fromDate),
        ),
      ),
  );
}

/** Sign-offs for many owners from `fromDate` onward. */
export async function listReviewsForOwners(ownerIds: string[], fromDate: string) {
  if (ownerIds.length === 0) return [];
  return withDbRetry("dcc reviews", () =>
    db
      .select({
        ownerEmployeeId: dccReviews.ownerEmployeeId,
        reviewDate: dccReviews.reviewDate,
        reviewerId: dccReviews.reviewerId,
        status: dccReviews.status,
        note: dccReviews.note,
      })
      .from(dccReviews)
      .where(
        and(
          inArray(dccReviews.ownerEmployeeId, ownerIds),
          gte(dccReviews.reviewDate, fromDate),
        ),
      ),
  );
}

/** Section instances (clients) for one person. */
export async function listOwnerClients(ownerId: string) {
  return withDbRetry("dcc owner clients", () =>
    db
      .select()
      .from(dccClients)
      .where(and(eq(dccClients.ownerEmployeeId, ownerId), eq(dccClients.archived, false)))
      .orderBy(asc(dccClients.sortOrder), asc(dccClients.name)),
  );
}

/** Participant roster for one person. */
export async function listOwnerSubjects(ownerId: string) {
  return withDbRetry("dcc owner subjects", () =>
    db
      .select()
      .from(dccSubjects)
      .where(
        and(eq(dccSubjects.ownerEmployeeId, ownerId), eq(dccSubjects.archived, false)),
      )
      .orderBy(asc(dccSubjects.sortOrder), asc(dccSubjects.name)),
  );
}

/** item → subject links for a set of items, batched. */
export async function listItemSubjectsForItems(itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return withDbRetry("dcc item subjects", () =>
    db
      .select({
        itemId: dccItemSubjects.itemId,
        subjectId: dccItemSubjects.subjectId,
        scheduleKind: dccItemSubjects.scheduleKind,
        weekdays: dccItemSubjects.weekdays,
        sortOrder: dccItemSubjects.sortOrder,
      })
      .from(dccItemSubjects)
      .where(
        and(
          inArray(dccItemSubjects.itemId, itemIds),
          eq(dccItemSubjects.archived, false),
        ),
      )
      .orderBy(asc(dccItemSubjects.sortOrder)),
  );
}

/** Every active employee — the ranking's population. */
export async function listAllActivePeople(): Promise<DccPerson[]> {
  return withDbRetry("dcc all people", () =>
    db
      .select({
        id: employees.id,
        name: employees.name,
        email: employees.email,
        avatarUrl: employees.avatarUrl,
        managerId: employees.managerId,
      })
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(asc(employees.name)),
  );
}

/**
 * One person's items + that day's answers, for the manager review modal.
 * Two queries, not one per item.
 */
export async function getDccDayDetail(ownerId: string, date: string) {
  const [items, entries] = await Promise.all([
    listOwnerItems(ownerId),
    withDbRetry("dcc day detail entries", () =>
      db
        .select({
          itemId: dccEntries.itemId,
          status: dccEntries.status,
          valueNumber: dccEntries.valueNumber,
          note: dccEntries.note,
          subjectId: dccEntries.subjectId,
        })
        .from(dccEntries)
        .innerJoin(dccKpiItems, eq(dccKpiItems.id, dccEntries.itemId))
        .where(
          and(eq(dccKpiItems.ownerEmployeeId, ownerId), eq(dccEntries.entryDate, date)),
        ),
    ),
  ]);
  return { items, entries };
}

/**
 * Distinct section names already used by one person — feeds the datalist in
 * the add/edit dialog so sections stay consistent instead of drifting into
 * "Client work" / "client work" / "Clientwork".
 */
export async function listOwnerSections(ownerId: string): Promise<string[]> {
  const rows = await withDbRetry("dcc owner sections", () =>
    db
      .selectDistinct({ section: dccKpiItems.section })
      .from(dccKpiItems)
      .where(
        and(
          eq(dccKpiItems.ownerEmployeeId, ownerId),
          eq(dccKpiItems.archived, false),
          sql`${dccKpiItems.section} is not null`,
        ),
      ),
  );
  return rows.map((r) => r.section).filter((s): s is string => Boolean(s)).sort();
}
