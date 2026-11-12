"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { attendanceWaivers, employeeEvents, type Employee } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { canManageWaivers } from "@/lib/auth/attendance-waivers";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { ATTENDANCE_CODE_LABELS, type AttendanceCode } from "@/db/enums";
import { getEmployeeMonthStatus, isWaivableCode } from "@/lib/queries/attendance-status";
import { isMissingTable } from "@/lib/queries/attendance-waivers";
import { isRealDate } from "@/lib/attendance/correction/plan";
import { assertNotSelf, correctionFailureMessage, loadCorrectionDay, salaryRunNotice, type SalaryRunNotice } from "@/lib/attendance/correction/apply";
import { ATTENDANCE_WAIVER_EVENT, ATTENDANCE_WAIVER_REVERSED_EVENT } from "@/lib/attendance/correction/events";

/**
 * HR → Attendance Correction → Waive attendance (approved treatment).
 *
 * A waiver makes one employee's WORKING day "WV — Waived": one payable day (like
 * paid leave), not absent / half-day / no check-out, and its late or early mark
 * does not count toward the every-3rd-late deduction. It never touches the
 * punches and never invents hours. Holidays, weekly offs, leave and comp-off
 * days can't be waived (they have their own treatment), nor a complete present
 * day with nothing to waive, a future day, a day before joining, or one's own.
 *
 * Every action re-checks on the server: HR module access + super-admin or the
 * sensitive `attendance.waivers.manage` grant. Waive and reverse each write the
 * waiver row and an audit event in ONE transaction; a reason is mandatory both
 * ways and an explicit confirmation is required. At most one active waiver per
 * employee and date (database-enforced). A salary run already generated for the
 * month is never changed — the review says so, and the run shows "needs review".
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function requireWaiverManager(): Promise<Employee> {
  const me = await requireUser();
  if (!(await canManageWaivers(me))) throw new Error("Forbidden");
  return me;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The date is not valid.");
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500, "Keep the reason under 500 characters.");
const Target = z.object({ employeeId: z.string().uuid("Choose an employee."), date: ymd });
const WaiveSchema = Target.extend({ reason, confirmed: z.literal(true, { message: "Confirm the waiver first." }) });
const ReverseSchema = z.object({ waiverId: z.string().uuid("Invalid waiver."), reason, confirmed: z.literal(true, { message: "Confirm the reversal first." }) });
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid request.";

const NOT_AVAILABLE = "Attendance waivers aren't available yet: the database update that adds them (0126) hasn't been applied.";
const isUnique = (err: unknown): boolean => {
  for (let e: unknown = err, i = 0; e && i < 4; i++, e = (e as { cause?: unknown }).cause) if ((e as { code?: string }).code === "23505") return true;
  return false;
};

export interface DayState {
  code: string;
  label: string;
  dayValue: number;
  late: boolean;
  leftEarly: boolean;
  lateWaived: boolean;
  inAt: string | null;
  outAt: string | null;
  workedMinutes: number;
}
export interface WaiverPreview {
  employee: { id: string; name: string; email: string };
  date: string;
  current: DayState;
  /** Payable days for the day: before → after (after is always 1). */
  payable: { before: number; after: number };
  /** The day's late mark currently counts toward the every-3rd-late deduction and won't after the waiver. */
  removesLateMark: boolean;
  removesEarlyMark: boolean;
  salaryRun: SalaryRunNotice | null;
}

/** Validate a waiver target and read the day's current (un-waived) grade. Throws CorrectionError-style messages. */
async function inspect(me: Employee, employeeId: string, date: string): Promise<{ preview: WaiverPreview } | { error: string }> {
  if (!isRealDate(date)) return { error: "The date is not valid." };
  assertNotSelf(me.id, employeeId);
  const ctx = await loadCorrectionDay(db, employeeId, date, false); // exists + active
  const today = localDateString(ctx.emp.timezone);
  if (date > today) return { error: "A day that hasn't happened yet can't be waived." };
  if (date < ctx.emp.joinDay) return { error: `${ctx.emp.name} hadn't joined on that date.` };

  const active = await db
    .select({ id: attendanceWaivers.id })
    .from(attendanceWaivers)
    .where(and(eq(attendanceWaivers.employeeId, employeeId), eq(attendanceWaivers.logDate, date), isNull(attendanceWaivers.reversedAt)))
    .limit(1);
  if (active.length) return { error: "This day is already waived. Reverse the waiver first if it needs changing." };

  const [y, m] = date.split("-").map(Number) as [number, number];
  const day = (await getEmployeeMonthStatus(employeeId, y, m, today)).days.find((d) => d.logDate === date);
  if (!day) return { error: "That day could not be graded. Please try again." };
  const label = ATTENDANCE_CODE_LABELS[day.code as AttendanceCode] ?? String(day.code);
  if (!isWaivableCode(String(day.code))) return { error: `${label} days can't be waived — they already have their own treatment.` };
  const lateCounts = day.late && !day.lateWaived;
  if (day.code === "P" && !lateCounts && !day.leftEarly) return { error: "Nothing to waive: this is a complete present day." };

  return {
    preview: {
      employee: { id: ctx.emp.id, name: ctx.emp.name, email: ctx.emp.email },
      date,
      current: { code: String(day.code), label, dayValue: day.dayValue, late: day.late, leftEarly: day.leftEarly, lateWaived: day.lateWaived, inAt: day.inAt, outAt: day.outAt, workedMinutes: day.workedMinutes },
      payable: { before: day.dayValue, after: 1 },
      removesLateMark: lateCounts,
      removesEarlyMark: day.leftEarly,
      salaryRun: await salaryRunNotice(employeeId, date, me.isAdmin === true),
    },
  };
}

const revalidate = () => {
  for (const p of ["/hr/attendance-correction", "/attendance", "/attendance/dashboard", "/my-salary", "/salary"]) revalidatePath(p);
};

/** Read-only: what waiving this day would change (status, payable day, late mark, salary-run warning). */
export async function previewWaiver(raw: unknown): Promise<Result<{ preview: WaiverPreview }>> {
  const me = await requireWaiverManager();
  const p = Target.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  try {
    const r = await inspect(me, p.data.employeeId, p.data.date);
    return "error" in r ? { ok: false, error: r.error } : { ok: true, preview: r.preview };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_AVAILABLE };
    return { ok: false, error: correctionFailureMessage(err, "waiver preview", "Could not check that day. Please try again.") };
  }
}

/** Waive the day: the waiver row and its audit event in one transaction. Nothing else is written. */
export async function waiveDay(raw: unknown): Promise<Result<{ waived: { date: string; employeeName: string } }>> {
  const me = await requireWaiverManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = WaiveSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const { employeeId, date } = p.data;
  const why = p.data.reason.trim();
  try {
    const r = await inspect(me, employeeId, date);
    if ("error" in r) return { ok: false, error: r.error };
    const cur = r.preview.current;
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(attendanceWaivers).values({ employeeId, logDate: date, reason: why, waivedById: me.id }).returning({ id: attendanceWaivers.id });
      await tx.insert(employeeEvents).values({
        employeeId,
        actorId: me.id,
        eventType: ATTENDANCE_WAIVER_EVENT,
        fromValue: { date, code: cur.code, dayValue: cur.dayValue, late: cur.late, leftEarly: cur.leftEarly, inAt: cur.inAt, outAt: cur.outAt },
        toValue: { date, code: "WV", dayValue: 1, waiverId: row!.id },
        note: `Attendance waived for ${date}: ${why}`,
      });
    });
    revalidate();
    return { ok: true, waived: { date, employeeName: r.preview.employee.name } };
  } catch (err) {
    if (isUnique(err)) return { ok: false, error: "This day was waived by someone else just now. Nothing was saved; reload to see it." };
    if (isMissingTable(err)) return { ok: false, error: NOT_AVAILABLE };
    return { ok: false, error: correctionFailureMessage(err, "waive", "The waiver could not be saved, so nothing was changed. Please try again.") };
  }
}

/** Reverse an active waiver (reason mandatory): sets the reversal columns and writes the audit event, in one transaction. */
export async function reverseWaiver(raw: unknown): Promise<Result<{ reversed: { date: string } }>> {
  const me = await requireWaiverManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = ReverseSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const why = p.data.reason.trim();
  try {
    const [w] = await db.select().from(attendanceWaivers).where(eq(attendanceWaivers.id, p.data.waiverId)).limit(1);
    if (!w) return { ok: false, error: "That waiver was not found." };
    assertNotSelf(me.id, w.employeeId);
    if (w.reversedAt) return { ok: false, error: "That waiver has already been reversed." };
    const done = await db.transaction(async (tx) => {
      const updated = await tx
        .update(attendanceWaivers)
        .set({ reversedAt: new Date(), reversedById: me.id, reverseReason: why })
        .where(and(eq(attendanceWaivers.id, w.id), isNull(attendanceWaivers.reversedAt)))
        .returning({ id: attendanceWaivers.id });
      if (updated.length === 0) return false; // reversed meanwhile
      await tx.insert(employeeEvents).values({
        employeeId: w.employeeId,
        actorId: me.id,
        eventType: ATTENDANCE_WAIVER_REVERSED_EVENT,
        fromValue: { date: w.logDate, code: "WV", waiverId: w.id, waiverReason: w.reason },
        toValue: { date: w.logDate, waiverId: w.id },
        note: `Attendance waiver for ${w.logDate} reversed: ${why}`,
      });
      return true;
    });
    if (!done) return { ok: false, error: "That waiver has already been reversed." };
    revalidate();
    return { ok: true, reversed: { date: w.logDate } };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_AVAILABLE };
    return { ok: false, error: correctionFailureMessage(err, "waiver reverse", "The reversal could not be saved, so nothing was changed. Please try again.") };
  }
}
