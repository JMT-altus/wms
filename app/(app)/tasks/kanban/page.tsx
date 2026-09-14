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
      <DashboardHeader generatedAt={new Date()} />
      <FilterBar
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
      <main className="w-full px-6 max-md:px-4 pt-6 pb-10">
        {/* Light canvas (sir's changes #1) — full-bleed (no centred max-width
            gutters), clean white surface; status colour lives in the columns. */}
        <section
          className="relative overflow-hidden rounded-section border border-hairline p-5 max-md:p-4"
          style={{ background: "var(--color-surface-card)" }}
        >
          {/* Brand rule across the top edge of the board panel — the same
              signature the other module panels wear. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "var(--color-altus-red)" }}
          />
          <header className="relative mb-6 flex items-center justify-between gap-4">
            {/* Spacer, so the title is centred against the button opposite. */}
            <span aria-hidden className="w-[132px] shrink-0 max-md:hidden" />
            <h1
              className="min-w-0 flex-1 text-center text-ink-strong max-md:text-left"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 700,
                fontSize: 40,
                letterSpacing: "-0.02em",
              }}
            >
              Kanban View
            </h1>
            <Link
              href={"/tasks" as Route}
              className="shrink-0 rounded-[10px] border border-hairline-strong bg-white px-4 py-2.5 text-[14px] font-semibold text-ink-soft transition-colors hover:border-altus-red hover:text-ink-strong"
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
      <DashboardFooter />
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
