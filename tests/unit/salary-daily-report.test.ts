import { describe, expect, it } from "vitest";
import {
  attendanceCards,
  buildBreakdown,
  buildDailyReport,
  dayPaise,
  monthlyCtcPaise,
  shiftMonthKey,
  toPaise,
  type RunMoney,
} from "@/lib/salary/daily-report";
import { paymentStatusOf, signedPaise, inrPaise } from "@/lib/salary/money";
import { computeSalary } from "@/lib/salary/compute";
import type { DayRow, MonthSummary } from "@/lib/queries/attendance-status";

// The My Salary figures are DERIVED from a stored run and the grader's days — in
// whole paise — and must add up to the run exactly. Nothing here prices a day
// or a deduction differently from computeSalary.

/** A run exactly as Generate Salary would store it for these inputs (two-decimal rupees). */
function runFor(input: Parameters<typeof computeSalary>[0], over: Partial<RunMoney> = {}): RunMoney {
  const b = computeSalary(input);
  const r2 = (n: number) => Number(n.toFixed(2));
  return {
    annualCtc: r2(input.annualCtc),
    daysInMonth: input.daysInMonth,
    payableDays: r2(b.payableDays),
    lateMarks: input.lateMarksInMonth,
    lateDeductionDays: r2(b.lateDeductionDays),
    gross: r2(b.gross),
    pt: r2(b.pt),
    tds: r2(b.tds),
    advances: r2(b.advances),
    pendingBalanceIn: r2(b.pendingBalanceIn),
    netPayable: r2(b.net),
    source: "generated",
    ...over,
  };
}
const BASE = { annualCtc: 372_000, payableDays: 28.5, daysInMonth: 31, ptExempt: false, tdsMonthly: 0, lateMarksInMonth: 3, advances: 0, pendingBalanceIn: 0 };

function day(logDate: string, over: Partial<DayRow> = {}): DayRow {
  return {
    logDate,
    weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(),
    inAt: "10:00",
    outAt: "19:00",
    isWeeklyOff: false,
    code: "P",
    dayValue: 1,
    late: false,
    leftEarly: false,
    lateWaived: false,
    workedMinutes: 540,
    ...over,
  };
}

describe("paise helpers", () => {
  it("convert stored two-decimal rupees exactly, and the monthly CTC as computeSalary rounds it", () => {
    expect(toPaise(12283.87)).toBe(1_228_387);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(monthlyCtcPaise(372_000)).toBe(3_100_000);
    expect(monthlyCtcPaise(149_806.44)).toBe(toPaise(12_483.87)); // 149806.44 / 12 = 12483.87
  });
  it("a day's pay is day-value × monthly CTC ÷ calendar days, to the paisa; never divides by zero", () => {
    expect(dayPaise({ annualCtc: 372_000, daysInMonth: 31 }, 1)).toBe(100_000);
    expect(dayPaise({ annualCtc: 372_000, daysInMonth: 31 }, 0.5)).toBe(50_000);
    expect(dayPaise({ annualCtc: 372_000, daysInMonth: 31 }, 2)).toBe(200_000);
    expect(dayPaise({ annualCtc: 372_000, daysInMonth: 0 }, 1)).toBe(0);
  });
});

describe("buildBreakdown", () => {
  it("lays out the run's own figures and confirms gross − PT − TDS − advances + pending = net, to the paisa", () => {
    const b = buildBreakdown(runFor({ ...BASE, tdsMonthly: 500, advances: 1000, pendingBalanceIn: 250 }));
    expect(b.grossPaise).toBe(2_800_000); // 28 effective days × ₹1,000
    expect(b.lines.map((l) => [l.key, l.paise, l.kind])).toEqual([
      ["pt", -20_000, "deduction"],
      ["tds", -50_000, "deduction"],
      ["advances", -100_000, "deduction"],
      ["pending", 25_000, "adjustment"],
    ]);
    expect(b.deductionsPaise).toBe(-170_000);
    expect(b.netPaise).toBe(2_655_000);
    expect(b.reconciles).toBe(true);
    expect(b.differencePaise).toBe(0);
    expect(b.detail).toMatchObject({ monthlyCtcPaise: 3_100_000, perDayPaise: 100_000, payableDays: 28.5, lateMarks: 3, lateDeductionDays: 0.5, effectiveDays: 28 });
  });
  it("zero lines are left out; an exempt employee with no deductions shows none", () => {
    const b = buildBreakdown(runFor({ ...BASE, ptExempt: true, lateMarksInMonth: 0 }));
    expect(b.lines).toEqual([]);
    expect(b.netPaise).toBe(b.grossPaise);
    expect(b.reconciles).toBe(true);
  });
  it("a run whose stored net doesn't match its components is reported, not hidden (an imported month, or a defect)", () => {
    const b = buildBreakdown(runFor(BASE, { netPayable: 27_000, source: "imported" }));
    expect(b.reconciles).toBe(false);
    expect(b.differencePaise).toBe(27_000 * 100 - (2_800_000 - 20_000));
  });
});

describe("attendanceCards", () => {
  const s: MonthSummary = {
    payableDays: 18.5, present: 17, absent: 3, halfDay: 1, weeklyOff: 4, incomplete: 1, late: 2, lateRaw: 3, leftEarly: 0, lateWaived: 1,
    holiday: 1, holidayPresent: 1, holidayHalfDay: 0, paidLeave: 1, unpaidLeave: 0, compOff: 0,
  };
  it("counts straight from the grader's summary: worked / working days, half days, absent, leave, off days, worked off days", () => {
    expect(attendanceCards(s)).toEqual({
      daysWorked: 17,
      workingDays: 17 + 1 + 3 + 1 + 1 + 0 + 0, // P + H/D + A + incomplete + PL + LWP + CO = 23
      halfDays: 1,
      absent: 3,
      noCheckOut: 1,
      paidLeave: 1,
      unpaidLeave: 0,
      compOff: 0,
      offDays: 5,
      workedOffDays: 1,
      payableDays: 18.5,
      lateMarks: 2,
    });
  });
});

describe("buildDailyReport", () => {
  // October 2026: the 1st is a Thursday; "today" is the 29th.
  const today = "2026-10-29";
  const days: DayRow[] = [
    day("2026-10-01"),
    day("2026-10-02"),
    day("2026-10-03", { code: "H/D", dayValue: 0.5, workedMinutes: 270, outAt: "14:30" }),
    day("2026-10-04", { code: "W/O", dayValue: 1, isWeeklyOff: true, inAt: null, outAt: null, workedMinutes: 0 }),
    day("2026-10-05", { code: "A", dayValue: 0, inAt: null, outAt: null, workedMinutes: 0 }),
    day("2026-10-06", { late: true }),
    day("2026-10-11", { code: "HP", dayValue: 2, isWeeklyOff: true }),
    day("2026-10-29", { outAt: null, code: "incomplete", dayValue: 0, workedMinutes: 0 }),
    day("2026-10-30", { code: "W/O", dayValue: 1, inAt: null, outAt: null, workedMinutes: 0 }), // future, but a weekly off is known in advance: shown, and it carries its day value as the grader gives it
  ];
  // Day values: 1 + 1 + 0.5 + 1 + 0 + 1 + 2 + 0 (no check-out) + 1 (the future weekly off) = 7.5; 7.5 − 0.5 late = 7 days → gross ₹7,000.
  const run = runFor({ ...BASE, payableDays: 7.5, lateMarksInMonth: 3 });

  it("groups the month Monday→Sunday, prices each shown day at the run's rate, and the month adds up to the stored gross exactly", () => {
    const r = buildDailyReport(days, 2026, 10, today, run);
    expect(r.weeks).toHaveLength(5);
    expect(r.weeks[0]).toMatchObject({ index: 1, start: "2026-10-01", end: "2026-10-04" });
    expect(r.weeks[4]).toMatchObject({ index: 5, start: "2026-10-26", end: "2026-10-31" });
    const w1 = r.weeks[0]!;
    expect(w1.rows.map((x) => [x.date, x.label, x.dayValue, x.earnedPaise])).toEqual([
      ["2026-10-01", "Present", 1, 100_000],
      ["2026-10-02", "Present", 1, 100_000],
      ["2026-10-03", "Half Day", 0.5, 50_000],
      ["2026-10-04", "Weekly Off", 1, 100_000],
    ]);
    expect(w1).toMatchObject({ workedMinutes: 540 * 2 + 270, dayValues: 3.5, earnedPaise: 350_000, counts: { present: 2, half: 1, weekoff: 1, upcoming: 0 } });
    // Day-values across the month equal the run's payable days; Σ day pay − late deduction (+ rounding) = the stored gross.
    expect(r.totals.dayValues).toBe(7.5);
    expect(r.totals.earnedPaise).toBe(750_000);
    expect(r.totals.lateDeductionPaise).toBe(-50_000);
    expect(r.totals.roundingPaise).toBe(0);
    expect(r.totals.grossPaise).toBe(700_000);
    expect(r.totals.earnedPaise! + r.totals.lateDeductionPaise + r.totals.roundingPaise).toBe(r.totals.grossPaise);
  });

  it("a day that hasn't happened is 'Upcoming' with no value or pay — even when a row exists for it", () => {
    const r = buildDailyReport(days, 2026, 10, today, run);
    const last = r.weeks[4]!;
    const d30 = last.rows.find((x) => x.date === "2026-10-30")!;
    // A weekly off IS known in advance, so it shows; the 31st has no row and is simply upcoming.
    expect(d30.label).toBe("Weekly Off");
    const d31 = last.rows.find((x) => x.date === "2026-10-31")!;
    expect(d31).toMatchObject({ label: "Upcoming", future: true, dayValue: 0, code: null });
    expect(last.counts.upcoming).toBe(1);
    expect(r.totals.upcomingDays).toBe(1);
    // A gap day in the past with no row is "No record", not absent: the grader decides absence, not this report.
    const d7 = r.weeks[1]!.rows.find((x) => x.date === "2026-10-07")!;
    expect(d7).toMatchObject({ label: "No record", code: null, dayValue: 0 });
  });

  it("without a run, hours and day values are reported but nothing is priced", () => {
    const r = buildDailyReport(days, 2026, 10, today, null);
    expect(r.totals.earnedPaise).toBeNull();
    expect(r.totals.grossPaise).toBeNull();
    expect(r.totals.lateDeductionPaise).toBe(0);
    expect(r.weeks[0]!.earnedPaise).toBeNull();
    expect(r.weeks[0]!.rows[0]!.earnedPaise).toBeNull();
    expect(r.totals.workedMinutes).toBe(540 * 4 + 270);
  });

  it("rounding: when day pay doesn't divide evenly the leftover paisa is shown as its own line, so the rows still total the gross", () => {
    // ₹10,000/month over 30 days = ₹333.333… per day; 3 present days → gross ₹1,000.00 but 3 × ₹333.33 = ₹999.99.
    const r3 = runFor({ ...BASE, annualCtc: 120_000, daysInMonth: 30, payableDays: 3, lateMarksInMonth: 0 });
    const ds = [day("2026-09-01"), day("2026-09-02"), day("2026-09-03")];
    const r = buildDailyReport(ds, 2026, 9, "2026-09-30", r3);
    expect(r.totals.earnedPaise).toBe(99_999);
    expect(r.totals.roundingPaise).toBe(1);
    expect(r.totals.grossPaise).toBe(100_000);
  });
});

describe("money and status helpers", () => {
  it("formats paise in Indian grouping with two decimals, signed for breakdown lines", () => {
    expect(inrPaise(1_228_387)).toBe("₹12,283.87");
    expect(signedPaise(-20_000)).toBe("− ₹200.00");
    expect(signedPaise(25_000)).toBe("+ ₹150.00".replace("150", "250"));
  });
  it("payment status is the run's disbursement state: pending, paid, or partly paid when less than the net went out", () => {
    expect(paymentStatusOf({ disbursed: false, disbursedAmount: null, netPayable: 100 })).toBe("pending");
    expect(paymentStatusOf({ disbursed: true, disbursedAmount: null, netPayable: 100 })).toBe("paid");
    expect(paymentStatusOf({ disbursed: true, disbursedAmount: 100, netPayable: 100 })).toBe("paid");
    expect(paymentStatusOf({ disbursed: true, disbursedAmount: 60, netPayable: 100 })).toBe("partial");
  });
  it("month keys shift across year ends", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
  });
});
