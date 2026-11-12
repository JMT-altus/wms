"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { attendancePolicyChanges, departments, employees } from "@/db/schema";
import { requireAttendanceSettingsManager } from "@/lib/auth/attendance-settings";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { listPolicyChanges } from "@/lib/queries/attendance-policy";
import { companyDefaults, minShiftEffectiveDate } from "@/lib/queries/attendance-schedule";
import { resolveShiftSettings, validateGrace, validateHoursHighlight, validateShifts, type Grace, type HoursHighlight, type ShiftKey, type WorkShifts } from "@/lib/attendance/shift-settings";
import { fmtDate } from "@/lib/dates";

/**
 * Admin Panel → Attendance Settings: save work shifts, check-in grace, check-out grace.
 *
 * Every call re-checks the manager permission on the server
 * (requireAttendanceSettingsManager: admin + super-admin or the sensitive
 * `attendance.settings.manage` grant). Each save APPENDS one row to
 * attendance_policy_changes — the same effective-dated, audited table the
 * attendance policy uses: new value, previous value (what was in force on the
 * effective date), effective date, reason, who and when. Nothing is edited or
 * deleted, and no attendance record is touched: grading reads the setting in
 * force on each date.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date.");
const reason = z.string().trim().min(3, "Give a short reason for the change.").max(500, "Keep the reason under 500 characters.");
const ShiftsInput = z.object({ shifts: z.array(z.unknown()).max(50), effectiveFrom: ymd, reason }).strict();
const GraceInput = z
  .object({ key: z.enum(["check_in_grace", "check_out_grace"]), enabled: z.boolean(), minutes: z.number(), effectiveFrom: ymd, reason })
  .strict();

const PATHS = ["/admin/attendance-settings", "/attendance", "/attendance/dashboard", "/attendance/manage"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function checkEffectiveDate(effectiveFrom: string): Promise<string | null> {
  if (Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) return "Choose a valid effective date.";
  const min = await minShiftEffectiveDate(localDateString("Asia/Kolkata"));
  if (effectiveFrom < min.date) {
    return min.paidThrough
      ? `Salary is already generated for ${min.paidThrough}, so a change can take effect from ${fmtDate(min.date)} at the earliest.`
      : `A change can take effect from ${fmtDate(min.date)} at the earliest.`;
  }
  return null;
}

async function record(key: ShiftKey, value: WorkShifts | Grace | HoursHighlight, effectiveFrom: string, why: string, actorId: string): Promise<Result | null> {
  const changes = await listPolicyChanges();
  const previous = resolveShiftSettings(changes, effectiveFrom);
  const prev =
    key === "work_shifts" ? previous.shifts : key === "check_in_grace" ? previous.checkIn : key === "check_out_grace" ? previous.checkOut : previous.hoursHighlight;
  if (same(prev, value)) return { ok: false, error: "Nothing changed: that is already the setting in force on that date." };
  await db.insert(attendancePolicyChanges).values({ policyKey: key, value, previousValue: prev, effectiveFrom, reason: why, changedById: actorId });
  for (const p of PATHS) revalidatePath(p);
  return null;
}

export async function saveWorkShifts(raw: unknown): Promise<Result> {
  const me = await requireAttendanceSettingsManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = ShiftsInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input." };
  const checked = validateShifts({ shifts: p.data.shifts });
  if (!checked.ok) return checked;
  const dateError = await checkEffectiveDate(p.data.effectiveFrom);
  if (dateError) return { ok: false, error: dateError };

  try {
    // A full day must be longer than the company's half-day threshold, or every worked day would grade oddly.
    const half = companyDefaults(await getOrgSettings()).halfDayMinutes;
    const short = checked.value.shifts.find((s) => s.workingHours * 60 <= half);
    if (short) return { ok: false, error: `${short.name}: working hours must be more than the half-day threshold (${half / 60} h).` };
    // Assignments must name real, active employees and existing departments.
    const empIds = [...new Set(checked.value.shifts.flatMap((s) => s.employeeIds))];
    const deptIds = [...new Set(checked.value.shifts.flatMap((s) => s.departmentIds))];
    if (empIds.length) {
      const found = await db.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, empIds), eq(employees.isActive, true)));
      if (found.length !== empIds.length) return { ok: false, error: "A shift names an employee who doesn't exist or is inactive. Reload and try again." };
    }
    if (deptIds.length) {
      const found = await db.select({ id: departments.id }).from(departments).where(inArray(departments.id, deptIds));
      if (found.length !== deptIds.length) return { ok: false, error: "A shift names a department that doesn't exist. Reload and try again." };
    }
    const failed = await record("work_shifts", checked.value, p.data.effectiveFrom, p.data.reason, me.id);
    if (failed) return failed;
  } catch (err) {
    console.error("[attendance-settings] saveWorkShifts failed", err);
    return { ok: false, error: "The shifts could not be saved, so nothing was changed. Please try again." };
  }
  return { ok: true, message: `Shifts saved — in force from ${fmtDate(p.data.effectiveFrom)}.` };
}

export async function saveGrace(raw: unknown): Promise<Result> {
  const me = await requireAttendanceSettingsManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = GraceInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input." };
  const checked = validateGrace({ enabled: p.data.enabled, minutes: p.data.minutes });
  if (!checked.ok) return checked;
  const dateError = await checkEffectiveDate(p.data.effectiveFrom);
  if (dateError) return { ok: false, error: dateError };
  try {
    const failed = await record(p.data.key, checked.value, p.data.effectiveFrom, p.data.reason, me.id);
    if (failed) return failed;
  } catch (err) {
    console.error("[attendance-settings] saveGrace failed", err);
    return { ok: false, error: "The grace period could not be saved, so nothing was changed. Please try again." };
  }
  const what = p.data.key === "check_in_grace" ? "Check-in grace" : "Check-out grace";
  return { ok: true, message: `${what} saved — in force from ${fmtDate(p.data.effectiveFrom)}.` };
}

const HighlightInput = z.object({ shortBelowMinutes: z.number(), longAboveMinutes: z.number(), effectiveFrom: ymd, reason }).strict();

/**
 * Daily hours highlight limits (HR → Attendance Correction colours). DISPLAY ONLY: grading, late/early,
 * half/full day and pay never read them. Same permission, history and effective-date rules as the rest.
 */
export async function saveHoursHighlight(raw: unknown): Promise<Result> {
  const me = await requireAttendanceSettingsManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = HighlightInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input." };
  const checked = validateHoursHighlight({ shortBelowMinutes: p.data.shortBelowMinutes, longAboveMinutes: p.data.longAboveMinutes });
  if (!checked.ok) return checked;
  const dateError = await checkEffectiveDate(p.data.effectiveFrom);
  if (dateError) return { ok: false, error: dateError };
  try {
    const failed = await record("hours_highlight", checked.value, p.data.effectiveFrom, p.data.reason, me.id);
    if (failed) return failed;
  } catch (err) {
    console.error("[attendance-settings] saveHoursHighlight failed", err);
    return { ok: false, error: "The highlight limits could not be saved, so nothing was changed. Please try again." };
  }
  revalidatePath("/hr/attendance-correction");
  return { ok: true, message: "Daily hours highlight saved — in force from " + fmtDate(p.data.effectiveFrom) + "." };
}
