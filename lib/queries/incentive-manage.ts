import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { incentiveCalcAdjustments, incentiveCalcResults, incentiveCalcRuns, incentivePrograms } from "@/db/schema";
import { CALC_CATEGORIES, carryBalances, incentiveCalcReady, listApprovalPeriods, type ApprovalPeriod, type CalcCategory, type CarryBalance } from "@/lib/queries/incentive-calc";
import { versionInForce } from "@/lib/queries/incentive-rules";
import { fReviewQueue } from "@/lib/queries/incentive-f-review";

/**
 * Incentive Tracker → Incentive Management: Categories A–G side by side. READS ONLY. Every status and amount comes
 * from the records the category screens already show — the months and their approval and payout state
 * (listApprovalPeriods), the calculations (incentive_calc_runs), the published rules in force (versionInForce), the
 * adjustments and the carry-forward ledger. Nothing here calculates, approves, releases or pays: every action stays on
 * the category's own Calculation screen, behind its own permission checks.
 */

type Q = typeof db;

export interface ProgramOption {
  id: string;
  code: string;
  name: string;
}

/** The incentive programmes (none until the calculation's database updates are applied). */
export async function programOptions(q: Q = db): Promise<ProgramOption[]> {
  if (!(await incentiveCalcReady(q))) return [];
  return q.select({ id: incentivePrograms.id, code: incentivePrograms.code, name: incentivePrograms.name }).from(incentivePrograms).orderBy(asc(incentivePrograms.code));
}

/**
 * One category's month, ready for the screen. Approval decisions are included only for holders of the approvals view
 * and payout records only for holders of the payouts view — the same rule as each category's Approvals screen.
 */
export interface MonthRow {
  key: string;
  programId: string;
  programCode: string;
  category: CalcCategory;
  month: string;
  status: string;
  run: { configVersionNo: number | null; asOf: string; salespeople: number; payablePaise: number } | null;
  /** What the payout must total (payable + adjustments carried in, per salesperson), as the Approvals screen shows it. */
  approvedTotalPaise: number | null;
  submissionNo: number;
  submittedByName: string | null;
  submittedAt: string | null;
  approvalsRequired: number | null;
  /** The current submission's completed approval steps (approvals view only; otherwise null). */
  approvalsDone: number | null;
  /** Every approval and rejection with its reason (approvals view only; otherwise empty). */
  decisions: { submissionNo: number; stepNo: number; decision: string; reason: string | null; actorName: string; at: string }[];
  releaseOn: string | null;
  /** The recorded payout (payouts view only; otherwise null — `paid` still says whether it is paid). */
  payout: { reference: string; paidOn: string; totalPaise: number; recordedByName: string; lines: { employeeName: string; payablePaise: number; adjustmentsPaise: number; amountPaise: number }[] } | null;
  voided: { reason: string; byName: string; at: string; carriedToMonth: string | null } | null;
  /** The adopted calculation's salesperson-wise payable. */
  employees: { key: string; name: string; payablePaise: number }[];
}

export const employeeKey = (l: { employeeId: string | null; employeeName: string }) => (l.employeeId ? `id:${l.employeeId}` : `name:${l.employeeName}`);

/** Every calculated month of the given programmes, Categories A–G, newest first. Reads only. */
export async function monthRowsFor(programs: ProgramOption[], rights: { approvals: boolean; payouts: boolean }, q: Q = db): Promise<{ rows: MonthRow[]; notReady: CalcCategory[] }> {
  const rows: MonthRow[] = [];
  const notReady = new Set<CalcCategory>();
  for (const p of programs) {
    const { categories } = await managedMonths(p.id, q);
    const runIds = categories.flatMap((c) => c.periods.map((x) => x.run?.id).filter((x): x is string => !!x));
    const lines = await employeeLinesFor(runIds, q);
    for (const c of categories) {
      if (!c.ready) notReady.add(c.category);
      for (const x of c.periods) {
        const current = x.approvals.filter((a) => a.submissionNo === x.submissionNo && a.decision === "approve");
        rows.push({
          key: `${p.id}|${c.category}|${x.month}`,
          programId: p.id,
          programCode: p.code,
          category: c.category,
          month: x.month,
          status: x.status,
          run: x.run ? { configVersionNo: x.run.configVersionNo, asOf: x.run.asOf, salespeople: x.run.salespeople, payablePaise: x.run.payablePaise } : null,
          approvedTotalPaise: x.approvedTotalPaise,
          submissionNo: x.submissionNo,
          submittedByName: x.submittedByName,
          submittedAt: x.submittedAt ? x.submittedAt.toISOString() : null,
          approvalsRequired: x.approvalsRequired,
          approvalsDone: rights.approvals ? current.length : null,
          decisions: rights.approvals ? x.approvals.map((a) => ({ ...a, at: a.at.toISOString() })) : [],
          releaseOn: x.releaseOn,
          payout: rights.payouts && x.payout ? { reference: x.payout.reference, paidOn: x.payout.paidOn, totalPaise: x.payout.totalPaise, recordedByName: x.payout.recordedByName, lines: x.payout.lines } : null,
          voided: x.voided ? { reason: x.voided.reason, byName: x.voided.byName, at: x.voided.at.toISOString(), carriedToMonth: x.voided.carriedToMonth } : null,
          employees: (x.run ? (lines.get(x.run.id) ?? []) : []).map((l) => ({ key: employeeKey(l), name: l.employeeName, payablePaise: l.payablePaise })),
        });
      }
    }
  }
  rows.sort((a, b) => (a.month === b.month ? (a.programCode === b.programCode ? a.category.localeCompare(b.category) : a.programCode.localeCompare(b.programCode)) : b.month.localeCompare(a.month)));
  return { rows, notReady: [...notReady] };
}

/** One category's month on the Overview and Calculate Incentives screens. */
export interface CategoryMonthSummary {
  category: CalcCategory;
  ready: boolean;
  rules: { versionNo: number; effectiveFrom: string } | null;
  latest: { status: "computed" | "blocked"; computedAt: string; asOf: string; problems: string[]; heldForReview: number } | null;
  /** The month's record (null: never calculated). */
  row: MonthRow | null;
}

/** Categories A–G for one programme and month: rules in force, latest calculation, and the month's record. Reads only. */
export async function monthSummaries(program: ProgramOption, month: string, rights: { approvals: boolean; payouts: boolean }, q: Q = db): Promise<CategoryMonthSummary[]> {
  const [{ rows, notReady }, latest, rules] = await Promise.all([monthRowsFor([program], rights, q), latestRunsFor(program.id, month, q), rulesInForceFor(program.id, month, q)]);
  return CALC_CATEGORIES.map((c) => {
    const l = latest[c];
    const r = rules[c];
    return {
      category: c,
      ready: !notReady.includes(c),
      rules: r ? { versionNo: r.versionNo, effectiveFrom: r.effectiveFrom } : null,
      latest: l ? { status: l.status, computedAt: l.computedAt.toISOString(), asOf: l.asOf, problems: l.problems, heldForReview: l.heldForReview } : null,
      row: rows.find((x) => x.category === c && x.month === month) ?? null,
    };
  });
}

/** The salespeople who appear in any of the months (for the salesperson filter), by name. */
export const employeesOf = (rows: MonthRow[]) => {
  const seen = new Map<string, string>();
  for (const r of rows) for (const e of r.employees) if (!seen.has(e.key)) seen.set(e.key, e.name);
  return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
};

export interface CategoryMonths {
  category: CalcCategory;
  /** False when the database updates this category needs are not applied (its screen says which). */
  ready: boolean;
  periods: ApprovalPeriod[];
}

/** Every category's calculated months for one programme (newest first), exactly as each category's Approvals screen lists them. */
export async function managedMonths(programId: string | null, q: Q = db): Promise<{ programs: { id: string; code: string; name: string }[]; programId: string | null; categories: CategoryMonths[] }> {
  const lists = await Promise.all(CALC_CATEGORIES.map((c) => listApprovalPeriods(programId, q, c)));
  const first = lists.find((l) => l.ready) ?? lists[0]!;
  return {
    programs: first.programs,
    programId: first.programId,
    categories: CALC_CATEGORIES.map((c, i) => ({ category: c, ready: lists[i]!.ready, periods: lists[i]!.periods })),
  };
}

export interface LatestRun {
  status: "computed" | "blocked";
  computedAt: Date;
  asOf: string;
  /** The blocking problems the calculation reported (its own validation of the month's records and rules). */
  problems: string[];
  /** B: invoices with no Sales Order; C: records held for an admin's review — as the latest calculation found them. */
  heldForReview: number;
}

const D = (x: unknown) => String(x).slice(0, 10);
const asArray = (x: unknown): string[] => {
  const v = typeof x === "string" ? (() => { try { return JSON.parse(x) as unknown; } catch { return null; } })() : x;
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
};

/** Each category's LATEST calculation of a month (adopted or not): whether it read the month without a blocking problem. */
export async function latestRunsFor(programId: string, month: string, q: Q = db): Promise<Partial<Record<CalcCategory, LatestRun>>> {
  if (!(await incentiveCalcReady(q))) return {};
  const rows = await q
    .select({
      category: incentiveCalcRuns.categoryCode,
      status: incentiveCalcRuns.status,
      computedAt: incentiveCalcRuns.computedAt,
      asOf: incentiveCalcRuns.asOf,
      problems: sql<unknown>`${incentiveCalcRuns.result}->'problems'`,
      reviewCases: sql<number | null>`case when jsonb_typeof(${incentiveCalcRuns.result}->'reviewCases') = 'array' then jsonb_array_length(${incentiveCalcRuns.result}->'reviewCases') end`,
      reviewInvoices: sql<number | null>`case when jsonb_typeof(${incentiveCalcRuns.result}->'reviewInvoices') = 'array' then jsonb_array_length(${incentiveCalcRuns.result}->'reviewInvoices') end`,
      heldItems: sql<number | null>`case when jsonb_typeof(${incentiveCalcRuns.result}->'held') = 'array' then jsonb_array_length(${incentiveCalcRuns.result}->'held') end`,
    })
    .from(incentiveCalcRuns)
    .where(and(eq(incentiveCalcRuns.programId, programId), eq(incentiveCalcRuns.month, month)))
    .orderBy(desc(incentiveCalcRuns.computedAt))
    .limit(500);
  const out: Partial<Record<CalcCategory, LatestRun>> = {};
  for (const r of rows) {
    const c = r.category as CalcCategory;
    if (out[c] || !CALC_CATEGORIES.includes(c)) continue;
    out[c] = {
      status: r.status,
      computedAt: r.computedAt,
      asOf: D(r.asOf),
      problems: r.status === "blocked" ? asArray(r.problems) : [],
      // B lists its review invoices only on a computed calculation (as its Calculation screen does).
      // A: everything its calculation held (category-a/2: each holds the month until resolved or acknowledged).
      heldForReview: c === "C" ? Number(r.reviewCases ?? 0) : c === "B" && r.status === "computed" ? Number(r.reviewInvoices ?? 0) : c === "A" && r.status === "computed" ? Number(r.heldItems ?? 0) : 0,
    };
  }
  return out;
}

export interface RulesInForce {
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** The published Incentive Rules version each category is calculated by for the month (none: the month can't be calculated). */
export async function rulesInForceFor(programId: string, month: string, q: Q = db): Promise<Partial<Record<CalcCategory, RulesInForce | null>>> {
  if (!(await incentiveCalcReady(q))) return {};
  const versions = await Promise.all(CALC_CATEGORIES.map((c) => versionInForce(q, programId, c, month)));
  return Object.fromEntries(CALC_CATEGORIES.map((c, i) => {
    const v = versions[i];
    return [c, v ? { versionNo: v.versionNo, effectiveFrom: D(v.effectiveFrom), effectiveTo: v.effectiveTo === null ? null : D(v.effectiveTo) } : null];
  }));
}

export interface EmployeeLine {
  employeeId: string | null;
  employeeName: string;
  payablePaise: number;
}

/** The salesperson-wise payable of each adopted calculation (as its Calculation screen lists them). */
export async function employeeLinesFor(runIds: string[], q: Q = db): Promise<Map<string, EmployeeLine[]>> {
  const out = new Map<string, EmployeeLine[]>();
  if (!runIds.length) return out;
  const rows = await q
    .select({ runId: incentiveCalcResults.runId, employeeId: incentiveCalcResults.employeeId, employeeName: incentiveCalcResults.employeeName, payablePaise: incentiveCalcResults.payablePaise })
    .from(incentiveCalcResults)
    .where(inArray(incentiveCalcResults.runId, runIds))
    .orderBy(incentiveCalcResults.employeeName);
  for (const r of rows) {
    const list = out.get(r.runId) ?? [];
    list.push({ employeeId: r.employeeId, employeeName: r.employeeName, payablePaise: Number(r.payablePaise) });
    out.set(r.runId, list);
  }
  return out;
}

/** How many times each category's month was calculated, and how many of those calculations were blocked. */
export async function runCountsFor(programId: string, q: Q = db): Promise<Map<string, { runs: number; blocked: number }>> {
  const out = new Map<string, { runs: number; blocked: number }>();
  if (!(await incentiveCalcReady(q))) return out;
  const rows = await q
    .select({
      category: incentiveCalcRuns.categoryCode,
      month: incentiveCalcRuns.month,
      runs: sql<number>`count(*)::int`,
      blocked: sql<number>`count(*) filter (where ${incentiveCalcRuns.status} = 'blocked')::int`,
    })
    .from(incentiveCalcRuns)
    .where(eq(incentiveCalcRuns.programId, programId))
    .groupBy(incentiveCalcRuns.categoryCode, incentiveCalcRuns.month);
  for (const r of rows) out.set(`${r.category}|${D(r.month)}`, { runs: Number(r.runs), blocked: Number(r.blocked) });
  return out;
}

export interface AdjustmentRow {
  id: string;
  category: string;
  fromMonth: string;
  toMonth: string | null;
  employeeName: string;
  kind: string;
  amountPaise: number;
  monthsLeft: number | null;
  note: string;
  createdAt: Date;
}

/** Every adjustment a programme's months recorded (recalculation differences, negative balances carried, write-offs, recoveries). */
export async function adjustmentsFor(programId: string, q: Q = db): Promise<AdjustmentRow[]> {
  if (!(await incentiveCalcReady(q))) return [];
  const rows = await q.select().from(incentiveCalcAdjustments).where(eq(incentiveCalcAdjustments.programId, programId)).orderBy(desc(incentiveCalcAdjustments.createdAt)).limit(1000);
  return rows.map((a) => ({ id: a.id, category: a.categoryCode, fromMonth: D(a.fromMonth), toMonth: a.toMonth === null ? null : D(a.toMonth), employeeName: a.employeeName, kind: a.kind, amountPaise: Number(a.amountPaise), monthsLeft: a.monthsLeft, note: a.note, createdAt: a.createdAt }));
}

/** Every category's carry-forward ledger (balances held below the minimum and what happened to them). */
export async function carryFor(programId: string, q: Q = db): Promise<{ category: CalcCategory; balances: CarryBalance[] }[]> {
  const all = await Promise.all(CALC_CATEGORIES.map((c) => carryBalances(programId, c, q)));
  return CALC_CATEGORIES.map((c, i) => ({ category: c, balances: all[i]! })).filter((x) => x.balances.length > 0);
}

export interface FPending {
  /** Testimonials nobody has checked yet (a duplicate submission counts once, under its original). */
  unchecked: number;
  /** Testimonials put on hold for more review. */
  onHold: number;
  /** Invalidation requests awaiting a second person. */
  invalidations: number;
  /** Recovery write-off requests awaiting a second person. */
  writeOffs: number;
}

/** Category F's open review work, across months, as its Review & decisions screen lists it. */
export async function fPending(q: Q = db): Promise<FPending | null> {
  const queue = await fReviewQueue(q);
  if (!queue.ready) return null;
  const originals = queue.rows.filter((r) => r.state !== "duplicate");
  const openRequests = new Set(queue.rows.filter((r) => r.invalidation && r.invalidation.decided === null).map((r) => r.invalidation!.requestId));
  return {
    unchecked: originals.filter((r) => !r.verdict).length,
    onHold: originals.filter((r) => r.verdict?.kind === "needs-review").length,
    invalidations: openRequests.size,
    writeOffs: queue.recoveries.filter((r) => r.writeOff && r.writeOff.decided === null).length,
  };
}
