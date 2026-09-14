import "server-only";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { allWithDbRetry, withDbRetry } from "@/lib/db/retry";
import {
  employees,
  projectNodeAttachments,
  projectNodes,
  taskTimeRollup,
  tasks,
} from "@/db/schema";
import type { TaskStatus, TaskPriority } from "@/db/enums";
import { isPlanKind, refFor, toYmd, type PlanKind } from "@/lib/plan/levels";
import type {
  PlanRestrictedStatus,
  PlanWorkingStatus,
} from "@/lib/plan/status";

/**
 * The Project Plan read layer.
 *
 * ONE query pair feeds every plan screen — the hierarchy table, the five
 * registers, the kanban and the tree view are all projections of the same
 * `listPlanTree()` result. No screen owns a copy of anything, which is what
 * stops a row reporting one status here and another on the board.
 */

/** The linked task, as the plan needs to see it. */
export interface PlanTask {
  id: string;
  shortId: string | null;
  taskNo: number | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  doerId: string | null;
  doerName: string | null;
  initiatorId: string | null;
  dueAt: string;
  startsAt: string | null;
  endsAt: string | null;
  estimatedMinutes: number | null;
  /** Actual time booked against the task, seconds. 0 when never timed. */
  loggedSeconds: number;
  /** Optimistic-lock token for `setTaskStatus`. */
  updatedAt: string;
}

/**
 * One plan row, serialised for the client.
 *
 * `targetDate` travels as a plain local `YYYY-MM-DD` — it is a DAY, and
 * sending it as an instant is what makes it render as the day before west of
 * the storage zone. The real instants (`startsAt`, `endsAt`) travel as ISO.
 *
 * The whole subtree rides down with each row so the client recomputes progress
 * from the same pure functions the server would use.
 */
export interface PlanNode {
  id: string;
  name: string;
  kind: PlanKind;
  parentId: string | null;
  sortOrder: number;

  description: string | null;
  /** Initiator Notes — container rows only. */
  notes: string | null;
  targetDate: string | null;
  /** Who will do it — shown as "Doer". See the schema note on ownerId. */
  ownerId: string | null;
  ownerName: string | null;
  /** Who raised it. The id was always stored; the name is what a panel shows. */
  initiatorName: string | null;
  createdById: string | null;

  category: string | null;
  purpose: string | null;
  durationMinutes: number | null;
  startsAt: string | null;
  endsAt: string | null;

  /** Working status — meaningful on CONTAINER rows only. */
  status: PlanWorkingStatus | null;
  approvalStatus: PlanRestrictedStatus | null;
  progressPercent: number | null;

  clientName: string | null;
  subject: string | null;
  priority: string | null;
  initiatorId: string | null;
  tags: string[] | null;
  links: string[] | null;

  /** The ONE task this row points at, or null when it is not scheduled yet. */
  task: PlanTask | null;
  attachmentCount: number;

  children: PlanNode[];
}

/* ── Guarded reads of the late-added column groups ───────────────────────── */

/**
 * Selecting an undefined column does not return null in Postgres — it raises
 * 42703 and the ENTIRE screen 500s. So each column group added by a later
 * migration is fetched in its own round-trip inside a try/catch, and a
 * database missing 0103 loses those FIELDS rather than the screen.
 */
const UNDEFINED_COLUMN = "42703";
const UNDEFINED_TABLE = "42P01";

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/**
 * Everything migration 0103 added to `project_nodes`, in ONE round-trip.
 *
 * These were two reads — the status group and the plan/intake group — which,
 * with the base query, meant scanning the same table three times to render one
 * page. They share a table, a WHERE clause and a migration, so a single guard
 * covers both: if 0103 has not been applied the whole group is missing, not
 * half of it.
 *
 * Still its OWN round-trip, separate from the base query, because that is what
 * the 42703 guard needs. Selecting an undefined column does not return null in
 * Postgres — it raises 42703 and takes the entire screen down. Fetched apart,
 * a database one migration behind loses these FIELDS rather than the page.
 */
interface PlanExtraRow {
  status: PlanWorkingStatus | null;
  approvalStatus: PlanRestrictedStatus | null;
  progressPercent: number | null;
  priority: string | null;
  links: string[] | null;
  category: string | null;
  purpose: string | null;
  durationMinutes: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  clientName: string | null;
  subject: string | null;
  initiatorId: string | null;
  tags: string[] | null;
}

async function loadPlanExtras(): Promise<Map<string, PlanExtraRow>> {
  const out = new Map<string, PlanExtraRow>();
  try {
    const rows = await db
      .select({
        id: projectNodes.id,
        status: projectNodes.status,
        approvalStatus: projectNodes.approvalStatus,
        progressPercent: projectNodes.progressPercent,
        priority: projectNodes.priority,
        links: projectNodes.links,
        category: projectNodes.category,
        purpose: projectNodes.purpose,
        durationMinutes: projectNodes.durationMinutes,
        startsAt: projectNodes.startsAt,
        endsAt: projectNodes.endsAt,
        clientName: projectNodes.clientName,
        subject: projectNodes.subject,
        initiatorId: projectNodes.initiatorId,
        tags: projectNodes.tags,
      })
      .from(projectNodes)
      .where(eq(projectNodes.isArchived, false));
    for (const { id, ...rest } of rows) out.set(id, rest);
  } catch (err) {
    if (pgCode(err) !== UNDEFINED_COLUMN) throw err;
    console.warn(
      "[plan] the 0103 columns are missing — apply the migration. Rendering without them.",
    );
  }
  return out;
}

/**
 * ONE grouped COUNT for the whole plan.
 *
 * Counts only, never the files: a signed URL costs a round-trip each, so a
 * page of sixty milestones spends one query on that column rather than sixty.
 * Catches 42P01 too — the whole TABLE is new in 0103.
 */
export async function attachmentCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await db
      .select({
        nodeId: projectNodeAttachments.nodeId,
        n: sql<number>`count(*)::int`,
      })
      .from(projectNodeAttachments)
      .groupBy(projectNodeAttachments.nodeId);
    for (const r of rows) out.set(r.nodeId, r.n);
  } catch (err) {
    const code = pgCode(err);
    if (code !== UNDEFINED_COLUMN && code !== UNDEFINED_TABLE) throw err;
    console.warn(
      "[plan] project_node_attachments missing — apply migration 0103. Attachment counts read 0.",
    );
  }
  return out;
}

/* ── The tree ────────────────────────────────────────────────────────────── */

/**
 * The whole active plan as a forest of roots.
 *
 * Two batched queries plus the guarded metadata reads. NO per-row lookups —
 * this is the query every plan screen runs, and an N+1 here is an N+1 on all
 * four of them.
 */
export async function listPlanTree(): Promise<PlanNode[]> {
  const owner = alias(employees, "plan_owner");
  const doer = alias(employees, "plan_doer");
  /** The node's own initiator, so the panel can name them. */
  const initiator = alias(employees, "plan_initiator");

  // Retried, and each read on its own rather than the batch as a whole.
  //
  // This is the query every plan screen renders from, and the pooler resets
  // sockets from time to time — observed here as `ECONNRESET` mid-render,
  // which does not degrade the page, it takes the whole page down with
  // "Failed query". A second attempt on a fresh connection succeeds, because
  // the fault is the connection and not the query. Non-transient faults (a
  // missing column, say) still surface on the first attempt, which is what
  // keeps the 42703 guards below working.
  const [nodeRows, taskRows, extras, counts] = await allWithDbRetry([
    // Ordering is applied ONCE in SQL and preserved as rows are threaded into
    // the tree below, so the derived refs are stable across reloads.
    ["plan tree nodes", () => db
      .select({
        id: projectNodes.id,
        name: projectNodes.name,
        kind: projectNodes.kind,
        parentId: projectNodes.parentId,
        sortOrder: projectNodes.sortOrder,
        description: projectNodes.description,
        notes: projectNodes.notes,
        targetDate: projectNodes.targetDate,
        ownerId: projectNodes.ownerId,
        ownerName: owner.name,
        initiatorName: initiator.name,
        createdById: projectNodes.createdById,
      })
      .from(projectNodes)
      .leftJoin(owner, eq(owner.id, projectNodes.ownerId))
      .leftJoin(initiator, eq(initiator.id, projectNodes.initiatorId))
      .where(eq(projectNodes.isArchived, false))
      .orderBy(asc(projectNodes.sortOrder), asc(projectNodes.name))],

    // Every non-archived task carrying a project_node_id, OLDEST FIRST — if a
    // node somehow carries more than one task, the first is deterministically
    // *the* row's task and the rest are left alone rather than fighting over
    // it on every render.
    ["plan linked tasks", () => db
      .select({
        id: tasks.id,
        nodeId: tasks.projectNodeId,
        shortId: tasks.shortId,
        taskNo: tasks.taskNo,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        doerId: tasks.doerId,
        doerName: doer.name,
        initiatorId: tasks.initiatorId,
        dueAt: tasks.dueAt,
        startsAt: tasks.startsAt,
        endsAt: tasks.endsAt,
        estimatedMinutes: tasks.estimatedMinutes,
        loggedSeconds: taskTimeRollup.totalSeconds,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .leftJoin(doer, eq(doer.id, tasks.doerId))
      .leftJoin(taskTimeRollup, eq(taskTimeRollup.taskId, tasks.id))
      .where(sql`${tasks.projectNodeId} is not null and ${tasks.archived} = false`)
      .orderBy(asc(tasks.createdAt))],

    ["plan extras", loadPlanExtras],
    ["plan attachment counts", attachmentCounts],
  ] as const);

  const taskByNode = new Map<string, PlanTask>();
  for (const t of taskRows) {
    if (!t.nodeId || taskByNode.has(t.nodeId)) continue; // oldest wins
    taskByNode.set(t.nodeId, {
      id: t.id,
      shortId: t.shortId,
      taskNo: t.taskNo,
      title: t.title,
      status: t.status,
      priority: t.priority,
      doerId: t.doerId,
      doerName: t.doerName ?? null,
      initiatorId: t.initiatorId,
      dueAt: t.dueAt.toISOString(),
      startsAt: t.startsAt?.toISOString() ?? null,
      endsAt: t.endsAt?.toISOString() ?? null,
      estimatedMinutes: t.estimatedMinutes,
      loggedSeconds: t.loggedSeconds ?? 0,
      updatedAt: t.updatedAt.toISOString(),
    });
  }

  const byId = new Map<string, PlanNode>();
  for (const r of nodeRows) {
    // A row whose `kind` is not one of the six is unrenderable — the level
    // model drives every column. Drop it rather than crash the screen on it.
    if (!isPlanKind(r.kind)) continue;
    const x = extras.get(r.id);
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      parentId: r.parentId,
      sortOrder: r.sortOrder,
      description: r.description,
      notes: r.notes,
      targetDate: r.targetDate ? toYmd(r.targetDate) : null,
      ownerId: r.ownerId,
      ownerName: r.ownerName ?? null,
      initiatorName: r.initiatorName ?? null,
      createdById: r.createdById,
      category: x?.category ?? null,
      purpose: x?.purpose ?? null,
      durationMinutes: x?.durationMinutes ?? null,
      startsAt: x?.startsAt?.toISOString() ?? null,
      endsAt: x?.endsAt?.toISOString() ?? null,
      status: x?.status ?? null,
      approvalStatus: x?.approvalStatus ?? null,
      progressPercent: x?.progressPercent ?? null,
      clientName: x?.clientName ?? null,
      subject: x?.subject ?? null,
      priority: x?.priority ?? null,
      initiatorId: x?.initiatorId ?? null,
      tags: x?.tags ?? null,
      links: x?.links ?? null,
      task: taskByNode.get(r.id) ?? null,
      attachmentCount: counts.get(r.id) ?? 0,
      children: [],
    });
  }

  // Thread by parent_id, in the SQL order, so sibling position — and therefore
  // every derived ref — is the same on every reload.
  const roots: PlanNode[] = [];
  for (const r of nodeRows) {
    const node = byId.get(r.id);
    if (!node) continue;
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parentId);
    // A node whose parent is archived is DROPPED, not promoted to a root —
    // otherwise an Action appears at the top level next to the Projects.
    if (parent) parent.children.push(node);
  }

  return roots;
}

/* ── Blast radius ────────────────────────────────────────────────────────── */

/**
 * A node and every descendant, via ONE recursive CTE — the archive/duplicate
 * blast radius.
 *
 * Parameterised, never interpolated: this takes an id straight off a request.
 */
export async function descendantIds(rootId: string): Promise<string[]> {
  const rows = await withDbRetry("plan descendant ids", () =>
    db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM project_nodes WHERE id = ${rootId}
      UNION ALL
      SELECT n.id FROM project_nodes n
        JOIN subtree s ON n.parent_id = s.id
    )
    SELECT id FROM subtree
  `),
  );
  return [...rows].map((r) => r.id);
}

/**
 * What deleting this row would take with it, so the confirm dialog can say
 * exactly what is about to disappear rather than "are you sure?".
 *
 * ARCHIVED TASKS COUNT HERE. The delete is permanent and takes every task
 * hanging off the subtree, not just the live ones — a count that quietly
 * skipped the archived ones would under-report what the button does.
 */
export async function planDeleteImpact(
  rootId: string,
): Promise<{ nodes: number; tasks: number }> {
  const ids = await descendantIds(rootId);
  if (ids.length === 0) return { nodes: 0, tasks: 0 };
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(sql`${tasks.projectNodeId} = any(${sql.param(ids)}::uuid[])`);
  return { nodes: ids.length, tasks: row?.n ?? 0 };
}

/**
 * Ids of every ACTIVE node carrying a task, for the archive cascade.
 * Kept here beside `descendantIds` so both blast-radius reads share a file.
 */
export async function taskIdsForNodes(nodeIds: string[]): Promise<string[]> {
  if (nodeIds.length === 0) return [];
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      sql`${tasks.projectNodeId} = any(${sql.param(nodeIds)}::uuid[]) and ${tasks.archived} = false`,
    );
  return rows.map((r) => r.id);
}

/** Every node that still has a live task pointer — used by the "In WMS" chip. */
export async function countLinkedTasks(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(isNotNull(tasks.projectNodeId));
  return row?.n ?? 0;
}

/** One rung of a task's plan lineage, outermost first. */
export interface PlanTrailStep {
  id: string;
  kind: PlanKind;
  name: string;
  /**
   * The short ref this rung shows in the plan — "M2", "RD", "A5", "SA5.1".
   *
   * DERIVED, never stored (see `lib/plan/levels.ts`): a row's number is its
   * 1-based position among siblings of the same kind, counted in the same
   * (sort_order, name) order the tree renders in. The ordinal comes from the
   * query; the spelling comes from `refFor`, so the "M2" printed on a task is
   * the "M2" the plan table shows rather than a second numbering scheme.
   */
  ref: string;
}

/**
 * The chain of plan rows above a node, project first.
 *
 *   Project › Milestone › Result › Action › Sub-action
 *
 * For the task screen: a task raised from an Action says almost nothing about
 * why it exists, because the row it came from is four levels down a tree the
 * task page cannot see. The task already carries `project_node_id`; this
 * turns that id into the sentence a reader needs.
 *
 * ONE recursive query rather than a walk up the parents in application code:
 * the depth is bounded but not fixed, and five round trips to render a
 * breadcrumb is five too many.
 *
 * The node itself is the last step, so the caller can decide whether to draw
 * it — the task page does not, since the headline already is that row.
 */
export async function planTrail(nodeId: string): Promise<PlanTrailStep[]> {
  const rows = await db.execute<{
    id: string;
    kind: string;
    name: string;
    depth: number;
    ordinal: number;
  }>(sql`
    with recursive trail as (
      select id, kind, name, parent_id, sort_order, 0 as depth
        from project_nodes
       where id = ${nodeId}
      union all
      select p.id, p.kind, p.name, p.parent_id, p.sort_order, t.depth + 1
        from project_nodes p
        join trail t on p.id = t.parent_id
    )
    select
      t.id,
      t.kind,
      t.name,
      t.depth,
      -- The rung's 1-based position among its siblings OF THE SAME KIND, in
      -- the (sort_order, name) order the tree renders in. IS NOT DISTINCT
      -- FROM rather than = so a root's NULL parent groups with the other
      -- roots instead of matching nothing.
      (
        select count(*) + 1
          from project_nodes s
         where s.parent_id is not distinct from t.parent_id
           and s.kind = t.kind
           and s.is_archived = false
           and (s.sort_order, s.name) < (t.sort_order, t.name)
      )::int as ordinal
      from trail t
     order by t.depth desc
  `);

  const steps: PlanTrailStep[] = [];
  let parentRef = "";
  for (const r of rows as unknown as {
    id: string;
    kind: string;
    name: string;
    ordinal: number;
  }[]) {
    if (!isPlanKind(r.kind)) continue;
    // Outermost first, so the parent's ref is always already in hand — which
    // is what the deep levels append to ("SA3.1" is A3's ordinals plus this
    // row's). Same one-pass shape `buildTable` uses.
    const ref = refFor(r.kind, r.ordinal, parentRef);
    steps.push({ id: r.id, kind: r.kind, name: r.name, ref });
    parentRef = ref;
  }
  return steps;
}
