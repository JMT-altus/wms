import { describe, it, expect } from "vitest";
import {
  buildCalendar,
  computeOverview,
  formatDays,
  formatMinutes,
  greetingFor,
  monthRange,
  parseYearMonth,
  selectUpcomingHolidays,
  shiftMonth,
  timeUntil,
  yearOptions,
} from "@/lib/attendance/overview";
import type { DayRow } from "@/lib/queries/attendance-status";
import { HOLIDAYS_2026, HOLIDAYS_PENDING_CONFIRMATION } from "@/lib/attendance/holiday-list-2026";

function day(logDate: string, over: Partial<DayRow> = {}): DayRow {
  return {
    logDate,
    weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(),
    inAt: null,
    outAt: null,
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

const FULL_DAY = 9 * 60;

describe("the reporting month", () => {
  // 2026-10-09 is a Friday.
  const today = "2026-10-09";

  it("reports the current month through today, never past it", () => {
    expect(monthRange(2026, 10, today)).toEqual({ start: "2026-10-01", end: "2026-10-09" });
  });

  it("reports a past month in full, in the selected YEAR, not the current one", () => {
    expect(monthRange(2026, 9, today)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthRange(2025, 3, today)).toEqual({ start: "2025-03-01", end: "2025-03-31" });
    expect(monthRange(2024, 10, today)).toEqual({ start: "2024-10-01", end: "2024-10-31" });
  });

  it("gives a month that hasn't started an empty range", () => {
    const r = monthRange(2026, 11, today);
    expect(r.end < r.start).toBe(true);
    const far = monthRange(2027, 1, today);
    expect(far.end < far.start).toBe(true);
  });

  it("gets every month length right: 28, 29, 30 and 31 days", () => {
    const far = "2200-12-31"; // so nothing is clipped by "today"
    expect(monthRange(2025, 2, far).end).toBe("2025-02-28"); // common year
    expect(monthRange(2024, 2, far).end).toBe("2024-02-29"); // leap year
    expect(monthRange(2100, 2, far).end).toBe("2100-02-28"); // century, not a leap year
    expect(monthRange(2000, 2, far).end).toBe("2000-02-29"); // divisible by 400, a leap year
    expect(monthRange(2026, 4, far).end).toBe("2026-04-30");
    expect(monthRange(2026, 1, far).end).toBe("2026-01-31");
    expect(monthRange(2026, 12, far).end).toBe("2026-12-31");
  });

  it("walks months across a year boundary", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 3, -14)).toEqual({ year: 2025, month: 1 });
  });

  it("reads ?y= and ?m= together, defaulting each to the current one", () => {
    expect(parseYearMonth("2025", "3", today)).toEqual({ year: 2025, month: 3 });
    expect(parseYearMonth(undefined, undefined, today)).toEqual({ year: 2026, month: 10 });
    // One missing keeps the other: March of THIS year, and the chosen year's current month.
    expect(parseYearMonth(undefined, "3", today)).toEqual({ year: 2026, month: 3 });
    expect(parseYearMonth("2024", undefined, today)).toEqual({ year: 2024, month: 10 });
  });

  it("ignores values that are not a real year or month", () => {
    expect(parseYearMonth("abc", "13", today)).toEqual({ year: 2026, month: 10 });
    expect(parseYearMonth("1999", "0", today)).toEqual({ year: 2026, month: 10 });
    expect(parseYearMonth("2026.5", "2.5", today)).toEqual({ year: 2026, month: 10 });
    expect(parseYearMonth(["2025"], ["3"], today)).toEqual({ year: 2026, month: 10 });
  });

  it("offers years from the earliest on record through this year, newest first, never a future one", () => {
    expect(yearOptions(2024, 2026, 2026)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(2026, 2026, 2026)).toEqual([2026]);
    expect(yearOptions(null, 2026, 2026)).toEqual([2026]);
    // A history that starts later than "now" can't push the list into the future.
    expect(yearOptions(2030, 2026, 2026)).toEqual([2026]);
  });

  it("always includes the selected year, so a link to an old or odd year still shows it", () => {
    expect(yearOptions(2025, 2026, 2022)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(yearOptions(2024, 2026, 2027)).toEqual([2027, 2026, 2025, 2024]);
  });
});

describe("computeOverview — the agreed rules", () => {
  const range = { start: "2026-10-01", end: "2026-10-09" };

  it("counts expected working days and hours, excluding weekly offs, holidays and pre-join days", () => {
    const days = [
      day("2026-10-01"),
      day("2026-10-02", { code: "H", dayValue: 1, workedMinutes: 0 }), // holiday
      day("2026-10-03", { code: "W/O", dayValue: 1, workedMinutes: 0 }), // weekly off
      day("2026-10-04", { code: "–", dayValue: 0, workedMinutes: 0 }), // before joining
      day("2026-10-05"),
    ];
    const k = computeOverview(days, range, FULL_DAY);
    expect(k.expectedDays).toBe(2);
    expect(k.expectedMinutes).toBe(2 * FULL_DAY);
    expect(k.workedMinutes).toBe(1080);
    expect(k.balanceMinutes).toBe(1080 - 2 * FULL_DAY);
  });

  it("still expects approved-leave and comp-off days, but not worked off-days", () => {
    const days = [
      day("2026-10-01", { code: "PL", workedMinutes: 0 }),
      day("2026-10-02", { code: "LWP", dayValue: 0, workedMinutes: 0 }),
      day("2026-10-05", { code: "CO", workedMinutes: 0 }),
      day("2026-10-06", { code: "HP", dayValue: 2 }),
      day("2026-10-07", { code: "H-H/D", dayValue: 1.5, workedMinutes: 300 }),
    ];
    const k = computeOverview(days, range, FULL_DAY);
    expect(k.expectedDays).toBe(3);
    // The extra work on off-days is still hours worked.
    expect(k.workedMinutes).toBe(540 + 300);
  });

  it("effective days are days actually worked: P 1, H/D 0.5, HP 2, H-H/D 1.5 — not leave or off-days", () => {
    const days = [
      day("2026-10-01"), // P = 1
      day("2026-10-02", { code: "H/D", dayValue: 0.5, workedMinutes: 270 }),
      day("2026-10-05", { code: "HP", dayValue: 2 }),
      day("2026-10-06", { code: "H-H/D", dayValue: 1.5, workedMinutes: 300 }),
      day("2026-10-07", { code: "PL", workedMinutes: 0 }),
      day("2026-10-08", { code: "W/O", workedMinutes: 0 }),
      day("2026-10-09", { code: "incomplete", dayValue: 0, workedMinutes: 120 }),
    ];
    expect(computeOverview(days, range, FULL_DAY).effectiveDays).toBe(1 + 0.5 + 2 + 1.5);
  });

  it("counts half days and forgiven lates", () => {
    const days = [
      day("2026-10-01", { code: "H/D", dayValue: 0.5, workedMinutes: 270 }),
      day("2026-10-02", { late: true, lateWaived: true }),
      day("2026-10-05", { late: true, lateWaived: true }),
      day("2026-10-06", { late: true }),
    ];
    const k = computeOverview(days, range, FULL_DAY);
    expect(k.halfDays).toBe(1);
    expect(k.graceCondoned).toBe(2);
  });

  it("only looks at days inside the range (nothing after today, nothing before the start)", () => {
    const days = [
      day("2026-09-30"),
      day("2026-10-09"),
      day("2026-10-10", { code: "A", dayValue: 0, workedMinutes: 0 }), // future, graded Absent
    ];
    const k = computeOverview(days, range, FULL_DAY);
    expect(k.expectedDays).toBe(1);
    expect(k.lostBreakdown.absent).toBe(0);
  });

  it("salary lost is in days: absent + unpaid leave + ½ per half day + the monthly late deduction", () => {
    const days = [
      day("2026-10-01", { code: "A", dayValue: 0, workedMinutes: 0 }),
      day("2026-10-02", { code: "LWP", dayValue: 0, workedMinutes: 0 }),
      day("2026-10-05", { code: "H/D", dayValue: 0.5, workedMinutes: 270 }),
      // Three un-waived lates in October → ½ day; a waived one doesn't count.
      day("2026-10-06", { late: true }),
      day("2026-10-07", { late: true }),
      day("2026-10-08", { late: true }),
      day("2026-10-09", { late: true, lateWaived: true }),
    ];
    const k = computeOverview(days, range, FULL_DAY);
    expect(k.lostBreakdown).toEqual({
      absent: 1,
      unpaidLeave: 1,
      halfDayShortfall: 0.5,
      lateDeduction: 0.5,
    });
    expect(k.lostDays).toBe(3);
  });

  it("applies the late rule per month, never across months", () => {
    const days = [
      day("2026-09-10", { late: true }),
      day("2026-09-11", { late: true }),
      day("2026-10-01", { late: true }),
    ];
    // Three lates in all, but two + one — no month reaches three.
    const k = computeOverview(days, { start: "2026-09-01", end: "2026-10-09" }, FULL_DAY);
    expect(k.lostBreakdown.lateDeduction).toBe(0);
  });

  it("reports nothing for a month that hasn't started", () => {
    const days = [day("2026-11-02", { code: "A", dayValue: 0, workedMinutes: 0 })];
    const k = computeOverview(days, monthRange(2026, 11, "2026-10-09"), FULL_DAY);
    expect(k.expectedDays).toBe(0);
    expect(k.lostDays).toBe(0);
  });

  it("reports a whole past month, however long, from the selected month's days only", () => {
    const feb = Array.from({ length: 29 }, (_, i) =>
      day(`2024-02-${String(i + 1).padStart(2, "0")}`, { code: "A", dayValue: 0, workedMinutes: 0 }),
    );
    const k = computeOverview([...feb, day("2024-03-01")], monthRange(2024, 2, "2026-10-09"), FULL_DAY);
    expect(k.lostBreakdown.absent).toBe(29);
    expect(k.workedMinutes).toBe(0);
  });

  it("is all zeroes for an empty range", () => {
    const k = computeOverview([], range, FULL_DAY);
    expect(k).toMatchObject({ workedMinutes: 0, expectedMinutes: 0, balanceMinutes: 0, effectiveDays: 0, lostDays: 0 });
  });
});

describe("formatting", () => {
  it("formats minutes and days", () => {
    expect(formatMinutes(0)).toBe("0h");
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120, true)).toBe("+2h");
    expect(formatMinutes(-90, true)).toBe("−1h 30m");
    expect(formatDays(2)).toBe("2");
    expect(formatDays(1.5)).toBe("1.5");
  });
});

describe("buildCalendar", () => {
  // October 2026 starts on a Thursday → three blank slots on a Monday-first grid.
  const oct = Array.from({ length: 31 }, (_, i) => {
    const d = `2026-10-${String(i + 1).padStart(2, "0")}`;
    return day(d, { workedMinutes: 60 });
  });

  it("aligns the 1st under the right weekday and pads to full weeks with the neighbouring months' dates", () => {
    const weeks = buildCalendar(oct, 2026, 10, "2026-10-09");
    // Mon 28 Sep, Tue 29, Wed 30 are real dates, flagged as outside the month.
    expect(weeks[0]!.cells.slice(0, 3).map((c) => [c.date, c.inMonth])).toEqual([
      ["2026-09-28", false],
      ["2026-09-29", false],
      ["2026-09-30", false],
    ]);
    expect(weeks[0]!.cells[3]).toMatchObject({ date: "2026-10-01", inMonth: true });
    for (const w of weeks) expect(w.cells).toHaveLength(7);
    const last = weeks[weeks.length - 1]!;
    expect(last.cells.filter((c) => c.inMonth).at(-1)!.date).toBe("2026-10-31");
    expect(last.cells.at(-1)!.date).toBe("2026-11-01"); // Sunday closes the row
  });

  it("gives outside-month days no status and no hours, even when data for them is loaded", () => {
    const withSep = [...oct, day("2026-09-30", { workedMinutes: 600 })];
    const first = buildCalendar(withSep, 2026, 10, "2026-10-09")[0]!;
    const outside = first.cells[2]!;
    expect(outside).toMatchObject({ inMonth: false, group: null, code: null, workedMinutes: 0 });
    expect(first.workedMinutes).toBe(4 * 60); // only 1–4 Oct
  });

  it("totals each week's hours from the days inside the month only", () => {
    const weeks = buildCalendar(oct, 2026, 10, "2026-10-09");
    expect(weeks[0]!.workedMinutes).toBe(4 * 60); // Thu 1 – Sun 4
    expect(weeks[1]!.workedMinutes).toBe(7 * 60);
  });

  it("shows no status for a future day, except holidays, weekly offs and leave", () => {
    const days = [
      day("2026-10-12", { code: "A", dayValue: 0, workedMinutes: 0 }),
      day("2026-10-13", { code: "H", workedMinutes: 0 }),
      day("2026-10-14", { code: "PL", workedMinutes: 0 }),
    ];
    const cells = buildCalendar(days, 2026, 10, "2026-10-09").flatMap((w) => w.cells);
    const by = Object.fromEntries(cells.map((c) => [c.date, c]));
    expect(by["2026-10-12"]!.group).toBeNull();
    expect(by["2026-10-13"]!.group).toBe("holiday");
    expect(by["2026-10-14"]!.group).toBe("leave");
  });

  it("marks today, and shows nothing for days before joining", () => {
    const days = [day("2026-10-08", { code: "–", dayValue: 0, workedMinutes: 0 }), day("2026-10-09")];
    const cells = buildCalendar(days, 2026, 10, "2026-10-09").flatMap((w) => w.cells);
    const by = Object.fromEntries(cells.map((c) => [c.date, c]));
    expect(by["2026-10-08"]!.group).toBeNull();
    expect(by["2026-10-09"]!.isToday).toBe(true);
    expect(by["2026-10-09"]!.group).toBe("present");
  });

  it("maps the worked-on-off-day codes together", () => {
    const days = [day("2026-10-05", { code: "HP", dayValue: 2 }), day("2026-10-06", { code: "H-H/D", dayValue: 1.5 })];
    const groups = buildCalendar(days, 2026, 10, "2026-10-09")
      .flatMap((w) => w.cells)
      .filter((c) => c.date === "2026-10-05" || c.date === "2026-10-06")
      .map((c) => c.group);
    expect(groups).toEqual(["offwork", "offwork"]);
  });

  it("always puts a Sunday in the seventh column, whatever the month", () => {
    // Feb 2026 starts on a Sunday; Oct 2026 on a Thursday; Feb 2024 is a leap
    // year; Aug 2026 needs six rows; Jan 2027 starts on a Friday.
    for (const [y, m] of [[2026, 2], [2026, 10], [2024, 2], [2026, 8], [2027, 1], [2025, 6]] as const) {
      for (const w of buildCalendar([], y, m, "2026-10-09")) {
        const sunday = w.cells[6]!;
        expect(new Date(sunday.date + "T12:00:00Z").getUTCDay()).toBe(0);
        // …and no other column is a Sunday.
        expect(w.cells.slice(0, 6).every((c) => new Date(c.date + "T12:00:00Z").getUTCDay() !== 0)).toBe(true);
      }
    }
  });

  it("handles a month that starts on Monday and one that needs six rows", () => {
    // June 2026 starts on a Monday; Aug 2026 starts on a Saturday and has 31 days → 6 weeks.
    expect(buildCalendar([], 2026, 6, "2026-06-30")[0]!.cells[0]).toMatchObject({ date: "2026-06-01", inMonth: true });
    expect(buildCalendar([], 2026, 8, "2026-08-31")).toHaveLength(6);
  });
});

describe("timeUntil", () => {
  it("reads in whole calendar days", () => {
    expect(timeUntil("2026-10-09", "2026-10-09")).toBe("Today");
    expect(timeUntil("2026-10-10", "2026-10-09")).toBe("Tomorrow");
    expect(timeUntil("2026-10-21", "2026-10-09")).toBe("In 12 days");
    expect(timeUntil("2027-01-09", "2026-10-09")).toBe("In 3 months");
  });
});

describe("greetingFor", () => {
  it("greets the signed-in employee by their own first name", () => {
    expect(greetingFor("Asha Rao")).toBe("Good to see you, Asha");
    expect(greetingFor("  Meera  ")).toBe("Good to see you, Meera");
  });

  it("falls back to a generic welcome when there is no usable name", () => {
    expect(greetingFor(null)).toBe("Welcome back");
    expect(greetingFor(undefined)).toBe("Welcome back");
    expect(greetingFor("   ")).toBe("Welcome back");
    expect(greetingFor("")).toBe("Welcome back");
  });
});

describe("selectUpcomingHolidays", () => {
  const h = (holidayDate: string, label: string, isActive = true) => ({ holidayDate, label, isActive });
  const rows = [
    h("2026-11-08", "Diwali"),
    h("2026-01-26", "Republic Day"),
    h("2026-10-20", "Dussehra"),
    h("2026-10-09", "Today's holiday"),
    h("2026-08-15", "Independence Day"),
    h("2026-12-25", "Switched off", false),
    h("2026-11-09", "Diwali"),
  ];

  it("keeps only active holidays from today onward, soonest first", () => {
    expect(selectUpcomingHolidays(rows, "2026-10-09").map((r) => r.holidayDate)).toEqual([
      "2026-10-09", "2026-10-20", "2026-11-08", "2026-11-09",
    ]);
  });

  it("drops a holiday the day after it, and shows nothing once the year is done", () => {
    expect(selectUpcomingHolidays(rows, "2026-10-10").map((r) => r.holidayDate)[0]).toBe("2026-10-20");
    expect(selectUpcomingHolidays(rows, "2026-11-10")).toEqual([]);
  });

  it("is decided by the date it is given, not a baked-in one", () => {
    expect(selectUpcomingHolidays(rows, "2026-01-01")).toHaveLength(6);
    expect(selectUpcomingHolidays(rows, "2026-08-16")[0]!.label).toBe("Today's holiday");
  });

  it("never lists an inactive holiday, keeps ties in a stable order, and honours the limit", () => {
    const tie = [h("2026-11-08", "B"), h("2026-11-08", "A")];
    expect(selectUpcomingHolidays(tie, "2026-10-09").map((r) => r.label)).toEqual(["A", "B"]);
    expect(selectUpcomingHolidays(rows, "2026-01-01", 2)).toHaveLength(2);
    expect(selectUpcomingHolidays(rows, "2026-12-01")).toEqual([]);
  });
});

describe("the published 2026 holiday list", () => {
  const weekday = (ymd: string) =>
    new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  it("has 13 settled holidays, each on the weekday the list prints, with no duplicate dates", () => {
    expect(HOLIDAYS_2026).toHaveLength(13);
    for (const x of HOLIDAYS_2026) expect(weekday(x.date)).toBe(x.weekday);
    expect(new Set(HOLIDAYS_2026.map((x) => x.date)).size).toBe(HOLIDAYS_2026.length);
  });

  it("is in chronological order and all in 2026", () => {
    const dates = HOLIDAYS_2026.map((x) => x.date);
    expect([...dates].sort()).toEqual(dates);
    for (const d of dates) expect(d.startsWith("2026-")).toBe(true);
  });

  it("marks exactly Gudi Padwa and Dussehra optional — nothing else", () => {
    expect(HOLIDAYS_2026.filter((x) => x.optional).map((x) => x.label)).toEqual(["Gudi Padwa", "Dussehra"]);
  });

  it("keeps the names as written on the list", () => {
    const labels = HOLIDAYS_2026.map((x) => x.label);
    expect(labels).toContain("Holi - Rang Panchami");
    expect(labels).toContain("Maharashtra Day & International Labour Day");
    expect(labels.filter((l) => l === "Diwali")).toHaveLength(2);
  });

  it("holds Eid Ul Fitr out: two candidate dates, both weekday-consistent, neither stored", () => {
    expect(HOLIDAYS_2026.some((x) => /eid/i.test(x.label))).toBe(false);
    const eid = HOLIDAYS_PENDING_CONFIRMATION[0]!;
    expect(eid.candidates.map((c) => c.date)).toEqual(["2026-03-20", "2026-03-21"]);
    for (const c of eid.candidates) expect(weekday(c.date)).toBe(c.weekday);
  });
});
