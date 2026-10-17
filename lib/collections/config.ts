/**
 * Collection business rules, in one place.
 *
 * Every rule the Collection screens apply lives here so it can be changed
 * without touching the screens or the calculations: the business date's
 * timezone, the overdue thresholds, which payment statuses count as settled,
 * and which coordinator cells mean "nobody assigned". Pure data, safe to import
 * from server and client code alike.
 */

export interface CollectionRules {
  /** The business calendar every "today" and every due date is read in. */
  timeZone: string;
  overdue: {
    /** Overdue by at least this many calendar days → warning (yellow). */
    warningFromDays: number;
    /** Overdue by at least this many calendar days → critical (red). */
    criticalFromDays: number;
  };
  /**
   * Payment statuses that mean nothing more is owed (compared ignoring case
   * and surrounding spaces). A record whose outstanding balance is zero or less
   * is treated as settled too, whatever its status says.
   */
  settledStatuses: readonly string[];
  /**
   * Coordinator cells that mean "unassigned" (compared ignoring case and
   * surrounding spaces; an empty cell always means unassigned).
   */
  unassignedCoordinatorValues: readonly string[];
}

export const COLLECTION_RULES: CollectionRules = {
  timeZone: "Asia/Kolkata",
  overdue: { warningFromDays: 2, criticalFromDays: 3 },
  settledStatuses: ["paid", "settled"],
  unassignedCoordinatorValues: ["xxx", "-"],
};
