"use client";

import { useState } from "react";
import { AlertTriangle, Minus, Plus, ReceiptText } from "lucide-react";
import type { Breakdown } from "@/lib/salary/daily-report";
import { days, inrPaise, signedPaise } from "@/lib/salary/money";
import { BORDER, BORDER_SOFT, NAVY, SLATE, TONE } from "@/components/attendance/overview/theme";

/**
 * How the month's pay was calculated — exactly the run's own figures, which the
 * server has already checked add up (`reconciles`).
 *
 * Collapsed, as the reference shows it: Base Salary, the deductions as one red
 * total (and a carried-in balance as one green line only when there is one), a
 * rule, then Final Payment in a grey inset row. Expanded (the + button): every
 * deduction itemised, and the numbers behind the gross — monthly CTC, per-day
 * rate, payable days and the late deduction — as computeSalary uses them.
 */
export function BreakdownCard({ b, source }: { b: Breakdown; source: string }) {
  const [open, setOpen] = useState(false);
  const row = "flex items-center justify-between gap-4 px-3 py-3 text-[14.5px]";
  const deductions = b.lines.filter((l) => l.kind === "deduction");
  const adjustments = b.lines.filter((l) => l.kind === "adjustment");
  return (
    <section
      className="w-full rounded-[22px] px-6 py-5 max-md:px-4"
      style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }}
      aria-labelledby="bd-title"
      data-testid="breakdown-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="bd-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: NAVY }}>
          <ReceiptText size={15} aria-hidden style={{ color: SLATE }} /> How your salary is calculated
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="bd-details"
          className="grid size-8 place-items-center rounded-md bg-white transition-colors hover:bg-[#F3F6FA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
          style={{ border: `1px solid ${BORDER}`, color: NAVY }}
          aria-label={open ? "Hide calculation details" : "Show calculation details"}
        >
          {open ? <Minus size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
        </button>
      </div>

      <dl className="mt-3">
        <div className={row}>
          <dt className="font-semibold" style={{ color: NAVY }}>
            Base Salary
          </dt>
          <dd className="font-semibold tabular-nums" style={{ color: NAVY }} data-testid="base-salary">
            {inrPaise(b.grossPaise)}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold" style={{ color: NAVY }}>
            Deductions
          </dt>
          <dd className="font-bold tabular-nums" style={{ color: TONE.coral.fg }} data-testid="deductions-total">
            {b.deductionsPaise === 0 ? inrPaise(0) : signedPaise(b.deductionsPaise)}
          </dd>
        </div>
        {adjustments.map((l) => (
          <div key={l.key} className={row}>
            <dt className="font-semibold" style={{ color: NAVY }}>
              {l.label}
            </dt>
            <dd className="font-bold tabular-nums" style={{ color: TONE.teal.fg }}>
              {signedPaise(l.paise)}
            </dd>
          </div>
        ))}
        <div className="mx-3 my-1 border-t" style={{ borderColor: BORDER_SOFT }} aria-hidden />
        <div className="mt-2 flex items-center justify-between gap-4 rounded-xl px-4 py-3.5" style={{ background: "#F3F6FA" }}>
          <dt className="text-[15px] font-extrabold" style={{ color: NAVY }}>
            Final Payment
          </dt>
          <dd className="text-[17px] font-extrabold tabular-nums" style={{ color: NAVY }} data-testid="final-payment">
            {inrPaise(b.netPaise)}
          </dd>
        </div>
      </dl>

      {!b.reconciles && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            These lines differ from the saved net pay by {signedPaise(b.differencePaise)}
            {source !== "generated" ? " — this month was imported from an external salary log, so its components may not be itemised the same way." : ". Tell HR; the saved net pay is what is shown above."}
          </span>
        </p>
      )}

      {open && (
        <div id="bd-details" className="mt-4 border-t pt-4" style={{ borderColor: BORDER_SOFT }}>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: SLATE }}>
            Deductions in detail
          </h3>
          <dl className="mt-1">
            {deductions.length === 0 && (
              <div className="flex items-center justify-between gap-4 px-3 py-2 text-[13.5px]" style={{ color: SLATE }}>
                <dt>No deductions this month</dt>
                <dd />
              </div>
            )}
            {deductions.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-4 px-3 py-2 text-[13.5px]">
                <dt style={{ color: NAVY }}>{l.label}</dt>
                <dd className="font-semibold tabular-nums" style={{ color: TONE.coral.fg }}>
                  {signedPaise(l.paise)}
                </dd>
              </div>
            ))}
            {adjustments.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-4 px-3 py-2 text-[13.5px]">
                <dt style={{ color: NAVY }}>
                  {l.label}
                  {l.note && (
                    <span className="block text-[12px]" style={{ color: SLATE }}>
                      {l.note}
                    </span>
                  )}
                </dt>
                <dd className="font-semibold tabular-nums" style={{ color: TONE.teal.fg }}>
                  {signedPaise(l.paise)}
                </dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: SLATE }}>
            Behind the base salary
          </h3>
          <div className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4" style={{ color: SLATE }}>
            <Detail label="Monthly CTC" value={inrPaise(b.detail.monthlyCtcPaise)} hint="Annual CTC ÷ 12" />
            <Detail label="Per-day rate" value={inrPaise(b.detail.perDayPaise)} hint={`Monthly CTC ÷ ${b.detail.daysInMonth} calendar days`} />
            <Detail label="Payable days" value={`${days(b.detail.payableDays)} of ${b.detail.daysInMonth}`} hint="Sum of each day's value: present 1, half day ½, absent 0, worked holiday 2" />
            <Detail
              label="Late deduction"
              value={b.detail.lateDeductionDays > 0 ? `− ${days(b.detail.lateDeductionDays)} days` : "None"}
              hint={`${b.detail.lateMarks} late mark${b.detail.lateMarks === 1 ? "" : "s"}; every third costs half a day`}
            />
            <p className="sm:col-span-2 lg:col-span-4 text-[12.5px]">
              Base salary = per-day rate × (payable days − late deduction days). Then professional tax, TDS and any advances are taken off, and a balance carried in from an earlier month is added.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Detail({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "#F8FAFD" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
        {label}
      </p>
      <p className="mt-0.5 text-[16px] font-bold tabular-nums" style={{ color: NAVY }}>
        {value}
      </p>
      <p className="mt-0.5 text-[12px]" style={{ color: SLATE }}>
        {hint}
      </p>
    </div>
  );
}
