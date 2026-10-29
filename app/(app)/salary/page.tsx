import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { SalaryImportDialog } from "@/components/salary/salary-import-dialog";
import { GenerateButton } from "@/components/salary/admin/generate-button";
import { PayrollCard } from "@/components/salary/admin/payroll-card";
import { PayrollBreakdownCard } from "@/components/salary/admin/payroll-breakdown-card";
import { SalaryRunsReport } from "@/components/salary/admin/salary-runs-report";
import { PayrollHistoryCard } from "@/components/salary/admin/payroll-history-card";
import { AttendanceSummaryCards } from "@/components/salary/my/attendance-cards";
import { SalaryMonthPicker } from "@/components/salary/my/month-picker";
import { CARD, NAVY, PAGE_GROUND, SLATE } from "@/components/attendance/overview/theme";
import { requireAdmin } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import { listRunsForMonth, listSalaryMonths, listSalaryProfiles } from "@/lib/queries/salary";
import { readMonthAttendance, staleChecksFrom } from "@/lib/queries/salary-stale";
import { monthTitle } from "@/lib/salary/daily-report";
import { buildPayrollSummary, rosterAttendance } from "@/lib/salary/payroll";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Salary — the administrators' view of one month's payroll, laid out like
 * My Salary: the month's net payable and payment state, how it adds up, the
 * attendance it rests on (the whole roster's counts), every run employee by
 * employee, and the history of months. Every figure is a stored run's own,
 * summed; the roster's attendance is read exactly as Generate Salary reads
 * it. The month is the only input (`?month=YYYY-MM`), never past the current
 * one. Import, Export and Generate keep their places as the page's actions.
 */
export default async function SalaryPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const today = localDateString("Asia/Kolkata");
  const current = today.slice(0, 7);
  const raw = typeof sp.month === "string" ? sp.month : undefined;
  const month = raw && MONTH_RE.test(raw) && raw <= current ? raw : current;

  const [rows, profiles, history, attendance] = await Promise.all([listRunsForMonth(month), listSalaryProfiles(), listSalaryMonths(), readMonthAttendance(month)]);
  // Read-only: flags runs whose attendance inputs changed after generation.
  const stale = staleChecksFrom(rows, attendance);
  const summary = buildPayrollSummary(rows, profiles, stale);
  const roster = attendance ? rosterAttendance(attendance) : null;
  const title = monthTitle(month);
  const earliest = history.length > 0 ? history[history.length - 1]!.month : current;
  const selector = <SalaryMonthPicker key={month} month={month} min={earliest < current ? earliest : current} max={current} basePath="/salary" inputId="salary-month" label="Payroll month" />;
  const generate = <GenerateButton month={month} monthLabel={title} rows={rows} />;

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="Employees ▸ Salary" fullWidth />
      <div style={{ background: PAGE_GROUND }}>
        {/* Full width after the sidebar: the same gutters as the header row above, no centred cap. */}
        <main className="w-full px-6 pt-5 pb-10 max-md:px-4 lg:px-8 grid grid-cols-[minmax(0,1fr)] gap-5" data-testid="salary-admin-main">
          {/* The title panel: heading and subtitle on the left, the actions on the right — the same card as /my-salary. */}
          <section
            aria-labelledby="salary-title"
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl px-6 py-5 max-md:px-4"
            style={CARD}
            data-testid="salary-title-panel"
          >
            <div className="flex min-w-[280px] flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 id="salary-title" className="text-[clamp(26px,2.6vw,32px)] font-extrabold leading-none tracking-[-0.02em]" style={{ color: NAVY }}>
                Salary
              </h1>
              <p className="text-[14.5px] font-medium" style={{ color: SLATE }}>
                Every employee&apos;s pay, deductions and attendance for the month — generated from attendance and each CTC profile.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2.5 max-md:w-full" role="group" aria-label="Salary actions">
              <SalaryImportDialog />
              {rows.length > 0 && generate}
            </div>
          </section>

          <PayrollCard s={summary} month={month} monthTitle={title} selector={selector} emptyAction={<GenerateButton month={month} monthLabel={title} rows={rows} hero />} />

          {rows.length > 0 && <PayrollBreakdownCard s={summary} />}

          <AttendanceSummaryCards a={roster} error={attendance === null} scope="roster" employees={roster?.employees} />

          {rows.length > 0 && <SalaryRunsReport rows={rows} stale={stale} summary={summary} monthTitle={title} />}

          <PayrollHistoryCard history={history} current={month} />
        </main>
      </div>
      <div className="[&>footer]:mt-0">
        <DashboardFooter />
      </div>
    </>
  );
}
