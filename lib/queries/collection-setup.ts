import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, fieldPermissionGrants } from "@/db/schema";
import { SETUP_HINT_KEYS, type CapabilityHolders, type SetupHintKey } from "@/lib/collections/setup-hints";

/**
 * Who currently holds each setup-hint capability by an EXPLICIT Allow — read-only,
 * for the super-admin's "setup needed" notice. Counts active admins with a
 * person-level Allow (the Forms area is admin-only, and sensitive capabilities
 * have no department layer) and whether an organisation-wide Allow exists.
 * Returns null if the grants can't be read, so a failure here never breaks the
 * Tracker and never produces a misleading notice.
 */
export async function capabilityHolders(): Promise<Partial<Record<SetupHintKey, CapabilityHolders>> | null> {
  try {
    const rows = await db
      .select({ key: fieldPermissionGrants.fieldKey, type: fieldPermissionGrants.subjectType, subjectId: fieldPermissionGrants.subjectId })
      .from(fieldPermissionGrants)
      .where(
        and(
          inArray(fieldPermissionGrants.fieldKey, [...SETUP_HINT_KEYS]),
          eq(fieldPermissionGrants.allowed, true),
          inArray(fieldPermissionGrants.subjectType, ["employee", "everyone"]),
        ),
      );
    const personIds = [...new Set(rows.filter((r) => r.type === "employee" && r.subjectId).map((r) => r.subjectId!))];
    const eligible = new Set(
      personIds.length === 0
        ? []
        : (
            await db
              .select({ id: employees.id })
              .from(employees)
              .where(and(inArray(employees.id, personIds), eq(employees.isActive, true), eq(employees.isAdmin, true)))
          ).map((e) => e.id),
    );
    const out: Partial<Record<SetupHintKey, CapabilityHolders>> = {};
    for (const key of SETUP_HINT_KEYS) {
      const mine = rows.filter((r) => r.key === key);
      out[key] = {
        people: new Set(mine.filter((r) => r.type === "employee" && r.subjectId && eligible.has(r.subjectId)).map((r) => r.subjectId)).size,
        orgWide: mine.some((r) => r.type === "everyone"),
      };
    }
    return out;
  } catch {
    console.error("[collection-setup] could not read capability grants");
    return null;
  }
}
