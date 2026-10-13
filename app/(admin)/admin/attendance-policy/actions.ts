"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { attendancePolicyChanges } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { listPolicyChanges } from "@/lib/queries/attendance-policy";
import { earliestEffectiveDate, resolvePolicy, validatePolicyValue } from "@/lib/attendance/policy";

type ActionResult = { ok: true } | { ok: false; error: string };

const PATH = "/admin/attendance-policy";

const Input = z
  .object({
    key: z.string().min(1).max(80),
    value: z.unknown(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Effective date must be YYYY-MM-DD"),
    reason: z.string().trim().min(1, "A reason is required.").max(500),
  })
  .strict();

/**
 * Change one attendance-policy setting (admin only, enforced here).
 *
 * Append-only: this records a new row with the previous value, the actor, the
 * reason and the effective date, and never edits or deletes an earlier row. It
 * cannot take effect before the first day of the current month, so a closed
 * month is not silently re-priced; changing history would be a separate,
 * explicit operation.
 */
export async function saveAttendancePolicy(input: {
  key: string;
  value: unknown;
  effectiveFrom: string;
  reason: string;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { key, effectiveFrom, reason } = parsed.data;

  const checked = validatePolicyValue(key, parsed.data.value);
  if (!checked.ok) return checked;

  const earliest = earliestEffectiveDate(localDateString("Asia/Kolkata"));
  if (effectiveFrom < earliest) {
    return { ok: false, error: `A change can take effect from ${earliest} at the earliest.` };
  }

  try {
    const previous = resolvePolicy(await listPolicyChanges(), effectiveFrom) as Record<string, unknown>;
    await db.insert(attendancePolicyChanges).values({
      policyKey: key,
      value: checked.value,
      previousValue: previous[key] ?? null,
      effectiveFrom,
      reason,
      changedById: me.id,
    });
  } catch (err: unknown) {
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath(PATH);
  return { ok: true };
}
