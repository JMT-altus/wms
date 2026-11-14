import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrderPreclosures, tallyDocuments } from "@/db/schema";
import { isMissingTable } from "@/lib/queries/collection-master";
import { loadSalesOrderCatalogue } from "@/lib/queries/sales-order-fields";
import { checkPreClose, type PreCloseInput, type PreClosure } from "@/lib/tally/sales-order-preclose";

/**
 * Sales Order pre-closures (migration 0129): reading them for the order page and recording a new one. Nothing here
 * authorizes — the caller holds the permission (lib/auth/sales-order-preclose.ts) — and nothing here ever changes a
 * stored order or an earlier pre-closure (the database refuses that too).
 *
 * Without migration 0129 the table doesn't exist: the order page says pre-closing isn't available yet, and recording
 * says the update is needed.
 */

type Q = typeof db;

/** Whether migration 0129's table exists — asked in a way that can't fail, so it is safe inside a transaction. */
async function tableExists(q: Q): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.sales_order_preclosures') is not null as ok`);
  const rows = (Array.isArray(r) ? r : ((r as unknown as { rows?: unknown[] }).rows ?? [])) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

const COLUMNS = {
  id: salesOrderPreclosures.id,
  lineNo: salesOrderPreclosures.lineNo,
  allocationNo: salesOrderPreclosures.allocationNo,
  quantity: salesOrderPreclosures.quantity,
  reason: salesOrderPreclosures.reason,
  precloseDate: salesOrderPreclosures.precloseDate,
  recordedBy: salesOrderPreclosures.recordedByName,
  recordedAt: salesOrderPreclosures.recordedAt,
  requestId: salesOrderPreclosures.requestId,
  documentId: salesOrderPreclosures.documentId,
};
type Row = { id: string; lineNo: number; allocationNo: number; quantity: string; reason: string | null; precloseDate: string; recordedBy: string; recordedAt: Date };
const toPreClosure = (r: Row): PreClosure => ({ id: r.id, lineNo: r.lineNo, allocationNo: r.allocationNo, quantity: Number(r.quantity), reason: r.reason, precloseDate: r.precloseDate, recordedBy: r.recordedBy, recordedAt: r.recordedAt.toISOString() });

export interface PreClosureLoad {
  /** False while migration 0129 isn't applied. */
  ready: boolean;
  records: PreClosure[];
}

/** An order's pre-closures, oldest first. */
export async function listPreClosures(documentId: string, q: Q = db): Promise<PreClosureLoad> {
  if (!(await tableExists(q))) return { ready: false, records: [] };
  try {
    const rows = await q.select(COLUMNS).from(salesOrderPreclosures).where(eq(salesOrderPreclosures.documentId, documentId)).orderBy(asc(salesOrderPreclosures.recordedAt), asc(salesOrderPreclosures.id));
    return { ready: true, records: rows.map(toPreClosure) };
  } catch (err) {
    if (isMissingTable(err)) return { ready: false, records: [] };
    throw err;
  }
}

export type PreCloseResult = { ok: true; record: PreClosure; repeated: boolean } | { ok: false; error: string };
export const PRECLOSE_NOT_READY = "Pre-closing a delivery needs database update 0129 first, so nothing was recorded.";

/**
 * Records one pre-closure. One transaction, holding the order's row:
 *   - a submission already recorded (the same request id) is answered with what was recorded, never recorded twice;
 *   - the submission is checked against the order and its pre-closures as they are NOW (checkPreClose), including
 *     that nobody pre-closed the delivery since the screen showed it;
 *   - the row is inserted with who and when; the database checks it once more against the stored order.
 */
export async function recordPreClosure(actor: { id: string; name: string }, documentId: string, requestId: string, input: PreCloseInput, today: string): Promise<PreCloseResult> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    if (!(await tableExists(q))) return { ok: false as const, error: PRECLOSE_NOT_READY };
    const [order] = await q
      .select({ id: tallyDocuments.id, documentDate: tallyDocuments.documentDate, lines: tallyDocuments.lines, details: tallyDocuments.details })
      .from(tallyDocuments)
      .where(and(eq(tallyDocuments.id, documentId), eq(tallyDocuments.documentType, "sales-orders")))
      .for("update")
      .limit(1);
    if (!order) return { ok: false as const, error: "That Sales Order doesn't exist." };

    const [already] = await q.select(COLUMNS).from(salesOrderPreclosures).where(eq(salesOrderPreclosures.requestId, requestId)).limit(1);
    if (already) {
      if (already.documentId !== documentId || already.lineNo !== input.lineNo || already.allocationNo !== input.allocationNo) return { ok: false as const, error: "That submission was already used for another delivery. Nothing was recorded." };
      return { ok: true as const, record: toPreClosure(already), repeated: true };
    }

    const existing = await q.select(COLUMNS).from(salesOrderPreclosures).where(eq(salesOrderPreclosures.documentId, documentId));
    const { catalogue } = await loadSalesOrderCatalogue(q);
    const details = order.details as { states?: { cancelled?: boolean } };
    const check = checkPreClose({ documentDate: order.documentDate, cancelled: details.states?.cancelled === true, lines: order.lines }, existing.map(toPreClosure), input, today, catalogue);
    if (!check.ok) return { ok: false as const, error: check.errors.join(" ") };

    const [row] = await q
      .insert(salesOrderPreclosures)
      .values({
        documentId,
        lineNo: check.delivery.lineNo,
        allocationNo: check.delivery.allocationNo,
        item: check.delivery.item,
        dueDate: check.delivery.dueDate,
        orderedQuantity: String(check.delivery.quantity),
        quantity: String(check.quantity),
        reason: check.reason,
        precloseDate: check.date,
        requestId,
        recordedById: actor.id,
        recordedByName: actor.name,
      })
      .returning(COLUMNS);
    return { ok: true as const, record: toPreClosure(row!), repeated: false };
  });
}
