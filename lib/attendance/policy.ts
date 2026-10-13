/**
 * Attendance policy — the single list of every configurable attendance/payroll
 * rule, its initial value and whether the company has confirmed it.
 *
 * Pure (no database): the same definitions drive validation, the admin screen
 * and the engine in payroll-rules.ts. A setting's CURRENT value is the latest
 * row in `attendance_policy_changes` whose effective date has arrived; with no
 * row, the default below applies. Nothing else in the code holds a holiday date,
 * a multiplier or a deduction rule.
 *
 * `status: "pending"` marks a setting whose exact meaning Sir has not confirmed.
 * It still has a working initial value (the engine needs one) but the admin screen
 * flags it, so it is never mistaken for a settled company rule.
 */

export type PolicyStatus = "confirmed" | "pending";

interface Base {
  key: string;
  label: string;
  help: string;
  status: PolicyStatus;
}
export type PolicyDef =
  | (Base & { kind: "number"; default: number | null; min: number; max: number; nullable?: boolean })
  | (Base & { kind: "boolean"; default: boolean })
  | (Base & { kind: "enum"; default: string; options: readonly string[] })
  | (Base & { kind: "weekdays"; default: number[] });

export type PolicyValue = number | boolean | string | number[] | null;

export const POLICY_DEFS = [
  // ── Working days ────────────────────────────────────────────────────────
  {
    key: "working_day_method",
    kind: "enum",
    label: "Working-day method",
    help: "calendar_minus_offs: calendar days − weekly offs − public holidays (− optional holidays if set below). calendar_days: no deductions. fixed: the fixed number below.",
    default: "calendar_minus_offs",
    options: ["calendar_minus_offs", "calendar_days", "fixed"],
    status: "confirmed",
  },
  {
    key: "weekly_off_days",
    kind: "weekdays",
    label: "Weekly off days",
    help: "Days of the week that are off (0 = Sunday … 6 = Saturday).",
    default: [0],
    status: "confirmed",
  },
  {
    key: "optional_holidays_reduce_working_days",
    kind: "boolean",
    label: "Optional holidays reduce working days",
    help: "Sir's rule excludes optional holidays from the working-day count.",
    default: true,
    status: "confirmed",
  },
  {
    key: "fixed_working_days",
    kind: "number",
    label: "Fixed working days per month",
    help: "Used only when the working-day method is 'fixed'.",
    default: 26,
    min: 1,
    max: 31,
    status: "pending",
  },
  // ── Daily rate ──────────────────────────────────────────────────────────
  {
    key: "daily_rate_divisor",
    kind: "enum",
    label: "Daily rate = monthly salary ÷",
    help: "working_days (Sir's rule), calendar_days (what salary runs use today), or fixed_days.",
    default: "working_days",
    options: ["working_days", "calendar_days", "fixed_days"],
    status: "confirmed",
  },
  {
    key: "daily_rate_fixed_days",
    kind: "number",
    label: "Fixed divisor",
    help: "Used only when the daily-rate divisor is 'fixed_days'.",
    default: 30,
    min: 1,
    max: 31,
    status: "pending",
  },
  // ── Leave and absence ───────────────────────────────────────────────────
  {
    key: "approved_leave_payment",
    kind: "enum",
    label: "Approved leave is",
    help: "How a day of HR-approved leave is paid.",
    default: "paid",
    options: ["paid", "unpaid"],
    status: "confirmed",
  },
  {
    key: "unapproved_absence_deduction",
    kind: "enum",
    label: "Unapproved absence on a working day",
    help: "none: no deduction. per_day: deduct the multiplier below, in days of pay, for each such day.",
    default: "per_day",
    options: ["none", "per_day"],
    status: "confirmed",
  },
  {
    key: "unapproved_absence_multiplier",
    kind: "number",
    label: "Deduction per unapproved absent day (days of pay)",
    help: "1 = one day's pay.",
    default: 1,
    min: 0,
    max: 10,
    status: "pending",
  },
  // ── Weekly-off work and COM OFF ─────────────────────────────────────────
  {
    key: "weekly_off_work_extra_days",
    kind: "number",
    label: "Extra pay for working a weekly off (days of pay)",
    help: "Added when someone works a weekly off with no approved COM OFF. The amount has not been confirmed.",
    default: 1,
    min: 0,
    max: 10,
    status: "pending",
  },
  {
    key: "comoff_waives_weekly_off_extra_pay",
    kind: "boolean",
    label: "An approved COM OFF replaces the extra pay",
    help: "Sir's rule: Sunday work with approved COM OFF gets no additional payment.",
    default: true,
    status: "confirmed",
  },
  {
    key: "comoff_requires_approval",
    kind: "boolean",
    label: "COM OFF needs approval",
    help: "Whether weekly-off work earns COM OFF only once approved.",
    default: true,
    status: "pending",
  },
  {
    key: "comoff_expiry_days",
    kind: "number",
    label: "COM OFF expires after (days)",
    help: "Leave empty for no expiry.",
    default: null,
    nullable: true,
    min: 1,
    max: 730,
    status: "pending",
  },
  {
    key: "comoff_carry_forward",
    kind: "boolean",
    label: "Unused COM OFF carries forward",
    help: "Whether an unused COM OFF survives into the next month.",
    default: false,
    status: "pending",
  },
  // ── Optional holidays ───────────────────────────────────────────────────
  {
    key: "optional_holiday_work_multiplier",
    kind: "number",
    label: "Optional-holiday work multiplier",
    help: "'Double pay' = 2. What it multiplies is set by the basis below.",
    default: 2,
    min: 0,
    max: 10,
    status: "pending",
  },
  {
    key: "optional_holiday_work_basis",
    kind: "enum",
    label: "Optional-holiday work: multiplier is",
    help: "total_day_pay: the day is paid at multiplier × a day. additional_to_day_pay: a normal day plus multiplier × a day. Sir has not confirmed which 'double pay' means.",
    default: "total_day_pay",
    options: ["total_day_pay", "additional_to_day_pay"],
    status: "pending",
  },
  // ── Punch rules, amendments, finalisation ───────────────────────────────
  {
    key: "missing_punch_treatment",
    kind: "enum",
    label: "A day with a missing punch is",
    help: "incomplete: flagged for review and not paid until resolved. half_day / absent: graded automatically. The late-after, early-before and full/half-day hours stay in Organisation settings.",
    default: "incomplete",
    options: ["incomplete", "half_day", "absent"],
    status: "pending",
  },
  {
    key: "amendments_approved_by",
    kind: "enum",
    label: "Attendance amendments are approved by",
    help: "Who may approve a change to a recorded day.",
    default: "admin",
    options: ["admin", "leave_approvers"],
    status: "pending",
  },
  {
    key: "month_finalization_enabled",
    kind: "boolean",
    label: "Monthly attendance is finalised",
    help: "When on, a finalised month is not recalculated by later policy changes. Finalisation itself is not built yet.",
    default: false,
    status: "pending",
  },
  {
    key: "reopen_requires_reason",
    kind: "boolean",
    label: "Reopening a finalised month needs a reason",
    help: "Applies once finalisation exists.",
    default: true,
    status: "pending",
  },
] as const satisfies readonly PolicyDef[];

export type PolicyKey = (typeof POLICY_DEFS)[number]["key"];

const BY_KEY = new Map<string, PolicyDef>(POLICY_DEFS.map((d) => [d.key, d]));
export const getPolicyDef = (key: string): PolicyDef | undefined => BY_KEY.get(key);

/** Check a candidate value against its definition. Returns the cleaned value. */
export function validatePolicyValue(
  key: string,
  value: unknown,
): { ok: true; value: PolicyValue } | { ok: false; error: string } {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, error: "Unknown policy setting." };
  switch (def.kind) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "Choose yes or no." };
    case "enum":
      return typeof value === "string" && def.options.includes(value)
        ? { ok: true, value }
        : { ok: false, error: `Choose one of: ${def.options.join(", ")}.` };
    case "number": {
      if ((value === null || value === "") && def.nullable) return { ok: true, value: null };
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "Enter a number." };
      if (value < def.min || value > def.max) {
        return { ok: false, error: `Enter a number from ${def.min} to ${def.max}.` };
      }
      return { ok: true, value };
    }
    case "weekdays": {
      if (!Array.isArray(value) || value.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return { ok: false, error: "Choose weekdays (0 = Sunday … 6 = Saturday)." };
      }
      return { ok: true, value: [...new Set(value as number[])].sort((a, b) => a - b) };
    }
  }
}

/** One recorded change. `effectiveFrom` is YYYY-MM-DD. */
export interface PolicyChange {
  key: string;
  value: PolicyValue;
  effectiveFrom: string;
  createdAt: Date;
}

export type PolicyValues = Record<PolicyKey, PolicyValue>;

/**
 * Every setting's value as of `asOf` (YYYY-MM-DD): the latest change whose
 * effective date has arrived (ties broken by when it was recorded), else the
 * default. Because it is resolved per date, a later change never alters an
 * earlier month's result.
 */
export function resolvePolicy(changes: PolicyChange[], asOf: string): PolicyValues {
  const out = {} as Record<string, PolicyValue>;
  for (const d of POLICY_DEFS) out[d.key] = d.default as PolicyValue;
  const applicable = changes
    .filter((c) => c.effectiveFrom <= asOf && BY_KEY.has(c.key))
    .sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : a.effectiveFrom < b.effectiveFrom
          ? -1
          : 1,
    );
  for (const c of applicable) out[c.key] = c.value;
  return out as PolicyValues;
}

/**
 * The earliest date a change may take effect: the first day of the current
 * month. A closed month can't be silently re-priced by a policy edit; changing
 * history is a separate, explicit operation (not built).
 */
export function earliestEffectiveDate(todayIso: string): string {
  return `${todayIso.slice(0, 7)}-01`;
}
