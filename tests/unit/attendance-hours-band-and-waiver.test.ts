import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hoursBand, workedFromPunches } from "@/lib/attendance/hours-band";
import { DEFAULT_HOURS_HIGHLIGHT, describeHoursHighlight, resolveShiftSettings, validateHoursHighlight } from "@/lib/attendance/shift-settings";
import { applyWaiver, isWaivableCode } from "@/lib/attendance/waiver";
import { computeSalary } from "@/lib/salary/compute";
import type { DayCodeResult } from "@/lib/attendance/status";
import type { PolicyChange } from "@/lib/attendance/policy";

// Daily hours highlight (display only) and the waiver grading rule. Pure functions — no database.

describe("hours highlight bands (defaults: yellow below 8h30m, green above 9h30m, both limits normal)", () => {
  it("starts at 8h30m / 9h30m until Attendance Settings saves other limits", () => {
    expect(DEFAULT_HOURS_HIGHLIGHT).toEqual({ shortBelowMinutes: 510, longAboveMinutes: 570 });
  });
  it.each([
    ["09:00", "17:30", null, "exactly 8:30 is normal"],
    ["09:00", "17:29", "short", "below 8:30 is yellow"],
    ["09:00", "18:30", null, "exactly 9:30 is normal"],
    ["09:00", "18:31", "long", "above 9:30 is green"],
    ["09:00", "18:00", null, "9:00 is normal"],
    ["10:15", "13:00", "short", "a short half day is yellow"],
  ])("%s → %s: %s (%s)", (inAt, outAt, band, _why) => {
    void _why;
    expect(hoursBand(inAt, outAt)).toBe(band);
  });
  it("a missing check-in or check-out is never a completed duration (no colour, no hours)", () => {
    expect(hoursBand("09:00", null)).toBeNull();
    expect(hoursBand(null, "18:00")).toBeNull();
    expect(hoursBand(null, null)).toBeNull();
    expect(workedFromPunches("09:00", null)).toBeNull();
    expect(workedFromPunches("18:00", "09:00")).toBeNull(); // out before in: not a duration
  });
  it("uses saved limits when given", () => {
    expect(hoursBand("09:00", "17:00", { shortBelowMinutes: 480, longAboveMinutes: 540 })).toBeNull(); // exactly 8:00
    expect(hoursBand("09:00", "18:01", { shortBelowMinutes: 480, longAboveMinutes: 540 })).toBe("long");
  });
});

describe("hours highlight setting", () => {
  it("validates whole minutes, short ≤ long", () => {
    expect(validateHoursHighlight({ shortBelowMinutes: 480, longAboveMinutes: 600 })).toEqual({ ok: true, value: { shortBelowMinutes: 480, longAboveMinutes: 600 } });
    expect(validateHoursHighlight({ shortBelowMinutes: 600, longAboveMinutes: 480 }).ok).toBe(false);
    expect(validateHoursHighlight({ shortBelowMinutes: 480.5, longAboveMinutes: 600 }).ok).toBe(false);
    expect(validateHoursHighlight({ shortBelowMinutes: 480 }).ok).toBe(false);
  });
  it("is effective-dated like the other settings", () => {
    const changes: PolicyChange[] = [{ key: "hours_highlight", value: { shortBelowMinutes: 480, longAboveMinutes: 540 } as never, effectiveFrom: "2026-03-10", createdAt: new Date("2026-03-01") }];
    expect(resolveShiftSettings(changes, "2026-03-09").hoursHighlight).toBeNull();
    expect(resolveShiftSettings(changes, "2026-03-10").hoursHighlight).toEqual({ shortBelowMinutes: 480, longAboveMinutes: 540 });
  });
  it("reads plainly in the history", () => {
    expect(describeHoursHighlight({ shortBelowMinutes: 510, longAboveMinutes: 570 })).toBe("Yellow below 8h 30m · green above 9h 30m");
  });
});

describe("waiver grading rule (approved treatment: a paid full day with no late/early mark)", () => {
  const day = (over: Partial<DayCodeResult>): DayCodeResult => ({ code: "P", dayValue: 1, late: false, leftEarly: false, lateWaived: false, workedMinutes: 0, ...over });
  it("absent, half day and no check-out become WV = 1 payable day; recorded hours are kept", () => {
    expect(applyWaiver(day({ code: "A", dayValue: 0 }))).toMatchObject({ code: "WV", dayValue: 1 });
    expect(applyWaiver(day({ code: "H/D", dayValue: 0.5, workedMinutes: 240 }))).toMatchObject({ code: "WV", dayValue: 1, workedMinutes: 240 });
    expect(applyWaiver(day({ code: "incomplete", dayValue: 0, workedMinutes: 300 }))).toMatchObject({ code: "WV", dayValue: 1, workedMinutes: 300 });
  });
  it("a late or early present day loses its marks, so it never counts toward the every-3rd-late deduction", () => {
    expect(applyWaiver(day({ late: true, leftEarly: true, workedMinutes: 500 }))).toEqual({ code: "WV", dayValue: 1, late: false, leftEarly: false, lateWaived: false, workedMinutes: 500 });
  });
  it("holidays, weekly offs, leave, comp-off and worked off-days keep their own grade", () => {
    for (const code of ["W/O", "H", "HP", "H-H/D", "PL", "LWP", "CO"] as const) {
      expect(isWaivableCode(code)).toBe(false);
      expect(applyWaiver(day({ code, dayValue: code === "HP" ? 2 : 1 })).code).toBe(code);
    }
  });
  it("salary effect: an absent day waived adds one day's pay; a waived late removes its share of the late deduction", () => {
    const base = { annualCtc: 372000, daysInMonth: 31, ptExempt: true, tdsMonthly: 0, advances: 0, pendingBalanceIn: 0 };
    const before = computeSalary({ ...base, payableDays: 25, lateMarksInMonth: 3 });
    const after = computeSalary({ ...base, payableDays: 26, lateMarksInMonth: 2 }); // one absence waived, one late waived
    expect(before.lateDeductionDays).toBe(0.5);
    expect(after.lateDeductionDays).toBe(0);
    expect(after.effectiveDays - before.effectiveDays).toBe(1.5);
  });
});
