import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { FilterBar } from "@/components/layout/filter-bar";
import { TaskSearchProvider } from "@/components/tasks/task-search-context";
import { TaskListPage, isUnreadPending } from "@/components/tasks/task-list-page";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { listTasks, listDistinctSubjects, countUnassignedTasks, getTaskById } from "@/lib/queries/tasks";
import { listActiveClientNames } from "@/lib/queries/clients";
import { listActiveDepartmentNames } from "@/lib/queries/departments";
import { parseTaskFilters } from "@/lib/task-filters";
import { requireUser } from "@/lib/auth/current";
import { canQuickDump } from "@/lib/auth/quick-dump";
import { CompleteTaskModal } from "@/components/tasks/complete-task-modal";
import Link from "next/link";
import type { Route } from "next";
import { Inbox, ArrowLeft } from "lucide-react";
import { getStatusDisplayMap } from "@/lib/queries/status-display";
import { TASK_STATUSES, APPROVAL_STATUSES, isDeprecatedStatus } from "@/db/enums";
import type { TaskStatus, StatusColorToken } from "@/db/enums";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TasksPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await requireUser();
  // Non-admins default to "assigned to me" when no explicit ?emp= is set.
  const filters = parseTaskFilters(sp, /*archived*/ false, {
    defaultDoerId: me.isAdmin ? undefined : me.id,
  });

  const [allEmployees, rows, subjects, clients, departments, statusDisplay, unassignedCount] = await Promise.all([
    listEmployeeOptions(),
    listTasks(filters),
    listDistinctSubjects(),
    listActiveClientNames(),
    listActiveDepartmentNames(),
    getStatusDisplayMap(),
    // The pool is admins-only to triage; skip the count for everyone else.
    me.isAdmin ? countUnassignedTasks() : Promise.resolve(0),
  ]);
  const inPool = filters.assigneeMode === "unassigned";

  // "Not read" summary pill (?unread=1): narrows the loaded rows to open tasks
  // the doer has not opened yet — the same definition as the pill's count.
  const unreadOnly = sp.unread === "1";
  const shownRows = unreadOnly ? rows.filter(isUnreadPending) : rows;

  // "Complete task" overlay — opened by clicking an unassigned task (?complete=<id>).
  const completeId = typeof sp.complete === "string" ? sp.complete : undefined;
  const canComplete = me.isAdmin || canQuickDump(me.email);
  const completeTask = completeId && canComplete ? await getTaskById(completeId) : null;

  const statusLabels = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<TaskStatus, string>;
  const statusTones = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.color]),
  ) as Record<TaskStatus, StatusColorToken>;

  const employeeOptions = allEmployees.map((e) => ({
    value: e.id,
    label: e.name,
  }));

  // Status filter options in canonical workflow order, carrying the
  // admin-overridable human labels. Retired statuses (follow_up_1/2/3,
  // cancelled, transferred) are dropped from the picker — see sir's changes
  // #2/#4/#6 — but approved/not_approved stay so the KPI links still filter.
  const statusOptions: { value: string; label: string }[] = [
    ...TASK_STATUSES.filter((s) => !isDeprecatedStatus(s)).map((s) => ({
      value: s as string,
      label: statusLabels[s] ?? s,
    })),
    // Pseudo-status: selecting it shows archived tasks (handled in
    // parseTaskFilters → filters.archived). Lets you reach the Archive from the
    // main Tasks list without leaving for the dedicated /archived page.
    { value: "archived", label: "Archived" },
  ];

  // Initiator Status options — the same four verdicts the column offers.
  const APPROVAL_LABELS = {
    approved: "Approved",
    not_approved: "Not Approved",
    cancelled: "Cancelled",
    transferred: "Transferred",
  } as const;
  const approvalOptions = APPROVAL_STATUSES.map((s) => ({ value: s as string, label: APPROVAL_LABELS[s] }));

  const isoDay = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  return (
    <TaskSearchProvider>
      <DashboardHeader generatedAt={new Date()} title="WMS · Tasks" />
      <FilterBar
        wrap
        viewInHeader
        compactActions
        className="fb-badge-chips fb-tight"
        employees={employeeOptions}
        subjects={subjects}
        departments={departments}
        statusOptions={statusOptions}
        statusLabel="All Doer Status"
        approvalOptions={approvalOptions}
        showDue
        hideReset
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
          // Reflect the Archived pseudo-chip back into the picker when active.
          status: filters.archived ? [...filters.statuses, "archived"] : filters.statuses,
          client: filters.clients,
          due:    filters.dueBucket ?? "",
          approval: filters.approvals ?? [],
        }}
      />
      {/* Unassigned pool — entry pill (normal view) or a "you're in the pool"
          banner with a way back. Admins only. */}
      {me.isAdmin && inPool && (
        <div className="w-full px-8 max-md:px-4 pt-3">
          {inPool ? (
            <div
              className="flex items-center justify-between gap-3 flex-wrap rounded-chip px-4 py-2.5"
              style={{
                background: "color-mix(in srgb, var(--color-amber) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-amber) 34%, transparent)",
              }}
            >
              <span className="inline-flex items-center gap-2 text-[14.5px] font-bold" style={{ color: "var(--color-amber-deep)" }}>
                <Inbox size={16} strokeWidth={2.4} />
                Unassigned pool — {unassignedCount} {unassignedCount === 1 ? "task" : "tasks"}. Set a doer to assign.
              </span>
              <Link
                href={"/tasks" as Route}
                className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-soft hover:text-ink-strong"
              >
                <ArrowLeft size={15} strokeWidth={2.4} />
                Back to all tasks
              </Link>
            </div>
          ) : null}
        </div>
      )}
      <TaskListPage
        compact
        colorStrip
        title="Tasks"
        rows={shownRows}
        unreadOnly={unreadOnly}
        filters={filters}
        employees={allEmployees}
        me={{ id: me.id, isAdmin: me.isAdmin }}
        statusLabels={statusLabels}
        statusTones={statusTones}
        subjects={subjects}
        clients={clients}
      />
      <div className="[&>footer]:mt-6">
        <DashboardFooter />
      </div>
      {completeTask && (
        <CompleteTaskModal
          taskId={completeTask.id}
          employees={allEmployees}
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
