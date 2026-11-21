import "server-only";
import type { Employee } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { getFieldAccessFor } from "@/lib/auth/field-access";

/**
 * Who may do what in Admin & Master Setup → Incentive Rules. An ADMIN who holds the right's sensitive permission, granted
 * only by a super-admin in Field Permissions and never implied by admin status — a super-admin too needs the explicit
 * grant (no one holds a right because of who they are; Field Permissions gives a sensitive entry no bypass). Identity always comes from the signed session;
 * every server action checks again before anything is read or written.
 *
 * Holding a right is not enough to approve: nobody approves a version they created, edited or submitted (checked by
 * the server against the history, and by the database for the author and the submitter).
 */
export const INCENTIVE_RULE_RIGHTS = ["view", "edit", "submit", "approve", "publish", "backdate", "history"] as const;
export type IncentiveRuleRight = (typeof INCENTIVE_RULE_RIGHTS)[number];
export const rightKey = (r: IncentiveRuleRight) => `incentive.rules.${r}` as const;
export type IncentiveRuleRights = Record<IncentiveRuleRight, boolean>;

const NONE: IncentiveRuleRights = { view: false, edit: false, submit: false, approve: false, publish: false, backdate: false, history: false };

export async function incentiveRuleRights(me: Employee): Promise<IncentiveRuleRights> {
  if (!me.isAdmin || !me.isActive) return NONE;
  const access = await getFieldAccessFor(me);
  const has = (r: IncentiveRuleRight) => access[rightKey(r)]?.allowed === true;
  const rights = Object.fromEntries(INCENTIVE_RULE_RIGHTS.map((r) => [r, has(r)])) as IncentiveRuleRights;
  // Every other right includes seeing what it acts on.
  rights.view = rights.view || rights.edit || rights.submit || rights.approve || rights.publish;
  return rights;
}

/** For server actions: the signed-in admin holding `right`, or "Forbidden" before anything is read or written. */
export async function requireIncentiveRuleRight(right: IncentiveRuleRight): Promise<{ me: Employee; rights: IncentiveRuleRights }> {
  const me = await requireAdmin();
  const rights = await incentiveRuleRights(me);
  if (!rights[right]) throw new Error("Forbidden");
  return { me, rights };
}
