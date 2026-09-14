import type { TaskStatus, AgeBucketId } from "@/db/enums";

export type ViewMode = "doer" | "initiator";

export type EisenhowerPriority =
  | "imp_urgent"
  | "imp_not_urgent"
  | "not_imp_urgent"
  | "not_imp_not_urgent";

export interface DashboardFilters {
  startDate: Date | null;
  endDate: Date | null;
  employeeIds: string[];
  view: ViewMode;
  /** Department NAMES, as managed in /admin/departments — not a fixed union. */
  departments: string[];
  priorities: EisenhowerPriority[];
  subjects: string[];
}

export interface KpiTotals {
  total: number;
  pending: number;     // initiated + follow_up only
  notStarted: number;
  needHelp: number;
  done: number;        // done + approved
  notApproved: number;
}

export interface KpiWithDelta {
  current: number;
  previous: number;
  sparkline: number[];
}

export interface KpiSet {
  total: KpiWithDelta;
  pending: KpiWithDelta;
  notStarted: KpiWithDelta;
  needHelp: KpiWithDelta;
  done: KpiWithDelta;
  notApproved: KpiWithDelta;
}

export interface StatusDistributionPayload {
  rows: StatusDistribution[];
  denominator: number; // total − approved
  /** Headline counts surfaced as their own cards beneath the chart.
   *  pending = open & awaiting a verdict; notApproved = declined;
   *  archived = removed from active boards. */
  summary: {
    pending: number;
    notApproved: number;
    archived: number;
  };
}

export interface StatusDistribution {
  status: TaskStatus;
  count: number;
}

export interface VelocityPoint {
  date: string;
  created: number;
  completed: number;
}

export interface EmployeeStatusRow {
  employeeId: string;
  employeeName: string;
  department: string;
  approved: number;
  notApproved: number;
  done: number;
  transferred: number;
  cancelled: number;
  pendingTotal: number;
  needHelp: number;
  followUp: number;
  initiated: number;
  notStarted: number;
  total: number;
  /** tasks with priority = imp_urgent */
  criticalCount: number;
}

export interface TopPerformer {
  employeeId: string;
  employeeName: string;
  /** The person's team, for the chip under their name on the leaderboard. */
  department: string;
  doneCount: number;
  /** Of `doneCount`, how many landed on or before the due date. Tasks with no
   *  due date can't be judged and count as neither on time nor late. */
  onTimeCount: number;
  /** Mean days from a task being raised to it being completed, over the
   *  completions in scope. Null when nothing here can be measured. */
  avgTurnaroundDays: number | null;
  weeklySparkline: number[];
  /** 1-based position in the GLOBAL ranking (ties share the better rank) —
   *  stays honest even when the dashboard is filtered to a subset of people. */
  rank: number;
}

export interface AgingRow {
  employeeId: string;
  employeeName: string;
  buckets: Record<AgeBucketId, number>;
  total: number;
}

export interface AgingHeatmapCell {
  employeeId: string;
  bucket: AgeBucketId;
  count: number;
}

export interface AgingByDate {
  bucket: AgeBucketId;
  count: number;
}

export interface HeatmapCellTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: EisenhowerPriority;
  ageDays: number;
}

export interface AgingHeatmapData {
  // employeeId -> bucketId -> HeatmapCellTask[]
  byCell: Record<string, Record<string, HeatmapCellTask[]>>;
  /**
   * employeeId -> bucketId -> how many tasks in that cell the viewer may NOT
   * open. The bars are team-wide counts but the popover only lists tasks the
   * viewer can see, so without this a bar reading 6 could show a single row
   * and look broken.
   */
  hiddenByCell: Record<string, Record<string, number>>;
}

/** Operational summary metrics surfaced when a KPI card is expanded. All
 *  respect the active dashboard filters (date / employee / department / etc.). */
export interface WmsSummary {
  overdue: number;          // open & past due
  dueToday: number;         // open & due today
  dueThisWeek: number;      // open & due within 7 days
  completionRate: number;   // done ÷ total, %
  approvalRate: number;     // approved ÷ (approved + not_approved), %
  avgAgeDays: number;       // mean age of open tasks
  avgTimeToDoneDays: number; // mean created→completed for completed tasks
}

export interface DashboardData {
  kpis: KpiSet;
  wmsSummary: WmsSummary;
  pullQuote: string;
  velocity: VelocityPoint[];
  statusTable: EmployeeStatusRow[];
  statusDistribution: StatusDistributionPayload;
  topPerformers: TopPerformer[];
  agingTable: AgingRow[];
  agingHeatmap: AgingHeatmapCell[];
  agingByDate: AgingByDate[];
  agingHeatmapData: AgingHeatmapData;
  generatedAt: Date;
}

export interface TaskListFilters {
  startDate: Date | null;
  endDate: Date | null;
  statuses: TaskStatus[];
  doerIds: string[];
  initiatorIds: string[];
  /** Department NAMES, as managed in /admin/departments — not a fixed union. */
  departments: string[];
  priorities: EisenhowerPriority[];
  subjects: string[];
  clients: string[];
  taskId: string | null;
  archived: boolean;
  /** How the assignee filter was resolved.
   *  - "default":  no `emp` URL param + a defaultDoerId was supplied (non-admin
   *                default-to-me scope). `doerIds` will be `[defaultDoerId]`.
   *  - "all":      either `emp` was absent for an admin, or `emp=all` was
   *                explicitly set. `doerIds` is `[]`.
   *  - "specific": `emp=<one-or-more-ids>` was explicitly set.
   *  - "unassigned": `emp=unassigned` — the pool lens (tasks with no doer). */
  assigneeMode: "default" | "all" | "specific" | "unassigned";
}

export interface TaskListRow {
  id: string;
  /** Friendly sequential task number (#1042). Null only until the backfill
   *  migration has run. */
  taskNo: number | null;
  title: string;
  subject: string | null;
  client: string | null;
  /** Full task body — used by the hover-to-preview popover in the table. */
  description: string | null;
  status: TaskStatus;
  priority: EisenhowerPriority;
  /** Null = unassigned (a quick-dumped pool task awaiting assignment). */
  doerId: string | null;
  doerName: string | null;
  doerDept: string | null;
  initiatorId: string;
  initiatorName: string | null;
  /**
   * The project this task belongs to, when it was created from one or linked
   * to one afterwards.
   *
   * Carried on the LIST row, not just the detail: a task's project is part of
   * what the task IS, and a list that hides it makes "which project is this
   * for?" a question you answer by opening every row.
   */
  projectNodeId: string | null;
  projectName: string | null;
  createdAt: Date;
  /** The ORIGINAL committed deadline. Immutable after creation — never
   *  compare against this directly; use pickEffectiveDue(row). */
  dueAt: Date;
  /** Admin-set reschedule. When present it, not `dueAt`, is what the task is
   *  judged against — see lib/tasks/effective-due.ts. */
  revisedTargetDate: Date | null;
  ageDays: number;
  archived: boolean;
  createdById: string | null;
  updatedAt: Date;
  approvalStatus: "approved" | "not_approved" | "cancelled" | "transferred" | null;
  firstReadAt: Date | null;
  completedAt: Date | null;
  /**
   * True when the task was approved AFTER its due date — surfaced as a "Late"
   * marker in the Archive. Null when it isn't approved, or when the approval
   * moment can't be established (no `approved_at` and no audit event).
   */
  approvedLate: boolean | null;
}
