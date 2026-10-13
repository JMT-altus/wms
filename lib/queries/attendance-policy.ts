import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendancePolicyChanges, employees, holidays } from "@/db/schema";
import type { MonthHoliday } from "@/lib/attendance/payroll-rules";
import { resolvePolicyStrict } from "@/lib/attendance/policy-read";
import {
  resolvePolicy,
  type PolicyChange,
  type PolicyValue,
  type PolicyValues,
} from "@/lib/attendance/policy";

/** Every recorded change, oldest first. Read-only. */
export async function listPolicyChanges(): Promise<PolicyChange[]> {
  const rows = await db
    .select({
      key: attendancePolicyChanges.policyKey,
      value: attendancePolicyChanges.value,
      effectiveFrom: attendancePolicyChanges.effectiveFrom,
      createdAt: attendancePolicyChanges.createdAt,
    })
    .from(attendancePolicyChanges)
    .orderBy(asc(attendancePolicyChanges.effectiveFrom), asc(attendancePolicyChanges.createdAt));
  return rows.map((r) => ({ ...r, value: r.value as PolicyValue }));
}

/** The policy in force on `asOf` (YYYY-MM-DD). */
export async function getPolicyAsOf(asOf: string): Promise<PolicyValues> {
  return resolvePolicy(await listPolicyChanges(), asOf);
}

/**
 * The same, for salary: any stored value that fails validation throws
 * `PolicyReadError` instead of being used. A failed read throws too.
 */
export async function getPolicyAsOfStrict(asOf: string): Promise<PolicyValues> {
  return resolvePolicyStrict(await listPolicyChanges(), asOf);
}

export interface PolicyHistoryRow {
  id: string;
  key: string;
  value: PolicyValue;
  previousValue: PolicyValue;
  effectiveFrom: string;
  reason: string;
  changedByName: string | null;
  createdAt: Date;
}

/** The audit trail, newest first. */
export async function listPolicyHistory(limit = 100): Promise<PolicyHistoryRow[]> {
  const rows = await db
    .select({
      id: attendancePolicyChanges.id,
      key: attendancePolicyChanges.policyKey,
      value: attendancePolicyChanges.value,
      previousValue: attendancePolicyChanges.previousValue,
      effectiveFrom: attendancePolicyChanges.effectiveFrom,
      reason: attendancePolicyChanges.reason,
      changedByName: employees.name,
      createdAt: attendancePolicyChanges.createdAt,
    })
    .from(attendancePolicyChanges)
    .leftJoin(employees, eq(attendancePolicyChanges.changedById, employees.id))
    .orderBy(desc(attendancePolicyChanges.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    value: r.value as PolicyValue,
    previousValue: (r.previousValue ?? null) as PolicyValue,
  }));
}

/**
 * Active holidays in a month, from the `holidays` table — the one source of
 * holiday dates. Read-only: attendance never writes to it.
 */
export async function loadMonthHolidays(year: number, month: number): Promise<MonthHoliday[]> {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = await db
    .select({ date: holidays.holidayDate, optional: holidays.isOptional })
    .from(holidays)
    .where(
      and(
        eq(holidays.isActive, true),
        gte(holidays.holidayDate, `${year}-${mm}-01`),
        lte(holidays.holidayDate, `${year}-${mm}-${String(last).padStart(2, "0")}`),
      ),
    );
  return rows;
}
