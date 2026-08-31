import { z } from "zod";
import { FORECAST_PERIOD_KINDS } from "@/db/enums";

/**
 * Schemas for Targets & Forecasts.
 *
 * Money crosses the wire as RUPEES — that's what the person typed — and is
 * converted to integer paise here, once, at the edge. Doing it in the action
 * instead would mean every new caller re-deriving the conversion, and one of
 * them eventually forgetting.
 */

const MAX_RUPEES = 1_000_00_00_000; // ₹1,000 Cr — a typo guard, not a business rule

/** Rupees (string or number) → integer paise. Blank/absent → null. */
const rupeesToPaiseNullable = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === undefined || v === null || `${v}`.trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.min(Math.max(n, -MAX_RUPEES), MAX_RUPEES) * 100);
  });

const rupeesToPaise = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(Math.max(n, 0), MAX_RUPEES) * 100) : 0;
  });

const fyStartYear = z.coerce.number().int().min(2000).max(2100);
const periodKind = z.enum(FORECAST_PERIOD_KINDS);
const periodKey = z.string().trim().min(4).max(20);
const uuid = z.string().uuid("Invalid selection");

const emptyToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/* ── Targets ─────────────────────────────────────────────────────────────── */

/** The company-level annual number. `employeeId` null is implied. */
export const CompanyTargetSchema = z.object({
  fyStartYear,
  targetRupees: rupeesToPaise,
});
export type CompanyTargetInput = z.input<typeof CompanyTargetSchema>;

/** One salesperson's slice of the company target. */
export const AllocateTargetSchema = z.object({
  fyStartYear,
  employeeId: uuid,
  targetRupees: rupeesToPaise,
});
export type AllocateTargetInput = z.input<typeof AllocateTargetSchema>;

/** Editing a single derived period cell (a quarter, month or week target). */
export const PeriodTargetSchema = z.object({
  fyStartYear,
  periodKind,
  periodKey,
  /** null = the company row. */
  employeeId: uuid.nullable().optional().transform((v) => v ?? null),
  targetRupees: rupeesToPaise,
});
export type PeriodTargetInput = z.input<typeof PeriodTargetSchema>;

/** `employeeId` null sets the org default for that financial year. */
export const GrowthSplitSchema = z.object({
  fyStartYear,
  employeeId: uuid.nullable().optional().transform((v) => v ?? null),
  existingPct: z.coerce.number().min(0).max(100),
});
export type GrowthSplitInput = z.input<typeof GrowthSplitSchema>;

/* ── Forecast lines ──────────────────────────────────────────────────────── */

/**
 * A forecast row. Either a named customer or the new-business bucket, never
 * both — the DB enforces the same thing with a CHECK, but rejecting it here
 * gives the form a sentence instead of a constraint violation.
 */
export const ForecastLineSchema = z
  .object({
    fyStartYear,
    periodKind,
    periodKey,
    employeeId: uuid,
    customerMasterId: uuid.nullable().optional().transform((v) => v ?? null),
    isNewBusiness: z.boolean().default(false),
    quantity: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => {
        if (v === undefined || v === null || `${v}`.trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }),
    avgRateRupees: rupeesToPaiseNullable,
    /** Used only when quantity × rate can't produce a value. */
    forecastRupees: rupeesToPaise,
    notes: emptyToNull(2000),
  })
  .refine((v) => (v.customerMasterId !== null) !== v.isNewBusiness, {
    message: "A row is either a customer or the new-business bucket, not both.",
    path: ["customerMasterId"],
  });
export type ForecastLineInput = z.input<typeof ForecastLineSchema>;

/** The 27th / Friday routine: an estimate, ideally with a note behind it. */
export const EstimateSchema = z.object({
  lineId: uuid,
  estimatedRupees: rupeesToPaiseNullable,
  estimatedNotes: emptyToNull(2000),
});
export type EstimateInput = z.input<typeof EstimateSchema>;

/** Seed a level's children from its own value. */
export const RedivideSchema = z.object({
  fyStartYear,
  periodKind,
  periodKey,
  employeeId: uuid,
  /** Wipe values somebody typed, or only fill blanks. */
  overwriteEdited: z.boolean().default(false),
});
export type RedivideInput = z.input<typeof RedivideSchema>;

/* ── Cadence settings ────────────────────────────────────────────────────── */

export const ForecastCadenceSchema = z.object({
  forecastMonthlyDay: z.coerce.number().int().min(1).max(28),
  forecastWeeklyDow: z.coerce.number().int().min(1).max(7),
  forecastLockDays: z.coerce.number().int().min(0).max(60),
});
export type ForecastCadenceInput = z.input<typeof ForecastCadenceSchema>;
