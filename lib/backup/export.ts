import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Database export for the nightly Google backup. Enumerates every base table in
 * the `public` schema and dumps each to a header row + value rows, so the backup
 * auto-covers new tables without code changes. The Sheets writer turns each
 * `TableDump` into a tab (sharded when it exceeds Google's per-sheet limits).
 *
 * Read-only. Values are stringified for cells; null → "" with a sentinel-free
 * convention (empty cell = NULL on restore). Ordered by primary key / first
 * column for stable, diff-friendly output across nightly runs.
 */
/**
 * Tables NEVER copied into the general backup, whatever the table listing says.
 *
 *   collection_commitments — committed amounts and dates that only the
 *     holders of collection.commitments.view may see (lib/auth/capability.ts). The general
 *     Google Sheets backup is readable by whoever has access to that sheet, so
 *     copying them there would defeat the owner-only rule. If these records
 *     need their own backup, that is a separate, approved destination.
 *   collection_escalations — the escalation reviewers' queue (who
 *     escalated which company, when, and its closing). Kept out of the general
 *     backup with the commitments it accompanies. (Collection Amount
 *     Confirmations stay in: every Tracker user can already see them.)
 *
 * Enforced twice: listBackupTables() leaves them out, and dumpTable() /
 * countRows() refuse them, so no caller can export them by naming them.
 */
export const BACKUP_EXCLUDED_TABLES: readonly string[] = ["collection_commitments", "collection_escalations"];

export const isBackupExcluded = (table: string): boolean => BACKUP_EXCLUDED_TABLES.includes(table.trim().toLowerCase());

function assertBackupable(table: string): void {
  if (isBackupExcluded(table)) throw new Error(`Table "${table}" is excluded from the general backup.`);
}

export interface TableDump {
  table: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
}

/** All base tables in `public`, excluding Drizzle's migration bookkeeping and BACKUP_EXCLUDED_TABLES. */
export async function listBackupTables(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE '\\_\\_drizzle%'
    ORDER BY table_name
  `)) as unknown as Array<{ table_name: string }>;
  return rows.map((r) => r.table_name).filter((t) => !isBackupExcluded(t));
}

/** Cell-safe string for any SQL value. Objects/arrays (json, text[]) → JSON. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Dump one table to headers + stringified rows. `limit`/`offset` page large
 *  tables for sharding; omit for a full dump. */
export async function dumpTable(
  table: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<TableDump> {
  assertBackupable(table);
  // `table` comes only from listBackupTables() (information_schema), never user
  // input, so identifier interpolation here is safe; still quote it.
  const ident = sql.raw(`"${table.replace(/"/g, '""')}"`);
  const pageArm =
    opts.limit != null
      ? sql` LIMIT ${opts.limit} OFFSET ${opts.offset ?? 0}`
      : sql``;

  const rows = (await db.execute(
    sql`SELECT * FROM ${ident} ORDER BY 1${pageArm}`,
  )) as unknown as Array<Record<string, unknown>>;

  const headers = rows.length > 0 ? Object.keys(rows[0]!) : await columnNames(table);
  const body = rows.map((r) => headers.map((h) => cell(r[h])));
  return { table, headers, rows: body, rowCount: body.length };
}

/** Column names in ordinal order — used so an empty table still gets a header row. */
async function columnNames(table: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `)) as unknown as Array<{ column_name: string }>;
  return rows.map((r) => r.column_name);
}

/** Row count for a table (cheap; used to decide sharding before dumping). */
export async function countRows(table: string): Promise<number> {
  assertBackupable(table);
  const ident = sql.raw(`"${table.replace(/"/g, '""')}"`);
  const [row] = (await db.execute(
    sql`SELECT count(*)::int AS n FROM ${ident}`,
  )) as unknown as Array<{ n: number }>;
  return row?.n ?? 0;
}
