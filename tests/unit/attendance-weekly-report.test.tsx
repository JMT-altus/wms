// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { buildAttendanceReport } from "@/lib/attendance/weekly-report";
import { AttendanceWeeklyReport, REPORT_COLUMNS } from "@/components/attendance/dashboard/attendance-weekly-report";
import type { DayRow } from "@/lib/queries/attendance-status";

// The Attendance Report: weeks Monday → Sunday cut to the month, six day columns, attendance totals only.

const day = (logDate: string, over: Partial<DayRow> = {}): DayRow => ({
  logDate,
  weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(),
  inAt: null,
  outAt: null,
  isWeeklyOff: false,
  code: "A",
  dayValue: 0,
  late: false,
  leftEarly: false,
  lateWaived: false,
  workedMinutes: 0,
  ...over,
});

// October 2026 starts on a Thursday. Today is Fri 9 Oct.
const TODAY = "2026-10-09";
const DAYS: DayRow[] = [
  day("2026-10-01", { code: "P", inAt: "09:30", outAt: "18:30", workedMinutes: 540, dayValue: 1 }),
  day("2026-10-02", { code: "H", dayValue: 1 }),
  day("2026-10-03", { code: "H/D", inAt: "09:30", outAt: "13:30", workedMinutes: 240, dayValue: 0.5, leftEarly: true }),
  day("2026-10-04", { code: "W/O", isWeeklyOff: true, dayValue: 1 }),
  day("2026-10-05", { code: "P", inAt: "10:05", outAt: "19:05", workedMinutes: 540, dayValue: 1, late: true }),
  day("2026-10-06", { code: "A" }),
  day("2026-10-07", { code: "P", inAt: "09:30", outAt: "18:00", workedMinutes: 510, dayValue: 1 }),
  day("2026-10-08", { code: "P", inAt: "09:30", outAt: "18:30", workedMinutes: 540, dayValue: 1 }),
  day("2026-10-09", { code: "P", inAt: "09:30", outAt: "18:30", workedMinutes: 540, dayValue: 1 }),
  ...Array.from({ length: 22 }, (_, i) => day(`2026-10-${String(i + 10).padStart(2, "0")}`, { code: "A" })),
];
const report = buildAttendanceReport(DAYS, 2026, 10, TODAY);

afterEach(cleanup);

describe("buildAttendanceReport", () => {
  it("groups the month into Monday → Sunday weeks, cut to the month", () => {
    expect(report.weeks.map((w) => [w.index, w.start, w.end, w.rows.length])).toEqual([
      [1, "2026-10-01", "2026-10-04", 4],
      [2, "2026-10-05", "2026-10-11", 7],
      [3, "2026-10-12", "2026-10-18", 7],
      [4, "2026-10-19", "2026-10-25", 7],
      [5, "2026-10-26", "2026-10-31", 6],
    ]);
    expect(report.weeks.flatMap((w) => w.rows).map((r) => r.date)).toEqual(Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`));
  });

  it("keeps each day's stored status, punches and hours; days after today are Upcoming", () => {
    const [d1, d2, d3, d4] = report.weeks[0]!.rows;
    expect([d1!.label, d1!.inAt, d1!.outAt, d1!.workedMinutes, d1!.group]).toEqual(["Present", "09:30", "18:30", 540, "present"]);
    expect([d2!.label, d2!.group]).toEqual(["Holiday", "holiday"]);
    expect([d3!.label, d3!.group, d3!.leftEarly]).toEqual(["Half Day", "half", true]);
    expect([d4!.label, d4!.group]).toEqual(["Weekly Off", "weekoff"]);
    const later = report.weeks[1]!.rows.find((r) => r.date === "2026-10-10")!;
    expect([later.label, later.future, later.group]).toEqual(["Upcoming", true, null]); // a stored "A" in the future is not shown as absent
  });

  it("totals are sums of what is stored: work hours per week and month, and days by status", () => {
    expect(report.weeks[0]!.workedMinutes).toBe(780);
    expect(report.weeks[1]!.workedMinutes).toBe(2130);
    expect(report.totals.workedMinutes).toBe(2910);
    expect(report.weeks[0]!.counts).toMatchObject({ present: 1, holiday: 1, half: 1, weekoff: 1, upcoming: 0 });
    expect(report.weeks[1]!.counts).toMatchObject({ present: 4, absent: 1, upcoming: 2 });
    expect(report.totals.counts).toMatchObject({ present: 5, absent: 1, half: 1, holiday: 1, weekoff: 1, upcoming: 22 });
  });
});

describe("AttendanceWeeklyReport", () => {
  it("each week header shows its number, dates, status summary and work hours; the current week starts open", () => {
    render(<AttendanceWeeklyReport report={report} today={TODAY} />);
    const weeks = screen.getAllByRole("button", { expanded: false }).concat(screen.getAllByRole("button", { expanded: true }));
    expect(weeks).toHaveLength(5);
    const w1 = screen.getByRole("button", { name: /Week 1/ });
    expect(w1.textContent).toContain("01/10/26 – 04/10/26");
    expect(w1.textContent).toContain("1 present · 1 half day · 1 holiday · 1 weekly off");
    expect(within(w1).getByLabelText("Week 1 work hours").textContent).toBe("13h");
    expect(w1.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Week 2/ }).getAttribute("aria-expanded")).toBe("true"); // today's week
  });

  it("expands and collapses a week; the day table has exactly the six columns, in order", () => {
    render(<AttendanceWeeklyReport report={report} today={TODAY} />);
    const w1 = screen.getByRole("button", { name: /Week 1/ });
    fireEvent.click(w1);
    expect(w1.getAttribute("aria-expanded")).toBe("true");
    const table = document.getElementById("attendance-week-1")!.querySelector("table")!;
    expect([...table.querySelectorAll("th")].map((h) => h.textContent)).toEqual([...REPORT_COLUMNS]);
    expect(REPORT_COLUMNS).toEqual(["Date", "Day", "Status", "Check-in", "Check-out", "Work hours"]);
    for (const tr of table.querySelectorAll("tbody tr")) expect(tr.querySelectorAll("td")).toHaveLength(6);
    const first = table.querySelector("tbody tr")!;
    expect([...first.querySelectorAll("td")].map((c) => c.textContent)).toEqual(["01/10/26", "Thu", "Present", "09:30", "18:30", "9h"]);
    // No pay or day-value column or figure anywhere.
    expect(document.body.textContent).not.toMatch(/₹|Earned|Payable|Day value|Balance|Deduction|Adjustment/i);
    fireEvent.click(w1);
    expect(w1.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("attendance-week-1")).toBeNull();
  });

  it("colours each status: present green, absent red, half day orange, holiday blue, weekly off grey, upcoming neutral", () => {
    render(<AttendanceWeeklyReport report={report} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: /Week 1/ }));
    const colour = (status: string) => (document.querySelector(`tr[data-status="${status}"] td:nth-child(3) span`) as HTMLElement).style.color;
    expect(colour("present")).toBe("rgb(31, 122, 85)"); // green
    expect(colour("half")).toBe("rgb(169, 83, 26)"); // orange
    expect(colour("holiday")).toBe("rgb(47, 95, 179)"); // blue
    expect(colour("weekoff")).toBe("rgb(88, 102, 121)"); // grey
    expect(colour("absent")).toBe("rgb(194, 64, 58)"); // red
    const upcoming = document.querySelector('tr[data-status="upcoming"]')!;
    expect(upcoming.textContent).toContain("Upcoming");
    expect((upcoming as HTMLElement).style.background).toBe("");
    // Flags ride in the Status cell, not in extra columns.
    expect(document.querySelector('tr[data-status="half"]')!.textContent).toContain("left early");
    expect(document.querySelector('tr[data-status="present"][aria-current], tr[data-status="present"]')).toBeTruthy();
  });

  it("ends with a MONTH TOTAL: work hours for the month and days by status, nothing about pay", () => {
    render(<AttendanceWeeklyReport report={report} today={TODAY} />);
    const total = screen.getByLabelText("Month total");
    expect(total.textContent).toContain("Month total");
    expect(total.textContent).toContain("Work hours 48h 30m");
    expect(total.textContent).toContain("5 present · 1 half day · 1 absent · 1 holiday · 1 weekly off · 22 upcoming");
    expect(total.textContent).not.toMatch(/₹|salary|earned/i);
  });

  it("with manage, a date opens a full-width row of that day's actions — still six columns", () => {
    render(<AttendanceWeeklyReport report={report} today={TODAY} manage={(r) => <span>Actions for {r.date}</span>} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage 05/10/26" }));
    const actions = screen.getByText("Actions for 2026-10-05");
    expect(actions.closest("td")!.getAttribute("colspan")).toBe("6");
    fireEvent.click(screen.getByRole("button", { name: "Manage 05/10/26" }));
    expect(screen.queryByText("Actions for 2026-10-05")).toBeNull();
  });
});
