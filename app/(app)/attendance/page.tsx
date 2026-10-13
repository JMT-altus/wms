import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import {
  getEarliestAttendanceYear,
  loadAttendanceOverview,
  listUpcomingHolidays,
  type AttendanceOverviewData,
} from "@/lib/queries/attendance-overview";
import {
  greetingFor,
  monthRange,
  parseYearMonth,
  shiftMonth,
  yearOptions,
} from "@/lib/attendance/overview";
import type { HolidayRow } from "@/lib/queries/holidays";
import { AttendanceOverview } from "@/components/attendance/overview/kpi-cards";
import { MonthCalendar } from "@/components/attendance/overview/month-calendar";
import { PeriodSelect } from "@/components/attendance/overview/period-select";
import { UpcomingHolidays } from "@/components/attendance/overview/upcoming-holidays";
import { WelcomeHero } from "@/components/attendance/overview/welcome-hero";
import { PAGE_GROUND } from "@/components/attendance/overview/theme";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The employee Attendance page: a welcome banner, then the overview, the
 * monthly calendar and the upcoming holidays.
 *
 * ONE piece of state drives it all — the selected month and year, in the URL as
 * `?y=&m=`. The dropdowns write it, the calendar's arrows write it, and the
 * overview, the calendar and the dropdowns all read it back, so they cannot
 * disagree. Absent means "the current month".
 *
 * Punching, the personal punch log and the team table are deliberately not
 * here. Their components, server actions and APIs are untouched (the mobile
 * app and the admin dashboard use them); this page just doesn't show them.
 */

const DATE_BADGE_FMT = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-06-10" → "Wed, 10 Jun 2026" without timezone drift. */
function labelForDate(date: string): string {
  return DATE_BADGE_FMT.format(new Date(`${date}T12:00:00Z`));
}

const RANGE_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const RANGE_YEAR_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "1 Oct – 9 Oct 2026": the dates the KPI figures cover. */
function rangeLabel(r: { start: string; end: string }): string {
  const at = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
  const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
  const start = (sameYear ? RANGE_FMT : RANGE_YEAR_FMT).format(at(r.start));
  return r.start === r.end
    ? RANGE_YEAR_FMT.format(at(r.end))
    : `${start} – ${RANGE_YEAR_FMT.format(at(r.end))}`;
}

export default async function AttendancePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await requireUser();
  const tz = me.timezone || "Asia/Kolkata";
  const today = localDateString(tz);

  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const { year: calYear, month: calMonth } = parseYearMonth(sp.y, sp.m, today);

  // The link for a month; the current month is the default, so it is no query.
  const hrefFor = (y: number, m: number): string =>
    y === ty && m === tm ? "/attendance" : `/attendance?y=${y}&m=${m}`;

  // Each degrades to an inline message rather than taking the page down. The
  // overview is always about MY id — never one taken from the URL.
  const [overview, holidays, earliestYear] = await Promise.all([
    loadAttendanceOverview({
      employeeId: me.id,
      today,
      year: calYear,
      month: calMonth,
    }).catch((err): AttendanceOverviewData | null => {
      console.error("[attendance] overview load failed", err);
      return null;
    }),
    listUpcomingHolidays(today).catch((err): HolidayRow[] | null => {
      console.error("[attendance] holidays load failed", err);
      return null;
    }),
    getEarliestAttendanceYear(me.id).catch((err): number | null => {
      console.error("[attendance] earliest year lookup failed", err);
      return null;
    }),
  ]);

  const years = yearOptions(earliestYear, ty, calYear);
  const oldestYear = years[years.length - 1]!;

  // The arrows stop where the dropdowns do: January of the first year on
  // record, December of this year.
  const prev = shiftMonth(calYear, calMonth, -1);
  const next = shiftMonth(calYear, calMonth, 1);
  const prevHref = prev.year < oldestYear ? null : hrefFor(prev.year, prev.month);
  const nextHref = next.year > ty ? null : hrefFor(next.year, next.month);

  const range = monthRange(calYear, calMonth, today);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <div style={{ background: PAGE_GROUND }}>
        <main className="mx-auto max-w-[1200px] px-8 max-md:px-4 pt-7 pb-10 max-md:pb-8 grid gap-6">
          {/* A. Welcome — light, no surface of its own */}
          <div className="att-rise" style={{ ["--att-delay" as string]: "0ms" }}>
            <WelcomeHero
              greeting={greetingFor(me.name)}
              subtitle="Your attendance, working hours and monthly summary at a glance."
              dateLabel={labelForDate(today)}
            />
          </div>

          {/* B. Attendance Overview */}
          <div className="att-rise" style={{ ["--att-delay" as string]: "60ms" }}>
            <AttendanceOverview
              kpis={overview?.kpis ?? null}
              selector={
                // Keyed by the month so it resets itself when the URL moves
                // some other way — the calendar's arrows, say.
                <PeriodSelect
                  key={`${calYear}-${calMonth}`}
                  year={calYear}
                  month={calMonth}
                  years={years}
                  currentYear={ty}
                  currentMonth={tm}
                />
              }
              rangeLabel={range.end >= range.start ? rangeLabel(range) : undefined}
              notStarted={range.end < range.start}
              error={overview === null}
            />
          </div>

          {/* C + D. Calendar, then holidays — side by side on a wide screen,
              stacked (calendar first) everywhere else. */}
          <div
            className="att-rise grid gap-6 items-start lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]"
            style={{ ["--att-delay" as string]: "120ms" }}
          >
            <MonthCalendar
              days={overview?.days ?? []}
              year={calYear}
              month={calMonth}
              today={today}
              prevHref={prevHref}
              nextHref={nextHref}
              todayHref={hrefFor(ty, tm)}
              error={overview === null}
            />
            <UpcomingHolidays holidays={holidays ?? []} today={today} error={holidays === null} />
          </div>
        </main>
      </div>
      {/* The shared footer carries its own 8rem top margin, which sits OUTSIDE
          the ground above and shows the app wallpaper as a blank band. The page
          now ends where its content does, so the margin is dropped here — for
          this page only, without touching the footer every other page uses. */}
      <div className="[&>footer]:mt-0">
        <DashboardFooter />
      </div>
    </>
  );
}
