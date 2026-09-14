import { describe, expect, it } from "vitest";
import {
  CHILD_KIND,
  KIND_DEPTH,
  LEVEL_STYLE,
  PARENT_KIND,
  PLAN_KINDS,
  combineDateTime,
  durationDays,
  formatDuration,
  formatPlanDate,
  fullRefFor,
  hasSchedule,
  hasTask,
  isContainer,
  isExecutable,
  isPlanKind,
  isValidChild,
  levelStyleProps,
  parseDuration,
  refFor,
  toHm,
  toLetters,
  toRoman,
  toYmd,
} from "@/lib/plan/levels";

/**
 * The level model is the one thing every plan surface agrees on — the browser
 * derives refs from it as rows move, and the server validates parent/child
 * pairs against the same tables. These tests pin each rule individually so a
 * change to one cannot quietly ride in on another.
 */

describe("the six levels", () => {
  it("runs Project → Sub-Sub-Action, depth = index", () => {
    expect(PLAN_KINDS).toEqual([
      "project",
      "milestone",
      "result",
      "action",
      "sub_action",
      "sub_sub_action",
    ]);
    PLAN_KINDS.forEach((k, i) => expect(KIND_DEPTH[k]).toBe(i));
  });

  it("CHILD_KIND and PARENT_KIND are exact inverses", () => {
    for (const kind of PLAN_KINDS) {
      const child = CHILD_KIND[kind];
      if (child) expect(PARENT_KIND[child]).toBe(kind);
      const parent = PARENT_KIND[kind];
      if (parent) expect(CHILD_KIND[parent]).toBe(kind);
    }
    expect(CHILD_KIND.sub_sub_action).toBeNull();
    expect(PARENT_KIND.project).toBeNull();
  });

  it("isValidChild accepts only the one legal pairing", () => {
    expect(isValidChild("project", "milestone")).toBe(true);
    expect(isValidChild("result", "action")).toBe(true);
    // A Result directly under a Project is the shape the registers refuse to
    // guess at — it has no milestone to name.
    expect(isValidChild("project", "result")).toBe(false);
    expect(isValidChild("milestone", "milestone")).toBe(false);
    expect(isValidChild("sub_sub_action", "sub_sub_action")).toBe(false);
  });

  it("isPlanKind rejects anything else", () => {
    expect(isPlanKind("milestone")).toBe(true);
    expect(isPlanKind("task")).toBe(false);
    expect(isPlanKind(null)).toBe(false);
    expect(isPlanKind(undefined)).toBe(false);
  });
});

describe("the three predicates are NOT the same set", () => {
  it("hasTask includes Result; isExecutable does not", () => {
    // This is the distinction the whole module rests on: a Result gets a task
    // AND keeps derived progress. Collapsing the two would make a container's
    // progress a self-report competing with its own children.
    expect(hasTask("result")).toBe(true);
    expect(isExecutable("result")).toBe(false);
    expect(isContainer("result")).toBe(true);
  });

  it("the three executables are all three things", () => {
    for (const k of ["action", "sub_action", "sub_sub_action"] as const) {
      expect(isExecutable(k)).toBe(true);
      expect(hasTask(k)).toBe(true);
      expect(hasSchedule(k)).toBe(true);
      expect(isContainer(k)).toBe(false);
    }
  });

  it("Project and Milestone carry no task and no schedule of their own", () => {
    for (const k of ["project", "milestone"] as const) {
      expect(hasTask(k)).toBe(false);
      expect(hasSchedule(k)).toBe(false);
      expect(isExecutable(k)).toBe(false);
      expect(isContainer(k)).toBe(true);
    }
  });

  it("hasSchedule covers everything except those two", () => {
    expect(hasSchedule("result")).toBe(true);
    expect(hasSchedule("project")).toBe(false);
    expect(hasSchedule("milestone")).toBe(false);
  });
});

describe("toLetters / toRoman", () => {
  it("counts spreadsheet-style, 1-based", () => {
    expect(toLetters(1)).toBe("A");
    expect(toLetters(26)).toBe("Z");
    expect(toLetters(27)).toBe("AA");
    expect(toLetters(28)).toBe("AB");
    expect(toLetters(52)).toBe("AZ");
    expect(toLetters(53)).toBe("BA");
  });

  it("returns empty rather than hanging on a bad index", () => {
    expect(toLetters(0)).toBe("");
    expect(toLetters(-4)).toBe("");
    expect(toLetters(Number.NaN)).toBe("");
    expect(toRoman(0)).toBe("");
    expect(toRoman(-1)).toBe("");
    expect(toRoman(Number.NaN)).toBe("");
  });

  it("writes roman numerals", () => {
    expect(toRoman(1)).toBe("I");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(9)).toBe("IX");
    expect(toRoman(14)).toBe("XIV");
    expect(toRoman(2026)).toBe("MMXXVI");
  });
});

describe("refFor — the short label", () => {
  it("numbers the top four levels", () => {
    expect(refFor("project", 1)).toBe("P1");
    expect(refFor("project", 3)).toBe("P3");
    expect(refFor("milestone", 2)).toBe("M2");
    expect(refFor("result", 1)).toBe("RA");
    expect(refFor("result", 4)).toBe("RD");
    expect(refFor("result", 27)).toBe("RAA");
    expect(refFor("action", 1)).toBe("A1");
  });

  it("APPENDS to the parent's ref at the deep levels", () => {
    // Strip the letter prefix off "A3" to get 3, then ".1". A renumber high in
    // the tree flows all the way down for free.
    expect(refFor("sub_action", 1, "A3")).toBe("SA3.1");
    expect(refFor("sub_action", 2, "A3")).toBe("SA3.2");
    expect(refFor("sub_sub_action", 1, "SA3.1")).toBe("SSA3.1.1");
    expect(refFor("sub_sub_action", 4, "SA3.2")).toBe("SSA3.2.4");
  });

  it("falls back to a bare ordinal with no parent ref", () => {
    // A row whose ancestor was archived out from under it still has to render.
    expect(refFor("sub_action", 2, null)).toBe("SA2");
    expect(refFor("sub_sub_action", 5)).toBe("SSA5");
  });

  it("clamps a bad index instead of emitting nonsense", () => {
    expect(refFor("project", 0)).toBe("P1");
    expect(refFor("action", Number.NaN)).toBe("A1");
  });
});

describe("fullRefFor — the traceability path", () => {
  it("concatenates every ancestor's segment", () => {
    const p = fullRefFor("project", 3);
    const m = fullRefFor("milestone", 3, p);
    const r = fullRefFor("result", 4, m);
    const a = fullRefFor("action", 5, r);
    const sa = fullRefFor("sub_action", 1, a);
    expect(p).toBe("P3");
    expect(m).toBe("P3M3");
    expect(r).toBe("P3M3RD");
    expect(a).toBe("P3M3RDA5");
    expect(sa).toBe("P3M3RDA5SA1");
  });

  it("uses this row's own ordinal, not the parent's path", () => {
    // Unlike refFor, a full ref already carries the ancestors, so the segment
    // is just this row's number.
    expect(fullRefFor("sub_action", 2, "P1M1RAA3")).toBe("P1M1RAA3SA2");
  });

  it("stands alone with no parent", () => {
    expect(fullRefFor("milestone", 2)).toBe("M2");
  });
});

describe("parseDuration", () => {
  it("reads every shape a person types", () => {
    expect(parseDuration("2h 30m")).toBe(150);
    expect(parseDuration("2 h 30 m")).toBe(150);
    expect(parseDuration("2:30")).toBe(150);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("2 hours 30 mins")).toBe(150);
    expect(parseDuration("0:45")).toBe(45);
  });

  it("returns null for blank AND for unreadable", () => {
    // Both clear the field. A bad string must never silently store a wrong
    // number — an estimate that quietly became 2 because someone typed
    // "two hours" is worse than an empty one.
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration("two hours")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("-30")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("drops the empty half", () => {
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(0)).toBe("0m");
  });

  it("is empty for absent", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });

  it("round-trips with parseDuration", () => {
    for (const m of [15, 45, 60, 90, 150, 480]) {
      expect(parseDuration(formatDuration(m))).toBe(m);
    }
  });
});

describe("dates are local, never UTC", () => {
  it("toYmd reads local getters", () => {
    // 00:30 local. toISOString() would move this to the previous day anywhere
    // east of UTC; toYmd must not.
    const d = new Date(2026, 5, 12, 0, 30);
    expect(toYmd(d)).toBe("2026-06-12");
    const late = new Date(2026, 5, 12, 23, 45);
    expect(toYmd(late)).toBe("2026-06-12");
  });

  it("toYmd is empty for absent or invalid", () => {
    expect(toYmd(null)).toBe("");
    expect(toYmd(new Date("nonsense"))).toBe("");
  });

  it("toHm pads both halves", () => {
    expect(toHm(new Date(2026, 5, 12, 9, 5))).toBe("09:05");
    expect(toHm(new Date(2026, 5, 12, 18, 30))).toBe("18:30");
    expect(toHm(null)).toBe("");
  });

  it("combineDateTime builds a local Date", () => {
    const d = combineDateTime("2026-06-12", "14:30");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(12);
    expect(d?.getHours()).toBe(14);
    expect(d?.getMinutes()).toBe(30);
  });

  it("combineDateTime is null with no date — a time alone is not a moment", () => {
    expect(combineDateTime(null, "14:30")).toBeNull();
    expect(combineDateTime("", "14:30")).toBeNull();
    expect(combineDateTime("not-a-date")).toBeNull();
  });

  it("combineDateTime defaults to midnight local", () => {
    const d = combineDateTime("2026-06-12");
    expect(d?.getHours()).toBe(0);
    expect(d?.getDate()).toBe(12);
  });

  it("formatPlanDate reads a bare YYYY-MM-DD as a LOCAL day", () => {
    // new Date("2026-06-12") is UTC midnight and renders as the 11th west of
    // Greenwich. This is the bug the hand-parse exists to avoid.
    expect(formatPlanDate("2026-06-12")).toBe("12-Jun-2026");
    expect(formatPlanDate(new Date(2026, 0, 5))).toBe("05-Jan-2026");
    expect(formatPlanDate(null)).toBe("");
    expect(formatPlanDate("")).toBe("");
  });
});

describe("durationDays — inclusive of both ends", () => {
  it("counts same-day as 1, not 0", () => {
    expect(durationDays("2026-06-12", "2026-06-12")).toBe(1);
  });

  it("counts calendar days, not elapsed hours", () => {
    // 18:00 on the 1st → 09:00 on the 3rd is 3 days, not "2.6 rounded".
    const start = new Date(2026, 5, 1, 18, 0);
    const end = new Date(2026, 5, 3, 9, 0);
    expect(durationDays(start, end)).toBe(3);
  });

  it("counts a plain range", () => {
    expect(durationDays("2026-06-01", "2026-06-10")).toBe(10);
  });

  it("is null unless both ends are known", () => {
    expect(durationDays("2026-06-01", null)).toBeNull();
    expect(durationDays(null, "2026-06-10")).toBeNull();
    expect(durationDays(null, null)).toBeNull();
  });
});

describe("LEVEL_STYLE", () => {
  it("steps down in size and settles the weight after Milestone", () => {
    // The STEPS are the design. Sizes never increase going down the tree.
    const sizes = PLAN_KINDS.map((k) => LEVEL_STYLE[k].size);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]!);
    }
    expect(LEVEL_STYLE.project.weight).toBe(700);
    expect(LEVEL_STYLE.milestone.weight).toBe(700);
    expect(LEVEL_STYLE.result.weight).toBe(400);
  });

  it("caps only the two container headings", () => {
    expect(LEVEL_STYLE.project.caps).toBe(true);
    expect(LEVEL_STYLE.milestone.caps).toBe(true);
    expect(LEVEL_STYLE.result.caps).toBe(false);
    expect(LEVEL_STYLE.action.caps).toBe(false);
  });

  it("exports CSS props — caps is text-transform, never a rewrite", () => {
    // The stored name keeps the case its author typed, so search, the edit box
    // and the export still show "AICL WMS" as written.
    //
    // `fontSize` is read from LEVEL_STYLE rather than written out: the absolute
    // sizes are explicitly NOT the design (the steps between them are — see the
    // ramp test above), and the whole module moved up a point in one pass. A
    // number typed in here would have failed that change for no reason.
    expect(levelStyleProps("project")).toEqual({
      fontSize: LEVEL_STYLE.project.size,
      fontWeight: 700,
      fontStyle: "italic",
      textTransform: "uppercase",
    });
    expect(levelStyleProps("action").textTransform).toBe("none");
    expect(levelStyleProps("sub_sub_action").fontStyle).toBe("italic");
  });
});
