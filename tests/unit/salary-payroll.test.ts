import { describe, expect, it } from "vitest";
import type { SalaryRunRow } from "@/lib/queries/salary";
import type { MonthSummary } from "@/lib/queries/attendance-status";
import { buildPayrollSummary, groupRuns, matchesStatus, payrollLines, payrollStatus, rosterAttendance, sortRuns } from "@/lib/salary/payroll";

// The administrators' Salary page view-model: sums of the stored runs (in
// paise, exact), the month's payment state, the roster's attendance added up,
// and the grouping / filtering / sorting the runs report offers.

const row = (over: Partial<SalaryRunRow>): SalaryRunRow => ({
  id: "r", employeeId: "e", employeeName: "Someone", designationName: null, payingEntityName: null, fy: "FY 26-27", month: "2026-10", annualCtc: 120_000, daysInMonth: 31,
  payableDays: 31, lateMarks: 0, lateDeductionDays: 0, gross: 10_000, pt: 200, tds: 0, advances: 0, pendingBalanceIn: 0, netPayable: 9_800, disbursed: false, disbursedAmount: null,
  source: "generated", createdAt: new Date(), ...over,
});
const rows = [
  row({ id: "r1", employeeId: "e1", employeeName: "Asha Rao", designationName: "Executive", payingEntityName: "Legacy Creators", gross: 10_000.1, netPayable: 9_800.1 }),
  row({ id: "r2", employeeId: "e2", employeeName: "Bala Iyer", designationName: "Manager", payingEntityName: "JSV HUF", gross: 50_000, tds: 1_000, netPayable: 48_800, disbursed: true, disbursedAmount: 48_800 }),
  row({ id: "r3", employeeId: "e3", employeeName: "Chitra Nair", designationName: "Executive", payingEntityName: "Legacy Creators", gross: 20_000, advances: 500, pendingBalanceIn: 150, netPayable: 19_450, disbursed: true, disbursedAmount: 10_000 }),
];
const profiles = [
  { employeeId: "e1", name: "Asha Rao", annualCtc: 120_000 },
  { employeeId: "e2", name: "Bala Iyer", annualCtc: 600_000 },
  { employeeId: "e3", name: "Chitra Nair", annualCtc: 240_000 },
  { employeeId: "e4", name: "Dev Kumar", annualCtc: 300_000 },
  { employeeId: "e5", name: "Eka Singh", annualCtc: 0 },
];

describe("buildPayrollSummary", () => {
  it("sums the runs in paise (no float drift), counts coverage and payment states, and checks the lines against the stored nets", () => {
    const s = buildPayrollSummary(rows, profiles, { e1: { status: "stale", savedPayableDays: 31, nowPayableDays: 30, savedLateMarks: 0, nowLateMarks: 0 }, e2: { status: "current" }, e3: { status: "unknown" } });
    expect(s.grossPaise).toBe(8_000_010);
    expect(s.ptPaise).toBe(60_000);
    expect(s.tdsPaise).toBe(100_000);
    expect(s.advancesPaise).toBe(50_000);
    expect(s.deductionsPaise).toBe(210_000);
    expect(s.pendingInPaise).toBe(15_000);
    expect(s.netPaise).toBe(7_805_010);
    expect(s.reconciles).toBe(true);
    expect(s.paidPaise).toBe(5_880_000); // 48,800 in full + 10,000 of the partly paid run
    expect({ paid: s.paid, partial: s.partial, pending: s.pending, disbursed: s.disbursed }).toEqual({ paid: 1, partial: 1, pending: 1, disbursed: 2 });
    expect({ active: s.activeEmployees, eligible: s.eligible, included: s.included }).toEqual({ active: 5, eligible: 4, included: 3 });
    expect(s.notGenerated).toEqual(["Dev Kumar"]);
    expect(s.noProfile).toEqual(["Eka Singh"]);
    expect({ stale: s.stale, unchecked: s.unchecked, imported: s.imported }).toEqual({ stale: 1, unchecked: 1, imported: 0 });
  });

  it("an imported run whose components don't add up is reported as a difference, never corrected", () => {
    const s = buildPayrollSummary([row({ source: "imported", gross: 10_000, pt: 0, netPayable: 9_500 })], profiles.slice(0, 1));
    expect(s.reconciles).toBe(false);
    expect(s.differencePaise).toBe(-50_000);
    expect(s.imported).toBe(1);
  });

  it("the month's state: paid only when every run is paid in full, pending when nothing is, partly paid in between, null without runs", () => {
    expect(payrollStatus(buildPayrollSummary(rows, profiles))).toBe("partial");
    expect(payrollStatus(buildPayrollSummary(rows.map((r) => ({ ...r, disbursed: true, disbursedAmount: null })), profiles))).toBe("paid");
    expect(payrollStatus(buildPayrollSummary(rows.map((r) => ({ ...r, disbursed: false, disbursedAmount: null })), profiles))).toBe("pending");
    expect(payrollStatus(buildPayrollSummary([], profiles))).toBeNull();
  });

  it("the itemised lines leave out zero components; deductions are negative, carried-in balances positive", () => {
    const s = buildPayrollSummary(rows, profiles);
    expect(payrollLines(s).map((l) => [l.key, l.paise, l.kind])).toEqual([
      ["pt", -60_000, "deduction"],
      ["tds", -100_000, "deduction"],
      ["advances", -50_000, "deduction"],
      ["pending", 15_000, "adjustment"],
    ]);
    expect(payrollLines({ ptPaise: 0, tdsPaise: 0, advancesPaise: 0, pendingInPaise: 0 })).toEqual([]);
  });
});

describe("rosterAttendance", () => {
  const summary = (over: Partial<MonthSummary>): MonthSummary => ({
    payableDays: 0, present: 0, absent: 0, halfDay: 0, weeklyOff: 0, incomplete: 0, late: 0, lateRaw: 0, leftEarly: 0, lateWaived: 0, holiday: 0, holidayPresent: 0, holidayHalfDay: 0, paidLeave: 0, unpaidLeave: 0, compOff: 0,
    ...over,
  } as MonthSummary);
  it("adds every employee's cards up — days worked, working days, half days, absences, off days — and counts the employees", () => {
    const a = rosterAttendance([
      { summary: summary({ present: 17, halfDay: 1, absent: 3, weeklyOff: 4, holiday: 1, payableDays: 17.5, late: 2 }) },
      { summary: summary({ present: 20, holidayHalfDay: 1, weeklyOff: 4, holidayPresent: 1, paidLeave: 1, payableDays: 23.25, late: 1 }) },
    ]);
    expect(a.employees).toBe(2);
    expect(a.daysWorked).toBe(37);
    expect(a.workingDays).toBe(42); // 17+1+3 and 20+1 (leave)
    expect(a.halfDays).toBe(2); // one H/D and one H-H/D
    expect(a.absent).toBe(3);
    expect(a.offDays).toBe(9);
    expect(a.workedOffDays).toBe(2);
    expect(a.paidLeave).toBe(1);
    expect(a.payableDays).toBe(40.75);
    expect(a.lateMarks).toBe(3);
  });
  it("an empty roster is all zeros", () => {
    expect(rosterAttendance([])).toMatchObject({ employees: 0, daysWorked: 0, workingDays: 0, payableDays: 0 });
  });
});

describe("groupRuns / matchesStatus / sortRuns", () => {
  it("groups by paying entity in name order with per-group totals; the unassigned group comes last", () => {
    const groups = groupRuns([...rows, row({ id: "r4", employeeId: "e4", employeeName: "Dev Kumar", payingEntityName: null })]);
    expect(groups.map((g) => g.label)).toEqual(["JSV HUF", "Legacy Creators", "No paying entity"]);
    const legacy = groups[1]!;
    expect(legacy.rows.map((r) => r.employeeName)).toEqual(["Asha Rao", "Chitra Nair"]);
    expect(legacy.grossPaise).toBe(3_000_010);
    expect(legacy.deductionsPaise).toBe(90_000);
    expect(legacy.pendingInPaise).toBe(15_000);
    expect(legacy.netPaise).toBe(2_925_010);
    expect(legacy.paidPaise).toBe(1_000_000);
    expect({ paid: legacy.paid, partial: legacy.partial }).toEqual({ paid: 0, partial: 1 });
    expect(groupRuns(rows, "designation").map((g) => g.label)).toEqual(["Executive", "Manager"]);
  });

  it("the status filter matches payment states, and 'stale' matches runs whose attendance changed", () => {
    const stale = { status: "stale", savedPayableDays: 31, nowPayableDays: 30, savedLateMarks: 0, nowLateMarks: 0 } as const;
    expect(rows.filter((r) => matchesStatus("all", r, undefined))).toHaveLength(3);
    expect(rows.filter((r) => matchesStatus("paid", r, undefined)).map((r) => r.employeeName)).toEqual(["Bala Iyer"]);
    expect(rows.filter((r) => matchesStatus("partial", r, undefined)).map((r) => r.employeeName)).toEqual(["Chitra Nair"]);
    expect(rows.filter((r) => matchesStatus("pending", r, undefined)).map((r) => r.employeeName)).toEqual(["Asha Rao"]);
    expect(rows.filter((r) => matchesStatus("stale", r, r.employeeId === "e1" ? stale : { status: "current" })).map((r) => r.employeeName)).toEqual(["Asha Rao"]);
  });

  it("sorts by name, net, gross, payable days or payment state, with the name as tie-break, without mutating the input", () => {
    const names = (sorted: SalaryRunRow[]) => sorted.map((r) => r.employeeName);
    expect(names(sortRuns(rows, "name"))).toEqual(["Asha Rao", "Bala Iyer", "Chitra Nair"]);
    expect(names(sortRuns(rows, "net-desc"))).toEqual(["Bala Iyer", "Chitra Nair", "Asha Rao"]);
    expect(names(sortRuns(rows, "net-asc"))).toEqual(["Asha Rao", "Chitra Nair", "Bala Iyer"]);
    expect(names(sortRuns(rows, "gross-desc"))).toEqual(["Bala Iyer", "Chitra Nair", "Asha Rao"]);
    expect(names(sortRuns([...rows, row({ employeeName: "Zed", payableDays: 12 })], "payable-asc"))[0]).toBe("Zed");
    expect(names(sortRuns(rows, "status"))).toEqual(["Asha Rao", "Chitra Nair", "Bala Iyer"]); // pending, partly paid, paid
    expect(names(rows)).toEqual(["Asha Rao", "Bala Iyer", "Chitra Nair"]);
  });
});
