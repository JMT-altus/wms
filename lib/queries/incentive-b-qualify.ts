import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, incentiveCalcBOverrides, incentiveCalcBQualifications, incentiveCalcInputHistory, incentiveCalcPeriods, incentiveCalcRuns, incentivePrograms, tallyDocuments } from "@/db/schema";
import type { CategoryBResult } from "@/lib/incentives/category-b/types";
import { incentiveCalcBReady, CALC_B_NOT_READY } from "@/lib/queries/incentive-calc-b";
import type { Actor, Result } from "@/lib/queries/incentive-calc";

/**
 * Category B — the review queue and an authorised admin's manual qualification decisions (migration 0134).
 * A decision says a Forms Sales Order qualifies for Category B, or doesn't, with the reason (required). It is never
 * edited or deleted: a change RETIRES it (who, when, why) and records a new one; both are written to the input history
 * in the same transaction. A decision takes effect when the month is next calculated, and the calculation keeps the
 * automatic outcome beside it. Nothing here authorizes: the server actions require `incentive.calc.qualify`; and
 * whoever decides an order of a month never approves that month (services and database).
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

async function history(tx: Tx, actor: Actor, entityId: string, action: "record" | "retire", before: unknown, after: unknown, note: string | null) {
  await tx.insert(incentiveCalcInputHistory).values({ entity: "b-override", entityId, action, before: before ?? null, after: after ?? null, note, actorId: actor.id, actorName: actor.name });
}

export interface ReviewRow {
  orderId: string | null;
  orderNo: string;
  orderDate: string;
  customerName: string | null;
  outcome: "qualified" | "not-qualified" | "needs-review";
  automatic: "qualified" | "not-qualified" | "needs-review";
  invoiceNo: string | null;
  invoiceDate: string | null;
  netTaxablePaise: number | null;
  baseExact: string | null;
  inMonth: boolean;
  pinned: boolean;
  reasons: string[];
  evidence: Record<string, unknown>;
  override: { id: string; decision: "qualify" | "exclude"; reason: string; byName: string; at: string } | null;
  history: { action: string; note: string | null; actorName: string; at: string; decision: string | null }[];
}

export interface ReviewQueue {
  ready: boolean;
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  /** Which calculation the rows come from: the adopted one, else the latest computed one, else none. */
  source: { runId: string; adopted: boolean; asOf: string; configVersionNo: number | null } | null;
  rows: ReviewRow[];
  reviewInvoices: CategoryBResult["reviewInvoices"];
}

/** The month's Category B orders with their qualification and evidence, review cases first. Reads only. */
export async function reviewQueue(programId: string | null, month: string, filter: "review" | "all" = "review", q: Q = db): Promise<ReviewQueue> {
  const empty: ReviewQueue = { ready: false, programs: [], programId: null, month, source: null, rows: [], reviewInvoices: [] };
  if (!(await incentiveCalcBReady(q))) return empty;
  const programs = await q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const pid = programId && programs.some((p) => p.id === programId) ? programId : (programs[0]?.id ?? null);
  if (!pid) return { ...empty, ready: true, programs };
  const [period] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, pid), eq(incentiveCalcPeriods.categoryCode, "B"), eq(incentiveCalcPeriods.month, month)));
  let run: typeof incentiveCalcRuns.$inferSelect | undefined;
  if (period?.currentRunId) [run] = await q.select().from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
  if (!run) [run] = await q.select().from(incentiveCalcRuns).where(and(eq(incentiveCalcRuns.programId, pid), eq(incentiveCalcRuns.categoryCode, "B"), eq(incentiveCalcRuns.month, month), eq(incentiveCalcRuns.status, "computed"))).orderBy(desc(incentiveCalcRuns.computedAt)).limit(1);
  if (!run) return { ...empty, ready: true, programs, programId: pid };
  const quals = await q.select().from(incentiveCalcBQualifications).where(eq(incentiveCalcBQualifications.runId, run.id)).orderBy(asc(incentiveCalcBQualifications.orderDate), asc(incentiveCalcBQualifications.orderNo));
  const orderIds = quals.map((x) => x.orderDocumentId).filter((x): x is string => !!x);
  const overrides = orderIds.length ? await q.select().from(incentiveCalcBOverrides).where(inArray(incentiveCalcBOverrides.orderDocumentId, orderIds)).orderBy(asc(incentiveCalcBOverrides.createdAt)) : [];
  const hist = overrides.length ? await q.select().from(incentiveCalcInputHistory).where(and(eq(incentiveCalcInputHistory.entity, "b-override"), inArray(incentiveCalcInputHistory.entityId, overrides.map((o) => o.id)))).orderBy(asc(incentiveCalcInputHistory.eventNo)) : [];
  const rows: ReviewRow[] = quals
    .filter((x) => filter === "all" || x.outcome === "needs-review" || x.automaticOutcome === "needs-review")
    .map((x) => {
      const mine = overrides.filter((o) => o.orderDocumentId === x.orderDocumentId);
      const active = mine.find((o) => !o.retiredAt) ?? null;
      return {
        orderId: x.orderDocumentId,
        orderNo: x.orderNo,
        orderDate: D(x.orderDate)!,
        customerName: x.customerName,
        outcome: x.outcome,
        automatic: x.automaticOutcome,
        invoiceNo: x.invoiceNo,
        invoiceDate: D(x.invoiceDate),
        netTaxablePaise: x.netTaxablePaise === null ? null : Number(x.netTaxablePaise),
        baseExact: x.baseExact,
        inMonth: x.inMonth,
        pinned: x.pinned,
        reasons: x.reasons,
        evidence: x.evidence,
        override: active ? { id: active.id, decision: active.decision, reason: active.reason, byName: active.createdByName, at: active.createdAt.toISOString() } : null,
        history: hist.filter((h) => mine.some((o) => o.id === h.entityId)).map((h) => ({ action: h.action, note: h.note, actorName: h.actorName, at: h.at.toISOString(), decision: ((h.after ?? h.before) as { decision?: string } | null)?.decision ?? null })),
      };
    })
    .sort((a, b) => Number(b.outcome === "needs-review") - Number(a.outcome === "needs-review"));
  return {
    ready: true,
    programs,
    programId: pid,
    month,
    source: { runId: run.id, adopted: period?.currentRunId === run.id, asOf: D(run.asOf)!, configVersionNo: run.configVersionNo },
    rows,
    reviewInvoices: (run.result as CategoryBResult).reviewInvoices ?? [],
  };
}

/** Forms Sales Orders matching a number or party, for deciding an order not yet in a calculation. Reads only. */
export async function findSalesOrders(search: string, q: Q = db) {
  const s = search.trim();
  if (s.length < 2 || !(await incentiveCalcBReady(q))) return [];
  const docs = await q
    .select({ id: tallyDocuments.id, no: tallyDocuments.documentNo, date: tallyDocuments.documentDate, party: tallyDocuments.partyName, customer: customerMasters.name })
    .from(tallyDocuments)
    .leftJoin(customerMasters, eq(customerMasters.id, tallyDocuments.customerMasterId))
    .where(and(eq(tallyDocuments.documentType, "sales-orders"), or(ilike(tallyDocuments.documentNo, like(s)), ilike(tallyDocuments.partyName, like(s)))))
    .orderBy(desc(tallyDocuments.documentDate))
    .limit(25);
  const active = docs.length ? await q.select().from(incentiveCalcBOverrides).where(and(inArray(incentiveCalcBOverrides.orderDocumentId, docs.map((d) => d.id)), isNull(incentiveCalcBOverrides.retiredAt))) : [];
  return docs.map((d) => ({ id: d.id, no: d.no, date: D(d.date)!, customerName: d.customer ?? d.party, override: active.find((o) => o.orderDocumentId === d.id) ?? null }));
}

/** Record an authorised admin's decision on a Sales Order (one active decision per order: retire it to change it). */
export async function recordOverride(actor: Actor, input: { orderId: string; decision: "qualify" | "exclude"; reason: string }): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.orderId)) return { ok: false, error: "Choose a Sales Order." };
  if (input.decision !== "qualify" && input.decision !== "exclude") return { ok: false, error: "Choose qualifies or doesn't qualify." };
  const reason = clean(input.reason);
  if (!reason) return { ok: false, error: "Give the reason for the decision (it is kept with it)." };
  if ((input.reason ?? "").trim().length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcBReady(db))) return { ok: false, error: CALC_B_NOT_READY };
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(tallyDocuments).where(eq(tallyDocuments.id, input.orderId));
    if (!doc || doc.documentType !== "sales-orders") return { ok: false as const, error: "That isn't a Forms Sales Order." };
    const [current] = await tx.select().from(incentiveCalcBOverrides).where(and(eq(incentiveCalcBOverrides.orderDocumentId, doc.id), isNull(incentiveCalcBOverrides.retiredAt)));
    if (current) return { ok: false as const, error: `Sales Order ${doc.documentNo} already has a decision (${current.decision === "qualify" ? "qualifies" : "doesn't qualify"}). Retire it first, with the reason, to record another.` };
    const [row] = await tx.insert(incentiveCalcBOverrides).values({ orderDocumentId: doc.id, decision: input.decision, reason, createdById: actor.id, createdByName: actor.name }).returning();
    await history(tx, actor, row!.id, "record", null, { orderId: doc.id, orderNo: doc.documentNo, decision: input.decision, reason }, reason);
    return { ok: true as const, id: row!.id };
  });
}

/** Retire a decision (with the reason): the order goes back to its automatic outcome at the next calculation. */
export async function retireOverride(actor: Actor, id: string, reason: string): Promise<Result> {
  const why = clean(reason);
  if (!UUID.test(id)) return { ok: false, error: "That decision doesn't exist." };
  if (!why) return { ok: false, error: "Say why it is retired." };
  if (!(await incentiveCalcBReady(db))) return { ok: false, error: CALC_B_NOT_READY };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(incentiveCalcBOverrides).where(eq(incentiveCalcBOverrides.id, id)).for("update");
    if (!row) return { ok: false as const, error: "That decision doesn't exist." };
    if (row.retiredAt) return { ok: false as const, error: "It was already retired." };
    const [after] = await tx.update(incentiveCalcBOverrides).set({ retiredAt: new Date(), retiredById: actor.id, retiredReason: why }).where(eq(incentiveCalcBOverrides.id, id)).returning();
    await history(tx, actor, id, "retire", row, after, why);
    return { ok: true as const };
  });
}
