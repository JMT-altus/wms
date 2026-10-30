import "server-only";
import { listAllMasterCompanies } from "@/lib/queries/collection-master";
import { loadLatestBalances } from "@/lib/queries/collection-balances";
import { activeTransactionSource } from "./transactions";
import { isZeroBalanceLine, splitZeroBalance } from "./balances/visibility";
import {
  ALL_ZERO_BALANCE_MESSAGE,
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

export interface LoadCollectionPartiesOptions {
  /**
   * Leave out companies whose Debit and Credit are both zero in the active
   * (latest confirmed) balance snapshot — the Tracker's default list. Every
   * party still carries `zeroBalance`; `hiddenZeroBalance` counts the ones left
   * out. Off by default, so every other reader (Dashboard, the follow-up and
   * review actions, the commitments page) still sees every company.
   */
  hideZeroBalance?: boolean;
}

export async function loadCollectionParties(options: LoadCollectionPartiesOptions = {}): Promise<CollectionSource> {
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

  const all: CollectionParty[] = master.rows.map((r) => {
    const line = balances.byCompany.get(r.id);
    return {
      partyName: r.companyName,
      debit: line?.debit ?? null,
      credit: line?.credit ?? null,
      outstanding: null,
      // The collection person IS the Sales Coordinator the Collection Master holds
      // for the company (imported from the master file); null = unassigned.
      collectionPerson: r.coordinatorLabel,
      masterId: r.id,
      coordinatorLabel: r.coordinatorLabel,
      paymentTerms: r.paymentTerms,
      clientMasterLinked: r.customerMasterId !== null,
      transactions: byMaster.get(r.id) ?? [],
      // Only a line in the active snapshot can say "zero"; no line (not in the
      // file, no upload yet, balances unreadable) never hides a company.
      zeroBalance: isZeroBalanceLine(line),
    };
  });
  // The hidden companies are only left out of this list: nothing about them is
  // written, and the next confirmed upload decides afresh.
  const { visible, hidden } = options.hideZeroBalance ? splitZeroBalance(all) : { visible: all, hidden: [] };
  const parties = visible;
  const message = parties.length > 0 ? undefined : all.length === 0 ? MASTER_EMPTY_MESSAGE : ALL_ZERO_BALANCE_MESSAGE;
  return {
    connected: parties.length > 0,
    parties,
    message,
    masterReady: true,
    transactions,
    balances: { status: balances.status, errorCode: balances.errorCode },
    ...(options.hideZeroBalance ? { hiddenZeroBalance: hidden.length } : {}),
  };
}
