import type { AttendanceSchedule } from "@/lib/attendance/schedule";
import type { PolicyChange } from "@/lib/attendance/policy";

/**
 * Work shifts and check-in / check-out grace — the attendance TIMING rules,
 * managed in Admin Panel → Attendance Settings.
 *
 * Pure: no database, no clock. Stored in the SAME append-only, effective-dated
 * table as the attendance policy (`attendance_policy_changes`: value, previous
 * value, effective date, reason, who, when), under three keys of their own. The
 * payroll policy registry (lib/attendance/policy.ts) does not know these keys, so
 * the Attendance Policy page can neither show nor write them.
 *
 * How a day's schedule is decided (`scheduleOn`):
 *   1. Nothing configured for that date → the legacy company times (org settings),
 *      exactly as before this feature. So history before the first effective date,
 *      and every day until a shift is configured, grade exactly as they did.
 *   2. Otherwise the employee's shift for that date: a shift naming the employee,
 *      else a shift naming one of their departments, else the default shift.
 *      No active shift applies → legacy company times.
 *   3. With a shift: late after   = shift start + check-in grace (when enabled),
 *                    early before = shift end   − check-out grace (when enabled),
 *                    full day     = the shift's working hours.
 *      A check-in exactly at the late-after time is on time; a check-out exactly
 *      at the end of the grace window is on time.
 *   4. An employee's personal late/early times (Employees → edit) still apply on
 *      top, as they always have — they are the most specific setting.
 * The half-day threshold stays the company setting.
 */

export const SHIFT_KEYS = ["work_shifts", "check_in_grace", "check_out_grace", "hours_highlight"] as const;
export type ShiftKey = (typeof SHIFT_KEYS)[number];
export const isShiftKey = (k: string): k is ShiftKey => (SHIFT_KEYS as readonly string[]).includes(k);

export const SHIFT_KEY_LABEL: Record<ShiftKey, string> = {
  work_shifts: "Work shifts",
  check_in_grace: "Check-in grace period",
  check_out_grace: "Check-out grace period",
  hours_highlight: "Daily hours highlight",
};

/**
 * Daily hours highlight (display only — never used for grading or pay): a day with
 * both punches whose worked time is BELOW `shortBelowMinutes` shows yellow, ABOVE
 * `longAboveMinutes` green; the two limits themselves are normal. Effective-dated
 * like the other settings; `DEFAULT_HOURS_HIGHLIGHT` applies until one is saved.
 */
export interface HoursHighlight {
  shortBelowMinutes: number;
  longAboveMinutes: number;
}
export const DEFAULT_HOURS_HIGHLIGHT: HoursHighlight = { shortBelowMinutes: 8 * 60 + 30, longAboveMinutes: 9 * 60 + 30 };

export interface WorkShift {
  /** Stable id within the shift list (not a database row). */
  id: string;
  name: string;
  /** "HH:mm", 24h */
  start: string;
  end: string;
  workingHours: number;
  active: boolean;
  /** Applies to everyone not covered by an employee or department assignment. */
  isDefault: boolean;
  employeeIds: string[];
  departmentIds: string[];
}
export interface WorkShifts {
  shifts: WorkShift[];
}
export interface Grace {
  enabled: boolean;
  minutes: number;
}

export const GRACE_MAX_MINUTES = 240;
export const SHIFT_LIMIT = 20;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fromMinutes = (m: number): string => {
  const c = Math.min(Math.max(Math.round(m), 0), 23 * 60 + 59);
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateGrace(value: unknown): Checked<Grace> {
  const v = value as Partial<Grace> | null;
  if (!v || typeof v !== "object" || typeof v.enabled !== "boolean") return { ok: false, error: "Choose whether the grace period is on." };
  if (typeof v.minutes !== "number" || !Number.isInteger(v.minutes) || v.minutes < 0 || v.minutes > GRACE_MAX_MINUTES) {
    return { ok: false, error: `Enter whole minutes from 0 to ${GRACE_MAX_MINUTES}.` };
  }
  return { ok: true, value: { enabled: v.enabled, minutes: v.minutes } };
}

export function validateShifts(value: unknown): Checked<WorkShifts> {
  const list = (value as Partial<WorkShifts> | null)?.shifts;
  if (!Array.isArray(list)) return { ok: false, error: "Invalid shift list." };
  if (list.length > SHIFT_LIMIT) return { ok: false, error: `At most ${SHIFT_LIMIT} shifts.` };
  const out: WorkShift[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  const employeeOwner = new Map<string, string>();
  const deptOwner = new Map<string, string>();
  let defaults = 0;
  for (const raw of list as Partial<WorkShift>[]) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const label = name || "A shift";
    if (!name || name.length > 60) return { ok: false, error: "Every shift needs a name (up to 60 characters)." };
    if (names.has(name.toLowerCase())) return { ok: false, error: `Two shifts are called "${name}".` };
    names.add(name.toLowerCase());
    if (typeof raw.id !== "string" || !/^[\w-]{1,40}$/.test(raw.id) || ids.has(raw.id)) return { ok: false, error: `${label}: invalid id.` };
    ids.add(raw.id);
    if (typeof raw.start !== "string" || !HHMM.test(raw.start) || typeof raw.end !== "string" || !HHMM.test(raw.end)) {
      return { ok: false, error: `${label}: enter start and end times.` };
    }
    const span = toMinutes(raw.end) - toMinutes(raw.start);
    if (span <= 0) return { ok: false, error: `${label}: the end time must be after the start time (overnight shifts aren't supported).` };
    const hours = raw.workingHours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || Math.round(hours * 4) !== hours * 4) {
      return { ok: false, error: `${label}: working hours must be a positive number in quarter hours (e.g. 8.5).` };
    }
    if (hours * 60 > span) return { ok: false, error: `${label}: working hours can't be longer than the shift (${(span / 60).toFixed(2).replace(/\.?0+$/, "")} h).` };
    if (typeof raw.active !== "boolean" || typeof raw.isDefault !== "boolean") return { ok: false, error: `${label}: invalid status.` };
    const employeeIds = Array.isArray(raw.employeeIds) ? [...new Set(raw.employeeIds)] : null;
    const departmentIds = Array.isArray(raw.departmentIds) ? [...new Set(raw.departmentIds)] : null;
    if (!employeeIds || !departmentIds || [...employeeIds, ...departmentIds].some((x) => typeof x !== "string" || !UUID.test(x))) {
      return { ok: false, error: `${label}: invalid employee or department list.` };
    }
    if (raw.active) {
      if (raw.isDefault) defaults++;
      for (const e of employeeIds) {
        if (employeeOwner.has(e)) return { ok: false, error: `An employee is assigned to both "${employeeOwner.get(e)}" and "${name}".` };
        employeeOwner.set(e, name);
      }
      for (const d of departmentIds) {
        if (deptOwner.has(d)) return { ok: false, error: `A department is assigned to both "${deptOwner.get(d)}" and "${name}".` };
        deptOwner.set(d, name);
      }
    }
    out.push({ id: raw.id, name, start: raw.start, end: raw.end, workingHours: hours, active: raw.active, isDefault: raw.active && raw.isDefault, employeeIds, departmentIds });
  }
  if (defaults > 1) return { ok: false, error: "Only one active shift can be the default." };
  return { ok: true, value: { shifts: out } };
}

export function validateHoursHighlight(value: unknown): Checked<HoursHighlight> {
  const v = value as Partial<HoursHighlight> | null;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 24 * 60;
  if (!v || typeof v !== "object" || !ok(v.shortBelowMinutes) || !ok(v.longAboveMinutes)) return { ok: false, error: "Enter both limits as hours and minutes (up to 24 h)." };
  if (v.shortBelowMinutes > v.longAboveMinutes) return { ok: false, error: "The short-day limit can't be above the long-day limit." };
  return { ok: true, value: { shortBelowMinutes: v.shortBelowMinutes, longAboveMinutes: v.longAboveMinutes } };
}

export function validateShiftValue(key: string, value: unknown): Checked<WorkShifts | Grace | HoursHighlight> {
  if (key === "work_shifts") return validateShifts(value);
  if (key === "check_in_grace" || key === "check_out_grace") return validateGrace(value);
  if (key === "hours_highlight") return validateHoursHighlight(value);
  return { ok: false, error: "Unknown attendance setting." };
}

export interface ShiftSettings {
  /** null = never configured on or before the date. */
  shifts: WorkShifts | null;
  checkIn: Grace | null;
  checkOut: Grace | null;
  /** null = not saved yet: DEFAULT_HOURS_HIGHLIGHT applies. */
  hoursHighlight: HoursHighlight | null;
}

/** The latest change of each key whose effective date has arrived (ties: the later recorded). */
export function resolveShiftSettings(changes: readonly PolicyChange[], asOf: string): ShiftSettings {
  const latest = new Map<string, PolicyChange>();
  for (const c of changes) {
    if (!isShiftKey(c.key) || c.effectiveFrom > asOf) continue;
    const cur = latest.get(c.key);
    if (!cur || c.effectiveFrom > cur.effectiveFrom || (c.effectiveFrom === cur.effectiveFrom && c.createdAt.getTime() >= cur.createdAt.getTime())) {
      latest.set(c.key, c);
    }
  }
  const pick = <T,>(key: ShiftKey, check: (v: unknown) => Checked<T>): T | null => {
    const c = latest.get(key);
    if (!c) return null;
    const r = check(c.value);
    if (!r.ok) throw new Error(`Attendance setting "${key}" effective ${c.effectiveFrom} holds an invalid value (${r.error}).`);
    return r.value;
  };
  return {
    shifts: pick("work_shifts", validateShifts),
    checkIn: pick("check_in_grace", validateGrace),
    checkOut: pick("check_out_grace", validateGrace),
    hoursHighlight: pick("hours_highlight", validateHoursHighlight),
  };
}

/** The active shift for an employee: named directly, else via a department, else the default. */
export function pickShift(shifts: WorkShifts, employeeId: string, departmentIds: readonly string[]): WorkShift | null {
  const active = shifts.shifts.filter((s) => s.active);
  return (
    active.find((s) => s.employeeIds.includes(employeeId)) ??
    active.find((s) => s.departmentIds.some((d) => departmentIds.includes(d))) ??
    active.find((s) => s.isDefault) ??
    null
  );
}

/** The schedule a shift gives with the grace in force. */
export function shiftSchedule(shift: WorkShift, checkIn: Grace | null, checkOut: Grace | null, halfDayMinutes: number): AttendanceSchedule {
  const inGrace = checkIn?.enabled ? checkIn.minutes : 0;
  const outGrace = checkOut?.enabled ? checkOut.minutes : 0;
  return {
    // late = check-in strictly after this time
    lateAfter: fromMinutes(toMinutes(shift.start) + inGrace),
    // left early = check-out at or before this time, i.e. strictly before (end − grace)
    earlyBefore: fromMinutes(toMinutes(shift.end) - outGrace - 1),
    fullDayMinutes: Math.round(shift.workingHours * 60),
    halfDayMinutes,
  };
}

export interface ScheduleEmployee {
  id: string;
  attLateAfter: string | null;
  attEarlyBefore: string | null;
}

/**
 * The schedule for one employee on one date. `legacy` is the company schedule
 * from org settings (used whenever no shift applies); `departmentIds` are the
 * employee's departments.
 */
export function scheduleOn(settings: ShiftSettings, legacy: AttendanceSchedule, emp: ScheduleEmployee, departmentIds: readonly string[]): AttendanceSchedule & { shift: WorkShift | null } {
  const shift = settings.shifts ? pickShift(settings.shifts, emp.id, departmentIds) : null;
  const base = shift ? shiftSchedule(shift, settings.checkIn, settings.checkOut, legacy.halfDayMinutes) : legacy;
  return {
    lateAfter: emp.attLateAfter ?? base.lateAfter,
    earlyBefore: emp.attEarlyBefore ?? base.earlyBefore,
    fullDayMinutes: base.fullDayMinutes,
    halfDayMinutes: base.halfDayMinutes,
    shift,
  };
}

const hours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, "")} h`;

/** "General 09:00–18:00 (8.5 h, default) · Store 10:00–19:00 (8 h, 2 employees, 1 department)". */
export function describeShifts(v: WorkShifts | null): string {
  if (!v) return "Not set — company times";
  const active = v.shifts.filter((s) => s.active);
  if (active.length === 0) return "No active shift — company times";
  return active
    .map((s) => {
      const tags = [hours(s.workingHours)];
      if (s.isDefault) tags.push("default");
      if (s.employeeIds.length) tags.push(`${s.employeeIds.length} employee${s.employeeIds.length === 1 ? "" : "s"}`);
      if (s.departmentIds.length) tags.push(`${s.departmentIds.length} department${s.departmentIds.length === 1 ? "" : "s"}`);
      return `${s.name} ${s.start}–${s.end} (${tags.join(", ")})`;
    })
    .join(" · ");
}

/** "On · 15 min" / "Off" / "Not set". */
export function describeGrace(v: Grace | null): string {
  if (!v) return "Not set";
  return v.enabled ? `On · ${v.minutes} min` : `Off (${v.minutes} min kept)`;
}

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** "Yellow below 8h 30m · green above 9h 30m". */
export function describeHoursHighlight(v: HoursHighlight | null): string {
  if (!v) return `Default (yellow below ${hm(DEFAULT_HOURS_HIGHLIGHT.shortBelowMinutes)} · green above ${hm(DEFAULT_HOURS_HIGHLIGHT.longAboveMinutes)})`;
  return `Yellow below ${hm(v.shortBelowMinutes)} · green above ${hm(v.longAboveMinutes)}`;
}

export function describeShiftValue(key: string, v: unknown): string {
  if (key === "work_shifts") return describeShifts((v as WorkShifts | null) ?? null);
  if (key === "hours_highlight") return describeHoursHighlight((v as HoursHighlight | null) ?? null);
  return describeGrace((v as Grace | null) ?? null);
}
