import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";

/**
 * The admin Employee Salary Report's employee list: every employee, active
 * first then by name, inactive ones marked (their past months stay viewable).
 * Read only by pages that have already passed requireAdmin().
 */
export async function listReportEmployees(): Promise<{ id: string; name: string; inactive: boolean; timezone: string | null }[]> {
  const rows = await db
    .select({ id: employees.id, name: employees.name, isActive: employees.isActive, timezone: employees.timezone })
    .from(employees)
    .orderBy(asc(employees.name));
  return rows
    .map((r) => ({ id: r.id, name: r.name, inactive: !r.isActive, timezone: r.timezone }))
    .sort((a, b) => Number(a.inactive) - Number(b.inactive) || a.name.localeCompare(b.name));
}

/** One employee for the report, or null. */
export async function getReportEmployee(id: string): Promise<{ id: string; name: string; inactive: boolean; timezone: string | null } | null> {
  const [r] = await db.select({ id: employees.id, name: employees.name, isActive: employees.isActive, timezone: employees.timezone }).from(employees).where(eq(employees.id, id)).limit(1);
  return r ? { id: r.id, name: r.name, inactive: !r.isActive, timezone: r.timezone } : null;
}
