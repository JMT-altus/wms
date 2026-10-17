import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSheet, parseDateCell, parseTimeCell, readWorkbook } from "@/lib/attendance/import/parse-report";

// Synthetic data only — no real employees or punches.
function blockWorkbook(): XLSX.WorkBook {
  const rows: unknown[][] = [
    [],
    [null, "Daily Attendance Report (Summary Report)"],
    [],
    [null, "Apr 01 2026  To  Apr 30 2026"],
    [null, "Company:", "Default", null, null, null, null, null, null, "Printed On : Oct 15 2026 12:52"],
    [],
    [null, "Department:", null, "Sales"],
    [null, "Employee Code:", null, "12", "Employee Name :", null, null, "Test Alpha"],
    [null, "Date", null, "InTime", "OutTime", null, "Shift", "Total Duration", "Status", null, "Remarks"],
    [null, "01-Apr-2026", null, "10:10", "19:32", null, "GS", "9:22", "Present "],
    [null, "02-Apr-2026", null, "9:05", null, null, "GS", "0:00", "  ½Present  (No OutPunch)"],
    [null, "03-Apr-2026", null, null, null, null, "GS", "00:00", "Absent"],
    [null, "04-Apr-2026", null, "25:99", "19:00", null, "GS", "00:00", "Present"],
    [null, "31-Feb-2026", null, "10:00", "11:00", null, "GS", "1:00", "Present"],
    [null, "Total Duration=9 Hrs 22 Min , PresentDays=1"],
    [null, "Department:", null, "Godown"],
    [null, "Employee Code:", null, "30", "Employee Name :", null, null, "Test Beta"],
    [null, "Date", null, "InTime", "OutTime", null, "Shift", "Total Duration", "Status"],
    [null, "01-Apr-2026", null, "22:00", "23:30", null, "NS", "1:30", "Present"],
    [null, "Total Duration=1 Hrs 30 Min"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "DailyAttendance_SummaryReport");
  return wb;
}

describe("attendance import: cell parsing", () => {
  it("reads the report's date and time formats", () => {
    expect(parseDateCell("01-Apr-2026")).toBe("2026-04-01");
    expect(parseDateCell("2026-04-01")).toBe("2026-04-01");
    expect(parseDateCell("01/04/2026")).toBe("2026-04-01"); // day first
    expect(parseDateCell("31-Feb-2026")).toBeNull();
    expect(parseDateCell("Total Duration=0")).toBeNull();
    expect(parseTimeCell("9:05")).toEqual({ time: "09:05", bad: false });
    expect(parseTimeCell("19:32:10")).toEqual({ time: "19:32", bad: false });
    expect(parseTimeCell("9:05 PM")).toEqual({ time: "21:05", bad: false });
    expect(parseTimeCell(0.5)).toEqual({ time: "12:00", bad: false });
    expect(parseTimeCell(null)).toEqual({ time: null, bad: false });
    expect(parseTimeCell("25:99").bad).toBe(true);
    expect(parseTimeCell("abc").bad).toBe(true);
  });
});

describe("attendance import: block report", () => {
  const report = parseSheet(blockWorkbook(), "DailyAttendance_SummaryReport");

  it("finds the period, layout and each employee block with department", () => {
    expect(report.layout).toBe("block-report");
    expect(report.period).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(report.employees.map((e) => [e.code, e.name, e.department])).toEqual([
      ["12", "Test Alpha", "Sales"],
      ["30", "Test Beta", "Godown"],
    ]);
  });

  it("reads day rows and ignores the summary / total lines", () => {
    const a = report.employees[0]!;
    expect(a.days).toHaveLength(5);
    expect(a.days[0]).toMatchObject({ date: "2026-04-01", inTime: "10:10", outTime: "19:32", shift: "GS", duration: "9:22" });
    expect(report.employees[1]!.days).toHaveLength(1);
  });

  it("normalises status whitespace for display and keeps a one-sided day as-is", () => {
    const a = report.employees[0]!;
    expect(a.days[0]!.status).toBe("Present");
    expect(a.days[1]).toMatchObject({ inTime: "09:05", outTime: null, status: "½Present (No OutPunch)" });
  });

  it("keeps blank-time days and flags unreadable dates / times instead of guessing", () => {
    const a = report.employees[0]!;
    expect(a.days[2]).toMatchObject({ inTime: null, outTime: null, problems: [] });
    expect(a.days[3]!.problems[0]).toMatch(/In time/);
    expect(a.days[4]!.date).toBeNull();
    expect(a.days[4]!.problems[0]).toMatch(/not a valid date/);
  });
});

describe("attendance import: CSV / flat table", () => {
  it("reads a CSV table and groups rows by employee code", () => {
    const csv = [
      "Employee Code,Employee Name,Date,In Time,Out Time",
      "7,Test Gamma,2026-04-01,09:30,18:00",
      "7,Test Gamma,2026-04-02,09:40,",
      "8,Test Delta,2026-04-01,10:00,19:00",
    ].join("\n");
    const wb = readWorkbook(csv);
    const r = parseSheet(wb, wb.SheetNames[0]!);
    expect(r.layout).toBe("flat-table");
    expect(r.employees.map((e) => [e.code, e.days.length])).toEqual([
      ["7", 2],
      ["8", 1],
    ]);
    expect(r.employees[0]!.days[1]).toMatchObject({ inTime: "09:40", outTime: null });
  });

  it("explains an unrecognised sheet instead of importing nothing silently", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["foo", "bar"], [1, 2]]), "Sheet1");
    const r = parseSheet(wb, "Sheet1");
    expect(r.employees).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/not in a recognised layout/);
  });
});
