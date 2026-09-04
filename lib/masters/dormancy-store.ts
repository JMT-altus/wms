import "server-only";

/**
 * Parking a customer as dormant, and bringing it back — the write.
 *
 * One writer, called from two modules. Client KYC and Masters guard
 * differently — Client KYC is admin-only, Masters is gated on the module
 * grant — so each keeps its own server action, but both funnel here rather
 * than growing a second UPDATE that could drift on what "dormant" sets.
 *
 * Split from `dormancy.ts` because that file holds the rule the two client
 * components read, and this one imports the database: a single module would
 * pull the postgres driver into the browser bundle the moment a table
 * imported the Status filter.
 *
 * No revalidation here — the paths worth refreshing differ per module, and a
 * pure DB function is what lets this be called from either one.
 */

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters } from "@/db/schema";

/** The most ids one call will act on, matching the bulk-import ceiling. */
const MAX_IDS = 500;

export type DormancyResult = { ok: true; count: number } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set or clear `dormant_at` on a set of customers.
 *
 * `dormant` true stamps now, false clears it. One UPDATE for the whole set:
 * parking twelve customers is one action to the person doing it, and a
 * half-applied one would leave a selection they cannot reason about.
 *
 * Returns the number of rows it actually touched, not the number of ids it
 * was handed — an id that no longer exists should not be reported as parked.
 */
export async function setCustomerDormancy(
  ids: unknown,
  dormant: boolean,
): Promise<DormancyResult> {
  if (!Array.isArray(ids)) return { ok: false, error: "Nothing selected." };

  const clean = [
    ...new Set(ids.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))),
  ];
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  if (clean.length > MAX_IDS) {
    return {
      ok: false,
      error: `That is ${clean.length} customers — do up to ${MAX_IDS} at a time.`,
    };
  }

  try {
    const touched = await db
      .update(customerMasters)
      .set({ dormantAt: dormant ? new Date() : null, updatedAt: new Date() })
      .where(inArray(customerMasters.id, clean))
      .returning({ id: customerMasters.id });
    return { ok: true, count: touched.length };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: `Could not save: ${e?.message ?? String(err)}` };
  }
}
