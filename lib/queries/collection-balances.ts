import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionBalanceLines, collectionBalanceSnapshots } from "@/db/schema";
import { isMissingTable } from "@/lib/queries/collection-master";

/**
 * Collection balances (migration 0117): the Debit / Credit the Tracker shows,
 * from the LATEST applied snapshot only. A company with no line in that
 * snapshot has no balance — figures from older snapshots are never carried
 * forward, and snapshots are never added together.
 */

type Reader = Pick<typeof db, "select">;

export interface BalanceSnapshotInfo {
  id: string;
  fileName: string | null;
  sheetName: string | null;
  fileHash: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  uploadedAt: Date;
  lineCount: number;
}

/**
 * How the balance read went.
 *   ok            read fine (there may simply be no snapshot yet).
 *   not-installed the tables don't exist (migration 0117 not applied): expected, Debit / Credit stay blank.
 *   error         the tables exist or are expected to, but this connection can't use them
 *                 (no privilege, or a column the code expects is missing): a real
 *                 permission / configuration problem. The Tracker keeps working with
 *                 blank Debit / Credit and SAYS SO; it is also logged.
 * Anything else — a dropped connection, a timeout, a bug — is NOT turned into a
 * status: it throws, exactly as the Collection Master read next to it would.
 */
export type BalanceReadStatus = "ok" | "not-installed" | "error";

/** SQLSTATEs that mean "this database isn't set up for balances for this role", not "the database is down". */
const SETUP_ERROR_CODES = new Set(["42501" /* insufficient_privilege */, "42703" /* undefined_column */]);

const sqlState = (err: unknown): string | undefined => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.code ?? e?.cause?.code;
  return typeof c === "string" ? c : undefined;
};

export interface LatestBalances {
  /** False while migration 0117 isn't applied. */
  storageReady: boolean;
  status: BalanceReadStatus;
  /** The SQLSTATE behind status "error", for the notice and the log. */
  errorCode?: string;
  snapshot: BalanceSnapshotInfo | null;
  /** Rupees by Collection Master company id; null = blank in the file. */
  byCompany: Map<string, { debit: number | null; credit: number | null }>;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** The newest snapshot (by upload time, id breaking a tie) with its line count. */
export async function latestBalanceSnapshot(q: Reader = db): Promise<BalanceSnapshotInfo | null> {
  const [s] = await q
    .select({
      id: collectionBalanceSnapshots.id,
      fileName: collectionBalanceSnapshots.fileName,
      sheetName: collectionBalanceSnapshots.sheetName,
      fileHash: collectionBalanceSnapshots.fileHash,
      periodFrom: collectionBalanceSnapshots.periodFrom,
      periodTo: collectionBalanceSnapshots.periodTo,
      uploadedAt: collectionBalanceSnapshots.uploadedAt,
      totals: collectionBalanceSnapshots.totals,
    })
    .from(collectionBalanceSnapshots)
    .orderBy(desc(collectionBalanceSnapshots.uploadedAt), desc(collectionBalanceSnapshots.id))
    .limit(1);
  if (!s) return null;
  const matched = (s.totals as { matched?: unknown } | null)?.matched;
  return { ...s, lineCount: typeof matched === "number" ? matched : 0 };
}

/** The balances the Tracker shows. Empty while the tables don't exist or can't be used (see BalanceReadStatus); other errors throw. */
export async function loadLatestBalances(): Promise<LatestBalances> {
  try {
    const snapshot = await latestBalanceSnapshot();
    const byCompany: LatestBalances["byCompany"] = new Map();
    if (!snapshot) return { storageReady: true, status: "ok", snapshot: null, byCompany };
    const lines = await db
      .select({ companyId: collectionBalanceLines.companyId, debit: collectionBalanceLines.debit, credit: collectionBalanceLines.credit })
      .from(collectionBalanceLines)
      .where(eq(collectionBalanceLines.snapshotId, snapshot.id));
    for (const l of lines) byCompany.set(l.companyId, { debit: num(l.debit), credit: num(l.credit) });
    return { storageReady: true, status: "ok", snapshot, byCompany };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, status: "not-installed", snapshot: null, byCompany: new Map() };
    const code = sqlState(err);
    if (code && SETUP_ERROR_CODES.has(code)) {
      console.error(`[collection-balances] balances unavailable (SQLSTATE ${code}); showing blank Debit / Credit`, err);
      return { storageReady: false, status: "error", errorCode: code, snapshot: null, byCompany: new Map() };
    }
    throw err;
  }
}

/** Company ids that have a line in the given snapshot (for "who would go blank"). */
export async function companyIdsInSnapshot(q: Reader, snapshotId: string): Promise<Set<string>> {
  const rows = await q.select({ companyId: collectionBalanceLines.companyId }).from(collectionBalanceLines).where(eq(collectionBalanceLines.snapshotId, snapshotId));
  return new Set(rows.map((r) => r.companyId));
}
