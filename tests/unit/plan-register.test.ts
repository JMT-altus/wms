import { describe, expect, it } from "vitest";
import type { PlanKind } from "@/lib/plan/levels";
import {
  ANCESTOR_KINDS,
  FREEZE_WIDTH,
  LEVEL_KIND,
  REGISTER_LEVELS,
  ROLLUP_KIND,
  buildRegisterRows,
  freezeOffsets,
  isRegisterLevel,
  registerRowMatches,
  type RegisterNode,
} from "@/lib/plan/register";

function n(
  kind: PlanKind,
  id: string,
  name: string,
  children: RegisterNode[] = [],
  extra: Partial<RegisterNode> = {},
): RegisterNode {
  return {
    id,
    name,
    kind,
    progressPercent: null,
    taskStatus: null,
    children,
    ...extra,
  };
}

/**
 * Two projects. P1 has two milestones; P1/M1 has two results; P1/M1/RA has
 * three actions, one of them done. P2 has one milestone with one result.
 */
function tree(): RegisterNode[] {
  return [
    n("project", "p1", "AICL WMS", [
      n("milestone", "p1m1", "Attendance", [
        n("result", "p1m1ra", "Biometric feed", [
          n("action", "a1", "Vendor demo", [], { taskStatus: "done" }),
          n("action", "a2", "Install readers"),
          n("action", "a3", "Train staff"),
        ]),
        n("result", "p1m1rb", "Shift roster"),
      ]),
      n("milestone", "p1m2", "Payroll feed"),
    ]),
    n("project", "p2", "Payroll", [
      n("milestone", "p2m1", "Bank file", [n("result", "p2m1ra", "IFSC map")]),
    ]),
  ];
}

describe("the level tables", () => {
  it("names all five register routes", () => {
    expect([...REGISTER_LEVELS]).toEqual([
      "projects",
      "milestones",
      "results",
      "actions",
      "sub-actions",
    ]);
    expect(isRegisterLevel("results")).toBe(true);
    expect(isRegisterLevel("sub-sub-actions")).toBe(false);
    expect(isRegisterLevel(null)).toBe(false);
  });

  it("rolls up ALWAYS one level down", () => {
    // A milestone is measured by its results, a result by its actions.
    expect(ROLLUP_KIND.projects).toBe("milestone");
    expect(ROLLUP_KIND.milestones).toBe("result");
    expect(ROLLUP_KIND.results).toBe("action");
    expect(ROLLUP_KIND.actions).toBe("sub_action");
    expect(ROLLUP_KIND["sub-actions"]).toBe("sub_sub_action");
  });

  it("carries exactly the ancestors above the level", () => {
    expect(ANCESTOR_KINDS.projects).toEqual([]);
    expect(ANCESTOR_KINDS["sub-actions"]).toEqual([
      "project",
      "milestone",
      "result",
      "action",
    ]);
    for (const level of REGISTER_LEVELS) {
      expect(ANCESTOR_KINDS[level]).not.toContain(LEVEL_KIND[level]);
    }
  });
});

describe("buildRegisterRows", () => {
  it("lists every row of one kind, wherever it sits", () => {
    const rows = buildRegisterRows(tree(), "milestones");
    expect(rows.map((r) => r.node.name)).toEqual([
      "Attendance",
      "Payroll feed",
      "Bank file",
    ]);
  });

  it("RESTARTS numbering within each parent", () => {
    // The first milestone of P2 is M1, not M3 — that is what makes "P2 · M1" a
    // reference a person can use.
    const rows = buildRegisterRows(tree(), "milestones");
    expect(rows.map((r) => r.ownRef)).toEqual(["M1", "M2", "M1"]);
    expect(rows[2]!.ancestors[0]!.ref).toBe("P2");
  });

  it("carries the whole ancestor chain, outermost first", () => {
    const rows = buildRegisterRows(tree(), "actions");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.ancestors.map((a) => `${a.ref} ${a.name}`)).toEqual([
      "P1 AICL WMS",
      "M1 Attendance",
      "RA Biometric feed",
    ]);
  });

  it("builds the full ref by appending down the chain", () => {
    const rows = buildRegisterRows(tree(), "actions");
    expect(rows.map((r) => r.fullRef)).toEqual([
      "P1M1RAA1",
      "P1M1RAA2",
      "P1M1RAA3",
    ]);
  });

  it("SKIPS a row whose parent chain is the wrong shape", () => {
    // A Result directly under a Project has no milestone to name; inventing
    // one would put a false relationship on screen. The walk descends only the
    // exact chain, so the row is simply never reached.
    const malformed: RegisterNode[] = [
      n("project", "p1", "Orphan holder", [
        n("result", "loose", "Result with no milestone"),
        n("milestone", "m1", "Proper", [n("result", "ok", "Proper result")]),
      ]),
    ];
    const rows = buildRegisterRows(malformed, "results");
    expect(rows.map((r) => r.node.name)).toEqual(["Proper result"]);
  });

  it("counts ordinals per kind, so a stray row cannot shift M2 to M3", () => {
    const mixed: RegisterNode[] = [
      n("project", "p1", "P", [
        n("milestone", "m1", "First"),
        n("result", "stray", "Wrong level"),
        n("milestone", "m2", "Second"),
      ]),
    ];
    const rows = buildRegisterRows(mixed, "milestones");
    expect(rows.map((r) => r.ownRef)).toEqual(["M1", "M2"]);
  });

  it("gives each row the completion of its DIRECT children one level down", () => {
    const rows = buildRegisterRows(tree(), "results");
    const biometric = rows.find((r) => r.node.name === "Biometric feed")!;
    expect(biometric.rollup).toEqual({
      completed: 1,
      total: 3,
      fraction: 1 / 3,
    });
    const empty = rows.find((r) => r.node.name === "Shift roster")!;
    expect(empty.rollup.total).toBe(0);
  });

  it("lists the projects themselves with no ancestors", () => {
    const rows = buildRegisterRows(tree(), "projects");
    expect(rows.map((r) => r.ownRef)).toEqual(["P1", "P2"]);
    expect(rows[0]!.ancestors).toEqual([]);
    expect(rows[0]!.rollup.total).toBe(2);
  });

  it("returns nothing for a level with no rows", () => {
    expect(buildRegisterRows(tree(), "sub-actions")).toEqual([]);
    expect(buildRegisterRows([], "projects")).toEqual([]);
  });
});

describe("registerRowMatches", () => {
  const rows = buildRegisterRows(tree(), "actions");
  const vendor = rows[0]!;

  it("matches the row's own name", () => {
    expect(registerRowMatches(vendor, "vendor")).toBe(true);
  });

  it("matches an ANCESTOR by name", () => {
    // "AICL" is how people look for something whose own name they don't
    // remember.
    expect(registerRowMatches(vendor, "AICL")).toBe(true);
    expect(registerRowMatches(vendor, "attendance")).toBe(true);
  });

  it("matches an ancestor by REF", () => {
    expect(registerRowMatches(vendor, "M1")).toBe(true);
    expect(registerRowMatches(vendor, "RA")).toBe(true);
  });

  it("matches the row's own ref and full ref", () => {
    expect(registerRowMatches(vendor, "A1")).toBe(true);
    expect(registerRowMatches(vendor, "P1M1RAA1")).toBe(true);
  });

  it("keeps everything on an empty query and rejects a genuine miss", () => {
    expect(registerRowMatches(vendor, "")).toBe(true);
    expect(registerRowMatches(vendor, "   ")).toBe(true);
    expect(registerRowMatches(vendor, "payroll")).toBe(false);
  });
});

describe("freezeOffsets — cumulative sums of fixed widths", () => {
  it("offsets the projects register's two frozen columns", () => {
    // Positioned against the scroll box, not against the cell before it.
    const o = freezeOffsets("projects");
    expect(o.tick).toBe(0);
    expect(o.ancestors).toEqual([]);
    expect(o.ownRef).toBe(FREEZE_WIDTH.tick);
    expect(o.ownName).toBe(FREEZE_WIDTH.tick + FREEZE_WIDTH.ref);
  });

  it("accumulates one (ref, name) pair per ancestor", () => {
    const o = freezeOffsets("results");
    expect(o.ancestors).toHaveLength(2);
    expect(o.ancestors[0]).toEqual({ ref: 40, name: 132, frozen: true });
    expect(o.ancestors[1]).toEqual({ ref: 322, name: 414, frozen: true });
    expect(o.ownRef).toBe(604);
    expect(o.ownName).toBe(696);
    expect(o.total).toBe(926);
  });

  /**
   * The freeze is a CONTIGUOUS PREFIX, capped at two ancestor levels.
   *
   * Sub-Actions has four ancestors; pinning all of them plus its own identity
   * is 1490px, which is wider than the screen it has to leave room to scroll.
   * So the deep registers pin "which project, which milestone" and let the
   * rest travel with the data.
   */
  it("pins at most two ancestor levels, and never a gapped prefix", () => {
    for (const level of REGISTER_LEVELS) {
      const o = freezeOffsets(level);
      const flags = o.ancestors.map((a) => a.frozen);

      // At most two, and always the OUTERMOST two.
      expect(flags.filter(Boolean).length).toBeLessThanOrEqual(2);
      expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));

      // Own ref/name join the block only when nothing scrolls in between.
      expect(o.ownFrozen).toBe(flags.every(Boolean));
    }
  });

  it("pins tick + project + milestone on the deep registers", () => {
    for (const level of ["actions", "sub-actions"] as const) {
      const o = freezeOffsets(level);
      expect(o.ancestors.map((a) => a.frozen)).toEqual(
        o.ancestors.map((_, i) => i < 2),
      );
      expect(o.ownFrozen).toBe(false);
      // tick + two (ref, name) pairs — the block the screen can afford.
      const frozenWidth =
        FREEZE_WIDTH.tick + 2 * (FREEZE_WIDTH.ref + FREEZE_WIDTH.name);
      expect(frozenWidth).toBe(604);
    }
  });

  it("never overlaps two frozen columns at any level", () => {
    for (const level of REGISTER_LEVELS) {
      const o = freezeOffsets(level);
      const xs = [
        o.tick,
        ...o.ancestors.flatMap((a) => [a.ref, a.name]),
        o.ownRef,
        o.ownName,
      ];
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
      }
      expect(o.total).toBeGreaterThan(o.ownName);
    }
  });
});
