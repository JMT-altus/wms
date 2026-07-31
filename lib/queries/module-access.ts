import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { departments, employeeDepartments, employees, moduleAccessGrants } from "@/db/schema";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import type { SubjectType } from "@/lib/access/modules";

export interface GrantRow {
  moduleId: string;
  subjectType: SubjectType;
  /** null for the org-wide `everyone` rows. */
  subjectId: string | null;
  allowed: boolean;
}

export interface AccessDepartmentRow {
  id: string;
  name: string;
  isActive: boolean;
  memberCount: number;
}

export interface AccessPersonRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  departmentIds: string[];
  departmentNames: string[];
}

export interface AccessMatrix {
  grants: GrantRow[];
  departments: AccessDepartmentRow[];
  people: AccessPersonRow[];
}

/**
 * Everything /admin/access renders, in four flat queries.  The effective
 * yes/no per cell is derived on the client with the same pure resolver the
 * server guard uses (lib/access/modules.ts), so the preview can update the
 * instant a toggle is flipped rather than after a round-trip.
 */
export async function getAccessMatrix(): Promise<AccessMatrix> {
  const [grantRows, deptRows, peopleRows, membershipRows] = await Promise.all([
    db
      .select({
        moduleId: moduleAccessGrants.moduleId,
        subjectType: moduleAccessGrants.subjectType,
        subjectId: moduleAccessGrants.subjectId,
        allowed: moduleAccessGrants.allowed,
      })
      .from(moduleAccessGrants),
    db
      .select({
        id: departments.id,
        name: departments.name,
        isActive: departments.isActive,
        sortOrder: departments.sortOrder,
      })
      .from(departments)
      .orderBy(asc(departments.sortOrder), asc(departments.name)),
    db
      .select({
        id: employees.id,
        name: employees.name,
        email: employees.email,
        avatarUrl: employees.avatarUrl,
        isAdmin: employees.isAdmin,
      })
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(asc(employees.name)),
    db
      .select({
        employeeId: employeeDepartments.employeeId,
        departmentId: employeeDepartments.departmentId,
        departmentName: departments.name,
      })
      .from(employeeDepartments)
      .innerJoin(departments, eq(departments.id, employeeDepartments.departmentId))
      .orderBy(asc(departments.name)),
  ]);

  const byEmployee = new Map<string, { ids: string[]; names: string[] }>();
  const memberCount = new Map<string, number>();
  for (const m of membershipRows) {
    const entry = byEmployee.get(m.employeeId) ?? { ids: [], names: [] };
    entry.ids.push(m.departmentId);
    entry.names.push(m.departmentName);
    byEmployee.set(m.employeeId, entry);
    memberCount.set(m.departmentId, (memberCount.get(m.departmentId) ?? 0) + 1);
  }

  return {
    grants: grantRows.map((g) => ({
      moduleId: g.moduleId,
      subjectType: g.subjectType,
      subjectId: g.subjectId,
      allowed: g.allowed,
    })),
    departments: deptRows.map((d) => ({
      id: d.id,
      name: d.name,
      isActive: d.isActive,
      memberCount: memberCount.get(d.id) ?? 0,
    })),
    people: peopleRows.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      avatarUrl: p.avatarUrl,
      isAdmin: p.isAdmin,
      isSuperAdmin: isSuperAdmin(p.email),
      departmentIds: byEmployee.get(p.id)?.ids ?? [],
      departmentNames: byEmployee.get(p.id)?.names ?? [],
    })),
  };
}
