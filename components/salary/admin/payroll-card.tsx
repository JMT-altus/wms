import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import type { PayrollSummary } from "@/lib/salary/payroll";
import { payrollStatus } from "@/lib/salary/payroll";
import { inrPaise, signedPaise } from "@/lib/salary/money";
import { BORDER, NAVY, SLATE, TONE } from "@/components/attendance/overview/theme";
import { PaymentStatusPill } from "@/components/salary/my/status-pill";

/** The reference's card: white, one thin light-grey line, ~20px corners, no shadow. */
const SURFACE = { background: "#FFFFFF", border: `1px solid ${BORDER}` } as const;

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
    <section className="w-full rounded-[20px] px-6 py-5 max-md:px-4" style={SURFACE} aria-labelledby="pc-title" data-testid="payroll-card">
      {/* Row 1: the label with the month, the month picker on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="pc-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
          <Wallet size={15} aria-hidden /> Net payable · {monthTitle}
        </p>
        <div className="max-md:w-full">{selector}</div>
      </div>

      {s.included > 0 ? (
        <>
          {/* Row 2: the month's document. Row 3: the amount. Row 4: coverage, and whether it has been paid. */}
          <Link
            href={`/salary/export.xlsx?month=${month}` as Route}
            prefetch={false}
            className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-bold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
            style={{ color: TONE.coral.fg }}
          >
            Export Excel <ArrowRight size={14} aria-hidden />
          </Link>
          <p className="mt-2 text-[clamp(34px,4vw,46px)] font-extrabold leading-none tabular-nums tracking-[-0.02em]" style={{ color: NAVY }} data-testid="net-payable">
            {inrPaise(s.netPaise)}
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <p className="text-[13.5px] tabular-nums" style={{ color: SLATE }} data-testid="payroll-coverage">
              {n(s.included)} {s.included === 1 ? "run" : "runs"} · {n(s.included)} of {n(s.eligible)} eligible {s.eligible === 1 ? "employee" : "employees"}
              {skipped > 0 ? ` · ${n(skipped)} without a CTC profile` : ""}
              {s.disbursed > 0 ? ` · ${inrPaise(s.paidPaise)} paid out` : ""}
            </p>
            {status && <PaymentStatusPill status={status} variant="neutral" />}
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[22px] font-extrabold leading-tight" style={{ color: NAVY }} data-testid="payroll-empty-title">
              No salary runs for {monthTitle} yet
            </p>
            <p className="mt-1 max-w-[62ch] text-[13.5px]" style={{ color: SLATE }}>
              Generate Salary creates one run per employee with a CTC profile from this month&apos;s attendance.
              {s.eligible > 0 ? ` ${n(s.eligible)} of ${n(s.activeEmployees)} active employees are eligible.` : ""}
            </p>
            <p className="mt-1 text-[13px]" style={{ color: SLATE }}>
              Employees without a CTC profile are skipped
              {skipped > 0 ? ` (${n(skipped)} of ${n(s.activeEmployees)} active employees at the moment).` : "."}
            </p>
          </div>
          {emptyAction}
        </div>
      )}

      {s.included > 0 && (s.stale > 0 || s.unchecked > 0) && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {s.stale > 0 &&
              `${s.stale} salary ${s.stale === 1 ? "run no longer matches" : "runs no longer match"} the attendance recorded for ${monthTitle} (attendance was changed after the run was generated). Review before paying; nothing has been recalculated. `}
            {s.unchecked > 0 && `${s.unchecked} ${s.unchecked === 1 ? "run" : "runs"} could not be checked against attendance.`}
          </span>
        </p>
      )}
      {s.included > 0 && !s.reconciles && (
        <p className="mt-4 text-[13px]" style={{ color: SLATE }}>
          The runs&apos; components differ from their saved net pay by {signedPaise(s.differencePaise)}
          {s.imported > 0 ? ` — ${s.imported} ${s.imported === 1 ? "run was" : "runs were"} imported from an external salary log, whose components may not be itemised the same way.` : "."}
        </p>
      )}
      {s.included > 0 && s.notGenerated.length > 0 && (
        <p className="mt-4 text-[13px]" style={{ color: SLATE }} data-testid="not-generated">
          No run yet for {s.notGenerated.length === 1 ? "" : `${n(s.notGenerated.length)} eligible employees: `}
          {s.notGenerated.join(", ")}. Generate Salary again to add {s.notGenerated.length === 1 ? "it" : "them"}; existing runs are recalculated unless disbursed.
        </p>
      )}
    </section>
  );
}
