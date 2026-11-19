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
import { calculateCategoryB } from "@/lib/incentives/category-b/engine";
import { inputsHashB, resultHashB } from "@/lib/incentives/category-b/hash";
import { ENGINE_VERSION_B, type CategoryBInput, type CategoryBResult } from "@/lib/incentives/category-b/types";
import { canonical } from "@/lib/incentives/category-a/hash";
import { allCategoriesFor, categoryBOrderIds, CALC_B_NOT_READY, incentiveCalcBReady, loadInputB } from "@/lib/queries/incentive-calc-b";
import { incentiveCalcBOverrides, incentiveCalcBQualifications, incentiveCalcCarry, incentiveCalcItems, incentiveCalcPeriodVoids } from "@/db/schema";
import { unattributedBlock } from "@/lib/queries/incentive-c-review";
import { calculateCategoryX } from "@/lib/incentives/categories/engine";
import { inputsHashX, resultHashX } from "@/lib/incentives/categories/hash";
import { ENGINE_VERSIONS, type CarryIn, type CarryOutcome, type CategoryXInput, type CategoryXResult, type ExtraCategory } from "@/lib/incentives/categories/types";
import { CALC_C_NOT_READY, CALC_X_NOT_READY, incentiveCalcCReady, incentiveCalcXReady, loadCarry, loadInputX } from "@/lib/queries/incentive-calc-x";

/** The categories the calculation workflow handles. Every function defaults to Category A, exactly as before. */
export type CalcCategory = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export const CALC_CATEGORIES: readonly CalcCategory[] = ["A", "B", "C", "D", "E", "F", "G"];
export { CALC_B_NOT_READY, incentiveCalcBReady, CALC_X_NOT_READY, incentiveCalcXReady };

/** One category's engine: how its month is read, calculated and hashed. */
interface Engine {
  version: string;
  load: (q: Db, programId: string, month: string, asOf: string) => Promise<CategoryAInput | CategoryBInput | CategoryXInput>;
  calculate: (input: never) => CategoryAResult | CategoryBResult | CategoryXResult;
  inputsHash: (input: never) => string;
  resultHash: (result: never) => string;
}
const ENGINES: Record<CalcCategory, Engine> = {
  A: { version: ENGINE_VERSION, load: (q, p, m, a) => loadInput(q, p, m, a), calculate: calculateCategoryA as (i: never) => CategoryAResult, inputsHash: inputsHash as (i: never) => string, resultHash: resultHash as (r: never) => string },
  B: { version: ENGINE_VERSION_B, load: (q, p, m, a) => loadInputB(q, p, m, a), calculate: calculateCategoryB as (i: never) => CategoryBResult, inputsHash: inputsHashB as (i: never) => string, resultHash: resultHashB as (r: never) => string },
  ...(Object.fromEntries(
    (["C", "D", "E", "F", "G"] as ExtraCategory[]).map((c) => [c, { version: ENGINE_VERSIONS[c], load: (q: Db, p: string, m: string, a: string) => loadInputX(q, c, p, m, a), calculate: calculateCategoryX as (i: never) => CategoryXResult, inputsHash: inputsHashX as (i: never) => string, resultHash: resultHashX as (r: never) => string }]),
  ) as Record<ExtraCategory, Engine>),
};
/** Category A needs 0132 + 0133; Category B also needs 0134. */
async function readyFor(category: CalcCategory, q: Db = db): Promise<string | null> {
  if (!(await incentiveCalcReady(q))) return CALC_NOT_READY;
  if (category !== "A" && !(await incentiveCalcBReady(q))) return CALC_B_NOT_READY;
  if (category !== "A" && category !== "B" && !(await incentiveCalcXReady(q))) return CALC_X_NOT_READY;
  if (category === "C" && !(await incentiveCalcCReady(q))) return CALC_C_NOT_READY;
  return null;
}

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
    // Only with Category B configured (0134): absent otherwise, so Category A's input is exactly what it always was.
    ...(config?.settings["basis.categoryBOrders"] === "exclude" ? { categoryBOrderIds: await categoryBOrderIds(q, programId) } : {}),
    ...(await allCategoriesFor(q, programId, month, "A", config).then((a) => (a ? { allCategories: a } : {}))),
  });
}

/* ── calculating ─────────────────────────────────────────────────────── */

/** Serialises one programme's category and month (Category A keeps its original lock key). */
const lockMonth = (tx: Tx, programId: string, month: string, category: CalcCategory = "A") => tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_calc'), hashtext(${category === "A" ? `${programId}|${month}` : `${programId}|${category}|${month}`}))`);

async function periodFor(tx: Tx, programId: string, month: string, category: CalcCategory = "A") {
  await tx.insert(incentiveCalcPeriods).values({ programId, categoryCode: category, month }).onConflictDoNothing();
  const [p] = await tx.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, category), eq(incentiveCalcPeriods.month, month))).for("update");
  return p!;
}

/** Each salesperson's OWN payable in a run: a minimum-payable run's own amount (before carried balances), else its payable. */
async function ownPayablesOf(tx: Tx, runId: string | null): Promise<Record<string, number>> {
  if (!runId) return {};
  const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const res = run?.result as { carryModel?: boolean; employees?: { employeeId: string; ownPayablePaise?: number; payablePaise: number }[] } | undefined;
  if (res?.carryModel) return Object.fromEntries((res.employees ?? []).map((e) => [e.employeeId, e.ownPayablePaise ?? e.payablePaise]));
  return payablesOf(tx, runId);
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
export async function calculate(actor: Actor, programId: string, month: string, asOfIn?: string, category: CalcCategory = "A"): Promise<Result<CalculateOutcome>> {
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  const asOf = asOfIn ?? todayIST();
  if (!isDay(asOf) || asOf < month) return { ok: false, error: "The calculation date must be on or after the month's first day." };
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  const [program] = await db.select({ id: incentivePrograms.id }).from(incentivePrograms).where(eq(incentivePrograms.id, programId)).limit(1);
  if (!program) return { ok: false, error: "That programme doesn't exist." };
  const engine = ENGINES[category];

  // One consistent snapshot of every input (REPEATABLE READ), serialised per programme, category and month. A
  // concurrent change that makes the snapshot unusable (serialization failure, deadlock) rolls everything back and the
  // calculation is tried again, at most CALC_ATTEMPTS times; then it says so. Nothing partial is ever saved or adopted.
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction((tx) => calculateIn(tx, actor, programId, month, asOf, category, engine), { isolationLevel: "repeatable read" });
    } catch (err) {
      if (!retryable(err)) throw err;
      if (attempt >= CALC_ATTEMPTS) return { ok: false, error: CALC_BUSY };
    }
  }
}

const CALC_ATTEMPTS = 3;
export const CALC_BUSY = "Other changes to these records were being saved at the same moment, so nothing was calculated or saved. Calculate again.";
/** A transaction rolled back by PostgreSQL because of a concurrent change (serialization failure or deadlock). */
const retryable = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return ["40001", "40P01"].includes(e?.code ?? e?.cause?.code ?? "");
};

async function calculateIn(tx: Tx, actor: Actor, programId: string, month: string, asOf: string, category: CalcCategory, engine: (typeof ENGINES)[CalcCategory]): Promise<Result<CalculateOutcome>> {
  {
    await lockMonth(tx, programId, month, category);
    const period = await periodFor(tx, programId, month, category);
    if (await voidOf(tx, period.id, category)) return { ok: false as const, error: VOIDED };
    const input = await engine.load(tx, programId, month, asOf);
    // A month that is no longer open keeps the carry-forward it was calculated with (its payout writes exactly that to
    // the ledger); only its own amount is recalculated, and a difference is carried as configured.
    if ((input as { carry?: unknown }).carry !== undefined && period.status !== "open" && period.currentRunId) {
      const [cur] = await tx.select({ inputs: incentiveCalcRuns.inputs }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
      const frozen = (cur?.inputs as { carry?: unknown } | undefined)?.carry;
      if (frozen !== undefined) (input as { carry: unknown }).carry = frozen;
    }
    const result = engine.calculate(input as never);
    const ih = engine.inputsHash(input as never);
    const rh = engine.resultHash(result as never);
    const [latest] = await tx.select({ id: incentiveCalcRuns.id, ih: incentiveCalcRuns.inputsHash, rh: incentiveCalcRuns.resultHash }).from(incentiveCalcRuns).where(and(eq(incentiveCalcRuns.programId, programId), eq(incentiveCalcRuns.categoryCode, category), eq(incentiveCalcRuns.month, month))).orderBy(desc(incentiveCalcRuns.computedAt)).limit(1);
    if (latest && (latest.ih === ih || latest.rh === rh)) return { ok: true as const, runId: latest.id, unchanged: true, adopted: false, status: result.status, outcome: "Nothing changed since the last calculation: no new run was recorded.", problems: result.problems };

    let currentSettled = false;
    if (period.currentRunId) {
      const [cur] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
      currentSettled = (cur?.result as CategoryAResult | undefined)?.settled === true;
    }
    const carriedRows = await tx.select({ e: incentiveCalcAdjustments.employeeId, a: incentiveCalcAdjustments.amountPaise }).from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, category), eq(incentiveCalcAdjustments.fromMonth, month), eq(incentiveCalcAdjustments.kind, "recalc-difference")));
    const carried: Record<string, number> = {};
    for (const r of carriedRows) if (r.e) carried[r.e] = (carried[r.e] ?? 0) + Number(r.a);
    // Differences are of each salesperson's OWN amount (a minimum-payable category's carried balances and adjustments
    // are settled through its ledger, never twice).
    const fresh = Object.fromEntries(result.employees.map((e) => [e.employeeId, (e as { ownPayablePaise?: number }).ownPayablePaise ?? e.payablePaise]));
    const settings = input.config?.settings ?? {};
    const decision = decide(settings, { month, status: period.status as PeriodStatus, hasCurrentRun: !!period.currentRunId, currentRunSettled: currentSettled, paidAt: period.paidAt ? period.paidAt.toISOString() : null }, asOf, result.status === "computed", { adopted: await ownPayablesOf(tx, period.currentRunId), fresh, carried });

    let rowVersion = period.rowVersion;
    if (decision.lockFirst) {
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: null, rowVersion: ++rowVersion, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, period.id));
    }
    let outcome = decision.outcome;
    const targetBlocked: string[] = [];
    for (const c of decision.carries) {
      const target = await periodFor(tx, programId, c.toMonth, category);
      if (target.status !== "open" || (await voidOf(tx, target.id, category))) targetBlocked.push(c.toMonth);
    }
    const carries = targetBlocked.length ? [] : decision.carries;
    if (targetBlocked.length) outcome = `${outcome.replace(/ The difference is carried.*$/, "")} It differs, but ${targetBlocked[0]!.slice(0, 7)} isn't open, so nothing was carried.`;

    const [run] = await tx
      .insert(incentiveCalcRuns)
      .values({ programId, categoryCode: category, month, asOf, configVersionId: result.configVersionId, configVersionNo: result.configVersionNo, engineVersion: result.engineVersion, status: result.status, adopted: decision.adopt, outcome, inputsHash: ih, resultHash: rh, inputs: input, result, computedById: actor.id, computedByName: actor.name })
      .returning({ id: incentiveCalcRuns.id });
    const runId = run!.id;
    if (result.employees.length)
      await tx.insert(incentiveCalcResults).values(
        result.employees.map((e) =>
          "pool" in e
            ? { runId, employeeId: e.employeeId, employeeName: e.name, salesPaise: e.salesPaise, qualified: e.qualified, poolExact: e.pool, earnedExact: e.earnedExact, payableExact: e.payableExact, earnedPaise: e.earnedPaise, payablePaise: e.payablePaise, pendingPaise: e.pendingPaise, projectedPaise: e.projectedPaise, explanation: [...e.explanation, ...e.limits] }
            : { runId, employeeId: e.employeeId, employeeName: e.name, salesPaise: e.salesPaise, qualified: e.qualified, poolExact: e.baseExact, earnedExact: e.earnedExact, payableExact: e.payableExact, earnedPaise: e.earnedPaise, payablePaise: e.payablePaise, pendingPaise: e.pendingPaise, projectedPaise: e.projectedPaise, explanation: [...e.explanation, ...e.limits] },
        ),
      );
    // Categories C–G: every credited item, with what it earned and why.
    if ("items" in result && result.items.length)
      await tx.insert(incentiveCalcItems).values(result.items.map((i) => ({ runId, employeeId: i.employeeId, lineCode: i.lineCode, sourceType: i.sourceType, sourceId: i.sourceId, label: i.label, sharePpm: i.sharePpm, baseExact: i.baseExact, earnedExact: i.earnedExact, payableExact: i.payableExact, multiplierPpm: i.multiplierPpm, status: i.status, explanation: i.explanation })));
    // Category B: every order's qualification, with its evidence (one row per order of the month).
    if ("qualifications" in result && result.qualifications.length)
      await tx.insert(incentiveCalcBQualifications).values(
        result.qualifications.map((x) => ({ runId, orderDocumentId: x.orderId, orderNo: x.orderNo, orderDate: x.orderDate, customerMasterId: x.customerId, customerName: x.customerName, outcome: x.outcome, automaticOutcome: x.automatic, overrideId: x.override?.id ?? null, overrideDecision: x.override?.decision ?? null, overrideById: x.override?.byId ?? null, invoiceDocumentId: x.invoiceId, invoiceNo: x.invoiceNo, invoiceDate: x.invoiceDate, invoiceMonth: x.invoiceMonth, taxablePaise: x.taxablePaise, netTaxablePaise: x.netTaxablePaise, baseExact: x.baseExact, inMonth: x.inMonth, pinned: x.pinned, reasons: x.reasons, evidence: x.evidence })),
      );
    if ("units" in result && result.units.length)
      await tx.insert(incentiveCalcOrderCredits).values(result.units.map((u) => ({ runId, employeeId: u.employeeId, documentId: u.unitId, documentType: u.unitType, documentNo: u.unitNo, sharePpm: u.sharePpm, valuePaise: u.valuePaise, collectiblePaise: u.collectiblePaise, collectedPaise: u.collectedPaise, fullyCollected: u.fullyCollected, takesShare: u.takesShare, allocatedExact: u.allocated, earnedExact: u.earnedExact, payableExact: u.payableExact, explanation: u.explanation })));
    if ("pieces" in result && result.pieces.length)
      await tx.insert(incentiveCalcReceiptCredits).values(result.pieces.map((p) => ({ runId, employeeId: p.employeeId, receiptDocumentId: p.receiptId, invoiceDocumentId: p.invoiceId, unitDocumentId: p.unitId, receiptNo: p.receiptNo, receiptDate: p.receiptDate, amountPaise: p.amountPaise, referenceDate: p.referenceDate, delayDays: p.delayDays, multiplierPpm: p.multiplierPpm, earnedExact: p.earnedExact, status: p.status, note: p.note })));
    if (decision.adopt) await tx.update(incentiveCalcPeriods).set({ currentRunId: runId, rowVersion: ++rowVersion, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, period.id));
    const names = new Map(result.employees.map((e) => [e.employeeId, e.name]));
    for (const c of carries)
      await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: category, fromMonth: month, toMonth: c.toMonth, employeeId: c.employeeId, employeeName: names.get(c.employeeId) ?? input.employees.find((e) => e.id === c.employeeId)?.name ?? "Former employee", kind: "recalc-difference", amountPaise: c.amountPaise, sourceRunId: runId, note: outcome, createdById: actor.id });
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "calculated", entityType: "incentive-calc-period", entityId: period.id, detail: { month, asOf, runId, status: result.status, adopted: decision.adopt, configVersionId: result.configVersionId, inputsHash: ih, resultHash: rh, outcome, ...(category === "A" ? {} : { category }) } });
    return { ok: true as const, runId, unchanged: false, adopted: decision.adopt, status: result.status, outcome, problems: result.problems };
  }
}

/** Lock a calculated open month (negative balances handled as configured), or reopen a locked one. */
export async function setLocked(actor: Actor, programId: string, month: string, lock: boolean, expectedRowVersion: number, category: CalcCategory = "A"): Promise<Result<{ rowVersion: number; notes: string[] }>> {
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  return db.transaction(async (tx) => {
    await lockMonth(tx, programId, month, category);
    const [p] = await tx.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, category), eq(incentiveCalcPeriods.month, month))).for("update");
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: "The month was changed by someone else meanwhile. Nothing was changed; reload to see it as it is now." };
    if (await voidOf(tx, p.id, category)) return { ok: false as const, error: VOIDED };
    const notes: string[] = [];
    if (lock) {
      if (p.status !== "open") return { ok: false as const, error: `The month is ${p.status}, not open.` };
      if (!p.currentRunId) return { ok: false as const, error: "Calculate the month before locking it." };
      const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, p.currentRunId));
      const settings = ((run!.result as CategoryAResult).settingsUsed ?? {}) as Record<string, string | number | string[]>;
      const payable = await payablesOf(tx, p.currentRunId);
      const incoming = await tx.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, category), eq(incentiveCalcAdjustments.toMonth, month)));
      const carryRun = (run!.result as { carryModel?: boolean; employees?: { employeeId: string; netPaise?: number }[] }).carryModel ? (run!.result as { employees: { employeeId: string; netPaise?: number }[] }).employees : null;
      // A minimum-payable run's month total already includes its carried balances and the adjustments carried in.
      const net: Record<string, number> = carryRun ? Object.fromEntries(carryRun.map((e) => [e.employeeId, e.netPaise ?? 0])) : { ...payable };
      const left: Record<string, number | null> = {};
      const names: Record<string, string> = {};
      for (const a of incoming) {
        if (!a.employeeId) continue;
        if (!carryRun) net[a.employeeId] = (net[a.employeeId] ?? 0) + Number(a.amountPaise);
        names[a.employeeId] = a.employeeName;
        if (a.kind === "negative-carry" && a.monthsLeft !== null) left[a.employeeId] = Math.min(left[a.employeeId] ?? Infinity, a.monthsLeft);
      }
      const resultNames = await tx.select({ e: incentiveCalcResults.employeeId, n: incentiveCalcResults.employeeName }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, p.currentRunId));
      for (const r of resultNames) if (r.e) names[r.e] = r.n;
      for (const [e, n] of Object.entries(net).sort()) {
        const nb = negativeBalance(settings, month, n, left[e] ?? null);
        if (!nb) continue;
        if (nb.toMonth) await periodFor(tx, programId, nb.toMonth, category);
        await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: category, fromMonth: month, toMonth: nb.toMonth, employeeId: e, employeeName: names[e] ?? "Former employee", kind: nb.kind, amountPaise: nb.amountPaise, monthsLeft: nb.monthsLeft, sourceRunId: p.currentRunId, note: nb.note, createdById: actor.id }).onConflictDoNothing();
        notes.push(`${names[e] ?? e}: ${nb.note}`);
      }
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: actor.id, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    } else {
      if (p.status !== "locked") return { ok: false as const, error: p.status === "open" ? "The month is already open." : `An ${p.status} month can't be reopened.` };
      await tx.update(incentiveCalcPeriods).set({ status: "open", rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    }
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: lock ? "locked" : "reopened", entityType: "incentive-calc-period", entityId: p.id, detail: { month, notes, ...(category === "A" ? {} : { category }) } });
    return { ok: true as const, rowVersion: p.rowVersion + 1, notes };
  });
}

/* ── approval and payout ─────────────────────────────────────────────── */

/** What each salesperson is owed for a month: the adopted run's payable plus every adjustment carried INTO the month, never below zero (a negative balance is carried at lock). The payout reconciles against this. */
export async function payoutLines(q: Db, programId: string, month: string, runId: string, category: CalcCategory = "A") {
  const results = await q.select().from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, runId));
  const [run] = await q.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  if ((run?.result as { carryModel?: boolean } | undefined)?.carryModel)
    // A minimum-payable month: each line is what is RELEASED — this month's amount with the balances carried forward and
    // the adjustments carried in (shown in the calculation); nothing is added twice.
    return results.filter((r) => r.employeeId).sort((a, b) => (a.employeeId! < b.employeeId! ? -1 : 1)).map((r) => ({ employeeId: r.employeeId!, employeeName: r.employeeName, payablePaise: Number(r.payablePaise), adjustmentsPaise: 0, amountPaise: Math.max(0, Number(r.payablePaise)) }));
  const incoming = await q.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, category), eq(incentiveCalcAdjustments.toMonth, month)));
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

async function periodRow(tx: Tx, programId: string, month: string, category: CalcCategory = "A") {
  await lockMonth(tx, programId, month, category);
  const [p] = await tx.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, category), eq(incentiveCalcPeriods.month, month))).for("update");
  return p ?? null;
}
/**
 * Why a month's adopted calculation can't be submitted or approved, or null. It must be a computed run of the current
 * engine of its category whose STORED inputs still give exactly its STORED result (so nothing about it was changed or
 * lost since), with all its stored rows.
 */
async function invalidCalculation(tx: Tx, runId: string | null): Promise<string | null> {
  if (!runId) return "The month has no adopted calculation.";
  const [run] = await tx.select().from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  if (!run) return "The month's calculation can't be found.";
  if (run.status !== "computed" || !run.configVersionId) return "The month's calculation was blocked, so there is nothing to approve.";
  const engine = ENGINES[run.categoryCode as CalcCategory];
  if (!engine) return `Category ${run.categoryCode} can't be approved here.`;
  if (run.engineVersion !== engine.version) return `The month was calculated by an earlier engine (${run.engineVersion}); reopen and recalculate it first.`;
  let again: CategoryAResult | CategoryBResult | CategoryXResult;
  try {
    again = engine.calculate(run.inputs as never);
  } catch {
    return "The month's stored calculation inputs can't be read; reopen and recalculate it.";
  }
  if (again.status !== "computed" || engine.resultHash(again as never) !== run.resultHash || engine.inputsHash(run.inputs as never) !== run.inputsHash) return "The month's stored calculation doesn't reproduce its own result; reopen and recalculate it before approval.";
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, runId))) as [{ n: number }];
  if (n !== again.employees.length) return "The month's stored results are incomplete; reopen and recalculate it.";
  if ("items" in again) {
    const [{ k }] = (await tx.select({ k: sql<number>`count(*)::int` }).from(incentiveCalcItems).where(eq(incentiveCalcItems.runId, runId))) as [{ k: number }];
    if (k !== again.items.length) return "The month's stored items are incomplete; reopen and recalculate it.";
  }
  if ("qualifications" in again) {
    const [{ m }] = (await tx.select({ m: sql<number>`count(*)::int` }).from(incentiveCalcBQualifications).where(eq(incentiveCalcBQualifications.runId, runId))) as [{ m: number }];
    if (m !== again.qualifications.length) return "The month's stored qualification evidence is incomplete; reopen and recalculate it.";
  }
  return null;
}

/**
 * When the month shares the all-categories limit with another category: why its calculation is out of date because
 * the other category's figures changed since (it must be recalculated before it is submitted), or null.
 */
async function staleAllCategories(tx: Tx, programId: string, month: string, runId: string, category: CalcCategory): Promise<string | null> {
  const [run] = await tx.select({ inputs: incentiveCalcRuns.inputs, resultHash: incentiveCalcRuns.resultHash }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const used = (run?.inputs as { allCategories?: unknown; config?: never } | undefined)?.allCategories;
  if (!used) return null;
  const now = await allCategoriesFor(tx, programId, month, category, (run!.inputs as { config: never }).config);
  if (canonical(now ?? null) === canonical(used)) return null;
  // The other categories' figures changed: stale only if they now change THIS month's result.
  const engine = ENGINES[category];
  const { allCategories: _old, ...rest } = run!.inputs as Record<string, unknown>;
  const again = engine.calculate((now ? { ...rest, allCategories: now } : rest) as never);
  if (engine.resultHash(again as never) === run!.resultHash) return null;
  return `The other categories' figures for ${month.slice(0, 7)} changed since this month was calculated, and they change its share of the all-categories limit: reopen and recalculate it before submitting.`;
}

/* ── the below-minimum carry-forward ledger (0136) ────────────────────── */

type CarryEmployee = { employeeId: string; name: string; carry?: CarryOutcome };
/** A minimum-payable run's per-salesperson carry outcome, or null for any other run. */
async function carryResultOf(tx: Tx, runId: string): Promise<CarryEmployee[] | null> {
  const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const res = run?.result as { carryModel?: boolean; employees?: CarryEmployee[] } | undefined;
  return res?.carryModel ? (res.employees ?? []) : null;
}

/**
 * Whether the carry-forward a minimum-payable month was calculated with is EXACTLY the one in force now (STRICT): the
 * same balances — none used up, written off, or newly held by an earlier month's payout since — each with the same
 * amount left, and the same adjustments carried into the month. Checked at submission and at payout, so a month is
 * never approved or paid on a carry-forward that is no longer true (it is reopened and recalculated). Why not, or null.
 */
async function staleCarry(tx: Tx, programId: string, month: string, runId: string, category: CalcCategory): Promise<string | null> {
  const [run] = await tx.select({ inputs: incentiveCalcRuns.inputs, result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  if (!(run?.result as { carryModel?: boolean } | undefined)?.carryModel) return null;
  const used = ((run!.inputs as { carry?: CarryIn[] }).carry ?? []) as CarryIn[];
  const now = await loadCarry(tx, programId, category, month);
  const lots = (xs: CarryIn[]) => JSON.stringify(xs.flatMap((c) => c.lots.map((l) => [l.id, c.employeeId, l.remainingPaise] as const)).sort());
  const adj = (xs: CarryIn[]) => JSON.stringify(xs.filter((c) => c.adjustmentsPaise).map((c) => [c.employeeId, c.adjustmentsPaise]).sort());
  if (lots(used) !== lots(now) || adj(used) !== adj(now)) return `The carried-forward balances or the adjustments carried into ${month.slice(0, 7)} changed since this month was calculated: reopen and recalculate it before submitting or paying.`;
  return null;
}

/* ── voided months (0136) ─────────────────────────────────────────────── */

const VOIDED = "This month was voided: it is kept for the record and is never calculated, locked, reopened, submitted, approved, rejected or paid again.";
/** A Category C month's void, or null (other categories are never voided; the table exists only with 0136). */
async function voidOf(tx: Tx, periodId: string, category: CalcCategory) {
  if (category !== "C") return null;
  const [v] = await tx.select().from(incentiveCalcPeriodVoids).where(eq(incentiveCalcPeriodVoids.periodId, periodId));
  return v ?? null;
}
/**
 * Category C's months whose payout comes first: EARLIER months with an adopted calculation that are neither paid nor
 * voided (their carried-forward balances come first). Months are submitted and paid in order.
 */
async function unpaidEarlier(tx: Tx, programId: string, month: string, category: CalcCategory): Promise<string[]> {
  const rows = await tx
    .select({ month: incentiveCalcPeriods.month })
    .from(incentiveCalcPeriods)
    .where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, category), sql`${incentiveCalcPeriods.month} < ${month}::date`, sql`${incentiveCalcPeriods.currentRunId} is not null`, sql`${incentiveCalcPeriods.status} <> 'paid'`, category === "C" ? sql`not exists (select 1 from incentive_calc_period_voids v where v.period_id = ${incentiveCalcPeriods.id})` : sql`true`));
  return rows.map((r) => D(r.month)!.slice(0, 7)).sort();
}

/** Writes a paid month's carry outcome to the ledger: what its balances did, and any new balance it holds. */
async function writeCarry(tx: Tx, actor: Actor, programId: string, category: CalcCategory, month: string, periodId: string, runId: string, employees: CarryEmployee[]) {
  for (const e of employees) {
    if (!e.carry) continue;
    for (const l of e.carry.lots) {
      if (l.outcome === "carried" || l.amountPaise <= 0) continue;
      await tx.insert(incentiveCalcCarry).values({ programId, categoryCode: category, employeeId: e.employeeId, employeeName: e.name, month, kind: l.outcome, amountPaise: -l.amountPaise, lotId: l.lotId, periodId, runId, createdById: actor.id, createdByName: actor.name });
    }
    if (e.carry.heldPaise > 0) {
      const [held] = await tx.insert(incentiveCalcCarry).values({ programId, categoryCode: category, employeeId: e.employeeId, employeeName: e.name, month, kind: "held", amountPaise: e.carry.heldPaise, periodId, runId, createdById: actor.id, createdByName: actor.name }).returning({ id: incentiveCalcCarry.id });
      if (e.carry.heldExpires) await tx.insert(incentiveCalcCarry).values({ programId, categoryCode: category, employeeId: e.employeeId, employeeName: e.name, month, kind: "expired", amountPaise: -e.carry.heldPaise, lotId: held!.id, periodId, runId, reason: "Not released (the configuration in force).", createdById: actor.id, createdByName: actor.name });
    }
  }
}

export interface CarryBalance {
  lotId: string;
  employeeId: string | null;
  employeeName: string;
  month: string;
  heldPaise: number;
  remainingPaise: number;
  entries: { kind: string; month: string; amountPaise: number; byName: string; reason: string | null; at: string }[];
}
/** Every balance a programme's category ever carried forward, with what happened to it (the ledger). Reads only. */
export async function carryBalances(programId: string, category: CalcCategory, q: Q = db): Promise<CarryBalance[]> {
  if (!(await incentiveCalcCReady(q))) return [];
  const rows = await q.select().from(incentiveCalcCarry).where(and(eq(incentiveCalcCarry.programId, programId), eq(incentiveCalcCarry.categoryCode, category))).orderBy(asc(incentiveCalcCarry.createdAt));
  return rows
    .filter((r) => r.kind === "held")
    .map((h) => {
      const used = rows.filter((r) => r.lotId === h.id);
      return { lotId: h.id, employeeId: h.employeeId, employeeName: h.employeeName, month: D(h.month)!, heldPaise: Number(h.amountPaise), remainingPaise: Number(h.amountPaise) + used.reduce((a, r) => a + Number(r.amountPaise), 0), entries: used.map((r) => ({ kind: r.kind, month: D(r.month)!, amountPaise: Number(r.amountPaise), byName: r.createdByName, reason: r.reason, at: r.createdAt.toISOString() })) };
    });
}

/**
 * An authorised write-off of what remains of a carried-forward balance, with its reason (recorded in the ledger; never
 * edited). Refused while a month awaiting payout counts the balance — its payout would use it.
 */
export async function writeOffCarry(actor: Actor, lotId: string, reason: string): Promise<Result<{ amountPaise: number }>> {
  const why = (reason ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(lotId)) return { ok: false, error: "That balance doesn't exist." };
  if (!why) return { ok: false, error: "Give the reason for writing it off (it is kept with it)." };
  if (why.length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcCReady(db))) return { ok: false, error: CALC_C_NOT_READY };
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(incentiveCalcCarry).where(eq(incentiveCalcCarry.id, lotId));
    if (!lot || lot.kind !== "held") return { ok: false as const, error: "That balance doesn't exist." };
    const [left] = rowsOf<{ r: string }>(await tx.execute(sql`select (${lot.amountPaise}::bigint + coalesce((select sum(amount_paise) from incentive_calc_carry where lot_id = ${lotId}), 0))::text as r`));
    const remaining = Number(left?.r ?? 0);
    if (remaining <= 0) return { ok: false as const, error: "Nothing of that balance is left." };
    const pending = rowsOf<{ month: string }>(await tx.execute(sql`
      select p.month::text as month from incentive_calc_periods p join incentive_calc_runs r on r.id = p.current_run_id
      where p.program_id = ${lot.programId} and p.category_code = ${lot.categoryCode} and p.status in ('locked', 'submitted', 'approved')
        and not exists (select 1 from incentive_calc_period_voids v where v.period_id = p.id)
        and exists (select 1 from jsonb_array_elements(coalesce(r.inputs->'carry', '[]'::jsonb)) c, jsonb_array_elements(c->'lots') l where l->>'id' = ${lotId})`));
    if (pending.length) return { ok: false as const, error: `${pending.map((x) => x.month.slice(0, 7)).join(", ")} counts this balance and awaits payout: pay or reopen it first. Nothing was written off.` };
    await tx.insert(incentiveCalcCarry).values({ programId: lot.programId, categoryCode: lot.categoryCode, employeeId: lot.employeeId, employeeName: lot.employeeName, month: `${todayIST().slice(0, 7)}-01`, kind: "written-off", amountPaise: -remaining, lotId, reason: why, createdById: actor.id, createdByName: actor.name });
    return { ok: true as const, amountPaise: remaining };
  });
}

/**
 * Category B separation of duties: whoever recorded or retired a manual qualification decision on any Sales Order of
 * the month's calculation never approves or rejects that month (the database refuses it too, 0134).
 */
async function decidedByHand(tx: Tx, runId: string, actorId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: incentiveCalcBOverrides.id })
    .from(incentiveCalcBOverrides)
    .innerJoin(incentiveCalcBQualifications, eq(incentiveCalcBQualifications.orderDocumentId, incentiveCalcBOverrides.orderDocumentId))
    .where(and(eq(incentiveCalcBQualifications.runId, runId), or(eq(incentiveCalcBOverrides.createdById, actorId), eq(incentiveCalcBOverrides.retiredById, actorId))))
    .limit(1);
  return rows.length > 0;
}

/**
 * Category C separation of duties: whoever recorded or retired a review decision on any record of the month's
 * calculation (its stored inputs) never approves or rejects that month (the database refuses it too, 0136).
 */
async function reviewedByHand(tx: Tx, runId: string, actorId: string): Promise<boolean> {
  const r = await tx.execute(sql`
    select exists (
      select 1 from incentive_calc_runs run
      cross join lateral jsonb_array_elements(coalesce(run.inputs->'orders', '[]'::jsonb) || coalesce(run.inputs->'invoices', '[]'::jsonb) || coalesce(run.inputs->'creditNotes', '[]'::jsonb) || coalesce(run.inputs->'receipts', '[]'::jsonb)) d
      join incentive_calc_c_reviews r on r.document_id::text = d->>'id'
      where run.id = ${runId} and (r.created_by_id = ${actorId} or r.retired_by_id = ${actorId})
    ) as yes`);
  const rows = (Array.isArray(r) ? r : ((r as unknown as { rows?: unknown[] }).rows ?? [])) as { yes: boolean }[];
  return rows[0]?.yes === true;
}

async function settingsOfRun(tx: Tx, runId: string) {
  const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  return ((run?.result as CategoryAResult | undefined)?.settingsUsed ?? {}) as Record<string, unknown>;
}
/** The calculation date of a run (the end of the range its unattributed-record check covers). */
async function asOfRun(tx: Tx, runId: string): Promise<string> {
  const [r] = await tx.select({ asOf: incentiveCalcRuns.asOf }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  return D(r!.asOf)!;
}
const nextMonthStart = (day: string) => {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const withCategory = (category: CalcCategory, detail: Record<string, unknown>) => (category === "A" ? detail : { ...detail, category });

/** Submit a locked month for approval. The number of approvals is the one its adopted calculation's configuration says. */
export async function submitMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number, category: CalcCategory = "A"): Promise<Result<{ rowVersion: number; approvalsRequired: number }>> {
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month, category);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (await voidOf(tx, p.id, category)) return { ok: false as const, error: VOIDED };
    if (p.status !== "locked") return { ok: false as const, error: `Only a locked month is submitted; this one is ${p.status}.` };
    const invalid = await invalidCalculation(tx, p.currentRunId);
    if (invalid) return { ok: false as const, error: invalid };
    // A minimum-payable month is submitted in order: every earlier month is paid (or voided) first, so the
    // carry-forward it was calculated with is final — and it must be exactly the one in force now (strict).
    if (await carryResultOf(tx, p.currentRunId!)) {
      const earlier = await unpaidEarlier(tx, programId, month, category);
      if (earlier.length) return { ok: false as const, error: `Submit Category ${category}'s months in order: ${earlier.join(", ")} isn't paid or voided yet (its carried-forward balances come first). Nothing was submitted.` };
    }
    const stale = (await staleAllCategories(tx, programId, month, p.currentRunId!, category)) ?? (await staleCarry(tx, programId, month, p.currentRunId!, category));
    if (stale) return { ok: false as const, error: stale };
    // Category C: every unattributed Forms record in the range its rule looks at is decided first (fail-closed).
    if (category === "C") {
      const blocked = await unattributedBlock(tx, await settingsOfRun(tx, p.currentRunId!), month, await asOfRun(tx, p.currentRunId!), "submit");
      if (blocked) return { ok: false as const, error: blocked };
    }
    const steps = (await settingsOfRun(tx, p.currentRunId!))["payout.approvalSteps"];
    if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1 || steps > 3) return { ok: false as const, error: "The configuration this month was calculated with doesn't say how many approvals a payout needs." };
    await tx.update(incentiveCalcPeriods).set({ status: "submitted", submissionNo: p.submissionNo + 1, submittedAt: new Date(), submittedById: actor.id, approvalsRequired: steps, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "submitted", entityType: "incentive-calc-period", entityId: p.id, detail: withCategory(category, { month, submissionNo: p.submissionNo + 1, approvalsRequired: steps, runId: p.currentRunId }) });
    return { ok: true as const, rowVersion: p.rowVersion + 1, approvalsRequired: steps };
  });
}

/** Withdraw a submission (back to locked), only by the person who submitted it, before any approval. */
export async function withdrawMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number, category: CalcCategory = "A"): Promise<Result<{ rowVersion: number }>> {
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month, category);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (await voidOf(tx, p.id, category)) return { ok: false as const, error: VOIDED };
    if (p.status !== "submitted") return { ok: false as const, error: "Only a submitted month can be withdrawn." };
    if (p.submittedById !== actor.id) return { ok: false as const, error: "Only the person who submitted it can withdraw it." };
    const [done] = await tx.select({ n: sql<number>`count(*)::int` }).from(incentiveCalcApprovals).where(and(eq(incentiveCalcApprovals.periodId, p.id), eq(incentiveCalcApprovals.submissionNo, p.submissionNo)));
    if ((done?.n ?? 0) > 0) return { ok: false as const, error: "It already has an approval; it can only be rejected now." };
    await tx.update(incentiveCalcPeriods).set({ status: "locked", rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "withdrawn", entityType: "incentive-calc-period", entityId: p.id, detail: withCategory(category, { month, submissionNo: p.submissionNo }) });
    return { ok: true as const, rowVersion: p.rowVersion + 1 };
  });
}

/**
 * Approve the next step of a submitted month, or reject it (with a reason; back to locked). The last approval
 * approves the month and sets when it is released, as the configuration says ("When an approved payout is released").
 */
export async function decideMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number, decision: "approve" | "reject", reason: string | null, today: string = todayIST(), category: CalcCategory = "A"): Promise<Result<{ rowVersion: number; status: string; step: number }>> {
  const why = (reason ?? "").trim() || null;
  if (decision === "reject" && !why) return { ok: false, error: "Give the reason for rejecting it." };
  if ((why ?? "").length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month, category);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (await voidOf(tx, p.id, category)) return { ok: false as const, error: VOIDED };
    if (p.status !== "submitted") return { ok: false as const, error: "Only a submitted month is approved or rejected." };
    if (p.submittedById === actor.id) return { ok: false as const, error: "You submitted this month, so you can't approve or reject it." };
    if (category === "B" && p.currentRunId && (await decidedByHand(tx, p.currentRunId, actor.id))) return { ok: false as const, error: "You decided a Sales Order's Category B qualification by hand in this month, so you can't approve or reject it. Another authorised person must." };
    if (category === "C" && p.currentRunId && (await reviewedByHand(tx, p.currentRunId, actor.id))) return { ok: false as const, error: "You decided a Category C review case of this month, so you can't approve or reject it. Another authorised person must." };
    const prior = await tx.select().from(incentiveCalcApprovals).where(and(eq(incentiveCalcApprovals.periodId, p.id), eq(incentiveCalcApprovals.submissionNo, p.submissionNo)));
    if (prior.some((a) => a.actorId === actor.id)) return { ok: false as const, error: "You already approved a step of this submission; the next step needs someone else." };
    const step = prior.length + 1;
    if (decision === "approve") {
      const invalid = await invalidCalculation(tx, p.currentRunId);
      if (invalid) return { ok: false as const, error: `${invalid} (Reject it with that reason.)` };
      // Category C: everything checked at submission is checked again — the carry-forward must still be exactly the
      // one calculated, and every unattributed record in range decided. A rejection is always possible.
      if (category === "C") {
        const stale = await staleCarry(tx, programId, month, p.currentRunId!, category);
        if (stale) return { ok: false as const, error: `${stale.replace(/ before submitting or paying\.$/, ".")} Reject it so it is recalculated and submitted again. Nothing was approved.` };
        const blocked = await unattributedBlock(tx, await settingsOfRun(tx, p.currentRunId!), month, await asOfRun(tx, p.currentRunId!), "approve");
        if (blocked) return { ok: false as const, error: blocked };
      }
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
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: decision === "approve" ? "approved" : "rejected", entityType: "incentive-calc-period", entityId: p.id, detail: withCategory(category, { month, submissionNo: p.submissionNo, step, reason: why, status }) });
    return { ok: true as const, rowVersion: p.rowVersion + 1, status, step };
  });
}

/**
 * Record that an approved month was paid: one payout per month, with each salesperson's amount (payable + adjustments
 * carried into the month, never below zero). A RECORD only — the WMS moves no money.
 */
export async function recordPayout(actor: Actor, programId: string, month: string, expectedRowVersion: number, input: { reference: string; paidOn: string; amountPaise: number; note: string | null }, today: string = todayIST(), category: CalcCategory = "A"): Promise<Result<{ rowVersion: number; totalPaise: number }>> {
  const reference = input.reference.trim();
  if (!reference || reference.length > 200) return { ok: false, error: "Give the payout reference (up to 200 characters)." };
  if (!isDay(input.paidOn)) return { ok: false, error: "Give the date it was paid." };
  if (input.paidOn > today) return { ok: false, error: "A payout is recorded once it is made: the date paid can't be in the future." };
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0) return { ok: false, error: "Give the amount paid." };
  if ((input.note ?? "").length > 1000) return { ok: false, error: "The note is longer than 1,000 characters." };
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month, category);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (await voidOf(tx, p.id, category)) return { ok: false as const, error: VOIDED };
    if (p.status === "paid") return { ok: false as const, error: "This month's payout is already recorded." };
    if (p.status !== "approved") return { ok: false as const, error: "Only an approved month is paid." };
    const releaseOn = D(p.releaseOn)!;
    if (input.paidOn < releaseOn) return { ok: false as const, error: `It is released on ${releaseOn}; a payout can't be dated before that.` };
    const carryResult = await carryResultOf(tx, p.currentRunId!);
    if (carryResult) {
      const earlier = await unpaidEarlier(tx, programId, month, category);
      if (earlier.length) return { ok: false as const, error: `Pay Category ${category}'s months in order: ${earlier.join(", ")} isn't paid or voided yet (its carried-forward balances come first). Nothing was recorded.` };
      const staleC = await staleCarry(tx, programId, month, p.currentRunId!, category);
      if (staleC) return { ok: false as const, error: staleC };
    }
    // Category C: an unattributed record that arrived after the approval stops the payout until it is decided.
    if (category === "C") {
      const blocked = await unattributedBlock(tx, await settingsOfRun(tx, p.currentRunId!), month, await asOfRun(tx, p.currentRunId!), "pay");
      if (blocked) return { ok: false as const, error: blocked };
    }
    const out = await payoutLines(tx, programId, month, p.currentRunId!, category);
    const total = out.reduce((s, l) => s + l.amountPaise, 0);
    // Reconciliation: the amount paid must be exactly the approved amount. No published setting permits a partial
    // payout, so a different amount is refused (nothing is recorded) and both figures are shown.
    if (input.amountPaise !== total) return { ok: false as const, error: `The amount paid (₹${(input.amountPaise / 100).toFixed(2)}) doesn't match the approved amount (₹${(total / 100).toFixed(2)}). Partial payouts aren't permitted by the configuration; nothing was recorded.` };
    const [payout] = await tx.insert(incentiveCalcPayouts).values({ periodId: p.id, runId: p.currentRunId!, reference, releaseOn, paidOn: input.paidOn, totalPaise: total, note: input.note?.trim() || null, recordedById: actor.id, recordedByName: actor.name }).returning({ id: incentiveCalcPayouts.id });
    if (out.length) await tx.insert(incentiveCalcPayoutLines).values(out.map((l) => ({ payoutId: payout!.id, ...l })));
    // The carry-forward ledger, written once with the payout (the database refuses a balance used twice).
    if (carryResult) await writeCarry(tx, actor, programId, category, month, p.id, p.currentRunId!, carryResult);
    await tx.update(incentiveCalcPeriods).set({ status: "paid", paidAt: new Date(), paidById: actor.id, payoutReference: reference, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "paid", entityType: "incentive-calc-period", entityId: p.id, detail: withCategory(category, { month, reference, paidOn: input.paidOn, totalPaise: total, runId: p.currentRunId }) });
    return { ok: true as const, rowVersion: p.rowVersion + 1, totalPaise: total };
  });
}

/**
 * Void an abandoned, UNPAID Category C month (0136), by an authorised person with a reason, so it no longer blocks the
 * months after it. Only an OPEN or LOCKED month (a submitted or approved one is withdrawn or rejected first; a paid one
 * never), with a settled, adopted calculation and nothing held for review. Nothing is forfeited or deleted:
 *   · its calculations stay as they are (for the record);
 *   · the balances it counted were never consumed (the ledger is written only by a payout), so they stay carried
 *     forward to the next month;
 *   · each salesperson's own amount and the adjustments carried into it — less what its lock already carried or
 *     resolved (a negative balance carried, written off or recovered) — are carried into the NEXT month, which must be
 *     open, as adjustments (recorded, and recalculated there with everything else).
 * One transaction, under the month's lock and then the next month's (the same order everywhere), so a payout,
 * submission or calculation of either can't happen at the same moment; the database refuses a second void, and a void
 * of a month that isn't open or locked.
 */
export async function voidMonth(actor: Actor, programId: string, month: string, expectedRowVersion: number, reason: string, category: CalcCategory = "C"): Promise<Result<{ rowVersion: number; carriedToMonth: string | null; carriedPaise: number }>> {
  if (category !== "C") return { ok: false, error: "Only a Category C month is voided (its months are paid in order)." };
  if (!isMonthStart(month)) return { ok: false, error: "Choose a month." };
  const why = (reason ?? "").trim();
  if (!why) return { ok: false, error: "Give the reason for voiding the month (it is kept with it)." };
  if (why.length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  const notReady = await readyFor(category);
  if (notReady) return { ok: false, error: notReady };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, programId, month, category);
    if (!p) return { ok: false as const, error: "That month hasn't been calculated yet: there is nothing to void." };
    if (p.rowVersion !== expectedRowVersion) return { ok: false as const, error: STALE };
    if (await voidOf(tx, p.id, category)) return { ok: false as const, error: "This month is already voided." };
    if (p.status === "paid") return { ok: false as const, error: "A paid month is never voided." };
    if (p.status === "submitted" || p.status === "approved") return { ok: false as const, error: `The month is ${p.status}: ${p.status === "submitted" ? "withdraw it, or have it rejected," : "have it rejected"} first. Nothing was voided.` };
    if (p.status !== "open" && p.status !== "locked") return { ok: false as const, error: `A ${p.status} month can't be voided.` };
    if (!p.currentRunId) return { ok: false as const, error: "The month has no adopted calculation, so it doesn't hold up later months: there is nothing to void." };
    const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, p.currentRunId));
    const res = run!.result as CategoryXResult;
    if (res.status !== "computed") return { ok: false as const, error: "The month's calculation was blocked: recalculate it first. Nothing was voided." };
    if ((res.reviewCases ?? []).length) return { ok: false as const, error: `${res.reviewCases!.length} review case${res.reviewCases!.length === 1 ? " is" : "s are"} unresolved in this month (Review & decisions): decide ${res.reviewCases!.length === 1 ? "it" : "them"} and recalculate first. Nothing was voided.` };
    if (res.held.length) return { ok: false as const, error: `${res.held.length} record${res.held.length === 1 ? " is" : "s are"} held in this month: resolve ${res.held.length === 1 ? "it" : "them"} and recalculate first. Nothing was voided.` };
    if (!res.settled) return { ok: false as const, error: "The month's calculation isn't settled yet (a collection or turnover window is still open), so its amounts aren't final and would be lost: it can't be voided yet. Nothing was voided." };

    // What each salesperson's month carries forward.
    const own = await ownPayablesOf(tx, p.currentRunId);
    const adj = await tx.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, category), or(eq(incentiveCalcAdjustments.toMonth, month), eq(incentiveCalcAdjustments.fromMonth, month))));
    const names = new Map<string, string>(res.employees.map((e) => [e.employeeId, e.name]));
    const lines = new Map<string, { ownPaise: number; inPaise: number; resolvedPaise: number }>();
    const line = (e: string) => lines.get(e) ?? lines.set(e, { ownPaise: 0, inPaise: 0, resolvedPaise: 0 }).get(e)!;
    for (const [e, v] of Object.entries(own)) line(e).ownPaise += v;
    for (const a of adj) {
      if (!a.employeeId) continue;
      if (!names.has(a.employeeId)) names.set(a.employeeId, a.employeeName);
      const toThis = a.toMonth !== null && D(a.toMonth) === month;
      // Into this month: carried on. Out of it at lock (a negative balance carried on / written off / recovered): it
      // already settled that part of the month, so it is taken back out. A recalculation difference carried out was
      // never in the adopted figures, so it stays as it is.
      if (toThis) line(a.employeeId).inPaise += Number(a.amountPaise);
      else if (a.kind === "negative-carry") line(a.employeeId).resolvedPaise += Number(a.amountPaise);
      else if (a.kind === "write-off" || a.kind === "salary-recovery") line(a.employeeId).resolvedPaise -= Number(a.amountPaise);
    }
    const carried = [...lines.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([employeeId, l]) => ({ employeeId, name: names.get(employeeId) ?? "Former employee", ...l, carriedPaise: l.ownPaise + l.inPaise - l.resolvedPaise }));
    const moving = carried.filter((c) => c.carriedPaise !== 0);
    const next = nextMonthStart(month);
    // The next month, locked after this one (the same order as every other path).
    await lockMonth(tx, programId, next, category);
    const target = await periodFor(tx, programId, next, category);
    if (moving.length) {
      if (await voidOf(tx, target.id, category)) return { ok: false as const, error: `${next.slice(0, 7)} is voided, so this month's amounts can't be carried into it. Nothing was voided.` };
      if (target.status !== "open") return { ok: false as const, error: `${next.slice(0, 7)} is ${target.status}: this month's amounts are carried into it, so reopen it first. Nothing was voided.` };
      for (const c of moving)
        await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: category, fromMonth: month, toMonth: next, employeeId: c.employeeId, employeeName: c.name, kind: "recalc-difference", amountPaise: c.carriedPaise, sourceRunId: p.currentRunId, note: `Carried from ${month.slice(0, 7)}, voided: ${why}`.slice(0, 1000), createdById: actor.id });
    }
    const carriedPaise = moving.reduce((a, c) => a + c.carriedPaise, 0);
    const lotsLeft = ((res.employees ?? []) as { carry?: CarryOutcome }[]).reduce((a, e) => a + (e.carry?.lots.length ?? 0), 0);
    const summary = { month, status: p.status, runId: p.currentRunId, carriedToMonth: moving.length ? next : null, carriedPaise, lines: carried, balancesLeftCarried: lotsLeft };
    await tx.insert(incentiveCalcPeriodVoids).values({ periodId: p.id, runId: p.currentRunId, carriedToMonth: moving.length ? next : null, summary, reason: why, createdById: actor.id, createdByName: actor.name });
    await tx.update(incentiveCalcPeriods).set({ rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "voided", entityType: "incentive-calc-period", entityId: p.id, detail: withCategory(category, { ...summary, reason: why }) });
    return { ok: true as const, rowVersion: p.rowVersion + 1, carriedToMonth: moving.length ? next : null, carriedPaise };
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
  /** Category B: each order's qualification in the adopted calculation, with its evidence (empty for Category A). */
  qualifications?: (typeof incentiveCalcBQualifications.$inferSelect)[];
  /** Category B: the month's invoices with no Sales Order, in the latest calculation (they need review). */
  reviewInvoices?: CategoryBResult["reviewInvoices"];
  /** Categories C–G: each credited item of the adopted calculation, and why some weren't credited. */
  items?: (typeof incentiveCalcItems.$inferSelect)[];
  excludedNotes?: { documentNo: string | null; message: string }[];
  /** Category C: the month's void (0136) — kept for the record; it no longer blocks later months. */
  voided?: { reason: string; byName: string; at: string; carriedToMonth: string | null; carriedPaise: number } | null;
}

export async function monthView(programId: string | null, month: string, q: Q = db, category: CalcCategory = "A"): Promise<MonthView> {
  const empty: MonthView = { ready: false, programs: [], period: null, current: null, runs: [], adjustmentsIn: [], adjustmentsOut: [], latestProblems: [], approvals: [], payout: null, submittedByName: null, approvedTotalPaise: null };
  if (await readyFor(category, q)) return empty;
  const programs = await q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const pid = programId && programs.some((p) => p.id === programId) ? programId : (programs[0]?.id ?? null);
  if (!pid || !isMonthStart(month)) return { ...empty, ready: true, programs };
  const [period] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, pid), eq(incentiveCalcPeriods.categoryCode, category), eq(incentiveCalcPeriods.month, month)));
  const runs = await q
    .select({ id: incentiveCalcRuns.id, computedAt: incentiveCalcRuns.computedAt, computedByName: incentiveCalcRuns.computedByName, status: incentiveCalcRuns.status, adopted: incentiveCalcRuns.adopted, outcome: incentiveCalcRuns.outcome, configVersionNo: incentiveCalcRuns.configVersionNo, asOf: incentiveCalcRuns.asOf, inputsHash: incentiveCalcRuns.inputsHash, resultHash: incentiveCalcRuns.resultHash, result: incentiveCalcRuns.result })
    .from(incentiveCalcRuns)
    .where(and(eq(incentiveCalcRuns.programId, pid), eq(incentiveCalcRuns.categoryCode, category), eq(incentiveCalcRuns.month, month)))
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
  const adj = (col: typeof incentiveCalcAdjustments.toMonth | typeof incentiveCalcAdjustments.fromMonth) => q.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, pid), eq(incentiveCalcAdjustments.categoryCode, category), eq(col, month))).orderBy(asc(incentiveCalcAdjustments.createdAt));
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
    approvedTotalPaise: period?.currentRunId ? (await payoutLines(q, pid, month, period.currentRunId, category)).reduce((s, l) => s + l.amountPaise, 0) : null,
    ...(category === "B"
      ? {
          qualifications: period?.currentRunId ? await q.select().from(incentiveCalcBQualifications).where(eq(incentiveCalcBQualifications.runId, period.currentRunId)).orderBy(asc(incentiveCalcBQualifications.orderDate), asc(incentiveCalcBQualifications.orderNo)) : [],
          reviewInvoices: ((latest?.status === "computed" ? (latest.result as CategoryBResult).reviewInvoices : null) ?? []),
        }
      : {}),
    ...(category !== "A" && category !== "B"
      ? {
          items: period?.currentRunId ? await q.select().from(incentiveCalcItems).where(eq(incentiveCalcItems.runId, period.currentRunId)).orderBy(asc(incentiveCalcItems.lineCode), asc(incentiveCalcItems.label)) : [],
          excludedNotes: period?.currentRunId && current ? (((current.run.result as CategoryXResult).excluded ?? []).map((n) => ({ documentNo: n.documentNo, message: n.message }))) : [],
        }
      : {}),
    ...(category === "C" && period ? await voidedView(q, period.id) : {}),
  };
}

async function voidedView(q: Q, periodId: string): Promise<Pick<MonthView, "voided">> {
  const [v] = await q.select().from(incentiveCalcPeriodVoids).where(eq(incentiveCalcPeriodVoids.periodId, periodId));
  return { voided: v ? { reason: v.reason, byName: v.createdByName, at: v.createdAt.toISOString(), carriedToMonth: v.carriedToMonth ? D(v.carriedToMonth) : null, carriedPaise: Number((v.summary as { carriedPaise?: number }).carriedPaise ?? 0) } : null };
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
  /** Category C: the month's void record (0136). Its status then reads "voided" (derived, never stored). */
  voided: { reason: string; byName: string; at: Date; carriedToMonth: string | null; recordedStatus: string } | null;
}

/** Every calculated month of a programme (newest first), with its approval and payout state. */
export async function listApprovalPeriods(programId: string | null, q: Q = db, category: CalcCategory = "A"): Promise<{ ready: boolean; programs: { id: string; code: string; name: string }[]; programId: string | null; periods: ApprovalPeriod[] }> {
  if (await readyFor(category, q)) return { ready: false, programs: [], programId: null, periods: [] };
  const programs = await q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const pid = programId && programs.some((p) => p.id === programId) ? programId : (programs[0]?.id ?? null);
  if (!pid) return { ready: true, programs, programId: null, periods: [] };
  const periods = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, pid), eq(incentiveCalcPeriods.categoryCode, category))).orderBy(desc(incentiveCalcPeriods.month)).limit(60);
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
  // Category C only: voided months (the void record is the only source; Categories A and B never read it).
  const voids = category === "C" && ids.length ? await q.select().from(incentiveCalcPeriodVoids).where(inArray(incentiveCalcPeriodVoids.periodId, ids)) : [];
  const out: ApprovalPeriod[] = [];
  for (const p of periods) {
    const run = runs.find((r) => r.id === p.currentRunId);
    const lines = run ? await payoutLines(q, pid, D(p.month), run.id, category) : [];
    const results = run ? await q.select({ payable: incentiveCalcResults.payablePaise }).from(incentiveCalcResults).where(eq(incentiveCalcResults.runId, run.id)) : [];
    const payout = payouts.find((x) => x.periodId === p.id);
    const v = voids.find((x) => x.periodId === p.id);
    out.push({
      id: p.id,
      month: D(p.month),
      status: v ? "voided" : p.status,
      voided: v ? { reason: v.reason, byName: v.createdByName, at: v.createdAt, carriedToMonth: v.carriedToMonth ? D(v.carriedToMonth) : null, recordedStatus: p.status } : null,
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

/* ── a salesperson's own Category A or B (My Incentives) ─────────────── */

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
export async function myCategoryA(employeeId: string, q: Q = db, category: CalcCategory = "A"): Promise<{ ready: boolean; months: MyCategoryAMonth[]; awaiting: string[] }> {
  if (await readyFor(category, q)) return { ready: false, months: [], awaiting: [] };
  const periods = await q
    .select({ p: incentiveCalcPeriods, code: incentivePrograms.code, name: incentivePrograms.name })
    .from(incentiveCalcPeriods)
    .innerJoin(incentivePrograms, eq(incentivePrograms.id, incentiveCalcPeriods.programId))
    .where(and(eq(incentiveCalcPeriods.categoryCode, category), inArray(incentiveCalcPeriods.status, ["approved", "paid"])))
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
      const mine = (await payoutLines(q, p.programId, D(p.month), p.currentRunId, category)).find((l) => l.employeeId === employeeId);
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
    .where(and(eq(incentiveCalcPeriods.categoryCode, category), inArray(incentiveCalcPeriods.status, ["open", "locked", "submitted"])));
  return { ready: true, months, awaiting: [...new Set(pending.map((x) => D(x.month)))].sort().reverse() };
}

/** The signed-in person's OWN Category B, approved and paid months only — the same safeguards as Category A. */
export const myCategoryB = (employeeId: string, q: Q = db) => myCategoryA(employeeId, q, "B");
