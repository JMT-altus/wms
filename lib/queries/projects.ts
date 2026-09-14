import "server-only";
import { asc, desc, eq, sql, and, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  projectNodes,
  tasks,
  employees,
  projectMembers,
  projectAudience,
} from "@/db/schema";
import type { TaskStatus, Visibility } from "@/db/enums";
import { refFor, type PlanKind } from "@/lib/plan/levels";
import { getViewer, visibleTaskCondition } from "@/lib/auth/task-visibility";
import { canSee, type AudienceEntry } from "@/lib/access/visibility";
import { CACHE_TAGS } from "@/lib/cache-tags";

export interface ProjectMemberRef {
  id: string;
  name: string | null;
}

export interface ProjectTreeNode {
  id: string;
  name: string;
  /** Widened by 0103 to the full six-level PlanKind. Read the level model
   *  from lib/plan/levels.ts rather than re-spelling the union here. */
  kind: PlanKind;
  parentId: string | null;
  sortOrder: number;
  actionCount: number;
  description: string | null;
  notes: string | null;
  targetDate: Date | null;
  ownerId: string | null;
  ownerName: string | null;
  createdById: string | null;
  /** Meaningful on ROOTS only — descendants inherit it. */
  visibility: Visibility;
  members: ProjectMemberRef[];
  children: ProjectTreeNode[];
}

/**
 * Full active project tree (Project → Milestone → Result) with the number
 * of tasks ("actions") linked to each node.
 */
export async function listProjectTree(): Promise<ProjectTreeNode[]> {
  const owner = alias(employees, "owner");
  const viewer = await getViewer();
  const [rows, memberRows, audienceRows] = await Promise.all([
    db
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
        createdById: projectNodes.createdById,
        visibility: projectNodes.visibility,
        actionCount: sql<number>`count(${tasks.id})::int`,
      })
      .from(projectNodes)
      .leftJoin(
        tasks,
        and(eq(tasks.projectNodeId, projectNodes.id), eq(tasks.archived, false)),
      )
      .leftJoin(owner, eq(owner.id, projectNodes.ownerId))
      .where(eq(projectNodes.isArchived, false))
      .groupBy(projectNodes.id, owner.name)
      .orderBy(asc(projectNodes.sortOrder), asc(projectNodes.name)),

    db
      .select({
        nodeId: projectMembers.projectNodeId,
        employeeId: projectMembers.employeeId,
        name: employees.name,
      })
      .from(projectMembers)
      .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
      .orderBy(asc(employees.name)),
    db
      .select({
        nodeId: projectAudience.projectNodeId,
        kind: projectAudience.kind,
        refId: projectAudience.refId,
      })
      .from(projectAudience),
  ]);

  const audienceByNode = new Map<string, AudienceEntry[]>();
  for (const a of audienceRows) {
    const list = audienceByNode.get(a.nodeId) ?? [];
    list.push({ kind: a.kind, refId: a.refId });
    audienceByNode.set(a.nodeId, list);
  }

  const membersByNode = new Map<string, ProjectMemberRef[]>();
  for (const m of memberRows) {
    const list = membersByNode.get(m.nodeId) ?? [];
    list.push({ id: m.employeeId, name: m.name });
    membersByNode.set(m.nodeId, list);
  }

  const byId = new Map<string, ProjectTreeNode>();
  for (const r of rows) {
    byId.set(r.id, {
      ...r,
      members: membersByNode.get(r.id) ?? [],
      children: [],
    });
  }
  const roots: ProjectTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else if (!node.parentId) {
      roots.push(node);
    }
  }

  // Visibility is set on the ROOT and inherited, so pruning whole roots is the
  // entire enforcement — no descendant can outlive its parent. Done in JS
  // rather than SQL because the tree is fetched whole anyway, and this reuses
  // the exact same `canSee` the tasks side and the UI use.
  if (!viewer) return [];
  return roots.filter((root) =>
    canSee(viewer, {
      visibility: root.visibility,
      // Owner, creator and any member of the project are on it.
      participantIds: [
        root.ownerId,
        root.createdById,
        ...root.members.map((m) => m.id),
      ],
      audience: audienceByNode.get(root.id) ?? [],
    }),
  );
}

export interface ProjectNodeOption {
  id: string;
  /** "Project / Milestone / Result" path label for the task picker. */
  label: string;
  /** The row's own name, unprefixed — what a cascading picker shows once the
   *  level above it has already been chosen. */
  name: string;
  /** The level, so a picker can offer one level at a time. */
  kind: PlanKind;
  /** The row above it, so a picker can narrow to one branch. */
  parentId: string | null;
  /** The derived short ref — "M2", "RD". Numbering is a display artefact of
   *  the tree (see `lib/plan/levels.ts`), computed here so every consumer
   *  shows the same one instead of inventing its own. */
  ref: string;
  /** What this row says it is, so the task form can show the brief for the
   *  branch being filed into instead of asking people to remember it. */
  description: string | null;
}

/** A node, its ancestor path labels, and the descendant ids (incl. itself). */
export async function getNodeContext(
  nodeId: string,
): Promise<{ node: ProjectTreeNode; path: string[]; descendantIds: string[] } | null> {
  const tree = await listProjectTree();
  let found: ProjectTreeNode | null = null;
  let path: string[] = [];
  function search(node: ProjectTreeNode, trail: string[]): boolean {
    const next = [...trail, node.name];
    if (node.id === nodeId) {
      found = node;
      path = trail;
      return true;
    }
    return node.children.some((c) => search(c, next));
  }
  for (const r of tree) if (search(r, [])) break;
  if (!found) return null;
  const ids: string[] = [];
  function collect(n: ProjectTreeNode) {
    ids.push(n.id);
    n.children.forEach(collect);
  }
  collect(found);
  return { node: found, path, descendantIds: ids };
}

export interface NodeAction {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  status: TaskStatus;
  dueAt: Date;
  doerName: string | null;
}

/** Tasks ("actions") linked to any of the given nodes, soonest due first. */
export async function listNodeActions(nodeIds: string[]): Promise<NodeAction[]> {
  if (nodeIds.length === 0) return [];
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      subject: tasks.subject,
      status: tasks.status,
      dueAt: tasks.dueAt,
      doerName: employees.name,
    })
    .from(tasks)
    .leftJoin(employees, eq(tasks.doerId, employees.id))
    // Seeing a project does not imply seeing every task hung off it — a
    // private task attached to a shared project stays private.
    .where(
      and(
        inArray(tasks.projectNodeId, nodeIds),
        eq(tasks.archived, false),
        await visibleTaskCondition(),
      ),
    )
    .orderBy(desc(tasks.createdAt));
  return rows.map((r) => ({ ...r, doerName: r.doerName ?? null }));
}

/**
 * Flat, path-labelled list of active nodes for the task → project picker.
 * Cached under the `projectNodes` tag — re-fetches only when a node is
 * created/renamed/archived (writers in `app/(app)/projects/actions.ts`
 * call `updateTag(CACHE_TAGS.projectNodes)`).
 *
 * The viewer is PART OF THE KEY. The underlying tree is pruned by visibility,
 * so a single shared entry would hand one person's picker — project names and
 * all — to whoever asked next.
 */
export async function listProjectNodeOptions(): Promise<ProjectNodeOption[]> {
  const viewer = await getViewer();
  const viewerKey = !viewer
    ? "anon"
    : viewer.isSuperAdmin
      ? "super"
      : `${viewer.id}:${viewer.isManagement ? "m" : "-"}:${[...viewer.departmentIds].sort().join("+")}`;

  return unstable_cache(
    async (): Promise<ProjectNodeOption[]> => {
      const tree = await listProjectTree();
      const out: ProjectNodeOption[] = [];
      /**
       * The ref is derived from the row's 1-based position among its siblings
       * OF THE SAME KIND — the same rule `refFor` applies everywhere else, so
       * the "M2" a task's detail page prints is the "M2" the plan table shows.
       * Nothing is read from a stored column; there isn't one.
       */
      function walk(node: ProjectTreeNode, prefix: string, index1: number, parentRef: string) {
        const label = prefix ? `${prefix} / ${node.name}` : node.name;
        const ref = refFor(node.kind, index1, parentRef);
        out.push({
          id: node.id,
          label,
          name: node.name,
          kind: node.kind,
          parentId: node.parentId,
          ref,
          description: node.description,
        });
        const seen = new Map<PlanKind, number>();
        for (const c of node.children) {
          const n = (seen.get(c.kind) ?? 0) + 1;
          seen.set(c.kind, n);
          walk(c, label, n, ref);
        }
      }
      const rootSeen = new Map<PlanKind, number>();
      for (const r of tree) {
        const n = (rootSeen.get(r.kind) ?? 0) + 1;
        rootSeen.set(r.kind, n);
        walk(r, "", n, "");
      }
      return out.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
    },
    ["list-project-node-options:v4", viewerKey],
    { tags: [CACHE_TAGS.projectNodes], revalidate: 600 },
  )();
}
