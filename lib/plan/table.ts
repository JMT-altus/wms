/**
 * The hierarchy table's pure core — flatten, count, search, sort, export.
 *
 * CLIENT-SAFE and React-free, so the rules that decide which rows are on
 * screen can be tested without mounting a table, and the CSV can be produced
 * from exactly the same pipeline the screen ran.
 */

import {
  KIND_DEPTH,
  KIND_LABEL,
  fullRefFor,
  hasTask,
  isExecutable,
  refFor,
  type PlanKind,
} from "@/lib/plan/levels";

/** The row shape the table works over. Structural — see `PlanNode`. */
export interface TableNode {
  id: string;
  name: string;
  kind: PlanKind;
  description?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  targetDate?: string | null;
  task?: { id: string } | null;
  children: TableNode[];
}

export interface TableRow<T extends TableNode> {
  node: T;
  depth: number;
  ref: string;
  fullRef: string;
  /** "AICL WMS / Attendance / Biometric feed" — the export's Path column. */
  path: string;
  ancestorIds: string[];
  /** Owners of every container above, for the client-side actor derivation. */
  ancestorOwnerIds: (string | null)[];
  childCount: number;
  expanded: boolean;
  hasChildren: boolean;
  /** Index among its siblings of the same kind, 1-based. */
  ordinal: number;
  siblingCount: number;
}

export type PlanSort = "plan" | "name" | "target" | "owner";

export interface FlattenTableOptions {
  expanded: ReadonlySet<string>;
  query?: string;
  /** Show only this project's branch. */
  projectId?: string | null;
  sort?: PlanSort;
  /**
   * "Show down to…" — the deepest LEVEL to render, by KIND_DEPTH.
   *
   * A depth cap rather than a kind filter: a plan is read top-down, and
   * hiding milestones while keeping the actions under them would leave rows
   * indented against parents that are not on screen.
   */
  maxDepth?: number | null;
}

/**
 * Every row on screen, flat.
 *
 * The search KEEPS A ROW when it matches or ANYTHING BENEATH IT does — a
 * filter that hides the parents of a hit removes its context, and a hit you
 * cannot reach is not a result.
 */
export function flattenTable<T extends TableNode>(
  tree: T[],
  options: FlattenTableOptions,
): TableRow<T>[] {
  const roots = options.projectId
    ? tree.filter((n) => n.id === options.projectId)
    : tree;

  const query = options.query?.trim().toLowerCase() ?? "";
  const keep = query === "" ? null : keepBranch(roots, query);
  if (keep && keep.size === 0) return [];

  const out: TableRow<T>[] = [];
  walk(roots, 0, [], [], null, null);
  return out;

  function walk(
    nodes: readonly T[],
    depth: number,
    ancestorIds: string[],
    ancestorOwnerIds: (string | null)[],
    parentRef: string | null,
    parentFullRef: string | null,
  ): void {
    const visible = sortRows(
      nodes.filter((n) => !keep || keep.has(n.id)),
      options.sort ?? "plan",
    );

    // Ordinals count per kind, over the VISIBLE siblings, so the ref matches
    // what is actually on screen after a sort.
    const seen = new Map<PlanKind, number>();
    const totals = new Map<PlanKind, number>();
    for (const n of visible) totals.set(n.kind, (totals.get(n.kind) ?? 0) + 1);

    for (const node of visible) {
      const ordinal = (seen.get(node.kind) ?? 0) + 1;
      seen.set(node.kind, ordinal);

      const ref = refFor(node.kind, ordinal, parentRef);
      const fullRef = fullRefFor(node.kind, ordinal, parentFullRef);
      const depthOk =
        options.maxDepth == null || KIND_DEPTH[node.kind] < options.maxDepth;
      const children = depthOk
        ? (node.children as T[]).filter((c) => !keep || keep.has(c.id))
        : [];
      // A search force-opens the branches it kept.
      const isOpen = keep ? children.length > 0 : options.expanded.has(node.id);

      out.push({
        node,
        depth,
        ref,
        fullRef,
        path: ancestorIds.length === 0 ? "" : pathOf(out, ancestorIds),
        ancestorIds,
        ancestorOwnerIds,
        childCount: children.length,
        expanded: isOpen && children.length > 0,
        hasChildren: children.length > 0,
        ordinal,
        siblingCount: totals.get(node.kind) ?? 1,
      });

      if (isOpen && children.length > 0) {
        walk(
          children,
          depth + 1,
          [...ancestorIds, node.id],
          [...ancestorOwnerIds, node.ownerId ?? null],
          ref,
          fullRef,
        );
      }
    }
  }
}

/** Ancestor NAMES, read back off the rows already emitted. */
function pathOf<T extends TableNode>(rows: TableRow<T>[], ancestorIds: string[]): string {
  const byId = new Map(rows.map((r) => [r.node.id, r.node.name]));
  return ancestorIds.map((id) => byId.get(id) ?? "").filter(Boolean).join(" / ");
}

function keepBranch<T extends TableNode>(
  roots: readonly T[],
  query: string,
): Set<string> {
  const keep = new Set<string>();
  for (const root of roots) visit(root, []);
  return keep;

  function visit(node: T, trail: string[]): void {
    const hit =
      node.name.toLowerCase().includes(query) ||
      (node.description ?? "").toLowerCase().includes(query) ||
      (node.ownerName ?? "").toLowerCase().includes(query);
    if (hit) {
      for (const id of trail) keep.add(id);
      keep.add(node.id);
    }
    const next = [...trail, node.id];
    for (const child of node.children as T[]) visit(child, next);
  }
}

/**
 * Sort one run of siblings.
 *
 * UNDATED ROWS LAST on the target-date sort: they are the ones without a
 * commitment yet, and burying the dated work under them is the wrong way round.
 */
export function sortRows<T extends TableNode>(nodes: T[], sort: PlanSort): T[] {
  if (sort === "plan") return nodes;
  const copy = [...nodes];
  const collate = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" });

  switch (sort) {
    case "name":
      return copy.sort((a, b) => collate(a.name, b.name));
    case "target":
      return copy.sort((a, b) => {
        const at = a.targetDate ?? "";
        const bt = b.targetDate ?? "";
        if (at === "" && bt === "") return collate(a.name, b.name);
        if (at === "") return 1; // undated last
        if (bt === "") return -1;
        return at.localeCompare(bt) || collate(a.name, b.name);
      });
    case "owner":
      return copy.sort((a, b) => {
        const ao = a.ownerName ?? "";
        const bo = b.ownerName ?? "";
        if (ao === "" && bo === "") return collate(a.name, b.name);
        if (ao === "") return 1;
        if (bo === "") return -1;
        return collate(ao, bo) || collate(a.name, b.name);
      });
  }
}

/* ── The header chips ────────────────────────────────────────────────────── */

export interface PlanCounts {
  total: number;
  projects: number;
  milestones: number;
  results: number;
  /** Executable rows of every depth — what the "Actions" chip counts. */
  actions: number;
  /** Just `kind === "action"`, for the level pill. */
  actionsOnly: number;
  subActions: number;
  subSubActions: number;
  /** Rows that are a real task in the WMS list. */
  inWms: number;
  /** Task-level rows with no task yet — missing an owner or a target date. */
  notScheduled: number;
}

/**
 * Counted over the WHOLE TREE, never the rendered rows.
 *
 * Results start collapsed, so counting what is on screen reports "0 Actions"
 * on a plan full of them.
 */
/**
 * The header chip currently filtering the plan, if any.
 *
 * Lives here rather than beside the toolbar that draws it, so the three
 * surfaces which honour it — the hierarchy, the register and the board — share
 * ONE definition with `countPlan` above. A chip that counts one set and
 * filters another is the bug this pairing exists to prevent.
 */
export type PlanChip =
  | "project"
  | "milestone"
  | "result"
  | "action"
  | "wms"
  | "unscheduled"
  | null;

/**
 * Does this row belong to the chip's set?
 *
 * Deliberately the same predicates `countPlan` uses. `hasTask` gates BOTH
 * "In WMS" and "Not scheduled" — the hierarchy used to test `node.task` alone
 * for "In WMS", so a legacy Result still carrying a task was filtered in under
 * a number that had never counted it.
 */
export function matchesChip(node: TableNode, chip: PlanChip): boolean {
  if (!chip) return true;
  if (chip === "wms") return hasTask(node.kind) && Boolean(node.task);
  if (chip === "unscheduled") return hasTask(node.kind) && !node.task;
  if (chip === "action") return isExecutable(node.kind);
  return node.kind === chip;
}

export function countPlan(tree: readonly TableNode[]): PlanCounts {
  const counts: PlanCounts = {
    total: 0,
    projects: 0,
    milestones: 0,
    results: 0,
    actions: 0,
    actionsOnly: 0,
    subActions: 0,
    subSubActions: 0,
    inWms: 0,
    notScheduled: 0,
  };
  const stack: TableNode[] = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    counts.total++;
    if (node.kind === "project") counts.projects++;
    else if (node.kind === "milestone") counts.milestones++;
    else if (node.kind === "result") counts.results++;
    else if (isExecutable(node.kind)) {
      counts.actions++;
      if (node.kind === "action") counts.actionsOnly++;
      else if (node.kind === "sub_action") counts.subActions++;
      else counts.subSubActions++;
    }
    if (hasTask(node.kind)) {
      if (node.task) counts.inWms++;
      else counts.notScheduled++;
    }
    stack.push(...node.children);
  }
  return counts;
}

/**
 * Which rows start open: Projects and Milestones, everything from Result down
 * closed.
 *
 * The guard against the worst case — a project with hundreds of actions and
 * thousands of sub-sub-actions — because rendering the whole tree on first
 * paint puts every one of those rows in the DOM before anyone asked for one.
 *
 * Computed ONCE, in a state initialiser. After that the set is the user's, so
 * a refresh from an edit can never re-close what they opened, and a newly
 * added row (absent from the set) is visible immediately.
 */
export function initialExpanded(tree: readonly TableNode[]): Set<string> {
  const open = new Set<string>();
  const stack: TableNode[] = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (KIND_DEPTH[node.kind] < 2 && node.children.length > 0) open.add(node.id);
    stack.push(...node.children);
  }
  return open;
}

/* ── CSV ─────────────────────────────────────────────────────────────────── */

/** RFC-4180: quote anything with a comma, a quote or a newline. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvColumn<T extends TableNode> {
  header: string;
  value: (row: TableRow<T>) => string;
}

/**
 * EXACTLY WHAT IS ON SCREEN — same filter, same search, same sort, same
 * columns — prefixed with Full Ref, Level and Path so a row is traceable
 * outside the app.
 *
 * UTF-8 BOM, because Excel reads a BOM-less UTF-8 file as the system codepage
 * and turns every name with an accent into mojibake.
 */
export function planCsv<T extends TableNode>(
  rows: readonly TableRow<T>[],
  columns: readonly CsvColumn<T>[],
): string {
  const header = ["Full Ref", "Level", "Path", ...columns.map((c) => c.header)];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.fullRef,
        KIND_LABEL[row.node.kind],
        row.path,
        ...columns.map((c) => c.value(row)),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}`;
}

/** `Project-Plan-YYYY-MM-DD.csv`, from local getters. */
export function planCsvName(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `Project-Plan-${y}-${m}-${d}.csv`;
}
