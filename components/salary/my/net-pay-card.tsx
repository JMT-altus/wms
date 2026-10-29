import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import type { SalaryRunRow } from "@/lib/queries/salary";
import type { StaleCheck } from "@/lib/salary/stale";
import { inr2, paymentStatusOf } from "@/lib/salary/money";
import { BORDER, BORDER_SOFT, NAVY, SLATE, TONE } from "@/components/attendance/overview/theme";
import { PaymentStatusPill } from "./status-pill";

/** The reference's card: white, one thin light-grey line, ~20px corners, no shadow. */
const SURFACE = { background: "#FFFFFF", border: `1px solid ${BORDER}` } as const;

/**
 * The headline: this month's net pay as the salary run stored it, its payment
 * state, and the way to the full statement. With no run yet it says so — and
 * why, when the reason is known (no CTC profile) — rather than showing ₹0.
 */
export function NetPayCard({
  run,
  monthTitle,
  hasProfile,
  designation,
  entity,
  stale,
  selector,
  action,
}: {
  run: SalaryRunRow | null;
  monthTitle: string;
  hasProfile: boolean;
  designation: string | null;
  entity: string | null;
  stale: StaleCheck | null;
  /** The month picker. */
  selector: ReactNode;
  /** "Recalculate my salary", for those who may. */
  action?: ReactNode;
}) {
  const role = [designation, entity].filter(Boolean).join(" · ");
  return (
    <section className="w-full rounded-[20px] px-6 py-5 max-md:px-4" style={SURFACE} aria-labelledby="np-title" data-testid="net-pay-card">
      {/* Row 1: the label with the month, the month picker on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="np-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
          <Wallet size={15} aria-hidden /> Net pay · {monthTitle}
        </p>
        <div className="max-md:w-full">{selector}</div>
      </div>

      {run ? (
        <>
          {/* Row 2: the way to the statement. Row 3: the amount. Row 4: who, and whether it has been paid. */}
          <Link
            href={`/my-salary/statement/${run.id}` as Route}
            className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-bold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
            style={{ color: TONE.coral.fg }}
          >
            Salary Statement <ArrowRight size={14} aria-hidden />
          </Link>
          <p className="mt-2 text-[clamp(34px,4vw,46px)] font-extrabold leading-none tabular-nums tracking-[-0.02em]" style={{ color: NAVY }} data-testid="net-pay">
            {inr2(run.netPayable)}
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <p className="text-[13.5px]" style={{ color: SLATE }}>
              {role || " "}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {action}
              <PaymentStatusPill status={paymentStatusOf(run)} variant="neutral" />
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[22px] font-extrabold leading-tight" style={{ color: NAVY }}>
              No salary run for {monthTitle} yet
            </p>
            <p className="mt-1 max-w-[60ch] text-[13.5px]" style={{ color: SLATE }}>
              {hasProfile
                ? "Your salary for this month hasn't been generated. HR generates salaries from the month's attendance; your attendance below is still live."
                : "No salary profile (CTC) is set for your login, so a salary can't be calculated. Ask HR to set one up."}
            </p>
            {role && (
              <p className="mt-2 text-[13.5px]" style={{ color: SLATE }}>
                {role}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {run && stale?.status === "stale" && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Your attendance for this month changed after this salary was calculated (payable days {stale.savedPayableDays} → {stale.nowPayableDays}
            {stale.savedLateMarks !== stale.nowLateMarks ? `, late marks ${stale.savedLateMarks} → ${stale.nowLateMarks}` : ""}). The figure above is the saved one; HR recalculates it
            before payment.
          </span>
        </p>
      )}
      {run && run.disbursed && run.disbursedAmount != null && Math.round(run.disbursedAmount * 100) < Math.round(run.netPayable * 100) && (
        <p className="mt-4 text-[13px]" style={{ color: SLATE, borderTop: `1px solid ${BORDER_SOFT}`, paddingTop: 12 }}>
          {inr2(run.disbursedAmount)} was paid; the remaining {inr2(run.netPayable - run.disbursedAmount)} is carried into the next month&apos;s salary.
        </p>
      )}
    </section>
  );
}
