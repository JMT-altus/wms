/**
 * The last-accessed branch.
 *
 * "Bulk upload goes inside the project which was last opened — same with
 * results and actions and sub-actions."
 *
 * Stored as a CHAIN, not six independent ids. A remembered milestone that no
 * longer sits under the remembered project is worse than no memory at all — it
 * files work in the wrong place and looks deliberate doing it.
 *
 * localStorage, per browser, not per account: this is a convenience about
 * where you were a moment ago, not a preference worth a column and a
 * round-trip, and a cleared one costs a dropdown click.
 *
 * CLIENT-SAFE, and every read and write is wrapped — a private window, a full
 * quota or a hand-edited value must cost the default, not the screen.
 */

import { PARENT_KIND, type PlanKind } from "@/lib/plan/levels";

const STORAGE_KEY = "wms_plan_branch_v1";

/** Fired after every write so two surfaces on one screen agree. */
export const PLAN_BRANCH_EVENT = "wms:plan-branch";

/** The chain, outermost first. Each entry's parent is the entry before it. */
export interface PlanBranchLink {
  id: string;
  kind: PlanKind;
  /** Cached for a first paint; the live tree's name always wins on read. */
  name: string;
}

export type PlanBranch = PlanBranchLink[];

/** The minimum a tree node must expose for the chain to be re-derived. */
export interface BranchNode {
  id: string;
  name: string;
  kind: PlanKind;
  children: BranchNode[];
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

function readRaw(): PlanBranch {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is PlanBranchLink =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as PlanBranchLink).id === "string" &&
        typeof (l as PlanBranchLink).kind === "string",
    );
  } catch {
    // Private window, blocked site data, or somebody hand-edited the value.
    return [];
  }
}

function writeRaw(branch: PlanBranch): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(branch));
  } catch {
    // Full quota or blocked storage — the default costs a dropdown click.
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(PLAN_BRANCH_EVENT));
  } catch {
    // No CustomEvent (very old runtime) — the other surface refreshes on its
    // next render instead.
  }
}

/* ── Write ───────────────────────────────────────────────────────────────── */

/**
 * Remember the path to the row that was just touched.
 *
 * The caller passes the whole path from the project DOWN to that row; the
 * levels BELOW it are dropped, because opening a different milestone makes the
 * action you had open under the old one a stale answer.
 */
export function rememberPlanBranch(path: PlanBranch): void {
  const clean: PlanBranch = [];
  let expected: PlanKind | null = "project";
  for (const link of path) {
    // A chain with a hole in it is not a chain — stop at the first level that
    // does not follow the one before it.
    if (expected && link.kind !== expected) break;
    clean.push({ id: link.id, kind: link.kind, name: link.name });
    expected = childOf(link.kind);
  }
  writeRaw(clean);
}

function childOf(kind: PlanKind): PlanKind | null {
  for (const [child, parent] of Object.entries(PARENT_KIND)) {
    if (parent === kind) return child as PlanKind;
  }
  return null;
}

/** Forget everything — the "clear" on the seeded chip. */
export function clearPlanBranch(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(PLAN_BRANCH_EVENT));
  } catch {
    return;
  }
}

/* ── Read ────────────────────────────────────────────────────────────────── */

/**
 * Re-derive the stored chain against the LIVE tree rather than trusting
 * storage.
 *
 * Walks the stored chain from its DEEPEST link upwards and returns the path of
 * the first id that still exists — so deleting a sub-action falls back to its
 * action, and deleting the whole project falls back to nothing rather than to
 * a context full of ids that resolve to no row.
 *
 * Names come back FRESH off the tree; deleted rows fall out.
 */
export function resolvePlanBranch(
  tree: readonly BranchNode[],
  stored: PlanBranch = readRaw(),
): PlanBranch {
  for (let depth = stored.length; depth > 0; depth--) {
    const path = pathToId(tree, stored[depth - 1]!.id);
    if (path) return path;
  }
  return [];
}

/** The live path from a root down to `id`, with current names. */
function pathToId(
  tree: readonly BranchNode[],
  id: string,
): PlanBranch | null {
  for (const root of tree) {
    const found = search(root, []);
    if (found) return found;
  }
  return null;

  function search(node: BranchNode, trail: PlanBranch): PlanBranch | null {
    const here: PlanBranch = [
      ...trail,
      { id: node.id, kind: node.kind, name: node.name },
    ];
    if (node.id === id) return here;
    for (const child of node.children) {
      const hit = search(child, here);
      if (hit) return hit;
    }
    return null;
  }
}

/** Read the raw stored chain — exported for the hook that listens for writes. */
export function readStoredBranch(): PlanBranch {
  return readRaw();
}

/* ── An external store, so React can read this without an effect ─────────── */

/**
 * `useSyncExternalStore` calls `getSnapshot` on every render and loops if the
 * value is not referentially stable — so the parsed chain is cached against
 * the raw string it came from, and only re-parsed when that string changes.
 */
let cachedRaw: string | null | undefined;
let cachedBranch: PlanBranch = [];

/** The snapshot the browser reads. */
export function getPlanBranchSnapshot(): PlanBranch {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedBranch = readRaw();
  }
  return cachedBranch;
}

/** The server has no storage, so it renders the empty chain and hydrates clean. */
export function getPlanBranchServerSnapshot(): PlanBranch {
  return EMPTY_BRANCH;
}

const EMPTY_BRANCH: PlanBranch = [];

/** Our own writes, plus another tab writing the same key. */
export function subscribeToPlanBranch(onChange: () => void): () => void {
  window.addEventListener(PLAN_BRANCH_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PLAN_BRANCH_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/* ── Seeding the pickers ─────────────────────────────────────────────────── */

/**
 * Pre-fill the parent pickers for a new row of `kind`.
 *
 * STOPS AT THE FIRST LEVEL THE CONTEXT CANNOT SUPPLY: a chain with a hole in
 * it is not a chain, and a milestone id with no project above it sits in a
 * select whose options were never loaded.
 *
 * Returns one entry per ancestor level the new row needs, outermost first.
 */
export function seedAncestors(
  kind: PlanKind,
  branch: PlanBranch,
): PlanBranchLink[] {
  const needed: PlanKind[] = [];
  let parent = PARENT_KIND[kind];
  while (parent) {
    needed.unshift(parent);
    parent = PARENT_KIND[parent];
  }

  const seeded: PlanBranchLink[] = [];
  for (const level of needed) {
    const link = branch.find((l) => l.kind === level);
    if (!link) break; // a hole — everything below it is unusable
    seeded.push(link);
  }
  return seeded;
}
