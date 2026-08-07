/**
 * Field-level permissions — the rule engine.
 *
 * This is the FIELD layer that sits under the MODULE layer in
 * lib/access/modules.ts. Same shape, same resolution order, deliberately: two
 * different mental models for "who can do what" is how permission bugs happen.
 *
 * Pure and dependency-free (no `server-only`, no db) so the same code decides
 * access on the server AND renders the live "effective" preview in the admin
 * matrix. The DB adapter lives in lib/auth/field-access.ts.
 */

import { PERMISSION_FIELDS, type PermissionFieldKey } from "@/db/enums";

export type { PermissionFieldKey };

export const FIELD_SUBJECT_TYPES = ["everyone", "department", "employee"] as const;
export type FieldSubjectType = (typeof FIELD_SUBJECT_TYPES)[number];

/** What an admin picked in one cell of the matrix. */
export const FIELD_ACCESS_LEVELS = ["inherit", "allow", "deny"] as const;
export type FieldAccessLevel = (typeof FIELD_ACCESS_LEVELS)[number];

/** Code defaults, straight from the field registry in db/enums.ts. */
export const FIELD_CODE_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  PERMISSION_FIELDS.map((f) => [f.key, f.defaultAllowed]),
);

export type FieldAccessSource =
  | "super-admin"
  | "employee"
  | "department"
  | "admin"
  | "everyone"
  | "default";

export interface ResolvedFieldGrants {
  everyone: Record<string, boolean>;
  /** Union across the person's departments — any allow wins. */
  department: Record<string, boolean>;
  employee: Record<string, boolean>;
}

export interface FieldSubject {
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface FieldDecision {
  allowed: boolean;
  source: FieldAccessSource;
}

/**
 * Resolve one field for one person, most specific level first:
 *
 *   super-admin → per-employee → per-department → admin bypass → org-wide → code default
 *
 * The admin bypass sits ABOVE the org-wide layer for the same reason it does in
 * the module engine: "everyone" means "the staff default", and an org-wide deny
 * of, say, Average Rate must not lock out the people who administer it. To
 * restrict an admin you target them by name or department — both outrank it.
 */
export function resolveFieldAccess(
  fieldKey: string,
  subject: FieldSubject,
  grants: ResolvedFieldGrants,
): FieldDecision {
  if (subject.isSuperAdmin) return { allowed: true, source: "super-admin" };

  const own = grants.employee[fieldKey];
  if (own !== undefined) return { allowed: own, source: "employee" };

  const dept = grants.department[fieldKey];
  if (dept !== undefined) return { allowed: dept, source: "department" };

  if (subject.isAdmin) return { allowed: true, source: "admin" };

  const org = grants.everyone[fieldKey];
  if (org !== undefined) return { allowed: org, source: "everyone" };

  return { allowed: FIELD_CODE_DEFAULTS[fieldKey] ?? false, source: "default" };
}

export const FIELD_SOURCE_LABEL: Record<FieldAccessSource, string> = {
  "super-admin": "Super-admin — always on",
  employee: "Set for this person",
  department: "From their department",
  admin: "Admins bypass the org default",
  everyone: "From the org-wide default",
  default: "Built-in default",
};

export function fieldLevelToAllowed(level: FieldAccessLevel): boolean | null {
  if (level === "allow") return true;
  if (level === "deny") return false;
  return null;
}

export function allowedToFieldLevel(allowed: boolean | null | undefined): FieldAccessLevel {
  if (allowed === true) return "allow";
  if (allowed === false) return "deny";
  return "inherit";
}
