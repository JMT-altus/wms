"use server";

import { revalidatePath } from "next/cache";
import { requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { loadCollectionParties } from "@/lib/collections/load";
import { collectionScopeFor } from "@/lib/collections/scope-server";
import { MARKS_NOT_READY, MarksInput } from "@/lib/collections/marks";
import { isMissingTable } from "@/lib/queries/collection-master";
import { clearCompanyMark, setCompanyMark } from "@/lib/queries/collection-marks";

export type MarksResult = { ok: true; updated: number; skipped: number } | { ok: false; error: string };

/**
 * MARK AS PRIORITY / COLLECTION DONE for one or several companies, or the
 * reverse of either (`active: false`). One action for the row menu and the
 * bulk bar, so both follow the same rules:
 *
 *   - the capability is the mark's own — collection.priority.set for priority,
 *     collection.done.set (sensitive, explicit grant) for done — checked from
 *     the signed session before anything is read or written;
 *   - only companies inside the caller's scope (lib/collections/scope.ts) are
 *     touched; any other id is counted as skipped, never written;
 *   - a company already in the requested state is skipped (the database's
 *     one-active-mark rule), so a double click or two people at once can't
 *     create two episodes;
 *   - every change is a row with who and when (lib/queries/collection-marks.ts).
 *
 * Nothing else changes: no comment, commitment, confirmation, escalation,
 * closure or balance, and no company enters or leaves Collection Logs.
 */
export async function setCompanyMarks(raw: unknown): Promise<MarksResult> {
  const p = MarksInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Choose at least one company." };
  const { companyIds, kind, active } = p.data;

  const proof = await requireCollectionCapability(kind === "priority" ? "collection.priority.set" : "collection.done.set");
  const limited = rateLimitOrError(proof.employeeId, "write");
  if (limited) return limited;

  // The caller's scope decides which companies may be marked — a Sales Coordinator their own, a super-admin any.
  const scoped = await loadCollectionParties(await collectionScopeFor());
  const allowed = new Set(scoped.parties.map((c) => c.masterId).filter((id): id is string => !!id));

  let updated = 0;
  let skipped = 0;
  try {
    for (const id of new Set(companyIds)) {
      if (!allowed.has(id)) {
        skipped += 1;
        continue;
      }
      const outcome = active ? await setCompanyMark(proof, id, kind) : await clearCompanyMark(proof, id, kind);
      if (outcome === "set" || outcome === "cleared") updated += 1;
      else skipped += 1;
    }
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: MARKS_NOT_READY };
    console.error("[collection-marks] could not save the mark");
    return { ok: false, error: "The change could not be saved. Please try again." };
  }
  if (updated > 0) revalidatePath("/collection/tracker");
  return { ok: true, updated, skipped };
}
