import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { FilterBar } from "@/components/layout/filter-bar";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { StatusTable } from "@/components/dashboard/status-table";
import { StatusDistributionChart } from "@/components/dashboard/status-distribution";
import { TopPerformersSection } from "@/components/dashboard/top-performers";
import { AgingHeatmap } from "@/components/dashboard/aging-heatmap";
import { WelcomeHero } from "@/components/dashboard/welcome-hero";
import { MyDayCard } from "@/components/dashboard/my-day-card";
import { DashboardLoadError } from "@/components/dashboard/dashboard-load-error";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { WeeklyGoalsBand } from "@/components/dashboard/weekly-goals-band";
import { listWeeklyGoals } from "@/lib/queries/weekly-goals";
import { currentWeekStart } from "@/lib/weekly-goals/week";
import { listEmployees } from "@/lib/queries/employees";
import { listDistinctSubjects } from "@/lib/queries/tasks";
import { listActiveDepartmentNames } from "@/lib/queries/departments";
import { loadDashboardData } from "@/lib/queries/dashboard";
import { getStatusDisplayMap } from "@/lib/queries/status-display";
import { getMyDayCounts, getMyTodayTasks } from "@/lib/queries/my-day";
import { MobileToday } from "@/components/dashboard/mobile-today";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { parseFilters } from "@/lib/filters";
import type { TaskStatus, StatusColorToken } from "@/db/enums";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const me = await getCurrentEmployee().catch(() => null);

  // Mobile home: phones open on "Today" (the user's overdue + due-today
  // tasks, priority-first) instead of the company dashboard. `?full=1`
  // opts back into the full dashboard on mobile; desktop is unaffected.
  const showFullOnMobile = sp.full === "1";

  // Resilience: the dashboard fires many queries against a remote DB. A
  // single transient timeout must NOT crash the whole page. My Day
  // degrades to hidden (.catch → null); a core-data failure renders a
  // friendly Retry panel instead of the global "we hit a snag" boundary.
  let allEmployees: Awaited<ReturnType<typeof listEmployees>>;
  let data: Awaited<ReturnType<typeof loadDashboardData>>;
  let statusDisplay: Awaited<ReturnType<typeof getStatusDisplayMap>>;
  let myDay: Awaited<ReturnType<typeof getMyDayCounts>> | null;
  let todayTasks: Awaited<ReturnType<typeof getMyTodayTasks>> | null;
  let subjects: string[];
  let departments: string[];
  // This week's goals for the signed-in user. Degrades to an empty band on
  // failure — the dashboard must not die for a decorative strip.
  const weekGoals = me
    ? await listWeeklyGoals({ employeeId: me.id, weekStart: currentWeekStart() }).catch(
        () => [],
      )
    : [];
  try {
    [allEmployees, data, statusDisplay, myDay, todayTasks, subjects, departments] = await Promise.all([
      listEmployees(),
      loadDashboardData(filters),
      getStatusDisplayMap(),
      me ? getMyDayCounts(me.id).catch(() => null) : Promise.resolve(null),
      // Mobile "Today" home list — degrades to null (mobile falls back to
      // the full dashboard) rather than crashing the page.
      me ? getMyTodayTasks(me.id).catch(() => null) : Promise.resolve(null),
      // Auxiliary (only powers the Subject filter chip) — must NEVER take down
      // the whole dashboard, so it degrades to an empty list on failure.
      listDistinctSubjects().catch(() => [] as string[]),
      // Ditto for the Department chip — auxiliary, never fatal.
      listActiveDepartmentNames().catch(() => [] as string[]),
    ]);
  } catch (err) {
    console.error("[dashboard] data load failed:", err);
    return (
      <>
        <DashboardHeader generatedAt={new Date()} />
        <main>
          <DashboardLoadError />
        </main>
        <DashboardFooter />
      </>
    );
  }

  const statusLabels = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<TaskStatus, string>;
  const statusTones = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.color]),
  ) as Record<TaskStatus, StatusColorToken>;

  const isEmpty =
    allEmployees.length === 0 && data.statusTable.length === 0;

  const employeeOptions = allEmployees.map((e) => ({
    value: e.id,
    label: e.name,
  }));
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);

  // The mobile Today home replaces the dashboard on phones only when its
  // data actually loaded — on a query failure phones fall back to the
  // regular dashboard rather than a blank screen.
  const mobileToday = !isEmpty && !showFullOnMobile && me && todayTasks ? todayTasks : null;

  return (
    <>
      <DashboardHeader generatedAt={data.generatedAt} />
      {/* No wrapper <div> here — the bar is `position: sticky`, and a wrapper
          sized to it leaves it nowhere to travel, so it scrolls straight away.
          The responsive hide rides on the bar's own root via `className`. */}
      <FilterBar
        className={mobileToday ? "max-md:hidden" : undefined}
        employees={employeeOptions}
        subjects={subjects}
        departments={departments}
        initial={{
          start: isoDay(filters.startDate ?? new Date()),
          end:   isoDay(filters.endDate   ?? new Date()),
          emp:   filters.employeeIds,
          view:  filters.view,
          dept:  filters.departments,
          prio:  filters.priorities,
          subj:  filters.subjects,
        }}
      />
      <main>
        {isEmpty ? (
          <WelcomeHero />
        ) : (
          <>
            {mobileToday && me && (
              <div className="md:hidden">
                <MobileToday
                  firstName={me.name.split(" ")[0] ?? me.name}
                  tasks={mobileToday}
                  doneToday={myDay?.doneToday ?? 0}
                  statusLabels={statusLabels}
                  statusTones={statusTones}
                  canPunch={await canAccessModule("employees")}
                />
              </div>
            )}
            <div className={mobileToday ? "max-md:hidden" : undefined}>
              {/* Section rail — grows as the remaining analytics sections land.
                  Only sections that actually render are listed; a tab that
                  scrolls nowhere is worse than no tab. */}
              <DashboardTabs
                tabs={[
                  { id: "task-summary", label: "Task Summary" },
                  { id: "status-distribution", label: "Status Mix" },
                  { id: "top-performers", label: "Top Performers" },
                  { id: "status-by-doer", label: "Status by Doer" },
                  { id: "aging-heatmap", label: "Aging Heatmap" },
                ]}
              />
              <WeeklyGoalsBand
                goals={weekGoals.map((g) => ({
                  id: g.id,
                  targetDone: g.targetDone,
                  priority: g.priority,
                  pctDone: g.pctDone,
                }))}
              />
              {me && myDay && (
                <MyDayCard
                  firstName={me.name.split(" ")[0] ?? me.name}
                  counts={myDay}
                />
              )}
              <KpiStrip
                kpis={data.kpis}
                summary={data.wmsSummary}
                velocity={data.velocity}
              />
              <div
                id="status-distribution"
                className="mx-auto mt-12 max-w-[1600px] scroll-mt-[190px] px-12 max-md:px-4"
              >
                <StatusDistributionChart
                  data={data.statusDistribution}
                  labels={statusLabels}
                  tones={statusTones}
                  isAdmin={Boolean(me?.isAdmin)}
                />
              </div>
              {/* Full width, and carrying its own header + anchor: the podium
                  and the ranked list need the room to sit side by side. */}
              <TopPerformersSection performers={data.topPerformers} />
              {/* The section carries its own anchor id and header. */}
              <StatusTable rows={data.statusTable} view={filters.view} />
              <div id="aging-heatmap" className="scroll-mt-[190px]">
                <AgingHeatmap
                  rows={data.agingTable}
                  cellTasks={data.agingHeatmapData.byCell}
                  hiddenCells={data.agingHeatmapData.hiddenByCell}
                />
              </div>
            </div>
          </>
        )}
      </main>
      <DashboardFooter />
    </>
  );
}
