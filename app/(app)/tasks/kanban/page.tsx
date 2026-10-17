import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { FilterBar } from "@/components/layout/filter-bar";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { listBoardTasks, listDistinctSubjects, getTaskById } from "@/lib/queries/tasks";
import { listBoardGoals } from "@/lib/queries/weekly-goals";
import { TaskSearchProvider } from "@/components/tasks/task-search-context";
import { istYmd } from "@/lib/weekly-goals/week";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { listActiveClientNames } from "@/lib/queries/clients";
import { listActiveDepartmentNames } from "@/lib/queries/departments";
import { getStatusDisplayMap } from "@/lib/queries/status-display";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { parseTaskFilters } from "@/lib/task-filters";
import { requireUser } from "@/lib/auth/current";
import { canQuickDump } from "@/lib/auth/quick-dump";
import { CompleteTaskModal } from "@/components/tasks/complete-task-modal";
import {
  resolveAdminColumnOrder,
  USER_COLUMN_ORDER,
} from "@/lib/kanban-columns";
import { TASK_STATUSES, isDeprecatedStatus } from "@/db/enums";
import type { TaskStatus, StatusColorToken } from "@/db/enums";
import Link from "next/link";
import type { Route } from "next";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function KanbanPage({ searchParams }: PageProps) {
  const me = await requireUser();

  const sp = await searchParams;
  // Non-admins default to "assigned to me" when no explicit ?emp= is set —
  // same scoping as the Tasks list, so a doer lands on their own board.
  const filters = parseTaskFilters(sp, /*archived*/ false, {
    defaultDoerId: me.isAdmin ? undefined : me.id,
  });

  const [tasks, goals, statusDisplay, employees, org, subjects, clients, departments] = await Promise.all([
    listBoardTasks(filters),
    // Non-admins see only their own goals — the same lock the weekly-goals
    // planner applies.
    listBoardGoals(filters, me.isAdmin ? undefined : me.id),
    getStatusDisplayMap(),
    listEmployeeOptions(),
    getOrgSettings(),
    listDistinctSubjects(),
    listActiveClientNames(),
    listActiveDepartmentNames(),
  ]);
  const labels = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<TaskStatus, string>;
  const tones = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.color]),
  ) as Record<TaskStatus, StatusColorToken>;

  // Admins see the admin-configurable order; everyone else the curated list.
  const columnOrder = me.isAdmin
    ? resolveAdminColumnOrder(org.boardColumnOrder)
    : USER_COLUMN_ORDER;

  // "Complete task" overlay — opened by clicking an unassigned pool card.
  const completeId = typeof sp.complete === "string" ? sp.complete : undefined;
  const canComplete = me.isAdmin || canQuickDump(me.email);
  const completeTask = completeId && canComplete ? await getTaskById(completeId) : null;

  const employeeOptions = employees.map((e) => ({ value: e.id, label: e.name }));
  const statusOptions = TASK_STATUSES.filter((s) => !isDeprecatedStatus(s)).map((s) => ({
    value: s,
    label: labels[s] ?? s,
  }));
  const isoDay = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  return (
    <TaskSearchProvider>
      <DashboardHeader generatedAt={new Date()} title="WMS · Kanban" />
      <FilterBar
        wrap
        showView={false}
        searchPlaceholder="Search Kanban..."

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
      <main className="wms-fill w-full px-4 max-md:px-3 pt-3 pb-3">
        {/* Light canvas (sir's changes #1) — full-bleed (no centred max-width
            gutters), clean white surface; status colour lives in the columns. */}
        <section
          className="relative overflow-hidden rounded-section border border-hairline-strong p-3 max-md:p-2.5"
          style={{ background: "#ffffff", boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -16px rgba(15, 23, 42, 0.16)" }}
        >
          {/* Brand rule across the top edge of the board panel — the same
              signature the other module panels wear. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{ background: "var(--color-altus-red)" }}
          />
          <header className="relative mb-2 flex items-center justify-between gap-4">
            {/* A level-1 heading on a div, on purpose: globals.css sizes every <h1> at
                30–46px with !important, so no inline size can shrink it. The role keeps
                it the page's h1. */}
            <div
              role="heading"
              aria-level={1}
              className="min-w-0 flex-1 text-left text-ink-strong"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontWeight: 800,
                fontSize: 21,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              Kanban View
            </div>
            <Link
              href={"/tasks" as Route}
              className="shrink-0 rounded-lg border border-hairline-strong bg-white px-3.5 h-8 inline-flex items-center text-[13px] font-semibold text-ink-soft transition-colors hover:border-[#9fb2d1] hover:text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14336B]"
            >
              List View →
            </Link>
          </header>
          <div className="relative">
            <KanbanBoard
              tasks={tasks}
              goals={goals}
              today={istYmd(new Date())}
              labels={labels}
              tones={tones}
              isAdmin={me.isAdmin}
              columnOrder={columnOrder}
            />
          </div>
        </section>
      </main>
      <div className="[&>footer]:mt-6">
        <DashboardFooter />
      </div>
      {completeTask && (
        <CompleteTaskModal
          taskId={completeTask.id}
          employees={employees}
          clients={clients}
          subjects={subjects}
          defaults={{
            taskTitle: completeTask.title, // the quick-dump text, editable
            title: completeTask.client ?? undefined, // Client Name (blank for pool tasks)
            initiatorId: completeTask.initiatorId,
            doerId: completeTask.doerId ?? undefined,
            priority: completeTask.priority,
            subject: completeTask.subject ?? undefined,
            description: completeTask.description ?? undefined,
            dueAt: completeTask.dueAt ? completeTask.dueAt.toISOString().slice(0, 10) : undefined,
          }}
        />
      )}
    </TaskSearchProvider>
  );
}
