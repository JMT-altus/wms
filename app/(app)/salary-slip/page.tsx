import Link from "next/link";
import type { Route } from "next";
import { Download, Eye, FileText, ScrollText } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { requireUser } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { listRunsForEmployee } from "@/lib/queries/salary";
import { monthTitle } from "@/lib/salary/daily-report";
import { deductionsOf } from "@/lib/salary/payroll";
import { days, inr2, inrPaise, paymentStatusOf, signedPaise } from "@/lib/salary/money";
import { PAGE_GROUND } from "@/components/attendance/overview/theme";
import { BLUE, BLUE_LINE, BLUE_SOFT, BLUE_TEXT, BORDER, BTN, BTN_SM, FAINT, HEAD_BG, INK, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE, TH } from "@/components/salary/ui";
import { PaymentStatusPill } from "@/components/salary/my/status-pill";
import { SalaryMonthPicker } from "@/components/salary/my/month-picker";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const PATH = "/salary-slip";

/**
 * Salary Slip — the signed-in employee's own salary slips: one per stored
 * salary run, newest first, each with the existing statement view
 * (/my-salary/statement/[runId]) and the existing PDF payslip
 * (/salary/payslip/[runId]).
 *
 * Nothing is computed here. The runs are the ones Generate Salary (or a
 * salary-log import) stored, read for the verified session's employee only
 * (`listRunsForEmployee(me.id)` — never an id from the URL); the statement and
 * the PDF re-check own-run-or-admin on the server. Gross, deductions and net
 * are the run's own stored figures. The month (`?month=YYYY-MM`) only chooses
 * which slip is shown at the top; it defaults to the newest slip.
 */
export default async function SalarySlipPage({ searchParams }: PageProps) {
  const me = await requireUser();
  const sp = await searchParams;
  const current = localDateString(me.timezone || "Asia/Kolkata").slice(0, 7);

  const runs = await listRunsForEmployee(me.id);
  const newest = runs[0]?.month ?? current;
  const raw = typeof sp.month === "string" ? sp.month : undefined;
  const month = raw && MONTH_RE.test(raw) && raw <= current ? raw : newest;
  const earliest = runs.length > 0 ? runs[runs.length - 1]!.month : current;
  const selected = runs.find((r) => r.month === month) ?? null;
  const title = monthTitle(month);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="Employees ▸ Salary Slip" fullWidth />
      <div style={{ background: PAGE_GROUND }}>
        <main className="w-full px-6 pt-4 pb-10 max-md:px-4 lg:px-8 grid grid-cols-[minmax(0,1fr)] gap-4 emp-compact-page" data-testid="salary-slip-main">
          <section aria-labelledby="slip-title" className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 id="slip-title" style={{ color: NAVY }}>
                Salary Slip
              </h1>
              <p className="mt-1 text-[12.5px]" style={{ color: SLATE }}>
                View and download your monthly salary statements.
              </p>
            </div>
          </section>

          {/* The chosen month's slip. */}
          <section className="w-full overflow-hidden" style={SURFACE} aria-labelledby="slip-month-title" data-testid="slip-month-card">
            <div className={SECTION_HEAD}>
              <p id="slip-month-title" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
                <ScrollText size={14} aria-hidden style={{ color: BLUE }} /> Salary slip · {title}
              </p>
              <div className="max-md:w-full">
                <SalaryMonthPicker key={month} month={month} min={earliest < current ? earliest : current} max={current} basePath={PATH} inputId="salary-slip-month" label="Salary slip month" />
              </div>
            </div>
            <div className="px-4 py-3.5">
              {selected ? (
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: SLATE }}>
                        Net pay
                      </p>
                      <p className="mt-0.5 text-[26px] font-bold leading-none tabular-nums" style={{ color: NAVY }} data-testid="slip-net">
                        {inr2(selected.netPayable)}
                      </p>
                    </div>
                    <Figure label="Gross earnings" value={inr2(selected.gross)} />
                    <Figure label="Deductions" value={deductionsOf(selected) === 0 ? inrPaise(0) : signedPaise(-deductionsOf(selected))} tone={deductionsOf(selected) > 0 ? "#C2403A" : undefined} />
                    <Figure label="Payable days" value={`${days(selected.payableDays)} of ${selected.daysInMonth}`} />
                    <div>
                      <p className="mb-1 text-[12px] font-semibold" style={{ color: SLATE }}>
                        Status
                      </p>
                      <PaymentStatusPill status={paymentStatusOf(selected)} size="sm" />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/my-salary/statement/${selected.id}` as Route} className={BTN} style={{ border: `1px solid ${BLUE_LINE}`, color: BLUE_TEXT }}>
                      <Eye size={14} aria-hidden /> View slip
                    </Link>
                    <a
                      href={`/salary/payslip/${selected.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A6CFF] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] transition-colors hover:bg-[#0058D6] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/30"
                    >
                      <Download size={14} aria-hidden /> Download PDF
                    </a>
                  </div>
                  {(selected.designationName || selected.payingEntityName) && (
                    <p className="w-full text-[12.5px]" style={{ color: SLATE }}>
                      {[selected.designationName, selected.payingEntityName].filter(Boolean).join(" · ")} · {selected.fy}
                      {selected.source !== "generated" ? " · imported from the salary log" : ""}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: HEAD_BG, color: FAINT }}>
                    <FileText size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold" style={{ color: NAVY }} data-testid="slip-month-empty">
                      No salary slip for {title}
                    </p>
                    <p className="mt-0.5 text-[12.5px]" style={{ color: SLATE }}>
                      A slip appears here once HR generates the month&apos;s salary.{runs.length > 0 ? " Choose another month, or pick one from the list below." : ""}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Every slip on record. */}
          <section className="overflow-hidden" style={SURFACE} aria-labelledby="slip-list-title">
            <div className={SECTION_HEAD}>
              <h2 id="slip-list-title" className={SECTION_TITLE}>
                <FileText size={15} aria-hidden style={{ color: BLUE }} /> All salary slips
              </h2>
              <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ background: HEAD_BG, border: `1px solid ${BORDER}`, color: INK }}>
                {runs.length} {runs.length === 1 ? "slip" : "slips"}
              </span>
            </div>
            {runs.length === 0 ? (
              <div className="px-6 py-10 text-center" data-testid="slip-empty">
                <ScrollText size={26} className="mx-auto mb-2" aria-hidden style={{ color: FAINT }} />
                <p className="text-[14px] font-semibold" style={{ color: NAVY }}>
                  No salary slips yet
                </p>
                <p className="mx-auto mt-1 max-w-[52ch] text-[12.5px]" style={{ color: SLATE }}>
                  Your salary slips appear here once HR generates your salary. Each one can be viewed on screen and downloaded as a PDF.
                </p>
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-[13px]" aria-label="Salary slips">
                  <thead>
                    <tr>
                      <th className={TH}>Salary month</th>
                      <th className={`${TH} !text-right`}>Gross earnings</th>
                      <th className={`${TH} !text-right`}>Deductions</th>
                      <th className={`${TH} !text-right`}>Net pay</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Generated</th>
                      <th className={`${TH} !text-right`}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const active = r.month === month;
                      const ded = deductionsOf(r);
                      return (
                        <tr key={r.id} className="tabular-nums" aria-current={active ? "true" : undefined} style={active ? { background: BLUE_SOFT, boxShadow: `inset 3px 0 0 ${BLUE}` } : undefined}>
                          <td className="px-3 py-2">
                            <Link href={`${PATH}?month=${r.month}` as Route} scroll={false} className="font-semibold hover:text-[#0B4FB8] hover:underline" style={{ color: NAVY }}>
                              {monthTitle(r.month)}
                            </Link>
                            <span className="block text-[11.5px]" style={{ color: SLATE }}>
                              {r.fy}
                              {r.source !== "generated" ? " · imported" : ""}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right" style={{ color: INK }}>
                            {inr2(r.gross)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right" style={{ color: ded > 0 ? "#C2403A" : FAINT }}>
                            {ded > 0 ? signedPaise(-ded) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-bold" style={{ color: NAVY }}>
                            {inr2(r.netPayable)}
                          </td>
                          <td className="px-3 py-2">
                            <PaymentStatusPill status={paymentStatusOf(r)} size="sm" />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2" style={{ color: INK }}>
                            {fmtDate(r.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <Link href={`/my-salary/statement/${r.id}` as Route} className={`${BTN_SM} mr-1`} style={{ border: `1px solid ${BORDER}`, color: BLUE_TEXT }} aria-label={`View ${monthTitle(r.month)} salary slip`}>
                              <Eye size={12} aria-hidden /> View
                            </Link>
                            <a href={`/salary/payslip/${r.id}`} className={BTN_SM} style={{ border: `1px solid ${BORDER}`, color: BLUE_TEXT }} aria-label={`Download ${monthTitle(r.month)} salary slip as PDF`}>
                              <Download size={12} aria-hidden /> PDF
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[12px] font-semibold" style={{ color: SLATE }}>
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color: tone ?? NAVY }}>
        {value}
      </p>
    </div>
  );
}
