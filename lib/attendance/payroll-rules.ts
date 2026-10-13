import type { PolicyValues } from "@/lib/attendance/policy";

/**
 * The attendance maths, with every rule read from the resolved policy. Pure: no
 * database, no clock, and no hard-coded holiday, multiplier or deduction.
 *
 * Not wired into salary runs yet — see the report. Salary generation still
 * divides by calendar days; switching it is a decision for Sir because it
 * changes what people are paid.
 */

export interface MonthHoliday {
  /** YYYY-MM-DD */
  date: string;
  optional: boolean;
}

export interface WorkingDays {
  calendarDays: number;
  /** Weekly-off dates in the month. */
  weeklyOffs: number;
  /** Public holidays that are NOT also a weekly off. */
  publicHolidays: number;
  /** Optional holidays that are not a weekly off or a public holiday. */
  optionalHolidays: number;
  /** Distinct days taken out (no day is deducted twice). */
  deducted: number;
  workingDays: number;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * Working days for a month: calendar days − weekly offs − public holidays
 * (− optional holidays when the policy says so). A date that is a weekly off AND
 * a holiday, or listed twice, is taken out once.
 */
export function computeWorkingDays(args: {
  year: number;
  /** 1–12 */
  month: number;
  holidays: MonthHoliday[];
  policy: PolicyValues;
}): WorkingDays {
  const { year, month, holidays, policy } = args;
  const calendarDays = daysInMonthOf(year, month);
  const prefix = `${year}-${pad(month)}-`;
  const offDays = new Set(policy.weekly_off_days as number[]);

  const offs = new Set<string>();
  for (let d = 1; d <= calendarDays; d++) {
    const iso = `${prefix}${pad(d)}`;
    if (offDays.has(weekdayOf(iso))) offs.add(iso);
  }
  const inMonth = holidays.filter((h) => h.date.startsWith(prefix));
  const pub = new Set(inMonth.filter((h) => !h.optional).map((h) => h.date));
  const opt = new Set(inMonth.filter((h) => h.optional).map((h) => h.date));

  const publicOnly = [...pub].filter((d) => !offs.has(d));
  const optionalOnly = [...opt].filter((d) => !offs.has(d) && !pub.has(d));
  const optionalReduces = policy.optional_holidays_reduce_working_days === true;

  const method = policy.working_day_method;
  let deducted = 0;
  let workingDays = calendarDays;
  if (method === "calendar_minus_offs") {
    deducted = offs.size + publicOnly.length + (optionalReduces ? optionalOnly.length : 0);
    workingDays = calendarDays - deducted;
  } else if (method === "fixed") {
    workingDays = policy.fixed_working_days as number;
  }
  return {
    calendarDays,
    weeklyOffs: offs.size,
    publicHolidays: publicOnly.length,
    optionalHolidays: optionalOnly.length,
    deducted,
    workingDays,
  };
}

/**
 * Daily rate = monthly salary ÷ the configured divisor. Null when the divisor is
 * not a positive number (a month with no working days must not divide by zero).
 */
export function dailyRate(
  monthlySalary: number,
  days: Pick<WorkingDays, "calendarDays" | "workingDays">,
  policy: PolicyValues,
): number | null {
  const divisor =
    policy.daily_rate_divisor === "calendar_days"
      ? days.calendarDays
      : policy.daily_rate_divisor === "fixed_days"
        ? (policy.daily_rate_fixed_days as number)
        : days.workingDays;
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return monthlySalary / divisor;
}

export type DayKind = "working" | "weekly_off" | "public_holiday" | "optional_holiday";

export interface DayFacts {
  kind: DayKind;
  /** Attended (a full day's work). */
  worked: boolean;
  /** An approved leave covers the day. Pending and rejected leave never do. */
  approvedLeave?: boolean;
  /** An approved COM OFF covers weekly-off work. */
  comOffApproved?: boolean;
}

export interface DayPay {
  /** Extra pay for the day, in days of pay (0 = none). */
  extraDays: number;
  /** Deduction for the day, in days of pay (0 = none). */
  deductionDays: number;
  note: string;
}

/**
 * What one day adds or deducts on top of the base monthly salary, in days of
 * pay. Multiply by the daily rate for money. Every figure comes from `policy`.
 *
 * Optional-holiday pay: optional holidays are not in the working-day count, so
 * they carry no base pay. 'total_day_pay' pays multiplier × a day; the other
 * basis pays a normal day plus multiplier × a day.
 */
export function dayPay(f: DayFacts, policy: PolicyValues): DayPay {
  switch (f.kind) {
    case "working": {
      if (f.worked) return { extraDays: 0, deductionDays: 0, note: "Present" };
      if (f.approvedLeave) {
        return policy.approved_leave_payment === "paid"
          ? { extraDays: 0, deductionDays: 0, note: "Approved leave, paid" }
          : { extraDays: 0, deductionDays: 1, note: "Approved leave, unpaid" };
      }
      return policy.unapproved_absence_deduction === "per_day"
        ? {
            extraDays: 0,
            deductionDays: policy.unapproved_absence_multiplier as number,
            note: "Unapproved absence",
          }
        : { extraDays: 0, deductionDays: 0, note: "Unapproved absence, no deduction" };
    }
    case "weekly_off": {
      if (!f.worked) return { extraDays: 0, deductionDays: 0, note: "Weekly off" };
      if (f.comOffApproved && policy.comoff_waives_weekly_off_extra_pay === true) {
        return { extraDays: 0, deductionDays: 0, note: "Weekly-off work, covered by approved COM OFF" };
      }
      return {
        extraDays: policy.weekly_off_work_extra_days as number,
        deductionDays: 0,
        note: "Weekly-off work, additional pay",
      };
    }
    case "optional_holiday": {
      if (!f.worked) return { extraDays: 0, deductionDays: 0, note: "Optional holiday, not worked" };
      const m = policy.optional_holiday_work_multiplier as number;
      return {
        extraDays: policy.optional_holiday_work_basis === "additional_to_day_pay" ? 1 + m : m,
        deductionDays: 0,
        note: "Optional-holiday work",
      };
    }
    case "public_holiday":
      // No rule has been given for working a public holiday, so none is invented.
      return {
        extraDays: 0,
        deductionDays: 0,
        note: f.worked ? "Public-holiday work (no pay rule configured)" : "Public holiday",
      };
  }
}
