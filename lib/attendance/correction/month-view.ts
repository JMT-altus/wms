import type { AttendanceReport, AttendanceReportRow, StatusCounts } from "@/lib/attendance/weekly-report";

/**
 * Attendance Correction — the month view's figures. Pure: no database, no
 * clock. Everything here is read off `buildAttendanceReport` (the attendance
 * report's own weeks, statuses and hours), so the correction page, the report
 * and the dashboard always show the same numbers. No attendance rule is made
 * or changed here.
 */

/** A day HR may open in the editor: it has happened (today included) and is on or after the employee's join day. */
export function isEditable(r: AttendanceReportRow): boolean {
  return !r.future && Boolean(r.day) && r.day!.code !== "–";
}

/**
 * A past day with exactly one punch — an IN without an OUT, or an OUT without
 * an IN — the typical result of a power failure or biometric outage. Today is
 * left out: the employee may simply not have checked out yet.
 */
export function needsCorrection(r: AttendanceReportRow): boolean {
  return isEditable(r) && !r.isToday && Boolean(r.inAt) !== Boolean(r.outAt);
}

export interface MonthFigures {
  present: number;
  absent: number;
  halfDay: number;
  holiday: number;
  weeklyOff: number;
  workedMinutes: number;
  needsCorrection: number;
}

export function monthFigures(report: AttendanceReport): MonthFigures {
  const c = report.totals.counts;
  return {
    present: c.present ?? 0,
    absent: c.absent ?? 0,
    halfDay: c.half ?? 0,
    holiday: c.holiday ?? 0,
    weeklyOff: c.weekoff ?? 0,
    workedMinutes: report.totals.workedMinutes,
    needsCorrection: report.weeks.flatMap((w) => w.rows).filter(needsCorrection).length,
  };
}

/**
 * The week header's counts: the four HR always reads, then any other status that occurs that week.
 * "No check-out" days are not repeated here: the header flags them as "to check" (see `needsCorrection`).
 */
export function weekCounts(c: StatusCounts): { key: string; label: string; n: number }[] {
  const always = [
    { key: "present", label: "present", n: c.present ?? 0 },
    { key: "absent", label: "absent", n: c.absent ?? 0 },
    { key: "weekoff", label: "weekly off", n: c.weekoff ?? 0 },
    { key: "holiday", label: c.holiday === 1 ? "holiday" : "holidays", n: c.holiday ?? 0 },
  ];
  const extra = [
    { key: "half", label: "half day", n: c.half ?? 0 },
    { key: "leave", label: "leave", n: c.leave ?? 0 },
    { key: "compoff", label: "comp off", n: c.compoff ?? 0 },
    { key: "offwork", label: "worked off day", n: c.offwork ?? 0 },
    { key: "waived", label: "waived", n: c.waived ?? 0 },
  ].filter((x) => x.n > 0);
  return [...always, ...extra];
}
