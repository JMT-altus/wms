/**
 * Shapes and messages shared by every Collection screen. Pure — safe to import
 * from client components. The loaders that read the database live in
 * `lib/collections/load.ts` (server-only).
 *
 * Two different sources feed the screens, and they are kept apart on purpose:
 *
 *   1. COMPANIES come from the Collection Master (company name, the Sales
 *      Coordinator label exactly as the master file has it, payment terms).
 *      That is reference data — it carries no amounts, invoices or due dates.
 *
 *   2. TRANSACTIONS (amounts, invoices, due dates, payment status) come from a
 *      collection-transaction source. No source has been approved yet, so the
 *      default one (`lib/collections/transactions.ts`) is "not connected" and
 *      returns nothing. Nothing is ever invented in its place, and neither the
 *      incentive engine's invoices nor the Outstanding module is used as a
 *      stand-in. When a source is approved, only that file changes.
 *
 * Two things are still deliberately NOT computed anywhere: `outstanding` (the
 * source supplies it, or it stays null) and `collectionPerson` (the assignment
 * rule is unconfirmed; the master's coordinator label is shown as such).
 */

/** One collection record from an approved transaction source. */
export interface CollectionTransaction {
  id: string;
  /** Always linked by Collection Master id, never only by a display name. */
  collectionMasterId: string;
  /** Invoice / bill reference, as the source gives it. */
  reference: string | null;
  amount: number | null;
  /** Amount still owed, as the source gives it. */
  outstanding: number | null;
  /** YYYY-MM-DD in the business calendar, or null when the source has none. */
  dueDate: string | null;
  /** The source's own payment status word. */
  status: string | null;
}

/** What the screens are told about the transaction source. */
export interface TransactionSourceInfo {
  key: string;
  label: string;
  /** False until a business-approved source is connected. */
  approved: boolean;
}

export interface CollectionParty {
  /** The company's name; follow-ups key on it. */
  partyName: string;
  debit: number | null;
  credit: number | null;
  /** Supplied by an approved source, else null. */
  outstanding: number | null;
  collectionPerson: string | null;
  /** The Collection Master record this party is (absent for legacy callers). */
  masterId?: string;
  /** Sales Coordinator label from the Collection Master; null = unassigned. */
  coordinatorLabel?: string | null;
  /** Payment terms text from the Collection Master; null = not provided. */
  paymentTerms?: string | null;
  /** True when the master record is linked to exactly one Client Master record. */
  clientMasterLinked?: boolean;
  /** Records from the transaction source; empty while no source is approved. */
  transactions?: CollectionTransaction[];
}

export interface CollectionSource {
  /** True when there are companies to list. */
  connected: boolean;
  parties: CollectionParty[];
  /** Why the list is empty, when it is. */
  message?: string;
  /** Collection Master storage exists (its migration has been applied). */
  masterReady?: boolean;
  transactions?: TransactionSourceInfo;
}

export const NOT_CONNECTED_MESSAGE =
  "Collection data will appear here once a data source is connected.";

export const MASTER_NOT_READY_MESSAGE =
  "Collection Master storage isn't set up yet (migration 0112 is pending), so there are no companies to list.";

export const MASTER_EMPTY_MESSAGE =
  "No companies yet. Import the company master file in Collection Master to list them here.";

export const NO_TRANSACTION_SOURCE_MESSAGE =
  "Collection transactions aren't connected: no approved source has been chosen yet, so amounts, invoices, due dates and payment status are not shown. Nothing here is estimated.";
