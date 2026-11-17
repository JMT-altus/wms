import "server-only";
import { and, asc, desc, eq, inArray, lte, or, sql, isNull, type AnyColumn } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMasters,
  employees,
  incentiveAudit,
  incentiveCalcApprovals,
  incentiveCalcPayouts,
  incentiveCalcPayoutLines,
  incentiveCalcAdjustments,
  incentiveCalcAttributions,
  incentiveCalcOrderCredits,
  incentiveCalcPeriods,
  incentiveCalcReceiptCredits,
  incentiveCalcReceiptEvents,
  incentiveCalcRepHistory,
  incentiveCalcResults,
  incentiveCalcRuns,
  incentivePrograms,
  salesOrderPreclosures,
  tallyDocuments,
} from "@/db/schema";
import { EMPLOYEE_ROLES } from "@/db/enums";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import { inputsHash, normalizeInput, resultHash } from "@/lib/incentives/category-a/hash";
import { decide, monthEnd, negativeBalance, type PeriodStatus } from "@/lib/incentives/category-a/settle";
import { ENGINE_VERSION, type CategoryAInput, type CategoryAResult, type CreditNoteIn, type InvoiceIn, type OrderIn, type ReceiptIn } from "@/lib/incentives/category-a/types";
import { loadConfig, versionInForce } from "@/lib/queries/incentive-rules";
import { isMonthStart, isDay } from "@/lib/incentives/rules-config/validate";

/**
 * Category A calculation, stored (migration 0132). Reads Forms' documents (tally_documents) and the published
 * Incentive Rules version in force for the month, runs the pure engine (lib/incentives/category-a/engine.ts) and
 * records the run — inputs, result, hashes, configuration version, engine version — whether or not it is adopted.
 * Nothing here authorizes (the server actions do) and nothing here touches the live tracker's tables or Forms' data.
 *
 * Every calculation of a month is one transaction, serialised per programme and month (an advisory lock). A locked,
 * approved or paid month is never changed: see lib/incentives/category-a/settle.ts for what happens instead.
 */

type Q = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = Q | Tx;
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface Actor {
  id: string;
  name: string;
}

export const CALC_NOT_READY = "Incentive calculation needs database update 0132 first, so nothing was calculated.";

const rowsOf = <T>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];

export async function incentiveCalcReady(q: Db = db): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.incentive_calc_runs') is not null and to_regclass('public.incentive_calc_approvals') is not null and to_regclass('public.incentive_config_versions') is not null as ok`);
  return rowsOf<{ ok: boolean }>(r)[0]?.ok === true;
}

/** Today in India (yyyy-mm-dd). */
export const todayIST = (now: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/* ── reading the inputs ──────────────────────────────────────────────── */

/**
 * An input row in force: recorded and not retired when the calculation runs. A retired row stays in its table (and in
 * the history), and every run stores the exact inputs it read, so an earlier calculation can always be reproduced.
 */
const inForce = (t: { retiredAt: AnyColumn }) => isNull(t.retiredAt);

type Doc = typeof tallyDocuments.$inferSelect;
const itemsOf = (d: Doc): number | null => {
  const amounts = (d.lines ?? []).map((l) => l.amountPaise).filter((x): x is number => typeof x === "number");
  return amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
};
const D = (x: unknown) => String(x).slice(0, 10);

/** Everything the engine needs for one programme and month, as of a day. Reads only; changes nothing. */
export async function loadInput(q: Db, programId: string, month: string, asOf: string): Promise<CategoryAInput> {
  const end = monthEnd(month);
  const version = await versionInForce(q as Q, programId, "A", month);
  const config = version ? await loadConfig(q as Q, version.id) : null;

  // Seeds: documents that could belong to the month.
  const inMonth = sql`${tallyDocuments.documentDate} between ${month}::date and ${end}::date`;
  const seeds = await q
    .select()
    .from(tallyDocuments)
    .where(
      or(
        and(inArray(tallyDocuments.documentType, ["sales-orders", "sales-invoices", "credit-notes"]), inMonth),
        and(eq(tallyDocuments.documentType, "sales-orders"), sql`(${tallyDocuments.details} -> 'order' ->> 'orderDate') between ${month} and ${end}`),
      ),
    );
  const pcs = await q.select().from(salesOrderPreclosures).where(lte(salesOrderPreclosures.precloseDate, asOf));
  const pcMonthOrders = pcs.filter((p) => D(p.precloseDate) >= month && D(p.precloseDate) <= end).map((p) => p.documentId);
  const extraOrders = pcMonthOrders.length ? await q.select().from(tallyDocuments).where(inArray(tallyDocuments.id, pcMonthOrders)) : [];

  const docs = new Map<string, Doc>();
  for (const d of [...seeds, ...extraOrders]) docs.set(d.id, d);
  const customers = new Set([...docs.values()].map((d) => d.customerMasterId).filter((x): x is string => !!x));
  const TYPES = ["sales-orders", "sales-invoices", "customer-receipts", "credit-notes"];
  if (customers.size) for (const d of await q.select().from(tallyDocuments).where(and(inArray(tallyDocuments.documentType, TYPES), inArray(tallyDocuments.customerMasterId, [...customers]), lte(tallyDocuments.documentDate, asOf)))) docs.set(d.id, d);
  // Follow the references both ways (documents with no customer in the master too).
  for (let round = 0; round < 3; round++) {
    const ids = [...docs.keys()];
    const refs = [...docs.values()].map((d) => d.refDocumentId).filter((x): x is string => !!x && !docs.has(x));
    const linked = await q
      .select()
      .from(tallyDocuments)
      .where(and(inArray(tallyDocuments.documentType, TYPES), lte(tallyDocuments.documentDate, asOf), or(inArray(tallyDocuments.refDocumentId, ids), refs.length ? inArray(tallyDocuments.id, refs) : sql`false`)));
    const before = docs.size;
    for (const d of linked) docs.set(d.id, d);
    if (docs.size === before) break;
  }
  const all = [...docs.values()].filter((d) => D(d.documentDate) <= asOf);
  const of = (t: string) => all.filter((d) => d.documentType === t);

  const orders: OrderIn[] = of("sales-orders").map((d) => {
    const det = (d.details ?? {}) as { order?: { orderDate?: string; paymentTerms?: string }; states?: { cancelled?: boolean; optional?: boolean; postDated?: boolean } };
    return {
      id: d.id,
      no: d.documentNo,
      date: D(d.documentDate),
      customerId: d.customerMasterId,
      totalPaise: d.totalPaise,
      taxablePaise: d.taxablePaise,
      itemsPaise: itemsOf(d),
      customerOrderDate: det.order?.orderDate && isDay(det.order.orderDate) ? det.order.orderDate : null,
      paymentTerms: det.order?.paymentTerms || null,
      states: { cancelled: !!det.states?.cancelled, optional: !!det.states?.optional, postDated: !!det.states?.postDated },
    };
  });
  const invoices: InvoiceIn[] = of("sales-invoices").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, orderId: d.refDocumentId, totalPaise: d.totalPaise, taxablePaise: d.taxablePaise, itemsPaise: itemsOf(d), dueDate: d.dueDate ? D(d.dueDate) : null }));
  const receipts: ReceiptIn[] = of("customer-receipts").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, invoiceId: d.refDocumentId, amountPaise: d.totalPaise }));
  const creditNotes: CreditNoteIn[] = of("credit-notes").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, invoiceId: d.refDocumentId, totalPaise: d.totalPaise, taxablePaise: d.taxablePaise, itemsPaise: itemsOf(d) }));

  const orderDocs = new Map(of("sales-orders").map((d) => [d.id, d]));
  const preclosures = pcs
    .filter((p) => orderDocs.has(p.documentId))
    .map((p) => {
      const line = orderDocs.get(p.documentId)!.lines?.[p.lineNo - 1];
      const qty = line?.quantity ?? null, amt = line?.amountPaise ?? null;
      return { orderId: p.documentId, date: D(p.precloseDate), itemsValuePaise: qty && amt ? Math.round((amt * Number(p.quantity)) / qty) : 0 };
    })
    .filter((p) => p.itemsValuePaise > 0);

  const docIds = all.map((d) => d.id);
  const custIds = [...new Set(all.map((d) => d.customerMasterId).filter((x): x is string => !!x))];
  const [events, custRows, reps, attrs, emps] = await Promise.all([
    docIds.length ? q.select().from(incentiveCalcReceiptEvents).where(and(inArray(incentiveCalcReceiptEvents.documentId, docIds), lte(incentiveCalcReceiptEvents.eventDate, asOf), inForce(incentiveCalcReceiptEvents))) : [],
    custIds.length ? q.select({ id: customerMasters.id, name: customerMasters.name, salesRepId: customerMasters.salesRepId, creditPeriodDays: customerMasters.creditPeriodDays }).from(customerMasters).where(inArray(customerMasters.id, custIds)) : [],
    custIds.length ? q.select().from(incentiveCalcRepHistory).where(and(inArray(incentiveCalcRepHistory.customerMasterId, custIds), inForce(incentiveCalcRepHistory))) : [],
    docIds.length ? q.select().from(incentiveCalcAttributions).where(and(inArray(incentiveCalcAttributions.documentId, docIds), inForce(incentiveCalcAttributions))) : [],
    q.select({ id: employees.id, name: employees.name, role: employees.role, departmentId: employees.departmentId, isActive: employees.isActive }).from(employees),
  ]);

  return normalizeInput({
    month,
    asOf,
    configVersion: version ? { id: version.id, programId: version.programId, versionNo: version.versionNo, status: version.status, effectiveFrom: version.effectiveFrom ? D(version.effectiveFrom) : null, effectiveTo: version.effectiveTo ? D(version.effectiveTo) : null } : null,
    config,
    roles: [...EMPLOYEE_ROLES],
    orders,
    invoices,
    receipts,
    creditNotes,
    preclosures,
    events: events.map((e) => ({ id: e.id, kind: e.kind, documentId: e.documentId, invoiceId: e.invoiceDocumentId, amountPaise: e.amountPaise, date: D(e.eventDate) })),
    customers: custRows,
    repHistory: reps.map((r) => ({ customerId: r.customerMasterId, employeeId: r.employeeId, from: D(r.effectiveFrom), to: r.effectiveTo ? D(r.effectiveTo) : null })),
    attributions: attrs.map((a) => ({ documentId: a.documentId, employeeId: a.employeeId, sharePpm: a.sharePpm })),
    employees: emps.map((e) => ({ id: e.id, name: e.name, role: e.role, departmentId: e.departmentId, isActive: e.isActive })),
  });
}

/* ── calculating ─────────────────────────────────────────────────────── */

const lockMonth = (tx: Tx, programId: string, month: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_calc'), hashtext(${`${programId}|${month}`}))`);

async function periodFor(tx: Tx, programId: string, month: string) {
  await tx.insert(incentiveCalcPeriods).values({ programId, categoryCode: "A", month }).onConflictDoNothing();
  const [p] = await tx.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, "A"), eq(incentiveCalcPeriods.month, month))).for("update");
  return p!;
}

async function payablesOf(tx: Tx, runId: string | null): Promise<Record<string, number>> {
  if (!runId) return {};
  const rows = await tx.select({ e: incentiveCalcResults.employeeId, p: incentiveCalcResults.payablePaise }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, runId));
  return Object.fromEntries(rows.filter((r) => r.e).map((r) => [r.e!, Number(r.p)]));
}

export interface CalculateOutcome {
  runId: string | null;
  unchanged: boolean;
  adopted: boolean;
  status: "computed" | "blocked";
  outcome: string;
  problems: string[];
}

/**
 * Calculate a month. Always records a new run unless the month's latest run has exactly the same inputs or the same
 * result (nothing to record twice). Adopts it only as the configuration and the month's state allow.
 */
export async function calculate(actor: Actor, programId: string, month: string, asOfIn?: string): Promise<Result<CalculateOutcome>> {
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  const asOf = asOfIn ?? todayIST();
  if (!isDay(asOf) || asOf < month) return { ok: false, error: "The calculation date must be on or after the month's first day." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  const [program] = await db.select({ id: incentivePrograms.id }).from(incentivePrograms).where(eq(incentivePrograms.id, programId)).limit(1);
  if (!program) return { ok: false, error: "That programme doesn't exist." };

  return db.transaction(async (tx) => {
    await lockMonth(tx, programId, month);
    const period = await periodFor(tx, programId, month);
    const input = await loadInput(tx, programId, month, asOf);
    const result = calculateCategoryA(input);
    const ih = inputsHash(input);
    const rh = resultHash(result);
    const [latest] = await tx.select({ id: incentiveCalcRuns.id, ih: incentiveCalcRuns.inputsHash, rh: incentiveCalcRuns.resultHash }).from(incentiveCalcRuns).where(and(eq(incentiveCalcRuns.programId, programId), eq(incentiveCalcRuns.categoryCode, "A"), eq(incentiveCalcRuns.month, month))).orderBy(desc(incentiveCalcRuns.computedAt)).limit(1);
    if (latest && (latest.ih === ih || latest.rh === rh)) return { ok: true as const, runId: latest.id, unchanged: true, adopted: false, status: result.status, outcome: "Nothing changed since the last calculation: no new run was recorded.", problems: result.problems };

    let currentSettled = false;
    if (period.currentRunId) {
      const [cur] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
      currentSettled = (cur?.result as CategoryAResult | undefined)?.settled === true;
    }
    const carriedRows = await tx.select({ e: incentiveCalcAdjustments.employeeId, a: incentiveCalcAdjustments.amountPaise }).from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, "A"), eq(incentiveCalcAdjustments.fromMonth, month), eq(incentiveCalcAdjustments.kind, "recalc-difference")));
    const carried: Record<string, number> = {};
    for (const r of carriedRows) if (r.e) carried[r.e] = (carried[r.e] ?? 0) + Number(r.a);
    const fresh = Object.fromEntries(result.employees.map((e) => [e.employeeId, e.payablePaise]));
    const settings = input.config?.settings ?? {};
    const decision = decide(settings, { month, status: period.status as PeriodStatus, hasCurrentRun: !!period.currentRunId, currentRunSettled: currentSettled, paidAt: period.paidAt ? period.paidAt.toISOString() : null }, asOf, result.status === "computed", { adopted: await payablesOf(tx, period.currentRunId), fresh, carried });

    let rowVersion = period.rowVersion;
    if (decision.lockFirst) {
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: null, rowVersion: ++rowVersion, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, period.id));
    }
    let outcome = decision.outcome;
    const targetBlocked: string[] = [];
    for (const c of decision.carries) {
      const target = await periodFor(tx, programId, c.toMonth);
      if (target.status !== "open") targetBlocked.push(c.toMonth);
    }
    const carries = targetBlocked.length ? [] : decision.carries;
    if (targetBlocked.length) outcome = `${outcome.replace(/ The difference is carried.*$/, "")} It differs, but ${targetBlocked[0]!.slice(0, 7)} isn't open, so nothing was carried.`;

    const [run] = await tx
      .insert(incentiveCalcRuns)
      .values({ programId, categoryCode: "A", month, asOf, configVersionId: result.configVersionId, configVersionNo: result.configVersionNo, engineVersion: result.engineVersion, status: result.status, adopted: decision.adopt, outcome, inputsHash: ih, resultHash: rh, inputs: input, result, computedById: actor.id, computedByName: actor.name })
      .returning({ id: incentiveCalcRuns.id });
    const runId = run!.id;
    if (result.employees.length)
      await tx.insert(incentiveCalcResults).values(result.employees.map((e) => ({ runId, employeeId: e.employeeId, employeeName: e.name, salesPaise: e.salesPaise, qualified: e.qualified, poolExact: e.pool, earnedExact: e.earnedExact, payableExact: e.payableExact, earnedPaise: e.earnedPaise, payablePaise: e.payablePaise, pendingPaise: e.pendingPaise, projectedPaise: e.projectedPaise, explanation: [...e.explanation, ...e.limits] })));
    if (result.units.length)
      await tx.insert(incentiveCalcOrderCredits).values(result.units.map((u) => ({ runId, employeeId: u.employeeId, documentId: u.unitId, documentType: u.unitType, documentNo: u.unitNo, sharePpm: u.sharePpm, valuePaise: u.valuePaise, collectiblePaise: u.collectiblePaise, collectedPaise: u.collectedPaise, fullyCollected: u.fullyCollected, takesShare: u.takesShare, allocatedExact: u.allocated, earnedExact: u.earnedExact, payableExact: u.payableExact, explanation: u.explanation })));
    if (result.pieces.length)
      await tx.insert(incentiveCalcReceiptCredits).values(result.pieces.map((p) => ({ runId, employeeId: p.employeeId, receiptDocumentId: p.receiptId, invoiceDocumentId: p.invoiceId, unitDocumentId: p.unitId, receiptNo: p.receiptNo, receiptDate: p.receiptDate, amountPaise: p.amountPaise, referenceDate: p.referenceDate, delayDays: p.delayDays, multiplierPpm: p.multiplierPpm, earnedExact: p.earnedExact, status: p.status, note: p.note })));
    if (decision.adopt) await tx.update(incentiveCalcPeriods).set({ currentRunId: runId, rowVersion: ++rowVersion, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, period.id));
    const names = new Map(result.employees.map((e) => [e.employeeId, e.name]));
    for (const c of carries)
      await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: "A", fromMonth: month, toMonth: c.toMonth, employeeId: c.employeeId, employeeName: names.get(c.employeeId) ?? input.employees.find((e) => e.id === c.employeeId)?.name ?? "Former employee", kind: "recalc-difference", amountPaise: c.amountPaise, sourceRunId: runId, note: outcome, createdById: actor.id });
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "calculated", entityType: "incentive-calc-period", entityId: period.id, detail: { month, asOf, runId, status: result.status, adopted: decision.adopt, configVersionId: result.configVersionId, inputsHash: ih, resultHash: rh, outcome } });
    return { ok: true as const, runId, unchanged: false, adopted: decision.adopt, status: result.status, outcome, problems: result.problems };
  });
}

/** Lock a calculated open month (negative balances handled as configured), or reopen a locked one. */
export async function setLocked(actor: Actor, programId: string, month: string, lock: boolean, expectedRowVersion: number): Promise<Result<{ rowVersion: number; notes: string[] }>> {
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    await lockMonth(tx, programId, month);
    const [p] = await tx.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, "A"), eq(incentiveCalcPeriods.month, month))).for("update");
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: "The month was changed by someone else meanwhile. Nothing was changed; reload to see it as it is now." };
    const notes: string[] = [];
    if (lock) {
      if (p.status !== "open") return { ok: false as const, error: `The month is ${p.status}, not open.` };
      if (!p.currentRunId) return { ok: false as const, error: "Calculate the month before locking it." };
      const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, p.currentRunId));
      const settings = ((run!.result as CategoryAResult).settingsUsed ?? {}) as Record<string, string | number | string[]>;
      const payable = await payablesOf(tx, p.currentRunId);
      const incoming = await tx.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, "A"), eq(incentiveCalcAdjustments.toMonth, month)));
      const net: Record<string, number> = { ...payable };
      const left: Record<string, number | null> = {};
      const names: Record<string, string> = {};
      for (const a of incoming) {
        if (!a.employeeId) continue;
        net[a.employeeId] = (net[a.employeeId] ?? 0) + Number(a.amountPaise);
        names[a.employeeId] = a.employeeName;
        if (a.kind === "negative-carry" && a.monthsLeft !== null) left[a.employeeId] = Math.min(left[a.employeeId] ?? Infinity, a.monthsLeft);
      }
      const resultNames = await tx.select({ e: incentiveCalcResults.employeeId, n: incentiveCalcResults.employeeName }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, p.currentRunId));
      for (const r of resultNames) if (r.e) names[r.e] = r.n;
      for (const [e, n] of Object.entries(net).sort()) {
        const nb = negativeBalance(settings, month, n, left[e] ?? null);
        if (!nb) continue;
        if (nb.toMonth) await periodFor(tx, programId, nb.toMonth);
        await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: "A", fromMonth: month, toMonth: nb.toMonth, employeeId: e, employeeName: names[e] ?? "Former employee", kind: nb.kind, amountPaise: nb.amountPaise, monthsLeft: nb.monthsLeft, sourceRunId: p.currentRunId, note: nb.note, createdById: actor.id }).onConflictDoNothing();
        notes.push(`${names[e] ?? e}: ${nb.note}`);
      }
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: actor.id, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    } else {
      if (p.status !== "locked") return { ok: false as const, error: p.status === "open" ? "The month is already open." : `An ${p.status} month can't be reopened.` };
      await tx.update(incentiveCalcPeriods).set({ status: "open", rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    }
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: lock ? "locked" : "reopened", entityType: "incentive-calc-period", entityId: p.id, detail: { month, notes } });
    return { ok: true as const, rowVersion: p.rowVersion + 1, notes };
  });
}

/* ── approval and payout ─────────────────────────────────────────────── */

/** What each salesperson is owed for a month: the adopted run's payable plus every adjustment carried INTO the month, never below zero (a negative balance is carried at lock). The payout reconciles against this. */
export async function payoutLines(q: Db, programId: string, month: string, runId: string) {
  const results = await q.select().from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, runId));
  const incoming = await q.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, "A"), eq(incentiveCalcAdjustments.toMonth, month)));
  const lines = new Map<string, { name: string; payable: number; adjustments: number }>();
  for (const r of results) if (r.employeeId) lines.set(r.employeeId, { name: r.employeeName, payable: Number(r.payablePaise), adjustments: 0 });
  for (const a of incoming) {
    if (!a.employeeId) continue;
    const l = lines.get(a.employeeId) ?? { name: a.employeeName, payable: 0, adjustments: 0 };
    l.adjustments += Number(a.amountPaise);
    lines.set(a.employeeId, l);
  }
  const out = [...lines.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([employeeId, l]) => ({ employeeId, employeeName: l.name, payablePaise: l.payable, adjustmentsPaise: l.adjustments, amountPaise: Math.max(0, l.payable + l.adjustments) }));
  return out;
}


const STALE = "The month was changed by someone else meanwhile. Nothing was changed; reload to see it as it is now.";

async function periodRow(tx: Tx, programId: string, month: string) {
  await lockMonth(tx, programId, month);
  const [p] = await tx.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, "A"), eq(incentiveCalcPeriods.month, month))).for("update");
  return p ?? null;
}
/**
 * Why a month's adopted calculation can't be submitted or approved, or null. It must be a computed run of the current
 * engine whose STORED inputs still give exactly its STORED result (so nothing about it was changed or lost since).
 */
async function invalidCalculation(tx: Tx, runId: string | null): Promise<string | null> {
  if (!runId) return "The month has no adopted calculation.";
  const [run] = await tx.select().from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  if (!run) return "The month's calculation can't be found.";
  if (run.status !== "computed" || !run.configVersionId) return "The month's calculation was blocked, so there is nothing to approve.";
  if (run.engineVersion !== ENGINE_VERSION) return `The month was calculated by an earlier engine (${run.engineVersion}); reopen and recalculate it first.`;
  let again: CategoryAResult;
  try {
    again = calculateCategoryA(run.inputs as CategoryAInput);
  } catch {
    return "The month's stored calculation inputs can't be read; reopen and recalculate it.";
  }
  if (again.status !== "computed" || resultHash(again) !== run.resultHash || inputsHash(run.inputs as CategoryAInput) !== run.inputsHash) return "The month's stored calculation doesn't reproduce its own result; reopen and recalculate it before approval.";
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, runId))) as [{ n: number }];
  if (n !== again.employees.length) return "The month's stored results are incomplete; reopen and recalculate it.";
  return null;
}

async function settingsOfRun(tx: Tx, runId: string) {
  const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  return ((run?.result as CategoryAResult | undefined)?.settingsUsed ?? {}) as Record<string, unknown>;
}
const nextMonthStart = (day: string) => {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

/** Submit a locked month for approval. The number of approvals is the one its adopted calculation's configuration says. */
export async function submitMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number): Promise<Result<{ rowVersion: number; approvalsRequired: number }>> {
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (p.status !== "locked") return { ok: false as const, error: `Only a locked month is submitted; this one is ${p.status}.` };
    const invalid = await invalidCalculation(tx, p.currentRunId);
    if (invalid) return { ok: false as const, error: invalid };
    const steps = (await settingsOfRun(tx, p.currentRunId!))["payout.approvalSteps"];
    if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1 || steps > 3) return { ok: false as const, error: "The configuration this month was calculated with doesn't say how many approvals a payout needs." };
    await tx.update(incentiveCalcPeriods).set({ status: "submitted", submissionNo: p.submissionNo + 1, submittedAt: new Date(), submittedById: actor.id, approvalsRequired: steps, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "submitted", entityType: "incentive-calc-period", entityId: p.id, detail: { month, submissionNo: p.submissionNo + 1, approvalsRequired: steps, runId: p.currentRunId } });
    return { ok: true as const, rowVersion: p.rowVersion + 1, approvalsRequired: steps };
  });
}

/** Withdraw a submission (back to locked), only by the person who submitted it, before any approval. */
export async function withdrawMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number): Promise<Result<{ rowVersion: number }>> {
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (p.status !== "submitted") return { ok: false as const, error: "Only a submitted month can be withdrawn." };
    if (p.submittedById !== actor.id) return { ok: false as const, error: "Only the person who submitted it can withdraw it." };
    const [done] = await tx.select({ n: sql<number>`count(*)::int` }).from(incentiveCalcApprovals).where(and(eq(incentiveCalcApprovals.periodId, p.id), eq(incentiveCalcApprovals.submissionNo, p.submissionNo)));
    if ((done?.n ?? 0) > 0) return { ok: false as const, error: "It already has an approval; it can only be rejected now." };
    await tx.update(incentiveCalcPeriods).set({ status: "locked", rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "withdrawn", entityType: "incentive-calc-period", entityId: p.id, detail: { month, submissionNo: p.submissionNo } });
    return { ok: true as const, rowVersion: p.rowVersion + 1 };
  });
}

/**
 * Approve the next step of a submitted month, or reject it (with a reason; back to locked). The last approval
 * approves the month and sets when it is released, as the configuration says ("When an approved payout is released").
 */
export async function decideMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number, decision: "approve" | "reject", reason: string | null, today: string = todayIST()): Promise<Result<{ rowVersion: number; status: string; step: number }>> {
  const why = (reason ?? "").trim() || null;
  if (decision === "reject" && !why) return { ok: false, error: "Give the reason for rejecting it." };
  if ((why ?? "").length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (p.status !== "submitted") return { ok: false as const, error: "Only a submitted month is approved or rejected." };
    if (p.submittedById === actor.id) return { ok: false as const, error: "You submitted this month, so you can't approve or reject it." };
    const prior = await tx.select().from(incentiveCalcApprovals).where(and(eq(incentiveCalcApprovals.periodId, p.id), eq(incentiveCalcApprovals.submissionNo, p.submissionNo)));
    if (prior.some((a) => a.actorId === actor.id)) return { ok: false as const, error: "You already approved a step of this submission; the next step needs someone else." };
    const step = prior.length + 1;
    if (decision === "approve") {
      const invalid = await invalidCalculation(tx, p.currentRunId);
      if (invalid) return { ok: false as const, error: `${invalid} (Reject it with that reason.)` };
    }
    await tx.insert(incentiveCalcApprovals).values({ periodId: p.id, runId: p.currentRunId!, submissionNo: p.submissionNo, stepNo: step, decision, reason: why, actorId: actor.id, actorName: actor.name });
    let status: string = "submitted";
    if (decision === "reject") {
      status = "locked";
      await tx.update(incentiveCalcPeriods).set({ status: "locked", rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    } else if (step >= (p.approvalsRequired ?? 1)) {
      status = "approved";
      const release = (await settingsOfRun(tx, p.currentRunId!))["payout.release"];
      const releaseOn = release === "withPayrollMonth" ? nextMonthStart(today) : today;
      await tx.update(incentiveCalcPeriods).set({ status: "approved", approvedAt: new Date(), approvedById: actor.id, releaseOn, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    } else {
      await tx.update(incentiveCalcPeriods).set({ rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    }
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: decision === "approve" ? "approved" : "rejected", entityType: "incentive-calc-period", entityId: p.id, detail: { month, submissionNo: p.submissionNo, step, reason: why, status } });
    return { ok: true as const, rowVersion: p.rowVersion + 1, status, step };
  });
}

/**
 * Record that an approved month was paid: one payout per month, with each salesperson's amount (payable + adjustments
 * carried into the month, never below zero). A RECORD only — the WMS moves no money.
 */
export async function recordPayout(actor: Actor, programId: string, month: string, expectedRowVersion: number, input: { reference: string; paidOn: string; amountPaise: number; note: string | null }, today: string = todayIST()): Promise<Result<{ rowVersion: number; totalPaise: number }>> {
  const reference = input.reference.trim();
  if (!reference || reference.length > 200) return { ok: false, error: "Give the payout reference (up to 200 characters)." };
  if (!isDay(input.paidOn)) return { ok: false, error: "Give the date it was paid." };
  if (input.paidOn > today) return { ok: false, error: "A payout is recorded once it is made: the date paid can't be in the future." };
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0) return { ok: false, error: "Give the amount paid." };
  if ((input.note ?? "").length > 1000) return { ok: false, error: "The note is longer than 1,000 characters." };
  if (!(await incentiveCalcReady())) return { ok: false, error: CALC_NOT_READY };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (p.status === "paid") return { ok: false as const, error: "This month's payout is already recorded." };
    if (p.status !== "approved") return { ok: false as const, error: "Only an approved month is paid." };
    const releaseOn = D(p.releaseOn)!;
    if (input.paidOn < releaseOn) return { ok: false as const, error: `It is released on ${releaseOn}; a payout can't be dated before that.` };
    const out = await payoutLines(tx, programId, month, p.currentRunId!);
    const total = out.reduce((s, l) => s + l.amountPaise, 0);
    // Reconciliation: the amount paid must be exactly the approved amount. No published setting permits a partial
    // payout, so a different amount is refused (nothing is recorded) and both figures are shown.
    if (input.amountPaise !== total) return { ok: false as const, error: `The amount paid (₹${(input.amountPaise / 100).toFixed(2)}) doesn't match the approved amount (₹${(total / 100).toFixed(2)}). Partial payouts aren't permitted by the configuration; nothing was recorded.` };
    const [payout] = await tx.insert(incentiveCalcPayouts).values({ periodId: p.id, runId: p.currentRunId!, reference, releaseOn, paidOn: input.paidOn, totalPaise: total, note: input.note?.trim() || null, recordedById: actor.id, recordedByName: actor.name }).returning({ id: incentiveCalcPayouts.id });
    if (out.length) await tx.insert(incentiveCalcPayoutLines).values(out.map((l) => ({ payoutId: payout!.id, ...l })));
    await tx.update(incentiveCalcPeriods).set({ status: "paid", paidAt: new Date(), paidById: actor.id, payoutReference: reference, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "paid", entityType: "incentive-calc-period", entityId: p.id, detail: { month, reference, paidOn: input.paidOn, totalPaise: total, runId: p.currentRunId } });
    return { ok: true as const, rowVersion: p.rowVersion + 1, totalPaise: total };
  });
}

/* ── the screen ──────────────────────────────────────────────────────── */

export interface MonthView {
  ready: boolean;
  programs: { id: string; code: string; name: string }[];
  period: (typeof incentiveCalcPeriods.$inferSelect) | null;
  current: { run: typeof incentiveCalcRuns.$inferSelect; results: (typeof incentiveCalcResults.$inferSelect)[]; orders: (typeof incentiveCalcOrderCredits.$inferSelect)[]; receipts: (typeof incentiveCalcReceiptCredits.$inferSelect)[]; documentNos: Record<string, string> } | null;
  runs: { id: string; computedAt: Date; computedByName: string; status: string; adopted: boolean; outcome: string; configVersionNo: number | null; asOf: string; inputsHash: string; resultHash: string }[];
  adjustmentsIn: (typeof incentiveCalcAdjustments.$inferSelect)[];
  adjustmentsOut: (typeof incentiveCalcAdjustments.$inferSelect)[];
  latestProblems: string[];
  approvals: (typeof incentiveCalcApprovals.$inferSelect)[];
  payout: { payout: typeof incentiveCalcPayouts.$inferSelect; lines: (typeof incentiveCalcPayoutLines.$inferSelect)[] } | null;
  submittedByName: string | null;
  /** What the payout must total (payable + adjustments carried in, per salesperson, never below zero). */
  approvedTotalPaise: number | null;
}

export async function monthView(programId: string | null, month: string, q: Q = db): Promise<MonthView> {
  const empty: MonthView = { ready: false, programs: [], period: null, current: null, runs: [], adjustmentsIn: [], adjustmentsOut: [], latestProblems: [], approvals: [], payout: null, submittedByName: null, approvedTotalPaise: null };
  if (!(await incentiveCalcReady(q))) return empty;
  const programs = await q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const pid = programId && programs.some((p) => p.id === programId) ? programId : (programs[0]?.id ?? null);
  if (!pid || !isMonthStart(month)) return { ...empty, ready: true, programs };
  const [period] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, pid), eq(incentiveCalcPeriods.categoryCode, "A"), eq(incentiveCalcPeriods.month, month)));
  const runs = await q
    .select({ id: incentiveCalcRuns.id, computedAt: incentiveCalcRuns.computedAt, computedByName: incentiveCalcRuns.computedByName, status: incentiveCalcRuns.status, adopted: incentiveCalcRuns.adopted, outcome: incentiveCalcRuns.outcome, configVersionNo: incentiveCalcRuns.configVersionNo, asOf: incentiveCalcRuns.asOf, inputsHash: incentiveCalcRuns.inputsHash, resultHash: incentiveCalcRuns.resultHash, result: incentiveCalcRuns.result })
    .from(incentiveCalcRuns)
    .where(and(eq(incentiveCalcRuns.programId, pid), eq(incentiveCalcRuns.categoryCode, "A"), eq(incentiveCalcRuns.month, month)))
    .orderBy(desc(incentiveCalcRuns.computedAt))
    .limit(50);
  let current: MonthView["current"] = null;
  if (period?.currentRunId) {
    const [run] = await q.select().from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
    const [results, orders, receipts] = await Promise.all([
      q.select().from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, period.currentRunId)).orderBy(asc(incentiveCalcResults.employeeName)),
      q.select().from(incentiveCalcOrderCredits).where(eq(incentiveCalcOrderCredits.runId, period.currentRunId)).orderBy(asc(incentiveCalcOrderCredits.documentNo)),
      q.select().from(incentiveCalcReceiptCredits).where(eq(incentiveCalcReceiptCredits.runId, period.currentRunId)).orderBy(asc(incentiveCalcReceiptCredits.receiptDate), asc(incentiveCalcReceiptCredits.receiptNo)),
    ]);
    // The Forms document numbers the receipts were applied to (invoice) and counted under (order or invoice).
    const docIds = [...new Set(receipts.flatMap((r) => [r.invoiceDocumentId, r.unitDocumentId]).filter((x): x is string => !!x))];
    const documentNos = Object.fromEntries(docIds.length ? (await q.select({ id: tallyDocuments.id, no: tallyDocuments.documentNo }).from(tallyDocuments).where(inArray(tallyDocuments.id, docIds))).map((d) => [d.id, d.no]) : []);
    current = { run: run!, results, orders, receipts, documentNos };
  }
  const adj = (col: typeof incentiveCalcAdjustments.toMonth | typeof incentiveCalcAdjustments.fromMonth) => q.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, pid), eq(incentiveCalcAdjustments.categoryCode, "A"), eq(col, month))).orderBy(asc(incentiveCalcAdjustments.createdAt));
  const [adjustmentsIn, adjustmentsOut] = await Promise.all([adj(incentiveCalcAdjustments.toMonth), adj(incentiveCalcAdjustments.fromMonth)]);
  const latest = runs[0];
  const approvals = period ? await q.select().from(incentiveCalcApprovals).where(eq(incentiveCalcApprovals.periodId, period.id)).orderBy(asc(incentiveCalcApprovals.submissionNo), asc(incentiveCalcApprovals.stepNo)) : [];
  const [payoutRow] = period ? await q.select().from(incentiveCalcPayouts).where(eq(incentiveCalcPayouts.periodId, period.id)) : [];
  const payout = payoutRow ? { payout: payoutRow, lines: await q.select().from(incentiveCalcPayoutLines).where(eq(incentiveCalcPayoutLines.payoutId, payoutRow.id)).orderBy(asc(incentiveCalcPayoutLines.employeeName)) } : null;
  const [submitter] = period?.submittedById ? await q.select({ name: employees.name }).from(employees).where(eq(employees.id, period.submittedById)) : [];
  return {
    ready: true,
    programs,
    period: period ?? null,
    current,
    runs: runs.map(({ result: _r, ...r }) => ({ ...r, asOf: D(r.asOf) })),
    adjustmentsIn,
    adjustmentsOut,
    latestProblems: latest && latest.status === "blocked" ? ((latest.result as CategoryAResult).problems ?? []) : [],
    approvals,
    payout,
    submittedByName: submitter?.name ?? null,
    approvedTotalPaise: period?.currentRunId ? (await payoutLines(q, pid, month, period.currentRunId)).reduce((s, l) => s + l.amountPaise, 0) : null,
  };
}


/* ── the approvals screen ────────────────────────────────────────────── */

export interface ApprovalPeriod {
  id: string;
  month: string;
  status: string;
  rowVersion: number;
  run: { id: string; configVersionNo: number | null; asOf: string; computedAt: Date; salespeople: number; payablePaise: number } | null;
  approvedTotalPaise: number | null;
  submissionNo: number;
  submittedByName: string | null;
  submittedAt: Date | null;
  approvalsRequired: number | null;
  approvals: { submissionNo: number; stepNo: number; decision: string; reason: string | null; actorName: string; at: Date }[];
  releaseOn: string | null;
  payout: { reference: string; paidOn: string; totalPaise: number; recordedByName: string; recordedAt: Date; lines: { employeeName: string; payablePaise: number; adjustmentsPaise: number; amountPaise: number }[] } | null;
}

/** Every calculated month of a programme (newest first), with its approval and payout state. */
export async function listApprovalPeriods(programId: string | null, q: Q = db): Promise<{ ready: boolean; programs: { id: string; code: string; name: string }[]; programId: string | null; periods: ApprovalPeriod[] }> {
  if (!(await incentiveCalcReady(q))) return { ready: false, programs: [], programId: null, periods: [] };
  const programs = await q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const pid = programId && programs.some((p) => p.id === programId) ? programId : (programs[0]?.id ?? null);
  if (!pid) return { ready: true, programs, programId: null, periods: [] };
  const periods = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, pid), eq(incentiveCalcPeriods.categoryCode, "A"))).orderBy(desc(incentiveCalcPeriods.month)).limit(60);
  const ids = periods.map((p) => p.id);
  const runIds = periods.map((p) => p.currentRunId).filter((x): x is string => !!x);
  const [runs, approvals, payouts, people, payoutLineRows] = await Promise.all([
    runIds.length ? q.select({ id: incentiveCalcRuns.id, configVersionNo: incentiveCalcRuns.configVersionNo, asOf: incentiveCalcRuns.asOf, computedAt: incentiveCalcRuns.computedAt }).from(incentiveCalcRuns).where(inArray(incentiveCalcRuns.id, runIds)) : [],
    ids.length ? q.select().from(incentiveCalcApprovals).where(inArray(incentiveCalcApprovals.periodId, ids)).orderBy(asc(incentiveCalcApprovals.submissionNo), asc(incentiveCalcApprovals.stepNo)) : [],
    ids.length ? q.select().from(incentiveCalcPayouts).where(inArray(incentiveCalcPayouts.periodId, ids)) : [],
    q.select({ id: employees.id, name: employees.name }).from(employees),
    ids.length ? q.select({ l: incentiveCalcPayoutLines, periodId: incentiveCalcPayouts.periodId }).from(incentiveCalcPayoutLines).innerJoin(incentiveCalcPayouts, eq(incentiveCalcPayouts.id, incentiveCalcPayoutLines.payoutId)).where(inArray(incentiveCalcPayouts.periodId, ids)).orderBy(asc(incentiveCalcPayoutLines.employeeName)) : [],
  ]);
  const names = new Map(people.map((e) => [e.id, e.name]));
  const out: ApprovalPeriod[] = [];
  for (const p of periods) {
    const run = runs.find((r) => r.id === p.currentRunId);
    const lines = run ? await payoutLines(q, pid, D(p.month), run.id) : [];
    const results = run ? await q.select({ payable: incentiveCalcResults.payablePaise }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, run.id)) : [];
    const payout = payouts.find((x) => x.periodId === p.id);
    out.push({
      id: p.id,
      month: D(p.month),
      status: p.status,
      rowVersion: p.rowVersion,
      run: run ? { id: run.id, configVersionNo: run.configVersionNo, asOf: D(run.asOf), computedAt: run.computedAt, salespeople: results.length, payablePaise: results.reduce((s, r) => s + Number(r.payable), 0) } : null,
      approvedTotalPaise: run ? lines.reduce((s, l) => s + l.amountPaise, 0) : null,
      submissionNo: p.submissionNo,
      submittedByName: p.submittedById ? (names.get(p.submittedById) ?? null) : null,
      submittedAt: p.submittedAt,
      approvalsRequired: p.approvalsRequired,
      approvals: approvals.filter((a) => a.periodId === p.id).map((a) => ({ submissionNo: a.submissionNo, stepNo: a.stepNo, decision: a.decision, reason: a.reason, actorName: a.actorName, at: a.at })),
      releaseOn: p.releaseOn ? D(p.releaseOn) : null,
      payout: payout ? { reference: payout.reference, paidOn: D(payout.paidOn), totalPaise: Number(payout.totalPaise), recordedByName: payout.recordedByName, recordedAt: payout.recordedAt, lines: payoutLineRows.filter((x) => x.periodId === p.id).map((x) => ({ employeeName: x.l.employeeName, payablePaise: Number(x.l.payablePaise), adjustmentsPaise: Number(x.l.adjustmentsPaise), amountPaise: Number(x.l.amountPaise) })) } : null,
    });
  }
  return { ready: true, programs, programId: pid, periods: out };
}

/* ── a salesperson's own Category A (My Incentives) ──────────────────── */

export interface MyCategoryAMonth {
  month: string;
  programCode: string;
  programName: string;
  status: "approved" | "paid";
  /** What the person receives for the month: payable + adjustments carried in, never below zero. */
  amountPaise: number;
  releaseOn: string | null;
  paidOn: string | null;
  payoutReference: string | null;
  explanation: string[];
}

/**
 * The signed-in person's OWN Category A, for APPROVED and PAID months only (business decision: provisional figures
 * are for authorised administrators). Never another employee's figures, never a month still open, locked or awaiting
 * approval, and no order-level breakdown — only the amount, its status and the person's own explanation lines.
 */
export async function myCategoryA(employeeId: string, q: Q = db): Promise<{ ready: boolean; months: MyCategoryAMonth[]; awaiting: string[] }> {
  if (!(await incentiveCalcReady(q))) return { ready: false, months: [], awaiting: [] };
  const periods = await q
    .select({ p: incentiveCalcPeriods, code: incentivePrograms.code, name: incentivePrograms.name })
    .from(incentiveCalcPeriods)
    .innerJoin(incentivePrograms, eq(incentivePrograms.id, incentiveCalcPeriods.programId))
    .where(and(eq(incentiveCalcPeriods.categoryCode, "A"), inArray(incentiveCalcPeriods.status, ["approved", "paid"])))
    .orderBy(desc(incentiveCalcPeriods.month));
  const months: MyCategoryAMonth[] = [];
  for (const { p, code, name } of periods) {
    if (!p.currentRunId) continue;
    const [res] = await q.select().from(incentiveCalcResults).where(and(eq(incentiveCalcResults.runId, p.currentRunId), eq(incentiveCalcResults.employeeId, employeeId)));
    let amount: number | null = null;
    let paidOn: string | null = null;
    if (p.status === "paid") {
      const [line] = await q
        .select({ amount: incentiveCalcPayoutLines.amountPaise, paidOn: incentiveCalcPayouts.paidOn })
        .from(incentiveCalcPayoutLines)
        .innerJoin(incentiveCalcPayouts, eq(incentiveCalcPayouts.id, incentiveCalcPayoutLines.payoutId))
        .where(and(eq(incentiveCalcPayouts.periodId, p.id), eq(incentiveCalcPayoutLines.employeeId, employeeId)));
      if (line) {
        amount = Number(line.amount);
        paidOn = D(line.paidOn);
      }
    } else {
      const mine = (await payoutLines(q, p.programId, D(p.month), p.currentRunId)).find((l) => l.employeeId === employeeId);
      if (mine) amount = mine.amountPaise;
    }
    if (amount === null && !res) continue; // not one of this person's months
    months.push({
      month: D(p.month),
      programCode: code,
      programName: name,
      status: p.status as "approved" | "paid",
      amountPaise: amount ?? 0,
      releaseOn: p.releaseOn ? D(p.releaseOn) : null,
      paidOn,
      payoutReference: p.status === "paid" ? p.payoutReference : null,
      explanation: res ? res.explanation : [],
    });
  }
  // Months the person has a Category A result in that aren't approved yet: named, never valued.
  const pending = await q
    .select({ month: incentiveCalcPeriods.month })
    .from(incentiveCalcPeriods)
    .innerJoin(incentiveCalcResults, and(eq(incentiveCalcResults.runId, incentiveCalcPeriods.currentRunId), eq(incentiveCalcResults.employeeId, employeeId)))
    .where(and(eq(incentiveCalcPeriods.categoryCode, "A"), inArray(incentiveCalcPeriods.status, ["open", "locked", "submitted"])));
  return { ready: true, months, awaiting: [...new Set(pending.map((x) => D(x.month)))].sort().reverse() };
}
