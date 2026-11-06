"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ChevronDown, ChevronUp, FileText, ListChecks, Receipt, Search } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { setDisbursed } from "@/app/(app)/salary/actions";
import type { SalaryRunRow } from "@/lib/queries/salary";
import type { StaleCheck } from "@/lib/salary/stale";
import { days, inr2, inrPaise, paymentStatusOf, signedPaise } from "@/lib/salary/money";
import { toPaise } from "@/lib/salary/daily-report";
import {
  deductionsOf,
  groupRuns,
  matchesStatus,
  paidOf,
  RUN_SORT_LABEL,
  RUN_STATUS_FILTER_LABEL,
  sortRuns,
  type PayrollSummary,
  type RunGroup,
  type RunSort,
  type RunStatusFilter,
} from "@/lib/salary/payroll";
import { TONE } from "@/components/attendance/overview/theme";
import { BLUE, BLUE_LINE, BLUE_SOFT, BLUE_TEXT, BORDER, BORDER_SOFT, BTN_SM, CONTROL, FAINT, HEAD_BG, INK, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE, TH } from "@/components/salary/ui";
import { PaymentStatusPill } from "@/components/salary/my/status-pill";

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * Employee by employee, entity by entity: every salary run of the month with
 * the attendance it was priced on (payable days, late deduction), its gross,
 * deductions, carried-in balance and net, its payment state and the switch
 * that records a disbursement. The groups add up to the month, and the month
 * adds up to the payroll card above — exactly the stored figures, summed.
 *
 * Filters narrow by payment state (or "needs review"), by paying entity and
 * by name; the sort orders rows within each group. Nothing here recomputes a
 * salary.
 */
export function SalaryRunsReport({ rows, stale = {}, summary, monthTitle }: { rows: SalaryRunRow[]; stale?: Record<string, StaleCheck>; summary: PayrollSummary; monthTitle: string }) {
  const [status, setStatus] = useState<RunStatusFilter>("all");
  const [entity, setEntity] = useState<string>("all");
  const [sort, setSort] = useState<RunSort>("name");
  const [query, setQuery] = useState("");
  const [explain, setExplain] = useState(false);
  const allGroups = useMemo(() => groupRuns(rows, "entity"), [rows]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = rows.filter(
      (r) =>
        matchesStatus(status, r, stale[r.employeeId]) &&
        (!q || r.employeeName.toLowerCase().includes(q) || (r.designationName ?? "").toLowerCase().includes(q) || (r.payingEntityName ?? "").toLowerCase().includes(q)),
    );
    return groupRuns(sortRuns(kept, sort), "entity").filter((g) => entity === "all" || g.key === entity);
  }, [rows, stale, status, entity, sort, query]);
  const shownCount = shown.reduce((s, g) => s + g.rows.length, 0);
  const statusesPresent = new Set<RunStatusFilter>(rows.map((r) => paymentStatusOf(r)));
  if (summary.stale > 0) statusesPresent.add("stale");

  return (
    <section className="min-w-0 overflow-hidden" style={SURFACE} aria-labelledby="sr-title" data-testid="salary-runs-report">
      <div className={SECTION_HEAD}>
        <div className="min-w-0">
          <h2 id="sr-title" className={SECTION_TITLE}>
            <ListChecks size={15} aria-hidden style={{ color: BLUE }} /> Salary runs
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: SLATE }}>
            each run: per-day rate × (payable days − late deduction days), less PT, TDS and advances, plus any balance carried in
          </p>
        </div>
        <p className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ background: HEAD_BG, border: `1px solid ${BORDER}`, color: INK }}>
          {monthTitle} · {n(rows.length)} {rows.length === 1 ? "run" : "runs"}
        </p>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Gross salaries" value={inrPaise(summary.grossPaise)} hint="before deductions" />
          <Stat label="Deductions" value={summary.deductionsPaise === 0 ? inrPaise(0) : signedPaise(-summary.deductionsPaise)} hint="PT, TDS and advances" tone={summary.deductionsPaise !== 0 ? TONE.coral.fg : undefined} />
          <Stat label="Net payable" value={inrPaise(summary.netPaise)} hint={summary.pendingInPaise !== 0 ? `includes ${signedPaise(summary.pendingInPaise)} carried in` : "what the month owes"} />
          <Stat label="Paid so far" value={inrPaise(summary.paidPaise)} hint={`${n(summary.disbursed)} of ${n(summary.included)} runs disbursed`} tone={summary.paidPaise > 0 ? TONE.teal.fg : undefined} />
        </div>

        {/* Toolbar: filters and search on the left, the sort on the right. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2" style={{ background: HEAD_BG, border: `1px solid ${BORDER_SOFT}` }}>
          <div className="flex flex-wrap items-center gap-2">
            <label>
              <span className="sr-only">Filter runs by status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as RunStatusFilter)} className={CONTROL} aria-label="Filter runs by status">
                {(Object.keys(RUN_STATUS_FILTER_LABEL) as RunStatusFilter[])
                  .filter((k) => k === "all" || statusesPresent.has(k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {RUN_STATUS_FILTER_LABEL[k]}
                    </option>
                  ))}
              </select>
            </label>
            {allGroups.length > 1 && (
              <select value={entity} onChange={(e) => setEntity(e.target.value)} className={CONTROL} aria-label="Filter runs by paying entity">
                <option value="all">All entities</option>
                {allGroups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
            <label className="relative block w-[260px] max-w-full">
              <span className="sr-only">Search employees</span>
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden style={{ color: FAINT }} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee, designation…" className={`${CONTROL} w-full pl-8`} />
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: SLATE }}>
            <span aria-hidden>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as RunSort)} className={CONTROL} aria-label="Sort runs">
              {(Object.keys(RUN_SORT_LABEL) as RunSort[]).map((k) => (
                <option key={k} value={k}>
                  {RUN_SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-2">
          {shown.length === 0 && (
            <p className="rounded-lg px-4 py-6 text-center text-[13px]" style={{ border: `1px solid ${BORDER_SOFT}`, color: SLATE }} data-testid="no-match">
              No runs match{query.trim() ? ` “${query.trim()}”` : " these filters"}.
            </p>
          )}
          {shown.map((g) => (
            <GroupBlock key={g.key} g={g} open={!closed.has(g.key)} onToggle={() => toggle(g.key)} stale={stale} />
          ))}
        </div>
        {shownCount !== rows.length && shown.length > 0 && (
          <p className="mt-2 text-[12px] tabular-nums" style={{ color: SLATE }}>
            {n(shownCount)} of {n(rows.length)} runs shown
          </p>
        )}

        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg px-4 py-2.5 text-[13px] tabular-nums"
          style={{ background: BLUE_SOFT, border: `1px solid ${BLUE_LINE}`, color: SLATE }}
        >
          <span className="font-semibold" style={{ color: NAVY }}>
            Month total
          </span>
          <span>
            Gross <strong className="font-semibold" style={{ color: NAVY }}>{inrPaise(summary.grossPaise)}</strong>
          </span>
          <span>
            Deductions{" "}
            <strong className="font-semibold" style={{ color: summary.deductionsPaise !== 0 ? TONE.coral.fg : NAVY }}>
              {summary.deductionsPaise === 0 ? inrPaise(0) : signedPaise(-summary.deductionsPaise)}
            </strong>
          </span>
          {summary.pendingInPaise !== 0 && (
            <span>
              Carried in <strong className="font-semibold" style={{ color: TONE.teal.fg }}>{signedPaise(summary.pendingInPaise)}</strong>
            </span>
          )}
          <span>
            Net payable{" "}
            <strong className="font-semibold" style={{ color: NAVY }} data-testid="runs-net-total">
              {inrPaise(summary.netPaise)}
            </strong>
          </span>
          <span>
            Paid <strong className="font-semibold" style={{ color: NAVY }}>{inrPaise(summary.paidPaise)}</strong>
          </span>
        </div>

        <div className="mt-2 overflow-hidden rounded-lg" style={{ border: `1px solid ${BORDER_SOFT}` }}>
          <button
            type="button"
            onClick={() => setExplain((o) => !o)}
            aria-expanded={explain}
            aria-controls="sr-explain"
            className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[13px] font-semibold transition-colors hover:bg-[#F6F9FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#0A6CFF]/20"
            style={{ color: NAVY }}
          >
            How these runs add up to {inrPaise(summary.netPaise)}
            {explain ? <ChevronUp size={15} aria-hidden style={{ color: FAINT }} /> : <ChevronDown size={15} aria-hidden style={{ color: FAINT }} />}
          </button>
          {explain && (
            <div id="sr-explain" className="px-3.5 pb-3 text-[12.5px] leading-relaxed tabular-nums" style={{ color: SLATE }}>
              <p>
                Gross salaries {inrPaise(summary.grossPaise)} − professional tax {inrPaise(summary.ptPaise)} − TDS {inrPaise(summary.tdsPaise)} − advances {inrPaise(summary.advancesPaise)}
                {summary.pendingInPaise !== 0 ? ` + balances carried in ${inrPaise(summary.pendingInPaise)}` : ""} = net payable {inrPaise(summary.netPaise)}
                {summary.reconciles ? "." : ` (the stored nets differ by ${signedPaise(summary.differencePaise)}${summary.imported > 0 ? ", from imported runs whose components are not itemised the same way" : ""}).`}
              </p>
              <p className="mt-1">
                Each run&apos;s gross is its per-day rate (monthly CTC ÷ calendar days) × (payable days − late deduction days), from the attendance recorded for the month. A disbursed run keeps its figures when the month is regenerated; the switch in each row records the payment.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: HEAD_BG, border: `1px solid ${BORDER_SOFT}` }}>
      <p className="text-[11.5px] font-semibold" style={{ color: SLATE }}>
        {label}
      </p>
      <p className="mt-0.5 text-[16px] font-bold tabular-nums" style={{ color: tone ?? NAVY }}>
        {value}
      </p>
      <p className="text-[11.5px]" style={{ color: SLATE }}>
        {hint}
      </p>
    </div>
  );
}

function GroupBlock({ g, open, onToggle, stale }: { g: RunGroup; open: boolean; onToggle: () => void; stale: Record<string, StaleCheck> }) {
  const id = `runs-${g.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const pending = g.rows.length - g.paid - g.partial;
  const summary = [g.paid > 0 ? `${n(g.paid)} paid` : "", g.partial > 0 ? `${n(g.partial)} partly paid` : "", pending > 0 ? `${n(pending)} pending` : ""].filter(Boolean).join(" · ");
  const review = g.rows.filter((r) => stale[r.employeeId]?.status === "stale").length;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg" style={{ border: "1px solid #E2E8F0" }} data-testid="run-group">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5 text-left transition-colors hover:bg-[#F6F9FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#0A6CFF]/20"
      >
        <span className="min-w-0">
          <span className="text-[13.5px] font-semibold" style={{ color: NAVY }}>
            {g.label}
          </span>
          <span className="ml-2.5 rounded-full px-2 py-px text-[11.5px] font-semibold tabular-nums" style={{ background: BLUE_SOFT, color: BLUE_TEXT }}>
            {n(g.rows.length)} {g.rows.length === 1 ? "employee" : "employees"}
          </span>
          <span className="mt-0.5 block text-[11.5px]" style={{ color: SLATE }}>
            {summary}
            {review > 0 ? ` · ${n(review)} needs review` : ""}
          </span>
        </span>
        <span className="flex items-center gap-4 text-[13px] tabular-nums" style={{ color: SLATE }}>
          <span>
            Gross <strong className="font-semibold" style={{ color: NAVY }}>{inrPaise(g.grossPaise)}</strong>
          </span>
          <span className="min-w-[110px] text-right font-semibold" style={{ color: NAVY }}>
            {inrPaise(g.netPaise)}
          </span>
          {open ? <ChevronUp size={15} aria-hidden style={{ color: FAINT }} /> : <ChevronDown size={15} aria-hidden style={{ color: FAINT }} />}
        </span>
      </button>
      {open && (
        <div id={id} className="relative overflow-x-auto border-t" style={{ borderColor: "#E2E8F0" }}>
          <table className="salary-runs-table w-full min-w-[940px] border-collapse text-[12.5px]">
            <thead>
              <tr>
                {[
                  ["Employee", false],
                  ["Designation", false],
                  ["CTC / mo", true],
                  ["Payable", true],
                  ["Late ded.", true],
                  ["Gross", true],
                  ["Deductions", true],
                  ["Pending-in", true],
                  ["Net", true],
                  ["Status", false],
                  ["Disbursed", false],
                  ["", false],
                ].map(([h, right], i) => (
                  <th key={i} className={`${TH} ${right ? "!text-right" : i === 10 ? "!text-center" : ""}`} scope="col">
                    {h || <span className="sr-only">Documents</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <RunRow key={r.id} row={r} check={stale[r.employeeId]} />
              ))}
            </tbody>
            <tfoot>
              <tr className="text-[12.5px] font-semibold tabular-nums" style={{ background: HEAD_BG, color: NAVY, boxShadow: `inset 0 1px 0 ${BORDER}` }}>
                <td className="px-3 py-2" colSpan={5}>
                  Group total
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">{inrPaise(g.grossPaise)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right" style={{ color: g.deductionsPaise !== 0 ? TONE.coral.fg : NAVY }}>
                  {g.deductionsPaise === 0 ? "—" : signedPaise(-g.deductionsPaise)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">{g.pendingInPaise === 0 ? "—" : signedPaise(g.pendingInPaise)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">{inrPaise(g.netPaise)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-medium" colSpan={3} style={{ color: SLATE }}>
                  Paid {inrPaise(g.paidPaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function StaleBadge({ check }: { check: StaleCheck | undefined }) {
  if (check?.status === "stale") {
    const parts = [
      check.savedPayableDays !== check.nowPayableDays ? `payable days ${days(check.savedPayableDays)} → ${days(check.nowPayableDays)}` : "",
      check.savedLateMarks !== check.nowLateMarks ? `late marks ${check.savedLateMarks} → ${check.nowLateMarks}` : "",
    ].filter(Boolean);
    return (
      <span
        className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold"
        style={{ background: "#FFF7E6", color: "#92400E", border: "1px solid #F6DDA6" }}
        title={`Attendance changed after this run was generated: ${parts.join(", ")}. The run has not been recalculated.`}
      >
        <AlertTriangle size={11} aria-hidden /> Needs review
        <span className="sr-only">: {parts.join(", ")}</span>
      </span>
    );
  }
  if (check?.status === "unknown") {
    return (
      <span className="ml-2 rounded-full px-2 py-px text-[11px] font-semibold" style={{ background: "#F1F5F9", color: "#475569", border: `1px solid ${BORDER}` }}>
        Not checked
      </span>
    );
  }
  return null;
}

function RunRow({ row, check }: { row: SalaryRunRow; check?: StaleCheck }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = paymentStatusOf(row);
  const deductions = deductionsOf(row);
  const split = [row.pt > 0 ? `PT ${inr2(row.pt)}` : "", row.tds > 0 ? `TDS ${inr2(row.tds)}` : "", row.advances > 0 ? `Advances ${inr2(row.advances)}` : ""].filter(Boolean).join(" · ");

  function toggleDisbursed() {
    const next = !row.disbursed;
    if (next && !window.confirm(`Mark ${row.employeeName}'s salary as disbursed?`)) return;
    start(async () => {
      const res = await setDisbursed(row.id, next);
      if (!res.ok) {
        fireToast({ message: res.error });
        return;
      }
      fireToast({ message: next ? `${row.employeeName} marked disbursed.` : `${row.employeeName} disbursement undone.` });
      router.refresh();
    });
  }

  return (
    <tr className="tabular-nums" style={{ color: NAVY }} data-payment-status={status}>
      <td className="min-w-[108px] max-w-[170px] px-2 py-2 font-semibold leading-snug">
        {/* The name opens this employee's Employee Salary Report for this month (admin page, same access as this one). */}
        <Link href={`/salary/employee/${row.employeeId}?month=${row.month}` as Route} className="underline-offset-2 hover:text-[#0B4FB8] hover:underline" title={`Open ${row.employeeName}'s salary report`}>
          {row.employeeName}
        </Link>
        <StaleBadge check={check} />
        {row.source !== "generated" && (
          <span className="ml-2 rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ background: "#F1F5F9", color: "#475569", border: `1px solid ${BORDER}` }}>
            imported
          </span>
        )}
      </td>
      <td className="min-w-[84px] max-w-[150px] px-2 py-2 leading-snug" style={{ color: SLATE }}>
        {row.designationName ?? "—"}
      </td>
      <td className="px-2 py-2 text-right" style={{ color: INK }}>
        {inr2(row.annualCtc / 12)}
      </td>
      <td className="px-2 py-2 text-right" style={{ color: INK }}>
        {days(row.payableDays)}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right" style={{ color: row.lateDeductionDays > 0 ? TONE.coral.fg : FAINT }}>
        {row.lateDeductionDays > 0 ? `− ${days(row.lateDeductionDays)} d` : "—"}
      </td>
      <td className="px-2 py-2 text-right" style={{ color: INK }}>
        {inr2(row.gross)}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right" style={{ color: deductions > 0 ? TONE.coral.fg : FAINT }} title={split || undefined}>
        {deductions > 0 ? signedPaise(-deductions) : "—"}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right" style={{ color: row.pendingBalanceIn !== 0 ? TONE.teal.fg : FAINT }}>
        {row.pendingBalanceIn !== 0 ? signedPaise(toPaise(row.pendingBalanceIn)) : "—"}
      </td>
      <td className="px-2 py-2 text-right font-bold">{inr2(row.netPayable)}</td>
      <td className="whitespace-nowrap px-2 py-2">
        <PaymentStatusPill status={status} size="sm" />
        {status === "partial" && (
          <span className="ml-1.5 text-[11.5px]" style={{ color: SLATE }}>
            {inrPaise(paidOf(row))} paid
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          onClick={toggleDisbursed}
          disabled={pending}
          role="switch"
          aria-checked={row.disbursed}
          aria-label={row.disbursed ? `Mark ${row.employeeName} not disbursed` : `Mark ${row.employeeName} disbursed`}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/25"
          style={{ background: row.disbursed ? BLUE : "#CBD5E1" }}
        >
          <span className="inline-block size-4 rounded-full bg-white shadow-sm transition-transform" style={{ transform: row.disbursed ? "translateX(18px)" : "translateX(2px)" }} />
        </button>
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right">
        {/* Compact icon buttons (named for screen readers, titled for the pointer) so the row fits a 1366px screen. */}
        <Link href={`/my-salary/statement/${row.id}` as Route} prefetch={false} className={`${BTN_SM} mr-1 !w-7 !px-0`} style={{ border: `1px solid ${BORDER}`, color: BLUE_TEXT }} aria-label="Statement" title="Salary statement">
          <Receipt size={13} strokeWidth={2.2} aria-hidden />
        </Link>
        <Link href={`/salary/payslip/${row.id}` as Route} prefetch={false} className={`${BTN_SM} !w-7 !px-0`} style={{ border: `1px solid ${BORDER}`, color: BLUE_TEXT }} aria-label="Payslip" title="Payslip (PDF)">
          <FileText size={13} strokeWidth={2.2} aria-hidden />
        </Link>
      </td>
    </tr>
  );
}
