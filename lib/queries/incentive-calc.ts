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
import { calculationDateProblem, decide, firstOpenMonth, monthEnd, negativeBalance, type Decision, type PeriodStatus } from "@/lib/incentives/category-a/settle";
import { ENGINE_VERSION, type CategoryAInput, type CategoryAResult, type CreditNoteIn, type InvoiceIn, type OrderIn, type ReceiptIn } from "@/lib/incentives/category-a/types";
import { loadConfig, versionInForce } from "@/lib/queries/incentive-rules";
import { isMonthStart, isDay } from "@/lib/incentives/rules-config/validate";
import { calculateCategoryB } from "@/lib/incentives/category-b/engine";
import { inputsHashB, resultHashB } from "@/lib/incentives/category-b/hash";
import { ENGINE_VERSION_B, type CategoryBInput, type CategoryBResult } from "@/lib/incentives/category-b/types";
import { canonical } from "@/lib/incentives/category-a/hash";
import { allCategoriesFor, categoryBOrderIds, CALC_B_NOT_READY, incentiveCalcBReady, loadInputB } from "@/lib/queries/incentive-calc-b";
import { incentiveCalcBInvoiceReviews, incentiveCalcBOverrides, incentiveCalcBQualifications, incentiveCalcCarry, incentiveCalcCarryWriteoffs, incentiveCalcItems, incentiveCalcPeriodVoids } from "@/db/schema";
import { unattributedBlock } from "@/lib/queries/incentive-c-review";
import { aAllCategoriesFor, aSafeguardsReady, aUnresolved, acknowledgedHeld, heldItems, staleCategoryBOrders } from "@/lib/queries/incentive-calc-a";
export { aSafeguardsReady };
/** A Category A run's held items with their acknowledgments (for the screen). Reads only. */
export const heldItemsOf = (runId: string) => heldItems(db, runId);
import { incentiveCalcNegativeDecisions } from "@/db/schema";
import { calculateCategoryX } from "@/lib/incentives/categories/engine";
import { inputsHashX, resultHashX } from "@/lib/incentives/categories/hash";
import { ENGINE_VERSIONS, type CarryIn, type CarryOutcome, type CategoryXInput, type CategoryXResult, type ExtraCategory } from "@/lib/incentives/categories/types";
import { CALC_C_NOT_READY, CALC_F_NOT_READY, CALC_X_NOT_READY, incentiveCalcCReady, incentiveCalcFReady, incentiveCalcXReady, loadCarry, loadInputX } from "@/lib/queries/incentive-calc-x";

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
  if (category === "F" && !(await incentiveCalcFReady(q))) return CALC_F_NOT_READY;
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
  // Follow the references both ways (documents with no customer in the master too) until nothing new is found
  // (category-a/2: never a silent cut after a few links). Should the links still be growing after REF_ROUNDS rounds,
  // the documents found last are held ("links not fully followed") instead of being passed over.
  let frontier: Doc[] = [];
  let converged = false;
  for (let round = 0; round < REF_ROUNDS; round++) {
    const ids = [...docs.keys()];
    const refs = [...docs.values()].map((d) => d.refDocumentId).filter((x): x is string => !!x && !docs.has(x));
    const linked = await q
      .select()
      .from(tallyDocuments)
      .where(and(inArray(tallyDocuments.documentType, TYPES), lte(tallyDocuments.documentDate, asOf), or(inArray(tallyDocuments.refDocumentId, ids), refs.length ? inArray(tallyDocuments.id, refs) : sql`false`)));
    frontier = linked.filter((d) => !docs.has(d.id));
    for (const d of linked) docs.set(d.id, d);
    if (!frontier.length) {
      converged = true;
      break;
    }
  }
  const referencesIncomplete = converged ? [] : frontier.sort((a, b) => (a.documentNo < b.documentNo ? -1 : a.documentNo > b.documentNo ? 1 : a.id < b.id ? -1 : 1)).slice(0, 50).map((d) => ({ documentId: d.id, documentNo: d.documentNo }));
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
  // A pre-closure that can't be valued (its order line is missing, or has no quantity or amount) is reported to the
  // engine, which holds it (category-a/2) — never dropped silently.
  const preclosureProblems: { orderId: string; orderNo: string; date: string; reason: string }[] = [];
  const preclosures = pcs
    .filter((p) => orderDocs.has(p.documentId))
    .map((p) => {
      const order = orderDocs.get(p.documentId)!;
      const line = order.lines?.[p.lineNo - 1];
      const qty = line?.quantity ?? null, amt = line?.amountPaise ?? null;
      if (!line || !qty || !amt) preclosureProblems.push({ orderId: p.documentId, orderNo: order.documentNo, date: D(p.precloseDate), reason: !line ? `it names line ${p.lineNo}, which the order doesn't have.` : `line ${p.lineNo} has no ${!qty ? "quantity" : "amount"}.` });
      return { orderId: p.documentId, date: D(p.precloseDate), itemsValuePaise: qty && amt ? Math.round((amt * Number(p.quantity)) / qty) : 0 };
    })
    .filter((p) => p.itemsValuePaise > 0);

  const docIds = all.map((d) => d.id);
  const custIds = [...new Set(all.map((d) => d.customerMasterId).filter((x): x is string => !!x))];
  const [events, custRows, reps, attrs, emps] = await Promise.all([
    // A receipt event in force ON the calculation date: dated on or before it, and not retired by the end of that day
    // (India) — a hold released later still held the receipt then. (Order salespeople and representative periods are
    // corrections: a retired one was never right, so it is never read; periods carry their own dates.)
    docIds.length ? q.select().from(incentiveCalcReceiptEvents).where(and(inArray(incentiveCalcReceiptEvents.documentId, docIds), lte(incentiveCalcReceiptEvents.eventDate, asOf), or(isNull(incentiveCalcReceiptEvents.retiredAt), sql`${incentiveCalcReceiptEvents.retiredAt} >= ((${asOf}::date + 1)::timestamp at time zone 'Asia/Kolkata')`))) : [],
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
    // One combined limit per salesperson across every category and every programme (and the old engine's categories).
    ...(await aAllCategoriesFor(q, programId, month, config).then((a) => (a ? { allCategories: a } : {}))),
    ...(preclosureProblems.length ? { preclosureProblems } : {}),
    ...(referencesIncomplete.length ? { referencesIncomplete } : {}),
  });
}
/** How many rounds of links the loader follows before holding what is still unfollowed (far beyond any real chain). */
const REF_ROUNDS = 12;

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

/** Where a recalculation's differences go: the month chosen, the differences re-targeted to it, and the outcome text. */
interface CarryPlacement {
  outcome: string;
  target: string | null;
  carries: Decision["carries"];
}

/**
 * Where a locked, approved or paid month's differences go: the first month, from the one decide() named, that is open
 * and not voided — at most a year ahead (a month with no period yet is open). That month's row is locked and its row
 * version goes up (its figures change through the carried difference): a concurrent recalculation that read an older
 * snapshot then can't lock it (serialization failure) and is retried on a fresh one, where this difference is already
 * subtracted — so a difference is never carried twice. With no open month, nothing is carried and the outcome says so;
 * the difference stays with the month and its next calculation carries it (nothing is written off or dropped).
 */
async function resolveCarries(tx: Tx, programId: string, category: CalcCategory, decision: Decision): Promise<CarryPlacement> {
  if (!decision.carries.length) return { outcome: decision.outcome, target: null, carries: [] };
  const from = decision.carries[0]!.toMonth;
  const base = decision.outcome.replace(/ The difference is carried.*$/, "");
  const notYet: CarryPlacement = { outcome: `${base} It differs, but no month from ${from.slice(0, 7)} on is open to take it, so it isn't carried yet: it stays with this month, and the month's next calculation carries it once a month is open (nothing is written off).`, target: null, carries: [] };
  const rows = await tx.select({ id: incentiveCalcPeriods.id, month: incentiveCalcPeriods.month, status: incentiveCalcPeriods.status }).from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, category), sql`${incentiveCalcPeriods.month} >= ${from}::date`));
  const open = new Map<string, boolean>();
  for (const r of rows) open.set(D(r.month), r.status === "open" && !(await voidOf(tx, r.id, category)));
  const target = firstOpenMonth(from, (m) => open.get(m) ?? true);
  if (!target) return notYet;
  const p = await periodFor(tx, programId, target, category);
  if (p.status !== "open" || (await voidOf(tx, p.id, category))) return notYet;
  await tx.update(incentiveCalcPeriods).set({ rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
  const outcome = target === from ? decision.outcome : `${base} The difference is carried into ${target.slice(0, 7)} (the first open month from ${from.slice(0, 7)}).`;
  return { outcome, target, carries: decision.carries.map((c) => ({ ...c, toMonth: target })) };
}

/** Records the placed differences (append-only adjustments, each naming the run that found it). Returns how many. */
async function writeCarries(tx: Tx, actor: Actor, programId: string, category: CalcCategory, month: string, placement: CarryPlacement, runId: string, nameOf: (employeeId: string) => string): Promise<number> {
  for (const c of placement.carries)
    await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: category, fromMonth: month, toMonth: c.toMonth, employeeId: c.employeeId, employeeName: nameOf(c.employeeId), kind: "recalc-difference", amountPaise: c.amountPaise, sourceRunId: runId, note: placement.outcome, createdById: actor.id });
  return placement.carries.length;
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
  const dateProblem = calculationDateProblem(month, asOf, todayIST());
  if (dateProblem) return { ok: false, error: dateProblem };
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
    // A month that is no longer open is never recalculated as of an EARLIER day than its adopted calculation: that would
    // take back collections already counted (and carry the difference into a later month as a recovery).
    if (period.status !== "open" && period.currentRunId) {
      const adoptedAsOf = await asOfRun(tx, period.currentRunId);
      if (asOf < adoptedAsOf) return { ok: false as const, error: `The month is ${period.status} and was calculated as of ${adoptedAsOf}: it is never recalculated as of an earlier day (${asOf}). Calculate it as of ${adoptedAsOf} or later. Nothing was calculated.` };
    }
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
    const [latest] = await tx.select({ id: incentiveCalcRuns.id, ih: incentiveCalcRuns.inputsHash, rh: incentiveCalcRuns.resultHash, engineVersion: incentiveCalcRuns.engineVersion }).from(incentiveCalcRuns).where(and(eq(incentiveCalcRuns.programId, programId), eq(incentiveCalcRuns.categoryCode, category), eq(incentiveCalcRuns.month, month))).orderBy(desc(incentiveCalcRuns.computedAt)).limit(1);

    let currentSettled = false;
    let adoptedRun: { ih: string; rh: string; engineVersion: string } | null = null;
    if (period.currentRunId) {
      const [cur] = await tx.select({ result: incentiveCalcRuns.result, ih: incentiveCalcRuns.inputsHash, rh: incentiveCalcRuns.resultHash, engineVersion: incentiveCalcRuns.engineVersion }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, period.currentRunId));
      currentSettled = (cur?.result as CategoryAResult | undefined)?.settled === true;
      adoptedRun = cur ?? null;
    }
    const carriedRows = await tx.select({ e: incentiveCalcAdjustments.employeeId, a: incentiveCalcAdjustments.amountPaise }).from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, category), eq(incentiveCalcAdjustments.fromMonth, month), eq(incentiveCalcAdjustments.kind, "recalc-difference")));
    const carried: Record<string, number> = {};
    for (const r of carriedRows) if (r.e) carried[r.e] = (carried[r.e] ?? 0) + Number(r.a);
    // Differences are of each salesperson's OWN amount (a minimum-payable category's carried balances and adjustments
    // are settled through its ledger, never twice).
    const fresh = Object.fromEntries(result.employees.map((e) => [e.employeeId, (e as { ownPayablePaise?: number }).ownPayablePaise ?? e.payablePaise]));
    const settings = input.config?.settings ?? {};
    const state = { month, status: period.status as PeriodStatus, hasCurrentRun: !!period.currentRunId, currentRunSettled: currentSettled, paidAt: period.paidAt ? period.paidAt.toISOString() : null };
    const pays = { adopted: await ownPayablesOf(tx, period.currentRunId), fresh, carried };
    let decision = decide(settings, state, asOf, result.status === "computed", pays);
    // An automatic lock is exactly a lock by hand: its negative balances are handled the same way, and one that needs a
    // second person's approval (Category A) waits for it — the month then stays open and the outcome says why.
    let autoNegatives: NegativeAtLock[] = [];
    if (decision.lockFirst) {
      autoNegatives = await negativesAtLock(tx, programId, month, period, category);
      const waits = await secondPersonMissing(tx, period, category, autoNegatives);
      if (waits) {
        const open = decide({ ...settings, "period.lockMode": "manual" }, state, asOf, result.status === "computed", pays);
        decision = { ...open, outcome: `${open.outcome} It is past its automatic lock day but isn't locked yet: ${waits}` };
        autoNegatives = [];
      }
    }
    const names = new Map(result.employees.map((e) => [e.employeeId, e.name]));
    const nameOf = (id: string) => names.get(id) ?? input.employees.find((e) => e.id === id)?.name ?? "Former employee";

    // "Nothing changed" only against a run of the CURRENT engine: the inputs hash doesn't name the engine (so stored
    // hashes keep reproducing), so a run of an earlier engine with the same inputs — calculated earlier the same day —
    // must not stop a run of this engine being recorded (it would otherwise stay the month's only run, and submission
    // refuses a run of an earlier engine). Whether the new run is adopted is decided below, as for any run: a locked,
    // submitted, approved or paid month is never adopted into.
    const sameAs = (r: { ih: string; rh: string; engineVersion: string } | null | undefined) => !!r && r.engineVersion === engine.version && (r.ih === ih || r.rh === rh);
    // …and never while a calculation the month would ADOPT now is held back only because the latest run (recorded while
    // the month was locked, so not adopted) is the same: after the month is reopened, its adopted run must become this
    // one — unless the adopted run itself already is the same. Only an open month adopts (decide), so a locked,
    // submitted, approved or paid month keeps exactly its behaviour, its pending-carry path included.
    const heldBackFromAdoption = decision.adopt && !!latest && latest.id !== period.currentRunId && !sameAs(adoptedRun);
    if (latest && sameAs(latest) && !heldBackFromAdoption) {
      // Nothing new to record. But a locked, approved or paid month may still have a difference that was never carried
      // (no month was open to take it when it was found): carry it now, from the run that found it — once, because the
      // differences already carried out of the month are subtracted (decide), never silently left behind.
      if (period.status !== "open" && decision.carries.length) {
        const placement = await resolveCarries(tx, programId, category, decision);
        const carried = await writeCarries(tx, actor, programId, category, month, placement, latest.id, nameOf);
        await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "carried-difference", entityType: "incentive-calc-period", entityId: period.id, detail: { month, asOf, runId: latest.id, outcome: placement.outcome, carried, toMonth: placement.target, ...(category === "A" ? {} : { category }) } });
        return { ok: true as const, runId: latest.id, unchanged: true, adopted: false, status: result.status, outcome: placement.outcome, problems: result.problems };
      }
      return { ok: true as const, runId: latest.id, unchanged: true, adopted: false, status: result.status, outcome: "Nothing changed since the last calculation: no new run was recorded.", problems: result.problems };
    }

    // Where the differences go (the first open month), decided BEFORE the run is recorded so its outcome says exactly that.
    const placement = await resolveCarries(tx, programId, category, decision);
    const outcome = placement.outcome;
    let rowVersion = period.rowVersion;
    if (decision.lockFirst) {
      await writeNegatives(tx, actor, programId, month, period, category, autoNegatives);
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: null, rowVersion: ++rowVersion, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, period.id));
    }
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
    await writeCarries(tx, actor, programId, category, month, placement, runId, nameOf);
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
    let notes: string[] = [];
    if (lock) {
      if (p.status !== "open") return { ok: false as const, error: `The month is ${p.status}, not open.` };
      if (!p.currentRunId) return { ok: false as const, error: "Calculate the month before locking it." };
      const negatives = await negativesAtLock(tx, programId, month, p, category);
      const blocked = await secondPersonMissing(tx, p, category, negatives);
      if (blocked) return { ok: false as const, error: `${blocked} Nothing was locked.` };
      notes = await writeNegatives(tx, actor, programId, month, p, category, negatives);
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: actor.id, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    } else {
      if (p.status !== "locked") return { ok: false as const, error: p.status === "open" ? "The month is already open." : `An ${p.status} month can't be reopened.` };
      await tx.update(incentiveCalcPeriods).set({ status: "open", rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
    }
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: lock ? "locked" : "reopened", entityType: "incentive-calc-period", entityId: p.id, detail: { month, notes, ...(category === "A" ? {} : { category }) } });
    return { ok: true as const, rowVersion: p.rowVersion + 1, notes };
  });
}

/* ── negative balances at lock (manual and automatic alike) ──────────── */

type PeriodRowT = typeof incentiveCalcPeriods.$inferSelect;
interface NegativeAtLock {
  employeeId: string;
  name: string;
  nb: NonNullable<ReturnType<typeof negativeBalance>>;
}
/** A negative balance the configuration writes off or recovers from salary (Category A: only with a second person's approval). */
const SECOND_PERSON = new Set(["write-off", "salary-recovery"]);

/**
 * What locking the month does with each salesperson's negative total (the adopted run's payable plus every adjustment
 * carried into the month), as its configuration says. The SAME for a lock by hand and an automatic one. Reads only.
 */
async function negativesAtLock(tx: Tx, programId: string, month: string, p: PeriodRowT, category: CalcCategory): Promise<NegativeAtLock[]> {
  if (!p.currentRunId) return [];
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
  const out: NegativeAtLock[] = [];
  for (const [e, n] of Object.entries(net).sort()) {
    const nb = negativeBalance(settings, month, n, left[e] ?? null);
    if (nb) out.push({ employeeId: e, name: names[e] ?? "Former employee", nb });
  }
  return out;
}

/**
 * Category A: why the month can't be locked yet — a negative balance it would write off or recover from salary has no
 * second person's approval of exactly that amount for the adopted run (0142) — or null. Other categories: null (as before).
 */
async function secondPersonMissing(tx: Tx, p: PeriodRowT, category: CalcCategory, negatives: NegativeAtLock[]): Promise<string | null> {
  if (category !== "A") return null;
  const need = negatives.filter((x) => SECOND_PERSON.has(x.nb.kind));
  if (!need.length) return null;
  const what = (x: NegativeAtLock) => `${x.name}'s negative balance of ₹${(x.nb.amountPaise / 100).toFixed(2)} is to be ${x.nb.kind === "write-off" ? "written off" : "recovered from salary"}`;
  if (!(await aSafeguardsReady(tx))) return `${need.map(what).join("; ")}: a second person approves that, which needs database update 0142.`;
  const approved = await tx.select().from(incentiveCalcNegativeDecisions).where(and(eq(incentiveCalcNegativeDecisions.periodId, p.id), eq(incentiveCalcNegativeDecisions.runId, p.currentRunId!), eq(incentiveCalcNegativeDecisions.kind, "approve")));
  const missing = need.filter((x) => !approved.some((a) => a.employeeId === x.employeeId && a.outcome === x.nb.kind && Number(a.amountPaise) === x.nb.amountPaise));
  return missing.length ? `${missing.map(what).join("; ")}: a second person must approve ${missing.length === 1 ? "it" : "each"} first (request it on the month's calculation).` : null;
}

/** Records what the lock does with each negative balance (append-only adjustments; once per run, salesperson and kind). */
async function writeNegatives(tx: Tx, actor: Actor | null, programId: string, month: string, p: PeriodRowT, category: CalcCategory, negatives: NegativeAtLock[]): Promise<string[]> {
  const notes: string[] = [];
  for (const { employeeId: e, name, nb } of negatives) {
    if (nb.toMonth) await periodFor(tx, programId, nb.toMonth, category);
    await tx.insert(incentiveCalcAdjustments).values({ programId, categoryCode: category, fromMonth: month, toMonth: nb.toMonth, employeeId: e, employeeName: name, kind: nb.kind, amountPaise: nb.amountPaise, monthsLeft: nb.monthsLeft, sourceRunId: p.currentRunId!, note: nb.note, createdById: actor?.id ?? null }).onConflictDoNothing();
    notes.push(`${name}: ${nb.note}`);
  }
  return notes;
}

export interface NegativeBalanceItem {
  employeeId: string;
  name: string;
  outcome: "write-off" | "salary-recovery" | "negative-carry";
  amountPaise: number;
  note: string;
  /** Write-offs and salary recoveries only (Category A): the latest request and its decision. */
  needsSecondPerson: boolean;
  request: { id: string; byId: string | null; byName: string; reason: string; at: string } | null;
  decision: { kind: "approve" | "refuse"; byName: string; reason: string; at: string } | null;
  /** The approval matches exactly what the lock would record now. */
  approved: boolean;
}

/** What locking a Category A month would do with its negative balances, with each decision (for the screen). Reads only. */
export async function negativeBalancesAtLock(programId: string, month: string, q: Db = db): Promise<{ ready: boolean; items: NegativeBalanceItem[] }> {
  if (!isMonthStart(month) || !(await incentiveCalcReady(q))) return { ready: false, items: [] };
  const [p] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, "A"), eq(incentiveCalcPeriods.month, month)));
  if (!p || p.status !== "open" || !p.currentRunId) return { ready: await aSafeguardsReady(q), items: [] };
  const negatives = await negativesAtLock(q as Tx, programId, month, p, "A");
  const ready = await aSafeguardsReady(q);
  const rows = ready ? await q.select().from(incentiveCalcNegativeDecisions).where(and(eq(incentiveCalcNegativeDecisions.periodId, p.id), eq(incentiveCalcNegativeDecisions.runId, p.currentRunId))).orderBy(asc(incentiveCalcNegativeDecisions.createdAt)) : [];
  return {
    ready,
    items: negatives.map((x) => {
      const reqs = rows.filter((r) => r.kind === "request" && r.employeeId === x.employeeId);
      const req = reqs.at(-1) ?? null;
      const dec = req ? (rows.find((r) => r.requestId === req.id) ?? null) : null;
      const approvedExactly = rows.some((r) => r.kind === "approve" && r.employeeId === x.employeeId && r.outcome === x.nb.kind && Number(r.amountPaise) === x.nb.amountPaise);
      return {
        employeeId: x.employeeId,
        name: x.name,
        outcome: x.nb.kind as NegativeBalanceItem["outcome"],
        amountPaise: x.nb.amountPaise,
        note: x.nb.note,
        needsSecondPerson: SECOND_PERSON.has(x.nb.kind),
        request: req ? { id: req.id, byId: req.createdById, byName: req.createdByName, reason: req.reason, at: req.createdAt.toISOString() } : null,
        decision: dec ? { kind: dec.kind as "approve" | "refuse", byName: dec.createdByName, reason: dec.reason, at: dec.createdAt.toISOString() } : null,
        approved: approvedExactly,
      };
    }),
  };
}

/**
 * Ask a second person to approve the write-off or salary recovery that locking an open Category A month would make of
 * a salesperson's negative balance — the amount and outcome are what the lock would record NOW, for the adopted run.
 */
export async function requestNegativeDecision(actor: Actor, input: { programId: string; month: string; employeeId: string; reason: string }): Promise<Result<{ requestId: string; amountPaise: number }>> {
  const reason = input.reason.trim();
  if (!isMonthStart(input.month)) return { ok: false, error: "Choose a month." };
  if (!reason || reason.length > 1000) return { ok: false, error: "Give the reason (up to 1,000 characters)." };
  if (!(await incentiveCalcReady()) || !(await aSafeguardsReady())) return { ok: false, error: "A second person's approval of a negative balance needs database update 0142, so nothing was requested." };
  return db.transaction(async (tx) => {
    const p = await periodRow(tx, input.programId, input.month, "A");
    if (!p || p.status !== "open" || !p.currentRunId) return { ok: false as const, error: "Only an open, calculated month's negative balances are decided before it is locked." };
    const x = (await negativesAtLock(tx, input.programId, input.month, p, "A")).find((n) => n.employeeId === input.employeeId);
    if (!x || !SECOND_PERSON.has(x.nb.kind)) return { ok: false as const, error: "Locking the month wouldn't write off or recover from salary any balance of that salesperson." };
    const [row] = await tx.insert(incentiveCalcNegativeDecisions).values({ kind: "request", periodId: p.id, runId: p.currentRunId, employeeId: x.employeeId, employeeName: x.name, outcome: x.nb.kind as "write-off" | "salary-recovery", amountPaise: x.nb.amountPaise, reason, createdById: actor.id, createdByName: actor.name }).returning({ id: incentiveCalcNegativeDecisions.id });
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "a-negative-requested", entityType: "incentive-calc-period", entityId: p.id, detail: { month: input.month, employeeId: x.employeeId, outcome: x.nb.kind, amountPaise: x.nb.amountPaise, runId: p.currentRunId, reason } });
    return { ok: true as const, requestId: row!.id, amountPaise: x.nb.amountPaise };
  }).catch((e: unknown) => refusedNegative<{ requestId: string; amountPaise: number }>(e));
}

/** A second person approves or refuses a request — only while it is still exactly what the lock would record. */
export async function decideNegativeDecision(actor: Actor, requestId: string, decision: "approve" | "refuse", reasonIn: string): Promise<Result<{ amountPaise: number }>> {
  const reason = reasonIn.trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return { ok: false, error: "That request doesn't exist." };
  if (!reason || reason.length > 1000) return { ok: false, error: "Give the reason (up to 1,000 characters)." };
  if (!(await incentiveCalcReady()) || !(await aSafeguardsReady())) return { ok: false, error: "A second person's approval of a negative balance needs database update 0142, so nothing was decided." };
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(incentiveCalcNegativeDecisions).where(eq(incentiveCalcNegativeDecisions.id, requestId));
    if (!req || req.kind !== "request") return { ok: false as const, error: "That request doesn't exist." };
    const [p0] = await tx.select().from(incentiveCalcPeriods).where(eq(incentiveCalcPeriods.id, req.periodId));
    const p = p0 ? await periodRow(tx, p0.programId, D(p0.month)!, "A") : null;
    if (!p || p.status !== "open" || p.currentRunId !== req.runId) return { ok: false as const, error: "The month was locked or recalculated since it was requested: request it again for the month as it is now." };
    const [done] = await tx.select({ id: incentiveCalcNegativeDecisions.id }).from(incentiveCalcNegativeDecisions).where(eq(incentiveCalcNegativeDecisions.requestId, req.id));
    if (done) return { ok: false as const, error: "That request was already decided." };
    if (req.createdById === actor.id) return { ok: false as const, error: "You requested it, so a second person must approve or refuse it." };
    const x = (await negativesAtLock(tx, p.programId, D(p.month)!, p, "A")).find((n) => n.employeeId === req.employeeId);
    if (decision === "approve" && (!x || x.nb.kind !== req.outcome || x.nb.amountPaise !== Number(req.amountPaise))) return { ok: false as const, error: "The balance changed since it was requested: request it again for the amount as it is now. Nothing was approved." };
    await tx.insert(incentiveCalcNegativeDecisions).values({ kind: decision, requestId: req.id, periodId: req.periodId, runId: req.runId, employeeId: req.employeeId, employeeName: req.employeeName, outcome: req.outcome, amountPaise: Number(req.amountPaise), reason, createdById: actor.id, createdByName: actor.name });
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: decision === "approve" ? "a-negative-approved" : "a-negative-refused", entityType: "incentive-calc-period", entityId: p.id, detail: { month: D(p.month), requestId: req.id, employeeId: req.employeeId, outcome: req.outcome, amountPaise: Number(req.amountPaise), reason } });
    return { ok: true as const, amountPaise: Number(req.amountPaise) };
  }).catch((e: unknown) => refusedNegative<{ amountPaise: number }>(e));
}
/** The database's refusal (0142's checks) as a result, never an unhandled error. */
function refusedNegative<T>(err: unknown): Result<T> {
  const m = String((err as { message?: string; cause?: { message?: string } })?.cause?.message ?? (err as Error)?.message ?? err);
  if (/negative-balance decision|second person/i.test(m)) return { ok: false, error: `${m.replace(/^.*?(A |a )/, "A ")} Nothing was saved.` };
  throw err;
}

/**
 * Automatic locking (Category A, "Locking a month: automatically, a number of days after the month ends"): every OPEN
 * Category A month with an adopted calculation whose configuration locks it automatically, and whose lock day has
 * passed, is locked now — exactly as a lock by hand, negative balances included (one that needs a second person's
 * approval waits for it: the month stays open, and the result says why). Run daily by the scheduler
 * (app/api/cron/incentive-auto-lock). Each month in its own transaction, under its own lock.
 */
export async function autoLockDueMonths(today: string = todayIST()): Promise<{ locked: { programId: string; month: string }[]; waiting: { programId: string; month: string; why: string }[] }> {
  const out = { locked: [] as { programId: string; month: string }[], waiting: [] as { programId: string; month: string; why: string }[] };
  if (!(await incentiveCalcReady())) return out;
  const open = await db.select({ programId: incentiveCalcPeriods.programId, month: incentiveCalcPeriods.month, runId: incentiveCalcPeriods.currentRunId }).from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.categoryCode, "A"), eq(incentiveCalcPeriods.status, "open"), sql`${incentiveCalcPeriods.currentRunId} is not null`)).orderBy(asc(incentiveCalcPeriods.month));
  for (const o of open) {
    const month = D(o.month)!;
    const s = await settingsOfRun(db as unknown as Tx, o.runId!);
    if (s["period.lockMode"] !== "autoAfterDays" || typeof s["period.autoLockDays"] !== "number") continue;
    const lockDay = new Date(Date.parse(`${monthEnd(month)}T00:00:00Z`) + (s["period.autoLockDays"] as number) * 86_400_000).toISOString().slice(0, 10);
    if (today <= lockDay) continue;
    const r = await db.transaction(async (tx) => {
      const p = await periodRow(tx, o.programId, month, "A");
      if (!p || p.status !== "open" || p.currentRunId !== o.runId) return null; // changed meanwhile: the next run looks again
      const negatives = await negativesAtLock(tx, o.programId, month, p, "A");
      const blocked = await secondPersonMissing(tx, p, "A", negatives);
      if (blocked) return { why: blocked };
      const notes = await writeNegatives(tx, null, o.programId, month, p, "A", negatives);
      await tx.update(incentiveCalcPeriods).set({ status: "locked", lockedAt: new Date(), lockedById: null, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(incentiveCalcPeriods.id, p.id));
      await tx.insert(incentiveAudit).values({ actorId: null, action: "locked", entityType: "incentive-calc-period", entityId: p.id, detail: { month, notes, automatic: true, lockDay } });
      return { why: null };
    });
    if (!r) continue;
    if (r.why) out.waiting.push({ programId: o.programId, month, why: r.why });
    else out.locked.push({ programId: o.programId, month });
  }
  return out;
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
  // Category A shares one limit across every programme and the old engine (aAllCategoriesFor); the others as before.
  const cfg = (run!.inputs as { config: never }).config;
  const now = category === "A" ? await aAllCategoriesFor(tx, programId, month, cfg) : await allCategoriesFor(tx, programId, month, category, cfg);
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
  /** 0141: the write-off awaiting a second person, if any. */
  writeOffRequest?: { requestId: string; amountPaise: number; byId: string | null; byName: string; reason: string; at: string } | null;
  /** 0141: every write-off request and decision on this balance, oldest first (history). */
  writeOffs?: { kind: "request" | "approve" | "refuse"; amountPaise: number; byName: string; reason: string; at: string }[];
}
/** Every balance a programme's category ever carried forward, with what happened to it (the ledger). Reads only. */
export async function carryBalances(programId: string, category: CalcCategory, q: Q = db): Promise<CarryBalance[]> {
  if (!(await incentiveCalcCReady(q))) return [];
  const rows = await q.select().from(incentiveCalcCarry).where(and(eq(incentiveCalcCarry.programId, programId), eq(incentiveCalcCarry.categoryCode, category))).orderBy(asc(incentiveCalcCarry.createdAt));
  const lots = rows.filter((r) => r.kind === "held");
  const wos = lots.length && (await carryWriteoffsReady(q)) ? await q.select().from(incentiveCalcCarryWriteoffs).where(inArray(incentiveCalcCarryWriteoffs.lotId, lots.map((l) => l.id))).orderBy(asc(incentiveCalcCarryWriteoffs.createdAt)) : [];
  return lots.map((h) => {
    const used = rows.filter((r) => r.lotId === h.id);
    const mine = wos.filter((w) => w.lotId === h.id);
    const open = mine.find((w) => w.kind === "request" && !mine.some((d) => d.requestId === w.id)) ?? null;
    return {
      lotId: h.id,
      employeeId: h.employeeId,
      employeeName: h.employeeName,
      month: D(h.month)!,
      heldPaise: Number(h.amountPaise),
      remainingPaise: Number(h.amountPaise) + used.reduce((a, r) => a + Number(r.amountPaise), 0),
      entries: used.map((r) => ({ kind: r.kind, month: D(r.month)!, amountPaise: Number(r.amountPaise), byName: r.createdByName, reason: r.reason, at: r.createdAt.toISOString() })),
      writeOffRequest: open ? { requestId: open.id, amountPaise: Number(open.amountPaise), byId: open.createdById, byName: open.createdByName, reason: open.reason, at: open.createdAt.toISOString() } : null,
      writeOffs: mine.map((w) => ({ kind: w.kind, amountPaise: Number(w.amountPaise), byName: w.createdByName, reason: w.reason, at: w.createdAt.toISOString() })),
    };
  });
}

export const CARRY_WRITEOFF_NOT_READY = "Writing off a carried-forward balance needs database update 0141 (a second person approves every write-off), so nothing was done.";

/** A held lot, what remains of it, and the months awaiting payout that count it (their payout would use it). */
async function lotState(tx: Tx, lotId: string) {
  const [lot] = await tx.select().from(incentiveCalcCarry).where(eq(incentiveCalcCarry.id, lotId));
  if (!lot || lot.kind !== "held") return null;
  const [left] = rowsOf<{ r: string }>(await tx.execute(sql`select (${lot.amountPaise}::bigint + coalesce((select sum(amount_paise) from incentive_calc_carry where lot_id = ${lotId}), 0))::text as r`));
  const pending = rowsOf<{ month: string }>(await tx.execute(sql`
    select p.month::text as month from incentive_calc_periods p join incentive_calc_runs r on r.id = p.current_run_id
    where p.program_id = ${lot.programId} and p.category_code = ${lot.categoryCode} and p.status in ('locked', 'submitted', 'approved')
      and not exists (select 1 from incentive_calc_period_voids v where v.period_id = p.id)
      and exists (select 1 from jsonb_array_elements(coalesce(r.inputs->'carry', '[]'::jsonb)) c, jsonb_array_elements(c->'lots') l where l->>'id' = ${lotId})`));
  return { lot, remaining: Number(left?.r ?? 0), pendingMonths: pending.map((x) => x.month.slice(0, 7)) };
}

/** A database refusal (check_violation) as the message it gives; anything else is rethrown. */
async function refusedAs<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = e?.code ?? e?.cause?.code;
    if (code === "23514" || code === "23505") return { ok: false, error: `${(e?.cause?.message ?? e?.message ?? "Refused").replace(/^.*?error: /i, "")}. Nothing was changed.` };
    throw err;
  }
}

/**
 * Ask for what remains of a carried-forward balance to be written off, with the reason (0141). Nothing is written off
 * until a SECOND person approves it. Refused while a month awaiting payout counts the balance (its payout would use it),
 * or while another request for it awaits its decision.
 */
export async function requestCarryWriteOff(actor: Actor, lotId: string, reason: string): Promise<Result<{ requestId: string; amountPaise: number }>> {
  const why = (reason ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(lotId)) return { ok: false, error: "That balance doesn't exist." };
  if (!why) return { ok: false, error: "Give the reason for writing it off (it is kept with it)." };
  if (why.length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcCReady(db))) return { ok: false, error: CALC_C_NOT_READY };
  if (!(await carryWriteoffsReady(db))) return { ok: false, error: CARRY_WRITEOFF_NOT_READY };
  return refusedAs<{ requestId: string; amountPaise: number }>(() =>
    db.transaction(async (tx) => {
      const s = await lotState(tx, lotId);
      if (!s) return { ok: false as const, error: "That balance doesn't exist." };
      if (s.remaining <= 0) return { ok: false as const, error: "Nothing of that balance is left." };
      if (s.pendingMonths.length) return { ok: false as const, error: `${s.pendingMonths.join(", ")} counts this balance and awaits payout: pay or reopen it first. Nothing was requested.` };
      const [row] = await tx.insert(incentiveCalcCarryWriteoffs).values({ kind: "request", lotId, employeeId: s.lot.employeeId, employeeName: s.lot.employeeName, amountPaise: s.remaining, reason: why, createdById: actor.id, createdByName: actor.name }).returning({ id: incentiveCalcCarryWriteoffs.id });
      await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "carry-write-off-requested", entityType: "incentive-calc-carry", entityId: lotId, employeeId: s.lot.employeeId, detail: { category: s.lot.categoryCode, month: D(s.lot.month), requestId: row!.id, amountPaise: s.remaining, reason: why } });
      return { ok: true as const, requestId: row!.id, amountPaise: s.remaining };
    }),
  );
}

/**
 * A SECOND person approves a write-off request (the ledger records the written-off amount, once — never more than
 * remains) or refuses it, always with a reason. The requester never decides their own request (the database refuses it
 * too). Approval is refused while a month awaiting payout counts the balance.
 */
export async function decideCarryWriteOff(actor: Actor, requestId: string, decision: "approve" | "refuse", reason: string): Promise<Result<{ amountPaise: number }>> {
  const why = (reason ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return { ok: false, error: "That write-off request doesn't exist." };
  if (decision !== "approve" && decision !== "refuse") return { ok: false, error: "Approve or refuse it." };
  if (!why) return { ok: false, error: "Give the reason for your decision (it is kept with it)." };
  if (why.length > 1000) return { ok: false, error: "The reason is longer than 1,000 characters." };
  if (!(await incentiveCalcCReady(db))) return { ok: false, error: CALC_C_NOT_READY };
  if (!(await carryWriteoffsReady(db))) return { ok: false, error: CARRY_WRITEOFF_NOT_READY };
  return refusedAs<{ amountPaise: number }>(() =>
    db.transaction(async (tx) => {
      const [req] = await tx.select().from(incentiveCalcCarryWriteoffs).where(eq(incentiveCalcCarryWriteoffs.id, requestId));
      if (!req || req.kind !== "request") return { ok: false as const, error: "That write-off request doesn't exist." };
      const [done] = await tx.select({ id: incentiveCalcCarryWriteoffs.id }).from(incentiveCalcCarryWriteoffs).where(eq(incentiveCalcCarryWriteoffs.requestId, requestId));
      if (done) return { ok: false as const, error: "That write-off request is already decided." };
      if (req.createdById === actor.id) return { ok: false as const, error: "You requested this write-off: a second person approves or refuses it." };
      const s = await lotState(tx, req.lotId);
      if (!s) return { ok: false as const, error: "That balance doesn't exist." };
      let resultCarryId: string | null = null;
      if (decision === "approve") {
        if (s.pendingMonths.length) return { ok: false as const, error: `${s.pendingMonths.join(", ")} counts this balance and awaits payout: pay or reopen it first. Nothing was approved.` };
        if (Number(req.amountPaise) > s.remaining) return { ok: false as const, error: `Only ₹${(s.remaining / 100).toFixed(2)} of this balance remains now, less than the ₹${(Number(req.amountPaise) / 100).toFixed(2)} requested: refuse this request and ask again. Nothing was approved.` };
        const [w] = await tx.insert(incentiveCalcCarry).values({ programId: s.lot.programId, categoryCode: s.lot.categoryCode, employeeId: s.lot.employeeId, employeeName: s.lot.employeeName, month: `${todayIST().slice(0, 7)}-01`, kind: "written-off", amountPaise: -Number(req.amountPaise), lotId: req.lotId, reason: `${req.reason} (requested by ${req.createdByName}; approved by ${actor.name}: ${why})`.slice(0, 1000), createdById: actor.id, createdByName: actor.name }).returning({ id: incentiveCalcCarry.id });
        resultCarryId = w!.id;
      }
      await tx.insert(incentiveCalcCarryWriteoffs).values({ kind: decision, requestId, lotId: req.lotId, resultCarryId, employeeId: req.employeeId, employeeName: req.employeeName, amountPaise: Number(req.amountPaise), reason: why, createdById: actor.id, createdByName: actor.name });
      await tx.insert(incentiveAudit).values({ actorId: actor.id, action: decision === "approve" ? "carry-write-off-approved" : "carry-write-off-refused", entityType: "incentive-calc-carry", entityId: req.lotId, employeeId: req.employeeId, detail: { category: s.lot.categoryCode, month: D(s.lot.month), requestId, amountPaise: Number(req.amountPaise), reason: why, requestedBy: req.createdByName } });
      return { ok: true as const, amountPaise: decision === "approve" ? Number(req.amountPaise) : 0 };
    }),
  );
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

/**
 * Category F separation of duties: whoever recorded or retired a decision on any Google review of the month's
 * calculation (its stored inputs) never approves or rejects that month (the database refuses it too, 0137).
 */
async function decidedFReview(tx: Tx, runId: string, actorId: string): Promise<boolean> {
  const r = await tx.execute(sql`
    select exists (
      select 1 from incentive_calc_runs run
      cross join lateral jsonb_array_elements(coalesce(run.inputs->'fReviews', '[]'::jsonb)) rv
      join incentive_f_decisions d on d.review_id::text = rv->>'reviewId'
      where run.id = ${runId} and (d.created_by_id = ${actorId} or d.retired_by_id = ${actorId})
    ) as yes`);
  return rowsOf<{ yes: boolean }>(r)[0]?.yes === true;
}

/**
 * Every category's separation of duties (maker-checker), on top of each category's own checks above: whoever RECORDED
 * OR RETIRED an input the month's calculation uses — an order's salespeople, a customer's representative period, a
 * receipt event (on a document of the calculation), or approved or rejected a submission it counts (leads,
 * conversions, meetings, testimonials) — never approves or rejects that month. Read from the run's STORED inputs, so it
 * is exactly what was calculated. What the person decided, or null. Reads only.
 */
async function decidedInputs(tx: Tx, runId: string, actorId: string): Promise<string | null> {
  const r = await tx.execute(sql`
    with run as (select inputs from incentive_calc_runs where id = ${runId}),
    docs as (select d->>'id' as id from run, jsonb_array_elements(coalesce(run.inputs->'orders', '[]'::jsonb) || coalesce(run.inputs->'invoices', '[]'::jsonb) || coalesce(run.inputs->'creditNotes', '[]'::jsonb) || coalesce(run.inputs->'receipts', '[]'::jsonb)) d),
    custs as (select c->>'id' as id from run, jsonb_array_elements(coalesce(run.inputs->'customers', '[]'::jsonb)) c),
    evs as (select e->>'id' as id from run, jsonb_array_elements(coalesce(run.inputs->'events', '[]'::jsonb)) e)
    select
      exists (select 1 from incentive_calc_attributions a where a.document_id::text in (select id from docs) and (a.created_by_id = ${actorId} or a.retired_by_id = ${actorId})) as attribution,
      exists (select 1 from incentive_calc_rep_history h where h.customer_master_id::text in (select id from custs) and (h.created_by_id = ${actorId} or h.retired_by_id = ${actorId})) as rep,
      exists (select 1 from incentive_calc_receipt_events e where (e.id::text in (select id from evs) or e.document_id::text in (select id from docs)) and (e.created_by_id = ${actorId} or e.retired_by_id = ${actorId})) as event`);
  const hit = rowsOf<{ attribution: boolean; rep: boolean; event: boolean }>(r)[0];
  if (hit?.attribution) return "You recorded or retired an order's salespeople used by this month's calculation";
  if (hit?.rep) return "You recorded or retired a customer's representative period used by this month's calculation";
  if (hit?.event) return "You recorded or retired a receipt event used by this month's calculation";
  // The tracker's submissions it counts (D, E, F's testimonials): only when the run counted any (their tables then exist).
  const [run] = await tx.select({ inputs: incentiveCalcRuns.inputs }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const inputs = (run?.inputs ?? {}) as Record<string, { id: string }[] | undefined>;
  const SUBMISSIONS = [["leadBatches", "lead_batches"], ["leadConversions", "lead_conversions"], ["meetings", "client_meetings"], ["testimonials", "testimonials"]] as const;
  for (const [key, table] of SUBMISSIONS) {
    const ids = (inputs[key] ?? []).map((x) => x.id).filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length) continue;
    const s = await tx.execute(sql`select exists (select 1 from ${sql.identifier(table)} t where t.id::text in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and t.reviewed_by_id = ${actorId}) as yes`);
    if (rowsOf<{ yes: boolean }>(s)[0]?.yes) return "You approved or rejected a submission counted in this month's calculation";
  }
  return null;
}

/**
 * Category B: what of the month's calculation is still undecided — Sales Orders whose qualification needs review, and
 * invoices with no Sales Order that nobody has reviewed (0140). Either keeps the month from being submitted, approved or
 * paid (it would otherwise pass silently). Why, or null. Reads only.
 */
async function bUnresolved(tx: Tx, runId: string, step: "submit" | "approve" | "pay"): Promise<string | null> {
  const [run] = await tx.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const res = run?.result as CategoryBResult | undefined;
  const orders = (res?.qualifications ?? []).filter((q) => q.outcome === "needs-review");
  const invoices = res?.reviewInvoices ?? [];
  const what = { submit: "submitted", approve: "approved", pay: "paid" }[step];
  const fix = step === "submit" ? "reopen the month, decide them, recalculate, then lock and submit it again" : step === "approve" ? "reject it, then decide them and recalculate" : "decide them first";
  if (orders.length) return `${orders.length} Sales Order${orders.length === 1 ? "" : "s"} of this month (${orders.slice(0, 3).map((o) => o.orderNo).join(", ")}${orders.length > 3 ? ", …" : ""}) still need${orders.length === 1 ? "s" : ""} a Category B decision (Review & decisions): ${fix}. Nothing was ${what}.`;
  if (!invoices.length) return null;
  if (!(await bInvoiceReviewsReady(tx))) return `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} of this month ha${invoices.length === 1 ? "s" : "ve"} no Sales Order in Forms and need${invoices.length === 1 ? "s" : ""} review. Recording that review needs database update 0140; until then, correct the Sales Order link in Forms and recalculate. Nothing was ${what}.`;
  const decided = await tx.select({ id: incentiveCalcBInvoiceReviews.invoiceDocumentId }).from(incentiveCalcBInvoiceReviews).where(and(inArray(incentiveCalcBInvoiceReviews.invoiceDocumentId, invoices.map((i) => i.invoiceId)), isNull(incentiveCalcBInvoiceReviews.retiredAt)));
  const done = new Set(decided.map((d) => d.id));
  const open = invoices.filter((i) => !done.has(i.invoiceId));
  if (!open.length) return null;
  return `${open.length} invoice${open.length === 1 ? "" : "s"} of this month with no Sales Order (${open.slice(0, 3).map((i) => i.invoiceNo).join(", ")}${open.length > 3 ? ", …" : ""}) ${open.length === 1 ? "hasn't" : "haven't"} been reviewed (Calculation → invoices needing review): review ${open.length === 1 ? "it" : "them"}, or correct the Sales Order link in Forms and recalculate. Nothing was ${what}.`;
}

/** Category B (0140): whether the person recorded or retired a review of an invoice the month's calculation lists for review. */
async function bInvoiceDecided(tx: Tx, runId: string, actorId: string): Promise<boolean> {
  const r = await tx.execute(sql`
    select exists (
      select 1 from incentive_calc_runs run
      cross join lateral jsonb_array_elements(coalesce(run.result->'reviewInvoices', '[]'::jsonb)) ri
      join incentive_calc_b_invoice_reviews d on d.invoice_document_id::text = ri->>'invoiceId'
      where run.id = ${runId} and (d.created_by_id = ${actorId} or d.retired_by_id = ${actorId})
    ) as yes`);
  return rowsOf<{ yes: boolean }>(r)[0]?.yes === true;
}

/** Whether 0140's Category B invoice review table exists. */
export async function bInvoiceReviewsReady(q: Db = db): Promise<boolean> {
  return rowsOf<{ ok: boolean }>(await q.execute(sql`select to_regclass('public.incentive_calc_b_invoice_reviews') is not null as ok`))[0]?.ok === true;
}
/** Whether 0141's two-person carry write-off table exists. */
export async function carryWriteoffsReady(q: Db = db): Promise<boolean> {
  return rowsOf<{ ok: boolean }>(await q.execute(sql`select to_regclass('public.incentive_calc_carry_writeoffs') is not null as ok`))[0]?.ok === true;
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

/**
 * Category A separation of duties at approval: why the person may not approve or reject the month — they calculated
 * its adopted run, locked it, acknowledged one of its held items, or it pays them — or null. Reads only.
 */
async function aConflictOfInterest(tx: Tx, p: PeriodRowT, actorId: string): Promise<string | null> {
  const [run] = await tx.select({ by: incentiveCalcRuns.computedById }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, p.currentRunId!));
  if (run?.by === actorId) return "You calculated this month";
  if (p.lockedById === actorId) return "You locked this month";
  const [mine] = await tx.select({ payable: incentiveCalcResults.payablePaise }).from(incentiveCalcResults).where(and(eq(incentiveCalcResults.runId, p.currentRunId!), eq(incentiveCalcResults.employeeId, actorId)));
  if (mine && Number(mine.payable) > 0) return "This month pays you";
  if (await acknowledgedHeld(tx, p.currentRunId!, actorId)) return "You acknowledged a held item of this month";
  return null;
}

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
    // Category B: every order needing review, and every invoice with no Sales Order, is decided first (fail-closed).
    if (category === "B") {
      const open = await bUnresolved(tx, p.currentRunId!, "submit");
      if (open) return { ok: false as const, error: open };
    }
    // Category A: nothing held stays unresolved or unacknowledged (fail-closed), and the Category B orders a version
    // leaves out of Category A are still the ones it was calculated with.
    if (category === "A") {
      const open = (await aUnresolved(tx, p.currentRunId!, "submit")) ?? (await staleCategoryBOrders(tx, programId, p.currentRunId!));
      if (open) return { ok: false as const, error: open };
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
    if (category === "F" && p.currentRunId && (await decidedFReview(tx, p.currentRunId, actor.id))) return { ok: false as const, error: "You verified, attributed or invalidated a Google review of this month, so you can't approve or reject it. Another authorised person must." };
    if (category === "B" && p.currentRunId && (await bInvoiceReviewsReady(tx)) && (await bInvoiceDecided(tx, p.currentRunId, actor.id))) return { ok: false as const, error: "You reviewed an invoice of this month that has no Sales Order, so you can't approve or reject it. Another authorised person must." };
    // Every category: whoever recorded an input this month's calculation uses never approves or rejects it.
    const ownInput = p.currentRunId ? await decidedInputs(tx, p.currentRunId, actor.id) : null;
    if (ownInput) return { ok: false as const, error: `${ownInput}, so you can't approve or reject it. Another authorised person must.` };
    // Category A: nobody approves or rejects a month they calculated, locked, acknowledged a held item of, or that pays
    // them (the database refuses it too, 0142).
    if (category === "A" && p.currentRunId) {
      const conflict = await aConflictOfInterest(tx, p, actor.id);
      if (conflict) return { ok: false as const, error: `${conflict}, so you can't approve or reject it. Another authorised person must.` };
    }
    const prior = await tx.select().from(incentiveCalcApprovals).where(and(eq(incentiveCalcApprovals.periodId, p.id), eq(incentiveCalcApprovals.submissionNo, p.submissionNo)));
    if (prior.some((a) => a.actorId === actor.id)) return { ok: false as const, error: "You already approved a step of this submission; the next step needs someone else." };
    const step = prior.length + 1;
    if (decision === "approve") {
      const invalid = await invalidCalculation(tx, p.currentRunId);
      if (invalid) return { ok: false as const, error: `${invalid} (Reject it with that reason.)` };
      // The all-categories limit: checked at submission, and again here — another category's figures may have changed
      // since, and with them this month's share of the limit. (A rejection is always possible.)
      const staleShared = await staleAllCategories(tx, programId, month, p.currentRunId!, category);
      if (staleShared) return { ok: false as const, error: `${staleShared.replace(/: reopen and recalculate it before submitting\.$/, ".")} Reject it so it is recalculated and submitted again. Nothing was approved.` };
      if (category === "B") {
        const open = await bUnresolved(tx, p.currentRunId!, "approve");
        if (open) return { ok: false as const, error: open };
      }
      if (category === "A") {
        const open = await aUnresolved(tx, p.currentRunId!, "approve");
        if (open) return { ok: false as const, error: open };
        const staleB = await staleCategoryBOrders(tx, programId, p.currentRunId!);
        if (staleB) return { ok: false as const, error: `${staleB.replace(/: reopen and recalculate it before it goes on.$/, ".")} Reject it so it is recalculated and submitted again. Nothing was approved.` };
      }
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
    // Category A: whoever approved a step of the submission never records its payout, and a held item whose
    // acknowledgment was retired after the approval stops the payout until it is acknowledged again (0142 too).
    if (category === "A") {
      const [approver] = await tx.select({ id: incentiveCalcApprovals.id }).from(incentiveCalcApprovals).where(and(eq(incentiveCalcApprovals.periodId, p.id), eq(incentiveCalcApprovals.submissionNo, p.submissionNo), eq(incentiveCalcApprovals.decision, "approve"), eq(incentiveCalcApprovals.actorId, actor.id)));
      if (approver) return { ok: false as const, error: "You approved a step of this month, so you can't record its payout. Another authorised person must." };
      const open = await aUnresolved(tx, p.currentRunId!, "pay");
      if (open) return { ok: false as const, error: open };
    }
    // Category B: an invoice review retired after the approval stops the payout until it is decided again.
    if (category === "B") {
      const open = await bUnresolved(tx, p.currentRunId!, "pay");
      if (open) return { ok: false as const, error: open };
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
export async function myCategoryA(employeeId: string, q: Q = db, category: CalcCategory = "A"): Promise<{ ready: boolean; months: MyCategoryAMonth[]; awaiting: string[]; voided: { month: string; carriedToMonth: string | null }[] }> {
  if (await readyFor(category, q)) return { ready: false, months: [], awaiting: [], voided: [] };
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
    .select({ id: incentiveCalcPeriods.id, month: incentiveCalcPeriods.month })
    .from(incentiveCalcPeriods)
    .innerJoin(incentiveCalcResults, and(eq(incentiveCalcResults.runId, incentiveCalcPeriods.currentRunId), eq(incentiveCalcResults.employeeId, employeeId)))
    .where(and(eq(incentiveCalcPeriods.categoryCode, category), inArray(incentiveCalcPeriods.status, ["open", "locked", "submitted"])));
  // Category C: a voided month is never approved — it is shown as voided (with where its amounts went), not as awaiting.
  const voids = category === "C" && pending.length ? await q.select().from(incentiveCalcPeriodVoids).where(inArray(incentiveCalcPeriodVoids.periodId, pending.map((x) => x.id))) : [];
  const voidedIds = new Set(voids.map((v) => v.periodId));
  return {
    ready: true,
    months,
    awaiting: [...new Set(pending.filter((x) => !voidedIds.has(x.id)).map((x) => D(x.month)))].sort().reverse(),
    voided: pending.filter((x) => voidedIds.has(x.id)).map((x) => ({ month: D(x.month), carriedToMonth: (() => { const v = voids.find((y) => y.periodId === x.id)?.carriedToMonth; return v ? D(v) : null; })() })).sort((a, b) => b.month.localeCompare(a.month)),
  };
}

/** The signed-in person's OWN Category B, approved and paid months only — the same safeguards as Category A. */
export const myCategoryB = (employeeId: string, q: Q = db) => myCategoryA(employeeId, q, "B");
