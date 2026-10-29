import type { DashboardRow } from "@/lib/queries/attendance-status";
import type { SalaryProfileRow, SalaryRunRow } from "@/lib/queries/salary";
import type { StaleCheck } from "@/lib/salary/stale";
import { attendanceCards, toPaise, type AttendanceCards } from "@/lib/salary/daily-report";
import { paymentStatusOf, type PaymentStatus } from "@/lib/salary/money";

/**
 * What the administrators' Salary page shows about a month, worked out from
 * the stored runs, the active roster and the attendance those runs rest on.
 * Pure: no database, no clock. Money is summed in whole PAISE so the totals
 * are exact; nothing here recomputes a salary — every figure is a run's own,
 * added up.
 */

// ── the month in one card ──────────────────────────────────────────────────

export interface PayrollSummary {
  /** Active employees on the roster. */
  activeEmployees: number;
  /** Active employees with a CTC profile — the ones a run can be generated for. */
  eligible: number;
  /** Runs stored for the month. */
  included: number;
  /** Eligible employees with no run for the month yet. */
  notGenerated: string[];
  /** Active employees with no CTC profile — skipped by Generate Salary. */
  noProfile: string[];
  grossPaise: number;
  ptPaise: number;
  tdsPaise: number;
  advancesPaise: number;
  /** PT + TDS + advances across the runs. */
  deductionsPaise: number;
  pendingInPaise: number;
  netPaise: number;
  /** What has actually been paid out: each disbursed run's recorded amount. */
  paidPaise: number;
  /** Runs by payment state. `disbursed` = paid + partial. */
  paid: number;
  partial: number;
  pending: number;
  disbursed: number;
  /** Runs whose attendance changed after generation / could not be checked. */
  stale: number;
  unchecked: number;
  /** Runs seeded from an external salary log rather than generated here. */
  imported: number;
  /** gross − deductions + carried-in balances equals the stored nets, to the paisa. */
  reconciles: boolean;
  differencePaise: number;
}

/** PT + TDS + advances of one run, in paise. */
export const deductionsOf = (r: Pick<SalaryRunRow, "pt" | "tds" | "advances">): number => toPaise(r.pt) + toPaise(r.tds) + toPaise(r.advances);

/** The amount a run has paid out so far: the recorded amount, or its net when disbursed in full. */
export const paidOf = (r: Pick<SalaryRunRow, "disbursed" | "disbursedAmount" | "netPayable">): number =>
  r.disbursed ? toPaise(r.disbursedAmount ?? r.netPayable) : 0;

export function buildPayrollSummary(
  rows: readonly SalaryRunRow[],
  profiles: readonly Pick<SalaryProfileRow, "employeeId" | "name" | "annualCtc">[],
  stale: Record<string, StaleCheck> = {},
): PayrollSummary {
  const withRun = new Set(rows.map((r) => r.employeeId));
  const eligible = profiles.filter((p) => p.annualCtc > 0);
  const sum = (f: (r: SalaryRunRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const grossPaise = sum((r) => toPaise(r.gross));
  const ptPaise = sum((r) => toPaise(r.pt));
  const tdsPaise = sum((r) => toPaise(r.tds));
  const advancesPaise = sum((r) => toPaise(r.advances));
  const pendingInPaise = sum((r) => toPaise(r.pendingBalanceIn));
  const netPaise = sum((r) => toPaise(r.netPayable));
  const deductionsPaise = ptPaise + tdsPaise + advancesPaise;
  const computed = grossPaise - deductionsPaise + pendingInPaise;
  const count = (s: PaymentStatus) => rows.filter((r) => paymentStatusOf(r) === s).length;
  const paid = count("paid");
  const partial = count("partial");
  return {
    activeEmployees: profiles.length,
    eligible: eligible.length,
    included: rows.length,
    notGenerated: eligible.filter((p) => !withRun.has(p.employeeId)).map((p) => p.name),
    noProfile: profiles.filter((p) => p.annualCtc <= 0).map((p) => p.name),
    grossPaise,
    ptPaise,
    tdsPaise,
    advancesPaise,
    deductionsPaise,
    pendingInPaise,
    netPaise,
    paidPaise: sum(paidOf),
    paid,
    partial,
    pending: rows.length - paid - partial,
    disbursed: paid + partial,
    stale: rows.filter((r) => stale[r.employeeId]?.status === "stale").length,
    unchecked: rows.filter((r) => stale[r.employeeId]?.status === "unknown").length,
    imported: rows.filter((r) => r.source !== "generated").length,
    reconciles: computed === netPaise,
    differencePaise: netPaise - computed,
  };
}

/**
 * The month's payment state as one word: paid when every run is paid in
 * full, pending when nothing has been paid, partly paid in between. Null
 * without runs.
 */
export function payrollStatus(s: Pick<PayrollSummary, "included" | "paid" | "partial">): PaymentStatus | null {
  if (s.included === 0) return null;
  if (s.paid === s.included) return "paid";
  if (s.paid + s.partial === 0) return "pending";
  return "partial";
}

export interface PayrollLine {
  key: string;
  label: string;
  /** Signed paise: deductions negative, carried-in balances positive. */
  paise: number;
  kind: "deduction" | "adjustment";
}

/** The itemised lines between the month's gross and its net, non-zero ones only. */
export function payrollLines(s: Pick<PayrollSummary, "ptPaise" | "tdsPaise" | "advancesPaise" | "pendingInPaise">): PayrollLine[] {
  const all: PayrollLine[] = [
    { key: "pt", label: "Professional tax", paise: -s.ptPaise, kind: "deduction" },
    { key: "tds", label: "TDS", paise: -s.tdsPaise, kind: "deduction" },
    { key: "advances", label: "Advances taken this month", paise: -s.advancesPaise, kind: "deduction" },
    { key: "pending", label: "Balances carried in from earlier months", paise: s.pendingInPaise, kind: "adjustment" },
  ];
  return all.filter((l) => l.paise !== 0);
}

// ── the roster's attendance ────────────────────────────────────────────────

export interface RosterAttendance extends AttendanceCards {
  /** Active employees the month was graded for. */
  employees: number;
}

/** The whole roster's month, in the terms pay is counted in: every employee's cards, added up. */
export function rosterAttendance(rows: readonly Pick<DashboardRow, "summary">[]): RosterAttendance {
  const total: RosterAttendance = {
    employees: rows.length,
    daysWorked: 0,
    workingDays: 0,
    halfDays: 0,
    absent: 0,
    noCheckOut: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    compOff: 0,
    offDays: 0,
    workedOffDays: 0,
    payableDays: 0,
    lateMarks: 0,
  };
  for (const r of rows) {
    const c = attendanceCards(r.summary);
    for (const k of Object.keys(c) as (keyof AttendanceCards)[]) total[k] += c[k];
  }
  // Payable days are stored to two decimals; keep the sum at that precision.
  total.payableDays = Math.round(total.payableDays * 100) / 100;
  return total;
}

// ── the runs, grouped ──────────────────────────────────────────────────────

export type GroupBy = "entity" | "designation";

export interface RunGroup {
  key: string;
  label: string;
  rows: SalaryRunRow[];
  grossPaise: number;
  deductionsPaise: number;
  pendingInPaise: number;
  netPaise: number;
  paidPaise: number;
  paid: number;
  partial: number;
}

const UNGROUPED: Record<GroupBy, string> = { entity: "No paying entity", designation: "No designation" };

/** Runs grouped by paying entity (or designation), groups in name order, the unassigned last; rows keep the order given. */
export function groupRuns(rows: readonly SalaryRunRow[], by: GroupBy = "entity"): RunGroup[] {
  const map = new Map<string, RunGroup>();
  for (const r of rows) {
    const name = (by === "entity" ? r.payingEntityName : r.designationName) ?? null;
    const key = name ?? "";
    let g = map.get(key);
    if (!g) {
      g = { key: key || "none", label: name ?? UNGROUPED[by], rows: [], grossPaise: 0, deductionsPaise: 0, pendingInPaise: 0, netPaise: 0, paidPaise: 0, paid: 0, partial: 0 };
      map.set(key, g);
    }
    g.rows.push(r);
    g.grossPaise += toPaise(r.gross);
    g.deductionsPaise += deductionsOf(r);
    g.pendingInPaise += toPaise(r.pendingBalanceIn);
    g.netPaise += toPaise(r.netPayable);
    g.paidPaise += paidOf(r);
    const status = paymentStatusOf(r);
    if (status === "paid") g.paid += 1;
    else if (status === "partial") g.partial += 1;
  }
  return [...map.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label)));
}

export type RunStatusFilter = "all" | PaymentStatus | "stale";

export const RUN_STATUS_FILTER_LABEL: Record<RunStatusFilter, string> = {
  all: "All statuses",
  paid: "Paid",
  partial: "Partly paid",
  pending: "Payment pending",
  stale: "Needs review",
};

/** Does a run pass the status filter? "stale" means its attendance changed after generation. */
export function matchesStatus(filter: RunStatusFilter, r: SalaryRunRow, check: StaleCheck | undefined): boolean {
  if (filter === "all") return true;
  if (filter === "stale") return check?.status === "stale";
  return paymentStatusOf(r) === filter;
}

export type RunSort = "name" | "net-desc" | "net-asc" | "gross-desc" | "payable-asc" | "status";

export const RUN_SORT_LABEL: Record<RunSort, string> = {
  name: "Name A – Z",
  "net-desc": "Net pay — highest first",
  "net-asc": "Net pay — lowest first",
  "gross-desc": "Gross — highest first",
  "payable-asc": "Payable days — fewest first",
  status: "Payment pending first",
};

const STATUS_RANK: Record<PaymentStatus, number> = { pending: 0, partial: 1, paid: 2 };

/** A stable sort of runs; ties fall back to the employee's name. */
export function sortRuns(rows: readonly SalaryRunRow[], sort: RunSort): SalaryRunRow[] {
  const byName = (a: SalaryRunRow, b: SalaryRunRow) => a.employeeName.localeCompare(b.employeeName);
  const cmp: (a: SalaryRunRow, b: SalaryRunRow) => number =
    sort === "name"
      ? byName
      : sort === "net-desc"
        ? (a, b) => b.netPayable - a.netPayable
        : sort === "net-asc"
          ? (a, b) => a.netPayable - b.netPayable
          : sort === "gross-desc"
            ? (a, b) => b.gross - a.gross
            : sort === "payable-asc"
              ? (a, b) => a.payableDays - b.payableDays
              : (a, b) => STATUS_RANK[paymentStatusOf(a)] - STATUS_RANK[paymentStatusOf(b)];
  return [...rows].sort((a, b) => cmp(a, b) || byName(a, b));
}
