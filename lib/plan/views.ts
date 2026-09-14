/**
 * Project Views — the whole plan as ONE indented tree.
 *
 *   ▾ P1  AICL WMS
 *     ▾ M1  Attendance
 *       ▾ RA  Biometric feed
 *         ▸ A1  Vendor demo
 *         ▾ A2  Install readers
 *             SA2.1  Site survey
 *   ▸ P2  Payroll
 *
 * A tree rather than a pane-per-level drill-down: panes could only ever show
 * one branch — to compare two milestones you had to click back up and lose
 * your place, and the SHAPE of a project (how deep it runs, where the work
 * actually is) was never on screen at once. Expansion is cheap because the
 * whole subtree is already in memory.
 *
 * CLIENT-SAFE and React-free.
 */

import { PLAN_KINDS, fullRefFor, refFor, type PlanKind } from "@/lib/plan/levels";

export interface ViewNode {
  id: string;
  name: string;
  kind: PlanKind;
  description?: string | null;
  children: ViewNode[];
}

/** One VISIBLE line of the tree. Flat, not nested — see `flattenPlanTree`. */
export interface PlanTreeLine<T extends ViewNode> {
  node: T;
  kind: PlanKind;
  depth: number;
  ref: string;
  fullRef: string;
  /** Ids from the root down to (not including) this node. */
  ancestorIds: string[];
  childCount: number;
  expanded: boolean;
  /** Last among its own siblings — the tree guides draw the elbow from this. */
  isLast: boolean;
}

export interface FlattenOptions {
  /** Show only this root's branch. */
  rootId?: string | null;
  /** Keep matching rows plus every ancestor that leads to one. */
  query?: string;
}

/**
 * The lines currently visible, FLAT.
 *
 * Flat, not nested, so the row component needs no recursion and a project
 * renders through the same code as a sub-sub-action.
 *
 * A node is walked INTO only when its id is in `expanded`, so a thousand-row
 * plan costs whatever is open and no more.
 *
 * A search keeps matching rows PLUS every ancestor that leads to one — a match
 * hanging off nothing is unreachable — and force-opens those branches.
 */
export function flattenPlanTree<T extends ViewNode>(
  tree: T[],
  expanded: ReadonlySet<string>,
  options: FlattenOptions = {},
): PlanTreeLine<T>[] {
  const roots = options.rootId
    ? tree.filter((n) => n.id === options.rootId)
    : tree;

  const query = options.query?.trim().toLowerCase() ?? "";
  // `null` means "no search" — every row is kept and `expanded` alone decides.
  const keep = query === "" ? null : matchingBranch(roots, query);
  if (keep && keep.size === 0) return [];

  const out: PlanTreeLine<T>[] = [];
  walk(roots, 0, [], null);
  return out;

  function walk(
    nodes: readonly T[],
    depth: number,
    ancestorIds: string[],
    parentRefs: { ref: string; fullRef: string } | null,
  ): void {
    // Ordinals are counted PER KIND, so a stray row of another kind among the
    // siblings cannot push M2 to M3.
    const seen = new Map<PlanKind, number>();
    const visible = nodes.filter((n) => !keep || keep.has(n.id));

    visible.forEach((node, index) => {
      const ordinal = (seen.get(node.kind) ?? 0) + 1;
      seen.set(node.kind, ordinal);

      const ref = refFor(node.kind, ordinal, parentRefs?.ref ?? null);
      const fullRef = fullRefFor(node.kind, ordinal, parentRefs?.fullRef ?? null);
      const children = (node.children as T[]).filter((c) => !keep || keep.has(c.id));
      // A search force-opens the branches it kept: a hit three levels down is
      // no use behind a closed caret.
      const isOpen = keep ? children.length > 0 : expanded.has(node.id);

      out.push({
        node,
        kind: node.kind,
        depth,
        ref,
        fullRef,
        ancestorIds,
        childCount: children.length,
        expanded: isOpen && children.length > 0,
        isLast: index === visible.length - 1,
      });

      if (isOpen && children.length > 0) {
        walk(children, depth + 1, [...ancestorIds, node.id], { ref, fullRef });
      }
    });
  }
}

/**
 * Every id worth keeping for a search: the rows that match, and every ancestor
 * on the path to one.
 */
function matchingBranch<T extends ViewNode>(
  roots: readonly T[],
  query: string,
): Set<string> {
  const keep = new Set<string>();
  for (const root of roots) visit(root, []);
  return keep;

  function visit(node: T, trail: string[]): void {
    const hit =
      node.name.toLowerCase().includes(query) ||
      (node.description ?? "").toLowerCase().includes(query);
    if (hit) {
      for (const id of trail) keep.add(id);
      keep.add(node.id);
    }
    const next = [...trail, node.id];
    for (const child of node.children as T[]) visit(child, next);
  }
}

/** Every id that has children — what "Expand all" turns on. */
export function expandableIds(tree: readonly ViewNode[]): Set<string> {
  const out = new Set<string>();
  const stack: ViewNode[] = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 0) {
      out.add(node.id);
      stack.push(...node.children);
    }
  }
  return out;
}

/* ── The id-based drill-down resolver ────────────────────────────────────── */

/** The four levels a deep link may name. */
export interface ViewPathInput {
  projectId?: string | null;
  milestoneId?: string | null;
  resultId?: string | null;
  actionId?: string | null;
}

export interface ViewCrumb {
  id: string;
  kind: PlanKind;
  ref: string;
  name: string;
}

export interface ResolvedViewPath<T extends ViewNode> {
  /** The rows to offer at each level, outermost first. */
  levels: { kind: PlanKind; nodes: T[] }[];
  crumbs: ViewCrumb[];
  /** What actually resolved — compare against the input to decide a rewrite. */
  selection: ViewPathInput;
  /** The deepest node that resolved, or null. */
  focus: T | null;
}

const PATH_KEYS = ["projectId", "milestoneId", "resultId", "actionId"] as const;
const PATH_KINDS: PlanKind[] = ["project", "milestone", "result", "action"];

/**
 * Resolve a deep link into a drill-down path.
 *
 * THE PATH IS IDS, NOT LABELS. Each id is looked up AMONG THE CHILDREN OF THE
 * LEVEL ABOVE; refs are computed on the way down for display only, and nothing
 * is ever found by matching one. That is also what makes refs safe to
 * renumber — deleting M1 changes every label below it and breaks no link.
 *
 * A STALE ID IS DROPPED, NOT GUESSED. If the URL names a milestone that is not
 * under the named project — an old bookmark, a deleted row, a moved branch —
 * the path TRUNCATES at the last level that genuinely lines up and everything
 * deeper goes with it, rather than showing rows from somewhere else under a
 * breadcrumb that lies.
 */
export function resolveViewPath<T extends ViewNode>(
  tree: T[],
  input: ViewPathInput,
): ResolvedViewPath<T> {
  const levels: { kind: PlanKind; nodes: T[] }[] = [];
  const crumbs: ViewCrumb[] = [];
  const selection: ViewPathInput = {};
  let focus: T | null = null;

  let pool: T[] = tree.filter((n) => n.kind === "project");
  let parentRef: string | null = null;

  for (let i = 0; i < PATH_KEYS.length; i++) {
    const kind = PATH_KINDS[i]!;
    const key = PATH_KEYS[i]!;
    levels.push({ kind, nodes: pool });

    const wantedId = input[key];
    if (!wantedId) break;

    const index = pool.findIndex((n) => n.id === wantedId && n.kind === kind);
    // Not among the children of the level above → truncate here. Everything
    // deeper in the URL goes with it.
    if (index === -1) break;

    const node = pool[index]!;
    const ref = refFor(kind, index + 1, parentRef);
    crumbs.push({ id: node.id, kind, ref, name: node.name });
    selection[key] = node.id;
    focus = node;
    parentRef = ref;

    const childKind = PATH_KINDS[i + 1];
    if (!childKind) break;
    pool = (node.children as T[]).filter((c) => c.kind === childKind);
  }

  return { levels, crumbs, selection, focus };
}

/**
 * Pick a row at one level.
 *
 * Clears every level BELOW it, and re-selecting the row that is already open
 * COLLAPSES it — the same click that opened it closes it.
 */
export function selectAt(
  current: ViewPathInput,
  kind: PlanKind,
  id: string,
): ViewPathInput {
  const level = PATH_KINDS.indexOf(kind);
  if (level === -1) return current;
  const key = PATH_KEYS[level]!;
  const next: ViewPathInput = {};
  for (let i = 0; i < level; i++) {
    const k = PATH_KEYS[i]!;
    if (current[k]) next[k] = current[k];
  }
  if (current[key] !== id) next[key] = id;
  return next;
}

/** Query keys for the URL — `?project=&m=&r=&a=`. */
const QUERY_KEYS: Record<(typeof PATH_KEYS)[number], string> = {
  projectId: "project",
  milestoneId: "m",
  resultId: "r",
  actionId: "a",
};

/**
 * Serialise a path for the URL.
 *
 * An absent level is an ABSENT KEY, not an empty string: `?project=x&m=` reads
 * as "a milestone was chosen and it is nothing", which is not a state this
 * path can be in.
 */
export function serialiseViewPath(path: ViewPathInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of PATH_KEYS) {
    const value = path[key];
    if (value) params.set(QUERY_KEYS[key], value);
  }
  return params;
}

/** Read a path back off the URL. */
export function parseViewPath(params: URLSearchParams): ViewPathInput {
  const out: ViewPathInput = {};
  for (const key of PATH_KEYS) {
    const value = params.get(QUERY_KEYS[key]);
    if (value) out[key] = value;
  }
  return out;
}

/*
 * There was a `LEVEL_FIELDS` table here, describing which plan fields each
 * level's pane could show. It went when Project Views became a name-only
 * outline: nothing rendered it any more, and it had drifted from the level
 * model besides — it claimed `wmsTask: false` for a Result while
 * `hasTask("result")` says a Result does get a task.
 *
 * The surviving authority on what a level carries is `hasTask` / `hasSchedule`
 * in lib/plan/levels.ts, which is the pair the WRITES enforce. One table, not
 * two that can disagree.
 */

/** Every kind, for a caller that wants the full set in depth order. */
export const VIEW_KINDS: readonly PlanKind[] = PLAN_KINDS;
