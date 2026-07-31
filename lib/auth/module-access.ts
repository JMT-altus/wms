import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { employeeDepartments, moduleAccessGrants, type Employee } from "@/db/schema";
import { getCurrentEmployee, requireUser } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { MODULE_IDS, type ModuleId } from "@/lib/nav-modules";
import {
  resolveModuleAccess,
  type AccessDecision,
  type ResolvedGrants,
} from "@/lib/access/modules";

const MODULE_ID_SET = new Set<string>(MODULE_IDS);

/** Every department the person belongs to (M2M first, legacy FK as a backstop). */
async function departmentIdsFor(employee: Employee): Promise<string[]> {
  const rows = await db
    .select({ departmentId: employeeDepartments.departmentId })
    .from(employeeDepartments)
    .where(eq(employeeDepartments.employeeId, employee.id));
  const ids = new Set(rows.map((r) => r.departmentId));
  if (employee.departmentId) ids.add(employee.departmentId);
  return [...ids];
}

/**
 * Pull just the grant rows that can possibly apply to this person — the
 * org-wide rows, their own rows, and their departments' rows — and collapse
 * them into the shape the rule engine wants.  Department-level allow beats
 * department-level deny (see ResolvedGrants).
 */
async function loadGrants(employee: Employee): Promise<ResolvedGrants> {
  const deptIds = await departmentIdsFor(employee);

  const subjectFilters = [
    and(eq(moduleAccessGrants.subjectType, "everyone"), isNull(moduleAccessGrants.subjectId)),
    and(
      eq(moduleAccessGrants.subjectType, "employee"),
      eq(moduleAccessGrants.subjectId, employee.id),
    ),
  ];
  if (deptIds.length > 0) {
    subjectFilters.push(
      and(
        eq(moduleAccessGrants.subjectType, "department"),
        inArray(moduleAccessGrants.subjectId, deptIds),
      ),
    );
  }

  const rows = await db
    .select({
      moduleId: moduleAccessGrants.moduleId,
      subjectType: moduleAccessGrants.subjectType,
      allowed: moduleAccessGrants.allowed,
    })
    .from(moduleAccessGrants)
    .where(or(...subjectFilters));

  const grants: ResolvedGrants = { everyone: {}, department: {}, employee: {} };
  for (const r of rows) {
    if (!MODULE_ID_SET.has(r.moduleId)) continue; // stale row from a removed module
    const moduleId = r.moduleId as ModuleId;
    if (r.subjectType === "department") {
      // Any allow across their departments wins.
      grants.department[moduleId] = (grants.department[moduleId] ?? false) || r.allowed;
    } else if (r.subjectType === "employee") {
      grants.employee[moduleId] = r.allowed;
    } else {
      grants.everyone[moduleId] = r.allowed;
    }
  }
  return grants;
}

/** Decide every module for one employee. One DB round-trip per level. */
export async function getModuleAccessFor(
  employee: Employee,
): Promise<Record<ModuleId, AccessDecision>> {
  const subject = { isAdmin: employee.isAdmin, isSuperAdmin: isSuperAdmin(employee.email) };
  const grants = subject.isSuperAdmin
    ? ({ everyone: {}, department: {}, employee: {} } satisfies ResolvedGrants)
    : await loadGrants(employee);

  const out = {} as Record<ModuleId, AccessDecision>;
  for (const id of MODULE_IDS) out[id] = resolveModuleAccess(id, subject, grants);
  return out;
}

/**
 * The signed-in person's module access, memoised for the request so the hub,
 * the layout guard and the nav can all ask without re-querying.  Signed out =
 * nothing allowed (the caller is about to be redirected to /login anyway).
 */
export const getMyModuleAccess = cache(
  async (): Promise<Record<ModuleId, AccessDecision>> => {
    const me = await getCurrentEmployee();
    if (!me || !me.isActive) {
      const out = {} as Record<ModuleId, AccessDecision>;
      for (const id of MODULE_IDS) out[id] = { allowed: false, source: "default" };
      return out;
    }
    return getModuleAccessFor(me);
  },
);

/** Boolean helper for route handlers, which must return 403 rather than redirect. */
export async function canAccessModule(moduleId: ModuleId): Promise<boolean> {
  const access = await getMyModuleAccess();
  return access[moduleId]?.allowed ?? false;
}

/**
 * Guard for pages/layouts: bounce to the hub with a flag the hub turns into a
 * "you don't have access" notice.  Returns the employee so callers can use it
 * the way they'd use requireUser().
 */
export async function requireModuleAccess(moduleId: ModuleId): Promise<Employee> {
  const me = await requireUser();
  const access = await getMyModuleAccess();
  if (!access[moduleId]?.allowed) {
    redirect(`/hub?denied=${moduleId}` as Route);
  }
  return me;
}
