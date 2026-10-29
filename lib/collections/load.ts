import "server-only";
import { listAllMasterCompanies } from "@/lib/queries/collection-master";
import { loadLatestBalances } from "@/lib/queries/collection-balances";
import { activeTransactionSource } from "./transactions";
import {
  type CollectionTransaction,
  MASTER_EMPTY_MESSAGE,
  MASTER_NOT_READY_MESSAGE,
  type CollectionParty,
  type CollectionSource,
} from "./source";

/**
 * The Collection screens' one loader. Companies come from the Collection
 * Master; Debit / Credit from the latest uploaded balance snapshot; transactions
 * from the active transaction source (none approved yet, so every party's
 * `transactions` is empty and `outstanding` stays null). Both
 * the Tracker and the Dashboard read through here, so they always agree.
 */
/**
 * Records from the active transaction source, grouped by Collection Master id —
 * the due dates, statuses and balances the overdue colouring reads. Empty while
 * no source is approved (nothing is invented). Shared by the Tracker loader and
 * the commitments page so both colour a company from the same records.
 */
export async function loadTransactionsByMaster(masterIds: string[]): Promise<Map<string, CollectionTransaction[]>> {
  const source = activeTransactionSource();
  const records = source.approved && masterIds.length > 0 ? await source.list(masterIds) : [];
  const byMaster = new Map<string, CollectionTransaction[]>();
  for (const t of records) byMaster.set(t.collectionMasterId, [...(byMaster.get(t.collectionMasterId) ?? []), t]);
  return byMaster;
}

export async function loadCollectionParties(): Promise<CollectionSource> {
  const source = activeTransactionSource();
  const transactions = { key: source.key, label: source.label, approved: source.approved };
  const master = await listAllMasterCompanies();
  if (!master.storageReady) {
    return { connected: false, parties: [], message: MASTER_NOT_READY_MESSAGE, masterReady: false, transactions };
  }

  const byMaster = await loadTransactionsByMaster(master.rows.map((r) => r.id));
  // Debit / Credit come from the LATEST uploaded balance snapshot only; a company
  // missing from it stays blank. Outstanding is never worked out from them.
  const balances = await loadLatestBalances();

  const parties: CollectionParty[] = master.rows.map((r) => ({
    partyName: r.companyName,
    debit: balances.byCompany.get(r.id)?.debit ?? null,
    credit: balances.byCompany.get(r.id)?.credit ?? null,
    outstanding: null,
    // The collection person IS the Sales Coordinator the Collection Master holds
    // for the company (imported from the master file); null = unassigned.
    collectionPerson: r.coordinatorLabel,
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
    balances: { status: balances.status, errorCode: balances.errorCode },
  };
}
