// Engine ↔ DB bridge. Reads an employee's month of commercial + activity
// events, computes per-invoice collection state (days past agreed terms →
// decay), builds the pure engine input, evaluates, and upserts the append-only
// ledger idempotently. Uses Date here (script/server side) — only the pure
// engine forbids Date.

import { and, eq, ne, gte, lt, inArray, desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salesOrders, invoices, receipts, customers,
  leadBatches, leadConversions, clientMeetings, testimonials,
  incentivePeriods, incentiveLedger, ruleVersions, employees,
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

/**
 * Whether the NEW Category A engine (lib/incentives/category-a) is authoritative for a month: a PUBLISHED Category A
 * configuration of any programme (Admin & Master Setup → Incentive Rules, migration 0131) covers the month's first day.
 * From such a month this old engine no longer calculates Category A; it keeps calculating Categories B–G. Old
 * Category A ledger rows are never deleted or changed — they stay as historical records. Before 0131 exists, or with
 * nothing published, nothing changes.
 */
export async function newCategoryAAuthoritative(period: string): Promise<boolean> {
  return newEngineAuthoritative("A", period);
}

/**
 * The people the NEW Category A engine is authoritative for in a month — scoped to the programmes' eligibility, never
 * global: a person is covered when a PUBLISHED Category A version in force on the month's first day includes them (by
 * name, department or role, as the employee record reads) on at least one day of the month, and no exclude row of that
 * version covers that day. For a covered person this old engine no longer calculates (or pays) Category A that month;
 * for everyone else it carries on exactly as before. Null when no Category A version covers the month (or before 0131).
 */
export async function newCategoryACovered(period: string): Promise<Set<string> | null> {
  const start = `${period}-01`;
  const ready = await db.execute(sql`select to_regclass('public.incentive_config_versions') is not null and to_regclass('public.incentive_config_eligibility') is not null as ok`);
  const okRows = (Array.isArray(ready) ? ready : ((ready as unknown as { rows?: unknown[] }).rows ?? [])) as { ok: boolean }[];
  if (okRows[0]?.ok !== true) return null;
  const res = await db.execute(sql`
    select v.id::text as version_id, e.subject_type, e.subject_id::text as subject_id, e.role, e.mode, e.effective_from::text as from_day, e.effective_to::text as to_day
    from incentive_config_versions v left join incentive_config_eligibility e on e.version_id = v.id
    where v.category_code = 'A' and v.status = 'published' and v.effective_from <= ${start}::date and (v.effective_to is null or v.effective_to >= ${start}::date)`);
  const rows = (Array.isArray(res) ? res : ((res as unknown as { rows?: unknown[] }).rows ?? [])) as { version_id: string; subject_type: string | null; subject_id: string | null; role: string | null; mode: string | null; from_day: string | null; to_day: string | null }[];
  if (!rows.length) return null;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`);
  const people = await db.select({ id: employees.id, departmentId: employees.departmentId, role: employees.role }).from(employees);
  const versions = new Map<string, typeof rows>();
  for (const r of rows) versions.set(r.version_id, [...(versions.get(r.version_id) ?? []), ...(r.subject_type ? [r] : [])]);
  const matches = (p: (typeof people)[number], r: (typeof rows)[number]) => (r.subject_type === "employee" ? r.subject_id === p.id : r.subject_type === "department" ? r.subject_id !== null && r.subject_id === p.departmentId : r.role === p.role);
  const covers = (r: (typeof rows)[number], d: string) => r.from_day! <= d && (r.to_day === null || r.to_day >= d);
  const out = new Set<string>();
  for (const p of people)
    for (const elig of versions.values())
      if (days.some((d) => elig.some((r) => r.mode === "include" && matches(p, r) && covers(r, d)) && !elig.some((r) => r.mode === "exclude" && matches(p, r) && covers(r, d)))) {
        out.add(p.id);
        break;
      }
  return out;
}

/**
 * Whether the NEW engine of a category (Category A, or Category B — lib/incentives/category-b) is authoritative for a
 * month: a PUBLISHED configuration of that category, of any programme, covers the month's first day — that is, from
 * the published configuration's effective (cut-over) month on. From such a month this old engine no longer calculates
 * the category and never deletes or changes its own earlier rows for it (they stay as historical records); before it,
 * nothing changes. Before 0131 exists, or with nothing published, the old engine stays authoritative.
 */
export async function newEngineAuthoritative(category: "A" | "B", period: string): Promise<boolean> {
  const start = `${period}-01`;
  const res = await db.execute(sql`
    select case when to_regclass('public.incentive_config_versions') is null then false
      else exists (select 1 from incentive_config_versions v where v.category_code = ${category} and v.status = 'published'
        and v.effective_from <= ${start}::date and (v.effective_to is null or v.effective_to >= ${start}::date)) end as yes`);
  const rows = (Array.isArray(res) ? res : ((res as unknown as { rows?: unknown[] }).rows ?? [])) as { yes: boolean }[];
  return rows[0]?.yes === true;
}

/**
 * Every category whose NEW engine is authoritative for the month (a published configuration of it covers the month's
 * first day). One read; before 0131 exists, none.
 */
export async function authoritativeCategories(period: string): Promise<Set<string>> {
  const start = `${period}-01`;
  const res = await db.execute(sql`
    select case when to_regclass('public.incentive_config_versions') is null then null
      else (select coalesce(string_agg(distinct v.category_code, ','), '') from incentive_config_versions v where v.status = 'published'
        and v.effective_from <= ${start}::date and (v.effective_to is null or v.effective_to >= ${start}::date)) end as cats`);
  const rows = (Array.isArray(res) ? res : ((res as unknown as { rows?: unknown[] }).rows ?? [])) as { cats: string | null }[];
  return new Set((rows[0]?.cats ?? "").split(",").filter(Boolean));
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
  // Where the new Category A engine is authoritative, this engine no longer calculates Category A (its sales slab is
  // the only thing `sales` feeds). B–G are unaffected.
  // Scoped to the people a published Category A version covers that month (D25): everyone else keeps the old Category A.
  const newA = (await newCategoryACovered(period))?.has(employeeId) === true;
  if (newA) input.sales = undefined;
  // Likewise Category B (cross-sell): from the published Category B configuration's cut-over month, the new engine
  // calculates it and this one no longer does.
  const newB = await newEngineAuthoritative("B", period);
  if (newB) input.crossSellInvoices = [];
  // And Categories C–F, each from its own published configuration's month (G has no old-engine rule).
  const newer = await authoritativeCategories(period);
  if (newer.has("C")) input.newCustomerCohorts = [];
  if (newer.has("D")) {
    input.leadBatches = [];
    input.leadConversions = [];
  }
  if (newer.has("E")) input.meetings = [];
  if (newer.has("F")) input.testimonials = [];
  const kept = (["C", "D", "E", "F"] as const).filter((c) => newer.has(c));
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
  // Where the new Category A engine is authoritative, this engine's earlier Category A rows for the month are left
  // exactly as they are (historical records), so only B–G accruals are cleared and rewritten.
  await db
    .delete(incentiveLedger)
    .where(and(eq(incentiveLedger.employeeId, employeeId), eq(incentiveLedger.periodId, periodId), eq(incentiveLedger.entryType, "accrual"), ...(newA ? [ne(incentiveLedger.category, "A")] : []), ...(newB ? [ne(incentiveLedger.category, "B")] : []), ...kept.map((c) => ne(incentiveLedger.category, c))));

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
  // A testimonial whose employee was deleted (0137: kept, employee_id null) is history: nobody to recompute.
  for (const r of [...lb, ...lc, ...mt, ...ts]) if (r.id) ids.add(r.id);

  const asOf = new Date();
  for (const id of ids) await computePeriodForEmployee(id, period, asOf);
  return { employees: ids.size };
}
