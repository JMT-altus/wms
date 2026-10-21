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

import { PERMISSION_FIELDS, permissionFieldDef, type PermissionFieldKey } from "@/db/enums";

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
 * The two bypasses are skipped for an entry that opts out (adminBypass /
 * superAdminBypass false) and always for a `sensitive` one — those need an
 * explicit grant even for admins and super-admins. An explicit deny at the
 * person or department level always beats the bypasses that remain.
 *
 * A `sensitive` entry also has no department layer: person → org-wide →
 * default.
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
  // A sensitive entry never takes either bypass, whatever its flags say: it
  // needs an explicit grant (person, department or org-wide). Unregistered keys
  // keep the original behaviour (bypasses on, default denied).
  const def = permissionFieldDef(fieldKey);
  const sensitive = def?.sensitive === true;
  const superAdminBypass = !sensitive && def?.superAdminBypass !== false;
  const adminBypass = !sensitive && def?.adminBypass !== false;

  if (subject.isSuperAdmin && superAdminBypass) return { allowed: true, source: "super-admin" };

  const own = grants.employee[fieldKey];
  if (own !== undefined) return { allowed: own, source: "employee" };

  // Sensitive entries have NO department layer: department membership is
  // managed by any admin (including for themselves), so a department grant
  // would let an admin give themselves a capability only a super-admin may
  // grant. Department rows for a sensitive key — allow or deny — are ignored;
  // grant those to a person or organisation-wide instead. (Consequence: a
  // department deny no longer narrows an org-wide sensitive grant; a
  // person-level deny still does.)
  const dept = sensitive ? undefined : grants.department[fieldKey];
  if (dept !== undefined) return { allowed: dept, source: "department" };

  if (subject.isAdmin && adminBypass) return { allowed: true, source: "admin" };

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
