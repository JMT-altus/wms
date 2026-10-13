import "server-only";
import { and, asc, gte, lte, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays } from "@/db/schema";

export interface HolidayRow {
  id: string;
  holidayDate: string;
  label: string;
  isActive: boolean;
  /** An optional holiday: listed, but not a day off for everyone. */
  isOptional: boolean;
  createdAt: Date;
}

/**
 * Holidays, oldest-first. When `year` is given, scope to that calendar year;
 * otherwise return every holiday on record. Inactive rows are included (the
 * admin list shows them with an Inactive pill); the query layer (B7) reads
 * `listHolidayDateSet` for the active-only set it actually applies.
 */
export async function listHolidays(year?: number): Promise<HolidayRow[]> {
  const where =
    year !== undefined
      ? and(
          gte(holidays.holidayDate, `${year}-01-01`),
          lte(holidays.holidayDate, `${year}-12-31`),
        )
      : undefined;

  const rows = await db
    .select({
      id: holidays.id,
      holidayDate: holidays.holidayDate,
      label: holidays.label,
      isActive: holidays.isActive,
      isOptional: holidays.isOptional,
      createdAt: holidays.createdAt,
    })
    .from(holidays)
    .where(where)
    .orderBy(asc(holidays.holidayDate));

  return rows;
}

/**
 * Set of active holiday dates (YYYY-MM-DD) for a calendar year. Used by the
 * attendance query layer (B7) to mark off holidays in the monthly grid.
 *
 * MANDATORY holidays only. An optional holiday is a day each person may choose
 * to take, not a day off for all, so it must not grade as "H" (a paid day with
 * no work expected) — staff work it unless they take it through leave/comp-off.
 */
export async function listHolidayDateSet(year: number): Promise<Set<string>> {
  const rows = await db
    .select({ holidayDate: holidays.holidayDate })
    .from(holidays)
    .where(
      and(
        eq(holidays.isActive, true),
        eq(holidays.isOptional, false),
        gte(holidays.holidayDate, `${year}-01-01`),
        lte(holidays.holidayDate, `${year}-12-31`),
      ),
    );
  return new Set(rows.map((r) => r.holidayDate));
}
