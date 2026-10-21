import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionMasterCompanies, collectionMasterImports, customerMasters, employees } from "@/db/schema";
import { exactNameKey } from "@/lib/collections/master/normalize";
import type { ExistingCompany } from "@/lib/collections/master/plan";
import type { CapabilityProof } from "@/lib/auth/capability";
import type { CoordinatorAssignmentInputT } from "@/lib/collections/coordinator";

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

/**
 * Marks a change-log row written by a Sales Coordinator assignment in the
 * Collection Tracker (not a file import). Stored in `column_mapping.source`.
 */
export const TRACKER_ASSIGNMENT_SOURCE = "tracker-assignment";

export interface ImportHistoryRow {
  id: string;
  fileName: string | null;
  importedAt: Date;
  importedByName: string | null;
  totals: Record<string, number>;
  /** "file" for an import, or a coordinator assignment made in the Collection Tracker. */
  source: "file" | typeof TRACKER_ASSIGNMENT_SOURCE;
}

export async function listRecentImports(limit = 10): Promise<ImportHistoryRow[]> {
  try {
    const rows = await db
      .select({ id: collectionMasterImports.id, fileName: collectionMasterImports.fileName, importedAt: collectionMasterImports.importedAt, by: employees.name, totals: collectionMasterImports.totals, mapping: collectionMasterImports.columnMapping })
      .from(collectionMasterImports)
      .leftJoin(employees, eq(employees.id, collectionMasterImports.importedById))
      .orderBy(desc(collectionMasterImports.importedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      importedAt: r.importedAt,
      importedByName: r.by ?? null,
      totals: (r.totals ?? {}) as Record<string, number>,
      source: (r.mapping as { source?: unknown } | null)?.source === TRACKER_ASSIGNMENT_SOURCE ? TRACKER_ASSIGNMENT_SOURCE : "file",
    }));
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

type Reader = Pick<typeof db, "select" | "selectDistinct">;

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

/** Coordinator labels already stored (one spelling each), for the import plan. */
export async function listKnownCoordinatorLabels(q: Reader): Promise<string[]> {
  const rows = await q
    .selectDistinct({ label: collectionMasterCompanies.coordinatorLabel })
    .from(collectionMasterCompanies)
    .where(isNotNull(collectionMasterCompanies.coordinatorLabel))
    .orderBy(asc(collectionMasterCompanies.coordinatorLabel));
  return rows.map((r) => r.label).filter((l): l is string => !!l);
}

/**
 * The Sales Coordinators the Tracker may assign: the labels already in the
 * Collection Master (one spelling each). Never employees or invented names.
 */
export async function listCoordinatorOptions(): Promise<{ storageReady: boolean; labels: string[] }> {
  try {
    return { storageReady: true, labels: await listKnownCoordinatorLabels(db) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, labels: [] };
    throw err;
  }
}

export type CoordinatorAssignmentOutcome =
  | { ok: true; changed: boolean; from: string | null; to: string }
  | { ok: false; reason: "not-found" | "stale" | "unknown-label" };

/**
 * Set a company's Sales Coordinator (the same `coordinator_label` the import
 * writes). Needs collection.coordinator.assign — the branded proof can only
 * come from lib/auth/capability.ts. In one transaction: lock the company row,
 * check it still has the value the editor saw, check the choice is a label already in
 * the Collection Master, then update and write a before/after row to the
 * Collection Master change log (collection_master_imports, marked as a Tracker
 * assignment). Choosing the current value changes nothing.
 */
export async function assignCoordinatorLabel(owner: CapabilityProof<"collection.coordinator.assign">, input: CoordinatorAssignmentInputT): Promise<CoordinatorAssignmentOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: collectionMasterCompanies.id, coordinatorLabel: collectionMasterCompanies.coordinatorLabel })
      .from(collectionMasterCompanies)
      .where(eq(collectionMasterCompanies.id, input.companyId))
      .for("update");
    if (!row) return { ok: false, reason: "not-found" } as const;
    if (row.coordinatorLabel !== input.expected) return { ok: false, reason: "stale" } as const;
    const known = await listKnownCoordinatorLabels(tx as unknown as typeof db);
    const label = known.find((l) => l === input.coordinatorLabel);
    if (!label) return { ok: false, reason: "unknown-label" } as const;
    if (label === row.coordinatorLabel) return { ok: true, changed: false, from: row.coordinatorLabel, to: label } as const;

    const [log] = await tx
      .insert(collectionMasterImports)
      .values({
        fileName: null,
        sheetName: null,
        columnMapping: { source: TRACKER_ASSIGNMENT_SOURCE, field: "coordinatorLabel" },
        totals: { rows: 1, updated: 1 },
        changes: [{ companyId: row.id, action: "updated", source: TRACKER_ASSIGNMENT_SOURCE, before: { coordinatorLabel: row.coordinatorLabel }, after: { coordinatorLabel: label } }],
        importedById: owner.employeeId,
      })
      .returning({ id: collectionMasterImports.id });
    const updated = await tx
      .update(collectionMasterCompanies)
      .set({ coordinatorLabel: label, updatedById: owner.employeeId, updatedAt: new Date() })
      .where(
        and(
          eq(collectionMasterCompanies.id, row.id),
          row.coordinatorLabel === null ? isNull(collectionMasterCompanies.coordinatorLabel) : eq(collectionMasterCompanies.coordinatorLabel, row.coordinatorLabel),
        ),
      )
      .returning({ id: collectionMasterCompanies.id });
    // The row is locked above, so this can't happen; if it ever does, undo the log row too.
    if (updated.length !== 1 || !log) throw new Error("coordinator assignment did not apply");
    return { ok: true, changed: true, from: row.coordinatorLabel, to: label } as const;
  });
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
