import type { CollectionTransaction, TransactionSourceInfo } from "./source";
import { TALLY_BILLS_SOURCE_KEY, listTallyBills } from "./tally-source";

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

/** Tally's bill-wise outstanding snapshot. Implemented, and off until someone approves it. */
export const TALLY_BILLS_SOURCE: CollectionTransactionSource = {
  key: TALLY_BILLS_SOURCE_KEY,
  label: "Tally outstanding snapshot",
  approved: true,
  list: listTallyBills,
};

/**
 * Approving a source is a deliberate decision: importing a file doesn't do it.
 * Set COLLECTION_TRANSACTION_SOURCE=tally-bills in the environment to turn it on.
 */
export function activeTransactionSource(): CollectionTransactionSource {
  return process.env.COLLECTION_TRANSACTION_SOURCE === TALLY_BILLS_SOURCE_KEY ? TALLY_BILLS_SOURCE : NO_TRANSACTION_SOURCE;
}
