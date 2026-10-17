import type { CollectionTransaction, TransactionSourceInfo } from "./source";

/**
 * The collection-transaction source — the ONE place a real source plugs in.
 *
 * No source is approved yet, so the active source is `NO_TRANSACTION_SOURCE`:
 * it says so and returns nothing. To connect an approved source (a Tally
 * bill-wise import, an accounts feed, …), implement `CollectionTransactionSource`
 * for it and return it from `activeTransactionSource()`. The screens read only
 * this interface, so they do not change.
 *
 * Rules any implementation must keep:
 *   - link every record by `collectionMasterId` (never only by a name);
 *   - pass amounts, due dates and statuses through as the source has them —
 *     never derive or invent them;
 *   - due dates as YYYY-MM-DD in the business calendar (COLLECTION_RULES.timeZone).
 */
export interface CollectionTransactionSource extends TransactionSourceInfo {
  list(collectionMasterIds: string[]): Promise<CollectionTransaction[]>;
}

export const NO_TRANSACTION_SOURCE: CollectionTransactionSource = {
  key: "none",
  label: "No approved source",
  approved: false,
  async list() {
    return [];
  },
};

export function activeTransactionSource(): CollectionTransactionSource {
  return NO_TRANSACTION_SOURCE;
}
