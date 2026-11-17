import "server-only";
import type { Employee } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getFieldAccessFor } from "@/lib/auth/field-access";

/**
 * Who may see and act on Category A calculations: an ADMIN who is a super-admin, or holds the right's sensitive Field
 * Permission (granted only by a super-admin, never implied by admin status) — the same model as Incentive Rules.
 *   view     see calculations, inputs, approvals and payouts
 *   run      calculate a month
 *   lock     lock / reopen a calculated month
 *   inputs   record or retire order salespeople, representative periods and receipt events
 *   approvals see submissions, approval steps and rejections (implied by submit and approve)
 *   payouts  see release dates, payout references and lines (implied by pay)
 *   submit   submit a locked month for approval (and withdraw it)
 *   approve  approve or reject a submitted month (never one you submitted; the database refuses it too)
 *   pay      record an approved month's payout
 */
export const INCENTIVE_CALC_RIGHTS = ["view", "run", "lock", "inputs", "approvals", "payouts", "submit", "approve", "pay"] as const;
export type IncentiveCalcRight = (typeof INCENTIVE_CALC_RIGHTS)[number];
export type IncentiveCalcRights = Record<IncentiveCalcRight, boolean>;
export const calcRightKey = (r: IncentiveCalcRight) => `incentive.calc.${r}` as const;

const NONE = Object.fromEntries(INCENTIVE_CALC_RIGHTS.map((r) => [r, false])) as IncentiveCalcRights;
const ALL = Object.fromEntries(INCENTIVE_CALC_RIGHTS.map((r) => [r, true])) as IncentiveCalcRights;

export async function incentiveCalcRights(me: Employee | null | undefined): Promise<IncentiveCalcRights> {
  if (!me || !me.isAdmin || !me.isActive) return NONE;
  if (isSuperAdmin(me.email)) return ALL;
  const access = await getFieldAccessFor(me);
  const rights = Object.fromEntries(INCENTIVE_CALC_RIGHTS.map((r) => [r, access[calcRightKey(r)]?.allowed === true])) as IncentiveCalcRights;
  // Every other right includes seeing what it acts on.
  rights.approvals = rights.approvals || rights.submit || rights.approve;
  rights.payouts = rights.payouts || rights.pay;
  rights.view = INCENTIVE_CALC_RIGHTS.some((r) => rights[r]);
  return rights;
}

export async function requireIncentiveCalcRight(right: IncentiveCalcRight): Promise<{ me: Employee; rights: IncentiveCalcRights }> {
  const me = await requireAdmin();
  const rights = await incentiveCalcRights(me);
  if (!rights[right]) throw new Error("Forbidden");
  return { me, rights };
}
