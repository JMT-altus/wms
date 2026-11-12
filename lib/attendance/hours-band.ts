import { DEFAULT_HOURS_HIGHLIGHT, type HoursHighlight } from "@/lib/attendance/shift-settings";

/**
 * Daily hours highlight — DISPLAY ONLY. Pure: no database, no clock.
 *
 * A day is coloured only when it has BOTH a check-in and a check-out (a missing
 * punch is not a completed working day, so it is never coloured and never counts
 * hours). Worked time is check-out − check-in, the same figure the attendance
 * report shows. Strictly below the short limit → "short" (yellow); strictly above
 * the long limit → "long" (green); the limits themselves and everything between
 * → null (normal). Grading, late/early, half/full day and pay never read this.
 */
export type HoursBand = "short" | "long";

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Worked minutes from the two punches, or null when either is missing (or out is before in). */
export function workedFromPunches(inAt: string | null, outAt: string | null): number | null {
  if (!inAt || !outAt) return null;
  const m = toMin(outAt) - toMin(inAt);
  return m >= 0 ? m : null;
}

export function hoursBand(inAt: string | null, outAt: string | null, limits: HoursHighlight | null = null): HoursBand | null {
  const worked = workedFromPunches(inAt, outAt);
  if (worked === null) return null;
  const t = limits ?? DEFAULT_HOURS_HIGHLIGHT;
  if (worked < t.shortBelowMinutes) return "short";
  if (worked > t.longAboveMinutes) return "long";
  return null;
}
