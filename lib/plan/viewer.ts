/**
 * The viewer, as the CLIENT is allowed to know them.
 *
 * CLIENT-SAFE. This exists so the status picker can render what
 * `canSetPlanStatus` allows without a round-trip per row — but it is a
 * COURTESY, not a control. The server rebuilds the actor from the database on
 * every write (`actorFor`) and would refuse a hand-rolled POST even if this
 * file did not exist.
 *
 * The downline arrives as a flat id list computed ONCE per request, so asking
 * about forty rows is forty set lookups rather than forty queries.
 */

import type { PlanActor } from "@/lib/plan/status";

export interface PlanViewer {
  id: string;
  name: string;
  isAdmin: boolean;
  /** Everyone below this person in the reporting hierarchy, transitively. */
  downlineIds: string[];
}

/** The row shape the actor derivation needs. */
export interface ActorRowInput {
  ownerId: string | null;
  /** Owners of every container above this row, outermost first. */
  ancestorOwnerIds: (string | null)[];
  /** The linked task's doer, when the row has a task. */
  doerId: string | null;
}

/**
 * The viewer's relationship to ONE row.
 *
 * "The project owner" means the owner of this row OR of any container above
 * it: a milestone owner rules on the results underneath it, and the project
 * owner rules on the whole plan. Identical to what `actorFor` resolves
 * server-side, from the same definition.
 */
export function actorForRow(viewer: PlanViewer, row: ActorRowInput): PlanActor {
  const owners = [row.ownerId, ...row.ancestorOwnerIds].filter(
    (id): id is string => Boolean(id),
  );
  const downline = new Set(viewer.downlineIds);
  const subjects = [row.doerId, ...owners].filter(
    (id): id is string => Boolean(id) && id !== viewer.id,
  );

  return {
    id: viewer.id,
    isAdmin: viewer.isAdmin,
    isOwner: owners.includes(viewer.id),
    isDoer: row.doerId != null && row.doerId === viewer.id,
    isSupervisor: subjects.some((id) => downline.has(id)),
  };
}
