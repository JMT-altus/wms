import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMasters,
  employees,
  incentiveCalcAttributions,
  incentiveCalcInputHistory,
  incentiveCalcReceiptEvents,
  incentiveCalcRepHistory,
  incentiveConfigVersions,
  tallyDocuments,
} from "@/db/schema";
import { loadConfig } from "@/lib/queries/incentive-rules";
import { isDay } from "@/lib/incentives/rules-config/validate";
import type { EligibilityRow } from "@/lib/incentives/rules-config/spec";
import { incentiveCalcReady, CALC_NOT_READY, type Actor, type Result } from "@/lib/queries/incentive-calc";

/**
 * Category A inputs that Tally's import can't give, kept in the WMS and referring to Forms' own records (migrations
 * 0132 + 0133): the salespeople of an order, a customer's representative over time, and receipt events. Nothing here
 * copies or changes a Forms document. A row is never edited or deleted: a correction RETIRES it (who, when, why) and
 * records a new one; every record and retirement is written to incentive_calc_input_history in the same transaction.
 * The database refuses overlaps, over-allocation and wrong document kinds whatever calls it (0133's triggers).
 * Nothing here authorizes: the server actions hold the rights.
 */

type Q = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const D = (x: unknown) => (x === null || x === undefined ? null : String(x).slice(0, 10));
const clean = (s: string | null | undefined, max = 1000) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function history(tx: Tx, actor: Actor, entity: "attribution" | "rep-history" | "receipt-event", entityId: string, action: "record" | "retire", before: unknown, after: unknown, note: string | null) {
  await tx.insert(incentiveCalcInputHistory).values({ entity, entityId, action, before: before ?? null, after: after ?? null, note, actorId: actor.id, actorName: actor.name });
}

export async function inputHistory(entity: "attribution" | "rep-history" | "receipt-event", entityIds: string[], q: Q = db) {
  if (!entityIds.length) return [];
  return q.select().from(incentiveCalcInputHistory).where(and(eq(incentiveCalcInputHistory.entity, entity), inArray(incentiveCalcInputHistory.entityId, entityIds))).orderBy(asc(incentiveCalcInputHistory.eventNo));
}

/* ── eligibility against the published configuration ─────────────────── */

/** Every published Category A version in force on `day`, with its configuration. */
async function versionsInForce(q: Q | Tx, day: string) {
  const vs = await q
    .select()
    .from(incentiveConfigVersions)
    .where(and(eq(incentiveConfigVersions.categoryCode, "A"), eq(incentiveConfigVersions.status, "published"), sql`${incentiveConfigVersions.effectiveFrom} <= ${day}::date and (${incentiveConfigVersions.effectiveTo} is null or ${incentiveConfigVersions.effectiveTo} >= ${day}::date)`));
  return Promise.all(vs.map(async (v) => ({ version: v, config: await loadConfig(q as Q, v.id) })));
}

const covers = (r: EligibilityRow, day: string) => r.effectiveFrom <= day && (r.effectiveTo === null || r.effectiveTo >= day);
function eligibleUnder(rows: readonly EligibilityRow[], e: { id: string; role: string; departmentId: string | null }, day: string) {
  const match = (r: EligibilityRow) => (r.subjectType === "employee" ? r.subjectId === e.id : r.subjectType === "department" ? r.subjectId !== null && r.subjectId === e.departmentId : r.role === e.role);
  return rows.some((r) => r.mode === "include" && match(r) && covers(r, day)) && !rows.some((r) => r.mode === "exclude" && match(r) && covers(r, day));
}

/* ── A. order salespeople ─────────────────────────────────────────────── */

export interface OrderRow {
  id: string;
  documentNo: string;
  documentDate: string;
  customerName: string;
  customerId: string | null;
  totalPaise: number;
  cancelled: boolean;
  attributions: { id: string; employeeId: string; employeeName: string; sharePpm: number; note: string | null; createdAt: string; createdByName: string | null }[];
  retired: { id: string; employeeName: string; sharePpm: number; retiredAt: string; retiredReason: string | null }[];
  status: "none" | "partial" | "complete";
}

/** Forms Sales Orders with their salespeople. `filter`: all, needing a salesperson, or attributed. */
export async function listOrderSalespeople(opts: { search?: string; filter?: "all" | "missing" | "attributed"; from?: string | null; to?: string | null; limit?: number }, q: Q = db): Promise<{ ready: boolean; rows: OrderRow[]; truncated: boolean }> {
  if (!(await incentiveCalcReady(q))) return { ready: false, rows: [], truncated: false };
  const limit = Math.min(opts.limit ?? 200, 500);
  const search = (opts.search ?? "").trim();
  const where = [eq(tallyDocuments.documentType, "sales-orders")];
  if (search) where.push(or(ilike(tallyDocuments.documentNo, like(search)), ilike(tallyDocuments.partyName, like(search)))!);
  if (opts.from && isDay(opts.from)) where.push(sql`${tallyDocuments.documentDate} >= ${opts.from}::date`);
  if (opts.to && isDay(opts.to)) where.push(sql`${tallyDocuments.documentDate} <= ${opts.to}::date`);
  const active = sql`(select coalesce(sum(a.share_ppm), 0) from incentive_calc_attributions a where a.document_id = ${tallyDocuments.id} and a.retired_at is null)`;
  if (opts.filter === "missing") where.push(sql`${active} < 1000000`);
  if (opts.filter === "attributed") where.push(sql`${active} > 0`);
  const docs = await q
    .select({ id: tallyDocuments.id, documentNo: tallyDocuments.documentNo, documentDate: tallyDocuments.documentDate, partyName: tallyDocuments.partyName, customerId: tallyDocuments.customerMasterId, totalPaise: tallyDocuments.totalPaise, details: tallyDocuments.details, customerName: customerMasters.name })
    .from(tallyDocuments)
    .leftJoin(customerMasters, eq(customerMasters.id, tallyDocuments.customerMasterId))
    .where(and(...where))
    .orderBy(desc(tallyDocuments.documentDate), desc(tallyDocuments.documentNo))
    .limit(limit + 1);
  const ids = docs.slice(0, limit).map((d) => d.id);
  const rows = ids.length
    ? await q
        .select({ a: incentiveCalcAttributions, employeeName: employees.name })
        .from(incentiveCalcAttributions)
        .innerJoin(employees, eq(employees.id, incentiveCalcAttributions.employeeId))
        .where(inArray(incentiveCalcAttributions.documentId, ids))
        .orderBy(asc(incentiveCalcAttributions.createdAt))
    : [];
  const creatorIds = [...new Set(rows.map((r) => r.a.createdById).filter((x): x is string => !!x))];
  const creators = new Map(creatorIds.length ? (await q.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, creatorIds))).map((e) => [e.id, e.name]) : []);
  return {
    ready: true,
    truncated: docs.length > limit,
    rows: docs.slice(0, limit).map((d) => {
      const mine = rows.filter((r) => r.a.documentId === d.id);
      const activeRows = mine.filter((r) => !r.a.retiredAt);
      const total = activeRows.reduce((s, r) => s + r.a.sharePpm, 0);
      return {
        id: d.id,
        documentNo: d.documentNo,
        documentDate: D(d.documentDate)!,
        customerName: d.customerName ?? d.partyName,
        customerId: d.customerId,
        totalPaise: Number(d.totalPaise),
        cancelled: !!(d.details as { states?: { cancelled?: boolean } } | null)?.states?.cancelled,
        attributions: activeRows.map((r) => ({ id: r.a.id, employeeId: r.a.employeeId, employeeName: r.employeeName, sharePpm: r.a.sharePpm, note: r.a.note, createdAt: r.a.createdAt.toISOString(), createdByName: creators.get(r.a.createdById ?? "") ?? null })),
        retired: mine.filter((r) => r.a.retiredAt).map((r) => ({ id: r.a.id, employeeName: r.employeeName, sharePpm: r.a.sharePpm, retiredAt: r.a.retiredAt!.toISOString(), retiredReason: r.a.retiredReason })),
        status: total === 0 ? "none" : total < 1_000_000 ? "partial" : "complete",
      };
    }),
  };
}

/** Salespeople who may be chosen: active employees (eligibility is checked when recording, against the order's date). */
export async function salespeopleChoices(q: Q = db) {
  return q.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.isActive, true)).orderBy(asc(employees.name));
}

export async function recordAttribution(actor: Actor, input: { documentId: string; employeeId: string; sharePpm: number; note: string | null }): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.documentId) || !UUID.test(input.employeeId)) return { ok: false, error: "Choose an order and a salesperson." };
  if (!Number.isSafeInteger(input.sharePpm) || input.sharePpm < 1 || input.sharePpm > 1_000_000) return { ok: false, error: "The share must be more than 0% and at most 100%." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(tallyDocuments).where(eq(tallyDocuments.id, input.documentId));
    if (!doc || doc.documentType !== "sales-orders") return { ok: false as const, error: "That isn't a Forms Sales Order." };
    const [emp] = await tx.select().from(employees).where(eq(employees.id, input.employeeId));
    if (!emp || !emp.isActive) return { ok: false as const, error: "Choose an active employee." };
    const day = D(doc.documentDate)!;
    const versions = await versionsInForce(tx, day);
    if (!versions.length) return { ok: false as const, error: `No published Category A configuration covers ${day}, so the salesperson's eligibility can't be checked. Publish one first (Incentive Rules).` };
    if (!versions.some((v) => eligibleUnder(v.config.eligibility, emp, day))) return { ok: false as const, error: `${emp.name} isn't included in Salesperson Eligibility on ${day} in any published Category A configuration.` };
    const current = await tx.select().from(incentiveCalcAttributions).where(and(eq(incentiveCalcAttributions.documentId, doc.id), isNull(incentiveCalcAttributions.retiredAt)));
    if (current.some((c) => c.employeeId === emp.id)) return { ok: false as const, error: `${emp.name} is already recorded for this order. Retire that record first to change the share.` };
    // Where every configuration in force allows one salesperson per order, a split can't be recorded.
    const single = versions.every((v) => v.config.settings["attribution.split"] !== "splitByShares");
    if (single && (input.sharePpm !== 1_000_000 || current.length)) return { ok: false as const, error: "The configuration in force allows one salesperson per order, at 100%." };
    const [row] = await tx.insert(incentiveCalcAttributions).values({ documentId: doc.id, employeeId: emp.id, sharePpm: input.sharePpm, note: clean(input.note), createdById: actor.id }).returning();
    await history(tx, actor, "attribution", row!.id, "record", null, { documentId: doc.id, documentNo: doc.documentNo, employeeId: emp.id, employeeName: emp.name, sharePpm: input.sharePpm }, clean(input.note));
    return { ok: true as const, id: row!.id };
  });
}

/* ── shared: retiring ─────────────────────────────────────────────────── */

const RETIRABLE = {
  attribution: incentiveCalcAttributions,
  "rep-history": incentiveCalcRepHistory,
  "receipt-event": incentiveCalcReceiptEvents,
} as const;

export async function retireInput(actor: Actor, entity: keyof typeof RETIRABLE, id: string, reason: string): Promise<Result> {
  const why = clean(reason);
  if (!UUID.test(id)) return { ok: false, error: "That record doesn't exist." };
  if (!why) return { ok: false, error: "Say why it is retired." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  const t = RETIRABLE[entity];
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t).where(eq(t.id, id)).for("update");
    if (!row) return { ok: false as const, error: "That record doesn't exist." };
    if (row.retiredAt) return { ok: false as const, error: "It was already retired." };
    const [after] = await tx.update(t).set({ retiredAt: new Date(), retiredById: actor.id, retiredReason: why }).where(eq(t.id, id)).returning();
    await history(tx, actor, entity, id, "retire", row, after, why);
    return { ok: true as const };
  });
}

/* ── B. representative history ────────────────────────────────────────── */

export interface CustomerRepRow {
  id: string;
  name: string;
  code: string | null;
  currentRepName: string | null;
  periods: { id: string; employeeId: string; employeeName: string; from: string; to: string | null; note: string | null; createdAt: string; retiredAt: string | null; retiredReason: string | null }[];
}

export async function listCustomerReps(opts: { search?: string; filter?: "all" | "missing" | "recorded"; limit?: number }, q: Q = db): Promise<{ ready: boolean; rows: CustomerRepRow[]; truncated: boolean }> {
  if (!(await incentiveCalcReady(q))) return { ready: false, rows: [], truncated: false };
  const limit = Math.min(opts.limit ?? 200, 500);
  const search = (opts.search ?? "").trim();
  const where = [eq(customerMasters.isActive, true)];
  if (search) where.push(or(ilike(customerMasters.name, like(search)), ilike(customerMasters.code, like(search)))!);
  const has = sql`exists (select 1 from incentive_calc_rep_history r where r.customer_master_id = ${customerMasters.id} and r.retired_at is null)`;
  if (opts.filter === "missing") where.push(sql`not ${has}`);
  if (opts.filter === "recorded") where.push(has);
  const custs = await q.select({ id: customerMasters.id, name: customerMasters.name, code: customerMasters.code, salesRepId: customerMasters.salesRepId }).from(customerMasters).where(and(...where)).orderBy(asc(customerMasters.name)).limit(limit + 1);
  const shown = custs.slice(0, limit);
  const ids = shown.map((c) => c.id);
  const periods = ids.length ? await q.select({ r: incentiveCalcRepHistory, employeeName: employees.name }).from(incentiveCalcRepHistory).innerJoin(employees, eq(employees.id, incentiveCalcRepHistory.employeeId)).where(inArray(incentiveCalcRepHistory.customerMasterId, ids)).orderBy(asc(incentiveCalcRepHistory.effectiveFrom)) : [];
  const repIds = [...new Set(shown.map((c) => c.salesRepId).filter((x): x is string => !!x))];
  const reps = new Map(repIds.length ? (await q.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, repIds))).map((e) => [e.id, e.name]) : []);
  return {
    ready: true,
    truncated: custs.length > limit,
    rows: shown.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      currentRepName: c.salesRepId ? (reps.get(c.salesRepId) ?? null) : null,
      periods: periods
        .filter((p) => p.r.customerMasterId === c.id)
        .map((p) => ({ id: p.r.id, employeeId: p.r.employeeId, employeeName: p.employeeName, from: D(p.r.effectiveFrom)!, to: D(p.r.effectiveTo), note: p.r.note, createdAt: p.r.createdAt.toISOString(), retiredAt: p.r.retiredAt ? p.r.retiredAt.toISOString() : null, retiredReason: p.r.retiredReason })),
    })),
  };
}

export async function recordRepPeriod(actor: Actor, input: { customerId: string; employeeId: string; from: string; to: string | null; note: string | null }): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.customerId) || !UUID.test(input.employeeId)) return { ok: false, error: "Choose a customer and a representative." };
  if (!isDay(input.from) || (input.to !== null && (!isDay(input.to) || input.to < input.from))) return { ok: false, error: "Give a start date, and an end date on or after it (or none)." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const [cust] = await tx.select().from(customerMasters).where(eq(customerMasters.id, input.customerId));
    if (!cust) return { ok: false as const, error: "That customer isn't in the Customer Master." };
    const [emp] = await tx.select().from(employees).where(eq(employees.id, input.employeeId));
    if (!emp) return { ok: false as const, error: "That employee doesn't exist." };
    const [row] = await tx.insert(incentiveCalcRepHistory).values({ customerMasterId: cust.id, employeeId: emp.id, effectiveFrom: input.from, effectiveTo: input.to, note: clean(input.note), createdById: actor.id }).returning();
    await history(tx, actor, "rep-history", row!.id, "record", null, { customerId: cust.id, customerName: cust.name, employeeId: emp.id, employeeName: emp.name, from: input.from, to: input.to }, clean(input.note));
    return { ok: true as const, id: row!.id };
  });
}

/* ── C. receipt events ────────────────────────────────────────────────── */

export const EVENT_KINDS = ["allocation", "refund", "bounced", "reversed", "hold", "salesReturn"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface ReceiptRow {
  id: string;
  documentType: "customer-receipts" | "credit-notes";
  documentNo: string;
  documentDate: string;
  customerName: string;
  customerId: string | null;
  totalPaise: number;
  refId: string | null;
  refNo: string | null;
  events: { id: string; kind: EventKind; invoiceId: string | null; invoiceNo: string | null; amountPaise: number | null; eventDate: string; note: string | null; createdAt: string; createdByName: string | null; retiredAt: string | null; retiredReason: string | null }[];
}

/** Customer Receipts (and Credit Notes, for sales returns) with their events. */
export async function listReceiptEvents(opts: { search?: string; filter?: "all" | "onAccount" | "withEvents" | "held" | "creditNotes"; limit?: number }, q: Q = db): Promise<{ ready: boolean; rows: ReceiptRow[]; truncated: boolean }> {
  if (!(await incentiveCalcReady(q))) return { ready: false, rows: [], truncated: false };
  const limit = Math.min(opts.limit ?? 200, 500);
  const search = (opts.search ?? "").trim();
  const types = opts.filter === "creditNotes" ? ["credit-notes"] : opts.filter === "all" || !opts.filter ? ["customer-receipts", "credit-notes"] : ["customer-receipts"];
  const where = [inArray(tallyDocuments.documentType, types)];
  if (search) where.push(or(ilike(tallyDocuments.documentNo, like(search)), ilike(tallyDocuments.partyName, like(search)), ilike(tallyDocuments.refDocumentNo, like(search)))!);
  if (opts.filter === "onAccount") where.push(isNull(tallyDocuments.refDocumentId));
  if (opts.filter === "withEvents") where.push(sql`exists (select 1 from incentive_calc_receipt_events e where e.document_id = ${tallyDocuments.id})`);
  if (opts.filter === "held") where.push(sql`exists (select 1 from incentive_calc_receipt_events e where e.document_id = ${tallyDocuments.id} and e.kind = 'hold' and e.retired_at is null)`);
  const docs = await q
    .select({ id: tallyDocuments.id, documentType: tallyDocuments.documentType, documentNo: tallyDocuments.documentNo, documentDate: tallyDocuments.documentDate, partyName: tallyDocuments.partyName, customerId: tallyDocuments.customerMasterId, totalPaise: tallyDocuments.totalPaise, refId: tallyDocuments.refDocumentId, refNo: tallyDocuments.refDocumentNo, customerName: customerMasters.name })
    .from(tallyDocuments)
    .leftJoin(customerMasters, eq(customerMasters.id, tallyDocuments.customerMasterId))
    .where(and(...where))
    .orderBy(desc(tallyDocuments.documentDate), desc(tallyDocuments.documentNo))
    .limit(limit + 1);
  const shown = docs.slice(0, limit);
  const ids = shown.map((d) => d.id);
  const evs = ids.length ? await q.select().from(incentiveCalcReceiptEvents).where(inArray(incentiveCalcReceiptEvents.documentId, ids)).orderBy(asc(incentiveCalcReceiptEvents.createdAt)) : [];
  const invIds = [...new Set(evs.map((e) => e.invoiceDocumentId).filter((x): x is string => !!x))];
  const invNos = new Map(invIds.length ? (await q.select({ id: tallyDocuments.id, no: tallyDocuments.documentNo }).from(tallyDocuments).where(inArray(tallyDocuments.id, invIds))).map((d) => [d.id, d.no]) : []);
  const creatorIds = [...new Set(evs.map((e) => e.createdById).filter((x): x is string => !!x))];
  const creators = new Map(creatorIds.length ? (await q.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, creatorIds))).map((e) => [e.id, e.name]) : []);
  return {
    ready: true,
    truncated: docs.length > limit,
    rows: shown.map((d) => ({
      id: d.id,
      documentType: d.documentType as ReceiptRow["documentType"],
      documentNo: d.documentNo,
      documentDate: D(d.documentDate)!,
      customerName: d.customerName ?? d.partyName,
      customerId: d.customerId,
      totalPaise: Number(d.totalPaise),
      refId: d.refId,
      refNo: d.refNo,
      events: evs
        .filter((e) => e.documentId === d.id)
        .map((e) => ({ id: e.id, kind: e.kind as EventKind, invoiceId: e.invoiceDocumentId, invoiceNo: e.invoiceDocumentId ? (invNos.get(e.invoiceDocumentId) ?? null) : null, amountPaise: e.amountPaise === null ? null : Number(e.amountPaise), eventDate: D(e.eventDate)!, note: e.note, createdAt: e.createdAt.toISOString(), createdByName: creators.get(e.createdById ?? "") ?? null, retiredAt: e.retiredAt ? e.retiredAt.toISOString() : null, retiredReason: e.retiredReason })),
    })),
  };
}

/** The customer's Forms Sales Invoices a receipt can be allocated to (oldest first). */
export async function invoicesOfCustomer(customerId: string, q: Q = db) {
  if (!UUID.test(customerId)) return [];
  const rows = await q.select({ id: tallyDocuments.id, no: tallyDocuments.documentNo, date: tallyDocuments.documentDate, totalPaise: tallyDocuments.totalPaise }).from(tallyDocuments).where(and(eq(tallyDocuments.documentType, "sales-invoices"), eq(tallyDocuments.customerMasterId, customerId))).orderBy(asc(tallyDocuments.documentDate), asc(tallyDocuments.documentNo)).limit(500);
  return rows.map((r) => ({ id: r.id, no: r.no, date: D(r.date)!, totalPaise: Number(r.totalPaise) }));
}

export async function recordReceiptEvent(actor: Actor, input: { documentId: string; kind: EventKind; invoiceId: string | null; amountPaise: number | null; eventDate: string; note: string | null }): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.documentId) || !(EVENT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "Choose a document and what happened." };
  if (!isDay(input.eventDate)) return { ok: false, error: "Give the date it happened." };
  const needsAmount = input.kind === "refund" || input.kind === "allocation";
  if (needsAmount && (!Number.isSafeInteger(input.amountPaise) || (input.amountPaise ?? 0) <= 0)) return { ok: false, error: "Give an amount of more than ₹0." };
  if (input.kind === "allocation" && (!input.invoiceId || !UUID.test(input.invoiceId))) return { ok: false, error: "Choose the invoice it is allocated to." };
  if ((input.kind === "hold" || input.kind === "reversed" || input.kind === "bounced") && !clean(input.note)) return { ok: false, error: "Say why (a note is required)." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(tallyDocuments).where(eq(tallyDocuments.id, input.documentId));
    if (!doc) return { ok: false as const, error: "That document isn't in Forms." };
    if (input.eventDate < D(doc.documentDate)!) return { ok: false as const, error: "It can't have happened before the document's own date." };
    if (input.kind === "allocation") {
      const [inv] = await tx.select().from(tallyDocuments).where(eq(tallyDocuments.id, input.invoiceId!));
      if (!inv || inv.documentType !== "sales-invoices") return { ok: false as const, error: "Choose a Forms Sales Invoice." };
      if (doc.customerMasterId && inv.customerMasterId && inv.customerMasterId !== doc.customerMasterId) return { ok: false as const, error: "The invoice belongs to another customer." };
    }
    const [row] = await tx.insert(incentiveCalcReceiptEvents).values({ documentId: doc.id, kind: input.kind, invoiceDocumentId: input.kind === "allocation" ? input.invoiceId : null, amountPaise: needsAmount ? input.amountPaise : null, eventDate: input.eventDate, note: clean(input.note), createdById: actor.id }).returning();
    await history(tx, actor, "receipt-event", row!.id, "record", null, { documentId: doc.id, documentNo: doc.documentNo, kind: input.kind, invoiceId: row!.invoiceDocumentId, amountPaise: row!.amountPaise, eventDate: input.eventDate }, clean(input.note));
    return { ok: true as const, id: row!.id };
  });
}

/** For a Forms Sales Order's page: its salespeople (active and retired). */
export async function orderSalespeople(documentId: string, q: Q = db) {
  if (!UUID.test(documentId) || !(await incentiveCalcReady(q))) return null;
  const rows = await q.select({ a: incentiveCalcAttributions, employeeName: employees.name }).from(incentiveCalcAttributions).innerJoin(employees, eq(employees.id, incentiveCalcAttributions.employeeId)).where(eq(incentiveCalcAttributions.documentId, documentId)).orderBy(asc(incentiveCalcAttributions.createdAt));
  return rows.map((r) => ({ id: r.a.id, employeeName: r.employeeName, sharePpm: r.a.sharePpm, active: !r.a.retiredAt, retiredReason: r.a.retiredReason }));
}
