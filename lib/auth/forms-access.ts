import "server-only";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule, requireModuleAccess } from "@/lib/auth/module-access";

/**
 * Proof that the current request may read the Forms module's sections — the
 * "forms" module in Admin → Access, resolved by the same `getMyModuleAccess`
 * the layout and the hub use (admins pass through the admin bypass unless
 * explicitly denied; everyone else needs a grant). Only this module can make
 * one, and the Forms ledger queries require it, so no code path can read a
 * Tally ledger without the module check having run on this request.
 *
 * Module access is the whole of what viewing needs. Importing is a separate,
 * sensitive permission (`tally.import`) and never follows from this.
 */
declare const formsBrand: unique symbol;
export type FormsViewer = { readonly employeeId: string; readonly [formsBrand]: true };

/** For pages: the proof, or a redirect to the hub with the "no access" flag. */
export async function requireFormsViewer(): Promise<FormsViewer> {
  const me = await requireModuleAccess("forms");
  return { employeeId: me.id } as FormsViewer;
}

/** For anything that must answer rather than redirect: the proof, or null. */
export async function getFormsViewer(): Promise<FormsViewer | null> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return null;
  return (await canAccessModule("forms")) ? ({ employeeId: me.id } as FormsViewer) : null;
}
