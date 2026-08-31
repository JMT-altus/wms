import "server-only";
import { notFound } from "next/navigation";
import { TaskDetailView } from "@/components/tasks/task-detail-view";
import { getTaskById } from "@/lib/queries/tasks";
import { listTaskEvents } from "@/lib/queries/audit";
import { listEmployees } from "@/lib/queries/employees";
import { listActiveClientNames } from "@/lib/queries/clients";
import { listActiveSubjectNames } from "@/lib/queries/subjects";
import { listProjectNodeOptions } from "@/lib/queries/projects";
import { listActiveDepartments } from "@/lib/queries/departments";
import { listTaskAttachments, getTaskAudience } from "@/lib/queries/task-attachments";
import { getStatusDisplayMap, getStatusList } from "@/lib/queries/status-display";
import type { TaskStatus, StatusColorToken } from "@/db/enums";
import {
  canEditTaskFields,
  canApprove,
  canReassign,
  canComment,
} from "@/lib/auth/task-permissions";

interface Props {
  taskId: string;
  me: {
    id: string;
    name: string;
    avatarUrl: string | null;
    department: string | null;
    isAdmin: boolean;
  };
}

/**
 * Async server component that owns the entire task-detail data fan-out.
 *
 * Lives behind a `<Suspense>` boundary on the page so the dashboard
 * header/footer paint instantly; this component awaits the seven queries
 * (one per-task `getTaskById` + six picker payloads, of which five are
 * already cached as of Phase 1.1) and streams the rendered TaskDetailView
 * once they all settle. Cold task open goes from "blank page for ~2s
 * then full render" to "shell + skeleton instantly, content fills in".
 */
export async function TaskDetailLoader({ taskId, me }: Props) {
  const task = await getTaskById(taskId);
  if (!task) notFound();

  const [
    events,
    all,
    statusDisplay,
    statusList,
    clients,
    subjects,
    projectNodes,
    attachments,
    audience,
    departmentRows,
  ] = await Promise.all([
    listTaskEvents(taskId),
    listEmployees(),
    getStatusDisplayMap(),
    getStatusList(),
    listActiveClientNames(),
    listActiveSubjectNames(),
    listProjectNodeOptions(),
    listTaskAttachments(taskId),
    // Only a restricted task has a named audience; the query is cheap enough
    // that branching on visibility here would cost more than it saves.
    getTaskAudience(taskId),
    listActiveDepartments(),
  ]);
  // Active statuses in the admin's display order — drives the picker's options
  // (hidden ones drop out, reordering reflects here too).
  const pickerOrder = statusList.filter((s) => s.active).map((s) => s.status);
  const employeeOptions = all.map((e) => ({ id: e.id, name: e.name }));
  const statusLabels = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<TaskStatus, string>;
  const statusTones = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.color]),
  ) as Record<TaskStatus, StatusColorToken>;

  const permInput = {
    employee: { id: me.id, isAdmin: me.isAdmin },
    task: {
      createdById: task.createdById,
      initiatorId: task.initiatorId,
      doerId: task.doerId,
      status: task.status,
    },
  };

  // Workflow-gated visibility for Approve/Decline. The matrix lets admins
  // jump from any status to "approved" via override, which surfaces those
  // cards on a "Not Started" task — misleading. Restrict the CTA to the
  // moment it's meaningful (doer has marked work done). Admins keep the
  // override at the server level if they ever need to force a verdict.
  const isDoersManager = !!task.doerManagerId && task.doerManagerId === me.id;
  const showApproveCard =
    canApprove({ ...permInput, isDoersManager }) && task.status === "done";

  return (
    <TaskDetailView
      task={task}
      canEdit={canEditTaskFields(permInput)}
      canApproveTask={showApproveCard}
      canReassignTask={canReassign(permInput)}
      canCommentOnTask={canComment(permInput)}
      events={events}
      employees={employeeOptions}
      clients={clients}
      subjects={subjects}
      projectNodes={projectNodes}
      attachments={attachments}
      audience={audience}
      departments={departmentRows.map((d) => ({ id: d.id, name: d.name }))}
      // Mirrors the rule inside `setTaskVisibility`: someone ON the task, or
      // an admin. Widening is a disclosure and narrowing can hide the task
      // from the person doing the work, so it stays a deliberate act — but
      // admins already see every task, and locking them out meant nobody
      // could re-scope a task they were not personally on.
      canChangeVisibility={
        me.isAdmin ||
        task.doerId === me.id ||
        task.initiatorId === me.id ||
        task.createdById === me.id
      }
      me={me}
      statusLabels={statusLabels}
      statusTones={statusTones}
      pickerOrder={pickerOrder}
    />
  );
}
