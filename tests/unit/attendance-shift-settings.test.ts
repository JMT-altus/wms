import { describe, expect, it } from "vitest";
import {
  describeGrace,
  describeShifts,
  pickShift,
  resolveShiftSettings,
  scheduleOn,
  shiftSchedule,
  validateGrace,
  validateShifts,
  type WorkShift,
} from "@/lib/attendance/shift-settings";
import { computeDayCode } from "@/lib/attendance/status";
import type { PolicyChange } from "@/lib/attendance/policy";

// Pure rules for Admin Panel → Attendance Settings. Times below are test data, not company rules.
const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const D1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const shift = (over: Partial<WorkShift> = {}): WorkShift => ({
  id: "general", name: "General", start: "09:00", end: "18:00", workingHours: 8.5, active: true, isDefault: true, employeeIds: [], departmentIds: [], ...over,
});
const legacy = { lateAfter: "10:50", earlyBefore: "19:20", fullDayMinutes: 540, halfDayMinutes: 300 };
const change = (key: string, value: unknown, effectiveFrom: string, createdAt = "2026-01-01T00:00:00Z"): PolicyChange =>
  ({ key, value: value as never, effectiveFrom, createdAt: new Date(createdAt) });
const noOverride = { id: E1, attLateAfter: null, attEarlyBefore: null };

describe("validation", () => {
  it("accepts a sound shift list", () => {
    const r = validateShifts({ shifts: [shift(), shift({ id: "store", name: "Store", start: "10:00", end: "19:00", workingHours: 8, isDefault: false, employeeIds: [E1] })] });
    expect(r.ok).toBe(true);
  });
  it.each([
    [{ shifts: [shift({ name: " " })] }, /name/],
    [{ shifts: [shift({ start: "18:00", end: "09:00" })] }, /end time must be after/],
    [{ shifts: [shift({ start: "9:00" })] }, /start and end/],
    [{ shifts: [shift({ workingHours: 10 })] }, /longer than the shift/],
    [{ shifts: [shift({ workingHours: 8.3 })] }, /quarter hours/],
    [{ shifts: [shift(), shift({ id: "b", name: "General" })] }, /Two shifts/],
    [{ shifts: [shift(), shift({ id: "b", name: "B" })] }, /Only one active shift can be the default/],
    [{ shifts: [shift({ employeeIds: [E1] }), shift({ id: "b", name: "B", isDefault: false, employeeIds: [E1] })] }, /assigned to both/],
    [{ shifts: [shift({ employeeIds: ["not-a-uuid"] })] }, /invalid employee/],
  ])("rejects %#", (v, msg) => {
    const r = validateShifts(v);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(msg);
  });
  it("grace: whole minutes 0–240 with an on/off switch", () => {
    expect(validateGrace({ enabled: true, minutes: 15 })).toEqual({ ok: true, value: { enabled: true, minutes: 15 } });
    expect(validateGrace({ enabled: true, minutes: 7.5 }).ok).toBe(false);
    expect(validateGrace({ enabled: true, minutes: 241 }).ok).toBe(false);
    expect(validateGrace({ minutes: 5 }).ok).toBe(false);
  });
  it("an inactive shift may share employees and is never the default", () => {
    const r = validateShifts({ shifts: [shift({ employeeIds: [E1] }), shift({ id: "old", name: "Old", active: false, isDefault: true, employeeIds: [E1] })] });
    expect(r.ok && r.value.shifts[1]!.isDefault).toBe(false);
  });
});

describe("effective dates", () => {
  const changes = [
    change("work_shifts", { shifts: [shift()] }, "2026-03-10"),
    change("check_in_grace", { enabled: true, minutes: 10 }, "2026-03-10"),
    change("check_in_grace", { enabled: true, minutes: 15 }, "2026-03-20"),
    change("check_in_grace", { enabled: true, minutes: 20 }, "2026-03-20", "2026-03-15T00:00:00Z"), // recorded later, same date: wins
    change("approved_leave_payment", "unpaid", "2026-01-01"), // a payroll-policy key is ignored here
  ];
  it("before the first effective date nothing is configured", () => {
    expect(resolveShiftSettings(changes, "2026-03-09")).toEqual({ shifts: null, checkIn: null, checkOut: null, hoursHighlight: null });
  });
  it("each key takes the latest change in force on the date", () => {
    expect(resolveShiftSettings(changes, "2026-03-15").checkIn).toEqual({ enabled: true, minutes: 10 });
    expect(resolveShiftSettings(changes, "2026-03-20").checkIn).toEqual({ enabled: true, minutes: 20 });
    expect(resolveShiftSettings(changes, "2026-03-20").checkOut).toBeNull();
  });
});

describe("which shift applies", () => {
  const list = { shifts: [shift(), shift({ id: "d", name: "Dept", isDefault: false, start: "08:00", end: "17:00", departmentIds: [D1] }), shift({ id: "p", name: "Person", isDefault: false, start: "11:00", end: "20:00", employeeIds: [E1] })] };
  it("employee assignment, then department, then the default", () => {
    expect(pickShift(list, E1, [D1])!.name).toBe("Person");
    expect(pickShift(list, E2, [D1])!.name).toBe("Dept");
    expect(pickShift(list, E2, [])!.name).toBe("General");
  });
  it("an inactive shift is never picked; no default and no assignment → none", () => {
    expect(pickShift({ shifts: [shift({ active: false, isDefault: false, employeeIds: [E2] })] }, E2, [])).toBeNull();
    expect(pickShift({ shifts: [shift({ isDefault: false })] }, E2, [])).toBeNull();
  });
});

describe("schedule and grading boundaries", () => {
  it("check-in exactly at start + grace is on time, a minute later is late", () => {
    const s = shiftSchedule(shift(), { enabled: true, minutes: 15 }, null, 300);
    expect(s.lateAfter).toBe("09:15");
    const day = (inAt: string) => computeDayCode({ inAt, outAt: "18:30" }, s, { isWeeklyOff: false, isHoliday: false, leave: null, compOffRedeemed: false }, "23:59");
    expect(day("09:15").late).toBe(false);
    expect(day("09:16").late).toBe(true);
  });
  it("disabled grace means the shift start itself", () => {
    expect(shiftSchedule(shift(), { enabled: false, minutes: 15 }, null, 300).lateAfter).toBe("09:00");
  });
  it("check-out at end − grace is on time, a minute earlier is 'left early'; with no grace the end itself is on time", () => {
    const grade = (outAt: string, minutes: number | null) =>
      computeDayCode({ inAt: "09:00", outAt }, shiftSchedule(shift(), null, minutes === null ? null : { enabled: true, minutes }, 300), { isWeeklyOff: false, isHoliday: false, leave: null, compOffRedeemed: false }, "23:59").leftEarly;
    expect(grade("18:00", null)).toBe(false);
    expect(grade("17:59", null)).toBe(true);
    expect(grade("17:50", 10)).toBe(false);
    expect(grade("17:49", 10)).toBe(true);
  });
  it("the shift's working hours are the full day; the half day stays the company threshold", () => {
    const s = shiftSchedule(shift({ workingHours: 8 }), null, null, 300);
    expect(s).toMatchObject({ fullDayMinutes: 480, halfDayMinutes: 300 });
  });
});

describe("scheduleOn", () => {
  it("nothing configured → the legacy company times, unchanged", () => {
    const { shift: picked, ...s } = scheduleOn({ shifts: null, checkIn: { enabled: true, minutes: 15 }, checkOut: null, hoursHighlight: null }, legacy, noOverride, []);
    expect(picked).toBeNull();
    expect(s).toEqual(legacy);
  });
  it("a shift with grace replaces the company times", () => {
    const s = scheduleOn({ shifts: { shifts: [shift()] }, checkIn: { enabled: true, minutes: 15 }, checkOut: { enabled: true, minutes: 10 }, hoursHighlight: null }, legacy, noOverride, []);
    expect(s).toMatchObject({ lateAfter: "09:15", earlyBefore: "17:49", fullDayMinutes: 510, halfDayMinutes: 300 });
  });
  it("an employee's personal late / early times still win, as before", () => {
    const s = scheduleOn({ shifts: { shifts: [shift()] }, checkIn: null, checkOut: null, hoursHighlight: null }, legacy, { id: E1, attLateAfter: "09:30", attEarlyBefore: null }, []);
    expect(s.lateAfter).toBe("09:30");
    expect(s.earlyBefore).toBe("17:59");
  });
});

describe("history descriptions", () => {
  it("reads plainly", () => {
    expect(describeShifts(null)).toBe("Not set — company times");
    expect(describeShifts({ shifts: [shift({ employeeIds: [E1, E2] })] })).toBe("General 09:00–18:00 (8.5 h, default, 2 employees)");
    expect(describeGrace({ enabled: true, minutes: 15 })).toBe("On · 15 min");
    expect(describeGrace({ enabled: false, minutes: 5 })).toBe("Off (5 min kept)");
  });
});
