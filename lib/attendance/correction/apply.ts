import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendanceLogs, employeeEvents, employees, salaryRuns } from "@/db/schema";
import { localDateString } from "@/lib/format";
import { formatHHmmInTz, zonedWallClockToUtc } from "@/lib/attendance/zoned-time";
import { effectiveJoinDay } from "@/lib/attendance/join-day";
import {
  composeNote,
  planCorrection,
  planDeletion,
  reasonLabel,
  type ExistingPunch,
  type PlannedChange,
} from "@/lib/attendance/correction/plan";

/**
 * The one place a recorded punch is corrected, added on someone's behalf, or
 * removed — used by HR → Attendance Correction and by the admin day editor.
 * Ordinary self-punches and the bulk import keep their own paths.
 *
 * Technical invariants (not business settings, so not configurable):
 *   - nobody changes their own attendance here (checked against the signed-in
 *     employee's id, never a client-supplied one);
 *   - the day's punches are locked, compared with what the caller saw, and
 *     re-planned before anything is written;
 *   - the punch write(s) and the audit row commit or roll back together;
 *   - salary runs are never read for writing, recalculated or changed.
 */

type Q = Pick<typeof db, "select">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A message that is safe to show the user. Anything else is logged and replaced. */
export class CorrectionError extends Error {}

export const CHANGED_MEANWHILE =
  "This day was changed by someone else after you opened it. Nothing was saved. Reload the day and review it again.";
export const SELF_CORRECTION =
  "You can't change your own attendance. Ask another authorised person to make this correction.";

/** Refuse a change to the actor's own attendance. Both ids are employees.id. */
export function assertNotSelf(actorId: string, employeeId: string): void {
  if (actorId === employeeId) throw new CorrectionError(SELF_CORRECTION);
}

export interface CorrectionDay {
  emp: { id: string; name: string; email: string; timezone: string; isActive: boolean; joinDay: string };
  rows: { in: ExistingPunch | null; out: ExistingPunch | null };
}

/** The employee and the punches stored for one day, optionally locked FOR UPDATE. */
export async function loadCorrectionDay(q: Q, employeeId: string, date: string, lock: boolean): Promise<CorrectionDay> {
  const [e] = await q
    .select({
      id: employees.id,
      name: employees.name,
      email: employees.email,
      timezone: employees.timezone,
      isActive: employees.isActive,
      joinedAt: employees.joinedAt,
      createdAt: employees.createdAt,
      // First recorded attendance date — the same effective-join rule grading uses (lib/attendance/join-day.ts).
      // "employees"."id" is spelled out: Drizzle renders `${employees.id}` unqualified ("id") in a
      // single-table select, which inside the subquery would mean attendance_logs.id.
      firstLogDate: sql<string | null>`(select min(${attendanceLogs.logDate})::text from ${attendanceLogs} where ${attendanceLogs.employeeId} = ${sql.identifier("employees")}.${sql.identifier("id")})`,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!e) throw new CorrectionError("That employee was not found.");
  if (!e.isActive) throw new CorrectionError(`${e.name} is inactive. Attendance can't be corrected for an inactive employee.`);
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
  const joinDay = effectiveJoinDay(localDateString(tz, joinSource), e.firstLogDate);
  return {
    emp: { id: e.id, name: e.name, email: e.email, timezone: tz, isActive: e.isActive, joinDay },
    rows: { in: pick("in"), out: pick("out") },
  };
}

/** What the caller saw stored for each side (loggedAt ISO), or null for "no punch". */
export interface DaySnapshot {
  in: string | null;
  out: string | null;
}

export function checkSnapshot(rows: CorrectionDay["rows"], snap: DaySnapshot): void {
  for (const kind of ["in", "out"] as const) {
    const seen = snap[kind] ? new Date(snap[kind]!).toISOString() : null;
    const now = rows[kind]?.loggedAt ?? null;
    if (seen !== now) throw new CorrectionError(CHANGED_MEANWHILE);
  }
}

/**
 * Postgres stores `logged_at` to the microsecond (a self-punch takes the
 * database's now()), while a JS Date — and therefore the ISO the row was read
 * as — holds milliseconds. Compare at millisecond precision so a punch that is
 * still exactly what was locked and read matches; any real change does not.
 */
function stillStored(cur: ExistingPunch) {
  return and(
    eq(attendanceLogs.id, cur.id),
    sql`date_trunc('milliseconds', ${attendanceLogs.loggedAt}) = ${cur.loggedAt}::timestamptz`,
  );
}

const wasPunch = (x: ExistingPunch | null) =>
  x ? { id: x.id, time: x.time, loggedAt: x.loggedAt, source: x.source, reason: x.reason, note: x.note } : null;

interface CommonInput {
  actorId: string;
  employeeId: string;
  date: string;
  reason: string;
  explanation: string;
  allowedReasons?: readonly string[];
  /** The audit event type this entry point has always written. */
  eventType: string;
  /** Which screen or action made the change, kept in the audit row. */
  via: string;
  /** Start of the audit note, e.g. "HR attendance correction" (kept as each screen has always written it). */
  noteLabel: string;
}

export type SetInput = CommonInput & {
  inTime?: string | null;
  outTime?: string | null;
  /**
   * What the caller saw, compared under the row lock. "add-only" (quick punch)
   * skips it but then refuses anything except adding a punch that isn't there.
   */
  snapshot: DaySnapshot | "add-only";
};

export interface ChangeSummary {
  kind: "in" | "out";
  action: "add" | "change" | "remove";
  from: string | null;
  to: string | null;
}

export interface AppliedCorrection {
  day: CorrectionDay;
  changes: ChangeSummary[];
  finalIn: string | null;
  finalOut: string | null;
}

/** Plan only (no writes) — for a review screen. Throws CorrectionError on a rule failure. */
export async function previewSet(input: SetInput): Promise<AppliedCorrection & { planned: PlannedChange[] }> {
  assertNotSelf(input.actorId, input.employeeId);
  const day = await loadCorrectionDay(db, input.employeeId, input.date, false);
  if (input.snapshot !== "add-only") checkSnapshot(day.rows, input.snapshot);
  const plan = planFor(day, input);
  return { day, planned: plan.changes, changes: plan.changes.map(summary), finalIn: plan.finalIn, finalOut: plan.finalOut };
}

function planFor(day: CorrectionDay, input: SetInput) {
  const plan = planCorrection({
    date: input.date,
    inTime: input.inTime,
    outTime: input.outTime,
    reason: input.reason,
    explanation: input.explanation,
    today: localDateString(day.emp.timezone),
    joinDay: day.emp.joinDay,
    existing: day.rows,
    allowedReasons: input.allowedReasons,
  });
  if (!plan.ok) throw new CorrectionError(plan.error);
  if (input.snapshot === "add-only") {
    const taken = plan.changes.find((c) => c.action !== "add");
    if (taken) {
      throw new CorrectionError(
        `${taken.kind.toUpperCase()} is already recorded at ${taken.from} on ${input.date}. Change it in the attendance day editor instead.`,
      );
    }
  }
  return plan;
}

const summary = (c: PlannedChange): ChangeSummary => ({ kind: c.kind, action: c.action, from: c.from, to: c.to });

/** Add and/or change punches for one day, with the audit row, in one transaction. */
export async function applySet(input: SetInput): Promise<AppliedCorrection> {
  assertNotSelf(input.actorId, input.employeeId);
  const explanation = input.explanation.trim();
  return db.transaction(async (tx) => {
    const day = await loadCorrectionDay(tx as unknown as Q, input.employeeId, input.date, true);
    if (input.snapshot !== "add-only") checkSnapshot(day.rows, input.snapshot);
    const plan = planFor(day, input);
    const tz = day.emp.timezone;

    for (const c of plan.changes) {
      const loggedAt = zonedWallClockToUtc(input.date, c.to, tz);
      if (c.action === "add") {
        await tx.insert(attendanceLogs).values({
          employeeId: input.employeeId,
          logDate: input.date,
          kind: c.kind,
          loggedAt,
          source: "admin",
          reason: input.reason,
          note: explanation,
          recordedById: input.actorId,
          verifyMethod: "none",
        });
      } else {
        const cur = day.rows[c.kind]!;
        const updated = await tx
          .update(attendanceLogs)
          .set({
            loggedAt,
            source: "admin",
            reason: input.reason,
            note: composeNote(c.existingNote, explanation),
            recordedById: input.actorId,
            verifyMethod: "none",
          })
          .where(stillStored(cur))
          .returning({ id: attendanceLogs.id });
        if (updated.length !== 1) throw new CorrectionError(CHANGED_MEANWHILE);
      }
    }

    const changes = plan.changes.map(summary);
    await writeAudit(tx, input, day, explanation, changes, plan.finalIn, plan.finalOut);
    return { day, changes, finalIn: plan.finalIn, finalOut: plan.finalOut };
  });
}

export type DeleteInput = CommonInput & { kind: "in" | "out"; snapshot: DaySnapshot };

/** Remove one punch, keeping its full previous details in the audit row, in one transaction. */
export async function applyDelete(input: DeleteInput): Promise<AppliedCorrection> {
  assertNotSelf(input.actorId, input.employeeId);
  const explanation = input.explanation.trim();
  return db.transaction(async (tx) => {
    const day = await loadCorrectionDay(tx as unknown as Q, input.employeeId, input.date, true);
    checkSnapshot(day.rows, input.snapshot);
    const plan = planDeletion({
      date: input.date,
      kind: input.kind,
      reason: input.reason,
      explanation: input.explanation,
      today: localDateString(day.emp.timezone),
      joinDay: day.emp.joinDay,
      existing: day.rows,
      allowedReasons: input.allowedReasons,
    });
    if (!plan.ok) throw new CorrectionError(plan.error);
    const removed = await tx
      .delete(attendanceLogs)
      .where(stillStored(plan.removed))
      .returning({ id: attendanceLogs.id });
    if (removed.length !== 1) throw new CorrectionError(CHANGED_MEANWHILE);

    const changes: ChangeSummary[] = [{ kind: plan.kind, action: "remove", from: plan.removed.time, to: null }];
    await writeAudit(tx, input, day, explanation, changes, plan.finalIn, plan.finalOut);
    return { day, changes, finalIn: plan.finalIn, finalOut: plan.finalOut };
  });
}

async function writeAudit(
  tx: Tx,
  input: CommonInput,
  day: CorrectionDay,
  explanation: string,
  changes: ChangeSummary[],
  finalIn: string | null,
  finalOut: string | null,
) {
  const label = reasonLabel(input.reason);
  // Part of the caller's transaction: no audit, no change.
  await tx.insert(employeeEvents).values({
    employeeId: input.employeeId,
    actorId: input.actorId,
    eventType: input.eventType,
    fromValue: { date: input.date, in: wasPunch(day.rows.in), out: wasPunch(day.rows.out) },
    toValue: { date: input.date, via: input.via, reason: input.reason, reasonLabel: label, explanation, changes, finalIn, finalOut },
    note: `${input.noteLabel} for ${input.date} (${label}): ${explanation}`,
  });
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  ((err as { code?: string }).code === "23505" || /duplicate key|unique constraint/i.test(String((err as Error).message)));

/**
 * The message to show for a failed correction. Rule failures pass through; a
 * duplicate-key race reads as "changed meanwhile"; anything else is logged on
 * the server and replaced with a generic sentence (no database detail leaks).
 */
export function correctionFailureMessage(err: unknown, logLabel: string, generic: string): string {
  if (err instanceof CorrectionError) return err.message;
  if (isUniqueViolation(err)) return CHANGED_MEANWHILE;
  console.error(`[attendance-correction] ${logLabel} failed`, err);
  return generic;
}

export interface SalaryRunNotice {
  /** YYYY-MM */
  month: string;
  /** Present only when the viewer may see payroll status. */
  disbursed?: boolean;
}

/**
 * Whether a salary run already exists for the employee and the month of `date`.
 * Read-only. Amounts are never returned; disbursement status only when
 * `includeStatus` (the caller decides from the viewer's payroll access).
 */
export async function salaryRunNotice(employeeId: string, date: string, includeStatus: boolean): Promise<SalaryRunNotice | null> {
  const month = date.slice(0, 7);
  try {
    const [run] = await db
      .select({ disbursed: salaryRuns.disbursed })
      .from(salaryRuns)
      .where(and(eq(salaryRuns.employeeId, employeeId), eq(salaryRuns.month, month)))
      .limit(1);
    if (!run) return null;
    return includeStatus ? { month, disbursed: run.disbursed } : { month };
  } catch (err) {
    // A courtesy check: it must not block the correction, but say so in the log.
    console.error("[attendance-correction] salary-run check failed", err);
    return null;
  }
}
