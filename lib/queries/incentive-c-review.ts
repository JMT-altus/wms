import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, incentiveCalcCReviews, incentiveCalcInputHistory, incentiveCalcPeriods, incentiveCalcRuns, incentivePrograms, tallyDocuments } from "@/db/schema";
import type { CReviewCase, CReviewKind, CategoryXResult } from "@/lib/incentives/categories/types";
import { CALC_C_NOT_READY, incentiveCalcCReady } from "@/lib/queries/incentive-calc-x";
import { loadConfig, versionInForce } from "@/lib/queries/incentive-rules";
import { monthEnd, monthsBefore } from "@/lib/incentives/shared/dates";
import type { Actor, Result } from "@/lib/queries/incentive-calc";

/**
 * Category C — Admin Review of unmatched records (migration 0136). The month's calculation HOLDS every record it can't
 * place — a Sales Order without a Customer Master link, an invoice without a Sales Order, a credit note without an
 * invoice, a sales return not on a credit note, a new customer nobody can be credited for — and never qualifies it. An
 * authorised admin decides each one, always with a reason: LINK it to the customer / Sales Order / invoice / credit
 * note it belongs to, or EXCLUDE it. A decision never awards anything: it takes effect when the month is next
 * calculated, through the same rules. It is never edited or deleted — a change RETIRES it (who, when, why) — and both
 * are written to the input history ('c-review') in the same transaction. A customer nobody can be credited for is
 * resolved in the existing, audited inputs (Order salespeople, Representatives), not here.
 * Nothing here authorizes: the server actions require `incentive.calc.review`; and whoever decides a case of a month
 * never approves that month (services and database).
 */

type Q = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const D = (x: unknown) => (x === null || x === undefined ? null : String(x).slice(0, 10));
type DecidableKind = Exclude<CReviewKind, "customer-salesperson">;
const DECIDABLE: readonly DecidableKind[] = ["order-customer", "invoice-order", "credit-note-invoice", "return-credit-note", "receipt-customer"];
/** What each case's record is, and what it may be linked to. */
const RECORD_TYPE: Record<DecidableKind, string | null> = { "order-customer": "sales-orders", "invoice-order": "sales-invoices", "credit-note-invoice": "credit-notes", "return-credit-note": null, "receipt-customer": "customer-receipts" };
const TARGET_TYPE: Record<DecidableKind, string> = { "order-customer": "customer-master", "invoice-order": "sales-orders", "credit-note-invoice": "sales-invoices", "return-credit-note": "credit-notes", "receipt-customer": "customer-master" };

async function history(tx: Tx, actor: Actor, entityId: string, action: "record" | "retire", before: unknown, after: unknown, note: string | null) {
  await tx.insert(incentiveCalcInputHistory).values({ entity: "c-review", entityId, action, before: before ?? null, after: after ?? null, note, actorId: actor.id, actorName: actor.name });
}

export interface CReviewDecision {
  id: string;
  decision: "link" | "exclude";
  targetId: string | null;
  targetLabel: string | null;
  reason: string;
  byName: string;
  at: string;
}
export interface CReviewRow extends CReviewCase {
  decidable: boolean;
  /** What it may be linked to (the customer's own records first). */
  targets: { id: string; label: string }[];
  decision: CReviewDecision | null;
  history: { action: string; note: string | null; actorName: string; at: string }[];
}
export interface CReviewQueue {
  ready: boolean;
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  source: { runId: string; adopted: boolean; asOf: string; configVersionNo: number | null } | null;
  rows: CReviewRow[];
}

/** The month's Category C review cases (from its adopted calculation, else the latest computed one) with the decisions in force. Reads only. */
export async function reviewQueueC(programId: string | null, month: string, q: Q = db): Promise<CReviewQueue> {
  const empty: CReviewQueue = { ready: false, programs: [], programId: null, month, source: null, rows: [] };
  if (!(await incentiveCalcCReady(q))) return empty;
  const programs = await q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const pid = programId && programs.some((p) => p.id === programId) ? programId : (programs[0]?.id ?? null);
  if (!pid) return { ...empty, ready: true, programs };
  const [period] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, pid), eq(incentiveCalcPeriods.categoryCode, "C"), eq(incentiveCalcPeriods.month, month)));
  let run: typeof incentiveCalcRuns.$inferSelect | undefined;
  if (period?.currentRunId) [run] = await q.select().from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
  if (!run) [run] = await q.select().from(incentiveCalcRuns).where(and(eq(incentiveCalcRuns.programId, pid), eq(incentiveCalcRuns.categoryCode, "C"), eq(incentiveCalcRuns.month, month), eq(incentiveCalcRuns.status, "computed"))).orderBy(desc(incentiveCalcRuns.computedAt)).limit(1);
  if (!run) return { ...empty, ready: true, programs, programId: pid };
  const cases = (run.result as CategoryXResult).reviewCases ?? [];
  const ids = [...new Set(cases.map((c) => c.documentId))];
  const decisions = ids.length ? await q.select().from(incentiveCalcCReviews).where(inArray(incentiveCalcCReviews.documentId, ids)).orderBy(asc(incentiveCalcCReviews.createdAt)) : [];
  const hist = decisions.length ? await q.select().from(incentiveCalcInputHistory).where(and(eq(incentiveCalcInputHistory.entity, "c-review"), inArray(incentiveCalcInputHistory.entityId, decisions.map((d) => d.id)))).orderBy(asc(incentiveCalcInputHistory.eventNo)) : [];
  const docs = ids.length ? await q.select().from(tallyDocuments).where(inArray(tallyDocuments.id, ids)) : [];
  const rows: CReviewRow[] = [];
  for (const c of cases) {
    const decidable = (DECIDABLE as readonly string[]).includes(c.caseKind);
    const mine = decisions.filter((d) => d.documentId === c.documentId && d.caseKind === c.caseKind);
    const active = mine.find((d) => !d.retiredAt) ?? null;
    const doc = docs.find((d) => d.id === c.documentId);
    const targets = decidable ? await targetsFor(q, c.caseKind as DecidableKind, doc ?? null, c.customerId) : [];
    rows.push({
      ...c,
      decidable,
      targets,
      decision: active ? { id: active.id, decision: active.decision, targetId: active.targetId, targetLabel: targets.find((t) => t.id === active.targetId)?.label ?? null, reason: active.reason, byName: active.createdByName, at: active.createdAt.toISOString() } : null,
      history: hist.filter((h) => mine.some((d) => d.id === h.entityId)).map((h) => ({ action: h.action, note: h.note, actorName: h.actorName, at: h.at.toISOString() })),
    });
  }
  return { ready: true, programs, programId: pid, month, source: { runId: run.id, adopted: period?.currentRunId === run.id, asOf: D(run.asOf)!, configVersionNo: run.configVersionNo }, rows };
}

/* ── the GLOBAL queue of unattributed Forms records ─────────────────────── */

/**
 * A Forms record no calculation can place on its own, wherever it is: a Sales Order, Sales Invoice, Credit Note or
 * Customer Receipt with NO Customer Master link that no reference (its Sales Order / invoice) places either, or an
 * invoice that names something that isn't a Sales Order in Forms. Each is decided once, globally, in the same review
 * decisions (link / exclude, with a reason). Party keys only PROPOSE a customer; nothing is linked automatically.
 * Category C's submission is refused while one is unresolved in the range its rule looks at (fail-closed).
 */
const CASE_OF_TYPE: Record<string, DecidableKind> = { "sales-orders": "order-customer", "sales-invoices": "invoice-order", "credit-notes": "credit-note-invoice", "customer-receipts": "receipt-customer" };
type Doc = typeof tallyDocuments.$inferSelect;
type Decision = typeof incentiveCalcCReviews.$inferSelect;
export type UnattributedStatus = "unresolved" | "linked" | "excluded";
export interface UnattributedItem {
  doc: Doc;
  caseKind: DecidableKind;
  status: UnattributedStatus;
  why: string;
  decision: Decision | null;
}

/** Every unattributed Forms record dated in [from, to], with its status (decided or not). Reads only. */
export async function unattributedC(q: Q | Tx, from: string, to: string): Promise<UnattributedItem[]> {
  const types = Object.keys(CASE_OF_TYPE);
  const inRange = and(gte(tallyDocuments.documentDate, from), lte(tallyDocuments.documentDate, to));
  const loose = await q.select().from(tallyDocuments).where(and(inArray(tallyDocuments.documentType, types), isNull(tallyDocuments.customerMasterId), inRange));
  // An invoice WITH a customer that names a record which isn't a Sales Order in Forms.
  const broken = await q
    .select()
    .from(tallyDocuments)
    .where(and(eq(tallyDocuments.documentType, "sales-invoices"), isNotNull(tallyDocuments.customerMasterId), isNotNull(tallyDocuments.refDocumentId), inRange, sql`not exists (select 1 from tally_documents o where o.id = ${tallyDocuments.refDocumentId} and o.document_type = 'sales-orders')`));
  const known = new Map<string, Doc>([...loose, ...broken].map((d) => [d.id, d]));
  // The records they name, a few steps up (receipt → invoice → Sales Order).
  for (let i = 0; i < 4; i++) {
    const want = [...new Set([...known.values()].map((d) => d.refDocumentId).filter((x): x is string => !!x && !known.has(x)))];
    if (!want.length) break;
    for (const d of await q.select().from(tallyDocuments).where(inArray(tallyDocuments.id, want))) known.set(d.id, d);
  }
  const allIds = [...known.keys()];
  const decisions = allIds.length ? await q.select().from(incentiveCalcCReviews).where(and(inArray(incentiveCalcCReviews.documentId, allIds), isNull(incentiveCalcCReviews.retiredAt))) : [];
  const decisionOf = (d: Doc) => decisions.find((x) => x.documentId === d.id && x.caseKind === CASE_OF_TYPE[d.documentType]) ?? null;
  const brokenRef = (d: Doc) => d.documentType === "sales-invoices" && !!d.refDocumentId && known.get(d.refDocumentId)?.documentType !== "sales-orders";
  /** Placed: a link decision, or its own customer (and a real Sales Order when an invoice names one), or (not a Sales Order) a placed record it names. */
  const placed = (d: Doc | undefined, depth = 0): boolean => {
    if (!d || depth > 4) return false;
    if (decisionOf(d)?.decision === "link") return true;
    if (brokenRef(d)) return false;
    if (d.customerMasterId) return true;
    return d.documentType !== "sales-orders" && !!d.refDocumentId && placed(known.get(d.refDocumentId), depth + 1);
  };
  const out: UnattributedItem[] = [];
  for (const d of [...loose, ...broken]) {
    const dec = decisionOf(d);
    if (!dec && placed(d)) continue;
    const kind = d.documentType === "sales-invoices" ? "Invoice" : d.documentType === "credit-notes" ? "Credit note" : "Receipt";
    const why = brokenRef(d) ? `Invoice ${d.documentNo} names a record that isn't a Sales Order in Forms.` : d.documentType === "sales-orders" ? `Sales Order ${d.documentNo} isn't linked to a Customer Master record.` : `${kind} ${d.documentNo} has no customer, and nothing it names places it.`;
    out.push({ doc: d, caseKind: CASE_OF_TYPE[d.documentType]!, status: dec ? (dec.decision === "link" ? "linked" : "excluded") : "unresolved", why, decision: dec });
  }
  const key = (x: UnattributedItem) => `${D(x.doc.documentDate)}|${x.doc.documentNo}|${x.doc.id}`;
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * The range Category C's rule looks at for a month: the look-back before an acquisition's first order plus its turnover
 * window, back from the month (and a month's margin), up to the calculation date. Conservative on purpose.
 */
export function cReviewRange(settings: Record<string, unknown>, month: string, asOf: string): { from: string; to: string } {
  const back = Number(settings["c.newCustomerLookbackMonths"] ?? 0) + Number(settings["c.turnoverWindowMonths"] ?? 0) + 1;
  const end = monthEnd(month);
  return { from: monthsBefore(month, Number.isFinite(back) ? back : 0), to: asOf > end ? asOf : end };
}

/**
 * Why Category C's month can't be submitted, approved or paid while unattributed records in its range (the range of its
 * calculation's settings and date) are unresolved, or null. Checked again at each step, so a record that arrives after
 * the submission (or the approval) is never missed; nothing about the month's figures is changed by the refusal.
 */
export async function unattributedBlock(tx: Tx, settings: Record<string, unknown>, month: string, asOf: string, step: "submit" | "approve" | "pay" = "submit"): Promise<string | null> {
  const { from, to } = cReviewRange(settings, month, asOf);
  const open = (await unattributedC(tx, from, to)).filter((x) => x.status === "unresolved");
  if (!open.length) return null;
  const nos = open.slice(0, 5).map((x) => x.doc.documentNo).join(", ");
  const one = open.length === 1;
  const what = `${open.length} unattributed Forms record${one ? "" : "s"} from ${from} to ${to} ${one ? "isn't" : "aren't"} resolved (${nos}${open.length > 5 ? ", …" : ""}).`;
  const decide = `Link or exclude ${one ? "it" : "each"} in Review & decisions → Unattributed records`;
  if (step === "approve") return `${what} ${decide}; if the decision changes the month's figures, reject it so it is recalculated and submitted again. Nothing was approved.`;
  if (step === "pay") return `${what} ${decide} before the payout is recorded (the approved amount is never changed here). Nothing was recorded.`;
  return `${what} ${decide}, then recalculate and submit. Nothing was submitted.`;
}

export interface UnattributedRow {
  documentId: string;
  documentType: string;
  documentNo: string;
  date: string;
  partyName: string;
  totalPaise: number;
  caseKind: DecidableKind;
  status: UnattributedStatus;
  message: string;
  /** Customers whose own Tally party matches (a proposal only). */
  proposals: { id: string; label: string }[];
  targets: { id: string; label: string }[];
  decision: CReviewDecision | null;
  history: { action: string; note: string | null; actorName: string; at: string }[];
}
export interface UnattributedQueue {
  ready: boolean;
  from: string;
  to: string;
  counts: Record<UnattributedStatus, number>;
  rows: UnattributedRow[];
  /** More rows matched than are shown. */
  truncated: boolean;
}
const SHOWN = 200;

/** The global queue for a programme's month (its rule's range), searchable by number or party, filtered by status. Reads only. */
export async function unattributedQueueC(programId: string | null, month: string, filter: { search?: string; status?: string } = {}, q: Q = db): Promise<UnattributedQueue> {
  const empty: UnattributedQueue = { ready: false, from: month, to: monthEnd(month), counts: { unresolved: 0, linked: 0, excluded: 0 }, rows: [], truncated: false };
  if (!(await incentiveCalcCReady(q))) return empty;
  let settings: Record<string, unknown> = {};
  let asOf = monthEnd(month);
  if (programId) {
    const [period] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, "C"), eq(incentiveCalcPeriods.month, month)));
    const [run] = period?.currentRunId ? await q.select().from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId)) : [];
    if (run) {
      settings = ((run.result as CategoryXResult).settingsUsed ?? {}) as Record<string, unknown>;
      asOf = D(run.asOf)!;
    } else {
      const v = await versionInForce(q, programId, "C", month);
      if (v) settings = (await loadConfig(q, v.id)).settings as Record<string, unknown>;
    }
  }
  const { from, to } = cReviewRange(settings, month, asOf);
  const all = await unattributedC(q, from, to);
  const counts: Record<UnattributedStatus, number> = { unresolved: 0, linked: 0, excluded: 0 };
  for (const x of all) counts[x.status]++;
  const needle = (filter.search ?? "").trim().toLowerCase();
  const status = (["unresolved", "linked", "excluded"] as const).find((s) => s === filter.status) ?? null;
  const hits = all.filter((x) => (!status || x.status === status) && (!needle || x.doc.documentNo.toLowerCase().includes(needle) || x.doc.partyName.toLowerCase().includes(needle)));
  const shown = hits.slice(0, SHOWN);
  const keys = [...new Set(shown.map((x) => x.doc.partyKey).filter(Boolean))];
  const party = keys.length ? await q.selectDistinct({ k: tallyDocuments.partyKey, id: customerMasters.id, name: customerMasters.name }).from(tallyDocuments).innerJoin(customerMasters, eq(customerMasters.id, tallyDocuments.customerMasterId)).where(inArray(tallyDocuments.partyKey, keys)) : [];
  const mine = shown.length ? await q.select().from(incentiveCalcCReviews).where(inArray(incentiveCalcCReviews.documentId, shown.map((x) => x.doc.id))) : [];
  const hist = mine.length ? await q.select().from(incentiveCalcInputHistory).where(and(eq(incentiveCalcInputHistory.entity, "c-review"), inArray(incentiveCalcInputHistory.entityId, mine.map((d) => d.id)))).orderBy(asc(incentiveCalcInputHistory.eventNo)) : [];
  const rows: UnattributedRow[] = [];
  for (const x of shown) {
    const proposals = party.filter((p) => p.k === x.doc.partyKey).map((p) => ({ id: p.id, label: p.name }));
    let targets: { id: string; label: string }[] = [];
    if (x.status === "unresolved") {
      if (x.caseKind === "order-customer" || x.caseKind === "receipt-customer") {
        const rest = await targetsFor(q, x.caseKind, x.doc, null);
        targets = [...proposals, ...rest.filter((t) => !proposals.some((p) => p.id === t.id))];
      } else for (const c of [...new Set([x.doc.customerMasterId, ...proposals.map((p) => p.id)].filter((c): c is string => !!c))]) targets.push(...(await targetsFor(q, x.caseKind, x.doc, c)));
    }
    const d = x.decision;
    const docDecisions = mine.filter((m) => m.documentId === x.doc.id && m.caseKind === x.caseKind);
    rows.push({
      documentId: x.doc.id,
      documentType: x.doc.documentType,
      documentNo: x.doc.documentNo,
      date: D(x.doc.documentDate)!,
      partyName: x.doc.partyName,
      totalPaise: Number(x.doc.totalPaise),
      caseKind: x.caseKind,
      status: x.status,
      message: `${x.why}${proposals.length ? ` Its Tally party matches ${proposals.map((p) => p.label).join(", ")} (a proposal only).` : ""}`,
      proposals,
      targets,
      decision: d ? { id: d.id, decision: d.decision, targetId: d.targetId, targetLabel: null, reason: d.reason, byName: d.createdByName, at: d.createdAt.toISOString() } : null,
      history: hist.filter((h) => docDecisions.some((m) => m.id === h.entityId)).map((h) => ({ action: h.action, note: h.note, actorName: h.actorName, at: h.at.toISOString() })),
    });
  }
  return { ready: true, from, to, counts, rows, truncated: hits.length > shown.length };
}

/** What a held record may be linked to: the customer's own records (or, for an order, the Customer Master). Reads only. */
async function targetsFor(q: Q | Tx, kind: DecidableKind, doc: typeof tallyDocuments.$inferSelect | null, customerId: string | null): Promise<{ id: string; label: string }[]> {
  if (kind === "order-customer" || kind === "receipt-customer") {
    const rows = await q.select({ id: customerMasters.id, name: customerMasters.name }).from(customerMasters).orderBy(asc(customerMasters.name)).limit(500);
    return rows.map((r) => ({ id: r.id, label: r.name }));
  }
  const cust = customerId ?? doc?.customerMasterId ?? null;
  if (!cust) return [];
  const rows = await q
    .select({ id: tallyDocuments.id, no: tallyDocuments.documentNo, date: tallyDocuments.documentDate })
    .from(tallyDocuments)
    .where(and(eq(tallyDocuments.documentType, TARGET_TYPE[kind]), eq(tallyDocuments.customerMasterId, cust)))
    .orderBy(desc(tallyDocuments.documentDate))
    .limit(100);
  return rows.map((r) => ({ id: r.id, label: `${r.no} (${D(r.date)})` }));
}

/** Record an authorised admin's decision on a held record (one active decision per record and case: retire it to change it). */
export async function recordReviewC(actor: Actor, input: { documentId: string; caseKind: string; decision: string; targetId: string | null; reason: string }): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.documentId)) return { ok: false, error: "Choose the record." };
  if (!(DECIDABLE as readonly string[]).includes(input.caseKind)) return { ok: false, error: "That case is resolved in the Incentive Calculation inputs, not here." };
  const kind = input.caseKind as DecidableKind;
  if (input.decision !== "link" && input.decision !== "exclude") return { ok: false, error: "Choose link or exclude." };
  if (input.decision === "link" && (!input.targetId || !UUID.test(input.targetId))) return { ok: false, error: "Choose what it belongs to." };
  const reason = (input.reason ?? "").trim();
  if (!reason) return { ok: false, error: "Give the reason for the decision (it is kept with it)." };
  if (reason.length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcCReady(db))) return { ok: false, error: CALC_C_NOT_READY };
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(tallyDocuments).where(eq(tallyDocuments.id, input.documentId));
    if (!doc) return { ok: false as const, error: "That record isn't in Forms." };
    const want = RECORD_TYPE[kind];
    if (want && doc.documentType !== want) return { ok: false as const, error: "That record isn't of the kind this case is about." };
    const targetId = input.decision === "link" ? input.targetId! : null;
    if (targetId) {
      if (kind === "order-customer" || kind === "receipt-customer") {
        const [c] = await tx.select({ id: customerMasters.id }).from(customerMasters).where(eq(customerMasters.id, targetId));
        if (!c) return { ok: false as const, error: "That customer isn't in the Customer Master." };
      } else {
        const [t] = await tx.select({ type: tallyDocuments.documentType, customer: tallyDocuments.customerMasterId }).from(tallyDocuments).where(eq(tallyDocuments.id, targetId));
        if (!t || t.type !== TARGET_TYPE[kind]) return { ok: false as const, error: "It can be linked only to what it belongs to." };
        if (doc.customerMasterId && t.customer && t.customer !== doc.customerMasterId) return { ok: false as const, error: "It can be linked only to the same customer's records." };
      }
    }
    const [current] = await tx.select().from(incentiveCalcCReviews).where(and(eq(incentiveCalcCReviews.documentId, doc.id), eq(incentiveCalcCReviews.caseKind, kind), isNull(incentiveCalcCReviews.retiredAt)));
    if (current) return { ok: false as const, error: `${doc.documentNo} already has a decision (${current.decision}). Retire it first, with the reason, to record another.` };
    const [row] = await tx.insert(incentiveCalcCReviews).values({ documentId: doc.id, caseKind: kind, decision: input.decision as "link" | "exclude", targetId, reason, createdById: actor.id, createdByName: actor.name }).returning();
    await history(tx, actor, row!.id, "record", null, { documentId: doc.id, documentNo: doc.documentNo, caseKind: kind, decision: input.decision, targetId, reason }, reason);
    return { ok: true as const, id: row!.id };
  });
}

/** Retire a decision (with the reason): the record goes back to being held at the next calculation. */
export async function retireReviewC(actor: Actor, id: string, reason: string): Promise<Result> {
  const why = (reason ?? "").trim();
  if (!UUID.test(id)) return { ok: false, error: "That decision doesn't exist." };
  if (!why) return { ok: false, error: "Say why it is retired." };
  if (why.length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcCReady(db))) return { ok: false, error: CALC_C_NOT_READY };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(incentiveCalcCReviews).where(eq(incentiveCalcCReviews.id, id)).for("update");
    if (!row) return { ok: false as const, error: "That decision doesn't exist." };
    if (row.retiredAt) return { ok: false as const, error: "It was already retired." };
    const [after] = await tx.update(incentiveCalcCReviews).set({ retiredAt: new Date(), retiredById: actor.id, retiredReason: why }).where(eq(incentiveCalcCReviews.id, id)).returning();
    await history(tx, actor, id, "retire", row, after, why);
    return { ok: true as const };
  });
}
