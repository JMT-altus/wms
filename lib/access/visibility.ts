/**
 * Row-level visibility — the rules, as pure functions.
 *
 * Deliberately dependency-free (no `server-only`, no db) so the same logic
 * decides access on the server, renders the "who can see this" summary in the
 * UI, and is unit-testable in isolation. The SQL translation lives in
 * lib/auth/task-visibility.ts; the two must agree, which is what the shared
 * `describeAudience` / `canSee*` helpers here are for.
 */

import type { AudienceKind, Visibility } from "@/db/enums";

export type { AudienceKind, Visibility };

/** One audience entry on a restricted row. */
export interface AudienceEntry {
  kind: AudienceKind;
  /** Department or employee id; null for `management`. */
  refId: string | null;
}

/** The viewer, reduced to only what a visibility decision needs. */
export interface Viewer {
  id: string;
  /** True for the two accounts in SUPER_ADMIN_EMAILS. */
  isSuperAdmin: boolean;
  /** Holds a designation flagged `is_management`. */
  isManagement: boolean;
  /** Every department they belong to (M2M, not just the primary one). */
  departmentIds: string[];
}

/** The row being judged, reduced likewise. */
export interface Subject {
  visibility: Visibility;
  /** People who are ON the row and therefore always see it. */
  participantIds: (string | null | undefined)[];
  /** Only consulted when `visibility === "restricted"`. */
  audience?: AudienceEntry[];
}

/**
 * Can this viewer see this row?
 *
 * Order matters and is deliberately narrow:
 *
 *  1. Participants always win. Without this you can create orphans — a private
 *     task reassigned to someone they can't see, sitting in nobody's list.
 *  2. Super-admins always win. "I" in the brief is Mihir Veera + Altus Corp,
 *     so those two accounts are the personal space AND the pair that keeps
 *     company-wide reporting honest. Note this deliberately does NOT extend to
 *     every `is_admin` user: an ordinary admin cannot read the personal space.
 *  3. `internal` → everyone. The pre-existing behaviour.
 *  4. `restricted` → whoever the audience names.
 *  5. otherwise (`private`) → no.
 */
export function canSee(viewer: Viewer, subject: Subject): boolean {
  if (subject.participantIds.some((id) => id != null && id === viewer.id)) {
    return true;
  }
  if (viewer.isSuperAdmin) return true;
  if (subject.visibility === "internal") return true;
  if (subject.visibility === "restricted") {
    return matchesAudience(viewer, subject.audience ?? []);
  }
  return false;
}

export function matchesAudience(viewer: Viewer, audience: AudienceEntry[]): boolean {
  for (const entry of audience) {
    if (entry.kind === "management") {
      if (viewer.isManagement) return true;
    } else if (entry.kind === "employee") {
      if (entry.refId === viewer.id) return true;
    } else if (entry.kind === "department") {
      if (entry.refId && viewer.departmentIds.includes(entry.refId)) return true;
    }
  }
  return false;
}

/** Labels for the picker. Kept here so server and client can't drift. */
export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "Personal",
  internal: "Everyone",
  restricted: "Specific people",
};

export const VISIBILITY_HINT: Record<Visibility, string> = {
  private: "Only you and anyone assigned. Hidden from other admins.",
  internal: "Every signed-in member of the team can see this.",
  restricted: "Only the departments, managers or people you pick.",
};

/**
 * Human summary of who can see a restricted row — for the detail page chip and
 * the picker's live preview, so nobody has to guess what they just configured.
 */
export function describeAudience(
  audience: AudienceEntry[],
  names: { departments: Map<string, string>; employees: Map<string, string> },
): string {
  const parts: string[] = [];
  const departments = audience
    .filter((a) => a.kind === "department" && a.refId)
    .map((a) => names.departments.get(a.refId!) ?? "a department");
  if (departments.length > 0) parts.push(departments.join(", "));
  if (audience.some((a) => a.kind === "management")) parts.push("management");
  const people = audience
    .filter((a) => a.kind === "employee" && a.refId)
    .map((a) => names.employees.get(a.refId!) ?? "someone");
  if (people.length > 0) parts.push(people.join(", "));
  return parts.length > 0 ? parts.join(" · ") : "nobody yet";
}

/**
 * A restricted row with an empty audience is visible to nobody but its
 * participants — almost always a mistake made in the picker rather than an
 * intent. Callers use this to warn instead of silently hiding the row.
 */
export function isEmptyRestricted(
  visibility: Visibility,
  audience: AudienceEntry[],
): boolean {
  return visibility === "restricted" && audience.length === 0;
}
