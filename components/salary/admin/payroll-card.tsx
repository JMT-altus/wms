import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, FileSpreadsheet, Wallet } from "lucide-react";
import type { PayrollSummary } from "@/lib/salary/payroll";
import { payrollStatus } from "@/lib/salary/payroll";
import { inrPaise, signedPaise } from "@/lib/salary/money";
import { BLUE, BLUE_LINE, BLUE_TEXT, BTN, BORDER_SOFT, NAVY, SECTION_HEAD, SLATE, SURFACE } from "@/components/salary/ui";
import { PaymentStatusPill } from "@/components/salary/my/status-pill";

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * The headline of the administrators' Salary page: the month's net payable
 * as the stored runs add up, how far the roster is covered, and whether the
 * month has been paid. The same card as My Salary's Net Pay, for the whole
 * roster. With no runs yet it says so — and how many employees Generate
 * Salary would skip — rather than showing ₹0.
 */
export function PayrollCard({
  s,
  month,
  monthTitle,
  selector,
  emptyAction,
}: {
  s: PayrollSummary;
  month: string;
  monthTitle: string;
  /** The month picker. */
  selector: ReactNode;
  /** The Generate action the empty state shows. */
  emptyAction?: ReactNode;
}) {
  const status = payrollStatus(s);
  const skipped = s.noProfile.length;
  return (
    <section className="w-full overflow-hidden" style={SURFACE} aria-labelledby="pc-title" data-testid="payroll-card">
      {/* Title bar: the label with the month, the month picker on the right. */}
      <div className={SECTION_HEAD}>
        <p id="pc-title" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
          <Wallet size={14} aria-hidden style={{ color: BLUE }} /> Net payable · {monthTitle}
        </p>
        <div className="max-md:w-full">{selector}</div>
      </div>

      <div className="px-4 py-3.5">
        {s.included > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {/* The amount, and how far the roster is covered. */}
            <div className="min-w-0">
              <p className="text-[28px] font-bold leading-none tabular-nums tracking-[-0.01em]" style={{ color: NAVY }} data-testid="net-payable">
                {inrPaise(s.netPaise)}
              </p>
              <p className="mt-1.5 text-[12.5px] tabular-nums" style={{ color: SLATE }} data-testid="payroll-coverage">
                {n(s.included)} {s.included === 1 ? "run" : "runs"} · {n(s.included)} of {n(s.eligible)} eligible {s.eligible === 1 ? "employee" : "employees"}
                {skipped > 0 ? ` · ${n(skipped)} without a CTC profile` : ""}
                {s.disbursed > 0 ? ` · ${inrPaise(s.paidPaise)} paid out` : ""}
              </p>
            </div>
            {/* Whether it has been paid, and the month's workbook. */}
            <div className="flex flex-wrap items-center gap-2">
              {status && <PaymentStatusPill status={status} variant="neutral" />}
              <Link href={`/salary/export.xlsx?month=${month}` as Route} prefetch={false} className={BTN} style={{ border: `1px solid ${BLUE_LINE}`, color: BLUE_TEXT }}>
                <FileSpreadsheet size={14} aria-hidden /> Export Excel
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[16px] font-semibold leading-snug" style={{ color: NAVY }} data-testid="payroll-empty-title">
                No salary runs for {monthTitle} yet
              </p>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-snug" style={{ color: SLATE }}>
                Generate Salary creates one run per employee with a CTC profile from this month&apos;s attendance.
                {s.eligible > 0 ? ` ${n(s.eligible)} of ${n(s.activeEmployees)} active employees are eligible.` : ""}
              </p>
              <p className="mt-1 text-[12.5px]" style={{ color: SLATE }}>
                Employees without a CTC profile are skipped
                {skipped > 0 ? ` (${n(skipped)} of ${n(s.activeEmployees)} active employees at the moment).` : "."}
              </p>
            </div>
            {emptyAction}
          </div>
        )}

        {s.included > 0 && (s.stale > 0 || s.unchecked > 0) && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {s.stale > 0 &&
                `${s.stale} salary ${s.stale === 1 ? "run no longer matches" : "runs no longer match"} the attendance recorded for ${monthTitle} (attendance was changed after the run was generated). Review before paying; nothing has been recalculated. `}
              {s.unchecked > 0 && `${s.unchecked} ${s.unchecked === 1 ? "run" : "runs"} could not be checked against attendance.`}
            </span>
          </p>
        )}
        {s.included > 0 && !s.reconciles && (
          <p className="mt-3 border-t pt-2.5 text-[12.5px]" style={{ color: SLATE, borderColor: BORDER_SOFT }}>
            The runs&apos; components differ from their saved net pay by {signedPaise(s.differencePaise)}
            {s.imported > 0 ? ` — ${s.imported} ${s.imported === 1 ? "run was" : "runs were"} imported from an external salary log, whose components may not be itemised the same way.` : "."}
          </p>
        )}
        {s.included > 0 && s.notGenerated.length > 0 && (
          <p className="mt-3 border-t pt-2.5 text-[12.5px]" style={{ color: SLATE, borderColor: BORDER_SOFT }} data-testid="not-generated">
            No run yet for {s.notGenerated.length === 1 ? "" : `${n(s.notGenerated.length)} eligible employees: `}
            {s.notGenerated.join(", ")}. Generate Salary again to add {s.notGenerated.length === 1 ? "it" : "them"}; existing runs are recalculated unless disbursed.
          </p>
        )}
      </div>
    </section>
  );
}
