import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUE_DOW,
  TRACKER_PATH,
  WEEKLY_TASK_TITLE,
  dueAtFor,
  dueDayOf,
  isDueToday,
  isOverdueAt,
  reportingWeekFor,
  weekForUpload,
  weeklyTaskDescription,
  weeklyTaskState,
} from "@/lib/collections/weekly-upload/week";

// The weekly Bulk Upload policy: pure date rules in IST. No database.
// 2026-11-02 is a Monday; the week runs to Sunday 2026-11-08.

describe("reporting week — Monday to Sunday, IST", () => {
  it("a weekday maps to its Monday", () => {
    expect(reportingWeekFor(new Date("2026-11-04T10:00:00Z"))).toBe("2026-11-02"); // Wed 15:30 IST
    expect(reportingWeekFor(new Date("2026-11-02T00:30:00Z"))).toBe("2026-11-02"); // Mon 06:00 IST
  });
  it("Sunday night IST still belongs to the week; the next IST Monday starts a new one (even while it is Sunday in UTC)", () => {
    expect(reportingWeekFor(new Date("2026-11-08T17:00:00Z"))).toBe("2026-11-02"); // Sun 22:30 IST
    expect(reportingWeekFor(new Date("2026-11-08T19:00:00Z"))).toBe("2026-11-09"); // Mon 00:30 IST
  });
});

describe("due date — the configured weekday at noon IST (the Tasks module's convention)", () => {
  it("Friday by default", () => {
    expect(DEFAULT_DUE_DOW).toBe(5);
    expect(dueAtFor("2026-11-02").toISOString()).toBe("2026-11-06T06:30:00.000Z");
    expect(dueDayOf(dueAtFor("2026-11-02"))).toBe("2026-11-06");
  });
  it("any ISO weekday 1–7; an out-of-range value falls back to Friday", () => {
    expect(dueDayOf(dueAtFor("2026-11-02", 1))).toBe("2026-11-02");
    expect(dueDayOf(dueAtFor("2026-11-02", 7))).toBe("2026-11-08");
    expect(dueDayOf(dueAtFor("2026-11-02", 99))).toBe("2026-11-06");
    expect(dueDayOf(dueAtFor("2026-11-02", 0))).toBe("2026-11-06");
  });
});

describe("due today / overdue — by IST calendar day, never by the clock", () => {
  const due = dueAtFor("2026-11-02"); // Fri 6 Nov, noon IST
  it("the due day is 'due today' all day, including after noon", () => {
    expect(isDueToday(due, new Date("2026-11-06T02:00:00Z"))).toBe(true); // 07:30 IST
    expect(isDueToday(due, new Date("2026-11-06T17:30:00Z"))).toBe(true); // 23:00 IST
    expect(isOverdueAt(due, new Date("2026-11-06T17:30:00Z"))).toBe(false);
  });
  it("overdue from the next IST day", () => {
    expect(isOverdueAt(due, new Date("2026-11-06T19:00:00Z"))).toBe(true); // Sat 00:30 IST
    expect(isDueToday(due, new Date("2026-11-06T19:00:00Z"))).toBe(false);
    expect(isOverdueAt(due, new Date("2026-11-05T12:00:00Z"))).toBe(false);
  });
});

describe("which week an upload completes", () => {
  const confirmed = new Date("2026-11-04T10:00:00Z"); // Wed 4 Nov
  it("a file current to this week completes this week", () => {
    expect(weekForUpload({ periodTo: "2026-11-04", uploadedAt: confirmed })).toBe("2026-11-02");
    expect(weekForUpload({ periodTo: "2026-11-02", uploadedAt: confirmed })).toBe("2026-11-02");
  });
  it("a file whose period ended in an earlier week belongs to THAT week — never to the current one", () => {
    expect(weekForUpload({ periodTo: "2026-10-30", uploadedAt: confirmed })).toBe("2026-10-26");
    expect(weekForUpload({ periodTo: "2026-09-01", uploadedAt: confirmed })).toBe("2026-08-31");
  });
  it("no printed period, or a period ending after the upload (a financial-year end), counts as current", () => {
    expect(weekForUpload({ periodTo: null, uploadedAt: confirmed })).toBe("2026-11-02");
    expect(weekForUpload({ periodTo: "2027-03-31", uploadedAt: confirmed })).toBe("2026-11-02");
    expect(weekForUpload({ periodTo: "2026-11-12", uploadedAt: confirmed })).toBe("2026-11-02");
  });
});

describe("the week's state follows the task", () => {
  const due = dueAtFor("2026-11-02");
  const before = new Date("2026-11-04T10:00:00Z");
  const after = new Date("2026-11-09T04:00:00Z");
  it("done or approved (or a recorded completion) is completed, whatever the date", () => {
    expect(weeklyTaskState({ taskStatus: "done", completedAt: null, dueAt: due }, after)).toBe("completed");
    expect(weeklyTaskState({ taskStatus: "approved", completedAt: null, dueAt: due }, after)).toBe("completed");
    expect(weeklyTaskState({ taskStatus: "not_started", completedAt: new Date(), dueAt: due }, after)).toBe("completed");
  });
  it("open before the due day: pending until the doer moves it, then in progress", () => {
    expect(weeklyTaskState({ taskStatus: "not_started", completedAt: null, dueAt: due }, before)).toBe("pending");
    expect(weeklyTaskState({ taskStatus: "dont_know", completedAt: null, dueAt: due }, before)).toBe("pending");
    expect(weeklyTaskState({ taskStatus: "follow_up", completedAt: null, dueAt: due }, before)).toBe("in_progress");
  });
  it("open after the due day is overdue — the original due date and assignment are untouched", () => {
    expect(weeklyTaskState({ taskStatus: "not_started", completedAt: null, dueAt: due }, after)).toBe("overdue");
    expect(weeklyTaskState({ taskStatus: "follow_up", completedAt: null, dueAt: due }, after)).toBe("overdue");
  });
});

describe("the task text", () => {
  it("names the week, the due date, the steps and the link, and says how it is completed", () => {
    const text = weeklyTaskDescription("2026-11-02", dueAtFor("2026-11-02"), `https://wms.example.test${TRACKER_PATH}`);
    expect(WEEKLY_TASK_TITLE).toBe("Complete Weekly Collection Tracker Bulk Upload");
    expect(text).toContain("2026-11-02 to Sunday 2026-11-08");
    expect(text).toContain("Fri, 6 Nov 2026");
    expect(text).toContain("https://wms.example.test/forms/collection/tracker");
    expect(text).toMatch(/Preview upload/);
    expect(text).toMatch(/completed automatically when the upload is confirmed/);
    expect(text).toMatch(/Previewing a file does not complete it/);
    expect(text).not.toMatch(/@|mihir|bhavisha/i);
  });
});
