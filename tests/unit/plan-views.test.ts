import { describe, expect, it } from "vitest";
import type { PlanKind } from "@/lib/plan/levels";
import {
  expandableIds,
  flattenPlanTree,
  parseViewPath,
  resolveViewPath,
  selectAt,
  serialiseViewPath,
  type ViewNode,
} from "@/lib/plan/views";

function n(
  kind: PlanKind,
  id: string,
  name: string,
  children: ViewNode[] = [],
  description: string | null = null,
): ViewNode {
  return { id, name, kind, description, children };
}

/**
 *   P1 AICL WMS
 *     M1 Attendance
 *       RA Biometric feed
 *         A1 Vendor demo
 *         A2 Install readers
 *           SA2.1 Site survey
 *     M2 Payroll feed
 *   P2 Payroll
 */
function tree(): ViewNode[] {
  return [
    n("project", "p1", "AICL WMS", [
      n("milestone", "m1", "Attendance", [
        n("result", "ra", "Biometric feed", [
          n("action", "a1", "Vendor demo"),
          n("action", "a2", "Install readers", [
            n("sub_action", "sa1", "Site survey"),
          ]),
        ]),
      ]),
      n("milestone", "m2", "Payroll feed"),
    ]),
    n("project", "p2", "Payroll"),
  ];
}

describe("flattenPlanTree", () => {
  it("shows only the roots when nothing is expanded", () => {
    const lines = flattenPlanTree(tree(), new Set());
    expect(lines.map((l) => l.ref)).toEqual(["P1", "P2"]);
    expect(lines[0]!.childCount).toBe(2);
    expect(lines[0]!.expanded).toBe(false);
  });

  it("walks INTO a node only when its id is expanded", () => {
    // A thousand-row plan costs whatever is open and no more.
    const lines = flattenPlanTree(tree(), new Set(["p1"]));
    expect(lines.map((l) => l.ref)).toEqual(["P1", "M1", "M2", "P2"]);
  });

  it("renders the whole indented shape when everything is open", () => {
    const lines = flattenPlanTree(tree(), expandableIds(tree()));
    expect(lines.map((l) => `${"  ".repeat(l.depth)}${l.ref} ${l.node.name}`)).toEqual([
      "P1 AICL WMS",
      "  M1 Attendance",
      "    RA Biometric feed",
      "      A1 Vendor demo",
      "      A2 Install readers",
      "        SA2.1 Site survey",
      "  M2 Payroll feed",
      "P2 Payroll",
    ]);
  });

  it("carries depth, ancestor ids and isLast for the guides", () => {
    const lines = flattenPlanTree(tree(), expandableIds(tree()));
    const survey = lines.find((l) => l.node.id === "sa1")!;
    expect(survey.depth).toBe(4);
    expect(survey.ancestorIds).toEqual(["p1", "m1", "ra", "a2"]);
    expect(survey.isLast).toBe(true);
    expect(lines.find((l) => l.node.id === "m1")!.isLast).toBe(false);
    expect(lines.find((l) => l.node.id === "m2")!.isLast).toBe(true);
  });

  it("appends deep refs to the parent's", () => {
    const lines = flattenPlanTree(tree(), expandableIds(tree()));
    expect(lines.find((l) => l.node.id === "sa1")!.ref).toBe("SA2.1");
    expect(lines.find((l) => l.node.id === "sa1")!.fullRef).toBe("P1M1RAA2SA1");
  });

  it("counts ordinals per kind", () => {
    const mixed: ViewNode[] = [
      n("project", "p", "P", [
        n("milestone", "m1", "First"),
        n("result", "stray", "Stray"),
        n("milestone", "m2", "Second"),
      ]),
    ];
    const lines = flattenPlanTree(mixed, new Set(["p"]));
    expect(lines.map((l) => l.ref)).toEqual(["P1", "M1", "RA", "M2"]);
  });

  it("scopes to one root", () => {
    const lines = flattenPlanTree(tree(), new Set(["p1"]), { rootId: "p1" });
    expect(lines.map((l) => l.node.id)).toEqual(["p1", "m1", "m2"]);
  });

  it("keeps a match plus every ancestor, and force-opens the branch", () => {
    // A match hanging off nothing is unreachable.
    const lines = flattenPlanTree(tree(), new Set(), { query: "site survey" });
    expect(lines.map((l) => l.node.id)).toEqual(["p1", "m1", "ra", "a2", "sa1"]);
    expect(lines.every((l) => l.expanded || l.childCount === 0)).toBe(true);
  });

  it("matches the description too, and prunes the branches that miss", () => {
    const t = tree();
    (t[0]!.children[1] as ViewNode).description = "bank transfer file";
    const lines = flattenPlanTree(t, new Set(), { query: "bank transfer" });
    expect(lines.map((l) => l.node.id)).toEqual(["p1", "m2"]);
  });

  it("returns nothing when the search matches nothing", () => {
    expect(flattenPlanTree(tree(), new Set(), { query: "zzz" })).toEqual([]);
  });
});

describe("expandableIds", () => {
  it("names every node that has children, and no leaves", () => {
    const ids = expandableIds(tree());
    expect([...ids].sort()).toEqual(["a2", "m1", "p1", "ra"]);
    expect(ids.has("p2")).toBe(false);
    expect(ids.has("sa1")).toBe(false);
  });
});

describe("resolveViewPath — ids, never labels", () => {
  it("resolves each id among the CHILDREN of the level above", () => {
    const r = resolveViewPath(tree(), {
      projectId: "p1",
      milestoneId: "m1",
      resultId: "ra",
    });
    expect(r.crumbs.map((c) => `${c.ref} ${c.name}`)).toEqual([
      "P1 AICL WMS",
      "M1 Attendance",
      "RA Biometric feed",
    ]);
    expect(r.focus?.id).toBe("ra");
    expect(r.selection).toEqual({
      projectId: "p1",
      milestoneId: "m1",
      resultId: "ra",
    });
  });

  it("offers the rows available at each level", () => {
    const r = resolveViewPath(tree(), { projectId: "p1" });
    expect(r.levels[0]!.nodes.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(r.levels[1]!.nodes.map((x) => x.id)).toEqual(["m1", "m2"]);
  });

  it("TRUNCATES at a stale id rather than guessing", () => {
    // A milestone that is not under the named project — an old bookmark, a
    // deleted row, a moved branch. Everything deeper goes with it.
    const r = resolveViewPath(tree(), {
      projectId: "p1",
      milestoneId: "not-under-p1",
      resultId: "ra",
    });
    expect(r.selection).toEqual({ projectId: "p1" });
    expect(r.crumbs.map((c) => c.id)).toEqual(["p1"]);
    expect(r.focus?.id).toBe("p1");
  });

  it("truncates a milestone belonging to a DIFFERENT project", () => {
    // m1 is real, but it hangs off p1, not p2 — showing it under a P2
    // breadcrumb would be a breadcrumb that lies.
    const r = resolveViewPath(tree(), { projectId: "p2", milestoneId: "m1" });
    expect(r.selection).toEqual({ projectId: "p2" });
  });

  it("drops a deleted project entirely", () => {
    const r = resolveViewPath(tree(), { projectId: "gone", milestoneId: "m1" });
    expect(r.selection).toEqual({});
    expect(r.focus).toBeNull();
    expect(r.crumbs).toEqual([]);
  });

  it("lets the caller detect that the URL needs rewriting", () => {
    const input = { projectId: "p1", milestoneId: "stale" };
    const r = resolveViewPath(tree(), input);
    expect(r.selection).not.toEqual(input);
  });

  it("resolves an empty path to the project level", () => {
    const r = resolveViewPath(tree(), {});
    expect(r.levels).toHaveLength(1);
    expect(r.selection).toEqual({});
  });
});

describe("selectAt", () => {
  it("clears every level below", () => {
    const current = { projectId: "p1", milestoneId: "m1", resultId: "ra" };
    expect(selectAt(current, "milestone", "m2")).toEqual({
      projectId: "p1",
      milestoneId: "m2",
    });
  });

  it("COLLAPSES when the row already open is re-selected", () => {
    const current = { projectId: "p1", milestoneId: "m1" };
    expect(selectAt(current, "milestone", "m1")).toEqual({ projectId: "p1" });
  });

  it("re-rooting a project drops the whole chain", () => {
    const current = { projectId: "p1", milestoneId: "m1", resultId: "ra" };
    expect(selectAt(current, "project", "p2")).toEqual({ projectId: "p2" });
  });
});

describe("URL round-trip", () => {
  it("writes ?project=&m=&r=&a=", () => {
    const params = serialiseViewPath({
      projectId: "p1",
      milestoneId: "m1",
      resultId: "ra",
      actionId: "a2",
    });
    expect(params.toString()).toBe("project=p1&m=m1&r=ra&a=a2");
  });

  it("omits an absent level rather than writing an empty key", () => {
    // "?project=x&m=" reads as "a milestone was chosen and it is nothing",
    // which is not a state this path can be in.
    const params = serialiseViewPath({ projectId: "p1", milestoneId: null });
    expect(params.toString()).toBe("project=p1");
    expect(params.has("m")).toBe(false);
  });

  it("reads back what it wrote", () => {
    const path = { projectId: "p1", milestoneId: "m1" };
    expect(parseViewPath(serialiseViewPath(path))).toEqual(path);
    expect(parseViewPath(new URLSearchParams(""))).toEqual({});
  });
});
