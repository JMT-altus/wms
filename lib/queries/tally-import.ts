import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  collectionMasterCompanies,
  customerMasters,
  employees,
  tallyColumnMappings,
  tallyDocuments,
  tallyImportBatches,
  tallyImportRows,
  tallyOutstandingLines,
  vendorMasters,
} from "@/db/schema";
import { isMissingTable } from "@/lib/queries/collection-master";
import { TALLY_CATEGORIES, type TallyCategoryKey } from "@/lib/tally/categories";
import { resolveRows, type RecordResolution, type TallyImportRowStatus, importDecisions } from "@/lib/tally/resolve";
import { planRows, type DocumentRecord, type OutstandingRecord, type PartyRecord, type PlanOptions, type RawRow, type TallyRecord } from "@/lib/tally/plan";
import type { TallyMapping } from "@/lib/tally/mapping";
import { documentKey, financialYear, partyKey } from "@/lib/tally/values";

/**
 * The database side of Tally Data Import (migration 0122). Nothing here authorizes:
 * callers hold the capability. Nothing here deletes or updates an accounting
 * record, and it never touches sales_orders, invoices or receipts.
 */

type Q = typeof db;

/* ── looking records up ──────────────────────────────────────────────────── */

async function partyIndex(q: Q, side: "customer" | "vendor") {
  const rows =
    side === "customer"
      ? await q.select({ id: customerMasters.id, name: customerMasters.name, gstin: customerMasters.gstin }).from(customerMasters)
      : await q.select({ id: vendorMasters.id, name: vendorMasters.name, gstin: vendorMasters.gstin }).from(vendorMasters);
  const byKey = new Map<string, string[]>();
  const byGstin = new Map<string, string[]>();
  const gstinOf = new Map<string, string | null>();
  for (const r of rows) {
    const k = partyKey(r.name);
    byKey.set(k, [...(byKey.get(k) ?? []), r.id]);
    gstinOf.set(r.id, r.gstin);
    if (r.gstin) byGstin.set(r.gstin.toUpperCase(), [...(byGstin.get(r.gstin.toUpperCase()) ?? []), r.id]);
  }
  return { byKey, byGstin, gstinOf };
}

type PartyIndex = Awaited<ReturnType<typeof partyIndex>>;

/** GSTIN first, then the normalized name. Two candidates link to neither: a person decides. */
function findParty(ix: PartyIndex, gstin: string | null, key: string): { id: string | null; ambiguous: boolean } {
  const pool = (gstin && ix.byGstin.get(gstin)) || ix.byKey.get(key) || [];
  return pool.length === 1 ? { id: pool[0]!, ambiguous: false } : { id: null, ambiguous: pool.length > 1 };
}

/** What the database says about each record: existing, linked, or needing a look. */
export async function resolveRecords(q: Q, category: TallyCategoryKey, records: readonly TallyRecord[], direction: "receivable" | "payable" | null): Promise<Map<string, RecordResolution>> {
  const def = TALLY_CATEGORIES[category];
  const out = new Map<string, RecordResolution>();
  if (records.length === 0) return out;
  const side = def.party === "either" ? (direction === "payable" ? "vendor" : "customer") : def.party;
  const ix = await partyIndex(q, side);
  const label = side === "customer" ? "Customer Master" : "Vendor Master";

  if (def.kind === "party") {
    for (const rec of records as PartyRecord[]) {
      const found = findParty(ix, rec.gstin, rec.nameKey);
      const nameHit = ix.byKey.get(rec.nameKey);
      if (found.id) {
        const theirs = ix.gstinOf.get(found.id);
        const differs = !!(rec.gstin && theirs && rec.gstin !== theirs.toUpperCase());
        out.set(rec.key, { existing: "same", existingBatchId: null, partyId: found.id, refId: null, collectionCompanyId: null, attention: [], invalid: null, note: differs ? `Already in the ${label} with a different GSTIN; left unchanged.` : `Already in the ${label}; left unchanged.` });
      } else if (found.ambiguous || nameHit) {
        out.set(rec.key, { existing: "same", existingBatchId: null, partyId: null, refId: null, collectionCompanyId: null, attention: [], invalid: null, note: `Several ${label} records match; nothing changed.` });
      } else {
        out.set(rec.key, { existing: "none", existingBatchId: null, partyId: null, refId: null, collectionCompanyId: null, attention: [], invalid: null, note: null });
      }
    }
    return out;
  }

  if (def.kind === "outstanding") {
    const companies = direction === "receivable" ? await q.select({ id: collectionMasterCompanies.id, key: collectionMasterCompanies.nameKey }).from(collectionMasterCompanies) : [];
    const byCompany = new Map(companies.map((c) => [c.key, c.id]));
    for (const rec of records as OutstandingRecord[]) {
      const found = findParty(ix, null, rec.partyKey);
      const collectionCompanyId = byCompany.get(rec.partyKey) ?? null;
      const attention: string[] = [];
      if (!found.id) attention.push(found.ambiguous ? `Several ${label} records match "${rec.partyName}".` : `"${rec.partyName}" isn't in the ${label}.`);
      if (direction === "receivable" && !collectionCompanyId) attention.push(`"${rec.partyName}" isn't in the Collection Master, so the Tracker won't show this balance.`);
      out.set(rec.key, { existing: "none", existingBatchId: null, partyId: found.id, refId: null, collectionCompanyId, attention, invalid: null, note: null });
    }
    return out;
  }

  const docs = records as DocumentRecord[];
  const existing = await q
    .select({ identity: tallyDocuments.identity, totalPaise: tallyDocuments.totalPaise, documentDate: tallyDocuments.documentDate, partyKey: tallyDocuments.partyKey, batch: tallyDocuments.importBatchId, id: tallyDocuments.id })
    .from(tallyDocuments)
    .where(inArray(tallyDocuments.identity, docs.map((d) => d.key)));
  const byIdentity = new Map(existing.map((e) => [e.identity, e]));
  const refKeys = [...new Set(docs.map((d) => d.refDocumentNo).filter((r): r is string => !!r).map(documentKey))];
  const refs =
    def.refersTo && refKeys.length
      ? await q
          .select({ id: tallyDocuments.id, key: tallyDocuments.documentNoKey, partyKey: tallyDocuments.partyKey, totalPaise: tallyDocuments.totalPaise })
          .from(tallyDocuments)
          .where(and(eq(tallyDocuments.documentType, def.refersTo), inArray(tallyDocuments.documentNoKey, refKeys)))
      : [];
  for (const rec of docs) {
    const hit = byIdentity.get(rec.key);
    const found = findParty(ix, rec.gstin, rec.partyKey);
    const attention: string[] = [];
    let invalid: string | null = null;
    if (!found.id) attention.push(found.ambiguous ? `Several ${label} records match "${rec.partyName}"; it will stay unlinked.` : `"${rec.partyName}" isn't in the ${label}; it will be stored unlinked, with its name.`);
    let refId: string | null = null;
    if (rec.refDocumentNo && def.refersTo) {
      const matches = refs.filter((r) => r.key === documentKey(rec.refDocumentNo!));
      const own = matches.filter((m) => m.partyKey === rec.partyKey);
      const target = TALLY_CATEGORIES[def.refersTo].label;
      if (own.length === 1) {
        refId = own[0]!.id;
        if ((category === "credit-notes" || category === "debit-notes") && rec.totalPaise > own[0]!.totalPaise) attention.push(`The note is larger than ${rec.refDocumentNo} in ${target}.`);
      } else if (own.length > 1) attention.push(`${rec.refDocumentNo} matches several ${target}; it stays unlinked.`);
      else if (matches.length > 0) attention.push(`${rec.refDocumentNo} in ${target} belongs to a different party.`);
      else attention.push(`${rec.refDocumentNo} isn't in ${target} yet.`);
    }
    let state: RecordResolution["existing"] = "none";
    if (hit) {
      const same = hit.totalPaise === rec.totalPaise && hit.documentDate === rec.documentDate && hit.partyKey === rec.partyKey;
      state = same ? "same" : "conflict";
      if (!same) invalid = `Already imported with different details (${hit.documentDate}, ₹${(hit.totalPaise / 100).toFixed(2)}). The existing record is never overwritten.`;
    }
    out.set(rec.key, { existing: state, existingBatchId: hit?.batch ?? null, existingId: hit?.id ?? null, partyId: found.id, refId, collectionCompanyId: null, attention, invalid, note: state === "same" ? "Already imported; skipped." : null });
  }
  return out;
}

/** Validation: the file's rows after the database has had its say. Read-only. */
export async function checkRows(category: TallyCategoryKey, rows: readonly RawRow[], mapping: TallyMapping, opts: PlanOptions) {
  const plan = planRows(category, rows, mapping, opts);
  const resolutions = await resolveRecords(db, category, plan.records, opts.direction ?? null);
  return resolveRows(plan, resolutions);
}

/* ── the import ──────────────────────────────────────────────────────────── */

export type BatchRow = typeof tallyImportBatches.$inferSelect;

export async function savedMapping(category: TallyCategoryKey): Promise<Record<string, string> | null> {
  try {
    const [row] = await db.select({ mapping: tallyColumnMappings.mapping }).from(tallyColumnMappings).where(eq(tallyColumnMappings.category, category)).limit(1);
    return row?.mapping ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function saveMapping(q: Q, category: TallyCategoryKey, mapping: Record<string, string>, actorId: string) {
  await q
    .insert(tallyColumnMappings)
    .values({ category, mapping, updatedById: actorId })
    .onConflictDoUpdate({ target: tallyColumnMappings.category, set: { mapping, updatedById: actorId, updatedAt: new Date() } });
}

export interface StartInput {
  category: TallyCategoryKey;
  fileName: string;
  fileHash: string;
  sheetName: string | null;
  headers: string[];
  mapping: TallyMapping;
  mappingHeadings: Record<string, string>;
  totalRows: number;
  asOfDate: string | null;
  direction: "receivable" | "payable" | null;
  includeAttention: boolean;
}

export type StartResult = { ok: true; batchId: string; resumed: boolean; doneRowNos: number[] } | { ok: false; error: string };

/**
 * Opens a batch, or resumes the unfinished one for this exact file so an
 * interrupted import carries on instead of starting over. A snapshot that was
 * already completed isn't taken twice.
 */
export async function startBatch(input: StartInput, actorId: string): Promise<StartResult> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tally_import'))`);
    const prior = await q.select().from(tallyImportBatches).where(and(eq(tallyImportBatches.category, input.category), eq(tallyImportBatches.fileHash, input.fileHash))).orderBy(desc(tallyImportBatches.createdAt));
    const open = prior.find((b) => b.status !== "completed" && b.asOfDate === input.asOfDate && b.direction === input.direction);
    if (TALLY_CATEGORIES[input.category].kind === "outstanding" && prior.some((b) => b.status === "completed" && b.asOfDate === input.asOfDate && b.direction === input.direction)) {
      return { ok: false as const, error: "This exact file was already imported for that date, so nothing was changed." };
    }
    await saveMapping(q, input.category, input.mappingHeadings, actorId);
    if (open) {
      await tx.update(tallyImportBatches).set({ status: "running", mapping: input.mapping, headers: input.headers, includeAttention: input.includeAttention, completedAt: null }).where(eq(tallyImportBatches.id, open.id));
      const done = await q.select({ rowNo: tallyImportRows.rowNo }).from(tallyImportRows).where(and(eq(tallyImportRows.batchId, open.id), inArray(tallyImportRows.status, ["imported", "skipped", "rejected"])));
      return { ok: true as const, batchId: open.id, resumed: true, doneRowNos: done.map((d) => d.rowNo) };
    }
    const [row] = await tx
      .insert(tallyImportBatches)
      .values({ category: input.category, fileName: input.fileName, fileHash: input.fileHash, sheetName: input.sheetName, headers: input.headers, mapping: input.mapping, asOfDate: input.asOfDate, direction: input.direction, includeAttention: input.includeAttention, totalRows: input.totalRows, createdById: actorId })
      .returning({ id: tallyImportBatches.id });
    return { ok: true as const, batchId: row!.id, resumed: false, doneRowNos: [] };
  });
}

export const getBatch = async (id: string): Promise<BatchRow | null> => (await db.select().from(tallyImportBatches).where(eq(tallyImportBatches.id, id)).limit(1))[0] ?? null;

const nextCustomerCode = async (q: Q): Promise<string> => {
  const rows = await q.execute<{ code: string }>(sql`select lpad(nextval('customer_masters_code_seq')::text, 5, '0') as code`);
  return (rows as unknown as { rows?: { code: string }[] }).rows?.[0]?.code ?? (rows as unknown as { code: string }[])[0]!.code;
};

async function insertRecord(q: Q, rec: TallyRecord, res: RecordResolution, category: TallyCategoryKey, batch: BatchRow, actorId: string, today: string): Promise<{ table: string; id: string } | null> {
  const def = TALLY_CATEGORIES[category];
  if (rec.kind === "party") {
    if (category === "customer-master") {
      const [row] = await q
        .insert(customerMasters)
        .values({ name: rec.name, code: await nextCustomerCode(q), gstin: rec.gstin, panNo: rec.pan, tallyGroup: rec.tallyGroup, phone: rec.phone, email: rec.email, billingAddress: rec.address, state: rec.state, creditPeriodDays: rec.creditDays, notes: `Imported from Tally (batch ${batch.id})`, createdById: actorId })
        .returning({ id: customerMasters.id });
      return { table: "customer_masters", id: row!.id };
    }
    const [row] = await q
      .insert(vendorMasters)
      .values({ name: rec.name, nameKey: rec.nameKey, code: rec.code, gstin: rec.gstin, panNo: rec.pan, tallyGroup: rec.tallyGroup, phone: rec.phone, email: rec.email, address: rec.address, state: rec.state, creditPeriodDays: rec.creditDays, importBatchId: batch.id, createdById: actorId })
      .onConflictDoNothing({ target: vendorMasters.nameKey })
      .returning({ id: vendorMasters.id });
    return row ? { table: "vendor_masters", id: row.id } : null;
  }
  if (rec.kind === "outstanding") {
    const side = rec.direction === "payable" ? { vendorMasterId: res.partyId } : { customerMasterId: res.partyId };
    const [row] = await q
      .insert(tallyOutstandingLines)
      .values({ batchId: batch.id, lineKey: rec.key, direction: rec.direction, asOfDate: rec.asOfDate, partyName: rec.partyName, partyKey: rec.partyKey, ...side, collectionCompanyId: res.collectionCompanyId, billRef: rec.billRef, billDate: rec.billDate, dueDate: rec.dueDate, originalPaise: rec.originalPaise, pendingPaise: rec.pendingPaise, narration: rec.narration, sourceRow: rec.rowNos[0]! })
      .onConflictDoNothing()
      .returning({ id: tallyOutstandingLines.id });
    return row ? { table: "tally_outstanding_lines", id: row.id } : null;
  }
  const side = def.party === "vendor" ? { vendorMasterId: res.partyId } : { customerMasterId: res.partyId };
  const [row] = await q
    .insert(tallyDocuments)
    .values({
      identity: rec.key,
      documentType: rec.documentType,
      documentNo: rec.documentNo,
      documentNoKey: documentKey(rec.documentNo),
      documentDate: rec.documentDate,
      financialYear: rec.financialYear,
      isHistorical: rec.financialYear < financialYear(today),
      partyName: rec.partyName,
      partyKey: rec.partyKey,
      partyGstin: rec.gstin,
      ...side,
      totalPaise: rec.totalPaise,
      taxablePaise: rec.taxablePaise,
      taxPaise: rec.taxPaise,
      refDocumentNo: rec.refDocumentNo,
      refDocumentId: res.refId,
      paymentMode: rec.paymentMode,
      referenceNo: rec.referenceNo,
      adjustmentType: rec.adjustmentType,
      dueDate: rec.dueDate,
      narration: rec.narration,
      lines: rec.lines,
      importBatchId: batch.id,
      sourceRow: rec.rowNos[0]!,
    })
    .onConflictDoNothing({ target: tallyDocuments.identity })
    .returning({ id: tallyDocuments.id });
  return row ? { table: "tally_documents", id: row.id } : null;
}

export interface ChunkCounts {
  imported: number;
  skipped: number;
  rejected: number;
}

/**
 * One chunk, one transaction: the records and their row audit commit together, or
 * neither does, so a dropped connection can't leave a record without its audit.
 * The server plans from the rows and the batch's own stored mapping, not from
 * anything the browser concluded. Safe to repeat.
 */
export async function importChunk(batch: BatchRow, rows: readonly RawRow[], actorId: string, today: string): Promise<ChunkCounts> {
  const category = batch.category as TallyCategoryKey;
  const counts: ChunkCounts = { imported: 0, skipped: 0, rejected: 0 };
  await db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tally_import'))`);
    const plan = planRows(category, rows, batch.mapping, { asOfDate: batch.asOfDate, direction: batch.direction, today });
    const resolutions = await resolveRecords(q, category, plan.records, batch.direction);
    const decisions = importDecisions(plan, resolutions, batch.includeAttention, batch.id);
    const target = new Map<string, { table: string; id: string } | null>();
    for (const rec of plan.records) {
      const d = decisions.records.get(rec.key);
      if (d === "insert") target.set(rec.key, await insertRecord(q, rec, resolutions.get(rec.key)!, category, batch, actorId, today));
    }
    const cellsOf = new Map(rows.map((r) => [r.rowNo, r.cells]));
    for (const row of decisions.rows) {
      let status: TallyImportRowStatus = row.status;
      let reason = row.reason;
      const inserted = row.recordKey ? target.get(row.recordKey) : undefined;
      if (status === "imported" && row.recordKey && target.has(row.recordKey) && !inserted) {
        status = "skipped";
        reason = "Another import added this record first.";
      }
      const existingId = row.recordKey ? (resolutions.get(row.recordKey)?.existingId ?? null) : null;
      const res = await tx
        .insert(tallyImportRows)
        .values({ batchId: batch.id, rowNo: row.rowNo, status, reason, targetTable: inserted?.table ?? null, targetId: inserted?.id ?? existingId, cells: cellsOf.get(row.rowNo) ?? [] })
        .onConflictDoUpdate({ target: [tallyImportRows.batchId, tallyImportRows.rowNo], set: { status, reason, targetTable: inserted?.table ?? null, targetId: inserted?.id ?? existingId }, where: eq(tallyImportRows.status, "failed") })
        .returning({ id: tallyImportRows.id });
      if (res.length) counts[status === "failed" ? "rejected" : status]++;
    }
  });
  return counts;
}

/** A chunk that wouldn't commit: its rows are recorded as failed, to be retried by resuming the file. */
export async function recordChunkFailure(batch: BatchRow, rows: readonly RawRow[], reason: string): Promise<void> {
  for (const r of rows) {
    await db.insert(tallyImportRows).values({ batchId: batch.id, rowNo: r.rowNo, status: "failed", reason, cells: r.cells }).onConflictDoNothing();
  }
}

/** Counts always come from the rows actually recorded, so the history can't disagree with the database. */
export async function finishBatch(batchId: string, today: string): Promise<BatchRow> {
  const counts = await db.select({ status: tallyImportRows.status, n: sql<number>`count(*)::int` }).from(tallyImportRows).where(eq(tallyImportRows.batchId, batchId)).groupBy(tallyImportRows.status);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const [batch] = await db.select().from(tallyImportBatches).where(eq(tallyImportBatches.id, batchId));
  const recorded = counts.reduce((a, c) => a + c.n, 0);
  const missing = Math.max(0, batch!.totalRows - recorded);
  const failed = n("failed") + missing;
  const [range] = await db
    .select({ from: sql<string | null>`min(${tallyDocuments.documentDate})`, to: sql<string | null>`max(${tallyDocuments.documentDate})`, years: sql<string[] | null>`array_agg(distinct ${tallyDocuments.financialYear})` })
    .from(tallyDocuments)
    .where(eq(tallyDocuments.importBatchId, batchId));
  const years = (range?.years ?? []).filter(Boolean).sort();
  const status = failed === 0 ? "completed" : n("imported") + n("skipped") === 0 ? "failed" : "partial";
  const [row] = await db
    .update(tallyImportBatches)
    .set({
      status,
      importedRows: n("imported"),
      skippedRows: n("skipped"),
      rejectedRows: n("rejected"),
      failedRows: failed,
      periodFrom: range?.from ?? batch!.asOfDate,
      periodTo: range?.to ?? batch!.asOfDate,
      financialYears: years,
      isHistorical: years.length > 0 && years.every((y) => y < financialYear(today)),
      completedAt: new Date(),
    })
    .where(eq(tallyImportBatches.id, batchId))
    .returning();
  return row!;
}

/* ── history ─────────────────────────────────────────────────────────────── */

export interface HistoryRow extends BatchRow {
  uploadedBy: string | null;
}

export async function listHistory(limit = 50): Promise<{ storageReady: boolean; rows: HistoryRow[] }> {
  try {
    const rows = await db
      .select({ batch: tallyImportBatches, uploadedBy: employees.name })
      .from(tallyImportBatches)
      .leftJoin(employees, eq(employees.id, tallyImportBatches.createdById))
      .orderBy(desc(tallyImportBatches.createdAt))
      .limit(limit);
    return { storageReady: true, rows: rows.map((r) => ({ ...r.batch, uploadedBy: r.uploadedBy })) };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [] };
    throw err;
  }
}

/** The rows that didn't import, with their reasons. */
export async function batchProblems(batchId: string, limit = 500) {
  return db
    .select({ rowNo: tallyImportRows.rowNo, status: tallyImportRows.status, reason: tallyImportRows.reason })
    .from(tallyImportRows)
    .where(and(eq(tallyImportRows.batchId, batchId), inArray(tallyImportRows.status, ["skipped", "rejected", "failed"])))
    .orderBy(tallyImportRows.rowNo)
    .limit(limit);
}

/* ── read-only feeds for other modules ───────────────────────────────────── */

/**
 * Bills from the newest COMPLETED receivable snapshot. A partial import never
 * becomes the live position. Older snapshots stay stored and are not summed.
 */
export async function latestReceivableLines(companyIds: readonly string[]) {
  if (companyIds.length === 0) return [];
  const [latest] = await db
    .select({ id: tallyImportBatches.id })
    .from(tallyImportBatches)
    .where(and(eq(tallyImportBatches.category, "outstanding-balances"), eq(tallyImportBatches.direction, "receivable"), eq(tallyImportBatches.status, "completed")))
    .orderBy(desc(tallyImportBatches.asOfDate), desc(tallyImportBatches.completedAt))
    .limit(1);
  if (!latest) return [];
  return db.select().from(tallyOutstandingLines).where(and(eq(tallyOutstandingLines.batchId, latest.id), inArray(tallyOutstandingLines.collectionCompanyId, [...companyIds])));
}

/**
 * Tally's sales-side vouchers for the Incentive Tracker to read. Read-only and
 * deliberately not wired into any calculation: incentive rules stay where they
 * are, and nothing here touches sales_orders, invoices or receipts.
 */
export async function listIncentiveFeed(from: string, to: string) {
  return db
    .select({
      id: tallyDocuments.id,
      documentType: tallyDocuments.documentType,
      documentNo: tallyDocuments.documentNo,
      documentDate: tallyDocuments.documentDate,
      financialYear: tallyDocuments.financialYear,
      customerMasterId: tallyDocuments.customerMasterId,
      partyName: tallyDocuments.partyName,
      totalPaise: tallyDocuments.totalPaise,
      taxablePaise: tallyDocuments.taxablePaise,
      refDocumentId: tallyDocuments.refDocumentId,
    })
    .from(tallyDocuments)
    .where(and(inArray(tallyDocuments.documentType, ["sales-orders", "sales-invoices", "credit-notes", "customer-receipts"]), sql`${tallyDocuments.documentDate} between ${from} and ${to}`))
    .orderBy(tallyDocuments.documentDate);
}
