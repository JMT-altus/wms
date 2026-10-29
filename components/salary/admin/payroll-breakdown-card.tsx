"use client";

import { useState } from "react";
import { Minus, Plus, ReceiptText } from "lucide-react";
import type { PayrollSummary } from "@/lib/salary/payroll";
import { payrollLines } from "@/lib/salary/payroll";
import { inrPaise, signedPaise } from "@/lib/salary/money";
import { BORDER, BORDER_SOFT, NAVY, SLATE, TONE } from "@/components/attendance/overview/theme";

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * How the month's payroll adds up — the stored runs' own figures, summed.
 *
 * Collapsed, as the reference shows it: Gross salaries, the deductions as one
 * red total (and carried-in balances as one green line only when there are
 * any), a rule, then Net payable in a grey inset row. Expanded (the + button):
 * every deduction itemised, and the figures behind the month — who is
 * eligible, who has a run, what has been paid out and what needs review.
 */
export function PayrollBreakdownCard({ s }: { s: PayrollSummary }) {
  const [open, setOpen] = useState(false);
  const row = "flex items-center justify-between gap-4 px-3 py-3 text-[14.5px]";
  const lines = payrollLines(s);
  const deductions = lines.filter((l) => l.kind === "deduction");
  const adjustments = lines.filter((l) => l.kind === "adjustment");
  const list = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${n(names.length - 3)} more`);
  return (
    <section className="w-full rounded-[22px] px-6 py-5 max-md:px-4" style={{ background: "#FFFFFF", border: `1px solid ${BORDER}` }} aria-labelledby="pbd-title" data-testid="payroll-breakdown-card">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pbd-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: NAVY }}>
          <ReceiptText size={15} aria-hidden style={{ color: SLATE }} /> How this month&apos;s payroll is calculated
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="pbd-details"
          className="grid size-8 place-items-center rounded-md bg-white transition-colors hover:bg-[#F3F6FA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
          style={{ border: `1px solid ${BORDER}`, color: NAVY }}
          aria-label={open ? "Hide payroll details" : "Show payroll details"}
        >
          {open ? <Minus size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
        </button>
      </div>

      <dl className="mt-3">
        <div className={row}>
          <dt className="font-semibold" style={{ color: NAVY }}>
            Gross salaries
          </dt>
          <dd className="font-semibold tabular-nums" style={{ color: NAVY }} data-testid="gross-total">
            {inrPaise(s.grossPaise)}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-semibold" style={{ color: NAVY }}>
            Deductions
          </dt>
          <dd className="font-bold tabular-nums" style={{ color: TONE.coral.fg }} data-testid="deductions-total">
            {s.deductionsPaise === 0 ? inrPaise(0) : signedPaise(-s.deductionsPaise)}
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
            Net payable
          </dt>
          <dd className="text-[17px] font-extrabold tabular-nums" style={{ color: NAVY }} data-testid="net-total">
            {inrPaise(s.netPaise)}
          </dd>
        </div>
      </dl>

      {open && (
        <div id="pbd-details" className="mt-4 border-t pt-4" style={{ borderColor: BORDER_SOFT }}>
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
          </dl>
          <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: SLATE }}>
            Behind the figures
          </h3>
          <div className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4" style={{ color: SLATE }}>
            <Detail label="Eligible employees" value={`${n(s.eligible)} of ${n(s.activeEmployees)}`} hint={s.noProfile.length > 0 ? `No CTC profile: ${list(s.noProfile)}` : "Every active employee has a CTC profile"} />
            <Detail label="Runs generated" value={`${n(s.included)} of ${n(s.eligible)}`} hint={s.notGenerated.length > 0 ? `No run yet: ${list(s.notGenerated)}` : s.imported > 0 ? `${n(s.imported)} imported from a salary log` : "One run per eligible employee"} />
            <Detail label="Paid out" value={inrPaise(s.paidPaise)} hint={`${n(s.paid)} paid · ${n(s.partial)} partly paid · ${n(s.pending)} pending`} />
            <Detail label="Needs review" value={s.stale > 0 ? n(s.stale) : "None"} hint={s.unchecked > 0 ? `${n(s.unchecked)} could not be checked against attendance` : "attendance unchanged since generation"} />
            <p className="sm:col-span-2 lg:col-span-4 text-[12.5px]">
              Each run&apos;s gross = per-day rate × (payable days − late deduction days); monthly CTC ÷ calendar days is the rate. Professional tax, TDS and advances are taken off, a balance carried in from an earlier month is added, and the runs are summed here.
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
