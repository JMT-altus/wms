import "server-only";
import { aliasedTable, and, asc, between, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendanceWaivers, employees } from "@/db/schema";
import { PolicyReadError } from "@/lib/attendance/policy-read";

/**
 * Attendance waivers (0126) — the reads grading and the HR screen need.
 *
 * Before migration 0126 is applied the table does not exist; then there can be no
 * waiver at all, so "no waivers" is the exact answer (grading is unchanged), even
 * for salary. Any OTHER read failure: salary generation (strict) refuses with
 * `PolicyReadError`; attendance pages log it and grade without waivers.
 */

const missingTable = (err: unknown): boolean => {
  for (let e: unknown = err, i = 0; e && i < 4; i++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "42P01") return true;
  }
  return false;
};

/** Active waiver dates per employee within [first, last]. `employeeIds` null = everyone. */
export async function activeWaiverDates(
  employeeIds: readonly string[] | null,
  first: string,
  last: string,
  opts: { strict?: boolean } = {},
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (employeeIds && employeeIds.length === 0) return out;
  try {
    const where = and(
      isNull(attendanceWaivers.reversedAt),
      between(attendanceWaivers.logDate, first, last),
      employeeIds ? inArray(attendanceWaivers.employeeId, [...employeeIds]) : undefined,
    );
    const rows = await db.select({ e: attendanceWaivers.employeeId, d: attendanceWaivers.logDate }).from(attendanceWaivers).where(where);
    for (const r of rows) {
      const s = out.get(r.e);
      if (s) s.add(r.d);
      else out.set(r.e, new Set([r.d]));
    }
    return out;
  } catch (err) {
    if (missingTable(err)) return out;
    if (opts.strict) throw new PolicyReadError("Attendance waivers could not be read, so salary was not generated. Try again.", { cause: err });
    console.error("[attendance] waivers unreadable; grading without them", err);
    return out;
  }
}

export interface WaiverRecord {
  id: string;
  date: string;
  reason: string;
  waivedBy: string | null;
  waivedAt: string;
  reversedBy: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
}

/** Every waiver episode (active and reversed) for one employee in a date range, oldest first. Empty before 0126. */
export async function listWaivers(employeeId: string, first: string, last: string): Promise<WaiverRecord[]> {
  const waivedBy = aliasedTable(employees, "waived_by");
  const reversedBy = aliasedTable(employees, "reversed_by");
  try {
    const rows = await db
      .select({
        id: attendanceWaivers.id,
        date: attendanceWaivers.logDate,
        reason: attendanceWaivers.reason,
        waivedBy: waivedBy.name,
        waivedAt: attendanceWaivers.waivedAt,
        reversedBy: reversedBy.name,
        reversedAt: attendanceWaivers.reversedAt,
        reverseReason: attendanceWaivers.reverseReason,
      })
      .from(attendanceWaivers)
      .leftJoin(waivedBy, eq(attendanceWaivers.waivedById, waivedBy.id))
      .leftJoin(reversedBy, eq(attendanceWaivers.reversedById, reversedBy.id))
      .where(and(eq(attendanceWaivers.employeeId, employeeId), between(attendanceWaivers.logDate, first, last)))
      .orderBy(asc(attendanceWaivers.logDate), asc(attendanceWaivers.waivedAt));
    return rows.map((r) => ({ ...r, waivedAt: r.waivedAt.toISOString(), reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null }));
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

export const isMissingTable = missingTable;
