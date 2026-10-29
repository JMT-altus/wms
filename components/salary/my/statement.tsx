import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, Download } from "lucide-react";
import type { SalaryRunRow } from "@/lib/queries/salary";
import { buildBreakdown } from "@/lib/salary/daily-report";
import { monthTitle } from "@/lib/salary/daily-report";
import { days, inr2, inrPaise, paymentStatusOf, signedPaise } from "@/lib/salary/money";
import { BORDER, BORDER_SOFT, NAVY, SLATE, TONE } from "@/components/attendance/overview/theme";
import { PaymentStatusPill } from "./status-pill";
import { PrintButton } from "./print-button";

/**
 * The salary statement for one run, laid out to read on screen and to print
 * (the toolbar hides in print; the sheet keeps its rules). The PDF slip is the
 * existing /salary/payslip route — same run, same figures.
 */
export function SalaryStatement({ run, backHref }: { run: SalaryRunRow; backHref: string }) {
  const b = buildBreakdown(run);
  const status = paymentStatusOf(run);
  const line = "flex items-center justify-between gap-4 py-2 text-[14px]";
  return (
    <article className="mx-auto w-full max-w-[920px] print:max-w-none" aria-labelledby="st-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={backHref as Route} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold hover:underline" style={{ color: NAVY }}>
          <ArrowLeft size={15} aria-hidden /> Back to My Salary
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/salary/payslip/${run.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold"
            style={{ border: `1px solid ${BORDER}`, color: NAVY }}
          >
            <Download size={14} aria-hidden /> Download PDF
          </a>
          <PrintButton />
        </div>
      </div>

      <section className="rounded-xl bg-white p-8 max-md:p-5 print:rounded-none print:border-0 print:p-0" style={{ border: `1px solid ${BORDER}` }}>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5" style={{ borderColor: NAVY }}>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: "#0B4FB8" }}>
              Salary statement
            </p>
            <h1 id="st-title" className="mt-1 text-[24px] font-extrabold tracking-[-0.01em]" style={{ color: NAVY }}>
              {run.payingEntityName ?? "JMT Drive Solutions"}
            </h1>
            <p className="text-[13.5px]" style={{ color: SLATE }}>
              {monthTitle(run.month)} · {run.fy}
            </p>
          </div>
          <PaymentStatusPill status={status} />
        </header>

        <dl className="grid gap-x-8 gap-y-3 border-b py-5 text-[13.5px] sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: BORDER_SOFT }}>
          <Field label="Employee" value={run.employeeName} />
          <Field label="Designation" value={run.designationName ?? "—"} />
          <Field label="Salary period" value={monthTitle(run.month)} />
          <Field label="Calendar days" value={String(run.daysInMonth)} />
        </dl>

        <div className="grid gap-8 py-5 lg:grid-cols-2">
          <div>
            <h2 className="text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
              Earnings
            </h2>
            <dl className="mt-2 divide-y" style={{ borderColor: BORDER_SOFT }}>
              <div className={line}>
                <dt style={{ color: NAVY }}>Monthly CTC</dt>
                <dd className="tabular-nums" style={{ color: SLATE }}>
                  {inrPaise(b.detail.monthlyCtcPaise)}
                </dd>
              </div>
              <div className={line}>
                <dt style={{ color: NAVY }}>Per-day rate</dt>
                <dd className="tabular-nums" style={{ color: SLATE }}>
                  {inrPaise(b.detail.perDayPaise)}
                </dd>
              </div>
              <div className={line}>
                <dt style={{ color: NAVY }}>Payable days</dt>
                <dd className="tabular-nums" style={{ color: SLATE }}>
                  {days(run.payableDays)}
                </dd>
              </div>
              {run.lateDeductionDays > 0 && (
                <div className={line}>
                  <dt style={{ color: NAVY }}>Late deduction ({run.lateMarks} late marks)</dt>
                  <dd className="tabular-nums" style={{ color: TONE.coral.fg }}>
                    − {days(run.lateDeductionDays)} days
                  </dd>
                </div>
              )}
              <div className={`${line} font-bold`}>
                <dt style={{ color: NAVY }}>Gross salary</dt>
                <dd className="tabular-nums" style={{ color: NAVY }}>
                  {inr2(run.gross)}
                </dd>
              </div>
            </dl>
          </div>
          <div>
            <h2 className="text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
              Deductions and adjustments
            </h2>
            <dl className="mt-2 divide-y" style={{ borderColor: BORDER_SOFT }}>
              {b.lines.length === 0 && (
                <div className={line}>
                  <dt style={{ color: SLATE }}>None</dt>
                  <dd />
                </div>
              )}
              {b.lines.map((l) => (
                <div key={l.key} className={line}>
                  <dt style={{ color: NAVY }}>{l.label}</dt>
                  <dd className="tabular-nums font-semibold" style={{ color: l.kind === "deduction" ? TONE.coral.fg : TONE.teal.fg }}>
                    {signedPaise(l.paise)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg px-5 py-4 print:rounded-none" style={{ background: "#F3F6FA" }}>
          <p className="text-[15px] font-extrabold" style={{ color: NAVY }}>
            Net pay
          </p>
          <p className="text-[26px] font-extrabold tabular-nums" style={{ color: NAVY }} data-testid="statement-net">
            {inr2(run.netPayable)}
          </p>
        </div>
        {run.disbursed && run.disbursedAmount != null && Math.round(run.disbursedAmount * 100) !== Math.round(run.netPayable * 100) && (
          <p className="mt-3 text-[13px]" style={{ color: SLATE }}>
            Paid: {inr2(run.disbursedAmount)}. The remaining {inr2(run.netPayable - run.disbursedAmount)} is carried into the next month.
          </p>
        )}
        {!b.reconciles && (
          <p className="mt-3 text-[12.5px]" style={{ color: "#92400E" }}>
            The itemised lines differ from the saved net pay by {signedPaise(b.differencePaise)}
            {run.source !== "generated" ? " (this month was imported from an external salary log)." : "."}
          </p>
        )}
        <p className="mt-6 text-[11.5px]" style={{ color: SLATE }}>
          Generated by the payroll system from the month&apos;s attendance and the employee&apos;s salary profile. Source: {run.source}.
        </p>
      </section>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: SLATE }}>
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold" style={{ color: NAVY }}>
        {value}
      </dd>
    </div>
  );
}
