"use client";

import { useState } from "react";
import { AlertTriangle, Minus, Plus, ReceiptText } from "lucide-react";
import type { Breakdown } from "@/lib/salary/daily-report";
import { days, inrPaise, signedPaise } from "@/lib/salary/money";
import { TONE } from "@/components/attendance/overview/theme";
import { BLUE, BLUE_LINE, BLUE_SOFT, BORDER, BORDER_SOFT, HEAD_BG, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE } from "@/components/salary/ui";

/**
 * How the month's pay was calculated — exactly the run's own figures, which the
 * server has already checked add up (`reconciles`).
 *
 * Collapsed: Base Salary, the deductions as one red total (and a carried-in
 * balance as one green line only when there is one), then Final Payment in a
 * pale blue row. Expanded (the + button): every deduction itemised, and the
 * numbers behind the gross — monthly CTC, per-day rate, payable days and the
 * late deduction — as computeSalary uses them.
 */
export function BreakdownCard({ b, source, subjectName }: { b: Breakdown; source: string; /** The admin's Employee Salary Report: name the employee instead of "your". */ subjectName?: string }) {
  const [open, setOpen] = useState(false);
  const row = "flex items-center justify-between gap-4 px-4 py-2 text-[13.5px]";
  const deductions = b.lines.filter((l) => l.kind === "deduction");
  const adjustments = b.lines.filter((l) => l.kind === "adjustment");
  return (
    <section className="w-full overflow-hidden" style={SURFACE} aria-labelledby="bd-title" data-testid="breakdown-card">
      <div className={SECTION_HEAD}>
        <h2 id="bd-title" className={SECTION_TITLE}>
          <ReceiptText size={15} aria-hidden style={{ color: BLUE }} /> {subjectName ? `How ${subjectName}'s salary is calculated` : "How your salary is calculated"}
        </h2>
        <ToggleButton open={open} onClick={() => setOpen((o) => !o)} controls="bd-details" label={open ? "Hide calculation details" : "Show calculation details"} />
      </div>

      <dl className="py-1.5">
        <div className={row}>
          <dt className="font-medium" style={{ color: NAVY }}>
            Base Salary
          </dt>
          <dd className="font-semibold tabular-nums" style={{ color: NAVY }} data-testid="base-salary">
            {inrPaise(b.grossPaise)}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-medium" style={{ color: NAVY }}>
            Deductions
          </dt>
          <dd className="font-semibold tabular-nums" style={{ color: TONE.coral.fg }} data-testid="deductions-total">
            {b.deductionsPaise === 0 ? inrPaise(0) : signedPaise(b.deductionsPaise)}
          </dd>
        </div>
        {adjustments.map((l) => (
          <div key={l.key} className={row}>
            <dt className="font-medium" style={{ color: NAVY }}>
              {l.label}
            </dt>
            <dd className="font-semibold tabular-nums" style={{ color: TONE.teal.fg }}>
              {signedPaise(l.paise)}
            </dd>
          </div>
        ))}
        <div className="mx-4 mt-1.5 flex items-center justify-between gap-4 rounded-lg px-3 py-2.5" style={{ background: BLUE_SOFT, border: `1px solid ${BLUE_LINE}` }}>
          <dt className="text-[14px] font-semibold" style={{ color: NAVY }}>
            Final Payment
          </dt>
          <dd className="text-[16px] font-bold tabular-nums" style={{ color: NAVY }} data-testid="final-payment">
            {inrPaise(b.netPaise)}
          </dd>
        </div>
      </dl>

      {!b.reconciles && (
        <p role="status" className="mx-4 mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            These lines differ from the saved net pay by {signedPaise(b.differencePaise)}
            {source !== "generated" ? " — this month was imported from an external salary log, so its components may not be itemised the same way." : ". Tell HR; the saved net pay is what is shown above."}
          </span>
        </p>
      )}

      {open && (
        <div id="bd-details" className="border-t px-4 pb-4 pt-3" style={{ borderColor: BORDER_SOFT }}>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: SLATE }}>
            Deductions in detail
          </h3>
          <dl className="mt-1.5 overflow-hidden rounded-lg" style={{ border: `1px solid ${BORDER_SOFT}` }}>
            {deductions.length === 0 && (
              <div className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]" style={{ color: SLATE }}>
                <dt>No deductions this month</dt>
                <dd />
              </div>
            )}
            {deductions.map((l, i) => (
              <div key={l.key} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]" style={i > 0 ? { borderTop: `1px solid ${BORDER_SOFT}` } : undefined}>
                <dt style={{ color: NAVY }}>{l.label}</dt>
                <dd className="font-semibold tabular-nums" style={{ color: TONE.coral.fg }}>
                  {signedPaise(l.paise)}
                </dd>
              </div>
            ))}
            {adjustments.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]" style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
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
          <h3 className="mt-3.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: SLATE }}>
            Behind the base salary
          </h3>
          <div className="mt-1.5 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4" style={{ color: SLATE }}>
            <Detail label="Monthly CTC" value={inrPaise(b.detail.monthlyCtcPaise)} hint="Annual CTC ÷ 12" />
            <Detail label="Per-day rate" value={inrPaise(b.detail.perDayPaise)} hint={`Monthly CTC ÷ ${b.detail.daysInMonth} calendar days`} />
            <Detail label="Payable days" value={`${days(b.detail.payableDays)} of ${b.detail.daysInMonth}`} hint="Sum of each day's value: present 1, half day ½, absent 0, worked holiday 2" />
            <Detail
              label="Late deduction"
              value={b.detail.lateDeductionDays > 0 ? `− ${days(b.detail.lateDeductionDays)} days` : "None"}
              hint={`${b.detail.lateMarks} late mark${b.detail.lateMarks === 1 ? "" : "s"}; every third costs half a day`}
            />
            <p className="text-[12px] leading-snug sm:col-span-2 lg:col-span-4">
              Base salary = per-day rate × (payable days − late deduction days). Then professional tax, TDS and any advances are taken off, and a balance carried in from an earlier month is added.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/** The + / − button that opens a card's details. */
export function ToggleButton({ open, onClick, controls, label }: { open: boolean; onClick: () => void; controls: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      className="grid size-7 place-items-center rounded-md bg-white transition-colors hover:bg-[#F3F6FA] hover:text-[#0B4FB8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20"
      style={{ border: `1px solid ${BORDER}`, color: NAVY }}
      aria-label={label}
    >
      {open ? <Minus size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
    </button>
  );
}

/** A small figure tile inside a card. */
export function Detail({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: HEAD_BG, border: `1px solid ${BORDER_SOFT}` }}>
      <p className="text-[11.5px] font-semibold" style={{ color: SLATE }}>
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color: NAVY }}>
        {value}
      </p>
      <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: SLATE }}>
        {hint}
      </p>
    </div>
  );
}
