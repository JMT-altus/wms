import "server-only";
import { listAllMasterCompanies } from "@/lib/queries/collection-master";
import { activeTransactionSource } from "./transactions";
import {
  MASTER_EMPTY_MESSAGE,
  MASTER_NOT_READY_MESSAGE,
  type CollectionParty,
  type CollectionSource,
} from "./source";

/**
 * The Collection screens' one loader. Companies come from the Collection
 * Master; transactions from the active transaction source (none approved yet,
 * so every party's `transactions` is empty and the figures stay null). Both
 * the Tracker and the Dashboard read through here, so they always agree.
 */
export async function loadCollectionParties(): Promise<CollectionSource> {
  const source = activeTransactionSource();
  const transactions = { key: source.key, label: source.label, approved: source.approved };
  const master = await listAllMasterCompanies();
  if (!master.storageReady) {
    return { connected: false, parties: [], message: MASTER_NOT_READY_MESSAGE, masterReady: false, transactions };
  }

  const records = source.approved ? await source.list(master.rows.map((r) => r.id)) : [];
  const byMaster = new Map<string, typeof records>();
  for (const t of records) byMaster.set(t.collectionMasterId, [...(byMaster.get(t.collectionMasterId) ?? []), t]);

  const parties: CollectionParty[] = master.rows.map((r) => ({
    partyName: r.companyName,
    // Figures belong to the transaction source; with none approved they stay unknown.
    debit: null,
    credit: null,
    outstanding: null,
    collectionPerson: null,
    masterId: r.id,
    coordinatorLabel: r.coordinatorLabel,
    paymentTerms: r.paymentTerms,
    clientMasterLinked: r.customerMasterId !== null,
    transactions: byMaster.get(r.id) ?? [],
  }));
  return {
    connected: parties.length > 0,
    parties,
    message: parties.length === 0 ? MASTER_EMPTY_MESSAGE : undefined,
    masterReady: true,
    transactions,
  };
}
