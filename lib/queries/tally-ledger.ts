import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, employees, tallyDocuments, tallyImportBatches, tallyImportRows, tallyOutstandingLines, vendorMasters } from "@/db/schema";
import type { FormsViewer } from "@/lib/auth/forms-access";
import { isMissingTable } from "@/lib/queries/collection-master";
import type { TallyDocumentType } from "@/lib/tally/categories";
import { TALLY_DOCUMENT_TYPES, type OutstandingDirection } from "@/lib/tally/sections";
import type { ListParams } from "@/lib/tally/list-params";

/**
 * READ-ONLY queries behind the Forms sections that show what Tally Data Import
 * wrote: Vendor Master, the seven document ledgers, Outstanding Balances and
 * the per-batch drill-down. Nothing here inserts, updates or deletes, so
 * opening or paging through a section can never create a record.
 *
 * Every function takes the `FormsViewer` proof (lib/auth/forms-access.ts): the
 * module check has run on this request before a row is read. Filtering, sorting
 * and paging happen in SQL — these tables grow with every financial year.
 *
 * Tables: `tally_documents` (one row per voucher, `document_type` = the import
 * category), `tally_outstanding_lines` (one row per bill per snapshot batch),
 * `vendor_masters`, `tally_import_batches` / `tally_import_rows` (migration 0122),
 * joined to `customer_masters` and `employees` where a name is shown.
 */

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  size: number;
  /** False when migration 0122 hasn't been applied to this database. */
  storageReady: boolean;
}

const EMPTY = <T>(p: { page: number; size: number }): Page<T> => ({ rows: [], total: 0, page: p.page, size: p.size, storageReady: false });

/** A LIKE pattern for a search term: the term's own `%` and `_` are literal. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const ordered = (col: SQL | import("drizzle-orm").Column, dir: "asc" | "desc") => (dir === "asc" ? asc(col) : desc(col));
const offset = (p: { page: number; size: number }) => (p.page - 1) * p.size;
const total = async (from: () => Promise<{ n: number }[]>) => (await from())[0]?.n ?? 0;

async function readOrEmpty<T>(p: { page: number; size: number }, run: () => Promise<Page<T>>): Promise<Page<T>> {
  try {
    return await run();
  } catch (err) {
    if (isMissingTable(err)) return EMPTY<T>(p);
    throw err;
  }
}

/* ── import batches, as the sections name them ───────────────────────────── */

export interface BatchOption {
  id: string;
  fileName: string;
  createdAt: Date;
  status: string;
  asOfDate: string | null;
  direction: OutstandingDirection | null;
  importedRows: number;
}

/** The batches that produced records of one category — the Import batch filter's options. */
export async function batchOptions(_v: FormsViewer, category: string, direction?: OutstandingDirection): Promise<BatchOption[]> {
  try {
    const where = [eq(tallyImportBatches.category, category), sql`${tallyImportBatches.importedRows} > 0`];
    if (direction) where.push(eq(tallyImportBatches.direction, direction));
    return await db
      .select({ id: tallyImportBatches.id, fileName: tallyImportBatches.fileName, createdAt: tallyImportBatches.createdAt, status: tallyImportBatches.status, asOfDate: tallyImportBatches.asOfDate, direction: tallyImportBatches.direction, importedRows: tallyImportBatches.importedRows })
      .from(tallyImportBatches)
      .where(and(...where))
      .orderBy(desc(tallyImportBatches.createdAt))
      .limit(200);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/* ── Vendor Master ───────────────────────────────────────────────────────── */

export const VENDOR_SORTS = ["name", "code", "state", "createdAt"] as const;
export type VendorSort = (typeof VENDOR_SORTS)[number];

export interface VendorRow {
  id: string;
  name: string;
  code: string | null;
  gstin: string | null;
  panNo: string | null;
  tallyGroup: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  creditPeriodDays: number | null;
  isActive: boolean;
  importBatchId: string | null;
  batchFileName: string | null;
  createdAt: Date;
}

const vendorColumns = {
  id: vendorMasters.id,
  name: vendorMasters.name,
  code: vendorMasters.code,
  gstin: vendorMasters.gstin,
  panNo: vendorMasters.panNo,
  tallyGroup: vendorMasters.tallyGroup,
  phone: vendorMasters.phone,
  email: vendorMasters.email,
  address: vendorMasters.address,
  state: vendorMasters.state,
  creditPeriodDays: vendorMasters.creditPeriodDays,
  isActive: vendorMasters.isActive,
  importBatchId: vendorMasters.importBatchId,
  batchFileName: tallyImportBatches.fileName,
  createdAt: vendorMasters.createdAt,
};

function vendorWhere(p: ListParams): SQL | undefined {
  const w: (SQL | undefined)[] = [];
  if (p.q) w.push(or(ilike(vendorMasters.name, like(p.q)), ilike(vendorMasters.code, like(p.q)), ilike(vendorMasters.gstin, like(p.q))));
  if (p.batch) w.push(eq(vendorMasters.importBatchId, p.batch));
  if (p.from) w.push(gte(vendorMasters.createdAt, new Date(`${p.from}T00:00:00+05:30`)));
  if (p.to) w.push(lte(vendorMasters.createdAt, new Date(`${p.to}T23:59:59.999+05:30`)));
  return w.length ? and(...w) : undefined;
}

export async function listVendors(_v: FormsViewer, p: ListParams<VendorSort>): Promise<Page<VendorRow>> {
  return readOrEmpty(p, async () => {
    const where = vendorWhere(p);
    const sortCol = { name: vendorMasters.name, code: vendorMasters.code, state: vendorMasters.state, createdAt: vendorMasters.createdAt }[p.sort];
    const [rows, n] = await Promise.all([
      db.select(vendorColumns).from(vendorMasters).leftJoin(tallyImportBatches, eq(tallyImportBatches.id, vendorMasters.importBatchId)).where(where).orderBy(ordered(sortCol, p.dir), asc(vendorMasters.name)).limit(p.size).offset(offset(p)),
      total(() => db.select({ n: sql<number>`count(*)::int` }).from(vendorMasters).where(where)),
    ]);
    return { rows, total: n, page: p.page, size: p.size, storageReady: true };
  });
}

export interface VendorDetail extends VendorRow {
  batch: BatchSummary | null;
  /** How many documents of each type name this vendor, and how many payable outstanding lines. */
  documents: { type: TallyDocumentType; n: number }[];
  outstandingLines: number;
}

export async function getVendor(_v: FormsViewer, id: string): Promise<VendorDetail | null> {
  try {
    const [row] = await db.select(vendorColumns).from(vendorMasters).leftJoin(tallyImportBatches, eq(tallyImportBatches.id, vendorMasters.importBatchId)).where(eq(vendorMasters.id, id)).limit(1);
    if (!row) return null;
    const [docs, [out], batch] = await Promise.all([
      db.select({ type: tallyDocuments.documentType, n: sql<number>`count(*)::int` }).from(tallyDocuments).where(eq(tallyDocuments.vendorMasterId, id)).groupBy(tallyDocuments.documentType),
      db.select({ n: sql<number>`count(*)::int` }).from(tallyOutstandingLines).where(eq(tallyOutstandingLines.vendorMasterId, id)),
      row.importBatchId ? batchSummary(row.importBatchId) : Promise.resolve(null),
    ]);
    return { ...row, batch, documents: docs.filter((d): d is { type: TallyDocumentType; n: number } => (TALLY_DOCUMENT_TYPES as readonly string[]).includes(d.type)), outstandingLines: out?.n ?? 0 };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/* ── document ledgers ────────────────────────────────────────────────────── */

export const DOCUMENT_SORTS = ["documentDate", "documentNo", "partyName", "totalPaise", "dueDate"] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];

export interface DocumentRow {
  id: string;
  documentType: string;
  documentNo: string;
  documentDate: string;
  financialYear: string;
  isHistorical: boolean;
  partyName: string;
  partyGstin: string | null;
  customerMasterId: string | null;
  vendorMasterId: string | null;
  totalPaise: number;
  taxablePaise: number | null;
  taxPaise: number | null;
  refDocumentNo: string | null;
  refDocumentId: string | null;
  paymentMode: string | null;
  referenceNo: string | null;
  adjustmentType: string | null;
  dueDate: string | null;
  importBatchId: string;
  lineCount: number;
}

const documentColumns = {
  id: tallyDocuments.id,
  documentType: tallyDocuments.documentType,
  documentNo: tallyDocuments.documentNo,
  documentDate: tallyDocuments.documentDate,
  financialYear: tallyDocuments.financialYear,
  isHistorical: tallyDocuments.isHistorical,
  partyName: tallyDocuments.partyName,
  partyGstin: tallyDocuments.partyGstin,
  customerMasterId: tallyDocuments.customerMasterId,
  vendorMasterId: tallyDocuments.vendorMasterId,
  totalPaise: tallyDocuments.totalPaise,
  taxablePaise: tallyDocuments.taxablePaise,
  taxPaise: tallyDocuments.taxPaise,
  refDocumentNo: tallyDocuments.refDocumentNo,
  refDocumentId: tallyDocuments.refDocumentId,
  paymentMode: tallyDocuments.paymentMode,
  referenceNo: tallyDocuments.referenceNo,
  adjustmentType: tallyDocuments.adjustmentType,
  dueDate: tallyDocuments.dueDate,
  importBatchId: tallyDocuments.importBatchId,
  lineCount: sql<number>`jsonb_array_length(${tallyDocuments.lines})`,
};

/** Exactly one document type per ledger, always — the type is the first condition and never optional. */
function documentWhere(type: TallyDocumentType, p: ListParams): SQL {
  const w: (SQL | undefined)[] = [eq(tallyDocuments.documentType, type)];
  if (p.q) w.push(or(ilike(tallyDocuments.documentNo, like(p.q)), ilike(tallyDocuments.partyName, like(p.q)), ilike(tallyDocuments.refDocumentNo, like(p.q))));
  if (p.fy) w.push(eq(tallyDocuments.financialYear, p.fy));
  if (p.from) w.push(gte(tallyDocuments.documentDate, p.from));
  if (p.to) w.push(lte(tallyDocuments.documentDate, p.to));
  if (p.batch) w.push(eq(tallyDocuments.importBatchId, p.batch));
  return and(...w)!;
}

export interface DocumentPage extends Page<DocumentRow> {
  /** Sum of the money column over the WHOLE filtered set (not just this page), from the database. */
  totalPaise: number;
}

export async function listDocuments(_v: FormsViewer, type: TallyDocumentType, p: ListParams<DocumentSort>): Promise<DocumentPage> {
  const empty = { ...EMPTY<DocumentRow>(p), totalPaise: 0 };
  try {
    const where = documentWhere(type, p);
    const sortCol = { documentDate: tallyDocuments.documentDate, documentNo: tallyDocuments.documentNoKey, partyName: tallyDocuments.partyName, totalPaise: tallyDocuments.totalPaise, dueDate: tallyDocuments.dueDate }[p.sort];
    const [rows, [agg]] = await Promise.all([
      db.select(documentColumns).from(tallyDocuments).where(where).orderBy(ordered(sortCol, p.dir), desc(tallyDocuments.documentDate), asc(tallyDocuments.documentNoKey)).limit(p.size).offset(offset(p)),
      db.select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${tallyDocuments.totalPaise}), 0)::bigint` }).from(tallyDocuments).where(where),
    ]);
    return { rows, total: agg?.n ?? 0, totalPaise: Number(agg?.sum ?? 0), page: p.page, size: p.size, storageReady: true };
  } catch (err) {
    if (isMissingTable(err)) return empty;
    throw err;
  }
}

/** The financial years one ledger holds, newest first — the Financial year filter's options. */
export async function documentFinancialYears(_v: FormsViewer, type: TallyDocumentType): Promise<string[]> {
  try {
    const rows = await db.selectDistinct({ fy: tallyDocuments.financialYear }).from(tallyDocuments).where(eq(tallyDocuments.documentType, type)).orderBy(desc(tallyDocuments.financialYear));
    return rows.map((r) => r.fy);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export interface PartyLink {
  kind: "customer" | "vendor";
  id: string;
  name: string;
  code: string | null;
  gstin: string | null;
}

export interface BatchSummary {
  id: string;
  category: string;
  fileName: string;
  sheetName: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  uploadedBy: string | null;
  asOfDate: string | null;
  direction: OutstandingDirection | null;
}

async function batchSummary(id: string): Promise<BatchSummary | null> {
  const [b] = await db
    .select({ id: tallyImportBatches.id, category: tallyImportBatches.category, fileName: tallyImportBatches.fileName, sheetName: tallyImportBatches.sheetName, status: tallyImportBatches.status, createdAt: tallyImportBatches.createdAt, completedAt: tallyImportBatches.completedAt, uploadedBy: employees.name, asOfDate: tallyImportBatches.asOfDate, direction: tallyImportBatches.direction })
    .from(tallyImportBatches)
    .leftJoin(employees, eq(employees.id, tallyImportBatches.createdById))
    .where(eq(tallyImportBatches.id, id))
    .limit(1);
  return b ?? null;
}

async function partyLink(customerMasterId: string | null, vendorMasterId: string | null): Promise<PartyLink | null> {
  if (customerMasterId) {
    const [c] = await db.select({ id: customerMasters.id, name: customerMasters.name, code: customerMasters.code, gstin: customerMasters.gstin }).from(customerMasters).where(eq(customerMasters.id, customerMasterId)).limit(1);
    return c ? { kind: "customer", ...c } : null;
  }
  if (vendorMasterId) {
    const [v] = await db.select({ id: vendorMasters.id, name: vendorMasters.name, code: vendorMasters.code, gstin: vendorMasters.gstin }).from(vendorMasters).where(eq(vendorMasters.id, vendorMasterId)).limit(1);
    return v ? { kind: "vendor", ...v } : null;
  }
  return null;
}

export interface DocumentRef {
  id: string;
  documentType: string;
  documentNo: string;
  documentDate: string;
  partyName: string;
  totalPaise: number;
}

const refColumns = { id: tallyDocuments.id, documentType: tallyDocuments.documentType, documentNo: tallyDocuments.documentNo, documentDate: tallyDocuments.documentDate, partyName: tallyDocuments.partyName, totalPaise: tallyDocuments.totalPaise };

export interface DocumentDetail {
  document: typeof tallyDocuments.$inferSelect;
  party: PartyLink | null;
  batch: BatchSummary | null;
  /** The document this one refers to (invoice → order, note/receipt → invoice), when the import found it. */
  refersTo: DocumentRef | null;
  /** Documents that refer to this one. */
  referencedBy: DocumentRef[];
}

/** One document, of the type the page is for — a sales invoice's id opened under /credit-notes is "not found". */
export async function getDocument(_v: FormsViewer, type: TallyDocumentType, id: string): Promise<DocumentDetail | null> {
  try {
    const [document] = await db.select().from(tallyDocuments).where(and(eq(tallyDocuments.id, id), eq(tallyDocuments.documentType, type))).limit(1);
    if (!document) return null;
    const [party, batch, refersTo, referencedBy] = await Promise.all([
      partyLink(document.customerMasterId, document.vendorMasterId),
      batchSummary(document.importBatchId),
      document.refDocumentId ? db.select(refColumns).from(tallyDocuments).where(eq(tallyDocuments.id, document.refDocumentId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
      db.select(refColumns).from(tallyDocuments).where(eq(tallyDocuments.refDocumentId, id)).orderBy(asc(tallyDocuments.documentDate)).limit(100),
    ]);
    return { document, party, batch, refersTo, referencedBy };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/* ── Outstanding Balances ────────────────────────────────────────────────── */

export const OUTSTANDING_SORTS = ["partyName", "billRef", "billDate", "dueDate", "originalPaise", "pendingPaise"] as const;
export type OutstandingSort = (typeof OUTSTANDING_SORTS)[number];

export interface Snapshot {
  id: string;
  asOfDate: string;
  direction: OutstandingDirection;
  status: string;
  fileName: string;
  createdAt: Date;
  completedAt: Date | null;
  uploadedBy: string | null;
  importedRows: number;
}

/**
 * The snapshots of one side of the ledger, the one the Tracker would use first:
 * newest as-of date, then newest completed. Only completed batches qualify
 * (a partial import isn't a balance sheet), exactly as `latestReceivableLines`
 * chooses for the Collection Tracker.
 */
export async function outstandingSnapshots(_v: FormsViewer, direction: OutstandingDirection): Promise<Snapshot[]> {
  try {
    const rows = await db
      .select({ id: tallyImportBatches.id, asOfDate: tallyImportBatches.asOfDate, direction: tallyImportBatches.direction, status: tallyImportBatches.status, fileName: tallyImportBatches.fileName, createdAt: tallyImportBatches.createdAt, completedAt: tallyImportBatches.completedAt, uploadedBy: employees.name, importedRows: tallyImportBatches.importedRows })
      .from(tallyImportBatches)
      .leftJoin(employees, eq(employees.id, tallyImportBatches.createdById))
      .where(and(eq(tallyImportBatches.category, "outstanding-balances"), eq(tallyImportBatches.direction, direction), eq(tallyImportBatches.status, "completed")))
      .orderBy(desc(tallyImportBatches.asOfDate), desc(tallyImportBatches.completedAt))
      .limit(100);
    return rows.filter((r): r is typeof r & { asOfDate: string; direction: OutstandingDirection } => !!r.asOfDate && !!r.direction);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export interface OutstandingRow {
  id: string;
  batchId: string;
  direction: OutstandingDirection;
  asOfDate: string;
  partyName: string;
  customerMasterId: string | null;
  vendorMasterId: string | null;
  collectionCompanyId: string | null;
  billRef: string | null;
  billDate: string | null;
  dueDate: string | null;
  originalPaise: number | null;
  pendingPaise: number;
  narration: string | null;
}

const outstandingColumns = {
  id: tallyOutstandingLines.id,
  batchId: tallyOutstandingLines.batchId,
  direction: tallyOutstandingLines.direction,
  asOfDate: tallyOutstandingLines.asOfDate,
  partyName: tallyOutstandingLines.partyName,
  customerMasterId: tallyOutstandingLines.customerMasterId,
  vendorMasterId: tallyOutstandingLines.vendorMasterId,
  collectionCompanyId: tallyOutstandingLines.collectionCompanyId,
  billRef: tallyOutstandingLines.billRef,
  billDate: tallyOutstandingLines.billDate,
  dueDate: tallyOutstandingLines.dueDate,
  originalPaise: tallyOutstandingLines.originalPaise,
  pendingPaise: tallyOutstandingLines.pendingPaise,
  narration: tallyOutstandingLines.narration,
};

export interface OutstandingPage extends Page<OutstandingRow> {
  /** The snapshot shown: the one asked for (`batch`), else the newest completed. Null when there is none. */
  snapshot: Snapshot | null;
  snapshots: Snapshot[];
  /** Sum of pending over the whole filtered set, from the database. */
  pendingPaise: number;
}

/** One side of the ledger, one snapshot at a time — receivable and payable lines are never mixed. */
export async function listOutstanding(v: FormsViewer, direction: OutstandingDirection, p: ListParams<OutstandingSort>): Promise<OutstandingPage> {
  const snapshots = await outstandingSnapshots(v, direction);
  // The snapshot asked for, if it is one of this side's completed ones; otherwise the newest. The page names the one shown.
  const snapshot = (p.batch ? snapshots.find((s) => s.id === p.batch) : undefined) ?? snapshots[0] ?? null;
  const base = { snapshots, snapshot, pendingPaise: 0 };
  if (!snapshot) return { ...EMPTY<OutstandingRow>(p), ...base, storageReady: true };
  try {
    const w: (SQL | undefined)[] = [eq(tallyOutstandingLines.batchId, snapshot.id), eq(tallyOutstandingLines.direction, direction)];
    if (p.q) w.push(or(ilike(tallyOutstandingLines.partyName, like(p.q)), ilike(tallyOutstandingLines.billRef, like(p.q))));
    if (p.from) w.push(gte(tallyOutstandingLines.billDate, p.from));
    if (p.to) w.push(lte(tallyOutstandingLines.billDate, p.to));
    const where = and(...w)!;
    const sortCol = { partyName: tallyOutstandingLines.partyName, billRef: tallyOutstandingLines.billRef, billDate: tallyOutstandingLines.billDate, dueDate: tallyOutstandingLines.dueDate, originalPaise: tallyOutstandingLines.originalPaise, pendingPaise: tallyOutstandingLines.pendingPaise }[p.sort];
    const [rows, [agg]] = await Promise.all([
      db.select(outstandingColumns).from(tallyOutstandingLines).where(where).orderBy(ordered(sortCol, p.dir), asc(tallyOutstandingLines.partyName), asc(tallyOutstandingLines.sourceRow)).limit(p.size).offset(offset(p)),
      db.select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${tallyOutstandingLines.pendingPaise}), 0)::bigint` }).from(tallyOutstandingLines).where(where),
    ]);
    return { rows: rows as OutstandingRow[], total: agg?.n ?? 0, pendingPaise: Number(agg?.sum ?? 0), page: p.page, size: p.size, storageReady: true, snapshots, snapshot };
  } catch (err) {
    if (isMissingTable(err)) return { ...EMPTY<OutstandingRow>(p), ...base };
    throw err;
  }
}

export interface OutstandingDetail {
  line: typeof tallyOutstandingLines.$inferSelect;
  party: PartyLink | null;
  batch: BatchSummary | null;
  /** The Collection Master company this line is matched to by name, if any. */
  collectionCompany: { id: string; name: string } | null;
}

export async function getOutstandingLine(_v: FormsViewer, direction: OutstandingDirection, id: string): Promise<OutstandingDetail | null> {
  try {
    const [line] = await db.select().from(tallyOutstandingLines).where(and(eq(tallyOutstandingLines.id, id), eq(tallyOutstandingLines.direction, direction))).limit(1);
    if (!line) return null;
    const [party, batch, company] = await Promise.all([
      partyLink(line.customerMasterId, line.vendorMasterId),
      batchSummary(line.batchId),
      line.collectionCompanyId
        ? db.execute<{ id: string; name: string }>(sql`select id, company_name as name from collection_master_companies where id = ${line.collectionCompanyId} limit 1`).then((r) => ((r as unknown as { rows?: { id: string; name: string }[] }).rows ?? (r as unknown as { id: string; name: string }[]))[0] ?? null)
        : Promise.resolve(null),
    ]);
    return { line, party, batch, collectionCompany: company };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/* ── one import batch, every row ─────────────────────────────────────────── */

export const BATCH_ROW_STATUSES = ["imported", "skipped", "rejected", "failed"] as const;
export type BatchRowStatus = (typeof BATCH_ROW_STATUSES)[number];

export interface BatchDetail {
  batch: typeof tallyImportBatches.$inferSelect & { uploadedBy: string | null };
  /** Recorded rows by status, from the rows themselves. */
  counts: Record<BatchRowStatus, number>;
}

export async function getBatchDetail(_v: FormsViewer, id: string): Promise<BatchDetail | null> {
  try {
    const [row] = await db.select({ batch: tallyImportBatches, uploadedBy: employees.name }).from(tallyImportBatches).leftJoin(employees, eq(employees.id, tallyImportBatches.createdById)).where(eq(tallyImportBatches.id, id)).limit(1);
    if (!row) return null;
    const grouped = await db.select({ status: tallyImportRows.status, n: sql<number>`count(*)::int` }).from(tallyImportRows).where(eq(tallyImportRows.batchId, id)).groupBy(tallyImportRows.status);
    const counts: Record<BatchRowStatus, number> = { imported: 0, skipped: 0, rejected: 0, failed: 0 };
    for (const g of grouped) counts[g.status] = g.n;
    return { batch: { ...row.batch, uploadedBy: row.uploadedBy }, counts };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export interface BatchRowRow {
  id: string;
  rowNo: number;
  status: BatchRowStatus;
  reason: string | null;
  targetTable: string | null;
  targetId: string | null;
  cells: string[];
}

export const BATCH_ROW_SORTS = ["rowNo", "status"] as const;
export type BatchRowSort = (typeof BATCH_ROW_SORTS)[number];

/** The rows one import recorded, in file order, optionally one status only. `q` searches the row's cells. */
export async function listBatchRows(_v: FormsViewer, batchId: string, p: ListParams<BatchRowSort>): Promise<Page<BatchRowRow>> {
  return readOrEmpty(p, async () => {
    const w: (SQL | undefined)[] = [eq(tallyImportRows.batchId, batchId)];
    if (p.status && (BATCH_ROW_STATUSES as readonly string[]).includes(p.status)) w.push(eq(tallyImportRows.status, p.status as BatchRowStatus));
    if (p.q) w.push(sql`exists (select 1 from jsonb_array_elements_text(${tallyImportRows.cells}) c where c ilike ${like(p.q)})`);
    const where = and(...w)!;
    const sortCol = p.sort === "status" ? tallyImportRows.status : tallyImportRows.rowNo;
    const [rows, n] = await Promise.all([
      db.select({ id: tallyImportRows.id, rowNo: tallyImportRows.rowNo, status: tallyImportRows.status, reason: tallyImportRows.reason, targetTable: tallyImportRows.targetTable, targetId: tallyImportRows.targetId, cells: tallyImportRows.cells }).from(tallyImportRows).where(where).orderBy(ordered(sortCol, p.dir), asc(tallyImportRows.rowNo)).limit(p.size).offset(offset(p)),
      total(() => db.select({ n: sql<number>`count(*)::int` }).from(tallyImportRows).where(where)),
    ]);
    return { rows, total: n, page: p.page, size: p.size, storageReady: true };
  });
}

/* ── the Forms overview ──────────────────────────────────────────────────── */

export interface FormsOverviewCounts {
  storageReady: boolean;
  customers: number;
  vendors: number;
  documents: Record<TallyDocumentType, number>;
  /** Lines in the newest completed snapshot of each side. */
  receivables: number;
  payables: number;
  batches: number;
}

export async function formsOverviewCounts(v: FormsViewer): Promise<FormsOverviewCounts> {
  const documents = Object.fromEntries(TALLY_DOCUMENT_TYPES.map((t) => [t, 0])) as Record<TallyDocumentType, number>;
  const [customers] = await db.select({ n: sql<number>`count(*)::int` }).from(customerMasters).where(eq(customerMasters.isActive, true));
  try {
    const [[vendors], byType, [batches], rec, pay] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(vendorMasters),
      db.select({ type: tallyDocuments.documentType, n: sql<number>`count(*)::int` }).from(tallyDocuments).where(inArray(tallyDocuments.documentType, [...TALLY_DOCUMENT_TYPES])).groupBy(tallyDocuments.documentType),
      db.select({ n: sql<number>`count(*)::int` }).from(tallyImportBatches),
      outstandingSnapshots(v, "receivable"),
      outstandingSnapshots(v, "payable"),
    ]);
    for (const r of byType) if ((TALLY_DOCUMENT_TYPES as readonly string[]).includes(r.type)) documents[r.type as TallyDocumentType] = r.n;
    const linesIn = async (s: Snapshot | undefined) => (s ? ((await db.select({ n: sql<number>`count(*)::int` }).from(tallyOutstandingLines).where(eq(tallyOutstandingLines.batchId, s.id)))[0]?.n ?? 0) : 0);
    return { storageReady: true, customers: customers?.n ?? 0, vendors: vendors?.n ?? 0, documents, receivables: await linesIn(rec[0]), payables: await linesIn(pay[0]), batches: batches?.n ?? 0 };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, customers: customers?.n ?? 0, vendors: 0, documents, receivables: 0, payables: 0, batches: 0 };
    throw err;
  }
}
