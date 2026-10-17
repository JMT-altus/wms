import { describe, expect, it } from "vitest";
import {
  businessDate,
  calendarDaysBetween,
  evaluateOverdue,
  msUntilNextBusinessDay,
  partyOverdue,
  worstLevel,
  ymdToUtc,
} from "@/lib/collections/overdue";
import { COLLECTION_RULES, type CollectionRules } from "@/lib/collections/config";

const TODAY = "2026-10-17";
const due = (dueDate: string | null, more: { status?: string | null; outstanding?: number | null } = {}) =>
  evaluateOverdue({ dueDate, ...more }, TODAY);

describe("overdue boundaries", () => {
  it("not yet due, due today and 1 day overdue: no highlight", () => {
    expect(due("2026-10-20")).toMatchObject({ level: "none", reason: "not-due", daysOverdue: -3 });
    expect(due("2026-10-17")).toMatchObject({ level: "none", reason: "not-due", daysOverdue: 0 });
    expect(due("2026-10-16")).toMatchObject({ level: "none", daysOverdue: 1 });
  });
  it("exactly 2 days overdue: yellow (warning)", () => {
    expect(due("2026-10-15")).toEqual({ level: "warning", daysOverdue: 2, reason: "overdue" });
  });
  it("3 or more days overdue: red (critical)", () => {
    expect(due("2026-10-14")).toEqual({ level: "critical", daysOverdue: 3, reason: "overdue" });
    expect(due("2025-01-01").level).toBe("critical");
  });
  it("counts across month and year ends and leap days without off-by-one", () => {
    expect(evaluateOverdue({ dueDate: "2026-09-29" }, "2026-10-01")).toMatchObject({ level: "warning", daysOverdue: 2 });
    expect(evaluateOverdue({ dueDate: "2025-12-30" }, "2026-01-01")).toMatchObject({ level: "warning", daysOverdue: 2 });
    expect(evaluateOverdue({ dueDate: "2028-02-28" }, "2028-03-01")).toMatchObject({ level: "warning", daysOverdue: 2 });
    expect(evaluateOverdue({ dueDate: "2027-02-28" }, "2027-03-01")).toMatchObject({ level: "none", daysOverdue: 1 });
  });
});

describe("paid, settled and partial records", () => {
  it("paid or settled records are never highlighted, whatever the case of the word", () => {
    expect(due("2026-01-01", { status: "Paid" })).toMatchObject({ level: "none", reason: "settled" });
    expect(due("2026-01-01", { status: " SETTLED " })).toMatchObject({ level: "none", reason: "settled" });
  });
  it("a zero or negative outstanding balance counts as fully paid", () => {
    expect(due("2026-01-01", { outstanding: 0 })).toMatchObject({ level: "none", reason: "fully-paid" });
    expect(due("2026-01-01", { outstanding: -5 })).toMatchObject({ level: "none", reason: "fully-paid" });
  });
  it("a partially paid record with a balance left is still highlighted", () => {
    expect(due("2026-10-15", { status: "Partially paid", outstanding: 250 })).toMatchObject({ level: "warning" });
    expect(due("2026-10-10", { status: "partial", outstanding: 1 })).toMatchObject({ level: "critical" });
  });
});

describe("no fabricated status", () => {
  it("no due date, or an impossible one, means no highlight", () => {
    expect(due(null)).toEqual({ level: "none", daysOverdue: null, reason: "no-due-date" });
    expect(due("  ")).toMatchObject({ reason: "no-due-date" });
    expect(due("2026-02-30")).toMatchObject({ level: "none", reason: "invalid-due-date" });
    expect(due("15/10/2026")).toMatchObject({ level: "none", reason: "invalid-due-date" });
  });
  it("a company with no transactions is not highlighted", () => {
    expect(partyOverdue([], TODAY)).toEqual({ level: "none", daysOverdue: null });
    expect(partyOverdue(undefined, TODAY)).toEqual({ level: "none", daysOverdue: null });
  });
  it("a company takes the worst of its transactions", () => {
    const r = partyOverdue(
      [{ dueDate: "2026-10-15" }, { dueDate: "2026-10-01", status: "paid" }, { dueDate: "2026-10-12", outstanding: 10 }, { dueDate: null }],
      TODAY,
    );
    expect(r).toEqual({ level: "critical", daysOverdue: 5 });
    expect(worstLevel("warning", "none")).toBe("warning");
    expect(worstLevel("warning", "critical")).toBe("critical");
  });
});

describe("configurable rules", () => {
  it("thresholds and settled words come from the rules object", () => {
    const rules: CollectionRules = { ...COLLECTION_RULES, overdue: { warningFromDays: 5, criticalFromDays: 10 }, settledStatuses: ["closed"] };
    expect(evaluateOverdue({ dueDate: "2026-10-15" }, TODAY, rules).level).toBe("none");
    expect(evaluateOverdue({ dueDate: "2026-10-12" }, TODAY, rules).level).toBe("warning");
    expect(evaluateOverdue({ dueDate: "2026-10-07" }, TODAY, rules).level).toBe("critical");
    expect(evaluateOverdue({ dueDate: "2026-10-01", status: "closed" }, TODAY, rules).reason).toBe("settled");
    expect(evaluateOverdue({ dueDate: "2026-10-01", status: "paid" }, TODAY, rules).level).toBe("critical");
  });
  it("defaults: India time, yellow from 2 days, red from 3", () => {
    expect(COLLECTION_RULES.timeZone).toBe("Asia/Kolkata");
    expect(COLLECTION_RULES.overdue).toEqual({ warningFromDays: 2, criticalFromDays: 3 });
  });
});

describe("India business date", () => {
  it("uses the India calendar date, not UTC or the machine's zone", () => {
    // 18:29 UTC = 23:59 IST (same day); 18:30 UTC = 00:00 IST next day.
    expect(businessDate(new Date("2026-10-16T18:29:00Z"))).toBe("2026-10-16");
    expect(businessDate(new Date("2026-10-16T18:30:00Z"))).toBe("2026-10-17");
    // Early UTC morning is already later the same India day.
    expect(businessDate(new Date("2026-10-17T00:30:00Z"))).toBe("2026-10-17");
  });
  it("a due date 2 days back turns yellow exactly at India midnight", () => {
    const before = businessDate(new Date("2026-10-16T18:29:59Z"));
    const after = businessDate(new Date("2026-10-16T18:30:00Z"));
    expect(evaluateOverdue({ dueDate: "2026-10-15" }, before).level).toBe("none");
    expect(evaluateOverdue({ dueDate: "2026-10-15" }, after).level).toBe("warning");
  });
  it("knows how long until the next India midnight", () => {
    const ms = msUntilNextBusinessDay(new Date("2026-10-16T18:00:00Z")); // 23:30 IST
    expect(Math.abs(ms - 30 * 60_000)).toBeLessThanOrEqual(60_000);
  });
  it("date helpers reject impossible dates and count whole days", () => {
    expect(ymdToUtc("2026-13-01")).toBeNull();
    expect(ymdToUtc("2026-10-17")).toBe(Date.UTC(2026, 9, 17));
    expect(calendarDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});
