import { describe, it, expect } from "vitest";
import { computeDayCode } from "@/lib/attendance/status";
import { buildDailyReport } from "@/lib/salary/daily-report";
import { buildAttendanceReport } from "@/lib/attendance/weekly-report";
import type { DayRow } from "@/lib/queries/attendance-status";
import type { AttendanceSchedule } from "@/lib/attendance/schedule";

// Imported (or live) punches reach the Salary report and the Attendance Report through the same graded days. A day
// with a check-out missing must not show hours: the grader measures such a day to the end of the day (23:59, or to
// now for today), which is not time worked. Status and pay stay exactly as graded.

const day = (logDate: string, over: Partial<DayRow> = {}): DayRow => ({
  logDate, weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(), inAt: null, outAt: null, isWeeklyOff: false,
  code: "P", dayValue: 1, late: false, leftEarly: false, lateWaived: false, workedMinutes: 0, ...over,
});

// What the real grader returns for a past day with a 09:30 check-in and no check-out.
const sched: AttendanceSchedule = { lateAfter: "09:45", earlyBefore: "17:30", fullDayMinutes: 540, halfDayMinutes: 270 };
const graded = computeDayCode({ inAt: "09:30", outAt: null }, sched, { isWeeklyOff: false, isHoliday: false, leave: null, compOffRedeemed: false }, "23:59");

const TODAY = "2026-10-31";
const DAYS = [
  day("2026-10-01", { inAt: "09:30", outAt: "18:30", workedMinutes: 540 }),
  day("2026-10-02", { inAt: "09:30", outAt: null, code: graded.code, dayValue: graded.dayValue, workedMinutes: graded.workedMinutes }),
  day("2026-10-03", { inAt: "09:30", outAt: "14:00", code: "H/D", dayValue: 0.5, workedMinutes: 270 }),
];

describe("hours only for days with both punches", () => {
  it("the grader itself is unchanged: a missing check-out is 'No check-out', no pay, minutes to the end of the day", () => {
    expect(graded.code).toBe("incomplete");
    expect(graded.dayValue).toBe(0);
    expect(graded.workedMinutes).toBeGreaterThan(600); // 09:30 → 23:59
  });

  it("Salary report: the check-in shows, the hours don't, and the totals leave it out; pay is untouched", () => {
    const r = buildDailyReport(DAYS, 2026, 10, TODAY, null);
    const rows = r.weeks.flatMap((w) => w.rows);
    const open = rows.find((x) => x.date === "2026-10-02")!;
    expect([open.inAt, open.outAt, open.workedMinutes, open.code, open.dayValue]).toEqual(["09:30", null, 0, "incomplete", 0]);
    expect(rows.find((x) => x.date === "2026-10-01")!.workedMinutes).toBe(540);
    expect(r.totals.workedMinutes).toBe(540 + 270);
    expect(r.totals.dayValues).toBe(1.5); // the day values the grader gave — nothing changed
  });

  it("Attendance Report: the same row, the same times, no hours; weekly and monthly totals agree with the Salary report", () => {
    const a = buildAttendanceReport(DAYS, 2026, 10, TODAY);
    const s = buildDailyReport(DAYS, 2026, 10, TODAY, null);
    const open = a.weeks.flatMap((w) => w.rows).find((x) => x.date === "2026-10-02")!;
    expect([open.inAt, open.outAt, open.workedMinutes, open.label]).toEqual(["09:30", null, 0, "No Check-out"]);
    expect(a.totals.workedMinutes).toBe(s.totals.workedMinutes);
    expect(a.weeks.map((w) => w.workedMinutes)).toEqual(s.weeks.map((w) => w.workedMinutes));
  });

  it("a check-out without a check-in shows no hours either", () => {
    const only = [day("2026-10-05", { inAt: null, outAt: "18:00", code: "A", dayValue: 0, workedMinutes: 30 })];
    expect(buildAttendanceReport(only, 2026, 10, TODAY).totals.workedMinutes).toBe(0);
    expect(buildDailyReport(only, 2026, 10, TODAY, null).totals.workedMinutes).toBe(0);
  });
});
