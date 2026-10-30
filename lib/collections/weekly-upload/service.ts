import type { NotifyOpts } from "@/lib/notifications/dispatch";
import {
  TRACKER_PATH,
  WEEKLY_TASK_SUBJECT,
  WEEKLY_TASK_TITLE,
  dueAtFor,
  formatDueDay,
  isDueToday,
  isOverdueAt,
  reportingWeekFor,
  weekForUpload,
  weekLabel,
  weeklyTaskDescription,
} from "@/lib/collections/weekly-upload/week";

/**
 * The compulsory weekly Bulk Upload task — the rules, with storage and
 * notification delivery injected so they can be exercised without a database.
 *
 *   ensureWeeklyTask            one task per reporting week, for the configured
 *                               employee, created once however often it runs.
 *   completeWeeklyUploadForSnapshot
 *                               called after a Bulk Upload is CONFIRMED AND
 *                               WRITTEN (never from a preview): completes the
 *                               task of the week the upload belongs to.
 *   reconcileWeeklyCompletions  the sweep's safety net: an upload whose
 *                               completion step failed is picked up from the
 *                               snapshots table on the next run.
 *   sendWeeklyReminders         due-today and overdue reminders, each sent once.
 *   runWeeklyUploadSweep        all of the above, for the daily cron.
 *
 * Every write that must happen once is claimed in the store with a conditional
 * update, so a retried or doubled run creates nothing and sends nothing twice.
 * Nothing here reads who is asking from a request: the actor is the signed
 * session the caller resolved, or the scheduler.
 */

export interface WeeklyUploadSettings {
  /** False while migration 0121 isn't applied. */
  storageReady: boolean;
  assigneeId: string | null;
  dueDow: number;
  setById: string | null;
  updatedAt: Date | null;
}

export interface EmployeeFacts {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
}

/** One reporting week's row, joined with the live task. */
export interface WeekRow {
  weekStart: string;
  taskId: string;
  assigneeId: string | null;
  /** The task's current doer (the live assignee). */
  doerId: string | null;
  taskStatus: string;
  dueAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  completedSnapshotId: string | null;
  completedById: string | null;
  notifiedAssignedAt: Date | null;
  notifiedDueTodayAt: Date | null;
  notifiedOverdueAt: Date | null;
  notifiedCompletedAt: Date | null;
}

export interface SnapshotRef {
  id: string;
  periodTo: string | null;
  uploadedAt: Date;
  uploadedById: string | null;
}

export type ReminderKind = "assigned" | "due_today" | "overdue" | "completed";

export interface CreateWeekTaskInput {
  weekStart: string;
  dueAt: Date;
  assigneeId: string;
  /** Who the task is recorded as initiated and created by (the admin who configured the assignee, else the assignee). */
  initiatorId: string;
  title: string;
  description: string;
  subject: string;
}

export interface WeeklyUploadStore {
  readSettings(): Promise<WeeklyUploadSettings>;
  employee(id: string): Promise<EmployeeFacts | null>;
  /** Whether the employee holds collection.balances.import, resolved from the permission matrix. */
  holdsBulkUpload(employeeId: string): Promise<boolean>;
  getWeek(weekStart: string): Promise<WeekRow | null>;
  weekByTaskId(taskId: string): Promise<WeekRow | null>;
  listOpenWeeks(): Promise<WeekRow[]>;
  /** Creates the task and the week row together, or returns the existing week unchanged. Must be safe under concurrent calls. */
  createWeekTask(input: CreateWeekTaskInput): Promise<{ created: boolean; row: WeekRow }>;
  /** Marks the week complete once. `claimed` is false when it already was. */
  completeWeek(weekStart: string, by: { snapshotId: string; actorId: string | null; at: Date }): Promise<{ claimed: boolean; row: WeekRow | null }>;
  /** Stamps the notification timestamp if it is still unset; true = this caller may send. */
  claimNotification(weekStart: string, kind: ReminderKind, at: Date): Promise<boolean>;
  /** Moves every open week's task to `assigneeId`; returns the weeks that changed. */
  reassignOpenWeeks(assigneeId: string, actorId: string, at: Date): Promise<WeekRow[]>;
  snapshotsSince(from: Date): Promise<SnapshotRef[]>;
}

export interface WeeklyUploadDeps {
  store: WeeklyUploadStore;
  notify: (opts: NotifyOpts) => Promise<void>;
  siteUrl: () => string;
}

export type EnsureResult =
  | { status: "not-installed" }
  | { status: "no-assignee"; weekStart: string }
  | { status: "assignee-ineligible"; weekStart: string; reason: AssigneeProblem }
  | { status: "created" | "exists"; weekStart: string; row: WeekRow };

export type AssigneeProblem = "missing" | "inactive" | "not-admin" | "no-permission";

export const ASSIGNEE_PROBLEM_TEXT: Record<AssigneeProblem, string> = {
  missing: "The assigned employee no longer exists.",
  inactive: "The assigned employee's account is deactivated.",
  "not-admin": "The assigned employee is not an admin, so they cannot open the Collection Tracker.",
  "no-permission": 'The assigned employee does not hold the "Collection Tracker — Bulk Upload" permission (granted by a super-admin in Field Permissions).',
};

export const PROTECTED_TASK_MESSAGE =
  "This is the compulsory weekly Collection Tracker Bulk Upload task. It is completed automatically by a confirmed Bulk Upload and can't be closed, reassigned, archived or deleted by hand. The responsible employee is set in Admin & Master Setup → Weekly Bulk Upload.";

/** Why an employee can't be the responsible person, or null when they can. */
export async function assigneeProblem(employeeId: string, store: WeeklyUploadStore): Promise<AssigneeProblem | null> {
  const emp = await store.employee(employeeId);
  if (!emp) return "missing";
  if (!emp.isActive) return "inactive";
  if (!emp.isAdmin) return "not-admin";
  if (!(await store.holdsBulkUpload(emp.id))) return "no-permission";
  return null;
}

const trackerUrl = (deps: WeeklyUploadDeps) => `${deps.siteUrl()}${TRACKER_PATH}`;
const note = (text: string) => JSON.stringify({ note: text });

/**
 * Make sure the reporting week has its task. Creates it (and tells the
 * assignee) only when the week has none yet and an eligible employee is
 * configured; otherwise reports why not, so the sweep and the admin page can
 * say so. `weekStart` defaults to the week containing `now`.
 */
export async function ensureWeeklyTask(
  now: Date,
  deps: WeeklyUploadDeps,
  opts: { weekStart?: string; notifyAssigned?: boolean } = {},
): Promise<EnsureResult> {
  const { store } = deps;
  const settings = await store.readSettings();
  if (!settings.storageReady) return { status: "not-installed" };
  const weekStart = opts.weekStart ?? reportingWeekFor(now);

  const existing = await store.getWeek(weekStart);
  if (existing) return { status: "exists", weekStart, row: existing };

  if (!settings.assigneeId) return { status: "no-assignee", weekStart };
  const problem = await assigneeProblem(settings.assigneeId, store);
  if (problem) return { status: "assignee-ineligible", weekStart, reason: problem };

  const dueAt = dueAtFor(weekStart, settings.dueDow);
  const { created, row } = await store.createWeekTask({
    weekStart,
    dueAt,
    assigneeId: settings.assigneeId,
    initiatorId: settings.setById ?? settings.assigneeId,
    title: WEEKLY_TASK_TITLE,
    subject: WEEKLY_TASK_SUBJECT,
    description: weeklyTaskDescription(weekStart, dueAt, trackerUrl(deps)),
  });
  if (created && opts.notifyAssigned !== false) await notifyAssigned(row, now, deps);
  return { status: created ? "created" : "exists", weekStart, row };
}

async function notifyAssigned(row: WeekRow, now: Date, deps: WeeklyUploadDeps): Promise<void> {
  if (!row.doerId) return;
  if (!(await deps.store.claimNotification(row.weekStart, "assigned", now))) return;
  await deps.notify({
    userId: row.doerId,
    kind: "task_assigned",
    taskId: row.taskId,
    title: `Weekly task: ${WEEKLY_TASK_TITLE} — due ${formatDueDay(row.dueAt)}`,
    body: note(`Reporting week ${weekLabel(row.weekStart)}. Status: Pending. Upload the Tally customer summary at ${trackerUrl(deps)} (Bulk Upload).`),
  });
}

export type CompleteResult =
  | { status: "not-installed" }
  | { status: "no-task"; weekStart: string }
  | { status: "completed"; weekStart: string; row: WeekRow }
  | { status: "already-completed"; weekStart: string };

/**
 * A Bulk Upload was confirmed and its snapshot written: complete the task of
 * the week the upload belongs to (see weekForUpload). Called only after the
 * import transaction committed — a preview, a refused upload or a failed
 * transaction never reaches this. Repeating it for the same snapshot, or
 * confirming twice in one week, completes nothing a second time.
 *
 * A week that has no task yet (the sweep hadn't run, or the feature is new)
 * gets one, already completed, so the compliance history is whole — but only
 * if an eligible employee is configured; nothing is ever assigned by guesswork.
 */
export async function completeWeeklyUploadForSnapshot(snapshot: SnapshotRef, deps: WeeklyUploadDeps): Promise<CompleteResult> {
  const { store } = deps;
  const weekStart = weekForUpload(snapshot);
  let row = await store.getWeek(weekStart);
  if (!row) {
    const ensured = await ensureWeeklyTask(snapshot.uploadedAt, deps, { weekStart, notifyAssigned: false });
    if (ensured.status !== "created" && ensured.status !== "exists") {
      return ensured.status === "not-installed" ? { status: "not-installed" } : { status: "no-task", weekStart };
    }
    row = ensured.row;
  }
  const done = await store.completeWeek(weekStart, { snapshotId: snapshot.id, actorId: snapshot.uploadedById, at: snapshot.uploadedAt });
  if (!done.claimed || !done.row) return { status: "already-completed", weekStart };
  await notifyCompleted(done.row, snapshot, deps);
  return { status: "completed", weekStart, row: done.row };
}

async function notifyCompleted(row: WeekRow, snapshot: SnapshotRef, deps: WeeklyUploadDeps): Promise<void> {
  if (!row.doerId) return;
  if (!(await deps.store.claimNotification(row.weekStart, "completed", snapshot.uploadedAt))) return;
  await deps.notify({
    userId: row.doerId,
    kind: "status_changed",
    taskId: row.taskId,
    actorId: snapshot.uploadedById,
    title: `'${WEEKLY_TASK_TITLE}' completed — Bulk Upload confirmed for ${weekLabel(row.weekStart)}`,
    body: JSON.stringify({ toStatus: "done", fromStatus: "not_started", note: `Status: Completed on ${formatDueDay(snapshot.uploadedAt)}. Upload reference ${snapshot.id}.` }),
  });
}

/**
 * The safety net: for every open week, look for a confirmed upload that
 * belongs to it and complete it. Covers an upload whose completion step
 * failed after the snapshot was written.
 */
export async function reconcileWeeklyCompletions(now: Date, deps: WeeklyUploadDeps): Promise<{ open: number; completed: number }> {
  void now;
  const open = await deps.store.listOpenWeeks();
  if (open.length === 0) return { open: 0, completed: 0 };
  const earliest = open.map((w) => w.weekStart).sort()[0]!;
  // From the Monday's IST midnight (18:30 UTC the day before).
  const from = new Date(new Date(`${earliest}T00:00:00Z`).getTime() - 5.5 * 60 * 60 * 1000);
  const snapshots = await deps.store.snapshotsSince(from);
  const openWeeks = new Set(open.map((w) => w.weekStart));
  let completed = 0;
  for (const s of snapshots) {
    const week = weekForUpload(s);
    if (!openWeeks.has(week)) continue;
    const r = await completeWeeklyUploadForSnapshot(s, deps);
    if (r.status === "completed") {
      completed++;
      openWeeks.delete(week);
    }
  }
  return { open: open.length, completed };
}

/** Due-today and overdue reminders for open weeks, each sent once per week. */
export async function sendWeeklyReminders(now: Date, deps: WeeklyUploadDeps): Promise<{ dueToday: number; overdue: number }> {
  const stats = { dueToday: 0, overdue: 0 };
  for (const row of await deps.store.listOpenWeeks()) {
    if (!row.doerId) continue;
    if (isDueToday(row.dueAt, now)) {
      if (!(await deps.store.claimNotification(row.weekStart, "due_today", now))) continue;
      await deps.notify({
        userId: row.doerId,
        kind: "nudge",
        taskId: row.taskId,
        title: `Due today: '${WEEKLY_TASK_TITLE}'`,
        body: note(`The weekly Bulk Upload for ${weekLabel(row.weekStart)} is due today (${formatDueDay(row.dueAt)}) and is still pending. Upload it at ${trackerUrl(deps)}.`),
      });
      stats.dueToday++;
    } else if (isOverdueAt(row.dueAt, now)) {
      if (!(await deps.store.claimNotification(row.weekStart, "overdue", now))) continue;
      await deps.notify({
        userId: row.doerId,
        kind: "nudge",
        taskId: row.taskId,
        title: `Overdue: '${WEEKLY_TASK_TITLE}' was due ${formatDueDay(row.dueAt)}`,
        body: note(`The weekly Bulk Upload for ${weekLabel(row.weekStart)} is overdue. Status: Overdue. Upload it at ${trackerUrl(deps)} to complete the task.`),
      });
      stats.overdue++;
    }
  }
  return stats;
}

export interface SweepStats {
  ensure: EnsureResult["status"];
  weekStart: string | null;
  reconciled: { open: number; completed: number };
  reminders: { dueToday: number; overdue: number };
}

/** The daily job: this week's task, then catch-up completions, then reminders. */
export async function runWeeklyUploadSweep(now: Date, deps: WeeklyUploadDeps): Promise<SweepStats> {
  const ensure = await ensureWeeklyTask(now, deps);
  if (ensure.status === "not-installed") {
    return { ensure: ensure.status, weekStart: null, reconciled: { open: 0, completed: 0 }, reminders: { dueToday: 0, overdue: 0 } };
  }
  const reconciled = await reconcileWeeklyCompletions(now, deps);
  const reminders = await sendWeeklyReminders(now, deps);
  return { ensure: ensure.status, weekStart: ensure.weekStart, reconciled, reminders };
}

/**
 * After an administrator changes the responsible employee: every open week's
 * task follows, with a `reassigned` audit row and an assignment notification.
 * Completed weeks keep their history.
 */
export async function syncOpenWeeksToAssignee(assigneeId: string, actorId: string, now: Date, deps: WeeklyUploadDeps): Promise<{ reassigned: number }> {
  const changed = await deps.store.reassignOpenWeeks(assigneeId, actorId, now);
  for (const row of changed) {
    await deps.notify({
      userId: assigneeId,
      kind: "task_assigned",
      taskId: row.taskId,
      actorId,
      title: `Weekly task: ${WEEKLY_TASK_TITLE} — due ${formatDueDay(row.dueAt)}`,
      body: note(`You are now responsible for the weekly Bulk Upload. Reporting week ${weekLabel(row.weekStart)}. Upload it at ${trackerUrl(deps)}.`),
    });
  }
  return { reassigned: changed.length };
}

/** True when the task is a week's compulsory Bulk Upload task (never closed, moved or deleted by hand). */
export async function isCompulsoryWeeklyTask(taskId: string, store: Pick<WeeklyUploadStore, "weekByTaskId">): Promise<boolean> {
  return (await store.weekByTaskId(taskId)) !== null;
}
