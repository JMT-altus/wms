/**
 * The registers — a flattening of the SAME tree.
 *
 * Every row of one kind on its own line, carrying the whole chain of parents
 * above it. Not a second query and not a denormalised copy, which is what
 * stops a row reporting one status here and another on the board.
 *
 * CLIENT-SAFE and React-free on purpose: the flattening rule is the part worth
 * unit-testing, and it should be testable without mounting anything.
 */

import {
  CHILD_KIND,
  fullRefFor,
  refFor,
  type PlanKind,
} from "@/lib/plan/levels";
import {
  childCompletion,
  type Completion,
  type ProgressNode,
} from "@/lib/plan/progress";

/** The five register routes. */
export const REGISTER_LEVELS = [
  "projects",
  "milestones",
  "results",
  "actions",
  "sub-actions",
] as const;

export type RegisterLevel = (typeof REGISTER_LEVELS)[number];

const LEVEL_SET: ReadonlySet<string> = new Set(REGISTER_LEVELS);

export function isRegisterLevel(v: string | null | undefined): v is RegisterLevel {
  return typeof v === "string" && LEVEL_SET.has(v);
}

/** Which kind each register lists. */
export const LEVEL_KIND: Record<RegisterLevel, PlanKind> = {
  projects: "project",
  milestones: "milestone",
  results: "result",
  actions: "action",
  "sub-actions": "sub_action",
};

/**
 * What each register's rollup column counts — ALWAYS one level down.
 *
 * A milestone is measured by its results, a result by its actions. Read off
 * CHILD_KIND rather than written out five times, so adding a seventh level
 * cannot leave this table one entry behind.
 */
export const ROLLUP_KIND: Record<RegisterLevel, PlanKind | null> =
  Object.fromEntries(
    REGISTER_LEVELS.map((l) => [l, CHILD_KIND[LEVEL_KIND[l]]]),
  ) as Record<RegisterLevel, PlanKind | null>;

/** The exact ancestor chain each register carries, outermost first. */
export const ANCESTOR_KINDS: Record<RegisterLevel, PlanKind[]> = {
  projects: [],
  milestones: ["project"],
  results: ["project", "milestone"],
  actions: ["project", "milestone", "result"],
  "sub-actions": ["project", "milestone", "result", "action"],
};

/** One ancestor, as the register shows it: its ref and its name. */
export interface RegisterAncestor {
  id: string;
  kind: PlanKind;
  ref: string;
  name: string;
}

export interface RegisterRow<T extends RegisterNode> {
  node: T;
  /** Outermost first — Project, then Milestone, then … */
  ancestors: RegisterAncestor[];
  /** This row's own short ref, numbered within its parent. */
  ownRef: string;
  /** The whole traceability path: P3M3RDA5SA1. */
  fullRef: string;
  /** Completion of this row's DIRECT children one level down. */
  rollup: Completion;
}

/** The minimum a node must expose for the flattening to work. */
export interface RegisterNode extends ProgressNode {
  id: string;
  name: string;
  kind: PlanKind;
  children: RegisterNode[];
}

/**
 * Flatten the tree to one register's rows, in ONE top-down pass.
 *
 * Top-down because a row's ref depends on its parent's — the deep levels
 * append to what the level above already worked out.
 *
 * Numbering RESTARTS WITHIN EACH PARENT: the first milestone of P2 is M1, not
 * M4. That is what makes "P2 · M1" a reference a person can actually use.
 *
 * Rows whose parent chain is the wrong shape are SKIPPED, never guessed at. A
 * Result sitting directly under a Project has no milestone to name, and
 * inventing one puts a false relationship on screen — the walk only descends
 * the exact chain, so such a row is simply never reached.
 */
export function buildRegisterRows<T extends RegisterNode>(
  tree: T[],
  level: RegisterLevel,
): RegisterRow<T>[] {
  const chain = [...ANCESTOR_KINDS[level], LEVEL_KIND[level]];
  const rollupKind = ROLLUP_KIND[level];
  const out: RegisterRow<T>[] = [];

  descend(tree, 0);
  return out;

  function descend(
    nodes: readonly T[],
    depth: number,
    ancestors: RegisterAncestor[] = [],
    parentRef: string | null = null,
    parentFullRef: string | null = null,
  ): void {
    const wanted = chain[depth];
    if (!wanted) return;

    // Ordinals count PER KIND, so a stray row of another kind sitting among
    // the siblings cannot push M2 to M3.
    let ordinal = 0;
    for (const node of nodes) {
      if (node.kind !== wanted) continue;
      ordinal += 1;
      const ref = refFor(wanted, ordinal, parentRef);
      const fullRef = fullRefFor(wanted, ordinal, parentFullRef);

      if (depth === chain.length - 1) {
        out.push({
          node,
          ancestors,
          ownRef: ref,
          fullRef,
          rollup: childCompletion(node, rollupKind),
        });
        continue;
      }

      descend(
        node.children as T[],
        depth + 1,
        [...ancestors, { id: node.id, kind: wanted, ref, name: node.name }],
        ref,
        fullRef,
      );
    }
  }
}

/**
 * Does this row match the search?
 *
 * Matches the row's own name, description and ref AND every ancestor by name
 * and by ref — "AICL" is how people look for a milestone whose own name they
 * don't remember, and so is "M2".
 */
export function registerRowMatches<T extends RegisterNode & { description?: string | null }>(
  row: RegisterRow<T>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [
    row.node.name,
    row.node.description ?? "",
    row.ownRef,
    row.fullRef,
    ...row.ancestors.flatMap((a) => [a.name, a.ref]),
  ];
  return haystack.some((h) => h.toLowerCase().includes(q));
}

/**
 * The register's identity block is frozen to the left edge, and a sticky cell
 * is positioned against the SCROLL BOX rather than against the cell before it.
 * So the freeze offsets are cumulative sums of fixed widths declared here at
 * module scope — let one identity column size to its content and every column
 * after it lands in the wrong place.
 */
export const FREEZE_WIDTH = {
  tick: 40,
  ref: 92,
  name: 190,
  ownName: 230,
} as const;

/**
 * How many ANCESTOR levels may be pinned to the left edge.
 *
 * A frozen column earns its keep by holding identity still while the DATA
 * scrolls past it. The block grows by 282px for every ancestor level (a ref
 * plus a name), so the deep registers outgrow the screen on their own:
 *
 *   Projects       362     Actions       1208
 *   Milestones     644     Sub-Actions   1490   ← past any normal viewport
 *   Results        926
 *
 * At that width there is no data left to scroll and the pinned cells simply
 * paint over the rest of the table — which reads as columns overlapping
 * rather than as a freeze.
 *
 * Two is the answer rather than a pixel budget because a freeze has to be a
 * CONTIGUOUS PREFIX: sticky cells are positioned against the scroll box, so
 * pinning the first and the last of the identity columns while the middle
 * scrolls would leave them stacked on top of each other. The rule is
 * therefore "how many levels of context stay visible", and the honest answer
 * on a deep register is the top two — which project, and which milestone.
 *
 * Shallow registers are unaffected: with two or fewer ancestors the whole
 * identity block is the prefix, so Projects, Milestones and Results still
 * pin their own ref and name as before.
 */
export const MAX_FROZEN_ANCESTORS = 2;

/**
 * Left offsets for one register's frozen columns, in render order:
 * tick, then a (ref, name) pair per ancestor, then own ref and own name.
 *
 * Each ancestor carries its own `frozen`, and `ownFrozen` says whether the
 * row's own ref and name are still inside the prefix. Everything past the
 * prefix scrolls with the data.
 */
export function freezeOffsets(level: RegisterLevel): {
  tick: number;
  ancestors: { ref: number; name: number; frozen: boolean }[];
  ownRef: number;
  ownName: number;
  ownFrozen: boolean;
  total: number;
} {
  const ancestorCount = ANCESTOR_KINDS[level].length;
  const frozenCount = Math.min(ancestorCount, MAX_FROZEN_ANCESTORS);

  let x = 0;
  const tick = x;
  x += FREEZE_WIDTH.tick;

  const ancestors: { ref: number; name: number; frozen: boolean }[] = [];
  for (let i = 0; i < ancestorCount; i++) {
    const ref = x;
    x += FREEZE_WIDTH.ref;
    const name = x;
    x += FREEZE_WIDTH.name;
    ancestors.push({ ref, name, frozen: i < frozenCount });
  }

  const ownRef = x;
  x += FREEZE_WIDTH.ref;
  const ownName = x;
  x += FREEZE_WIDTH.ownName;

  // Only when every ancestor is pinned — otherwise these would sit past a
  // scrolling gap and collide with the block on the way in.
  const ownFrozen = frozenCount === ancestorCount;

  return { tick, ancestors, ownRef, ownName, ownFrozen, total: x };
}
