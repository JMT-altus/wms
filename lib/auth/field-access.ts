import "server-only";
import { cache } from "react";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { employeeDepartments, fieldPermissionGrants, type Employee } from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { PERMISSION_FIELDS } from "@/db/enums";
import {
  resolveFieldAccess,
  type FieldDecision,
  type ResolvedFieldGrants,
} from "@/lib/access/field-permissions";

/** Every department the person belongs to (M2M, legacy FK as a backstop). */
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
 * Pull only the grants that can apply to this person — org-wide, their own, and
 * their departments' — and collapse them per level. Department-level allow
 * beats department-level deny: membership grants access, it never subtracts it.
 */
async function loadFieldGrants(employee: Employee): Promise<ResolvedFieldGrants> {
  const deptIds = await departmentIdsFor(employee);

  const filters = [
    and(eq(fieldPermissionGrants.subjectType, "everyone"), isNull(fieldPermissionGrants.subjectId)),
    and(
      eq(fieldPermissionGrants.subjectType, "employee"),
      eq(fieldPermissionGrants.subjectId, employee.id),
    ),
  ];
  if (deptIds.length > 0) {
    filters.push(
      and(
        eq(fieldPermissionGrants.subjectType, "department"),
        inArray(fieldPermissionGrants.subjectId, deptIds),
      ),
    );
  }

  const rows = await db
    .select({
      fieldKey: fieldPermissionGrants.fieldKey,
      subjectType: fieldPermissionGrants.subjectType,
      allowed: fieldPermissionGrants.allowed,
    })
    .from(fieldPermissionGrants)
    .where(or(...filters));

  const grants: ResolvedFieldGrants = { everyone: {}, department: {}, employee: {} };
  for (const r of rows) {
    if (r.subjectType === "department") {
      grants.department[r.fieldKey] = (grants.department[r.fieldKey] ?? false) || r.allowed;
    } else if (r.subjectType === "employee") {
      grants.employee[r.fieldKey] = r.allowed;
    } else {
      grants.everyone[r.fieldKey] = r.allowed;
    }
  }
  return grants;
}

export async function getFieldAccessFor(
  employee: Employee,
): Promise<Record<string, FieldDecision>> {
  const subject = { isAdmin: employee.isAdmin, isSuperAdmin: isSuperAdmin(employee.email) };
  const grants = subject.isSuperAdmin
    ? ({ everyone: {}, department: {}, employee: {} } satisfies ResolvedFieldGrants)
    : await loadFieldGrants(employee);

  const out: Record<string, FieldDecision> = {};
  for (const f of PERMISSION_FIELDS) out[f.key] = resolveFieldAccess(f.key, subject, grants);
  return out;
}

/** The signed-in person's field rights, memoised for the request. */
export const getMyFieldAccess = cache(
  async (): Promise<Record<string, FieldDecision>> => {
    const me = await getCurrentEmployee();
    if (!me || !me.isActive) {
      const out: Record<string, FieldDecision> = {};
      for (const f of PERMISSION_FIELDS) out[f.key] = { allowed: false, source: "default" };
      return out;
    }
    return getFieldAccessFor(me);
  },
);

/**
 * The guard to call before honouring an edit to a sensitive field. Server
 * actions must call this — hiding the input is a UI courtesy, not a control.
 */
export async function canEditField(fieldKey: string): Promise<boolean> {
  const access = await getMyFieldAccess();
  return access[fieldKey]?.allowed ?? false;
}
