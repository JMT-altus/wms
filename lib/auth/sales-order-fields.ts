import "server-only";
import type { Employee } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getMyFieldAccess } from "@/lib/auth/field-access";

/**
 * Who may configure the Sales Order fields (Admin & Master Setup → Sales Order Fields): an ADMIN who is either a
 * super-admin (the existing list in lib/auth/super-admin.ts — nobody is named here) or holds the
 * `sales-orders.fields.manage` permission. That permission is sensitive: only a super-admin can grant it, in Admin &
 * Master Setup → Field Permissions, and it is never implied by admin status. Identity always comes from the signed
 * session; every server action checks it again.
 */
export const SALES_ORDER_FIELDS_PERMISSION = "sales-orders.fields.manage" as const;

export async function canManageSalesOrderFields(me: Employee): Promise<boolean> {
  if (!me.isAdmin || !me.isActive) return false;
  if (isSuperAdmin(me.email)) return true;
  const access = await getMyFieldAccess();
  return access[SALES_ORDER_FIELDS_PERMISSION]?.allowed === true;
}

/** For server actions: the signed-in manager, or "Forbidden" before anything is read or written. */
export async function requireSalesOrderFieldsManager(): Promise<Employee> {
  const me = await requireAdmin();
  if (!(await canManageSalesOrderFields(me))) throw new Error("Forbidden");
  return me;
}
