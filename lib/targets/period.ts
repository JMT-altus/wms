/**
 * The period spine for Targets & Forecasts.
 *
 * Pure, dependency-free, no `Date.now()` in any exported result — every
 * function is a total mapping from its arguments, so a forecast for a past
 * quarter reproduces exactly, and the whole cascade is unit-testable without a
 * database. Same discipline as lib/incentives/engine.ts and lib/salary/compute.ts.
 *
 * Financial year runs **April → March**, matching lib/salary/period.ts.
 * `fyStartYear` is the April year: FY 2026-27 → 2026.
 *
 * Period keys, chosen so they sort lexicographically inside a kind:
 *   annual   FY2026
 *   quarter  2026-Q1   (Q1 = Apr–Jun … Q4 = Jan–Mar of the NEXT calendar year)
 *   month    2026-04   (calendar year-month, so Q4 months are 2027-01…03)
 *   week     2026-04-06 (the Monday, yyyy-mm-dd)
 */

import { FORECAST_CHILD_COUNT, type ForecastPeriodKind } from "@/db/enums";
import { addDays, mondayOf, weekEnd } from "@/lib/weekly-goals/week";

export type { ForecastPeriodKind };

export interface PeriodRef {
  kind: ForecastPeriodKind;
  key: string;
  label: string;
  /** Inclusive yyyy-mm-dd bounds. A week may extend past the FY at either end. */
  startDate: string;
  endDate: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/* ── FY helpers ─────────────────────────────────────────────────────────── */

/** "FY 26-27" for an April year. */
export function fyLabel(fyStartYear: number): string {
  const a = String(fyStartYear % 100).padStart(2, "0");
  const b = String((fyStartYear + 1) % 100).padStart(2, "0");
  return `FY ${a}-${b}`;
}

export function annualKey(fyStartYear: number): string {
  return `FY${fyStartYear}`;
}

/** The April year owning a yyyy-mm-dd. Jan–Mar belong to the previous FY. */
export function fyStartYearForDate(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

/** First and last day of a financial year. */
export function fyBounds(fyStartYear: number): { startDate: string; endDate: string } {
  return { startDate: `${fyStartYear}-04-01`, endDate: `${fyStartYear + 1}-03-31` };
}

/* ── Key parsing ────────────────────────────────────────────────────────── */

const ANNUAL_RE = /^FY(\d{4})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Which kind a key belongs to, or null when it's malformed. */
export function kindOfKey(key: string): ForecastPeriodKind | null {
  if (ANNUAL_RE.test(key)) return "annual";
  if (QUARTER_RE.test(key)) return "quarter";
  if (MONTH_RE.test(key)) return "month";
  if (WEEK_RE.test(key)) return "week";
  return null;
}

export function isValidKey(kind: ForecastPeriodKind, key: string): boolean {
  return kindOfKey(key) === kind;
}

/* ── Enumerating a financial year ───────────────────────────────────────── */

/** The calendar (year, month) of the nth month of a financial year, n = 0…11. */
function fyMonth(fyStartYear: number, n: number): { year: number; month: number } {
  const abs = 3 + n; // April is calendar month 4 → index 3
  return { year: fyStartYear + Math.floor(abs / 12), month: (abs % 12) + 1 };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function annualPeriod(fyStartYear: number): PeriodRef {
  const { startDate, endDate } = fyBounds(fyStartYear);
  return {
    kind: "annual",
    key: annualKey(fyStartYear),
    label: fyLabel(fyStartYear),
    startDate,
    endDate,
  };
}

/** Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export function quarterPeriods(fyStartYear: number): PeriodRef[] {
  return [1, 2, 3, 4].map((q) => {
    const first = fyMonth(fyStartYear, (q - 1) * 3);
    const last = fyMonth(fyStartYear, (q - 1) * 3 + 2);
    return {
      kind: "quarter" as const,
      key: `${fyStartYear}-Q${q}`,
      label: `Q${q} ${MONTH_NAMES[first.month - 1]}–${MONTH_NAMES[last.month - 1]}`,
      startDate: `${first.year}-${String(first.month).padStart(2, "0")}-01`,
      endDate: `${last.year}-${String(last.month).padStart(2, "0")}-${lastDayOfMonth(last.year, last.month)}`,
    };
  });
}

export function monthPeriods(fyStartYear: number): PeriodRef[] {
  return Array.from({ length: 12 }, (_, n) => {
    const { year, month } = fyMonth(fyStartYear, n);
    const mm = String(month).padStart(2, "0");
    return {
      kind: "month" as const,
      key: `${year}-${mm}`,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-${lastDayOfMonth(year, month)}`,
    };
  });
}

/**
 * Every Monday-start week that OVERLAPS the financial year.
 *
 * A week is assigned to the FY containing its Monday, so the last week of March
 * belongs to the closing year even when it spills into April. Weeks are
 * therefore never split across two years — a forecast row can't be half-counted.
 */
export function weekPeriods(fyStartYear: number): PeriodRef[] {
  const { startDate, endDate } = fyBounds(fyStartYear);
  const out: PeriodRef[] = [];
  let cursor = mondayOf(startDate);
  // The FY's first Monday may sit in late March; skip it if it belongs to the
  // previous year, so a week is listed exactly once across all years.
  if (cursor < startDate) cursor = addDays(cursor, 7);
  while (cursor <= endDate) {
    out.push({
      kind: "week",
      key: cursor,
      label: weekRangeLabel(cursor),
      startDate: cursor,
      endDate: weekEnd(cursor),
    });
    cursor = addDays(cursor, 7);
  }
  return out;
}

/** "6 Apr – 12 Apr" */
export function weekRangeLabel(weekStart: string): string {
  const end = weekEnd(weekStart);
  const d = (ymd: string) => Number(ymd.slice(8, 10));
  const m = (ymd: string) => MONTH_NAMES[Number(ymd.slice(5, 7)) - 1];
  return `${d(weekStart)} ${m(weekStart)} – ${d(end)} ${m(end)}`;
}

/** Every period of one kind in a financial year, in chronological order. */
export function periodsOfKind(fyStartYear: number, kind: ForecastPeriodKind): PeriodRef[] {
  switch (kind) {
    case "annual":
      return [annualPeriod(fyStartYear)];
    case "quarter":
      return quarterPeriods(fyStartYear);
    case "month":
      return monthPeriods(fyStartYear);
    case "week":
      return weekPeriods(fyStartYear);
  }
}

export function findPeriod(
  fyStartYear: number,
  kind: ForecastPeriodKind,
  key: string,
): PeriodRef | null {
  return periodsOfKind(fyStartYear, kind).find((p) => p.key === key) ?? null;
}

/* ── The cascade ────────────────────────────────────────────────────────── */

/** The next level down, or null at the leaf. */
export function childKind(kind: ForecastPeriodKind): ForecastPeriodKind | null {
  switch (kind) {
    case "annual":
      return "quarter";
    case "quarter":
      return "month";
    case "month":
      return "week";
    case "week":
      return null;
  }
}

export function parentKind(kind: ForecastPeriodKind): ForecastPeriodKind | null {
  switch (kind) {
    case "annual":
      return null;
    case "quarter":
      return "annual";
    case "month":
      return "quarter";
    case "week":
      return "month";
  }
}

/**
 * The children of a period. Weeks are the interesting case: a month has 4 or 5
 * of them, NOT always the nominal 4 from FORECAST_CHILD_COUNT — so this returns
 * what the calendar actually contains rather than a fixed count.
 */
export function childPeriods(fyStartYear: number, parent: PeriodRef): PeriodRef[] {
  const kind = childKind(parent.kind);
  if (!kind) return [];
  return periodsOfKind(fyStartYear, kind).filter(
    // Overlap, not containment: a week that straddles a month boundary belongs
    // to the month holding its Monday, which `startDate` already encodes.
    (c) => c.startDate >= parent.startDate && c.startDate <= parent.endDate,
  );
}

/** The parent period key for a child, or null at the top. */
export function parentKeyOf(fyStartYear: number, child: PeriodRef): string | null {
  const kind = parentKind(child.kind);
  if (!kind) return null;
  const candidates = periodsOfKind(fyStartYear, kind);
  const hit = candidates.find(
    (p) => child.startDate >= p.startDate && child.startDate <= p.endDate,
  );
  return hit?.key ?? null;
}

/* ── Splitting money ────────────────────────────────────────────────────── */

/**
 * Split integer paise into `n` parts that sum EXACTLY back to the total.
 *
 * Naive division loses paise to rounding — ₹100 over 3 weeks becomes ₹99.99 and
 * the weekly rows quietly stop adding up to the month. The remainder is spread
 * one paisa at a time across the leading parts instead, so the sum is exact by
 * construction. Negative totals split symmetrically.
 */
export function splitPaise(totalPaise: number, n: number): number[] {
  if (n <= 0) return [];
  const total = Math.round(totalPaise);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const remainder = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/** Forecast value from quantity × average rate, or null when either is absent. */
export function valueFromQtyRate(
  quantity: number | null | undefined,
  avgRatePaise: number | null | undefined,
): number | null {
  if (quantity == null || avgRatePaise == null) return null;
  if (!Number.isFinite(quantity) || !Number.isFinite(avgRatePaise)) return null;
  return Math.round(quantity * avgRatePaise);
}

/* ── Growth split ───────────────────────────────────────────────────────── */

export interface GrowthSplit {
  /** Turnover expected from customers who already trade with us. */
  existingPaise: number;
  /** Turnover expected from customers we have yet to win. */
  newPaise: number;
  existingPct: number;
  newPct: number;
}

/**
 * Divide a target between growth from existing customers and growth from new
 * ones, per the "30% expansion / 70% acquisition" rule.
 *
 * The split applies to the GROWTH over last year, not to the whole target:
 * last year's turnover is assumed to repeat from existing customers, and only
 * the increment is up for allocation. Applying the percentages to the full
 * target would tell a rep to win 70% of their entire book from strangers.
 *
 * With no prior year (`lastYearPaise` 0), the whole target is growth.
 */
export function growthSplit(
  targetPaise: number,
  lastYearPaise: number,
  existingPct: number,
): GrowthSplit {
  const pct = Math.min(100, Math.max(0, existingPct));
  const base = Math.max(0, Math.min(lastYearPaise, targetPaise));
  const growth = Math.max(0, targetPaise - base);
  const fromExistingGrowth = Math.round((growth * pct) / 100);
  return {
    existingPaise: base + fromExistingGrowth,
    newPaise: growth - fromExistingGrowth,
    existingPct: pct,
    newPct: 100 - pct,
  };
}

/* ── Deadlines & locking ────────────────────────────────────────────────── */

/**
 * The day a period's estimate is due.
 *
 * Monthly periods (and the quarters/years above them) are due on the org's
 * monthly day — the 27th — of the month they cover. Weekly periods are due on
 * the configured weekday of that week, Friday by default.
 */
export function deadlineFor(
  period: PeriodRef,
  cadence: { monthlyDay: number; weeklyDow: number },
): string {
  if (period.kind === "week") {
    // ISO dow: the week starts Monday = 1, so Friday is +4 days.
    const offset = Math.min(6, Math.max(0, cadence.weeklyDow - 1));
    return addDays(period.startDate, offset);
  }
  const year = Number(period.endDate.slice(0, 4));
  const month = Number(period.endDate.slice(5, 7));
  const day = Math.min(cadence.monthlyDay, lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Whether a period is closed to edits.
 *
 * Locks `lockDays` after the deadline. Without this, "Forecasted vs Actual" is
 * meaningless — anyone could retro-fit the forecast once the result is known.
 * `today` is passed in rather than read from the clock so this stays pure.
 */
export function isLocked(
  period: PeriodRef,
  cadence: { monthlyDay: number; weeklyDow: number; lockDays: number },
  today: string,
): boolean {
  return today > addDays(deadlineFor(period, cadence), cadence.lockDays);
}

/* ── Hygiene ────────────────────────────────────────────────────────────── */

export interface HygieneInput {
  totalRows: number;
  estimatedRows: number;
  /** Estimates submitted with no supporting note — the thing being tracked. */
  estimatedWithoutNotes: number;
  /** Was the estimate in before the deadline? */
  onTime: boolean;
}

export interface HygieneScore {
  /** 0–100. */
  score: number;
  coveragePct: number;
  notedPct: number;
  onTime: boolean;
}

/**
 * One number a rep can move: how much of the period was estimated, and how much
 * of that came with a note. A missed deadline costs a flat 10 points — visible,
 * but not so punishing that a late-but-thorough update scores worse than a
 * prompt, empty one.
 */
export function hygieneScore(input: HygieneInput): HygieneScore {
  const total = Math.max(0, input.totalRows);
  const estimated = Math.max(0, Math.min(input.estimatedRows, total));
  const withoutNotes = Math.max(0, Math.min(input.estimatedWithoutNotes, estimated));

  if (total === 0) {
    return { score: 0, coveragePct: 0, notedPct: 0, onTime: input.onTime };
  }
  const coveragePct = (estimated / total) * 100;
  const notedPct = estimated === 0 ? 0 : ((estimated - withoutNotes) / estimated) * 100;
  // Coverage and note quality weigh equally: estimating everything without a
  // word is as unhelpful as one beautifully-noted row out of twenty.
  const raw = coveragePct * 0.5 + notedPct * 0.5;
  const penalised = input.onTime ? raw : raw - 10;
  return {
    score: Math.max(0, Math.min(100, Math.round(penalised))),
    coveragePct: Math.round(coveragePct),
    notedPct: Math.round(notedPct),
    onTime: input.onTime,
  };
}
