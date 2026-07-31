/**
 * Module access — the rule engine.
 *
 * Deliberately pure and dependency-free (no `server-only`, no db) so the same
 * code decides access on the server AND renders the live "effective" preview
 * inside the /admin/access matrix.  Everything that touches the database lives
 * in lib/auth/module-access.ts (read path) and the /admin/access actions
 * (write path).
 */

import type { ModuleId } from "@/lib/nav-modules";

/** What an admin picked in the matrix for one (module, subject) cell. */
export const ACCESS_LEVELS = ["inherit", "allow", "deny"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const SUBJECT_TYPES = ["everyone", "department", "employee"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * The fallback when nobody has said anything at any level.  Mirrors the seed
 * in migration 0076: general staff get the work dashboard and the training
 * library; Employees (attendance/salary/leave) and the Incentive Tracker are
 * opened deliberately, per person or per department.
 */
export const MODULE_CODE_DEFAULTS: Record<ModuleId, boolean> = {
  wms: true,
  employees: false,
  sales: false,
  training: true,
};

/** Where a resolved yes/no came from — surfaced in the admin matrix. */
export type AccessSource =
  | "super-admin"
  | "employee"
  | "department"
  | "admin"
  | "everyone"
  | "default";

/** Explicit grants that apply to one person, already collapsed per level. */
export interface ResolvedGrants {
  /** Org-wide default rows (`subject_type = 'everyone'`). */
  everyone: Partial<Record<ModuleId, boolean>>;
  /**
   * Union of every department this person belongs to.  An `allow` from any
   * one department beats a `deny` from another — membership grants access,
   * it never subtracts it.
   */
  department: Partial<Record<ModuleId, boolean>>;
  /** Rows targeting this person directly. */
  employee: Partial<Record<ModuleId, boolean>>;
}

export interface AccessSubject {
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  source: AccessSource;
}

/**
 * Resolve one module for one person, most specific level first.
 *
 * Order: super-admin → per-employee grant → per-department grant → admin
 * bypass → org-wide default → code default.
 *
 * The admin bypass sits *above* the `everyone` layer on purpose: "everyone"
 * means "the staff default", and an org-wide deny of, say, Salary must not
 * lock the people who administer it out of their own module.  To restrict an
 * admin you target them by name or by department — both of which outrank it.
 */
export function resolveModuleAccess(
  moduleId: ModuleId,
  subject: AccessSubject,
  grants: ResolvedGrants,
): AccessDecision {
  if (subject.isSuperAdmin) return { allowed: true, source: "super-admin" };

  const own = grants.employee[moduleId];
  if (own !== undefined) return { allowed: own, source: "employee" };

  const dept = grants.department[moduleId];
  if (dept !== undefined) return { allowed: dept, source: "department" };

  if (subject.isAdmin) return { allowed: true, source: "admin" };

  const org = grants.everyone[moduleId];
  if (org !== undefined) return { allowed: org, source: "everyone" };

  return { allowed: MODULE_CODE_DEFAULTS[moduleId], source: "default" };
}

/** Human label for the "inherited from" hint in the matrix. */
export const ACCESS_SOURCE_LABEL: Record<AccessSource, string> = {
  "super-admin": "Super-admin — always on",
  employee: "Set for this person",
  department: "From their department",
  admin: "Admins bypass the org default",
  everyone: "From the org-wide default",
  default: "Built-in default",
};

/** Fold a level back into the row/absent-row representation the DB stores. */
export function levelToAllowed(level: AccessLevel): boolean | null {
  if (level === "allow") return true;
  if (level === "deny") return false;
  return null;
}

export function allowedToLevel(allowed: boolean | null | undefined): AccessLevel {
  if (allowed === true) return "allow";
  if (allowed === false) return "deny";
  return "inherit";
}
