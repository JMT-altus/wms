import "server-only";
import type { Employee } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getMyFieldAccess } from "@/lib/auth/field-access";

/**
 * Who may manage Admin Panel → Attendance Settings (work shifts, check-in and
 * check-out grace): an ADMIN (the Admin Panel's own gate) who is either a
 * super-admin (the existing list in lib/auth/super-admin.ts) or holds the
 * `attendance.settings.manage` permission. That permission is sensitive: only a
 * super-admin can grant it, in Admin & Master Setup → Field Permissions, and it
 * is never implied by admin status. Identity always comes from the signed session.
 */
export const ATTENDANCE_SETTINGS_PERMISSION = "attendance.settings.manage" as const;

export async function canManageAttendanceSettings(me: Employee): Promise<boolean> {
  if (!me.isAdmin || !me.isActive) return false;
  if (isSuperAdmin(me.email)) return true;
  const access = await getMyFieldAccess();
  return access[ATTENDANCE_SETTINGS_PERMISSION]?.allowed === true;
}

/** For server actions: the signed-in manager, or "Forbidden" before anything is read or written. */
export async function requireAttendanceSettingsManager(): Promise<Employee> {
  const me = await requireAdmin();
  if (!(await canManageAttendanceSettings(me))) throw new Error("Forbidden");
  return me;
}
