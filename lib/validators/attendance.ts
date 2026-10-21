import { z } from "zod";
import { PUNCH_REASONS } from "@/db/enums";

// Pure (DB-free) zod schemas for the admin punch-management actions
// (Attendance Phase A, Task A4). Kept out of the "use server" action file so
// they can be unit-tested without pulling in the DB / server-only chain.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const dateField = z.string().regex(DATE_RE, "Date must be YYYY-MM-DD");
const timeField = z.string().regex(TIME_RE, "Time must be HH:mm");
const kindField = z.enum(["in", "out"]);

// Every admin change to a recorded punch goes through the shared correction
// mechanism (lib/attendance/correction/apply.ts): a reason from the existing
// punch-reason list, an explanation (length rules in correction/plan.ts, checked
// on the server), and — for anything that touches a stored punch — the snapshot
// of what the admin saw, so a punch changed meanwhile is never overwritten.

/** Explanation text; its minimum and maximum are enforced by correction/plan.ts. */
const explanationField = z.string().max(700, "Keep the explanation under 500 characters.");
const isoField = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid snapshot.");
/** loggedAt ISO of the stored IN / OUT the admin saw, or null for "no punch". */
const snapshotField = z.object({ in: isoField.nullable(), out: isoField.nullable() }).strict();

/** Admin adds (or, when the snapshot shows it, replaces) a single in/out punch. */
export const AdminUpsertPunch = z
  .object({
    employeeId: z.string().uuid(),
    logDate: dateField,
    kind: kindField,
    timeHHmm: timeField,
    reason: z.enum(PUNCH_REASONS),
    explanation: explanationField,
    snapshot: snapshotField,
  })
  .strict();
export type AdminUpsertPunchInput = z.infer<typeof AdminUpsertPunch>;

/** Super-admin quick punch (today only, adds a missing punch; reason fixed by the action). */
export const AdminQuickPunch = z
  .object({
    employeeId: z.string().uuid(),
    logDate: dateField,
    kind: kindField,
    timeHHmm: timeField,
    explanation: explanationField,
  })
  .strict();
export type AdminQuickPunchInput = z.infer<typeof AdminQuickPunch>;

/** Admin sets the in/out times for an employee+day: each supplied side is added
 *  if missing or changed if stored. At least one of inHHmm / outHHmm. */
export const AdminEditDayTimes = z
  .object({
    employeeId: z.string().uuid(),
    logDate: dateField,
    inHHmm: timeField.optional(),
    outHHmm: timeField.optional(),
    reason: z.enum(PUNCH_REASONS),
    explanation: explanationField,
    snapshot: snapshotField,
  })
  .strict()
  .refine((v) => v.inHHmm != null || v.outHHmm != null, {
    message: "Provide a check-in or check-out time to edit.",
  });
export type AdminEditDayTimesInput = z.infer<typeof AdminEditDayTimes>;

/** Admin removes a single in/out punch — reasoned, explained and audited. */
export const AdminDeletePunch = z
  .object({
    employeeId: z.string().uuid(),
    logDate: dateField,
    kind: kindField,
    reason: z.enum(PUNCH_REASONS),
    explanation: explanationField,
    snapshot: snapshotField,
  })
  .strict();
export type AdminDeletePunchInput = z.infer<typeof AdminDeletePunch>;

/** Admin opens one day in the editor (read-only). */
export const AdminLookupDay = z
  .object({
    employeeId: z.string().uuid(),
    logDate: dateField,
  })
  .strict();

/**
 * Admin sets an employee's attendance schedule (Task A5). `weeklyOff` is an
 * int 0..6 (0=Sun). The four time overrides are optional HH:mm strings; pass
 * an empty string or null to CLEAR an override back to the company default.
 */
const scheduleOverrideField = z
  .union([timeField, z.literal(""), z.null()])
  .optional();

export const UpdateEmployeeSchedule = z
  .object({
    employeeId: z.string().uuid(),
    weeklyOff: z.number().int().min(0, "Weekly off must be 0..6").max(6, "Weekly off must be 0..6"),
    attOfficialStart: scheduleOverrideField,
    attLateAfter: scheduleOverrideField,
    attOfficialEnd: scheduleOverrideField,
    attEarlyBefore: scheduleOverrideField,
  })
  .strict();
export type UpdateEmployeeScheduleInput = z.infer<typeof UpdateEmployeeSchedule>;
