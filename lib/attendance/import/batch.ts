/**
 * Import batches — how the punches an import wrote are identified later.
 *
 * No schema change: a batch is recognised by (1) the exact punch ids and
 * original times kept in the import's audit row (`employee_events`, event type
 * `attendance_import`) and (2) a note tag on each punch that carries the batch
 * id. A punch counts as UNCHANGED only while every one of these still holds:
 *   - the row with that id exists,
 *   - its note is the batch tag,
 *   - source "admin", reason "import", recorded by the importing admin,
 *   - same employee, day and kind,
 *   - logged_at equals the time the import stored.
 * Admin time edits change logged_at, a re-record overwrites the reason, and a
 * delete + re-add gets a new id, so any correction makes a punch "modified" and
 * it is never touched by an undo. Pure; the actions do the database work.
 */

export const IMPORT_EVENT = "attendance_import";
export const IMPORT_UNDO_EVENT = "attendance_import_undo";

export const batchNote = (batchId: string) => `Biometric import · ${batchId}`;

export interface InventoryPunch {
  id: string;
  date: string;
  kind: "in" | "out";
  /** logged_at as stored by the import, ISO. */
  at: string;
}

export interface ImportEventValue {
  batchId: string;
  file: string | null;
  inserted: number;
  from: string | null;
  to: string | null;
  punches: InventoryPunch[];
}

export interface UndoEventValue {
  batchId: string;
  removedIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseImportEvent(raw: unknown): ImportEventValue | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.batchId !== "string" || !UUID.test(v.batchId) || !Array.isArray(v.punches)) return null;
  const punches: InventoryPunch[] = [];
  for (const p of v.punches) {
    const x = p as Record<string, unknown>;
    if (
      typeof x?.id === "string" && UUID.test(x.id) &&
      typeof x.date === "string" &&
      (x.kind === "in" || x.kind === "out") &&
      typeof x.at === "string" && !Number.isNaN(Date.parse(x.at))
    ) {
      punches.push({ id: x.id, date: x.date, kind: x.kind, at: x.at });
    }
  }
  return {
    batchId: v.batchId,
    file: typeof v.file === "string" ? v.file : null,
    inserted: typeof v.inserted === "number" ? v.inserted : punches.length,
    from: typeof v.from === "string" ? v.from : null,
    to: typeof v.to === "string" ? v.to : null,
    punches,
  };
}

export function parseUndoEvent(raw: unknown): UndoEventValue | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.batchId !== "string" || !Array.isArray(v.removedIds)) return null;
  return { batchId: v.batchId, removedIds: v.removedIds.filter((x): x is string => typeof x === "string") };
}

/** The columns of a stored punch the check needs. */
export interface StoredPunch {
  id: string;
  employeeId: string;
  logDate: string;
  kind: string;
  loggedAt: Date;
  note: string | null;
  source: string;
  reason: string | null;
  recordedById: string | null;
}

export type PunchState =
  | { state: "intact" }
  | { state: "modified"; why: string[] }
  | { state: "missing" };

/**
 * Decide whether a punch the batch wrote is still exactly as written.
 * `actorId` is the admin who ran the import (from the audit row).
 */
export function classifyBatchPunch(
  inv: InventoryPunch,
  employeeId: string,
  stored: StoredPunch | undefined,
  ctx: { batchId: string; actorId: string },
): PunchState {
  if (!stored) return { state: "missing" };
  const why: string[] = [];
  if (stored.employeeId !== employeeId) why.push("different employee");
  if (stored.logDate !== inv.date) why.push("date changed");
  if (stored.kind !== inv.kind) why.push("kind changed");
  if (stored.note !== batchNote(ctx.batchId)) why.push("note changed");
  if (stored.source !== "admin") why.push("source changed");
  if (stored.reason !== "import") why.push("reason changed");
  if (stored.recordedById !== ctx.actorId) why.push("recorded by someone else");
  if (stored.loggedAt.getTime() !== Date.parse(inv.at)) why.push("time was edited");
  return why.length ? { state: "modified", why } : { state: "intact" };
}

/**
 * Day-level safety on top of the per-punch check.
 *
 * A punch can look perfectly unchanged while its DAY has been worked on: HR may
 * have corrected the other punch of the day, or added a punch the import never
 * wrote. Deleting the "unchanged" one would leave a half day. So for every
 * employee + date in a batch, the day counts as TOUCHED, and every punch of that
 * day is kept, when either:
 *   1. one of the batch's own punches that day is not exactly as imported
 *      (edited, re-recorded, moved, or deleted), or
 *   2. the day holds any stored punch that this batch did not write (HR-added, or
 *      anything else — the conservative reading).
 * The note is deliberately not used for this: an added punch carries HR's own
 * note, not the batch tag, and is not in the batch's inventory at all.
 *
 * `rows` must be EVERY stored punch for this employee on the batch's dates (plus
 * the batch's own ids), read under the same lock the delete uses.
 */
export type DayAwareState = PunchState | { state: "kept_day_touched"; why: string[] };

export interface DayAwareResult {
  byId: Map<string, DayAwareState>;
  touchedDays: { date: string; why: string[] }[];
}

export function classifyBatchDays(
  inventory: InventoryPunch[],
  employeeId: string,
  rows: StoredPunch[],
  ctx: { batchId: string; actorId: string },
): DayAwareResult {
  const storedById = new Map(rows.map((r) => [r.id, r]));
  const invIds = new Set(inventory.map((p) => p.id));
  const byId = new Map<string, DayAwareState>();
  const touchedDays: DayAwareResult["touchedDays"] = [];

  const dates = [...new Set(inventory.map((p) => p.date))].sort();
  for (const date of dates) {
    const today = inventory.filter((p) => p.date === date);
    const states = today.map((p) => [p, classifyBatchPunch(p, employeeId, storedById.get(p.id), ctx)] as const);
    const why: string[] = [];
    if (states.some(([, s]) => s.state === "modified")) why.push("a punch from this import was edited or re-recorded");
    if (states.some(([, s]) => s.state === "missing")) why.push("a punch from this import was deleted");
    const extra = rows.filter((r) => r.employeeId === employeeId && r.logDate === date && !invIds.has(r.id));
    if (extra.length > 0) {
      why.push(`another punch exists on this day that this import did not write (${extra.map((r) => r.kind.toUpperCase()).join(", ")})`);
    }
    for (const [p, s] of states) {
      byId.set(p.id, why.length > 0 && s.state === "intact" ? { state: "kept_day_touched", why } : s);
    }
    if (why.length > 0) touchedDays.push({ date, why });
  }
  return { byId, touchedDays };
}
