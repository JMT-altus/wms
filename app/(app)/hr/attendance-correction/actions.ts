"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendanceLogs, employeeEvents, employees, type Employee } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getModuleAccessFor } from "@/lib/auth/module-access";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { formatHHmmInTz, zonedWallClockToUtc } from "@/lib/attendance/zoned-time";
import { getEmployeeMonthStatus } from "@/lib/queries/attendance-status";
import {
  CORRECTION_REASON_CODES,
  EXPLANATION_MAX,
  composeNote,
  isRealDate,
  planCorrection,
  reasonLabel,
  type ExistingPunch,
  type PlannedChange,
} from "@/lib/attendance/correction/plan";

/**
 * HR → Attendance Correction (power failure / biometric outage).
 *
 * Adds a missing IN or OUT, or corrects an existing time, in `attendance_logs` —
 * the same rows the attendance report and the rules engine already read, so the
 * existing grading applies to the result and nothing is graded here. It never
 * deletes a punch and never makes a time up.
 *
 * Deliberately NOT done here (unlike the existing admin editor): no day-finalised
 * or late-deduction emails. This module does not import the notification code.
 *
 * Every action re-checks HR access on the server. The write and its audit row are
 * one transaction: if the audit can't be written the correction is not saved and
 * success is not reported. Concurrent changes are detected (the browser sends what
 * it saw; the server compares it, under a row lock, with what is stored).
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** HR module access = admins plus anyone granted HR. Checked on every call. */
async function requireHr(): Promise<Employee> {
  const me = await requireUser();
  const access = await getModuleAccessFor(me);
  if (!access.hr?.allowed) throw new Error("Forbidden");
  return me;
}

class UserError extends Error {}

const CHANGED_MEANWHILE =
  "This day was changed by someone else after you opened it. Nothing was saved. Reload the day and review it again.";

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
}

type Q = Pick<typeof db, "select">;

interface DayContext {
  emp: { id: string; name: string; email: string; timezone: string; isActive: boolean; joinDay: string };
  rows: { in: ExistingPunch | null; out: ExistingPunch | null };
}

async function loadDay(q: Q, employeeId: string, date: string, lock: boolean): Promise<DayContext> {
  const [e] = await q
    .select({
      id: employees.id,
      name: employees.name,
      email: employees.email,
      timezone: employees.timezone,
      isActive: employees.isActive,
      joinedAt: employees.joinedAt,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!e) throw new UserError("That employee was not found.");
  if (!e.isActive) throw new UserError(`${e.name} is inactive. Attendance can't be corrected for an inactive employee.`);
  const tz = e.timezone || "Asia/Kolkata";

  const base = q
    .select({
      id: attendanceLogs.id,
      kind: attendanceLogs.kind,
      loggedAt: attendanceLogs.loggedAt,
      note: attendanceLogs.note,
      source: attendanceLogs.source,
      reason: attendanceLogs.reason,
    })
    .from(attendanceLogs)
    .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.logDate, date)));
  const rows = lock ? await base.for("update") : await base;

  const pick = (kind: "in" | "out"): ExistingPunch | null => {
    const r = rows.find((x) => x.kind === kind);
    return r
      ? { id: r.id, time: formatHHmmInTz(r.loggedAt, tz), loggedAt: r.loggedAt.toISOString(), note: r.note, source: r.source, reason: r.reason }
      : null;
  };
  const joinSource = e.joinedAt ?? e.createdAt;
  return {
    emp: { id: e.id, name: e.name, email: e.email, timezone: tz, isActive: e.isActive, joinDay: localDateString(tz, joinSource) },
    rows: { in: pick("in"), out: pick("out") },
  };
}

const view = (p: ExistingPunch | null): PunchView | null =>
  p ? { time: p.time, loggedAt: p.loggedAt, source: p.source, reason: p.reason, note: p.note } : null;

function checkSnapshot(rows: DayContext["rows"], snap: { in: string | null; out: string | null }) {
  for (const kind of ["in", "out"] as const) {
    const seen = snap[kind] ? new Date(snap[kind]!).toISOString() : null;
    const now = rows[kind]?.loggedAt ?? null;
    if (seen !== now) throw new UserError(CHANGED_MEANWHILE);
  }
}

async function gradeFor(emp: DayContext["emp"], date: string): Promise<DayGrade | null> {
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
  await requireHr();
  const p = LookupSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  if (!isRealDate(p.data.date)) return { ok: false, error: "The date is not valid." };
  try {
    const ctx = await loadDay(db, p.data.employeeId, p.data.date, false);
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
    if (err instanceof UserError) return { ok: false, error: err.message };
    console.error("[attendance-correction] lookup failed", err);
    return { ok: false, error: "Could not load that day. Please try again." };
  }
}

function planFor(ctx: DayContext, d: z.output<typeof ChangeSchema>) {
  return planCorrection({
    date: d.date,
    inTime: d.inTime,
    outTime: d.outTime,
    reason: d.reason,
    explanation: d.explanation,
    today: localDateString(ctx.emp.timezone),
    joinDay: ctx.emp.joinDay,
    existing: ctx.rows,
  });
}

/** Dry run: validates and shows existing vs proposed. Writes nothing. */
export async function previewCorrection(raw: unknown): Promise<Result<{ review: ReviewView }>> {
  const me = await requireHr();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = ChangeSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  try {
    const ctx = await loadDay(db, p.data.employeeId, p.data.date, false);
    checkSnapshot(ctx.rows, p.data.snapshot);
    const plan = planFor(ctx, p.data);
    if (!plan.ok) return { ok: false, error: plan.error };

    const warnings: string[] = [];
    const keepsNotes: string[] = [];
    for (const c of plan.changes) {
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
        changes: plan.changes.map((c) => ({ kind: c.kind, action: c.action, from: c.from, to: c.to })),
        finalIn: plan.finalIn,
        finalOut: plan.finalOut,
        reason: { code: p.data.reason, label: reasonLabel(p.data.reason) },
        explanation: p.data.explanation.trim(),
        keepsNotes,
        warnings,
      },
    };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    console.error("[attendance-correction] preview failed", err);
    return { ok: false, error: "Could not check the correction. Please try again." };
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

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && ((err as { code?: string }).code === "23505" || /duplicate key|unique constraint/i.test(String((err as Error).message)));

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
  const explanation = d.explanation.trim();

  try {
    const out = await db.transaction(async (tx) => {
      // Lock the day's rows, then compare with what the browser saw.
      const ctx = await loadDay(tx as unknown as Q, d.employeeId, d.date, true);
      checkSnapshot(ctx.rows, d.snapshot);
      const plan = planFor(ctx, d);
      if (!plan.ok) throw new UserError(plan.error);
      const tz = ctx.emp.timezone;

      for (const c of plan.changes as PlannedChange[]) {
        const loggedAt = zonedWallClockToUtc(d.date, c.to, tz);
        if (c.action === "add") {
          await tx.insert(attendanceLogs).values({
            employeeId: d.employeeId,
            logDate: d.date,
            kind: c.kind,
            loggedAt,
            source: "admin",
            reason: d.reason,
            note: explanation,
            recordedById: me.id,
            verifyMethod: "none",
          });
        } else {
          const cur = ctx.rows[c.kind]!;
          const updated = await tx
            .update(attendanceLogs)
            .set({
              loggedAt,
              source: "admin",
              reason: d.reason,
              note: composeNote(c.existingNote, explanation),
              recordedById: me.id,
              verifyMethod: "none",
            })
            // Only if the punch is still exactly what we locked and compared.
            .where(and(eq(attendanceLogs.id, cur.id), eq(attendanceLogs.loggedAt, new Date(cur.loggedAt))))
            .returning({ id: attendanceLogs.id });
          if (updated.length !== 1) throw new UserError(CHANGED_MEANWHILE);
        }
      }

      const label = reasonLabel(d.reason);
      const summary = plan.changes.map((c) => ({ kind: c.kind, action: c.action, from: c.from, to: c.to }));
      const was = (x: ExistingPunch | null) =>
        x ? { time: x.time, loggedAt: x.loggedAt, source: x.source, reason: x.reason, note: x.note } : null;
      // The audit row is part of the transaction: no audit, no correction.
      await tx.insert(employeeEvents).values({
        employeeId: d.employeeId,
        actorId: me.id,
        eventType: "attendance_correction",
        fromValue: { date: d.date, in: was(ctx.rows.in), out: was(ctx.rows.out) },
        toValue: {
          date: d.date,
          reason: d.reason,
          reasonLabel: label,
          explanation,
          changes: summary,
          finalIn: plan.finalIn,
          finalOut: plan.finalOut,
        },
        note: `HR attendance correction for ${d.date} (${label}): ${explanation}`,
      });

      return { ctx, plan, summary };
    });

    revalidatePath("/attendance");
    revalidatePath("/attendance/dashboard");
    revalidatePath("/hr/attendance-correction");

    return {
      ok: true,
      saved: {
        date: d.date,
        employeeName: out.ctx.emp.name,
        in: out.plan.finalIn,
        out: out.plan.finalOut,
        changes: out.summary,
        reason: { code: d.reason, label: reasonLabel(d.reason) },
        grade: await gradeFor(out.ctx.emp, d.date),
      },
    };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    if (isUniqueViolation(err)) return { ok: false, error: CHANGED_MEANWHILE };
    console.error("[attendance-correction] save failed", err);
    return { ok: false, error: "The correction could not be saved, so nothing was changed. Please try again." };
  }
}
