/**
 * Progress — the partial rule.
 *
 * CLIENT-SAFE pure functions over the tree the caller already has, so the
 * hierarchy table recomputes as rows are edited without a round-trip and the
 * server produces identical numbers for an export. Same input, same answer,
 * both sides.
 *
 * NOTHING INVENTS A NUMBER. There is no default "50%" anywhere, and a project
 * with nothing under it reports 0 of 0 rather than a flattering guess.
 */

import { CHILD_KIND, isExecutable, type PlanKind } from "@/lib/plan/levels";

/**
 * The minimum a node must expose for progress to be computed.
 *
 * Structural on purpose — the hierarchy table, the registers, the kanban and
 * the export all hand in their own row type, and none of them should have to
 * be converted first.
 */
export interface ProgressNode {
  kind: PlanKind;
  /** 0-100 override, or null to derive. */
  progressPercent?: number | null;
  /**
   * The linked task's working status, for an executable row. Only `done`
   * counts as finished — an approved or cancelled row is a verdict, not
   * progress.
   */
  taskStatus?: string | null;
  children: ProgressNode[];
}

/**
 * Every EXECUTABLE descendant that is a leaf of the work, including the node
 * itself when it is one.
 *
 * A sub-divided action is measured by its children, not counted twice: the
 * parent is skipped as a leaf the moment it has executable children of its
 * own. Containers are never returned at all — count one as a denominator and
 * a milestone gains progress just by being subdivided.
 */
export function executableLeaves<T extends ProgressNode>(node: T): T[] {
  const out: T[] = [];
  walkLeaves(node, out);
  return out;
}

function walkLeaves<T extends ProgressNode>(node: T, out: T[]): void {
  const executableChildren = (node.children as T[]).filter((c) =>
    isExecutable(c.kind),
  );
  if (isExecutable(node.kind) && executableChildren.length === 0) {
    out.push(node);
    return;
  }
  for (const child of node.children as T[]) walkLeaves(child, out);
}

/** Only `done` is finished. A verdict is not progress. */
function isDone(node: ProgressNode): boolean {
  return node.taskStatus === "done";
}

/**
 * A node's completion as a fraction of 1, in this exact order of preference:
 *
 *   1. A recorded `progressPercent` WINS. Someone looked at the milestone and
 *      said "this is 40% there"; a derived number must not silently overrule a
 *      human judgement.
 *   2. Otherwise done ÷ total over the executable leaves beneath it — the
 *      number that keeps itself honest as tasks are ticked off.
 *   3. A bare executable row is simply 1 or 0 from its task status.
 *   4. A container with neither is 0. Not "unknown", not excluded — an empty
 *      milestone has genuinely delivered nothing.
 */
export function nodeFraction(node: ProgressNode): number {
  const override = node.progressPercent;
  if (override != null && Number.isFinite(override)) {
    return clamp01(override / 100);
  }

  const leaves = executableLeaves(node);
  if (leaves.length > 0) {
    const done = leaves.reduce((n, l) => n + (isDone(l) ? 1 : 0), 0);
    return done / leaves.length;
  }

  if (isExecutable(node.kind)) return isDone(node) ? 1 : 0;
  return 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export interface Completion {
  /**
   * A DECIMAL, and never rounded on the way through — each child contributes
   * its own fraction. Rounding happens once, at display.
   */
  completed: number;
  total: number;
  fraction: number;
}

export const EMPTY_COMPLETION: Completion = {
  completed: 0,
  total: 0,
  fraction: 0,
};

/**
 * The completion of a row's DIRECT children of one kind, as a decimal count.
 *
 * Completion is a sum of fractions, not a count of finished ones:
 *
 *   10 milestones, one half done       →  3.5 / 10
 *    8 milestones, one a quarter done  →  2.25 / 8
 *    7 milestones, one 40% done        →  4.4 / 7
 *
 * One function rather than three near-copies: a project counts milestones, a
 * milestone counts results, a result counts actions — only the kind changes.
 */
export function childCompletion(
  parent: ProgressNode,
  kind: PlanKind | null,
): Completion {
  if (!kind) return EMPTY_COMPLETION;
  const children = parent.children.filter((c) => c.kind === kind);
  if (children.length === 0) return EMPTY_COMPLETION;
  const completed = children.reduce((sum, c) => sum + nodeFraction(c), 0);
  return {
    completed,
    total: children.length,
    fraction: completed / children.length,
  };
}

/** `childCompletion` against whatever this row's own child level is. */
export function ownChildCompletion(parent: ProgressNode): Completion {
  return childCompletion(parent, CHILD_KIND[parent.kind]);
}

/**
 * A project's headline fraction — its milestone completion, falling back to
 * its own executable rows when it has no milestones, so a small project run as
 * a flat list of actions still reports something true.
 */
export function projectFraction(project: ProgressNode): number {
  const milestones = childCompletion(project, "milestone");
  if (milestones.total > 0) return milestones.fraction;
  return nodeFraction(project);
}

/* ── Display ─────────────────────────────────────────────────────────────── */

/**
 * Trim a decimal count to at most TWO decimals, with no trailing zeros —
 * 3.5 stays "3.5", 2.25 stays "2.25", 3 does not become "3.00".
 *
 * Two decimals is not arbitrary: cutting to one would round 2.25 to 2.3, which
 * is exactly the bug this guards. This is also the ONLY place rounding is
 * allowed to happen.
 */
export function formatCompleted(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/** "3.5/10". */
export function formatCompletion(c: Completion): string {
  return `${formatCompleted(c.completed)}/${c.total}`;
}

/** A whole percent, display only — never stored, never fed back into a sum. */
export function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.round(clamp01(fraction) * 100);
}

/**
 * "40% | 3.5/10 | 3.5 out of 10 milestones are completed".
 *
 * The noun is read off CHILD_KIND rather than written out four times, so the
 * same function serves a project counting milestones and a result counting
 * actions.
 */
export function describeProgress(
  project: ProgressNode,
  labelFor: (kind: PlanKind, plural: boolean) => string,
): string {
  const fraction = projectFraction(project);
  const child = CHILD_KIND[project.kind];
  const c = childCompletion(project, child);
  const pct = `${toPercent(fraction)}%`;
  if (!child || c.total === 0) return pct;
  const noun = labelFor(child, c.total !== 1).toLowerCase();
  return `${pct} | ${formatCompletion(c)} | ${formatCompleted(c.completed)} out of ${c.total} ${noun} ${c.total === 1 ? "is" : "are"} completed`;
}

/** "0 out of 3 milestones" — the line every level prints under its number. */
export function describeChildren(
  node: ProgressNode,
  labelFor: (kind: PlanKind, plural: boolean) => string,
): string | null {
  const child = CHILD_KIND[node.kind];
  if (!child) return null;
  const c = childCompletion(node, child);
  if (c.total === 0) return null;
  const noun = labelFor(child, c.total !== 1).toLowerCase();
  return `${formatCompleted(c.completed)} out of ${c.total} ${noun}`;
}
