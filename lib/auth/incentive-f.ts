import "server-only";
import type { Employee } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { getFieldAccessFor } from "@/lib/auth/field-access";

/**
 * Who may act on Category F's reviews and testimonials (0137 + 0138: F.1 Google review, F.2 email, F.3 letterhead, F.4
 * appreciation by name): an active ADMIN who holds the right's sensitive Field Permission —
 * an EXPLICIT grant, to the person or organisation-wide (Field Permissions → resolveFieldAccess: a sensitive entry
 * takes neither the admin nor the super-admin bypass, and has no department layer). Super-admins are no exception:
 * they too need the grant. Each right is checked on its own; holding one never gives another.
 *   verify      verify / reject / hold / resolve / link / attribute a review (never one they submitted)
 *   invalidate  request an invalidation, or approve / refuse someone else's request
 *   writeOff    request a recovery write-off, or approve / refuse someone else's request
 * Separation of duties is enforced again by the services and by database triggers.
 */
export const INCENTIVE_F_RIGHTS = ["verify", "invalidate", "writeOff"] as const;
export type IncentiveFRight = (typeof INCENTIVE_F_RIGHTS)[number];
export type IncentiveFRights = Record<IncentiveFRight, boolean>;
export const fRightKey = (r: IncentiveFRight) => `incentive.f.${r}` as const;

const NONE = Object.fromEntries(INCENTIVE_F_RIGHTS.map((r) => [r, false])) as IncentiveFRights;

export async function incentiveFRights(me: Employee | null | undefined): Promise<IncentiveFRights> {
  if (!me || !me.isAdmin || !me.isActive) return NONE;
  const access = await getFieldAccessFor(me);
  return Object.fromEntries(INCENTIVE_F_RIGHTS.map((r) => [r, access[fRightKey(r)]?.allowed === true])) as IncentiveFRights;
}

/** What a person without the right is told (the permission's own name; nothing internal). */
export const F_RIGHT_DENIED: Record<IncentiveFRight, string> = {
  verify: "You don't have the “Incentive Calculation — Verify Category F reviews and testimonials (F.1–F.4)” permission (it may have been removed). Nothing was changed.",
  invalidate: "You don't have the “Incentive Calculation — Invalidate a Category F review or testimonial” permission (it may have been removed). Nothing was changed.",
  writeOff: "You don't have the “Incentive Calculation — Write off a Category F recovery” permission (it may have been removed). Nothing was changed.",
};
export const F_NOT_ADMIN = "Only an administrator can act on Category F reviews and testimonials (your access may have changed). Nothing was changed.";

/**
 * The server-side check every Category F action makes FIRST, read fresh on every call (so a right removed after the page
 * was opened is refused). Not signed in, or deactivated: redirected to sign-in (requireUser). Otherwise a structured
 * refusal the screen shows as a message — never a thrown error.
 */
export async function checkIncentiveFRight(right: IncentiveFRight): Promise<{ ok: true; me: Employee } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!me.isAdmin) return { ok: false, error: F_NOT_ADMIN };
  const rights = await incentiveFRights(me);
  if (!rights[right]) return { ok: false, error: F_RIGHT_DENIED[right] };
  return { ok: true, me };
}
