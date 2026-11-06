import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import type { SalaryRunRow } from "@/lib/queries/salary";
import type { StaleCheck } from "@/lib/salary/stale";
import { inr2, paymentStatusOf } from "@/lib/salary/money";
import { BLUE, BLUE_LINE, BLUE_TEXT, BTN, BORDER_SOFT, NAVY, SECTION_HEAD, SLATE, SURFACE } from "@/components/salary/ui";
import { PaymentStatusPill } from "./status-pill";

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
  subjectName,
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
  /** Set on the admin's Employee Salary Report: the wording names this employee instead of "you". */
  subjectName?: string;
}) {
  const role = [designation, entity].filter(Boolean).join(" · ");
  return (
    <section className="w-full overflow-hidden" style={SURFACE} aria-labelledby="np-title" data-testid="net-pay-card">
      {/* Title bar: the label with the month, the month picker on the right. */}
      <div className={SECTION_HEAD}>
        <p id="np-title" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
          <Wallet size={14} aria-hidden style={{ color: BLUE }} /> Net pay · {monthTitle}
        </p>
        <div className="max-md:w-full">{selector}</div>
      </div>

      <div className="px-4 py-3.5">
        {run ? (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {/* The amount, and who it is for. */}
            <div className="min-w-0">
              <p className="text-[28px] font-bold leading-none tabular-nums tracking-[-0.01em]" style={{ color: NAVY }} data-testid="net-pay">
                {inr2(run.netPayable)}
              </p>
              <p className="mt-1.5 text-[12.5px]" style={{ color: SLATE }}>
                {role || " "}
              </p>
            </div>
            {/* Whether it has been paid, and the way to the statement. */}
            <div className="flex flex-wrap items-center gap-2">
              {action}
              <PaymentStatusPill status={paymentStatusOf(run)} variant="neutral" />
              <Link href={`/my-salary/statement/${run.id}` as Route} className={BTN} style={{ border: `1px solid ${BLUE_LINE}`, color: BLUE_TEXT }}>
                Salary Statement <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[16px] font-semibold leading-snug" style={{ color: NAVY }}>
                No salary run for {monthTitle} yet
              </p>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-snug" style={{ color: SLATE }}>
                {subjectName
                  ? hasProfile
                    ? `${subjectName}'s salary for this month hasn't been generated. Salaries are generated from the month's attendance; the attendance below is still live.`
                    : `No salary profile (CTC) is set for ${subjectName}, so a salary can't be calculated.`
                  : hasProfile
                    ? "Your salary for this month hasn't been generated. HR generates salaries from the month's attendance; your attendance below is still live."
                    : "No salary profile (CTC) is set for your login, so a salary can't be calculated. Ask HR to set one up."}
              </p>
              {role && (
                <p className="mt-1.5 text-[12.5px]" style={{ color: SLATE }}>
                  {role}
                </p>
              )}
            </div>
            {action}
          </div>
        )}
        {run && stale?.status === "stale" && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {subjectName ? `${subjectName}'s` : "Your"} attendance for this month changed after this salary was calculated (payable days {stale.savedPayableDays} → {stale.nowPayableDays}
              {stale.savedLateMarks !== stale.nowLateMarks ? `, late marks ${stale.savedLateMarks} → ${stale.nowLateMarks}` : ""}). The figure above is the saved one; HR recalculates it
              before payment.
            </span>
          </p>
        )}
        {run && run.disbursed && run.disbursedAmount != null && Math.round(run.disbursedAmount * 100) < Math.round(run.netPayable * 100) && (
          <p className="mt-3 pt-2.5 text-[12.5px]" style={{ color: SLATE, borderTop: `1px solid ${BORDER_SOFT}` }}>
            {inr2(run.disbursedAmount)} was paid; the remaining {inr2(run.netPayable - run.disbursedAmount)} is carried into the next month&apos;s salary.
          </p>
        )}
      </div>
    </section>
  );
}
