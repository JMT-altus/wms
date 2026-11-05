import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { requireAdmin } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import { loadMySalary } from "@/lib/salary/my-salary";
import { getReportEmployee, listReportEmployees } from "@/lib/salary/employee-report";
import { attendanceCards, buildBreakdown, buildDailyReport, monthTitle, shiftMonthKey } from "@/lib/salary/daily-report";
import { MonthCalendar } from "@/components/attendance/overview/month-calendar";
import { CARD, NAVY, PAGE_GROUND, SLATE } from "@/components/attendance/overview/theme";
import { NetPayCard } from "@/components/salary/my/net-pay-card";
import { BreakdownCard } from "@/components/salary/my/breakdown-card";
import { AttendanceSummaryCards } from "@/components/salary/my/attendance-cards";
import { DailySalaryReport } from "@/components/salary/my/daily-report";
import { SalaryHistoryCard } from "@/components/salary/my/history-card";
import { SalaryMonthPicker } from "@/components/salary/my/month-picker";
import { RecalculateButton } from "@/components/salary/my/recalculate-button";
import { EmployeeReportPicker } from "@/components/salary/admin/employee-report-picker";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Employee Salary Report — the admin's view of ANY employee's salary for a
 * month: net pay, how it was calculated, the attendance it rests on (counts,
 * calendar) and the day-by-day report with check-in, check-out and hours —
 * HR-imported punches included, since they are ordinary attendance records.
 *
 * Exactly the data and payroll calculations My Salary shows (loadMySalary and
 * the same builders), for the employee chosen here instead of the signed-in
 * one. Access is the Salary page's: requireAdmin(), checked on the server
 * before anything is read. My Salary itself is unchanged.
 */
export default async function EmployeeSalaryReportPage({ params, searchParams }: PageProps) {
  await requireAdmin();
  const { employeeId } = await params;
  if (!UUID_RE.test(employeeId)) notFound();
  const employee = await getReportEmployee(employeeId);
  if (!employee) notFound();

  const sp = await searchParams;
  // The employee's own calendar decides "today" (as on My Salary), so the live day and the month bounds match theirs.
  const today = localDateString(employee.timezone || "Asia/Kolkata");
  const current = today.slice(0, 7);
  const raw = typeof sp.month === "string" ? sp.month : undefined;
  const month = raw && MONTH_RE.test(raw) && raw <= current ? raw : current;

  const [data, people] = await Promise.all([loadMySalary({ id: employee.id }, month, today), listReportEmployees()]);
  const title = monthTitle(month);
  const breakdown = data.run ? buildBreakdown(data.run) : null;
  const cards = data.attendance ? attendanceCards(data.attendance.summary) : null;
  const report = buildDailyReport(data.attendance?.days ?? [], data.year, data.monthNumber, today, data.run);

  const basePath = `/salary/employee/${employee.id}`;
  const hrefFor = (m: string) => (m === current ? basePath : `${basePath}?month=${m}`);
  const prev = shiftMonthKey(month, -1);
  const next = shiftMonthKey(month, 1);
  const selector = <SalaryMonthPicker key={month} month={month} min={data.bounds.earliest} max={data.bounds.latest} basePath={basePath} inputId="employee-salary-month" />;
  const action = (
    <RecalculateButton month={month} employeeId={employee.id} monthLabel={title} label="Recalculate salary" disabledReason={!data.profile.hasProfile ? `No salary profile (CTC) is set for ${employee.name}.` : undefined} />
  );

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="Employees ▸ Salary ▸ Employee report" fullWidth />
      <div style={{ background: PAGE_GROUND }}>
        <main className="w-full px-6 pt-5 pb-10 max-md:px-4 lg:px-8 grid grid-cols-[minmax(0,1fr)] gap-5" data-testid="employee-salary-main">
          <section
            aria-labelledby="emp-report-title"
            className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-2xl px-6 py-5 max-md:px-4"
            style={CARD}
          >
            <div className="min-w-0">
              <Link href={"/salary" as Route} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: SLATE }}>
                <ArrowLeft size={13} aria-hidden /> Salary
              </Link>
              <h1 id="emp-report-title" className="mt-1 text-[clamp(26px,2.6vw,32px)] font-extrabold leading-none tracking-[-0.02em]" style={{ color: NAVY }}>
                {employee.name}
                {employee.inactive && <span className="ml-2 align-middle text-[13px] font-bold" style={{ color: SLATE }}>(inactive)</span>}
              </h1>
              <p className="mt-1 text-[14.5px] font-medium" style={{ color: SLATE }}>
                Employee Salary Report · pay, deductions and day-by-day attendance for {title}.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3 max-md:w-full">
              <EmployeeReportPicker employees={people} selectedId={employee.id} month={month} />
              {action}
            </div>
          </section>

          <NetPayCard
            run={data.run}
            monthTitle={title}
            hasProfile={data.profile.hasProfile}
            designation={data.run?.designationName ?? data.profile.designationName}
            entity={data.run?.payingEntityName ?? data.profile.payingEntityName}
            stale={data.stale}
            selector={selector}
            subjectName={employee.name}
          />

          {breakdown && data.run && <BreakdownCard b={breakdown} source={data.run.source} subjectName={employee.name} />}

          <AttendanceSummaryCards a={cards} error={data.attendance === null} subjectName={employee.name} />

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
            <MonthCalendar
              days={data.attendance?.days ?? []}
              year={data.year}
              month={data.monthNumber}
              today={today}
              prevHref={prev >= data.bounds.earliest ? hrefFor(prev) : null}
              nextHref={next <= data.bounds.latest ? hrefFor(next) : null}
              todayHref={hrefFor(current)}
              error={data.attendance === null}
            />
            <SalaryHistoryCard history={data.history} current={month} basePath={basePath} subjectName={employee.name} />
          </div>

          {data.attendance && <DailySalaryReport report={report} hasRun={Boolean(data.run)} today={today} perDayPaise={breakdown?.detail.perDayPaise ?? null} />}
        </main>
      </div>
    </>
  );
}
