import "server-only";
import type { Employee } from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getMyFieldAccess } from "@/lib/auth/field-access";

/**
 * Who may pre-close a delivery of a Sales Order (the matrix's "Update" fields): an active employee who can see the
 * order (the Forms module) and is either a super-admin (the existing list in lib/auth/super-admin.ts — nobody is
 * named here) or holds the sensitive `sales-orders.preclose` permission, which only a super-admin can grant and which
 * admin status never implies. Identity always comes from the signed session; the server action checks it again.
 */
export const SALES_ORDER_PRECLOSE_PERMISSION = "sales-orders.preclose" as const;

export async function canPreCloseSalesOrders(me: Employee | null): Promise<boolean> {
  if (!me?.isActive) return false;
  if (!(await canAccessModule("forms"))) return false;
  if (isSuperAdmin(me.email)) return true;
  const access = await getMyFieldAccess();
  return access[SALES_ORDER_PRECLOSE_PERMISSION]?.allowed === true;
}

/** For server actions: the signed-in employee allowed to pre-close, or "Forbidden" before anything is read or written. */
export async function requireSalesOrderPreCloser(): Promise<Employee> {
  const me = await getCurrentEmployee();
  if (!me || !(await canPreCloseSalesOrders(me))) throw new Error("Forbidden");
  return me;
}
