"use client";

import * as React from "react";
import {
  getPlanBranchServerSnapshot,
  getPlanBranchSnapshot,
  rememberPlanBranch,
  resolvePlanBranch,
  subscribeToPlanBranch,
  type BranchNode,
  type PlanBranch,
} from "@/lib/plan/context";

/**
 * The last-accessed branch, re-derived against the live tree.
 *
 * `useSyncExternalStore` rather than a read-in-effect: it renders the server
 * snapshot during hydration and re-renders with the stored value, with no
 * mismatch warning and no cascading render — the same pattern the app's rails
 * use for their collapsed state.
 *
 * Two surfaces can be on one screen — the register's create row and the
 * board's — so every write fires a window event and both re-read. Without it,
 * opening a milestone from one would leave the other seeding the old one.
 */
export function usePlanBranch(tree: readonly BranchNode[]): {
  branch: PlanBranch;
  remember: (path: PlanBranch) => void;
} {
  const stored = React.useSyncExternalStore(
    subscribeToPlanBranch,
    getPlanBranchSnapshot,
    getPlanBranchServerSnapshot,
  );

  // Re-derived from the LIVE tree, so names come back fresh and deleted rows
  // fall out on their own.
  const branch = React.useMemo(
    () => resolvePlanBranch(tree, stored),
    [tree, stored],
  );

  // `rememberPlanBranch` fires the event the store subscribes to, so there is
  // nothing to set here — the snapshot updates itself.
  const remember = React.useCallback((path: PlanBranch) => {
    rememberPlanBranch(path);
  }, []);

  return { branch, remember };
}
