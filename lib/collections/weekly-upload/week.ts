import { addDays, formatWeekLabel, istYmd, mondayOf, weekEnd } from "@/lib/weekly-goals/week";

/**
 * The weekly Bulk Upload policy — pure date rules, no database.
 *
 * A reporting week runs Monday → Sunday in IST and is identified by its
 * Monday as `yyyy-mm-dd` (the same convention Weekly Goals uses). The upload is
 * due on the configured weekday of that week (Friday unless an administrator
 * changes it), stored at noon IST like every other task due date, so the
 * Tasks module's "due today" and "overdue" buckets apply to it unchanged.
 */

export const TRACKER_PATH = "/forms/collection/tracker";
export const WEEKLY_TASK_TITLE = "Complete Weekly Collection Tracker Bulk Upload";
export const WEEKLY_TASK_SUBJECT = "Collection Tracker";
export const DEFAULT_DUE_DOW = 5;
/** The settings_events scope every change to the weekly upload settings is audited under. */
export const WEEKLY_UPLOAD_SETTINGS_SCOPE = "collection_weekly_upload";

const DOW_LABEL: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
export const dowLabel = (dow: number): string => DOW_LABEL[dow] ?? `day ${dow}`;
export const isDueDow = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7;

/** The reporting week (its Monday) that contains `now`, in IST. */
export function reportingWeekFor(now: Date): string {
  return mondayOf(now);
}

/** Noon IST on the week's due weekday, as an instant. */
export function dueAtFor(weekStart: string, dueDow: number = DEFAULT_DUE_DOW): Date {
  const day = addDays(weekStart, (isDueDow(dueDow) ? dueDow : DEFAULT_DUE_DOW) - 1);
  // Noon IST = 06:30 UTC.
  return new Date(`${day}T06:30:00Z`);
}

/** The due day as yyyy-mm-dd (IST). */
export const dueDayOf = (dueAt: Date): string => istYmd(dueAt);

/**
 * Which reporting week a confirmed upload belongs to.
 *
 * The file's printed "to" date is the date the figures are current to, so the
 * upload counts for the week containing that date — never for a later week. A
 * file whose period ends in a past week completes THAT week's task (late is
 * still done) and leaves the current week's task open. When the file prints no
 * period, or prints one ending after the upload itself, the upload is taken as
 * current and counts for the week it was confirmed in.
 */
export function weekForUpload(upload: { periodTo: string | null; uploadedAt: Date }): string {
  const confirmedWeek = reportingWeekFor(upload.uploadedAt);
  if (!upload.periodTo) return confirmedWeek;
  const dataWeek = mondayOf(upload.periodTo);
  return dataWeek < confirmedWeek ? dataWeek : confirmedWeek;
}

/** Overdue = the IST calendar day of `now` is after the due day (same rule as "done late"). */
export function isOverdueAt(dueAt: Date, now: Date): boolean {
  return istYmd(now) > istYmd(dueAt);
}

export function isDueToday(dueAt: Date, now: Date): boolean {
  return istYmd(now) === istYmd(dueAt);
}

export type WeeklyTaskState = "pending" | "in_progress" | "completed" | "overdue";

/**
 * The week's state, following the Tasks module's conventions: "done" /
 * "approved" is completed; anything else is overdue once the due day has
 * passed; otherwise it is in progress once the doer has moved it off the
 * fresh statuses.
 */
export function weeklyTaskState(args: { taskStatus: string; completedAt: Date | null; dueAt: Date }, now: Date): WeeklyTaskState {
  if (args.completedAt || args.taskStatus === "done" || args.taskStatus === "approved") return "completed";
  if (isOverdueAt(args.dueAt, now)) return "overdue";
  return args.taskStatus === "not_started" || args.taskStatus === "dont_know" ? "pending" : "in_progress";
}

export const STATE_LABEL: Record<WeeklyTaskState, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  overdue: "Overdue",
};

/** "Nov 3 – Nov 9, 2026" */
export const weekLabel = (weekStart: string): string => formatWeekLabel(weekStart);

/** "Fri, 7 Nov 2026" */
export function formatDueDay(dueAt: Date): string {
  return dueAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** The task description — instructions and the link, with the week spelled out. */
export function weeklyTaskDescription(weekStart: string, dueAt: Date, trackerUrl: string): string {
  return [
    `Reporting week: ${weekLabel(weekStart)} (Monday ${weekStart} to Sunday ${weekEnd(weekStart)}).`,
    `Due: ${formatDueDay(dueAt)}.`,
    "",
    "Upload this week's Tally customer summary (Debit / Credit per company) through the Collection Tracker:",
    `1. Open ${trackerUrl}`,
    "2. Click Bulk Upload, choose the exported file and click Preview upload.",
    "3. Check the matched companies and totals, tick the confirmation and click Upload balances.",
    "",
    "This task is completed automatically when the upload is confirmed and saved. Previewing a file does not complete it.",
    "It cannot be closed, reassigned or deleted by hand — the responsible employee is set in Admin & Master Setup → Weekly Bulk Upload.",
  ].join("\n");
}
