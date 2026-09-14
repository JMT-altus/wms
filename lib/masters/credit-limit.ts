import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerCreditLimitEvents, customerMasters, employees } from "@/db/schema";

/**
 * The Credit Limit history — one row per change to a client's limit.
 *
 * Its own module rather than living beside either action that writes it: the
 * Client Master (forms) and the Customer Master (masters) both change
 * `customer_masters.credit_limit`, and each of those action files already
 * imports from the other. A third home keeps them from importing each other
 * in a circle, and makes it obvious that BOTH have to log.
 */

/**
 * Log a credit-limit change, if the figure actually moved.
 *
 * Called by every path that writes the column, so the Credit Limit section is
 * a complete record rather than a record of whichever screen remembered. A
 * write that leaves the number where it was logs nothing — the section lists
 * CHANGES, and "saved without changing it" is not one.
 *
 * Never throws. An audit row failing to write must not fail the edit that
 * succeeded: a missing line in the history is a far smaller problem than a
 * credit limit that appears not to have saved.
 */
export async function recordCreditLimitChange(
  customerId: string,
  before: string | null,
  after: number | null,
  changedById: string | null,
): Promise<void> {
  // Compared as numbers, so "100000" and "100000.00" are the same limit and
  // don't log a change that didn't happen.
  const prev = before === null || before.trim() === "" ? null : Number(before);
  if (prev === after) return;
  if (prev !== null && after !== null && prev === after) return;

  try {
    await db.insert(customerCreditLimitEvents).values({
      customerId,
      previousLimit: prev === null ? null : String(prev),
      newLimit: after === null ? null : String(after),
      changedById,
    });
  } catch {
    /* best-effort — see the note above */
  }
}

export interface CreditLimitChange {
  id: string;
  customerId: string;
  client: string;
  code: string | null;
  /** Null when the limit was being set for the first time. */
  previousLimit: string | null;
  /** Null when the limit was cleared. */
  newLimit: string | null;
  /** Signed difference, with a missing side read as 0. */
  delta: number;
  direction: "increased" | "decreased" | "set" | "cleared";
  changedByName: string | null;
  changedAt: string;
}

/**
 * Recent credit-limit changes across every client, newest first.
 *
 * Capped rather than paged: this is a "what has moved lately" panel under the
 * Client Master, not a ledger to scroll through. The cap is generous enough
 * that a busy month still fits.
 */
export async function listCreditLimitChanges(limit = 200): Promise<CreditLimitChange[]> {
  const rows = await db
    .select({
      id: customerCreditLimitEvents.id,
      customerId: customerCreditLimitEvents.customerId,
      client: customerMasters.name,
      code: customerMasters.code,
      previousLimit: customerCreditLimitEvents.previousLimit,
      newLimit: customerCreditLimitEvents.newLimit,
      changedByName: employees.name,
      changedAt: customerCreditLimitEvents.createdAt,
    })
    .from(customerCreditLimitEvents)
    .innerJoin(customerMasters, eq(customerMasters.id, customerCreditLimitEvents.customerId))
    .leftJoin(employees, eq(employees.id, customerCreditLimitEvents.changedById))
    // Drafts and recycled records are not in the Client Master, so their
    // history does not belong in a panel that sits under it.
    .where(and(eq(customerMasters.kycStage, "complete")))
    .orderBy(desc(customerCreditLimitEvents.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const prev = r.previousLimit === null ? null : Number(r.previousLimit);
    const next = r.newLimit === null ? null : Number(r.newLimit);
    const delta = (next ?? 0) - (prev ?? 0);
    return {
      id: r.id,
      customerId: r.customerId,
      client: r.client,
      code: r.code,
      previousLimit: r.previousLimit,
      newLimit: r.newLimit,
      delta,
      // "Set" and "cleared" are their own answers: a first limit is not an
      // increase from zero, and removing one is not a decrease to zero.
      direction:
        prev === null ? "set" : next === null ? "cleared" : delta >= 0 ? "increased" : "decreased",
      changedByName: r.changedByName,
      changedAt: r.changedAt.toISOString(),
    };
  });
}

/** How many limits moved in each direction, for the panel's two tiles. */
export async function creditLimitTotals(): Promise<{ up: number; down: number }> {
  const [row] = await db
    .select({
      up: sql<number>`count(*) filter (where
        ${customerCreditLimitEvents.previousLimit} is not null
        and ${customerCreditLimitEvents.newLimit} is not null
        and ${customerCreditLimitEvents.newLimit} > ${customerCreditLimitEvents.previousLimit})::int`,
      down: sql<number>`count(*) filter (where
        ${customerCreditLimitEvents.previousLimit} is not null
        and ${customerCreditLimitEvents.newLimit} is not null
        and ${customerCreditLimitEvents.newLimit} < ${customerCreditLimitEvents.previousLimit})::int`,
    })
    .from(customerCreditLimitEvents);
  return { up: row?.up ?? 0, down: row?.down ?? 0 };
}
