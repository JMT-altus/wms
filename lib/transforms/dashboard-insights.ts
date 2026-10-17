import { PENDING_STATUSES } from "@/db/enums";
import type { TaskStatus } from "@/db/enums";
import type { DashboardInsights, SummaryPillCounts } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN = new Set<TaskStatus>(PENDING_STATUSES);
const DONE = new Set<TaskStatus>(["done", "approved"]);

/** The slice of a task the insight sections read. */
export interface InsightTask {
  doerId: string | null;
  initiatorId: string;
  status: TaskStatus;
  approvalStatus: string | null;
  dueAt: Date;
  revisedTargetDate: Date | null;
  completedAt: Date | null;
  archived: boolean;
}

/** The slice of a task the summary pills read. */
export interface PillTask {
  status: TaskStatus;
  approvalStatus: string | null;
  firstReadAt: Date | null;
}

/**
 * Counts for the summary pills beyond the KPI set. Same buckets as the KPI
 * totals: a task that is done/approved or declined is counted there, not in
 * Initiated / Follow up.
 */
export function computeSummaryPillCounts(tasks: readonly PillTask[]): SummaryPillCounts {
  let notRead = 0;
  let initiated = 0;
  let followUp = 0;
  let abandoned = 0;
  for (const t of tasks) {
    if (OPEN.has(t.status) && t.firstReadAt == null) notRead++;
    if (t.status === "abandoned") abandoned++;
    const terminal =
      t.status === "done" ||
      t.status === "approved" ||
      t.approvalStatus === "approved" ||
      t.status === "not_approved" ||
      t.approvalStatus === "not_approved";
    if (terminal) continue;
    if (t.status === "initiated") initiated++;
    else if (
      t.status === "follow_up" ||
      t.status === "follow_up_1" ||
      t.status === "follow_up_2" ||
      t.status === "follow_up_3"
    )
      followUp++;
  }
  return { notRead, initiated, followUp, abandoned };
}

const effectiveDue = (t: InsightTask) => t.revisedTargetDate ?? t.dueAt;

/** Whole days between two instants, rounded down (negative = before). */
const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/**
 * The extra dashboard sections, all derived from the tasks the dashboard has
 * already loaded for its filters — no extra queries.
 *
 * Definitions (the same ones the sections state in their subtitles):
 *  - open        : a pending-class status, not archived.
 *  - overdue     : open and past its effective due date (revised date if set).
 *  - delivered   : Done or Approved with a completion time.
 *  - on time     : delivered on or before the due date (day granularity).
 *  - sent back   : declined — status or approval verdict is "not approved".
 *  - delegated   : a task whose initiator is not its doer.
 */
export function computeDashboardInsights(
  allTasks: readonly InsightTask[],
  employees: readonly { id: string; name: string; managerId?: string | null }[],
  now: Date,
  /** employeeId → the department to group them under (optional). */
  departmentOf?: ReadonlyMap<string, string>,
): DashboardInsights {
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const nameOf = (id: string) => names.get(id) ?? "Unknown";
  const tasks = allTasks.filter((t) => !t.archived);

  const isSentBack = (t: InsightTask) =>
    t.status === "not_approved" || t.approvalStatus === "not_approved";
  const isOverdue = (t: InsightTask) => OPEN.has(t.status) && effectiveDue(t).getTime() < now.getTime();
  const isDelivered = (t: InsightTask) => DONE.has(t.status) && t.completedAt != null;
  /** Days late (>0), on the day (0) or early (<0). */
  const lateness = (t: InsightTask) => dayDiff(t.completedAt as Date, effectiveDue(t));

  // ── per doer ──────────────────────────────────────────────────────────────
  type DoerAcc = {
    total: number;
    overdue: number;
    overdueDays: number[];
    sentBack: number;
    /** For each sent-back task: whole days past its due date (0 = not yet due). */
    sentBackDays: number[];
    delivered: number;
    onTime: number;
    lateness: number[];
  };
  const byDoer = new Map<string, DoerAcc>();
  const doer = (id: string): DoerAcc => {
    let a = byDoer.get(id);
    if (!a) {
      a = { total: 0, overdue: 0, overdueDays: [], sentBack: 0, sentBackDays: [], delivered: 0, onTime: 0, lateness: [] };
      byDoer.set(id, a);
    }
    return a;
  };
  for (const t of tasks) {
    if (!t.doerId) continue;
    const a = doer(t.doerId);
    a.total++;
    if (isOverdue(t)) {
      a.overdue++;
      a.overdueDays.push(Math.max(1, dayDiff(now, effectiveDue(t))));
    }
    if (isSentBack(t)) {
      a.sentBack++;
      a.sentBackDays.push(Math.max(0, dayDiff(now, effectiveDue(t))));
    }
    if (isDelivered(t)) {
      a.delivered++;
      const l = lateness(t);
      a.lateness.push(l);
      if (l <= 0) a.onTime++;
    }
  }
  const doerRows = [...byDoer.entries()].map(([id, a]) => ({ id, name: nameOf(id), ...a }));

  const overdueByPerson = doerRows
    .filter((r) => r.overdue > 0)
    .map((r) => ({
      employeeId: r.id,
      name: r.name,
      department: departmentOf?.get(r.id) ?? "",
      overdue: r.overdue,
      oldestDays: Math.max(...r.overdueDays),
      avgDays: Math.round(r.overdueDays.reduce((s, d) => s + d, 0) / r.overdueDays.length),
      delivered: r.delivered,
      onTimePct: r.delivered > 0 ? pct(r.onTime, r.delivered) : null,
      b15: r.overdueDays.filter((d) => d >= 15).length,
      b8: r.overdueDays.filter((d) => d >= 8 && d <= 14).length,
      b4: r.overdueDays.filter((d) => d >= 4 && d <= 7).length,
      b1: r.overdueDays.filter((d) => d <= 3).length,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.oldestDays - a.oldestDays);

  const sentBack = doerRows
    .filter((r) => r.sentBack > 0)
    .map((r) => ({
      employeeId: r.id,
      name: r.name,
      department: departmentOf?.get(r.id) ?? "",
      sentBack: r.sentBack,
      total: r.total,
      pct: pct(r.sentBack, r.total),
      // Of the sent-back tasks, how many are this overdue (past their due date).
      b15: r.sentBackDays.filter((d) => d >= 15).length,
      b8: r.sentBackDays.filter((d) => d >= 8 && d <= 14).length,
      b4: r.sentBackDays.filter((d) => d >= 4 && d <= 7).length,
      b1: r.sentBackDays.filter((d) => d >= 1 && d <= 3).length,
    }))
    .sort((a, b) => b.sentBack - a.sentBack || b.pct - a.pct);

  // Delivery vs due date: the overall spread by ORIGINAL due date (a later
  // revised date does not turn a late delivery into an on-time one), then the
  // per-person average.
  const deliveredTasks = tasks.filter(isDelivered);
  const origLateness = (t: InsightTask) => dayDiff(t.completedAt as Date, t.dueAt);
  const countWhere = (test: (l: number) => boolean) =>
    deliveredTasks.filter((t) => test(origLateness(t))).length;
  const lateBuckets = [
    { key: "o22", label: "22 or more days overdue", count: countWhere((l) => l >= 22) },
    { key: "o15", label: "15 to 21 days overdue", count: countWhere((l) => l >= 15 && l <= 21) },
    { key: "o8", label: "8 to 14 days overdue", count: countWhere((l) => l >= 8 && l <= 14) },
    { key: "o4", label: "4 to 7 days overdue", count: countWhere((l) => l >= 4 && l <= 7) },
    { key: "o1", label: "1 to 3 days overdue", count: countWhere((l) => l >= 1 && l <= 3) },
  ];
  const onTimeBuckets = [
    { key: "today", label: "On Due Date (0 days)", count: countWhere((l) => l === 0) },
    { key: "b1", label: "1 to 3 days before due date", count: countWhere((l) => l <= -1 && l >= -3) },
    { key: "b4", label: "4 to 7 days before due date", count: countWhere((l) => l <= -4 && l >= -7) },
    { key: "b8", label: "8 or more days before due date", count: countWhere((l) => l <= -8) },
  ];
  const lateTotal = lateBuckets.reduce((s, b) => s + b.count, 0);
  const onBeforeTotal = onTimeBuckets.reduce((s, b) => s + b.count, 0);
  /** Done / Approved tasks with no completion time: nothing to compare. */
  const noComparableDate = tasks.filter((t) => DONE.has(t.status) && t.completedAt == null).length;
  const deliveryByPerson = doerRows
    .filter((r) => r.delivered > 0)
    .map((r) => ({
      employeeId: r.id,
      name: r.name,
      delivered: r.delivered,
      avgDaysVsDue: Math.round((r.lateness.reduce((s, d) => s + d, 0) / r.lateness.length) * 10) / 10,
    }))
    .sort((a, b) => b.avgDaysVsDue - a.avgDaysVsDue);

  const deliveredOnTime = doerRows
    .filter((r) => r.delivered > 0)
    .map((r) => ({
      employeeId: r.id,
      name: r.name,
      delivered: r.delivered,
      onTime: r.onTime,
      onTimePct: pct(r.onTime, r.delivered),
    }))
    .sort((a, b) => b.onTimePct - a.onTimePct || b.delivered - a.delivered);

  // ── per initiator ─────────────────────────────────────────────────────────
  type InitAcc = {
    forOthers: number;
    forSelf: number;
    delegatedDelivered: number;
    delegatedOverdue: number;
    delegatedSentBack: number;
  };
  const byInit = new Map<string, InitAcc>();
  for (const t of tasks) {
    let a = byInit.get(t.initiatorId);
    if (!a) {
      a = { forOthers: 0, forSelf: 0, delegatedDelivered: 0, delegatedOverdue: 0, delegatedSentBack: 0 };
      byInit.set(t.initiatorId, a);
    }
    const delegated = t.doerId != null && t.doerId !== t.initiatorId;
    if (delegated) {
      a.forOthers++;
      if (isDelivered(t)) a.delegatedDelivered++;
      if (isOverdue(t)) a.delegatedOverdue++;
      if (isSentBack(t)) a.delegatedSentBack++;
    } else {
      a.forSelf++;
    }
  }
  const initRows = [...byInit.entries()].map(([id, a]) => ({ id, name: nameOf(id), ...a }));

  const directReports = new Map<string, number>();
  for (const e of employees) {
    if (e.managerId) directReports.set(e.managerId, (directReports.get(e.managerId) ?? 0) + 1);
  }

  const delegationScorecard = initRows
    .filter((r) => r.forOthers > 0)
    .map((r) => ({
      employeeId: r.id,
      name: r.name,
      directReports: directReports.get(r.id) ?? 0,
      delegated: r.forOthers,
      completed: r.delegatedDelivered,
      completedPct: pct(r.delegatedDelivered, r.forOthers),
      overdue: r.delegatedOverdue,
      sentBack: r.delegatedSentBack,
    }))
    .sort((a, b) => b.delegated - a.delegated);

  const grand = tasks.length;
  const whoCreatesWork = initRows
    .map((r) => ({
      employeeId: r.id,
      name: r.name,
      forOthers: r.forOthers,
      forSelf: r.forSelf,
      total: r.forOthers + r.forSelf,
      sharePct: pct(r.forOthers + r.forSelf, grand),
    }))
    .sort((a, b) => b.total - a.total);

  // ── people to pull up ─────────────────────────────────────────────────────
  const pullUp = doerRows
    .map((r) => {
      const late = r.lateness.filter((l) => l > 0).length;
      return {
        employeeId: r.id,
        name: r.name,
        overdue: r.overdue,
        late,
        sentBack: r.sentBack,
        onTimePct: r.delivered > 0 ? pct(r.onTime, r.delivered) : null,
        score: r.overdue * 2 + late + r.sentBack * 2,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    overdueByPerson,
    sentBack,
    delivery: {
      lateBuckets,
      onTimeBuckets,
      lateTotal,
      onBeforeTotal,
      onTimePct: pct(onBeforeTotal, onBeforeTotal + lateTotal),
      noComparableDate,
      byPerson: deliveryByPerson,
    },
    delegationScorecard,
    whoCreatesWork,
    pullUp,
    deliveredOnTime,
  };
}
