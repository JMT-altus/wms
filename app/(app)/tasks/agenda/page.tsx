import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { FilterBar } from "@/components/layout/filter-bar";
import { TaskSearchProvider } from "@/components/tasks/task-search-context";
import { MyDayWorkspace } from "@/components/tasks/my-day-workspace";
import { DailyCommitments } from "@/components/tasks/daily-commitments";
import { listPlanTasks, listDayPlan, type DayPlanTask, type PlanTask } from "@/lib/queries/my-day";
import { listWeeklyGoals } from "@/lib/queries/weekly-goals";
import { currentWeekStart } from "@/lib/weekly-goals/week";
import type { AgendaTask } from "@/components/tasks/agenda-board";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { listTasks, listDistinctSubjects } from "@/lib/queries/tasks";
import { listActiveClientNames } from "@/lib/queries/clients";
import { listActiveDepartmentNames } from "@/lib/queries/departments";
import { parseTaskFilters } from "@/lib/task-filters";
import { isDoneLate } from "@/lib/task-late";
import { requireUser } from "@/lib/auth/current";
import { getStatusDisplayMap } from "@/lib/queries/status-display";
import { TASK_STATUSES, isDeprecatedStatus } from "@/db/enums";
import type { TaskStatus, StatusColorToken } from "@/db/enums";

export const dynamic = "force-dynamic";

const TZ = "Asia/Kolkata";

/** yyyy-mm-dd for a Date in IST. */
function istYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgendaPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await requireUser();
  // "My Day" scopes to the signed-in user by default (admins too); the same
  // FilterBar as the Tasks tab can widen/redirect it from there.
  const filters = parseTaskFilters(sp, /*archived*/ false, { defaultDoerId: me.id });

  // Whose day the "Your Day Is Planned" view shows: admins may pick anyone
  // (?who=), everyone else always sees their own.
  const whoParam = typeof sp.who === "string" ? sp.who : undefined;

  const [allEmployees, rows, subjects, clients, departments, statusDisplay] = await Promise.all([
    listEmployeeOptions(),
    listTasks(filters),
    listDistinctSubjects(),
    listActiveClientNames(),
    listActiveDepartmentNames(),
    getStatusDisplayMap(),
  ]);

  const statusLabels = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<TaskStatus, string>;
  const statusTones = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.color]),
  ) as Record<TaskStatus, StatusColorToken>;

  // Daily Commitments filters (URL-driven): ?who= an employee id or "all" (admins),
  // ?day= the day whose plan to show (IST, defaults to today).
  const allPeople = me.isAdmin && whoParam === "all";
  const whoId =
    me.isAdmin && whoParam && allEmployees.some((e) => e.id === whoParam) ? whoParam : me.id;
  const todayStr = istYmd(new Date());
  const dayParam = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : todayStr;
  const [planTasks, weekGoals, dayPlanResult] = await Promise.all([
    // The Change Plan board edits one person's days, so it has nothing to load
    // for "all employees".
    allPeople ? Promise.resolve([] as PlanTask[]) : listPlanTasks(whoId),
    listWeeklyGoals({ employeeId: whoId, weekStart: currentWeekStart() }).catch(() => []),
    listDayPlan({ day: dayParam, employeeIds: allPeople ? [] : [whoId] }).catch((err) => {
      console.error("[daily-commitments] day plan failed:", err);
      return null;
    }),
  ]);
  const dayPlan: DayPlanTask[] = dayPlanResult ?? [];
  const planError = dayPlanResult === null;

  const employeeOptions = allEmployees.map((e) => ({ value: e.id, label: e.name }));

  const statusOptions = TASK_STATUSES.filter((s) => !isDeprecatedStatus(s)).map((s) => ({
    value: s,
    label: statusLabels[s] ?? s,
  }));

  // Agenda-card shape derived from the same filtered rows the List view uses,
  // so both views always agree. The board buckets these by IST due-day.
  const agendaTasks: AgendaTask[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    description: r.description,
    dueYmd: istYmd(r.dueAt),
    late: isDoneLate({ status: r.status, completedAt: r.completedAt, dueAt: r.dueAt }),
  }));

  const now = new Date();
  const todayYmd = istYmd(now);
  const days = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const ymd = istYmd(d);
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
    const sub = d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: TZ });
    return { ymd, label, sub };
  });

  const isoDay = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  return (
    <TaskSearchProvider>
      <DashboardHeader generatedAt={new Date()} title="WMS ▸ Daily Commitments" />
      <DailyCommitments
        people={allEmployees.map((e) => ({ id: e.id, name: e.name }))}
        selectedId={whoId}
        canPickPerson={me.isAdmin}
        canEdit={me.isAdmin}
        allPeople={allPeople}
        dayYmd={dayParam}
        dayPlan={dayPlan}
        planError={planError}
        statusLabels={statusLabels}
        todayYmd={todayStr}
        planTasks={planTasks}
        goals={weekGoals.map((g) => ({
          id: g.id,
          title: g.targetDone?.trim() || g.subject?.trim() || g.client?.trim() || "Goal",
          pctDone: g.pctDone,
        }))}
        review={
          <>
            <FilterBar
              wrap
              viewInHeader
              employees={employeeOptions}
              subjects={subjects}
              departments={departments}
              statusOptions={statusOptions}
              clients={clients}
              me={{ id: me.id, isAdmin: me.isAdmin }}
              assigneeMode={filters.assigneeMode}
              initial={{
                start:  isoDay(filters.startDate),
                end:    isoDay(filters.endDate),
                emp:    filters.doerIds,
                view:   "doer",
                dept:   filters.departments,
                prio:   filters.priorities,
                subj:   filters.subjects,
                status: filters.statuses,
                client: filters.clients,
              }}
            />
            <MyDayWorkspace
              firstName={me.name.split(" ")[0] ?? me.name}
              isAdmin={me.isAdmin}
              todayYmd={todayYmd}
              days={days}
              agendaTasks={agendaTasks}
              rows={rows}
              employees={allEmployees}
              me={{ id: me.id, isAdmin: me.isAdmin }}
              statusLabels={statusLabels}
              statusTones={statusTones}
            />
          </>
        }
      />
      {/* The footer's own top margin is trimmed for this page only. */}
      <div className="[&>footer]:mt-6">
        <DashboardFooter />
      </div>
    </TaskSearchProvider>
  );
}
