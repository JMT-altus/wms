import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import { loadMySalary } from "@/lib/salary/my-salary";
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

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const PATH = "/my-salary";

/**
 * My Salary — the signed-in employee's own pay for one month: net pay and
 * payment state, how it was calculated, the attendance it rests on (counts,
 * calendar, day-by-day report) and the history of months. Every figure is the
 * server's: the employee is the verified session's and never an id from the
 * URL; the month is the only input (`?month=YYYY-MM`), clamped to the months
 * on record. Recalculating is HR's act, so that button appears for
 * administrators only (the action checks again).
 */
export default async function MySalaryPage({ searchParams }: PageProps) {
  const me = await requireUser();
  const sp = await searchParams;
  const today = localDateString(me.timezone || "Asia/Kolkata");
  const current = today.slice(0, 7);
  const raw = typeof sp.month === "string" ? sp.month : undefined;
  const month = raw && MONTH_RE.test(raw) && raw <= current ? raw : current;

  const data = await loadMySalary(me, month, today);
  const title = monthTitle(month);
  const breakdown = data.run ? buildBreakdown(data.run) : null;
  const cards = data.attendance ? attendanceCards(data.attendance.summary) : null;
  const report = buildDailyReport(data.attendance?.days ?? [], data.year, data.monthNumber, today, data.run);

  const hrefFor = (m: string) => (m === current ? PATH : `${PATH}?month=${m}`);
  const prev = shiftMonthKey(month, -1);
  const next = shiftMonthKey(month, 1);
  const selector = <SalaryMonthPicker key={month} month={month} min={data.bounds.earliest} max={data.bounds.latest} />;
  const action = me.isAdmin ? (
    <RecalculateButton month={month} employeeId={me.id} monthLabel={title} disabledReason={!data.profile.hasProfile ? "No salary profile (CTC) is set for your login." : undefined} />
  ) : undefined;

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="Employees ▸ My Salary" fullWidth />
      <div style={{ background: PAGE_GROUND }}>
        {/* Full width: the page uses everything after the sidebar, with responsive gutters and no centred cap. */}
        <main className="w-full px-6 pt-5 pb-10 max-md:px-4 lg:px-8 grid grid-cols-[minmax(0,1fr)] gap-5" data-testid="my-salary-main">
          {/* The title panel: heading and subtitle on the left, the (admin-only) recalculate action on the right — the same card as /salary. */}
          <section
            aria-labelledby="my-salary-title"
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl px-6 py-5 max-md:px-4"
            style={CARD}
            data-testid="my-salary-title-panel"
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 id="my-salary-title" className="text-[clamp(26px,2.6vw,32px)] font-extrabold leading-none tracking-[-0.02em]" style={{ color: NAVY }}>
                My Salary
              </h1>
              <p className="text-[14.5px] font-medium" style={{ color: SLATE }}>
                Your monthly pay, deductions and attendance — visible only to you.
              </p>
            </div>
            {action && <div className="flex justify-end max-md:w-full">{action}</div>}
          </section>

          <NetPayCard
            run={data.run}
            monthTitle={title}
            hasProfile={data.profile.hasProfile}
            designation={data.run?.designationName ?? data.profile.designationName}
            entity={data.run?.payingEntityName ?? data.profile.payingEntityName}
            stale={data.stale}
            selector={selector}
          />

          {breakdown && data.run && <BreakdownCard b={breakdown} source={data.run.source} />}

          <AttendanceSummaryCards a={cards} error={data.attendance === null} />

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
            <SalaryHistoryCard history={data.history} current={month} />
          </div>

          {data.attendance && <DailySalaryReport report={report} hasRun={Boolean(data.run)} today={today} perDayPaise={breakdown?.detail.perDayPaise ?? null} />}
        </main>
      </div>
      <div className="[&>footer]:mt-0">
        <DashboardFooter />
      </div>
    </>
  );
}
