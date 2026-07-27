// Engine ↔ DB bridge. Reads an employee's month of commercial + activity
// events, computes per-invoice collection state (days past agreed terms →
// decay), builds the pure engine input, evaluates, and upserts the append-only
// ledger idempotently. Uses Date here (script/server side) — only the pure
// engine forbids Date.

import { and, eq, gte, lt, inArray, desc, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salesOrders, invoices, receipts, customers,
  leadBatches, leadConversions, clientMeetings, testimonials,
  incentivePeriods, incentiveLedger, ruleVersions,
} from "@/db/schema";
import { evaluate } from "./engine";
import { SALES_BH_SCHEME } from "./config";
import type {
  CrossSellInvoice, DecayStep, EvaluationInput, EvaluationResult, NewCustomerCohort,
  SchemeConfig, TestimonialKind,
} from "./types";

/**
 * The scheme config that drives computation — the latest published rule_version
 * if the admin has edited the scheme, else the built-in Sales-BH default. JSON
 * cannot hold Infinity, so the open-ended decay step round-trips as null and is
 * restored here.
 */
function parseConfig(raw: unknown): SchemeConfig {
  const cfg = (raw ?? {}) as Partial<SchemeConfig>;
  const steps = (cfg.decaySteps ?? SALES_BH_SCHEME.decaySteps).map((s): DecayStep => ({
    maxDaysPastTerms: s.maxDaysPastTerms == null ? Infinity : s.maxDaysPastTerms,
    multiplier: s.multiplier,
  }));
  return { ...SALES_BH_SCHEME, ...cfg, decaySteps: steps };
}

/** The latest published config — for the admin editor's current values. */
export async function getActiveSchemeConfig(): Promise<SchemeConfig> {
  const [rv] = await db.select({ config: ruleVersions.config }).from(ruleVersions).orderBy(desc(ruleVersions.createdAt)).limit(1);
  return rv?.config ? parseConfig(rv.config) : SALES_BH_SCHEME;
}

/**
 * The config EFFECTIVE for a given period — the newest version whose
 * effective_from is on/before the period start (versions with no effective_from
 * are treated as always-effective). This pins each month to the scheme that was
 * live then, so publishing a change never retroactively restates an old month.
 */
export async function getSchemeConfigForPeriod(period: string): Promise<SchemeConfig> {
  const periodStart = `${period}-01`;
  const versions = await db
    .select({ config: ruleVersions.config, effectiveFrom: ruleVersions.effectiveFrom, createdAt: ruleVersions.createdAt })
    .from(ruleVersions);
  const applicable = versions.filter((v) => !v.effectiveFrom || String(v.effectiveFrom) <= periodStart);
  applicable.sort((a, b) => String(b.effectiveFrom ?? "").localeCompare(String(a.effectiveFrom ?? "")) || b.createdAt.getTime() - a.createdAt.getTime());
  return applicable[0]?.config ? parseConfig(applicable[0]!.config) : SALES_BH_SCHEME;
}

const DAY = 86_400_000;
const dayDiff = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / DAY);

/** [start, end) UTC bounds of a "YYYY-MM" period. */
function monthBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  return { start, end };
}

interface InvoiceRow {
  id: string;
  orderId: string;
  invoiceValuePaise: number;
  invoiceDate: string;
  agreedTermsDays: number;
  dueDate: string | null;
}

/**
 * Days a full collection is past the agreed terms as of `asOf`:
 *  - fully collected → days between the completing receipt and the due date
 *  - still outstanding → days between `asOf` and the due date (grows over time)
 * Negative/zero = on time.
 */
function invoiceDaysPastTerms(
  inv: InvoiceRow,
  invReceipts: { amountPaise: number; receivedAt: string }[],
  asOf: Date,
): number {
  const due = inv.dueDate
    ? new Date(inv.dueDate)
    : new Date(new Date(inv.invoiceDate).getTime() + inv.agreedTermsDays * DAY);
  const paid = invReceipts.reduce((s, r) => s + r.amountPaise, 0);
  if (paid >= inv.invoiceValuePaise && invReceipts.length > 0) {
    const last = invReceipts
      .map((r) => new Date(r.receivedAt))
      .reduce((a, b) => (a > b ? a : b));
    return Math.max(0, dayDiff(last, due));
  }
  return Math.max(0, dayDiff(asOf, due));
}

/** Build the pure engine input for one employee-period from DB state. */
export async function buildEvaluationInput(
  employeeId: string,
  period: string,
  asOf: Date,
  scheme: SchemeConfig = SALES_BH_SCHEME,
): Promise<EvaluationInput> {
  const { start, end } = monthBounds(period);

  // Orders owned by the employee, booked in the month. Only CONFIRMED orders
  // count toward incentive — rep-logged sales are provisional until an admin
  // confirms them.
  const orders = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.ownerId, employeeId), gte(salesOrders.bookedAt, start), lt(salesOrders.bookedAt, end), eq(salesOrders.confirmed, true)));

  const orderIds = orders.map((o) => o.id);
  const invs = orderIds.length
    ? await db.select().from(invoices).where(inArray(invoices.orderId, orderIds))
    : [];
  const invIds = invs.map((i) => i.id);
  const recs = invIds.length
    ? await db.select().from(receipts).where(inArray(receipts.invoiceId, invIds))
    : [];
  const recsByInvoice = new Map<string, { amountPaise: number; receivedAt: string }[]>();
  for (const r of recs) {
    const arr = recsByInvoice.get(r.invoiceId) ?? [];
    arr.push({ amountPaise: r.amountPaise, receivedAt: r.receivedAt });
    recsByInvoice.set(r.invoiceId, arr);
  }
  const decayFor = (inv: typeof invs[number]) =>
    invoiceDaysPastTerms(inv as unknown as InvoiceRow, recsByInvoice.get(inv.id) ?? [], asOf);

  // A · monthly sales + value-weighted collection decay across the month's
  // invoices (Q5 default: per-invoice, blended for the aggregate slab).
  const monthlySalesPaise = orders.reduce((s, o) => s + o.orderValuePaise, 0);
  let slabDecay = 1;
  if (invs.length) {
    const { decayMultiplier } = await import("./collection");
    const totalVal = invs.reduce((s, i) => s + i.invoiceValuePaise, 0) || 1;
    slabDecay =
      invs.reduce((s, i) => s + i.invoiceValuePaise * decayMultiplier(decayFor(i), scheme.decaySteps), 0) /
      totalVal;
  }

  // B · cross-sell — category "B" orders; use their first invoice.
  const crossSellInvoices: CrossSellInvoice[] = [];
  for (const o of orders.filter((o) => o.categoryCode === "B")) {
    const first = invs.filter((i) => i.orderId === o.id).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))[0];
    if (first) {
      crossSellInvoices.push({
        id: first.id,
        invoiceValuePaise: first.invoiceValuePaise,
        daysPastTerms: decayFor(first),
      });
    }
  }

  // C · new-customer cohorts — customers acquired by this employee whose 3rd
  // acquisition-type transaction completes in this month.
  const newCustomerCohorts = await buildNewCustomerCohorts(employeeId, start, end, asOf, scheme);

  // Activity spine — approved submissions in the period.
  const [batches, convs, meets, tests] = await Promise.all([
    db.select().from(leadBatches).where(and(eq(leadBatches.employeeId, employeeId), eq(leadBatches.periodMonth, period))),
    db.select().from(leadConversions).where(and(eq(leadConversions.employeeId, employeeId), eq(leadConversions.periodMonth, period))),
    db.select().from(clientMeetings).where(and(eq(clientMeetings.employeeId, employeeId), eq(clientMeetings.periodMonth, period))),
    db.select().from(testimonials).where(and(eq(testimonials.employeeId, employeeId), eq(testimonials.periodMonth, period))),
  ]);

  return {
    employeeId,
    period,
    sales: monthlySalesPaise > 0 ? { monthlySalesPaise, decayMultiplier: slabDecay } : undefined,
    crossSellInvoices,
    newCustomerCohorts,
    leadBatches: batches.map((b) => ({ id: b.id, leadCount: b.leadCount, profiled: b.profiled, approved: b.reviewStatus === "approved" })),
    leadConversions: convs.map((c) => ({ id: c.id, convertedCount: c.convertedCount, approved: c.reviewStatus === "approved" })),
    meetings: meets.map((m) => ({ id: m.id, awardedPaise: m.awardedPaise, approved: m.reviewStatus === "approved" })),
    testimonials: tests.map((t) => ({
      id: t.id, kind: t.kind as TestimonialKind, wordCount: t.wordCount,
      starRating: t.starRating ?? undefined, hasScreenshot: !!t.evidenceUrl,
      namesTeamMember: t.namesTeamMember, approved: t.reviewStatus === "approved",
    })),
  };
}

async function buildNewCustomerCohorts(
  employeeId: string, start: Date, end: Date, asOf: Date, scheme: SchemeConfig,
): Promise<NewCustomerCohort[]> {
  const acq = await db.select().from(customers).where(eq(customers.acquisitionEmployeeId, employeeId));
  const cohorts: NewCustomerCohort[] = [];
  // Current FY (Apr–Mar) start for the period being computed.
  const fyYear = start.getUTCMonth() >= 3 ? start.getUTCFullYear() : start.getUTCFullYear() - 1;
  const fyStart = new Date(Date.UTC(fyYear, 3, 1));
  for (const cust of acq) {
    const allOrders = await db.select().from(salesOrders).where(and(eq(salesOrders.customerId, cust.id), eq(salesOrders.confirmed, true)));
    // Turnover is DERIVED from actual orders in the FY, not a cached counter that
    // could drift when a deal is edited or deleted.
    const fyTurnoverPaise = allOrders.filter((o) => o.bookedAt >= fyStart).reduce((s, o) => s + o.orderValuePaise, 0);
    const custOrders = allOrders
      .filter((o) => ["C", "N", "I", "R"].includes(o.categoryCode))
      .sort((a, b) => a.bookedAt.getTime() - b.bookedAt.getTime());
    if (custOrders.length < scheme.newCustomer.requiredTxns) continue;
    const first3 = custOrders.slice(0, scheme.newCustomer.requiredTxns);
    const thirdBooked = first3[first3.length - 1]!.bookedAt;
    if (thirdBooked < start || thirdBooked >= end) continue; // credit only in the completing month

    const first3OrderIds = first3.map((o) => o.id);
    const first3Invs = await db.select().from(invoices).where(inArray(invoices.orderId, first3OrderIds));
    const invIds = first3Invs.map((i) => i.id);
    const recs = invIds.length ? await db.select().from(receipts).where(inArray(receipts.invoiceId, invIds)) : [];
    const recsByInv = new Map<string, { amountPaise: number; receivedAt: string }[]>();
    for (const r of recs) {
      const arr = recsByInv.get(r.invoiceId) ?? [];
      arr.push({ amountPaise: r.amountPaise, receivedAt: r.receivedAt });
      recsByInv.set(r.invoiceId, arr);
    }
    const paidByInv = new Map<string, number>();
    for (const r of recs) paidByInv.set(r.invoiceId, (paidByInv.get(r.invoiceId) ?? 0) + r.amountPaise);
    const fullyPaid = first3Invs.every((i) => (paidByInv.get(i.id) ?? 0) >= i.invoiceValuePaise);
    // Decay driven by the LATEST-collecting of the first-3 invoices (receipt-aware).
    const daysPastTerms = Math.max(
      0,
      ...first3Invs.map((i) =>
        invoiceDaysPastTerms(i as unknown as InvoiceRow, recsByInv.get(i.id) ?? [], asOf),
      ),
    );

    cohorts.push({
      id: cust.id,
      customer: cust.name,
      first3TotalPaise: first3.reduce((s, o) => s + o.orderValuePaise, 0),
      fyTurnoverPaise,
      transactionsDone: custOrders.length,
      fullyPaid,
      daysPastTerms,
    });
  }
  return cohorts;
}

/** Ensure a period row exists; return its id. */
export async function ensurePeriod(period: string): Promise<string> {
  const existing = await db.select().from(incentivePeriods).where(eq(incentivePeriods.month, period)).limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db.insert(incentivePeriods).values({ month: period }).returning({ id: incentivePeriods.id });
  return row!.id;
}

/**
 * Evaluate one employee-period and upsert `accrual` ledger rows idempotently
 * (unique on period+employee+line+source_ref+entry_type). Returns the result.
 */
export async function computePeriodForEmployee(
  employeeId: string, period: string, asOf: Date = new Date(),
): Promise<EvaluationResult> {
  const scheme = await getSchemeConfigForPeriod(period);
  const input = await buildEvaluationInput(employeeId, period, asOf, scheme);
  const result = evaluate(input, scheme);
  const periodId = await ensurePeriod(period);

  // A locked/paid period is finalized — never rewrite its ledger. Late edits or
  // collections against it are recorded in the source data but the payout that
  // was locked stays exactly as it was paid.
  const [prow] = await db.select({ status: incentivePeriods.status }).from(incentivePeriods).where(eq(incentivePeriods.id, periodId)).limit(1);
  if (prow?.status === "locked" || prow?.status === "paid") return result;

  // Recompute is wholesale for accruals: clear this employee-period's accrual
  // rows first so sources that no longer exist (deleted invoices/submissions)
  // don't linger and double-count. Reversals/adjustments are preserved.
  await db
    .delete(incentiveLedger)
    .where(and(eq(incentiveLedger.employeeId, employeeId), eq(incentiveLedger.periodId, periodId), eq(incentiveLedger.entryType, "accrual")));

  for (const line of result.lines) {
    await db
      .insert(incentiveLedger)
      .values({
        employeeId,
        periodId,
        ruleLineCode: line.lineCode,
        category: line.category,
        entryType: "accrual",
        amountPaise: line.finalPaise,
        sourceRef: line.sourceRef,
        explanation: line.capNote ? `${line.explanation} ${line.capNote}` : line.explanation,
        computedAt: asOf,
      })
      .onConflictDoUpdate({
        target: [
          incentiveLedger.periodId, incentiveLedger.employeeId,
          incentiveLedger.ruleLineCode, incentiveLedger.sourceRef, incentiveLedger.entryType,
        ],
        set: {
          amountPaise: line.finalPaise,
          explanation: line.capNote ? `${line.explanation} ${line.capNote}` : line.explanation,
          computedAt: asOf,
        },
      });
  }
  return result;
}

/**
 * Recompute a period for every employee with orders or activity in it. Called
 * by the daily cron so collection-decay (which advances with the calendar)
 * stays accurate without anyone touching the app. Locked/paid periods are
 * skipped by computePeriodForEmployee, so this never disturbs a finalized month.
 */
export async function recomputeOpenPeriod(period: string): Promise<{ employees: number }> {
  const ids = new Set<string>();
  const owners = await db.selectDistinct({ id: salesOrders.ownerId }).from(salesOrders).where(isNotNull(salesOrders.ownerId));
  for (const o of owners) if (o.id) ids.add(o.id);
  const [lb, lc, mt, ts] = await Promise.all([
    db.selectDistinct({ id: leadBatches.employeeId }).from(leadBatches).where(eq(leadBatches.periodMonth, period)),
    db.selectDistinct({ id: leadConversions.employeeId }).from(leadConversions).where(eq(leadConversions.periodMonth, period)),
    db.selectDistinct({ id: clientMeetings.employeeId }).from(clientMeetings).where(eq(clientMeetings.periodMonth, period)),
    db.selectDistinct({ id: testimonials.employeeId }).from(testimonials).where(eq(testimonials.periodMonth, period)),
  ]);
  for (const r of [...lb, ...lc, ...mt, ...ts]) ids.add(r.id);

  const asOf = new Date();
  for (const id of ids) await computePeriodForEmployee(id, period, asOf);
  return { employees: ids.size };
}
