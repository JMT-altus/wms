import { describe, expect, it } from "vitest";
import { KIND_LABEL, KIND_LABEL_PLURAL, type PlanKind } from "@/lib/plan/levels";
import {
  childCompletion,
  describeChildren,
  describeProgress,
  executableLeaves,
  formatCompleted,
  formatCompletion,
  nodeFraction,
  ownChildCompletion,
  projectFraction,
  toPercent,
  type ProgressNode,
} from "@/lib/plan/progress";

const label = (kind: PlanKind, plural: boolean) =>
  plural ? KIND_LABEL_PLURAL[kind] : KIND_LABEL[kind];

function node(
  kind: PlanKind,
  opts: {
    progressPercent?: number | null;
    taskStatus?: string | null;
    children?: ProgressNode[];
  } = {},
): ProgressNode {
  return {
    kind,
    progressPercent: opts.progressPercent ?? null,
    taskStatus: opts.taskStatus ?? null,
    children: opts.children ?? [],
  };
}

/** N actions under a result, the first `done` of them ticked. */
function actions(total: number, done: number): ProgressNode[] {
  return Array.from({ length: total }, (_, i) =>
    node("action", { taskStatus: i < done ? "done" : "not_started" }),
  );
}

describe("executableLeaves", () => {
  it("returns the executable descendants and never a container", () => {
    const project = node("project", {
      children: [
        node("milestone", {
          children: [node("result", { children: actions(3, 1) })],
        }),
      ],
    });
    const leaves = executableLeaves(project);
    expect(leaves).toHaveLength(3);
    expect(leaves.every((l) => l.kind === "action")).toBe(true);
  });

  it("includes the node itself when it is a bare executable", () => {
    const a = node("action", { taskStatus: "done" });
    expect(executableLeaves(a)).toEqual([a]);
  });

  it("measures a sub-divided action by its children, not twice", () => {
    // The parent is skipped as a leaf the moment it has executable children.
    const parent = node("action", {
      taskStatus: "done",
      children: [
        node("sub_action", { taskStatus: "done" }),
        node("sub_action", { taskStatus: "not_started" }),
      ],
    });
    const leaves = executableLeaves(parent);
    expect(leaves).toHaveLength(2);
    expect(leaves.every((l) => l.kind === "sub_action")).toBe(true);
    // …so it reads 1/2, not 2/3 with the parent counted alongside its own work.
    expect(nodeFraction(parent)).toBe(0.5);
  });

  it("never counts a container as a denominator", () => {
    // Otherwise a milestone would gain progress just by being subdivided.
    const m = node("milestone", {
      children: [node("result"), node("result"), node("result")],
    });
    expect(executableLeaves(m)).toHaveLength(0);
    expect(nodeFraction(m)).toBe(0);
  });
});

describe("nodeFraction — the order of preference", () => {
  it("1. a recorded percent WINS over the derived number", () => {
    // Someone looked at the milestone and said "this is 40% there"; a derived
    // number must not silently overrule a human judgement.
    const m = node("milestone", {
      progressPercent: 40,
      children: [node("result", { children: actions(4, 4) })],
    });
    expect(nodeFraction(m)).toBeCloseTo(0.4);
  });

  it("honours a recorded 0 — it is a judgement, not an absence", () => {
    const m = node("milestone", {
      progressPercent: 0,
      children: [node("result", { children: actions(2, 2) })],
    });
    expect(nodeFraction(m)).toBe(0);
  });

  it("2. otherwise done ÷ total over the executable leaves", () => {
    const m = node("milestone", {
      children: [node("result", { children: actions(4, 1) })],
    });
    expect(nodeFraction(m)).toBe(0.25);
  });

  it("3. a bare executable is 1 or 0 from its task status", () => {
    expect(nodeFraction(node("action", { taskStatus: "done" }))).toBe(1);
    expect(nodeFraction(node("action", { taskStatus: "follow_up" }))).toBe(0);
    expect(nodeFraction(node("action", { taskStatus: null }))).toBe(0);
  });

  it("only `done` counts — a verdict is not progress", () => {
    expect(nodeFraction(node("action", { taskStatus: "approved" }))).toBe(0);
    expect(nodeFraction(node("action", { taskStatus: "cancelled" }))).toBe(0);
  });

  it("4. a container with neither is 0, not unknown", () => {
    // An empty milestone has genuinely delivered nothing.
    expect(nodeFraction(node("milestone"))).toBe(0);
    expect(nodeFraction(node("project"))).toBe(0);
  });

  it("clamps a nonsense override rather than reporting 400%", () => {
    expect(nodeFraction(node("milestone", { progressPercent: 400 }))).toBe(1);
    expect(nodeFraction(node("milestone", { progressPercent: -20 }))).toBe(0);
  });
});

describe("childCompletion — a sum of fractions, not a count", () => {
  it("10 milestones, one half done → 3.5 / 10", () => {
    const children = [
      ...Array.from({ length: 3 }, () =>
        node("milestone", { progressPercent: 100 }),
      ),
      node("milestone", { progressPercent: 50 }),
      ...Array.from({ length: 6 }, () => node("milestone")),
    ];
    const c = childCompletion(node("project", { children }), "milestone");
    expect(c.completed).toBe(3.5);
    expect(c.total).toBe(10);
    expect(formatCompletion(c)).toBe("3.5/10");
  });

  it("8 milestones, one a quarter done → 2.25 / 8", () => {
    const children = [
      ...Array.from({ length: 2 }, () =>
        node("milestone", { progressPercent: 100 }),
      ),
      node("milestone", { progressPercent: 25 }),
      ...Array.from({ length: 5 }, () => node("milestone")),
    ];
    const c = childCompletion(node("project", { children }), "milestone");
    expect(c.completed).toBe(2.25);
    expect(formatCompletion(c)).toBe("2.25/8");
  });

  it("4 milestones, three-quarters done → 1.75 / 4", () => {
    const children = [
      node("milestone", { progressPercent: 100 }),
      node("milestone", { progressPercent: 75 }),
      node("milestone"),
      node("milestone"),
    ];
    const c = childCompletion(node("project", { children }), "milestone");
    expect(c.completed).toBe(1.75);
    expect(formatCompletion(c)).toBe("1.75/4");
  });

  it("7 milestones, one 40% done → 4.4 / 7", () => {
    const children = [
      ...Array.from({ length: 4 }, () =>
        node("milestone", { progressPercent: 100 }),
      ),
      node("milestone", { progressPercent: 40 }),
      node("milestone"),
      node("milestone"),
    ];
    const c = childCompletion(node("project", { children }), "milestone");
    expect(c.completed).toBeCloseTo(4.4, 10);
    expect(formatCompletion(c)).toBe("4.4/7");
  });

  it("counts only the named kind, never a stray row of another", () => {
    const p = node("project", {
      children: [
        node("milestone", { progressPercent: 100 }),
        node("action", { taskStatus: "done" }),
      ],
    });
    expect(childCompletion(p, "milestone").total).toBe(1);
  });

  it("is 0 of 0 with nothing underneath — no flattering guess", () => {
    const c = childCompletion(node("project"), "milestone");
    expect(c).toEqual({ completed: 0, total: 0, fraction: 0 });
    expect(childCompletion(node("sub_sub_action"), null).total).toBe(0);
  });

  it("ownChildCompletion reads the kind off CHILD_KIND", () => {
    // A project counts milestones, a milestone counts results, a result counts
    // actions — one function, only the kind changes.
    const result = node("result", { children: actions(4, 1) });
    expect(ownChildCompletion(result)).toEqual({
      completed: 1,
      total: 4,
      fraction: 0.25,
    });
    expect(ownChildCompletion(node("sub_sub_action")).total).toBe(0);
  });
});

describe("rounding happens ONCE, at display", () => {
  it("keeps two decimals, drops trailing zeros", () => {
    // One decimal would round 2.25 to 2.3 — exactly the bug.
    expect(formatCompleted(3.5)).toBe("3.5");
    expect(formatCompleted(2.25)).toBe("2.25");
    expect(formatCompleted(3)).toBe("3");
    expect(formatCompleted(4.4)).toBe("4.4");
    expect(formatCompleted(1.75)).toBe("1.75");
    expect(formatCompleted(0)).toBe("0");
  });

  it("does not round on the way through", () => {
    // Three milestones at a third each sum to exactly 1, not 0.33 × 3 = 0.99.
    const children = Array.from({ length: 3 }, () =>
      node("milestone", { progressPercent: 33 }),
    );
    const c = childCompletion(node("project", { children }), "milestone");
    expect(c.completed).toBeCloseTo(0.99, 10);
    expect(formatCompleted(c.completed)).toBe("0.99");
  });

  it("toPercent is a whole percent, display only", () => {
    expect(toPercent(0.35)).toBe(35);
    expect(toPercent(0.355)).toBe(36);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(Number.NaN)).toBe(0);
  });
});

describe("projectFraction", () => {
  it("is the milestone completion when there are milestones", () => {
    const p = node("project", {
      children: [
        node("milestone", { progressPercent: 50 }),
        node("milestone"),
      ],
    });
    expect(projectFraction(p)).toBe(0.25);
  });

  it("falls back to its own executable rows when there are none", () => {
    // A small project run as a flat list of actions still reports something
    // true rather than 0.
    const p = node("project", { children: actions(4, 2) });
    expect(projectFraction(p)).toBe(0.5);
  });
});

describe("describeProgress / describeChildren", () => {
  it("reads the noun off CHILD_KIND rather than writing it out four times", () => {
    const p = node("project", {
      children: [
        node("milestone", { progressPercent: 100 }),
        node("milestone", { progressPercent: 100 }),
        node("milestone", { progressPercent: 100 }),
        node("milestone", { progressPercent: 50 }),
        ...Array.from({ length: 6 }, () => node("milestone")),
      ],
    });
    expect(describeProgress(p, label)).toBe(
      "35% | 3.5/10 | 3.5 out of 10 milestones are completed",
    );
  });

  it("names the level below, whatever level that is", () => {
    const r = node("result", { children: actions(3, 1) });
    expect(describeChildren(r, label)).toBe("1 out of 3 actions");
    const m = node("milestone", {
      children: [node("result", { children: actions(2, 1) })],
    });
    expect(describeChildren(m, label)).toBe("0.5 out of 1 result");
  });

  it("says nothing when there is nothing underneath", () => {
    expect(describeChildren(node("milestone"), label)).toBeNull();
    expect(describeChildren(node("sub_sub_action"), label)).toBeNull();
    expect(describeProgress(node("project"), label)).toBe("0%");
  });
});

describe("the worked end-to-end example from the spec", () => {
  it("a milestone recorded at 50% makes the project read 3.5/10", () => {
    // Tick one of three actions done and the milestone reads 1/3 without
    // anyone typing a number; record it at 50% and the project reads 3.5/10.
    const half = node("milestone", {
      progressPercent: 50,
      children: [node("result", { children: actions(3, 1) })],
    });
    const derivedOnly = node("milestone", {
      children: [node("result", { children: actions(3, 1) })],
    });
    expect(formatCompletion(ownChildCompletion(derivedOnly.children[0]!))).toBe(
      "1/3",
    );

    const project = node("project", {
      children: [
        node("milestone", { progressPercent: 100 }),
        node("milestone", { progressPercent: 100 }),
        node("milestone", { progressPercent: 100 }),
        half,
        ...Array.from({ length: 6 }, () => node("milestone")),
      ],
    });
    expect(formatCompletion(ownChildCompletion(project))).toBe("3.5/10");
    expect(toPercent(projectFraction(project))).toBe(35);
  });
});
