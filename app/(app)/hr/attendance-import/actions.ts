"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendanceLogs, employees, employeeEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import {
  buildPlan,
  punchKey,
  SKIP_EMPLOYEE,
  type EmployeePlanStats,
  type Plan,
  type PlanSummary,
  type RowIssue,
} from "@/lib/attendance/import/plan";
import { periodWarnings, summarizeDates, type DateSummary } from "@/lib/attendance/import/period";
import {
  IMPORT_EVENT,
  IMPORT_UNDO_EVENT,
  batchNote,
  classifyBatchDays,
  parseImportEvent,
  parseUndoEvent,
  type InventoryPunch,
  type StoredPunch,
} from "@/lib/attendance/import/batch";

/**
 * Attendance import (HR → Attendance Import).
 *
 * The browser parses the file locally and sends only the parsed punch rows.
 * Nothing the client says is trusted: every date, time, mapping and employee is
 * checked again here, the target employees' timezones and the punches that
 * already exist are read from the database, and the plan is rebuilt from
 * scratch before anything is written.
 *
 * Writes go straight into `attendance_logs` with INSERT … ON CONFLICT DO
 * NOTHING on the existing (employee, day, kind) unique index. That makes the
 * import skip — never overwrite — a punch that is already there, and makes a
 * re-run harmless. It deliberately does NOT use the admin edit/upsert actions:
 * those overwrite rows and send late / day-complete emails.
 *
 * Every run gets a batch id. The punches it inserts are tagged with it (the
 * punch's existing `note`) and listed, with their ids and stored times, in the
 * audit row — see lib/attendance/import/batch.ts. That is what the inventory
 * and the guarded undo below rely on. No schema change.
 *
 * Importing raw punches does not touch payroll, leave, overtime or COM OFF.
 */

const MAX_EMPLOYEES = 500;
const MAX_DAYS_PER_EMPLOYEE = 400;
const MAX_TOTAL_ROWS = 20_000;
const MAX_SPAN_DAYS = 366;
const CHUNK = 500;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

const PeriodSchema = z
  .object({ from: ymd, to: ymd })
  .refine((p) => p.from <= p.to, "The period start is after its end.")
  .refine(
    (p) => (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 <= MAX_SPAN_DAYS,
    `The period is longer than ${MAX_SPAN_DAYS} days.`,
  );

const DaySchema = z.object({
  rowNo: z.number().int().min(0).max(1_000_000),
  date: ymd.nullable(),
  inTime: hhmm.nullable(),
  outTime: hhmm.nullable(),
  status: z.string().max(120).nullable(),
  problems: z.array(z.string().max(300)).max(10),
});

const BaseSchema = z.object({
  fileName: z.string().max(200).optional(),
  employees: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        code: z.string().min(1).max(120),
        name: z.string().max(200),
        department: z.string().max(200).nullable(),
        days: z.array(DaySchema).max(MAX_DAYS_PER_EMPLOYEE),
        noPunchDays: z.number().int().min(0).max(5000),
      }),
    )
    .min(1, "The file has no employees to import.")
    .max(MAX_EMPLOYEES),
  /** source key → JMT employee uuid | "skip". */
  mapping: z.record(z.string(), z.union([z.string().uuid(), z.literal(SKIP_EMPLOYEE)])),
  declaredPeriod: PeriodSchema.nullable(),
});

const CheckSchema = BaseSchema.extend({ confirmedPeriod: PeriodSchema.nullable() });
const RunSchema = BaseSchema.extend({
  confirmedPeriod: PeriodSchema,
  acknowledged: z.object({ mappings: z.literal(true), period: z.literal(true) }),
});

const totalRows = (d: { employees: { days: unknown[] }[] }) => d.employees.reduce((n, e) => n + e.days.length, 0);

export interface MappedIdentity {
  sourceKey: string;
  employeeId: string;
  name: string;
  email: string;
  firstDate: string | null;
  lastDate: string | null;
  ready: number;
  duplicate: number;
  mismatch: number;
}

export interface ImportPreview {
  summary: PlanSummary;
  issues: RowIssue[];
  blockers: string[];
  /** Verified identity of every mapped person, with what would be written for them. */
  mapped: MappedIdentity[];
  /** Dates of the valid punches the import would touch. */
  punchDates: DateSummary;
  periodWarnings: string[];
}

export interface ImportRunResult {
  batchId: string;
  /** Punches in the plan = inserted + skippedExisting + failed. */
  planned: number;
  inserted: number;
  /** Already stored (same time or a different time) or lost a race — never overwritten. */
  skippedExisting: number;
  failed: number;
  rejectedRows: number;
  perEmployee: {
    sourceKey: string;
    name: string;
    planned: number;
    inserted: number;
    skippedExisting: number;
    failed: number;
    error: string | null;
  }[];
  summary: PlanSummary;
  issues: RowIssue[];
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

interface Identity {
  id: string;
  name: string;
  email: string;
}

async function computePlan(
  input: z.output<typeof CheckSchema>,
): Promise<{ plan: Plan; identities: Map<string, Identity> }> {
  const mappedIds = [...new Set(Object.values(input.mapping).filter((v) => v !== SKIP_EMPLOYEE))];

  const employeeTz = new Map<string, string>();
  const identities = new Map<string, Identity>();
  if (mappedIds.length > 0) {
    const rows = await db
      .select({ id: employees.id, timezone: employees.timezone, name: employees.name, email: employees.email })
      .from(employees)
      .where(and(inArray(employees.id, mappedIds), eq(employees.isActive, true)));
    for (const r of rows) {
      employeeTz.set(r.id, r.timezone || "Asia/Kolkata");
      identities.set(r.id, { id: r.id, name: r.name, email: r.email });
    }
  }

  // Existing punches (with their stored times) for exactly the people and dates in the file.
  const dates = input.employees.flatMap((e) => e.days.map((d) => d.date)).filter((d): d is string => !!d);
  const existing = new Map<string, Date>();
  if (employeeTz.size > 0 && dates.length > 0) {
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));
    const rows = await db
      .select({
        employeeId: attendanceLogs.employeeId,
        logDate: attendanceLogs.logDate,
        kind: attendanceLogs.kind,
        loggedAt: attendanceLogs.loggedAt,
      })
      .from(attendanceLogs)
      .where(
        and(
          inArray(attendanceLogs.employeeId, [...employeeTz.keys()]),
          gte(attendanceLogs.logDate, from),
          lte(attendanceLogs.logDate, to),
        ),
      );
    for (const r of rows) existing.set(punchKey(r.employeeId, r.logDate, r.kind), r.loggedAt);
  }

  const plan = buildPlan({
    employees: input.employees,
    mapping: input.mapping,
    employeeTz,
    existing,
    today: localDateString("Asia/Kolkata"),
    declaredPeriod: input.declaredPeriod,
    confirmedPeriod: input.confirmedPeriod,
  });
  return { plan, identities };
}

function parseWith<S extends z.ZodType>(schema: S, raw: unknown): Result<{ data: z.output<S> }> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import data." };
  }
  const data = parsed.data as z.output<S> & { employees: { days: unknown[] }[] };
  if (totalRows(data) > MAX_TOTAL_ROWS) {
    return { ok: false, error: `This file has more than ${MAX_TOTAL_ROWS} punch rows. Split it by month and import the parts one at a time.` };
  }
  return { ok: true, data };
}

function mappedIdentities(plan: Plan, identities: Map<string, Identity>): MappedIdentity[] {
  return plan.perEmployee.map((s: EmployeePlanStats) => {
    const who = identities.get(s.employeeId);
    return {
      sourceKey: s.sourceKey,
      employeeId: s.employeeId,
      name: who?.name ?? "Unknown employee",
      email: who?.email ?? "",
      firstDate: s.firstDate,
      lastDate: s.lastDate,
      ready: s.ready,
      duplicate: s.duplicate,
      mismatch: s.mismatch,
    };
  });
}

/** Dry run: validates and plans, writes nothing. */
export async function previewAttendanceImport(raw: unknown): Promise<Result<{ preview: ImportPreview }>> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = parseWith(CheckSchema, raw);
  if (!p.ok) return p;

  const { plan, identities } = await computePlan(p.data);
  return {
    ok: true,
    preview: {
      summary: plan.summary,
      issues: plan.issues,
      blockers: plan.blockers,
      mapped: mappedIdentities(plan, identities),
      punchDates: plan.punchDates,
      periodWarnings: periodWarnings({
        fileName: p.data.fileName,
        dates: plan.punchDates,
        declared: p.data.declaredPeriod,
      }),
    },
  };
}

/**
 * Writes the validated punches. One transaction per employee: if one person's
 * insert fails, that person is rolled back and reported while the others still
 * commit, and a re-run picks up only what is missing. The audit row (with the
 * batch inventory) is written in the same transaction, and only when at least
 * one punch was actually inserted.
 */
export async function runAttendanceImport(raw: unknown): Promise<Result<{ result: ImportRunResult }>> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = parseWith(RunSchema, raw);
  if (!p.ok) return p;

  const { plan } = await computePlan(p.data);
  if (plan.blockers.length > 0) {
    return { ok: false, error: `Import blocked: ${plan.blockers[0]}` };
  }

  const batchId = randomUUID();
  const tag = batchNote(batchId);
  const nameByKey = new Map(p.data.employees.map((e) => [e.key, e.name || e.code]));
  const readyByKey = new Map<string, typeof plan.punches>();
  for (const x of plan.punches) {
    if (x.status !== "ready") continue;
    readyByKey.set(x.sourceKey, [...(readyByKey.get(x.sourceKey) ?? []), x]);
  }

  const result: ImportRunResult = {
    batchId,
    planned: 0,
    inserted: 0,
    skippedExisting: 0,
    failed: 0,
    rejectedRows: plan.summary.invalidRows,
    perEmployee: [],
    summary: plan.summary,
    issues: plan.issues,
  };

  for (const stats of plan.perEmployee) {
    if (stats.planned === 0) continue;
    const list = readyByKey.get(stats.sourceKey) ?? [];
    const alreadyThere = stats.duplicate + stats.mismatch;
    const row = {
      sourceKey: stats.sourceKey,
      name: nameByKey.get(stats.sourceKey) ?? stats.sourceKey,
      planned: stats.planned,
      inserted: 0,
      skippedExisting: alreadyThere,
      failed: 0,
      error: null as string | null,
    };
    result.planned += stats.planned;

    if (list.length > 0) {
      const written: InventoryPunch[] = [];
      try {
        await db.transaction(async (tx) => {
          for (let i = 0; i < list.length; i += CHUNK) {
            const rows = await tx
              .insert(attendanceLogs)
              .values(
                list.slice(i, i + CHUNK).map((x) => ({
                  employeeId: x.employeeId,
                  logDate: x.date,
                  kind: x.kind,
                  loggedAt: new Date(x.loggedAt),
                  source: "admin" as const,
                  reason: "import",
                  recordedById: me.id,
                  verifyMethod: "none" as const,
                  note: tag,
                })),
              )
              .onConflictDoNothing()
              .returning({
                id: attendanceLogs.id,
                logDate: attendanceLogs.logDate,
                kind: attendanceLogs.kind,
                loggedAt: attendanceLogs.loggedAt,
              });
            for (const r of rows) written.push({ id: r.id, date: r.logDate, kind: r.kind, at: r.loggedAt.toISOString() });
          }
          // Audit + exact inventory of what this batch wrote, in the same
          // transaction. Skipped entirely when nothing was inserted.
          if (written.length > 0) {
            const dates = written.map((w) => w.date).sort();
            await tx.insert(employeeEvents).values({
              employeeId: list[0]!.employeeId,
              actorId: me.id,
              eventType: IMPORT_EVENT,
              toValue: {
                batchId,
                file: p.data.fileName ?? null,
                confirmedPeriod: p.data.confirmedPeriod,
                inserted: written.length,
                attempted: list.length,
                from: dates[0] ?? null,
                to: dates[dates.length - 1] ?? null,
                punches: written,
              },
              note: `Attendance import ${batchId}: ${written.length} punch${written.length === 1 ? "" : "es"} added`,
            });
          }
        });
        row.inserted = written.length;
        row.skippedExisting += list.length - written.length; // lost a race to a concurrent insert
      } catch (err) {
        console.error("[attendance-import] employee batch failed", stats.sourceKey, err);
        row.inserted = 0;
        row.failed = list.length;
        row.error =
          "The database rejected this employee's punches. Nothing was saved for them; run the import again to retry.";
      }
    }
    result.inserted += row.inserted;
    result.skippedExisting += row.skippedExisting;
    result.failed += row.failed;
    result.perEmployee.push(row);
  }

  revalidatePath("/attendance");
  revalidatePath("/attendance/dashboard");
  revalidatePath("/hr/attendance-import");
  return { ok: true, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch inventory and guarded undo
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchSummary {
  batchId: string;
  createdAt: string;
  actorName: string;
  file: string | null;
  people: number;
  punches: number;
  removed: number;
  from: string | null;
  to: string | null;
}

export interface BatchInspection {
  batchId: string;
  createdAt: string;
  actorName: string;
  file: string | null;
  /** `intact` = punches an undo would remove. `keptDayTouched` = unchanged punches an undo would
   *  keep because their employee/date was edited or has a punch this import did not write. */
  totals: { recorded: number; intact: number; modified: number; missing: number; removed: number; keptDayTouched: number };
  people: {
    employeeId: string;
    name: string;
    email: string;
    recorded: number;
    intact: number;
    modified: number;
    missing: number;
    removed: number;
    keptDayTouched: number;
    modifiedDetails: { date: string; kind: "in" | "out"; why: string[] }[];
    touchedDays: { date: string; why: string[] }[];
  }[];
}

const BatchIdSchema = z.string().uuid();

interface LoadedBatch {
  createdAt: Date;
  actorId: string;
  file: string | null;
  perEmployee: Map<string, InventoryPunch[]>;
  removed: Set<string>;
}

async function loadBatch(batchId: string): Promise<LoadedBatch | null> {
  const events = await db
    .select({
      employeeId: employeeEvents.employeeId,
      actorId: employeeEvents.actorId,
      eventType: employeeEvents.eventType,
      toValue: employeeEvents.toValue,
      createdAt: employeeEvents.createdAt,
    })
    .from(employeeEvents)
    .where(
      and(
        inArray(employeeEvents.eventType, [IMPORT_EVENT, IMPORT_UNDO_EVENT]),
        sql`${employeeEvents.toValue}->>'batchId' = ${batchId}`,
      ),
    )
    .orderBy(asc(employeeEvents.createdAt));

  const perEmployee = new Map<string, InventoryPunch[]>();
  const removed = new Set<string>();
  let createdAt: Date | null = null;
  let actorId: string | null = null;
  let file: string | null = null;
  for (const ev of events) {
    if (ev.eventType === IMPORT_EVENT) {
      const v = parseImportEvent(ev.toValue);
      if (!v || v.batchId !== batchId) continue;
      createdAt ??= ev.createdAt;
      actorId ??= ev.actorId;
      file ??= v.file;
      perEmployee.set(ev.employeeId, [...(perEmployee.get(ev.employeeId) ?? []), ...v.punches]);
    } else {
      const u = parseUndoEvent(ev.toValue);
      if (u && u.batchId === batchId) for (const id of u.removedIds) removed.add(id);
    }
  }
  if (!createdAt || !actorId) return null;
  return { createdAt, actorId, file, perEmployee, removed };
}

const STORED_COLS = {
  id: attendanceLogs.id,
  employeeId: attendanceLogs.employeeId,
  logDate: attendanceLogs.logDate,
  kind: attendanceLogs.kind,
  loggedAt: attendanceLogs.loggedAt,
  note: attendanceLogs.note,
  source: attendanceLogs.source,
  reason: attendanceLogs.reason,
  recordedById: attendanceLogs.recordedById,
};

async function nameMap(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
  const out = new Map<string, { name: string; email: string }>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .where(inArray(employees.id, [...new Set(ids)]));
  for (const r of rows) out.set(r.id, { name: r.name, email: r.email });
  return out;
}

/** Read-only: the recent import batches, newest first. */
export async function listImportBatches(): Promise<Result<{ batches: BatchSummary[] }>> {
  await requireAdmin();
  const events = await db
    .select({
      employeeId: employeeEvents.employeeId,
      actorId: employeeEvents.actorId,
      eventType: employeeEvents.eventType,
      toValue: employeeEvents.toValue,
      createdAt: employeeEvents.createdAt,
    })
    .from(employeeEvents)
    .where(inArray(employeeEvents.eventType, [IMPORT_EVENT, IMPORT_UNDO_EVENT]))
    .orderBy(desc(employeeEvents.createdAt))
    .limit(1000);

  const batches = new Map<
    string,
    { createdAt: Date; actorId: string; file: string | null; people: Set<string>; punches: number; removed: number; from: string | null; to: string | null }
  >();
  for (const ev of events) {
    if (ev.eventType === IMPORT_EVENT) {
      const v = parseImportEvent(ev.toValue);
      if (!v) continue;
      const b = batches.get(v.batchId) ?? {
        createdAt: ev.createdAt, actorId: ev.actorId, file: v.file, people: new Set<string>(), punches: 0, removed: 0, from: null, to: null,
      };
      if (ev.createdAt < b.createdAt) b.createdAt = ev.createdAt;
      b.people.add(ev.employeeId);
      b.punches += v.punches.length;
      if (v.from && (!b.from || v.from < b.from)) b.from = v.from;
      if (v.to && (!b.to || v.to > b.to)) b.to = v.to;
      batches.set(v.batchId, b);
    }
  }
  for (const ev of events) {
    if (ev.eventType !== IMPORT_UNDO_EVENT) continue;
    const u = parseUndoEvent(ev.toValue);
    const b = u ? batches.get(u.batchId) : undefined;
    if (u && b) b.removed += u.removedIds.length;
  }
  const names = await nameMap([...batches.values()].map((b) => b.actorId));
  return {
    ok: true,
    batches: [...batches]
      .sort((a, b) => b[1].createdAt.getTime() - a[1].createdAt.getTime())
      .slice(0, 30)
      .map(([batchId, b]) => ({
        batchId,
        createdAt: b.createdAt.toISOString(),
        actorName: names.get(b.actorId)?.name ?? "Unknown admin",
        file: b.file,
        people: b.people.size,
        punches: b.punches,
        removed: b.removed,
        from: b.from,
        to: b.to,
      })),
  };
}

async function inspect(batchId: string, batch: LoadedBatch): Promise<BatchInspection> {
  const allIds = [...batch.perEmployee.values()].flat().map((p) => p.id);
  const stored = new Map<string, StoredPunch>();
  for (let i = 0; i < allIds.length; i += 1000) {
    const rows = await db.select(STORED_COLS).from(attendanceLogs).where(inArray(attendanceLogs.id, allIds.slice(i, i + 1000)));
    for (const r of rows) stored.set(r.id, r as StoredPunch);
  }
  // Every OTHER punch on those people's batch dates, so a day that HR has worked on is recognised.
  const batchDates = [...new Set([...batch.perEmployee.values()].flat().map((p) => p.date))];
  if (batchDates.length > 0) {
    const sameDays = await db
      .select(STORED_COLS)
      .from(attendanceLogs)
      .where(and(inArray(attendanceLogs.employeeId, [...batch.perEmployee.keys()]), inArray(attendanceLogs.logDate, batchDates)));
    for (const r of sameDays) stored.set(r.id, r as StoredPunch);
  }
  const who = await nameMap([batch.actorId, ...batch.perEmployee.keys()]);
  const people: BatchInspection["people"] = [];
  const totals = { recorded: 0, intact: 0, modified: 0, missing: 0, removed: 0, keptDayTouched: 0 };
  for (const [employeeId, punches] of batch.perEmployee) {
    const row = {
      employeeId,
      name: who.get(employeeId)?.name ?? "Unknown employee",
      email: who.get(employeeId)?.email ?? "",
      recorded: punches.length, intact: 0, modified: 0, missing: 0, removed: 0, keptDayTouched: 0,
      modifiedDetails: [] as { date: string; kind: "in" | "out"; why: string[] }[],
      touchedDays: [] as { date: string; why: string[] }[],
    };
    const live = punches.filter((p) => !batch.removed.has(p.id));
    row.removed = punches.length - live.length;
    const day = classifyBatchDays(live, employeeId, [...stored.values()].filter((r) => r.employeeId === employeeId), { batchId, actorId: batch.actorId });
    row.touchedDays = day.touchedDays.slice(0, 20);
    for (const inv of live) {
      const st = day.byId.get(inv.id)!;
      if (st.state === "intact") row.intact++;
      else if (st.state === "missing") row.missing++;
      else if (st.state === "kept_day_touched") row.keptDayTouched++;
      else {
        row.modified++;
        if (row.modifiedDetails.length < 20) row.modifiedDetails.push({ date: inv.date, kind: inv.kind, why: st.why });
      }
    }
    for (const k of ["recorded", "intact", "modified", "missing", "removed", "keptDayTouched"] as const) totals[k] += row[k];
    people.push(row);
  }
  return {
    batchId,
    createdAt: batch.createdAt.toISOString(),
    actorName: who.get(batch.actorId)?.name ?? "Unknown admin",
    file: batch.file,
    totals,
    people,
  };
}

/** Read-only: what a batch wrote and what state each of those punches is in now. */
export async function inspectImportBatch(rawBatchId: unknown): Promise<Result<{ inspection: BatchInspection }>> {
  await requireAdmin();
  const id = BatchIdSchema.safeParse(rawBatchId);
  if (!id.success) return { ok: false, error: "Invalid batch id." };
  const batch = await loadBatch(id.data);
  if (!batch) return { ok: false, error: "No import was recorded under that batch id." };
  return { ok: true, inspection: await inspect(id.data, batch) };
}

export interface UndoResult {
  batchId: string;
  removed: number;
  keptModified: number;
  missing: number;
  /** Unchanged punches kept because their employee/date was edited or has a punch this import did not write. */
  keptDayTouched: number;
  /** How many employee/dates were skipped for that reason. */
  daysSkipped: number;
  failedPeople: number;
}

/**
 * Removes the punches a batch wrote — ONLY those whose ownership and unchanged
 * state can be verified right now (see classifyBatchPunch), and ONLY on days no
 * one has worked on since (see classifyBatchDays): if HR corrected or added any
 * punch for an employee on a date, that whole employee/date is skipped, so a
 * half day is never left behind. Each person is handled in their own transaction
 * with every stored punch for those dates locked, and the delete repeats the
 * batch-tag / reason / source conditions in SQL.
 */
export async function undoImportBatch(raw: unknown): Promise<Result<{ undo: UndoResult }>> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const parsed = z.object({ batchId: BatchIdSchema, confirm: z.literal(true) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Confirm the undo to continue." };
  const { batchId } = parsed.data;

  const batch = await loadBatch(batchId);
  if (!batch) return { ok: false, error: "No import was recorded under that batch id." };
  const tag = batchNote(batchId);

  const out: UndoResult = { batchId, removed: 0, keptModified: 0, missing: 0, keptDayTouched: 0, daysSkipped: 0, failedPeople: 0 };
  for (const [employeeId, punches] of batch.perEmployee) {
    const todo = punches.filter((p) => !batch.removed.has(p.id));
    if (todo.length === 0) continue;
    try {
      await db.transaction(async (tx) => {
        // Lock the batch's own punches AND every other stored punch for this person on
        // those dates, so a day HR worked on is seen as it really is.
        const dates = [...new Set(todo.map((p) => p.date))];
        const rows = await tx
          .select(STORED_COLS)
          .from(attendanceLogs)
          .where(
            or(
              inArray(attendanceLogs.id, todo.map((p) => p.id)),
              and(eq(attendanceLogs.employeeId, employeeId), inArray(attendanceLogs.logDate, dates)),
            ),
          )
          .for("update");
        const day = classifyBatchDays(todo, employeeId, rows as StoredPunch[], { batchId, actorId: batch.actorId });
        const intact: string[] = [];
        let kept = 0;
        let gone = 0;
        let keptDay = 0;
        for (const inv of todo) {
          const st = day.byId.get(inv.id)!;
          if (st.state === "intact") intact.push(inv.id);
          else if (st.state === "missing") gone++;
          else if (st.state === "kept_day_touched") keptDay++;
          else kept++;
        }
        let removedIds: string[] = [];
        if (intact.length > 0) {
          const del = await tx
            .delete(attendanceLogs)
            .where(
              and(
                inArray(attendanceLogs.id, intact),
                eq(attendanceLogs.note, tag),
                eq(attendanceLogs.reason, "import"),
                eq(attendanceLogs.source, "admin"),
              ),
            )
            .returning({ id: attendanceLogs.id });
          removedIds = del.map((d) => d.id);
          await tx.insert(employeeEvents).values({
            employeeId,
            actorId: me.id,
            eventType: IMPORT_UNDO_EVENT,
            toValue: { batchId, removedIds, keptModified: kept, missing: gone, keptDayTouched: keptDay, daysSkipped: day.touchedDays.length },
            note: `Attendance import ${batchId} undone: ${removedIds.length} unchanged punch${removedIds.length === 1 ? "" : "es"} removed, ${kept} edited punch${kept === 1 ? "" : "es"} kept, ${keptDay} unchanged punch${keptDay === 1 ? "" : "es"} kept because their day was edited`,
          });
        }
        out.removed += removedIds.length;
        out.keptModified += kept;
        out.missing += gone;
        out.keptDayTouched += keptDay;
        out.daysSkipped += day.touchedDays.length;
      });
    } catch (err) {
      console.error("[attendance-import] undo failed for one employee", employeeId, err);
      out.failedPeople++;
    }
  }

  revalidatePath("/attendance");
  revalidatePath("/attendance/dashboard");
  revalidatePath("/hr/attendance-import");
  return { ok: true, undo: out };
}
