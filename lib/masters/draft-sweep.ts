import "server-only";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters } from "@/db/schema";
import { CHECKOUT_EXPIRY_MINUTES, DRAFT_EXPIRY_DAYS } from "./kyc-completeness";

/**
 * Move stale Client KYC drafts into the Recycle Bin.
 *
 * A draft that nobody has touched for DRAFT_EXPIRY_DAYS is not work in
 * progress, it is abandoned. Recycling it keeps the Draft section a real
 * to-do list rather than a graveyard — and the Recycle Bin keeps the record
 * itself, so nothing is destroyed and a mistake is one restore away.
 *
 * The clock is `draft_since`, not `updated_at`: opening a draft and actually
 * working on it resets the clock (the save path rewrites `draft_since`),
 * while an unrelated background write to the row does not buy it another
 * week it has not earned.
 *
 * Two ways this runs, the same shape as the task auto-archive:
 *  - the daily cron at /api/cron/kyc-draft-sweep, which is the real schedule;
 *  - `sweepExpiredDraftsQuietly`, called when the Draft or Recycle Bin page
 *    is read, so the lists are honest the moment someone looks at them
 *    instead of only after the next cron run.
 *
 * Idempotent: rows already recycled are excluded, so re-running changes
 * nothing.
 */
export interface DraftSweepResult {
  recycled: number;
  /** Checked-out drafts handed back to the Draft list. */
  released: number;
}

export async function sweepExpiredDrafts(): Promise<DraftSweepResult> {
  const released = await releaseStaleCheckouts();

  const rows = await db
    .update(customerMasters)
    .set({
      kycStage: "recycled",
      recycledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customerMasters.kycStage, "draft"),
        isNotNull(customerMasters.draftSince),
        lt(
          customerMasters.draftSince,
          sql`now() - ${`${DRAFT_EXPIRY_DAYS} days`}::interval`,
        ),
      ),
    )
    .returning({ id: customerMasters.id });

  return { recycled: rows.length, released };
}

/**
 * Hand abandoned checkouts back to the Draft list.
 *
 * Restore hides a draft from the list while it is open in the form, which is
 * what stops the same record appearing in two places. The cost is that a
 * checkout nobody finishes — the tab closed, the laptop shut — would be
 * hidden with no way back. This is the way back, and it is why the checkout
 * is stamped with a time rather than a flag.
 *
 * Runs before the expiry sweep above, deliberately: a released draft becomes
 * eligible for the 7-day rule again in the same pass, so a checkout cannot be
 * used to park a record outside both lists indefinitely.
 */
async function releaseStaleCheckouts(): Promise<number> {
  const rows = await db
    .update(customerMasters)
    .set({ editingSince: null, updatedAt: new Date() })
    .where(
      and(
        eq(customerMasters.kycStage, "draft"),
        isNotNull(customerMasters.editingSince),
        lt(
          customerMasters.editingSince,
          sql`now() - ${`${CHECKOUT_EXPIRY_MINUTES} minutes`}::interval`,
        ),
      ),
    )
    .returning({ id: customerMasters.id });
  return rows.length;
}

/**
 * The same sweep, for call sites that must not fail because of it.
 *
 * Rendering the Draft list is a read; if the sweep behind it errors, the user
 * should still see their drafts. Worst case the list is one cron run stale.
 */
export async function sweepExpiredDraftsQuietly(): Promise<void> {
  try {
    await sweepExpiredDrafts();
  } catch (err) {
    console.error("[sweepExpiredDrafts] failed", err);
  }
}
