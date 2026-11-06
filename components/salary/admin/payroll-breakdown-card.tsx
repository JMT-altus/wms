"use client";

import { useState } from "react";
import { ReceiptText } from "lucide-react";
import type { PayrollSummary } from "@/lib/salary/payroll";
import { payrollLines } from "@/lib/salary/payroll";
import { inrPaise, signedPaise } from "@/lib/salary/money";
import { TONE } from "@/components/attendance/overview/theme";
import { BLUE, BLUE_LINE, BLUE_SOFT, BORDER_SOFT, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE } from "@/components/salary/ui";
import { Detail, ToggleButton } from "@/components/salary/my/breakdown-card";

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * How the month's payroll adds up — the stored runs' own figures, summed.
 *
 * Collapsed: Gross salaries, the deductions as one red total (and carried-in
 * balances as one green line only when there are any), then Net payable in a
 * pale blue row. Expanded (the + button): every deduction itemised, and the
 * figures behind the month — who is eligible, who has a run, what has been
 * paid out and what needs review.
 */
export function PayrollBreakdownCard({ s }: { s: PayrollSummary }) {
  const [open, setOpen] = useState(false);
  const row = "flex items-center justify-between gap-4 px-4 py-2 text-[13.5px]";
  const lines = payrollLines(s);
  const deductions = lines.filter((l) => l.kind === "deduction");
  const adjustments = lines.filter((l) => l.kind === "adjustment");
  const list = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${n(names.length - 3)} more`);
  return (
    <section className="w-full overflow-hidden" style={SURFACE} aria-labelledby="pbd-title" data-testid="payroll-breakdown-card">
      <div className={SECTION_HEAD}>
        <h2 id="pbd-title" className={SECTION_TITLE}>
          <ReceiptText size={15} aria-hidden style={{ color: BLUE }} /> How this month&apos;s payroll is calculated
        </h2>
        <ToggleButton open={open} onClick={() => setOpen((o) => !o)} controls="pbd-details" label={open ? "Hide payroll details" : "Show payroll details"} />
      </div>

      <dl className="py-1.5">
        <div className={row}>
          <dt className="font-medium" style={{ color: NAVY }}>
            Gross salaries
          </dt>
          <dd className="font-semibold tabular-nums" style={{ color: NAVY }} data-testid="gross-total">
            {inrPaise(s.grossPaise)}
          </dd>
        </div>
        <div className={row}>
          <dt className="font-medium" style={{ color: NAVY }}>
            Deductions
          </dt>
          <dd className="font-semibold tabular-nums" style={{ color: TONE.coral.fg }} data-testid="deductions-total">
            {s.deductionsPaise === 0 ? inrPaise(0) : signedPaise(-s.deductionsPaise)}
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
        <div className="mx-4 mb-1.5 mt-1.5 flex items-center justify-between gap-4 rounded-lg px-3 py-2.5" style={{ background: BLUE_SOFT, border: `1px solid ${BLUE_LINE}` }}>
          <dt className="text-[14px] font-semibold" style={{ color: NAVY }}>
            Net payable
          </dt>
          <dd className="text-[16px] font-bold tabular-nums" style={{ color: NAVY }} data-testid="net-total">
            {inrPaise(s.netPaise)}
          </dd>
        </div>
      </dl>

      {open && (
        <div id="pbd-details" className="border-t px-4 pb-4 pt-3" style={{ borderColor: BORDER_SOFT }}>
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
          </dl>
          <h3 className="mt-3.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: SLATE }}>
            Behind the figures
          </h3>
          <div className="mt-1.5 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4" style={{ color: SLATE }}>
            <Detail label="Eligible employees" value={`${n(s.eligible)} of ${n(s.activeEmployees)}`} hint={s.noProfile.length > 0 ? `No CTC profile: ${list(s.noProfile)}` : "Every active employee has a CTC profile"} />
            <Detail label="Runs generated" value={`${n(s.included)} of ${n(s.eligible)}`} hint={s.notGenerated.length > 0 ? `No run yet: ${list(s.notGenerated)}` : s.imported > 0 ? `${n(s.imported)} imported from a salary log` : "One run per eligible employee"} />
            <Detail label="Paid out" value={inrPaise(s.paidPaise)} hint={`${n(s.paid)} paid · ${n(s.partial)} partly paid · ${n(s.pending)} pending`} />
            <Detail label="Needs review" value={s.stale > 0 ? n(s.stale) : "None"} hint={s.unchecked > 0 ? `${n(s.unchecked)} could not be checked against attendance` : "attendance unchanged since generation"} />
            <p className="text-[12px] leading-snug sm:col-span-2 lg:col-span-4">
              Each run&apos;s gross = per-day rate × (payable days − late deduction days); monthly CTC ÷ calendar days is the rate. Professional tax, TDS and advances are taken off, a balance carried in from an earlier month is added, and the runs are summed here.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
