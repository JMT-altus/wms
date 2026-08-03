import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { FilterBar } from "@/components/layout/filter-bar";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { listBoardTasks, listDistinctSubjects, getTaskById } from "@/lib/queries/tasks";
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

  const [tasks, statusDisplay, employees, org, subjects, clients, departments] = await Promise.all([
    listBoardTasks(filters),
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
    <>
      <DashboardHeader generatedAt={new Date()} />
      <FilterBar
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
          <header className="relative mb-6 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1
                className="text-ink-strong"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontWeight: 500,
                  fontSize: 40,
                  letterSpacing: "-0.02em",
                }}
              >
                Kanban
              </h1>
              <p className="mt-1.5 text-ink-soft" style={{ fontSize: 15.5 }}>
                Drag a task between columns to change its status.
                {me.isAdmin ? " Drag a column header to reorder the board." : ""}
              </p>
            </div>
            <Link
              href={"/tasks" as Route}
              className="text-[14px] font-semibold text-ink-soft hover:text-ink-strong transition-colors"
            >
              List View →
            </Link>
          </header>
          <div className="relative">
            <KanbanBoard
              tasks={tasks}
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
    </>
  );
}
