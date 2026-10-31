import type { CollectionTransaction } from "./source";

/**
 * Bill-wise balances from the newest completed Tally outstanding snapshot, as a
 * Collection transaction source. Amounts, due dates and references pass through
 * as Tally has them. The query is imported on use so that this file stays safe
 * for the client code that shares ./transactions.
 */
export const TALLY_BILLS_SOURCE_KEY = "tally-bills";

export async function listTallyBills(collectionMasterIds: string[]): Promise<CollectionTransaction[]> {
  const { latestReceivableLines } = await import("@/lib/queries/tally-import");
  const lines = await latestReceivableLines(collectionMasterIds);
  return lines.map((l) => ({
    id: l.id,
    collectionMasterId: l.collectionCompanyId!,
    reference: l.billRef,
    amount: l.originalPaise === null ? null : l.originalPaise / 100,
    outstanding: l.pendingPaise / 100,
    dueDate: l.dueDate,
    status: null,
  }));
}
