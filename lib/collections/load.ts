import "server-only";
import { listAllMasterCompanies } from "@/lib/queries/collection-master";
import { loadLatestBalances } from "@/lib/queries/collection-balances";
import { activeTransactionSource } from "./transactions";
import { openClosureCompanyIds } from "@/lib/queries/collection-closures";
import { inScope, scopeMessage, type CollectionScope } from "./scope";
import {
  type CollectionTransaction,
  MASTER_EMPTY_MESSAGE,
  SCOPE_EMPTY_MESSAGE,
  MASTER_NOT_READY_MESSAGE,
  type CollectionParty,
  type CollectionSource,
} from "./source";

/**
 * The Collection screens' one loader. Companies come from the Collection
 * Master, narrowed to the caller's scope (lib/collections/scope.ts: a
 * super-admin sees every company, a linked Sales Coordinator only their own,
 * anyone else none) before anything else is read for them; Debit / Credit from
 * the latest uploaded balance snapshot; transactions
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

export async function loadCollectionParties(scope: CollectionScope): Promise<CollectionSource> {
  const source = activeTransactionSource();
  const transactions = { key: source.key, label: source.label, approved: source.approved };
  const master = await listAllMasterCompanies();
  if (!master.storageReady) {
    return { connected: false, parties: [], message: MASTER_NOT_READY_MESSAGE, masterReady: false, transactions, scope };
  }
  // The scope is applied HERE, before balances, transactions or anything else
  // is read for a company: a company outside it never reaches the caller, so no
  // screen, popup, filter, search or action built on this loader can show it.
  const rows = master.rows.filter((r) => inScope(scope, r.coordinatorLabel));

  const byMaster = await loadTransactionsByMaster(rows.map((r) => r.id));
  // Debit / Credit come from the LATEST uploaded balance snapshot only; a company
  // missing from it stays blank. Outstanding is never worked out from them.
  // Whether a company is in Collection Logs is its OPEN closure episode, written
  // only by a confirmed upload that gave it ₹0 Debit and ₹0 Credit (and closed
  // again by one that gave it a balance). It is never inferred here.
  const [balances, logged] = await Promise.all([loadLatestBalances(), openClosureCompanyIds()]);

  const parties: CollectionParty[] = rows.map((r) => {
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
      // In Collection Logs (an open closure): the Tracker list leaves it out.
      inLogs: logged.ids.has(r.id),
    };
  });
  // Every company in scope is returned, logged or not, so actions that check a
  // company is in the caller's scope still find it. Only the Tracker's list
  // leaves the logged ones out.
  return {
    connected: parties.length > 0,
    parties,
    message: parties.length > 0 ? undefined : (scopeMessage(scope) ?? (master.rows.length === 0 ? MASTER_EMPTY_MESSAGE : SCOPE_EMPTY_MESSAGE)),
    masterReady: true,
    transactions,
    balances: { status: balances.status, errorCode: balances.errorCode },
    scope,
  };
}
