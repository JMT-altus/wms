import "server-only";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMasters,
  employees,
  forecastActuals,
  forecastEvents,
  forecastGrowthSplits,
  forecastLines,
  forecastTargets,
} from "@/db/schema";
import type { ForecastPeriodKind } from "@/db/enums";
import { istYmd } from "@/lib/weekly-goals/week";
import {
  annualKey,
  deadlineFor,
  findPeriod,
  hygieneScore,
  periodsOfKind,
  type PeriodRef,
} from "@/lib/targets/period";

/* ── Targets ─────────────────────────────────────────────────────────────── */

export interface TargetRow {
  id: string;
  periodKind: ForecastPeriodKind;
  periodKey: string;
  employeeId: string | null;
  targetPaise: number;
  isDerived: boolean;
}

/** Every target row for a financial year, company and per-rep alike. */
export async function listTargets(fyStartYear: number): Promise<TargetRow[]> {
  return db
    .select({
      id: forecastTargets.id,
      periodKind: forecastTargets.periodKind,
      periodKey: forecastTargets.periodKey,
      employeeId: forecastTargets.employeeId,
      targetPaise: forecastTargets.targetPaise,
      isDerived: forecastTargets.isDerived,
    })
    .from(forecastTargets)
    .where(eq(forecastTargets.fyStartYear, fyStartYear))
    .orderBy(asc(forecastTargets.periodKey));
}

/** The company's annual number, or 0 when nobody has set one. */
export async function getCompanyAnnualTarget(fyStartYear: number): Promise<number> {
  const [row] = await db
    .select({ targetPaise: forecastTargets.targetPaise })
    .from(forecastTargets)
    .where(
      and(
        eq(forecastTargets.fyStartYear, fyStartYear),
        eq(forecastTargets.periodKind, "annual"),
        eq(forecastTargets.periodKey, annualKey(fyStartYear)),
        isNull(forecastTargets.employeeId),
      ),
    )
    .limit(1);
  return row?.targetPaise ?? 0;
}

/* ── Growth split ────────────────────────────────────────────────────────── */

export interface GrowthSplitRow {
  employeeId: string | null;
  existingPct: number;
}

/**
 * The org default plus every per-rep override for a year. Callers resolve with
 * `resolveExistingPct` so the fallback order lives in exactly one place.
 */
export async function listGrowthSplits(fyStartYear: number): Promise<GrowthSplitRow[]> {
  const rows = await db
    .select({
      employeeId: forecastGrowthSplits.employeeId,
      existingPct: forecastGrowthSplits.existingPct,
    })
    .from(forecastGrowthSplits)
    .where(eq(forecastGrowthSplits.fyStartYear, fyStartYear));
  return rows.map((r) => ({ employeeId: r.employeeId, existingPct: Number(r.existingPct) }));
}

/** Per-rep override → org default for the year → the 30% code default. */
export function resolveExistingPct(splits: GrowthSplitRow[], employeeId: string | null): number {
  const own = splits.find((s) => s.employeeId === employeeId);
  if (own) return own.existingPct;
  const org = splits.find((s) => s.employeeId === null);
  return org?.existingPct ?? 30;
}

/* ── Forecast grid ───────────────────────────────────────────────────────── */

export interface ForecastGridRow {
  id: string;
  employeeId: string;
  employeeName: string | null;
  customerMasterId: string | null;
  customerName: string | null;
  customerCategory: string | null;
  isNewBusiness: boolean;
  quantity: number | null;
  avgRatePaise: number | null;
  forecastPaise: number;
  estimatedPaise: number | null;
  estimatedNotes: string | null;
  estimatedAt: string | null;
  notes: string | null;
  /** Joined, never stored — see `attachActuals`. */
  actualPaise: number;
}

/**
 * One period's rows, with actuals attached.
 *
 * Matching rule, stated plainly because it is a judgement call:
 *  - a NAMED row takes every actual booked against that customer inside the
 *    period's dates;
 *  - the NEW-BUSINESS row takes everything else the rep booked in that window —
 *    i.e. turnover from customers they had not forecast by name. That is what
 *    "new business" means here, and it stops unforecast revenue vanishing from
 *    the totals.
 *
 * The aggregation happens in TypeScript rather than SQL so the rule above is
 * readable. These are hundreds of rows per period, not millions.
 */
export async function listForecastGrid(
  fyStartYear: number,
  period: PeriodRef,
  opts: { employeeId?: string } = {},
): Promise<ForecastGridRow[]> {
  const where = [
    eq(forecastLines.fyStartYear, fyStartYear),
    eq(forecastLines.periodKind, period.kind),
    eq(forecastLines.periodKey, period.key),
  ];
  if (opts.employeeId) where.push(eq(forecastLines.employeeId, opts.employeeId));

  const lines = await db
    .select({
      id: forecastLines.id,
      employeeId: forecastLines.employeeId,
      employeeName: employees.name,
      customerMasterId: forecastLines.customerMasterId,
      customerName: customerMasters.name,
      customerCategory: customerMasters.customerCategory,
      isNewBusiness: forecastLines.isNewBusiness,
      quantity: forecastLines.quantity,
      avgRatePaise: forecastLines.avgRatePaise,
      forecastPaise: forecastLines.forecastPaise,
      estimatedPaise: forecastLines.estimatedPaise,
      estimatedNotes: forecastLines.estimatedNotes,
      estimatedAt: forecastLines.estimatedAt,
      notes: forecastLines.notes,
    })
    .from(forecastLines)
    .leftJoin(customerMasters, eq(customerMasters.id, forecastLines.customerMasterId))
    .leftJoin(employees, eq(employees.id, forecastLines.employeeId))
    .where(and(...where))
    .orderBy(asc(forecastLines.isNewBusiness), asc(customerMasters.name));

  const actuals = await listActualsInWindow(period, opts);
  return attachActuals(lines, actuals);
}

export interface ActualRow {
  customerMasterId: string | null;
  employeeId: string | null;
  valuePaise: number;
}

/** Raw actuals booked inside a period, optionally scoped to one rep. */
export async function listActualsInWindow(
  period: PeriodRef,
  opts: { employeeId?: string } = {},
): Promise<ActualRow[]> {
  const where = [
    gte(forecastActuals.bookedAt, period.startDate),
    lte(forecastActuals.bookedAt, period.endDate),
  ];
  // Strictly the rep's own. Including unassigned actuals here would add the
  // same turnover to EVERY rep's total, so the team's figures would sum to
  // more than the company's. Unassigned rows stay visible in the admin view,
  // which is unscoped — so nothing is lost, it is just counted once.
  if (opts.employeeId) where.push(eq(forecastActuals.employeeId, opts.employeeId));
  return db
    .select({
      customerMasterId: forecastActuals.customerMasterId,
      employeeId: forecastActuals.employeeId,
      valuePaise: forecastActuals.valuePaise,
    })
    .from(forecastActuals)
    .where(and(...where));
}

type LineShape = Omit<ForecastGridRow, "actualPaise" | "quantity" | "estimatedAt"> & {
  quantity: string | null;
  estimatedAt: Date | null;
};

/** Pure join of actuals onto lines — exported shape kept serialisable. */
function attachActuals(lines: LineShape[], actuals: ActualRow[]): ForecastGridRow[] {
  const named = new Set(lines.map((l) => l.customerMasterId).filter(Boolean) as string[]);
  const byCustomer = new Map<string, number>();
  let unnamed = 0;
  for (const a of actuals) {
    if (a.customerMasterId && named.has(a.customerMasterId)) {
      byCustomer.set(a.customerMasterId, (byCustomer.get(a.customerMasterId) ?? 0) + a.valuePaise);
    } else {
      unnamed += a.valuePaise;
    }
  }
  return lines.map((l) => ({
    ...l,
    quantity: l.quantity === null ? null : Number(l.quantity),
    estimatedAt: l.estimatedAt ? l.estimatedAt.toISOString() : null,
    actualPaise: l.isNewBusiness ? unnamed : byCustomer.get(l.customerMasterId ?? "") ?? 0,
  }));
}

/* ── Roll-ups ────────────────────────────────────────────────────────────── */

export interface PeriodTotals {
  periodKey: string;
  label: string;
  targetPaise: number;
  forecastPaise: number;
  estimatedPaise: number;
  actualPaise: number;
}

/**
 * Totals for every period of a kind in the year — the shape the dashboard and
 * the period switcher both want. One query per measure, joined in memory.
 */
export async function periodTotals(
  fyStartYear: number,
  kind: ForecastPeriodKind,
  opts: { employeeId?: string } = {},
): Promise<PeriodTotals[]> {
  const periods = periodsOfKind(fyStartYear, kind);

  const lineWhere = [
    eq(forecastLines.fyStartYear, fyStartYear),
    eq(forecastLines.periodKind, kind),
  ];
  if (opts.employeeId) lineWhere.push(eq(forecastLines.employeeId, opts.employeeId));

  const targetWhere = [
    eq(forecastTargets.fyStartYear, fyStartYear),
    eq(forecastTargets.periodKind, kind),
  ];
  targetWhere.push(
    opts.employeeId
      ? eq(forecastTargets.employeeId, opts.employeeId)
      : isNull(forecastTargets.employeeId),
  );

  const [lineRows, targetRows, actualRows] = await Promise.all([
    db
      .select({
        periodKey: forecastLines.periodKey,
        forecastPaise: sql<number>`coalesce(sum(${forecastLines.forecastPaise}), 0)::bigint`,
        estimatedPaise: sql<number>`coalesce(sum(${forecastLines.estimatedPaise}), 0)::bigint`,
      })
      .from(forecastLines)
      .where(and(...lineWhere))
      .groupBy(forecastLines.periodKey),
    db
      .select({
        periodKey: forecastTargets.periodKey,
        targetPaise: forecastTargets.targetPaise,
      })
      .from(forecastTargets)
      .where(and(...targetWhere)),
    listActualsForYear(fyStartYear, opts),
  ]);

  const lineBy = new Map(lineRows.map((r) => [r.periodKey, r]));
  const targetBy = new Map(targetRows.map((r) => [r.periodKey, r.targetPaise]));

  return periods.map((p) => {
    const l = lineBy.get(p.key);
    const actualPaise = actualRows
      .filter((a) => a.bookedAt >= p.startDate && a.bookedAt <= p.endDate)
      .reduce((sum, a) => sum + a.valuePaise, 0);
    return {
      periodKey: p.key,
      label: p.label,
      targetPaise: targetBy.get(p.key) ?? 0,
      forecastPaise: Number(l?.forecastPaise ?? 0),
      estimatedPaise: Number(l?.estimatedPaise ?? 0),
      actualPaise,
    };
  });
}

/** Every actual in a financial year, dated — bucketed by the caller. */
async function listActualsForYear(
  fyStartYear: number,
  opts: { employeeId?: string } = {},
): Promise<{ bookedAt: string; valuePaise: number }[]> {
  const where = [
    gte(forecastActuals.bookedAt, `${fyStartYear}-04-01`),
    lte(forecastActuals.bookedAt, `${fyStartYear + 1}-03-31`),
  ];
  // Own only — see the note in `listActualsInWindow` for why unassigned rows
  // are not folded into a rep's figures.
  if (opts.employeeId) where.push(eq(forecastActuals.employeeId, opts.employeeId));
  return db
    .select({ bookedAt: forecastActuals.bookedAt, valuePaise: forecastActuals.valuePaise })
    .from(forecastActuals)
    .where(and(...where));
}

/* ── Annual setup ────────────────────────────────────────────────────────── */

export interface RepAllocationRow {
  employeeId: string;
  name: string;
  allocatedPaise: number;
  plannedPaise: number;
  lastYearPaise: number;
  existingPct: number;
}

/**
 * The annual screen: what each rep was allocated versus what their customer
 * rows actually add up to. The gap is the point — an under-planned rep should
 * be visible in April, not in March.
 */
export async function repAllocations(fyStartYear: number): Promise<RepAllocationRow[]> {
  const [roster, targets, splits, planned, lastYear] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(asc(employees.name)),
    db
      .select({
        employeeId: forecastTargets.employeeId,
        targetPaise: forecastTargets.targetPaise,
      })
      .from(forecastTargets)
      .where(
        and(
          eq(forecastTargets.fyStartYear, fyStartYear),
          eq(forecastTargets.periodKind, "annual"),
          sql`${forecastTargets.employeeId} is not null`,
        ),
      ),
    listGrowthSplits(fyStartYear),
    db
      .select({
        employeeId: forecastLines.employeeId,
        total: sql<number>`coalesce(sum(${forecastLines.forecastPaise}), 0)::bigint`,
      })
      .from(forecastLines)
      .where(
        and(
          eq(forecastLines.fyStartYear, fyStartYear),
          eq(forecastLines.periodKind, "annual"),
        ),
      )
      .groupBy(forecastLines.employeeId),
    db
      .select({
        employeeId: forecastActuals.employeeId,
        total: sql<number>`coalesce(sum(${forecastActuals.valuePaise}), 0)::bigint`,
      })
      .from(forecastActuals)
      .where(
        and(
          gte(forecastActuals.bookedAt, `${fyStartYear - 1}-04-01`),
          lte(forecastActuals.bookedAt, `${fyStartYear}-03-31`),
        ),
      )
      .groupBy(forecastActuals.employeeId),
  ]);

  const targetBy = new Map(targets.map((t) => [t.employeeId!, t.targetPaise]));
  const plannedBy = new Map(planned.map((p) => [p.employeeId, Number(p.total)]));
  const lastBy = new Map(lastYear.map((l) => [l.employeeId ?? "", Number(l.total)]));

  return roster.map((r) => ({
    employeeId: r.id,
    name: r.name,
    allocatedPaise: targetBy.get(r.id) ?? 0,
    plannedPaise: plannedBy.get(r.id) ?? 0,
    lastYearPaise: lastBy.get(r.id) ?? 0,
    existingPct: resolveExistingPct(splits, r.id),
  }));
}

/* ── Hygiene ─────────────────────────────────────────────────────────────── */

export interface HygieneRow {
  employeeId: string;
  name: string;
  periodKey: string;
  periodLabel: string;
  totalRows: number;
  estimatedRows: number;
  estimatedWithoutNotes: number;
  onTime: boolean;
  score: number;
  lastUpdatedAt: string | null;
}

/**
 * Estimates submitted without a supporting note, per rep per period — the
 * "hygiene tracker" from the brief. `today` is passed in so the scoring stays
 * reproducible in tests.
 */
export async function hygieneRows(
  fyStartYear: number,
  kind: ForecastPeriodKind,
  cadence: { monthlyDay: number; weeklyDow: number; lockDays: number },
  today: string,
  opts: { employeeId?: string } = {},
): Promise<HygieneRow[]> {
  const where = [
    eq(forecastLines.fyStartYear, fyStartYear),
    eq(forecastLines.periodKind, kind),
  ];
  if (opts.employeeId) where.push(eq(forecastLines.employeeId, opts.employeeId));

  const rows = await db
    .select({
      employeeId: forecastLines.employeeId,
      name: employees.name,
      periodKey: forecastLines.periodKey,
      totalRows: sql<number>`count(*)::int`,
      estimatedRows: sql<number>`count(${forecastLines.estimatedPaise})::int`,
      withoutNotes: sql<number>`count(*) filter (
        where ${forecastLines.estimatedPaise} is not null
          and (${forecastLines.estimatedNotes} is null or btrim(${forecastLines.estimatedNotes}) = '')
      )::int`,
      lastUpdatedAt: sql<Date | null>`max(${forecastLines.estimatedAt})`,
    })
    .from(forecastLines)
    .leftJoin(employees, eq(employees.id, forecastLines.employeeId))
    .where(and(...where))
    .groupBy(forecastLines.employeeId, employees.name, forecastLines.periodKey);

  const periods = periodsOfKind(fyStartYear, kind);
  return rows
    .map((r) => {
      const period = periods.find((p) => p.key === r.periodKey);
      const last = r.lastUpdatedAt ? new Date(r.lastUpdatedAt) : null;
      // On time = the last estimate landed on or before the period's deadline.
      // A period nobody has touched yet is only late once its deadline passes.
      // (Comparing against "has any estimate at all" would make this always
      // true the moment somebody typed a number, however late.)
      const deadline = period ? deadlineFor(period, cadence) : null;
      const onTime = !deadline
        ? true
        : last
          ? istYmd(last) <= deadline
          : today <= deadline;
      const score = hygieneScore({
        totalRows: r.totalRows,
        estimatedRows: r.estimatedRows,
        estimatedWithoutNotes: r.withoutNotes,
        onTime,
      });
      return {
        employeeId: r.employeeId,
        name: r.name ?? "—",
        periodKey: r.periodKey,
        periodLabel: period?.label ?? r.periodKey,
        totalRows: r.totalRows,
        estimatedRows: r.estimatedRows,
        estimatedWithoutNotes: r.withoutNotes,
        onTime,
        score: score.score,
        lastUpdatedAt: last ? last.toISOString() : null,
      };
    })
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

/* ── Pickers & audit ─────────────────────────────────────────────────────── */

/** Customers a rep can forecast against — their own book first. */
export async function listForecastableCustomers(
  employeeId: string | null,
): Promise<{ id: string; name: string; category: string | null; isMine: boolean }[]> {
  const rows = await db
    .select({
      id: customerMasters.id,
      name: customerMasters.name,
      category: customerMasters.customerCategory,
      salesRepId: customerMasters.salesRepId,
    })
    .from(customerMasters)
    .where(eq(customerMasters.isActive, true))
    .orderBy(asc(customerMasters.name));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      isMine: employeeId !== null && r.salesRepId === employeeId,
    }))
    .sort((a, b) => Number(b.isMine) - Number(a.isMine) || a.name.localeCompare(b.name));
}

export async function lineHistory(lineId: string) {
  return db
    .select({
      id: forecastEvents.id,
      action: forecastEvents.action,
      field: forecastEvents.field,
      fromValue: forecastEvents.fromValue,
      toValue: forecastEvents.toValue,
      createdAt: forecastEvents.createdAt,
      actorName: employees.name,
    })
    .from(forecastEvents)
    .leftJoin(employees, eq(employees.id, forecastEvents.actorId))
    .where(eq(forecastEvents.lineId, lineId))
    .orderBy(desc(forecastEvents.createdAt))
    .limit(50);
}

/** Financial years that already hold data, newest first, for the year picker. */
export async function listForecastYears(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ fy: forecastTargets.fyStartYear })
    .from(forecastTargets)
    .orderBy(desc(forecastTargets.fyStartYear));
  return rows.map((r) => r.fy);
}

export { findPeriod };
