"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { db } from "@/lib/db";
import {
  attendanceLogs,
  employees,
  type Employee,
  type NotificationKind,
} from "@/db/schema";
import { requireUser, requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { resolvePunchGeofence, insertPunchRow } from "@/lib/attendance/record-punch";
import {
  notifyOnInPunch,
  notifyOnDayFinalized,
  notifyAdminLateDeduction,
  clockInTz,
  alertAdminsNewAttendanceDevice,
} from "@/lib/attendance/punch-notify";
import {
  AdminUpsertPunch,
  AdminQuickPunch,
  AdminEditDayTimes,
  AdminDeletePunch,
  AdminLookupDay,
} from "@/lib/validators/attendance";
import {
  applyDelete,
  applySet,
  assertNotSelf,
  correctionFailureMessage,
  loadCorrectionDay,
  salaryRunNotice,
  type SalaryRunNotice,
} from "@/lib/attendance/correction/apply";
import { ADMIN_REASON_CODES } from "@/lib/attendance/correction/plan";
import {
  ADMIN_PUNCH_DELETE_EVENT,
  ADMIN_PUNCH_EDIT_EVENT,
  ADMIN_PUNCH_UPSERT_EVENT,
} from "@/lib/attendance/correction/events";
import {
  listCredentials,
  mintRegistrationOptions,
  verifyAndStoreRegistration,
  mintPunchOptions,
  verifyPunchAssertion,
} from "@/lib/webauthn/attendance";

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const PunchSchema = z
  .object({
    kind: z.enum(["in", "out"]),
    note: z.string().trim().max(500).optional(),
    deviceLabel: z.string().max(120).optional(),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000),
      })
      .optional(),
  })
  .strict();

/**
 * Record today's check-in or check-out. "Today" is the calendar day in the
 * employee's own timezone. One punch per kind per day — a duplicate returns
 * a friendly error instead of silently rewriting the log.
 *
 * Biometric + geofence (0054): when the admin has set an office location,
 * the punch must carry a GPS fix within `attendance_radius_m` of it; when
 * the employee has a registered passkey, the punch must carry a fresh
 * user-verified WebAuthn assertion (the device's fingerprint / Face ID).
 */
export async function punchAttendance(input: {
  kind: "in" | "out";
  note?: string;
  location?: { lat: number; lng: number; accuracyM: number };
  assertion?: AuthenticationResponseJSON;
  registration?: RegistrationResponseJSON;
  deviceLabel?: string;
}): Promise<ActionResult<{ date: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  // WebAuthn blobs ride alongside the validated fields, not through zod.
  const { assertion, registration, ...rest } = input;
  const parsed = PunchSchema.safeParse(rest);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { kind, note, location, deviceLabel } = parsed.data;

  // ── Gate 1: geofence ────────────────────────────────────────────────
  // Runs for BOTH "in" and "out". Shared with the native punch API via
  // resolvePunchGeofence so the security rule never diverges between clients.
  const settings = await getOrgSettings();
  const geo = resolvePunchGeofence(settings, location);
  if (!geo.ok) return { ok: false, error: geo.error };
  const distanceM = geo.distanceM;

  // ── Gate 2: biometric ───────────────────────────────────────────────
  // One unified path: an `assertion` proves a returning device; a verified
  // `registration` (user-verified WebAuthn ceremony) both enrolls a NEW device
  // and proves presence for THIS punch — so a new phone enrolls + punches in a
  // single fingerprint/Face-ID prompt. Biometric stays mandatory unless the
  // admin exempted this employee (no sensor → GPS-only).
  let verifyMethod: "biometric" | "gps_only" = "gps_only";
  let credentialId: string | null = null;
  if (assertion) {
    const verdict = await verifyPunchAssertion(me.id, assertion);
    if (!verdict.ok) return verdict;
    verifyMethod = "biometric";
    credentialId = verdict.credentialId;
  } else if (registration) {
    const reg = await verifyAndStoreRegistration(
      me.id,
      registration,
      deviceLabel?.slice(0, 120) ?? null,
    );
    if (!reg.ok) return reg;
    verifyMethod = "biometric";
    // New device enrolled mid-punch → fire the same admin alert as standalone
    // setup (best-effort; never blocks the punch).
    if (reg.isNewDevice) {
      await alertAdminsNewAttendanceDevice(me, deviceLabel ?? null, reg.deviceCount);
    }
  } else {
    const creds = await listCredentials(me.id);
    if (creds.length > 0) {
      return {
        ok: false,
        error: "Biometric confirmation required — punch from your own registered device.",
      };
    }
    if (!me.attendanceBiometricExempt) {
      return {
        ok: false,
        error:
          "Use your fingerprint or Face ID to punch from your own phone. (No biometric sensor on your device? Ask an admin to enable the exemption.)",
      };
    }
    // exempt + nothing supplied → GPS-only allowed (verifyMethod stays "gps_only").
  }

  const tz = me.timezone || "Asia/Kolkata";
  const today = localDateString(tz);

  // Insert via the shared core (today-only; one punch per kind per day).
  const inserted = await insertPunchRow(
    { id: me.id, timezone: tz },
    { kind, note, location, distanceM },
    { verifyMethod, credentialId, source: "self" },
  );
  if (!inserted.ok) return inserted;

  // ── Best-effort attendance notifications (Task A8) ───────────────────
  // The punch is committed above; a notify failure must never surface to the
  // user. On check-in we flag a late arrival; on check-out we recompute the
  // finalized day and fire waived/half-day as appropriate.
  if (kind === "in") {
    const inAt = clockInTz(new Date(), tz);
    await notifyOnInPunch(me, today, inAt);
  } else {
    await notifyOnDayFinalized(me, today);
  }

  revalidatePath("/attendance");
  return { ok: true, date: today };
}

/** Step 1 of registering this device's fingerprint/Face ID for punching. */
export async function startBiometricSetup(): Promise<
  ActionResult<{ options: PublicKeyCredentialCreationOptionsJSON }>
> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const options = await mintRegistrationOptions({
    id: me.id,
    name: me.name,
    email: me.email,
  });
  return { ok: true, options };
}

/** Step 2 — store the verified credential. */
export async function finishBiometricSetup(
  response: RegistrationResponseJSON,
  deviceLabel?: string,
): Promise<ActionResult> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const result = await verifyAndStoreRegistration(
    me.id,
    response,
    deviceLabel?.slice(0, 120) ?? null,
  );
  if (!result.ok) return result;
  revalidatePath("/attendance");
  // Tell admins a new attendance device was enrolled — the second line of
  // defence against proxy punching (someone enrolling on a colleague's phone).
  if (result.isNewDevice) {
    await alertAdminsNewAttendanceDevice(me, deviceLabel ?? null, result.deviceCount);
  }
  return { ok: true };
}


/** Fresh challenge for a biometric punch. Null options = nothing registered. */
export async function startBiometricPunch(): Promise<
  ActionResult<{ options: PublicKeyCredentialRequestOptionsJSON | null }>
> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const options = await mintPunchOptions(me.id);
  return { ok: true, options };
}

// ════════════════════════════════════════════════════════════════════════════
// Admin punch management (Attendance Phase A, Task A4)
//
// Admins can backfill, correct, or remove an employee's in/out punches — the
// escape hatch the self-only `punchAttendance` deliberately lacks. Every change
// goes through the shared correction mechanism (lib/attendance/correction/
// apply.ts), the same one HR → Attendance Correction uses:
//   - a reason (the existing punch-reason list) and an explanation;
//   - nobody changes their own attendance;
//   - the day's punches are locked and compared with what the admin saw, so a
//     punch changed meanwhile is never silently overwritten;
//   - the change and its `employee_events` audit row (with the full previous
//     punch) commit or roll back together;
//   - failures show a generic message; details are logged on the server.
// The day-finalised / late-deduction emails these actions have always sent are
// unchanged: they fire once, only after the change has committed.
// ════════════════════════════════════════════════════════════════════════════

const ADMIN_SAVE_FAILED = "The attendance change could not be saved, so nothing was changed. Please try again.";

/** Load the notify-relevant slice of the target employee (for Task A8 admin
 *  triggers). Returns null if the employee is gone. */
async function targetForNotify(employeeId: string): Promise<{
  id: string;
  timezone: string;
  attLateAfter: string | null;
  attEarlyBefore: string | null;
} | null> {
  const [row] = await db
    .select({
      id: employees.id,
      timezone: employees.timezone,
      attLateAfter: employees.attLateAfter,
      attEarlyBefore: employees.attEarlyBefore,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!row) return null;
  return { ...row, timezone: row.timezone || "Asia/Kolkata" };
}

/**
 * The emails an admin add/edit has always triggered: the check-out half-day /
 * late-waived email when the day is now complete, and the every-3rd-late
 * deduction alert. Called exactly once per successful action, after commit.
 * Best-effort, as before (the notify helpers swallow their own failures).
 */
async function notifyAfterAdminChange(employeeId: string, logDate: string): Promise<void> {
  const target = await targetForNotify(employeeId);
  if (target) {
    await notifyOnDayFinalized(target, logDate);
    await notifyAdminLateDeduction(target, logDate);
  }
}

function revalidateAttendanceAdmin(): void {
  revalidatePath("/attendance/dashboard");
  revalidatePath("/attendance/manage");
}

export interface AdminDayView {
  employeeName: string;
  date: string;
  /** What is stored now; `loggedAt` is the snapshot to send back with a change. */
  punches: {
    in: { time: string; loggedAt: string } | null;
    out: { time: string; loggedAt: string } | null;
  };
  /** A salary run already exists for this month (admins may see its status). */
  salaryRun: SalaryRunNotice | null;
}

/** Read-only: the stored punches for one day, for the admin day editor. */
export async function adminLookupDay(input: unknown): Promise<ActionResult<{ day: AdminDayView }>> {
  const me = await requireAdmin();
  const parsed = AdminLookupDay.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { employeeId, logDate } = parsed.data;
  try {
    assertNotSelf(me.id, employeeId);
    const day = await loadCorrectionDay(db, employeeId, logDate, false);
    const side = (p: typeof day.rows.in) => (p ? { time: p.time, loggedAt: p.loggedAt } : null);
    return {
      ok: true,
      day: {
        employeeName: day.emp.name,
        date: logDate,
        punches: { in: side(day.rows.in), out: side(day.rows.out) },
        salaryRun: await salaryRunNotice(employeeId, logDate, true),
      },
    };
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "admin lookup", "Could not load that day. Please try again.") };
  }
}

/**
 * Add a single in/out punch for an employee+day — or replace it, but only when
 * the snapshot shows the admin saw the punch being replaced. Never a silent
 * overwrite.
 */
export async function adminUpsertPunch(
  input: unknown,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = AdminUpsertPunch.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  try {
    await applySet({
      actorId: me.id,
      employeeId: d.employeeId,
      date: d.logDate,
      ...(d.kind === "in" ? { inTime: d.timeHHmm } : { outTime: d.timeHHmm }),
      reason: d.reason,
      explanation: d.explanation,
      allowedReasons: ADMIN_REASON_CODES,
      snapshot: d.snapshot,
      eventType: ADMIN_PUNCH_UPSERT_EVENT,
      via: "admin_day_editor",
      noteLabel: "Admin attendance punch",
    });
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "admin upsert", ADMIN_SAVE_FAILED) };
  }
  await notifyAfterAdminChange(d.employeeId, d.logDate);
  revalidateAttendanceAdmin();
  return { ok: true };
}

/**
 * Inline team-list quick punch — super-admins only (lib/auth/super-admin.ts),
 * TODAY only. Records a MISSING in/out for the current day at a
 * super-admin-typed time; it never replaces a recorded punch (that is done in
 * the day editor). The reason is fixed to "correction" so the UI stays
 * decoupled from the reason enum; an explanation is still required. Guarded on
 * super-admin and today so a crafted call for another day is refused.
 *
 * "Today" is the EMPLOYEE's today, in the employee's timezone — the same
 * timezone the punch time is interpreted in (lib/attendance/correction/apply.ts)
 * — never the acting super-admin's, which may differ.
 */
export async function superAdminQuickPunch(
  input: unknown,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!isSuperAdmin(me.email)) {
    return { ok: false, error: "Only super-admins can mark attendance here." };
  }
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = AdminQuickPunch.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  let target;
  try {
    target = await db.query.employees.findFirst({ where: eq(employees.id, d.employeeId), columns: { timezone: true } });
  } catch (err) {
    console.error("[attendance] quick punch: employee lookup failed", err);
    return { ok: false, error: ADMIN_SAVE_FAILED };
  }
  if (!target) return { ok: false, error: "Employee not found." };
  const tz = target.timezone || "Asia/Kolkata";
  if (d.logDate !== localDateString(tz)) {
    return { ok: false, error: "Quick punch is for today only." };
  }
  try {
    await applySet({
      actorId: me.id,
      employeeId: d.employeeId,
      date: d.logDate,
      ...(d.kind === "in" ? { inTime: d.timeHHmm } : { outTime: d.timeHHmm }),
      reason: "correction",
      explanation: d.explanation,
      allowedReasons: ADMIN_REASON_CODES,
      snapshot: "add-only",
      eventType: ADMIN_PUNCH_UPSERT_EVENT,
      via: "super_admin_quick_punch",
      noteLabel: "Super-admin quick punch",
    });
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "quick punch", ADMIN_SAVE_FAILED) };
  }
  await notifyAfterAdminChange(d.employeeId, d.logDate);
  revalidateAttendanceAdmin();
  return { ok: true };
}

/**
 * Set the in/out times for an employee+day in one atomic change: each supplied
 * side is added if missing or changed if stored (and still as the admin saw it).
 */
export async function adminEditDayTimes(
  input: unknown,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = AdminEditDayTimes.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  try {
    await applySet({
      actorId: me.id,
      employeeId: d.employeeId,
      date: d.logDate,
      inTime: d.inHHmm ?? null,
      outTime: d.outHHmm ?? null,
      reason: d.reason,
      explanation: d.explanation,
      allowedReasons: ADMIN_REASON_CODES,
      snapshot: d.snapshot,
      eventType: ADMIN_PUNCH_EDIT_EVENT,
      via: "admin_day_editor",
      noteLabel: "Admin attendance edit",
    });
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "admin edit", ADMIN_SAVE_FAILED) };
  }
  await notifyAfterAdminChange(d.employeeId, d.logDate);
  revalidateAttendanceAdmin();
  return { ok: true };
}

/**
 * Remove a single in/out punch for an employee+day — with a reason and an
 * explanation, the full previous punch kept in the audit row, in the same
 * transaction. No emails (as before: removing a punch never sent any).
 */
export async function adminDeletePunch(
  input: unknown,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = AdminDeletePunch.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  try {
    await applyDelete({
      actorId: me.id,
      employeeId: d.employeeId,
      date: d.logDate,
      kind: d.kind,
      reason: d.reason,
      explanation: d.explanation,
      allowedReasons: ADMIN_REASON_CODES,
      snapshot: d.snapshot,
      eventType: ADMIN_PUNCH_DELETE_EVENT,
      via: "admin_day_editor",
      noteLabel: "Admin punch removal",
    });
  } catch (err) {
    return { ok: false, error: correctionFailureMessage(err, "admin delete", "The punch could not be removed, so nothing was changed. Please try again.") };
  }
  revalidateAttendanceAdmin();
  return { ok: true };
}
