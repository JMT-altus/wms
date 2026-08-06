import type { Task } from "@/db/schema";
import type { KpiTotals, StatusDistribution } from "@/lib/types";
import { TASK_STATUSES, type TaskStatus } from "@/db/enums";

export function computeKpiTotals(tasks: Task[]): KpiTotals {
  let pending = 0;
  let notStarted = 0;
  let needHelp = 0;
  let done = 0;
  let notApproved = 0;

  for (const t of tasks) {
    // Done bucket: legacy `done`/`approved` lifecycle values OR new
    // approval_status="approved" verdict (any status).
    if (
      t.status === "done" ||
      t.status === "approved" ||
      t.approvalStatus === "approved"
    ) {
      done++;
      continue;
    }
    // Not-approved bucket: legacy status value OR new approval_status.
    if (t.status === "not_approved" || t.approvalStatus === "not_approved") {
      notApproved++;
      continue;
    }
    if (t.status === "not_started") notStarted++;
    else if (t.status === "need_info") needHelp++; // need_help retired → need_info
    else if (
      t.status === "initiated" ||
      t.status === "follow_up" ||
      t.status === "follow_up_1" ||
      t.status === "follow_up_2" ||
      t.status === "follow_up_3"
    ) {
      pending++;
    }
  }

  return {
    total: tasks.length,
    pending,
    notStarted,
    needHelp,
    done,
    notApproved,
  };
}

/**
 * A task's status spans two columns: the working `status` and the admin
 * `approval_status` verdict. Everywhere else in the app an approval verdict
 * wins — the KPI totals above, and the task-list filter (see
 * APPROVAL_VERDICTS in lib/queries/tasks.ts). The distribution has to agree,
 * or the same task reads "Done" in one panel and "Not Approved" in another.
 *
 * Only the approved / not_approved verdicts are folded in. `cancelled` and
 * `transferred` are retired values (DEPRECATED_TASK_STATUSES); mapping onto
 * them would move a task into a bucket nothing renders, and the counts would
 * silently stop summing to the total.
 */
function effectiveStatus(t: Task): TaskStatus {
  if (t.approvalStatus === "approved" || t.approvalStatus === "not_approved") {
    return t.approvalStatus;
  }
  return t.status;
}

/**
 * Counts per status. Zero-count statuses are RETAINED so the dashboard grid is
 * the full, stable set of live statuses rather than a list that reshuffles as
 * work moves — "Done: 0" is information, and a tile that vanishes is not.
 * Retired statuses are dropped by the renderer via `isDeprecatedStatus`.
 */
export function computeStatusDistribution(
  tasks: Task[],
): StatusDistribution[] {
  const counts = new Map<TaskStatus, number>(
    TASK_STATUSES.map((s) => [s, 0]),
  );

  for (const t of tasks) {
    const status = effectiveStatus(t);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return TASK_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}
