/**
 * Dormancy — the rule, shared by every screen that shows customers.
 *
 * A dormant customer is one you have stopped trading with but have not
 * deleted: it drops out of the Client Master, the Customer Master and the
 * three directories, and comes back only when the Status filter is set to
 * Dormant. The fact itself is `customer_masters.dormant_at` (0101) — see the
 * schema comment there for why it is neither `is_active` nor a `kyc_stage`.
 *
 * Deliberately pure and db-free. The Client Master and the Customer Master
 * are client components and both import this; the writer lives next door in
 * `dormancy-store.ts` so that importing the rule cannot drag the database
 * driver into the browser bundle.
 *
 * Both screens read the SAME options and the SAME matcher from here rather
 * than declaring a Status filter each. They are two views of one
 * `customer_masters` row, so a customer parked on one has to be parked on the
 * other, and two hand-written copies of this four-way rule would eventually
 * disagree about what "Active" excludes.
 */

/** The shape either table's row satisfies — nothing else is needed to judge. */
export interface DormancyRow {
  isActive: boolean;
  /** ISO timestamp, or null when the customer is on the register. */
  dormantAt: string | null;
}

/** Parked as dormant — off the working register until reactivated. */
export const isDormant = (row: DormancyRow): boolean => row.dormantAt !== null;

/**
 * The Status filter's options, dormancy folded in.
 *
 * One chip rather than a separate "Dormant" one: Active, Inactive and Dormant
 * are three answers to "what is this customer's standing", and splitting them
 * across two controls would let you ask for Active AND Dormant, which is not
 * a state any customer is in.
 */
export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "current", label: "Not dormant" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "dormant", label: "Dormant" },
];

/**
 * Where the Status chip starts.
 *
 * `current`, not "All" — the requirement is that a dormant customer is not
 * visible in the list, and both tables filter client-side, so excluding them
 * in SQL would leave the Dormant option with nothing to show. A filter that
 * starts somewhere other than All is what expresses "hidden, but reachable".
 */
export const STATUS_FILTER_DEFAULT = "current";

/**
 * Does this row belong in the list at the chosen Status?
 *
 * Active and Inactive exclude dormant on purpose: they describe the working
 * register, and a parked customer's Active flag is not the fact anyone is
 * asking about. Clearing the chip to All ("") is the single way to see
 * everything at once, and it is deliberately not where either screen starts.
 */
export function matchesStatusFilter(row: DormancyRow, value: string): boolean {
  // All. The table skips an unset filter rather than calling this, so this
  // branch is belt and braces — but a matcher that answered "no" to the one
  // value meaning "show me everything" would be a trap for the next caller.
  if (value === "") return true;
  if (value === "dormant") return isDormant(row);
  if (isDormant(row)) return false;
  if (value === "active") return row.isActive;
  if (value === "inactive") return !row.isActive;
  // "current", and anything unrecognised: everything still on the register.
  return true;
}

/** What the Status column and the CSV say, so a search for "dormant" works. */
export function statusLabel(row: DormancyRow): string {
  return isDormant(row) ? "Dormant" : row.isActive ? "Active" : "Inactive";
}

/** "3 customers" / "1 customer", for the toast both modules show. */
export function customerCountLabel(n: number): string {
  return `${n} ${n === 1 ? "customer" : "customers"}`;
}
