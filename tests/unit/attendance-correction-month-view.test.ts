import { describe, expect, it } from "vitest";
import { buildAttendanceReport } from "@/lib/attendance/weekly-report";
import { isEditable, monthFigures, needsCorrection, weekCounts } from "@/lib/attendance/correction/month-view";
import type { DayRow } from "@/lib/queries/attendance-status";

// The correction page's figures come straight from the attendance report (no grading of their own).
const d = (logDate: string, code: DayRow["code"], inAt: string | null, outAt: string | null, workedMinutes = 0): DayRow => ({
  logDate,
  weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(),
  inAt,
  outAt,
  isWeeklyOff: code === "W/O",
  code,
  dayValue: 1,
  late: false,
  leftEarly: false,
  lateWaived: false,
  workedMinutes,
});

const days = [
  d("2026-04-01", "P", "09:30", "18:30", 540),
  d("2026-04-02", "incomplete", "10:10", null),
  d("2026-04-03", "A", null, null),
  d("2026-04-04", "P", null, "18:00"), // OUT without IN
  d("2026-04-05", "W/O", null, null),
  d("2026-04-06", "H", null, null),
  d("2026-04-07", "H/D", "09:30", "13:30", 240),
  d("2026-04-08", "P", "09:30", null), // today
];
const report = buildAttendanceReport(days, 2026, 4, "2026-04-08");
const rows = report.weeks.flatMap((w) => w.rows);
const row = (date: string) => rows.find((r) => r.date === date)!;

describe("attendance correction month view", () => {
  it("flags past days with exactly one punch; not complete days, empty days, today or upcoming days", () => {
    expect(rows.filter(needsCorrection).map((r) => r.date)).toEqual(["2026-04-02", "2026-04-04"]);
    expect(needsCorrection(row("2026-04-08"))).toBe(false); // today: may not have checked out yet
    expect(needsCorrection(row("2026-04-03"))).toBe(false); // absent: nothing recorded, not a partial record
  });

  it("lets HR edit past days and today, never an upcoming day", () => {
    expect(isEditable(row("2026-04-01"))).toBe(true);
    expect(isEditable(row("2026-04-08"))).toBe(true);
    expect(isEditable(row("2026-04-09"))).toBe(false);
  });

  it("sums the month from the report's own counts and hours", () => {
    expect(monthFigures(report)).toEqual({
      present: 3, // 1, 4 (graded P) and 8 Apr
      absent: 1,
      halfDay: 1,
      holiday: 1,
      weeklyOff: 1,
      workedMinutes: 540 + 240, // only days with both punches carry hours
      needsCorrection: 2,
    });
  });

  it("always shows present / absent / weekly off / holidays in a week header, then any other status present", () => {
    const w1 = weekCounts(report.weeks[0]!.counts);
    expect(w1.slice(0, 4).map((c) => `${c.n} ${c.label}`)).toEqual(["2 present", "1 absent", "1 weekly off", "0 holidays"]);
    // 2 Apr "no check-out" is flagged as "to check" by the header, not repeated as a status count.
    expect(w1.some((c) => c.key === "open")).toBe(false);
    expect(report.weeks[0]!.rows.filter(needsCorrection)).toHaveLength(2);
  });
});
