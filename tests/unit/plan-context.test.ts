import { describe, expect, it } from "vitest";
import type { PlanKind } from "@/lib/plan/levels";
import {
  resolvePlanBranch,
  seedAncestors,
  type BranchNode,
  type PlanBranch,
} from "@/lib/plan/context";

function n(
  kind: PlanKind,
  id: string,
  name: string,
  children: BranchNode[] = [],
): BranchNode {
  return { id, name, kind, children };
}

const tree: BranchNode[] = [
  n("project", "p1", "AICL WMS", [
    n("milestone", "m1", "Attendance", [
      n("result", "ra", "Biometric feed", [
        n("action", "a1", "Install readers", [n("sub_action", "sa1", "Site survey")]),
      ]),
    ]),
  ]),
  n("project", "p2", "Payroll"),
];

const fullChain: PlanBranch = [
  { id: "p1", kind: "project", name: "AICL WMS" },
  { id: "m1", kind: "milestone", name: "Attendance" },
  { id: "ra", kind: "result", name: "Biometric feed" },
  { id: "a1", kind: "action", name: "Install readers" },
];

describe("resolvePlanBranch — re-derived from the LIVE tree", () => {
  it("returns the live path to the deepest remembered row", () => {
    expect(resolvePlanBranch(tree, fullChain).map((l) => l.id)).toEqual([
      "p1",
      "m1",
      "ra",
      "a1",
    ]);
  });

  it("takes names FRESH off the tree, not out of storage", () => {
    const stale: PlanBranch = [{ id: "p1", kind: "project", name: "Old name" }];
    expect(resolvePlanBranch(tree, stale)[0]!.name).toBe("AICL WMS");
  });

  it("falls back UPWARDS when the deepest row is gone", () => {
    // Deleting a sub-action falls back to its action.
    const chain: PlanBranch = [
      ...fullChain,
      { id: "deleted-sa", kind: "sub_action", name: "Gone" },
    ];
    expect(resolvePlanBranch(tree, chain).map((l) => l.id)).toEqual([
      "p1",
      "m1",
      "ra",
      "a1",
    ]);
  });

  it("falls back several levels at once", () => {
    const chain: PlanBranch = [
      { id: "p1", kind: "project", name: "AICL WMS" },
      { id: "gone-m", kind: "milestone", name: "Gone" },
      { id: "gone-r", kind: "result", name: "Gone" },
    ];
    expect(resolvePlanBranch(tree, chain).map((l) => l.id)).toEqual(["p1"]);
  });

  it("falls back to NOTHING when the whole project is gone", () => {
    // Rather than a context full of ids that resolve to no row.
    const chain: PlanBranch = [
      { id: "deleted-p", kind: "project", name: "Gone" },
      { id: "deleted-m", kind: "milestone", name: "Gone" },
    ];
    expect(resolvePlanBranch(tree, chain)).toEqual([]);
  });

  it("is empty with nothing stored", () => {
    expect(resolvePlanBranch(tree, [])).toEqual([]);
  });

  it("rebuilds the true path even if storage recorded a wrong one", () => {
    // The tree is the authority: the path comes from where the row actually
    // sits, not from what was written down.
    const wrong: PlanBranch = [
      { id: "p2", kind: "project", name: "Payroll" },
      { id: "m1", kind: "milestone", name: "Attendance" },
    ];
    expect(resolvePlanBranch(tree, wrong).map((l) => l.id)).toEqual(["p1", "m1"]);
  });
});

describe("seedAncestors", () => {
  const branch = resolvePlanBranch(tree, fullChain);

  it("fills every level a new row needs", () => {
    // A Sub-Action asks Project → Milestone → Result → Action.
    expect(seedAncestors("sub_action", branch).map((l) => l.id)).toEqual([
      "p1",
      "m1",
      "ra",
      "a1",
    ]);
  });

  it("asks a Milestone for a Project only", () => {
    expect(seedAncestors("milestone", branch).map((l) => l.id)).toEqual(["p1"]);
  });

  it("asks a Project for nothing", () => {
    expect(seedAncestors("project", branch)).toEqual([]);
  });

  it("STOPS at the first level the context cannot supply", () => {
    // A chain with a hole in it is not a chain — a milestone id with no
    // project above it sits in a select whose options were never loaded.
    const holed: PlanBranch = [
      { id: "m1", kind: "milestone", name: "Attendance" },
      { id: "ra", kind: "result", name: "Biometric feed" },
    ];
    expect(seedAncestors("action", holed)).toEqual([]);
  });

  it("seeds as far as the chain reaches and no further", () => {
    const partial: PlanBranch = [{ id: "p1", kind: "project", name: "AICL WMS" }];
    expect(seedAncestors("action", partial).map((l) => l.id)).toEqual(["p1"]);
  });

  it("seeds nothing from an empty branch", () => {
    expect(seedAncestors("sub_action", [])).toEqual([]);
  });
});
