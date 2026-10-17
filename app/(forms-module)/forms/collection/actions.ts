"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { collectionFollowups } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { loadCollectionParties } from "@/lib/collections/load";
import { partyKey } from "@/lib/collections/derive";
import { FollowUpInput, followUpDateError } from "@/lib/collections/validate";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Save one follow-up for a party: a next follow-up date, a note, or both.
 *
 * Append-only — each save is a new row with its author and time, so earlier
 * notes and dates are never overwritten. The Forms module is admin-only, and the
 * check is repeated here because a page guard does not protect a server action.
 * The party must be one the accounting source actually lists, so no free-typed
 * names get stored; with no source connected, nothing can be saved.
 */
export async function saveFollowUp(input: unknown): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = FollowUpInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { partyName, nextFollowupDate, note } = parsed.data;

  const dateError = followUpDateError(nextFollowupDate, localDateString("Asia/Kolkata"));
  if (dateError) return { ok: false, error: dateError };

  const source = await loadCollectionParties();
  const party = source.parties.find((p) => partyKey(p.partyName) === partyKey(partyName));
  if (!party) {
    return { ok: false, error: "That party isn't in the collection data, so nothing was saved." };
  }

  try {
    await db.insert(collectionFollowups).values({
      partyName: party.partyName,
      nextFollowupDate: nextFollowupDate ?? null,
      note: note && note.length > 0 ? note : null,
      createdById: me.id,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string; cause?: { code?: string } } | null);
    if (code?.code === "42P01" || code?.cause?.code === "42P01") {
      return { ok: false, error: "Follow-up storage isn't set up yet (migration 0110 is pending), so nothing was saved." };
    }
    return { ok: false, error: `DB: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath("/forms/collection/tracker");
  revalidatePath("/forms/collection/dashboard");
  return { ok: true };
}
