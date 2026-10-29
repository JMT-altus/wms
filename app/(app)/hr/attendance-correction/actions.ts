"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { type Employee } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getModuleAccessFor } from "@/lib/auth/module-access";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { getEmployeeMonthStatus } from "@/lib/queries/attendance-status";
import { CORRECTION_REASON_CODES, EXPLANATION_MAX, isRealDate, reasonLabel } from "@/lib/attendance/correction/plan";
import {
  applySet,
  assertNotSelf,
  correctionFailureMessage,
  loadCorrectionDay,
  previewSet,
  salaryRunNotice,
  type CorrectionDay,
  type SalaryRunNotice,
} from "@/lib/attendance/correction/apply";
import { ATTENDANCE_CORRECTION_EVENT } from "@/lib/attendance/correction/events";

/**
 * HR → Attendance Correction (power failure / biometric outage).
 *
 * Adds a missing IN or OUT, or corrects an existing time, in `attendance_logs` —
 * the same rows the attendance report and the rules engine already read, so the
 * existing grading applies to the result and nothing is graded here. It never
 * deletes a punch and never makes a time up.
 *
 * Deliberately NOT done here (unlike the admin day editor): no day-finalised or
 * late-deduction emails. This module does not import the notification code.
 *
 * Every action re-checks HR access on the server, and refuses a change to the
 * signed-in person's own attendance. The write and its audit row are one
 * transaction (lib/attendance/correction/apply.ts). Concurrent changes are
 * detected: the browser sends what it saw; the server compares it, under a row
 * lock, with what is stored. A correction never touches a salary run; when one
 * exists for the month, the review says so.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** HR module access = admins plus anyone granted HR. Checked on every call. */
async function requireHr(): Promise<Employee> {
  const me = await requireUser();
  const access = await getModuleAccessFor(me);
  if (!access.hr?.allowed) throw new Error("Forbidden");
  return me;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The date is not valid.");
const timeField = z.union([z.string().regex(/^\d{2}:\d{2}$/, "Times must be HH:mm."), z.literal(""), z.null()]).optional();
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid snapshot.");

const LookupSchema = z.object({ employeeId: z.string().uuid("Choose an employee."), date: ymd });
const ChangeSchema = LookupSchema.extend({
  inTime: timeField,
  outTime: timeField,
  reason: z.enum(CORRECTION_REASON_CODES, { message: "Choose a reason." }),
  explanation: z.string().max(EXPLANATION_MAX + 200, `Keep the explanation under ${EXPLANATION_MAX} characters.`),
  /** What the browser showed as stored (loggedAt ISO) for each side, or null when none. */
  snapshot: z.object({ in: iso.nullable(), out: iso.nullable() }),
});
const SaveSchema = ChangeSchema.extend({ confirmed: z.literal(true, { message: "Review and confirm the correction first." }) });

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid request.";

export interface PunchView {
  time: string;
  loggedAt: string;
  source: string;
  reason: string | null;
  note: string | null;
}

export interface DayGrade {
  code: string;
  late: boolean;
  leftEarly: boolean;
  workedMinutes: number;
}

export interface DayView {
  employee: { id: string; name: string; email: string; timezone: string; joinDay: string };
  date: string;
  punches: { in: PunchView | null; out: PunchView | null };
  grade: DayGrade | null;
}

export interface ReviewView {
  employee: { id: string; name: string; email: string };
  date: string;
  existing: { in: PunchView | null; out: PunchView | null };
  changes: { kind: "in" | "out"; action: "add" | "change"; from: string | null; to: string }[];
  finalIn: string | null;
  finalOut: string | null;
  reason: { code: string; label: string };
  explanation: string;
  /** Existing notes that will be kept, with the explanation added after them. */
  keepsNotes: string[];
  warnings: string[];
  /** A salary run already exists for this month (status only for payroll viewers). */
  salaryRun: SalaryRunNotice | null;
}

const view = (p: CorrectionDay["rows"]["in"]): PunchView | null =>
  p ? { time: p.time, loggedAt: p.loggedAt, source: p.source, reason: p.reason, note: p.note } : null;

async function gradeFor(emp: CorrectionDay["emp"], date: string): Promise<DayGrade | null> {
  try {
    const today = localDateString(emp.timezone);
    if (date > today) return null;
    const [y, m] = date.split("-").map(Number) as [number, number];
    const month = await getEmployeeMonthStatus(emp.id, y, m, today);
    const row = month.days.find((d) => d.logDate === date);
    return row ? { code: String(row.code), late: row.late && !row.lateWaived, leftEarly: row.leftEarly, workedMinutes: row.workedMinutes } : null;
  } catch {
    return null; // The grade is a courtesy; its failure must not hide the result.
  }
}

/** Read-only: the employee, the date, and the punches stored for it (with the current grade). */
export async function lookupDay(raw: unknown): Promise<Result<{ day: DayView }>> {
  const me = await requireHr();
  const p = LookupSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  if (!isRealDate(p.data.date)) return { ok: false, error: "The date is not valid." };
  try {
    assertNotSelf(me.id, p.data.employeeId);
    const ctx = await loadCorrectionDay(db, p.data.employeeId, p.data.date, false);
    return {
      ok: true,
      day: {
        employee: { id: ctx.emp.id, name: ctx.emp.name, email: ctx.emp.email, timezone: ctx.emp.timezone, joinDay: ctx.emp.joinDay },
        date: p.data.date,
        punches: { in: view(ctx.rows.in), out: view(ctx.rows.out) },
        grade: await gradeFor(ctx.emp, p.data.date),
      },
    };
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "lookup", "Could not load that day. Please try again.") };
  }
}

const setInput = (me: Employee, d: z.output<typeof ChangeSchema>) => ({
  actorId: me.id,
  employeeId: d.employeeId,
  date: d.date,
  inTime: d.inTime,
  outTime: d.outTime,
  reason: d.reason,
  explanation: d.explanation,
  snapshot: d.snapshot,
  eventType: ATTENDANCE_CORRECTION_EVENT,
  via: "hr_attendance_correction",
  noteLabel: "HR attendance correction",
});

/** Dry run: validates and shows existing vs proposed. Writes nothing. */
export async function previewCorrection(raw: unknown): Promise<Result<{ review: ReviewView }>> {
  const me = await requireHr();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = ChangeSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  try {
    const plan = await previewSet(setInput(me, p.data));
    const ctx = plan.day;

    const warnings: string[] = [];
    const keepsNotes: string[] = [];
    for (const c of plan.planned) {
      if (c.existingNote) {
        keepsNotes.push(c.existingNote);
        if (/^Biometric import/.test(c.existingNote)) {
          warnings.push(
            `The ${c.kind.toUpperCase()} punch came from a bulk import. Once edited here, that import's undo will leave it alone.`,
          );
        }
      }
    }
    if (plan.finalIn && plan.finalOut && plan.finalIn === plan.finalOut) {
      warnings.push(`IN and OUT are both ${plan.finalIn}. Check that this is what you mean.`);
    }
    return {
      ok: true,
      review: {
        employee: { id: ctx.emp.id, name: ctx.emp.name, email: ctx.emp.email },
        date: p.data.date,
        existing: { in: view(ctx.rows.in), out: view(ctx.rows.out) },
        changes: plan.planned.map((c) => ({ kind: c.kind, action: c.action, from: c.from, to: c.to })),
        finalIn: plan.finalIn,
        finalOut: plan.finalOut,
        reason: { code: p.data.reason, label: reasonLabel(p.data.reason) },
        explanation: p.data.explanation.trim(),
        keepsNotes,
        warnings,
        // Salary is admin-only in WMS, so only admins see the payment status.
        salaryRun: await salaryRunNotice(p.data.employeeId, p.data.date, me.isAdmin === true),
      },
    };
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "preview", "Could not check the correction. Please try again.") };
  }
}

export interface SavedCorrection {
  date: string;
  employeeName: string;
  in: string | null;
  out: string | null;
  changes: { kind: "in" | "out"; action: "add" | "change"; from: string | null; to: string }[];
  reason: { code: string; label: string };
  grade: DayGrade | null;
}

/**
 * Saves the correction: one transaction containing the punch write(s) and the
 * audit row. Refuses (writing nothing) if anything changed since the browser
 * loaded the day, if a rule fails, or if the audit row can't be written.
 */
export async function saveCorrection(raw: unknown): Promise<Result<{ saved: SavedCorrection }>> {
  const me = await requireHr();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = SaveSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const d = p.data;

  try {
    const out = await applySet(setInput(me, d));

    revalidatePath("/attendance");
    revalidatePath("/attendance/dashboard");
    revalidatePath("/hr/attendance-correction");

    return {
      ok: true,
      saved: {
        date: d.date,
        employeeName: out.day.emp.name,
        in: out.finalIn,
        out: out.finalOut,
        // The HR screen only adds or changes, never removes.
        changes: out.changes.map((c) => ({ kind: c.kind, action: c.action as "add" | "change", from: c.from, to: c.to ?? "" })),
        reason: { code: d.reason, label: reasonLabel(d.reason) },
        grade: await gradeFor(out.day.emp, d.date),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: correctionFailureMessage(err, "save", "The correction could not be saved, so nothing was changed. Please try again."),
    };
  }
}
