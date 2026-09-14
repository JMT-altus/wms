import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectNodes, tasks, type Employee } from "@/db/schema";
import { getDccScope } from "@/lib/dcc/access";
import type { PlanActor } from "@/lib/plan/status";
import type { PlanViewer } from "@/lib/plan/viewer";

/**
 * The DB-backed half of the status permission.
 *
 * Split from `canSetPlanStatus` (which is pure and client-safe) on purpose:
 * the CLIENT sends an id and nothing else. It is never asked who it is, so it
 * cannot claim to be the owner. The server rebuilds the actor on every write
 * and never trusts what the browser rendered.
 */

/**
 * The viewer payload the plan screens ship to the client.
 *
 * ONE roster read for the whole page (`getDccScope` is `cache()`d per
 * request), so the picker can grey out what it cannot offer on forty rows
 * without forty queries. The client is told who IT is; it is never asked, and
 * every write is re-checked server-side against `actorFor` regardless.
 */
export async function getPlanViewer(me: Employee): Promise<PlanViewer> {
  const scope = await getDccScope(me);
  return {
    id: me.id,
    name: me.name,
    isAdmin: me.isAdmin,
    // `visibleIds` always contains the caller; the downline is everyone else.
    downlineIds: [...scope.visibleIds].filter((id) => id !== me.id),
  };
}

/** A row's owner, walked up to the project it sits under. */
interface OwnerChainRow {
  id: string;
  parentId: string | null;
  ownerId: string | null;
}

/**
 * Resolve the caller's relationship to ONE plan row.
 *
 * The supervisor test is ONE `getDccScope` lookup then set membership — that
 * call fetches the roster once per request and is `cache()`d, so asking about
 * forty rows costs one query, not forty. A walk up the management tree per row
 * is the N+1 that took the DCC review screen down.
 */
export async function actorFor(
  me: Employee,
  nodeId: string,
): Promise<PlanActor> {
  const base: PlanActor = {
    id: me.id,
    isAdmin: me.isAdmin,
    isOwner: false,
    isDoer: false,
    isSupervisor: false,
  };

  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, nodeId),
    columns: { id: true, parentId: true, ownerId: true },
  });
  if (!node) return base;

  // "The project owner" means the owner of THIS row or of any container above
  // it — a milestone owner rules on the results underneath it, and the
  // project owner rules on the whole plan. Walked with the ancestor chain
  // fetched in one go rather than a query per level.
  const ownerIds = await ownerChain(node);
  const isOwner = ownerIds.includes(me.id);

  // The doer is on the LINKED TASK, not the node — an executable row's status
  // of record lives there.
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.projectNodeId, nodeId),
    columns: { doerId: true },
  });
  const doerId = task?.doerId ?? null;
  const isDoer = doerId != null && doerId === me.id;

  // A supervisor of the doer OR of an owner may report progress. `visibleIds`
  // is the transitive downline plus the caller, so a hit that is not the
  // caller themselves is a downline hit.
  let isSupervisor = false;
  const subjects = [doerId, ...ownerIds].filter(
    (id): id is string => Boolean(id) && id !== me.id,
  );
  if (subjects.length > 0) {
    const scope = await getDccScope(me);
    isSupervisor = subjects.some((id) => scope.visibleIds.has(id));
  }

  return { ...base, isOwner, isDoer, isSupervisor };
}

/**
 * Every owner from this row up to its root, in one pass.
 *
 * Bounded by the six levels the tree can have, with a `seen` guard so a
 * corrupted parent cycle stops rather than looping forever.
 */
async function ownerChain(start: OwnerChainRow): Promise<string[]> {
  const owners: string[] = [];
  const seen = new Set<string>();
  let current: OwnerChainRow | undefined = start;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.ownerId) owners.push(current.ownerId);
    if (!current.parentId) break;
    current = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, current.parentId),
      columns: { id: true, parentId: true, ownerId: true },
    });
  }
  return owners;
}
