import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionMasterCompanies, collectionMasterImports, customerMasters, employees } from "@/db/schema";
import { exactNameKey } from "@/lib/collections/master/normalize";
import type { ExistingCompany } from "@/lib/collections/master/plan";

/**
 * Reads for the Collection Master. Every reader reports a missing table
 * (migration 0112 not applied) as `storageReady: false` instead of failing the
 * page — the same convention as lib/queries/collection-followups.ts.
 */

/** Postgres "undefined_table". */
export const isMissingTable = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
};

export interface MasterCompanyRow {
  id: string;
  companyName: string;
  coordinatorLabel: string | null;
  paymentTerms: string | null;
  customerMasterId: string | null;
  clientMatch: "none" | "linked" | "ambiguous";
  updatedAt: Date;
}

const COLS = {
  id: collectionMasterCompanies.id,
  companyName: collectionMasterCompanies.companyName,
  coordinatorLabel: collectionMasterCompanies.coordinatorLabel,
  paymentTerms: collectionMasterCompanies.paymentTerms,
  customerMasterId: collectionMasterCompanies.customerMasterId,
  clientMatch: collectionMasterCompanies.clientMatch,
  updatedAt: collectionMasterCompanies.updatedAt,
};

export const MASTER_PAGE_SIZE = 50;

/** Search (company or coordinator, case-insensitive) and page through the master. */
export async function listMasterCompanies(opts: { query?: string; page?: number; coordinator?: "all" | "unassigned" }): Promise<{
  storageReady: boolean;
  total: number;
  page: number;
  pageSize: number;
  rows: MasterCompanyRow[];
}> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const q = (opts.query ?? "").trim().slice(0, 100);
  const conds = [];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(collectionMasterCompanies.companyName, like), ilike(collectionMasterCompanies.coordinatorLabel, like)));
  }
  if (opts.coordinator === "unassigned") conds.push(sql`${collectionMasterCompanies.coordinatorLabel} is null`);
  const where = conds.length ? and(...conds) : undefined;
  try {
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(collectionMasterCompanies).where(where);
    const rows = await db
      .select(COLS)
      .from(collectionMasterCompanies)
      .where(where)
      .orderBy(asc(collectionMasterCompanies.companyName))
      .limit(MASTER_PAGE_SIZE)
      .offset(page * MASTER_PAGE_SIZE);
    return { storageReady: true, total: count?.n ?? 0, page, pageSize: MASTER_PAGE_SIZE, rows };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, total: 0, page, pageSize: MASTER_PAGE_SIZE, rows: [] };
    throw err;
  }
}

export interface MasterCompanyDetail extends MasterCompanyRow {
  createdAt: Date;
  clientMasterName: string | null;
  createdImport: { fileName: string | null; importedAt: Date } | null;
  lastImport: { fileName: string | null; importedAt: Date; importedByName: string | null } | null;
}

export async function getMasterCompany(id: string): Promise<{ storageReady: boolean; company: MasterCompanyDetail | null }> {
  try {
    const [row] = await db
      .select({ ...COLS, createdAt: collectionMasterCompanies.createdAt, createdImportId: collectionMasterCompanies.createdImportId, lastImportId: collectionMasterCompanies.lastImportId })
      .from(collectionMasterCompanies)
      .where(eq(collectionMasterCompanies.id, id))
      .limit(1);
    if (!row) return { storageReady: true, company: null };
    const [client] = row.customerMasterId
      ? await db.select({ name: customerMasters.name }).from(customerMasters).where(eq(customerMasters.id, row.customerMasterId)).limit(1)
      : [];
    const importIds = [row.createdImportId, row.lastImportId].filter((x): x is string => !!x);
    const imports = importIds.length
      ? await db
          .select({ id: collectionMasterImports.id, fileName: collectionMasterImports.fileName, importedAt: collectionMasterImports.importedAt, by: employees.name })
          .from(collectionMasterImports)
          .leftJoin(employees, eq(employees.id, collectionMasterImports.importedById))
          .where(inArray(collectionMasterImports.id, importIds))
      : [];
    const created = imports.find((i) => i.id === row.createdImportId);
    const last = imports.find((i) => i.id === row.lastImportId);
    return {
      storageReady: true,
      company: {
        id: row.id,
        companyName: row.companyName,
        coordinatorLabel: row.coordinatorLabel,
        paymentTerms: row.paymentTerms,
        customerMasterId: row.customerMasterId,
        clientMatch: row.clientMatch,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        clientMasterName: client?.name ?? null,
        createdImport: created ? { fileName: created.fileName, importedAt: created.importedAt } : null,
        lastImport: last ? { fileName: last.fileName, importedAt: last.importedAt, importedByName: last.by ?? null } : null,
      },
    };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, company: null };
    throw err;
  }
}

export interface ImportHistoryRow {
  id: string;
  fileName: string | null;
  importedAt: Date;
  importedByName: string | null;
  totals: Record<string, number>;
}

export async function listRecentImports(limit = 10): Promise<ImportHistoryRow[]> {
  try {
    const rows = await db
      .select({ id: collectionMasterImports.id, fileName: collectionMasterImports.fileName, importedAt: collectionMasterImports.importedAt, by: employees.name, totals: collectionMasterImports.totals })
      .from(collectionMasterImports)
      .leftJoin(employees, eq(employees.id, collectionMasterImports.importedById))
      .orderBy(desc(collectionMasterImports.importedAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, fileName: r.fileName, importedAt: r.importedAt, importedByName: r.by ?? null, totals: (r.totals ?? {}) as Record<string, number> }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Every master company, for the Collection screens. */
export async function listAllMasterCompanies(): Promise<{ storageReady: boolean; rows: MasterCompanyRow[] }> {
  try {
    const rows = await db.select(COLS).from(collectionMasterCompanies).orderBy(asc(collectionMasterCompanies.companyName));
    return { storageReady: true, rows };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

type Reader = Pick<typeof db, "select">;

/** Stored companies by name key (for the import plan). */
export async function loadExistingByKeys(q: Reader, keys: string[]): Promise<Map<string, ExistingCompany>> {
  const out = new Map<string, ExistingCompany>();
  const unique = [...new Set(keys)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 1000) {
    const rows = await q
      .select({
        id: collectionMasterCompanies.id,
        companyName: collectionMasterCompanies.companyName,
        nameKey: collectionMasterCompanies.nameKey,
        coordinatorLabel: collectionMasterCompanies.coordinatorLabel,
        paymentTerms: collectionMasterCompanies.paymentTerms,
        customerMasterId: collectionMasterCompanies.customerMasterId,
      })
      .from(collectionMasterCompanies)
      .where(inArray(collectionMasterCompanies.nameKey, unique.slice(i, i + 1000)));
    for (const r of rows) out.set(r.nameKey, r);
  }
  return out;
}

/** Client Master records in the Client Master (stage "complete"), by exact name key → ids. */
export async function loadClientMasterIndex(q: Reader): Promise<Map<string, string[]>> {
  const rows = await q
    .select({ id: customerMasters.id, name: customerMasters.name })
    .from(customerMasters)
    .where(eq(customerMasters.kycStage, "complete"));
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const k = exactNameKey(r.name);
    if (k) out.set(k, [...(out.get(k) ?? []), r.id]);
  }
  return out;
}
