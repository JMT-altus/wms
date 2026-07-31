"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, moduleAccessGrants, settingsEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { levelToAllowed, type AccessLevel, type SubjectType } from "@/lib/access/modules";
import {
  BulkSetModuleAccessSchema,
  ClearSubjectAccessSchema,
  SetModuleAccessSchema,
  type BulkSetModuleAccessInput,
  type ClearSubjectAccessInput,
  type SetModuleAccessInput,
} from "@/lib/validators/module-access";

type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Every surface whose output depends on a grant. */
function revalidateAccess(): void {
  revalidatePath("/admin/access");
  revalidatePath("/hub");
  revalidatePath("/", "layout");
}

function subjectMatch(subjectType: SubjectType, subjectId: string | null) {
  if (subjectType === "everyone" || subjectId === null) {
    return and(
      eq(moduleAccessGrants.subjectType, "everyone"),
      isNull(moduleAccessGrants.subjectId),
    );
  }
  return and(
    eq(moduleAccessGrants.subjectType, subjectType),
    eq(moduleAccessGrants.subjectId, subjectId),
  );
}

/**
 * Super-admins are unrestrictable by design (lib/access/modules.ts short-circuits
 * on them), so silently accepting a grant against one would show a "Denied" chip
 * that the runtime ignores. Reject it instead and say why.
 */
async function rejectsSuperAdminTarget(
  subjectType: SubjectType,
  subjectIds: string[],
): Promise<string | null> {
  if (subjectType !== "employee" || subjectIds.length === 0) return null;
  const rows = await db
    .select({ name: employees.name, email: employees.email })
    .from(employees)
    .where(inArray(employees.id, subjectIds));
  const blocked = rows.filter((r) => isSuperAdmin(r.email));
  if (blocked.length === 0) return null;
  return `${blocked.map((b) => b.name).join(", ")} ${
    blocked.length > 1 ? "are super-admins" : "is a super-admin"
  } and always has every module.`;
}

/**
 * Write one cell. `inherit` deletes the row so the next-broadest level takes
 * over; allow/deny replace it. Delete-then-insert rather than an upsert because
 * the uniques are partial indexes (NULL subject_id for the org-wide rows).
 */
async function writeGrant(
  actorId: string,
  moduleId: string,
  subjectType: SubjectType,
  subjectId: string | null,
  level: AccessLevel,
): Promise<void> {
  const allowed = levelToAllowed(level);
  await db.transaction(async (tx) => {
    await tx
      .delete(moduleAccessGrants)
      .where(and(eq(moduleAccessGrants.moduleId, moduleId), subjectMatch(subjectType, subjectId)));
    if (allowed !== null) {
      await tx.insert(moduleAccessGrants).values({
        moduleId,
        subjectType,
        subjectId,
        allowed,
        updatedBy: actorId,
        updatedAt: new Date(),
      });
    }
  });
}

async function audit(
  actorId: string,
  targetId: string | null,
  toValue: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(settingsEvents).values({
      scope: "module_access",
      targetId,
      actorId,
      eventType: "updated",
      toValue,
    });
  } catch (err) {
    console.error("[module-access] audit write failed", err);
  }
}

export async function setModuleAccess(
  input: SetModuleAccessInput,
): Promise<ActionResult> {
  const me = await requireAdmin();

  const parsed = SetModuleAccessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { moduleId, subjectType, subjectId, level } = parsed.data;

  const blocked = await rejectsSuperAdminTarget(subjectType, subjectId ? [subjectId] : []);
  if (blocked) return { ok: false, error: blocked };

  try {
    await writeGrant(me.id, moduleId, subjectType, subjectId, level);
  } catch (err: unknown) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  await audit(me.id, subjectId, { moduleId, subjectType, subjectId, level });
  revalidateAccess();
  return { ok: true };
}

export async function bulkSetModuleAccess(
  input: BulkSetModuleAccessInput,
): Promise<ActionResult<{ count: number }>> {
  const me = await requireAdmin();

  const parsed = BulkSetModuleAccessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { moduleId, subjectType, subjectIds, level } = parsed.data;

  const blocked = await rejectsSuperAdminTarget(subjectType, subjectIds);
  if (blocked) return { ok: false, error: blocked };

  try {
    for (const subjectId of subjectIds) {
      await writeGrant(me.id, moduleId, subjectType, subjectId, level);
    }
  } catch (err: unknown) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  await audit(me.id, null, { moduleId, subjectType, subjectIds, level, bulk: true });
  revalidateAccess();
  return { ok: true, count: subjectIds.length };
}

/** Drop every explicit grant for one row so it inherits again. */
export async function clearSubjectAccess(
  input: ClearSubjectAccessInput,
): Promise<ActionResult> {
  const me = await requireAdmin();

  const parsed = ClearSubjectAccessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { subjectType, subjectId } = parsed.data;

  try {
    await db
      .delete(moduleAccessGrants)
      .where(
        and(
          eq(moduleAccessGrants.subjectType, subjectType),
          eq(moduleAccessGrants.subjectId, subjectId),
        ),
      );
  } catch (err: unknown) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  await audit(me.id, subjectId, { subjectType, subjectId, level: "inherit", cleared: true });
  revalidateAccess();
  return { ok: true };
}
