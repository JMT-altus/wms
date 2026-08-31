import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import { employees, type Employee } from "@/db/schema";
import { isSuperAdmin } from "@/lib/auth/super-admin";

/**
 * DCC visibility scope.
 *
 * Computed ONCE per request from a single roster fetch and then answered from
 * memory. The alternative — a query per row to ask "is this person mine?" —
 * turns a 12-person dashboard into 12 round-trips, which is exactly the N+1
 * that made the review screen exhaust the connection pool.
 */
export interface DccScope {
  me: { id: string; name: string; isAdmin: boolean; isSuperAdmin: boolean };
  /** Everyone this person may look at. Always contains their own id. */
  visibleIds: Set<string>;
  /** True when they can see anyone besides themselves. */
  isManager: boolean;
  /** Direct reports only (manager_id === me.id). Used by the review gate. */
  directReportIds: Set<string>;
}

/**
 * Build the scope for one employee.
 *
 * Super-admins see everyone. Everyone else sees themselves plus their
 * transitive downline, walked iteratively (a recursive walk on a roster with
 * an accidental manager cycle would blow the stack; the `seen` set here just
 * stops).
 */
export const getDccScope = cache(async (me: Employee): Promise<DccScope> => {
  const superAdmin = isSuperAdmin(me.email);

  const roster = await withDbRetry("dcc scope roster", () =>
    db
      .select({
        id: employees.id,
        managerId: employees.managerId,
        isActive: employees.isActive,
      })
      .from(employees),
  );

  const self = {
    id: me.id,
    name: me.name,
    isAdmin: me.isAdmin,
    isSuperAdmin: superAdmin,
  };

  const directReportIds = new Set(
    roster.filter((r) => r.managerId === me.id && r.isActive).map((r) => r.id),
  );

  if (superAdmin) {
    return {
      me: self,
      visibleIds: new Set(roster.filter((r) => r.isActive).map((r) => r.id)).add(me.id),
      isManager: true,
      directReportIds,
    };
  }

  // manager id → their reports, so the walk is a map lookup per level.
  const byManager = new Map<string, string[]>();
  for (const r of roster) {
    if (!r.managerId || !r.isActive) continue;
    const list = byManager.get(r.managerId) ?? [];
    list.push(r.id);
    byManager.set(r.managerId, list);
  }

  const visibleIds = new Set<string>([me.id]);
  const stack: string[] = [me.id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of byManager.get(current) ?? []) {
      if (visibleIds.has(child)) continue; // cycle guard
      visibleIds.add(child);
      stack.push(child);
    }
  }

  return {
    me: self,
    visibleIds,
    isManager: visibleIds.size > 1,
    directReportIds,
  };
});

/** Can they open this person's board at all? */
export function canView(scope: DccScope, ownerId: string): boolean {
  return scope.visibleIds.has(ownerId);
}

/**
 * Can they write fills on this person's board?
 *
 * Deliberately narrow: you fill your own checklist and nobody else's. A
 * manager who could fill for a report would make the compliance number
 * meaningless. Super-admins keep the override for corrections.
 */
export function canFill(scope: DccScope, ownerId: string): boolean {
  return scope.me.isSuperAdmin || ownerId === scope.me.id;
}

/** Can they author/edit/archive the KPI definitions on this person's board? */
export function canManageItems(scope: DccScope, ownerId: string): boolean {
  return scope.me.isSuperAdmin || scope.visibleIds.has(ownerId);
}

/**
 * Can they sign off this person's day?
 *
 * Never yourself — a self-approval is not a review. Super-admins are exempt
 * from the downline requirement but still cannot approve their own day.
 */
export function canReview(scope: DccScope, ownerId: string): boolean {
  if (ownerId === scope.me.id) return false;
  if (scope.me.isSuperAdmin) return true;
  return scope.visibleIds.has(ownerId);
}
