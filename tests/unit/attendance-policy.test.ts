import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLICY_DEFS,
  earliestEffectiveDate,
  resolvePolicy,
  validatePolicyValue,
  type PolicyChange,
  type PolicyValues,
} from "@/lib/attendance/policy";
import { computeWorkingDays, dailyRate, dayPay } from "@/lib/attendance/payroll-rules";

const defaults = (over: Partial<Record<string, unknown>> = {}): PolicyValues =>
  ({ ...resolvePolicy([], "2026-01-01"), ...over }) as PolicyValues;

const change = (key: string, value: PolicyChange["value"], effectiveFrom: string, at = "2026-01-01T00:00:00Z"): PolicyChange => ({
  key,
  value,
  effectiveFrom,
  createdAt: new Date(at),
});

describe("policy definitions", () => {
  it("every setting has a valid initial value under its own validator", () => {
    for (const d of POLICY_DEFS) {
      expect(validatePolicyValue(d.key, d.default).ok, d.key).toBe(true);
    }
  });
  it("starts with Sir's rules and flags the unconfirmed ones", () => {
    const p = defaults();
    expect(p.working_day_method).toBe("calendar_minus_offs");
    expect(p.weekly_off_days).toEqual([0]);
    expect(p.optional_holidays_reduce_working_days).toBe(true);
    expect(p.daily_rate_divisor).toBe("working_days");
    const pending = POLICY_DEFS.filter((d) => d.status === "pending").map((d) => d.key);
    expect(pending).toContain("optional_holiday_work_basis");
    expect(pending).toContain("weekly_off_work_extra_days");
  });
  it("rejects bad values", () => {
    expect(validatePolicyValue("nope", 1).ok).toBe(false);
    expect(validatePolicyValue("weekly_off_days", [7]).ok).toBe(false);
    expect(validatePolicyValue("daily_rate_divisor", "weekly").ok).toBe(false);
    expect(validatePolicyValue("unapproved_absence_multiplier", -1).ok).toBe(false);
    expect(validatePolicyValue("comoff_expiry_days", null).ok).toBe(true); // nullable
    expect(validatePolicyValue("fixed_working_days", null).ok).toBe(false); // not nullable
  });
});

describe("effective dates", () => {
  it("a change applies only from its effective date, so earlier months keep the old value", () => {
    const changes = [change("optional_holiday_work_multiplier", 3, "2026-11-01")];
    expect(resolvePolicy(changes, "2026-10-31").optional_holiday_work_multiplier).toBe(2);
    expect(resolvePolicy(changes, "2026-11-01").optional_holiday_work_multiplier).toBe(3);
  });
  it("the latest applicable change wins; ties go to the one recorded last", () => {
    const changes = [
      change("optional_holiday_work_multiplier", 3, "2026-11-01", "2026-10-01T00:00:00Z"),
      change("optional_holiday_work_multiplier", 4, "2026-11-01", "2026-10-02T00:00:00Z"),
      change("optional_holiday_work_multiplier", 5, "2027-01-01"),
    ];
    expect(resolvePolicy(changes, "2026-12-01").optional_holiday_work_multiplier).toBe(4);
    expect(resolvePolicy(changes, "2027-01-01").optional_holiday_work_multiplier).toBe(5);
  });
  it("a change can't take effect before the start of the current month", () => {
    expect(earliestEffectiveDate("2026-10-12")).toBe("2026-10-01");
  });
});

describe("working days", () => {
  it("Sir's example: 31 − 4 Sundays − 2 public − 1 optional = 24", () => {
    // October 2026 has 31 days and Sundays on 4, 11, 18, 25.
    const r = computeWorkingDays({
      year: 2026,
      month: 10,
      holidays: [
        { date: "2026-10-02", optional: false },
        { date: "2026-10-20", optional: false },
        { date: "2026-10-14", optional: true },
      ],
      policy: defaults(),
    });
    expect(r).toMatchObject({ calendarDays: 31, weeklyOffs: 4, publicHolidays: 2, optionalHolidays: 1, workingDays: 24 });
  });
  it("a holiday on a Sunday, or listed twice, is deducted once", () => {
    const r = computeWorkingDays({
      year: 2026,
      month: 10,
      holidays: [
        { date: "2026-10-04", optional: false }, // a Sunday
        { date: "2026-10-02", optional: false },
        { date: "2026-10-02", optional: false }, // duplicate
        { date: "2026-10-11", optional: true }, // optional on a Sunday
        { date: "2026-10-02", optional: true }, // optional AND public: counts as public
      ],
      policy: defaults(),
    });
    expect(r.weeklyOffs).toBe(4);
    expect(r.publicHolidays).toBe(1);
    expect(r.optionalHolidays).toBe(0);
    expect(r.deducted).toBe(5);
    expect(r.workingDays).toBe(26);
  });
  it("works across month lengths, including February in a leap year", () => {
    expect(computeWorkingDays({ year: 2028, month: 2, holidays: [], policy: defaults() }).calendarDays).toBe(29);
    expect(computeWorkingDays({ year: 2026, month: 2, holidays: [], policy: defaults() })).toMatchObject({
      calendarDays: 28,
      weeklyOffs: 4,
      workingDays: 24,
    });
  });
  it("ignores holidays from other months", () => {
    const r = computeWorkingDays({ year: 2026, month: 10, holidays: [{ date: "2026-11-02", optional: false }], policy: defaults() });
    expect(r.publicHolidays).toBe(0);
  });
  it("follows the configured weekly offs, optional-holiday setting and method", () => {
    const sat = computeWorkingDays({ year: 2026, month: 10, holidays: [], policy: defaults({ weekly_off_days: [0, 6] }) });
    expect(sat.weeklyOffs).toBe(9);
    const keepOptional = computeWorkingDays({
      year: 2026,
      month: 10,
      holidays: [{ date: "2026-10-14", optional: true }],
      policy: defaults({ optional_holidays_reduce_working_days: false }),
    });
    expect(keepOptional.workingDays).toBe(27);
    expect(computeWorkingDays({ year: 2026, month: 10, holidays: [], policy: defaults({ working_day_method: "calendar_days" }) }).workingDays).toBe(31);
    expect(computeWorkingDays({ year: 2026, month: 10, holidays: [], policy: defaults({ working_day_method: "fixed", fixed_working_days: 26 }) }).workingDays).toBe(26);
  });
});

describe("daily rate", () => {
  const days = { calendarDays: 31, workingDays: 24 };
  it("is monthly salary ÷ working days by default", () => {
    expect(dailyRate(48000, days, defaults())).toBe(2000);
  });
  it("uses whichever divisor is configured", () => {
    expect(dailyRate(31000, days, defaults({ daily_rate_divisor: "calendar_days" }))).toBe(1000);
    expect(dailyRate(30000, days, defaults({ daily_rate_divisor: "fixed_days", daily_rate_fixed_days: 30 }))).toBe(1000);
  });
  it("never divides by zero", () => {
    expect(dailyRate(48000, { calendarDays: 30, workingDays: 0 }, defaults())).toBeNull();
  });
});

describe("leave, absence, weekly-off work and optional holidays", () => {
  it("approved leave is paid by default; rejected or pending leave is just an absence", () => {
    const p = defaults();
    expect(dayPay({ kind: "working", worked: false, approvedLeave: true }, p)).toMatchObject({ deductionDays: 0 });
    // Pending/rejected leave never reaches here as approvedLeave, so it is an absence:
    expect(dayPay({ kind: "working", worked: false, approvedLeave: false }, p)).toMatchObject({ deductionDays: 1 });
  });
  it("the leave payment and absence deduction are configurable", () => {
    expect(dayPay({ kind: "working", worked: false, approvedLeave: true }, defaults({ approved_leave_payment: "unpaid" })).deductionDays).toBe(1);
    expect(dayPay({ kind: "working", worked: false }, defaults({ unapproved_absence_deduction: "none" })).deductionDays).toBe(0);
    expect(dayPay({ kind: "working", worked: false }, defaults({ unapproved_absence_multiplier: 2 })).deductionDays).toBe(2);
  });
  it("Sunday work: no extra pay with approved COM OFF, extra pay without", () => {
    const p = defaults();
    expect(dayPay({ kind: "weekly_off", worked: true, comOffApproved: true }, p).extraDays).toBe(0);
    expect(dayPay({ kind: "weekly_off", worked: true }, p).extraDays).toBe(1);
    expect(dayPay({ kind: "weekly_off", worked: true, comOffApproved: true }, defaults({ comoff_waives_weekly_off_extra_pay: false })).extraDays).toBe(1);
    expect(dayPay({ kind: "weekly_off", worked: false }, p).extraDays).toBe(0);
  });
  it("optional-holiday work uses the configured multiplier and basis", () => {
    expect(dayPay({ kind: "optional_holiday", worked: true }, defaults()).extraDays).toBe(2);
    expect(dayPay({ kind: "optional_holiday", worked: true }, defaults({ optional_holiday_work_basis: "additional_to_day_pay" })).extraDays).toBe(3);
    expect(dayPay({ kind: "optional_holiday", worked: true }, defaults({ optional_holiday_work_multiplier: 1.5 })).extraDays).toBe(1.5);
    expect(dayPay({ kind: "optional_holiday", worked: false }, defaults()).extraDays).toBe(0);
  });
  it("invents no rule for working a public holiday", () => {
    expect(dayPay({ kind: "public_holiday", worked: true }, defaults())).toMatchObject({ extraDays: 0, deductionDays: 0 });
  });
});

describe("administration and auditability (source checks)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
  it("saving a policy is admin-only on the server, validated, append-only and audited", () => {
    const src = read("app/(admin)/admin/attendance-policy/actions.ts");
    expect(src).toMatch(/requireAdmin\(\)/);
    expect(src).toMatch(/validatePolicyValue/);
    expect(src).toMatch(/earliestEffectiveDate/);
    expect(src).toMatch(/previousValue/);
    expect(src).toMatch(/changedById: me\.id/);
    expect(src).not.toMatch(/\.update\(attendancePolicyChanges|\.delete\(attendancePolicyChanges/);
  });
  it("attendance reads holidays and never writes them; the engine is pure", () => {
    const q = read("lib/queries/attendance-policy.ts");
    expect(q).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    const engine = read("lib/attendance/payroll-rules.ts");
    expect(engine).not.toMatch(/@\/lib\/db|server-only/);
  });
});
