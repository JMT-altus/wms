import "server-only";
import type { Employee } from "@/db/schema";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getMyFieldAccess } from "@/lib/auth/field-access";
import { getModuleAccessFor } from "@/lib/auth/module-access";

/**
 * Who may waive and reverse attendance waivers (HR → Attendance Correction): an
 * active employee with HR module access (the page's own gate) who is either a
 * super-admin (lib/auth/super-admin.ts) or holds the sensitive
 * `attendance.waivers.manage` permission — granted only by a super-admin in
 * Admin & Master Setup → Field Permissions, never implied by admin status.
 * Identity always comes from the signed session.
 */
export const ATTENDANCE_WAIVER_PERMISSION = "attendance.waivers.manage" as const;

export async function canManageWaivers(me: Employee): Promise<boolean> {
  if (!me.isActive) return false;
  try {
    const modules = await getModuleAccessFor(me);
    if (!modules.hr?.allowed) return false;
    if (isSuperAdmin(me.email)) return true;
    const access = await getMyFieldAccess();
    return access[ATTENDANCE_WAIVER_PERMISSION]?.allowed === true;
  } catch (err) {
    // Fail closed: a permission read that fails grants nothing (the page shows no waive actions).
    console.error("[attendance-waivers] permission check failed; denying", err);
    return false;
  }
}
