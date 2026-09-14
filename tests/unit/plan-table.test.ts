import { describe, expect, it } from "vitest";
import type { PlanKind } from "@/lib/plan/levels";
import {
  countPlan,
  flattenTable,
  initialExpanded,
  planCsv,
  planCsvName,
  sortRows,
  type TableNode,
} from "@/lib/plan/table";

function n(
  kind: PlanKind,
  id: string,
  name: string,
  children: TableNode[] = [],
  extra: Partial<TableNode> = {},
): TableNode {
  return { id, name, kind, children, ...extra };
}

function tree(): TableNode[] {
  return [
    n("project", "p1", "AICL WMS", [
      n("milestone", "m1", "Attendance", [
        n("result", "ra", "Biometric feed", [
          n("action", "a1", "Vendor demo", [], { task: { id: "t1" }, ownerId: "e1" }),
          n("action", "a2", "Install readers"),
        ]),
      ]),
      n("milestone", "m2", "Payroll feed"),
    ], { ownerId: "owner-1", ownerName: "Manan Vasa" }),
    n("project", "p2", "Payroll"),
  ];
}

describe("flattenTable", () => {
  it("shows the roots when nothing is expanded", () => {
    const rows = flattenTable(tree(), { expanded: new Set() });
    expect(rows.map((r) => r.ref)).toEqual(["P1", "P2"]);
    expect(rows[0]!.hasChildren).toBe(true);
    expect(rows[0]!.expanded).toBe(false);
  });

  it("walks into an expanded node only", () => {
    const rows = flattenTable(tree(), { expanded: new Set(["p1"]) });
    expect(rows.map((r) => r.ref)).toEqual(["P1", "M1", "M2", "P2"]);
  });

  it("carries depth, ancestor ids and the ancestor OWNER ids", () => {
    // The owner chain is what lets the client derive isOwner without a
    // round-trip: a project owner rules on the whole plan.
    const rows = flattenTable(tree(), { expanded: new Set(["p1", "m1", "ra"]) });
    const vendor = rows.find((r) => r.node.id === "a1")!;
    expect(vendor.depth).toBe(3);
    expect(vendor.ancestorIds).toEqual(["p1", "m1", "ra"]);
    expect(vendor.ancestorOwnerIds).toEqual(["owner-1", null, null]);
  });

  it("builds a readable Path for the export", () => {
    const rows = flattenTable(tree(), { expanded: new Set(["p1", "m1", "ra"]) });
    expect(rows.find((r) => r.node.id === "a1")!.path).toBe(
      "AICL WMS / Attendance / Biometric feed",
    );
    expect(rows[0]!.path).toBe("");
  });

  it("scopes to one project", () => {
    const rows = flattenTable(tree(), { expanded: new Set(), projectId: "p2" });
    expect(rows.map((r) => r.node.id)).toEqual(["p2"]);
  });
});

describe("search keeps the context of a hit", () => {
  it("keeps a matching row PLUS every ancestor", () => {
    // A filter that hides the parents of a hit removes its context.
    const rows = flattenTable(tree(), { expanded: new Set(), query: "vendor" });
    expect(rows.map((r) => r.node.id)).toEqual(["p1", "m1", "ra", "a1"]);
  });

  it("keeps a parent whose CHILD matches, even with the parent collapsed", () => {
    const rows = flattenTable(tree(), { expanded: new Set(), query: "install" });
    expect(rows.map((r) => r.node.name)).toEqual([
      "AICL WMS",
      "Attendance",
      "Biometric feed",
      "Install readers",
    ]);
  });

  it("matches the owner's name too", () => {
    const rows = flattenTable(tree(), { expanded: new Set(), query: "manan" });
    expect(rows.map((r) => r.node.id)).toEqual(["p1"]);
  });

  it("returns nothing on a genuine miss", () => {
    expect(flattenTable(tree(), { expanded: new Set(), query: "zzz" })).toEqual([]);
  });

  it("renumbers refs against the rows actually shown", () => {
    const rows = flattenTable(tree(), { expanded: new Set(), query: "payroll feed" });
    // M2 is the only milestone kept, so it is the first one on screen.
    expect(rows.map((r) => `${r.ref} ${r.node.name}`)).toEqual([
      "P1 AICL WMS",
      "M1 Payroll feed",
    ]);
  });
});

describe("sortRows", () => {
  const rows: TableNode[] = [
    n("milestone", "b", "Beta", [], { targetDate: "2026-08-01", ownerName: "Zara" }),
    n("milestone", "a", "Alpha", [], { targetDate: null, ownerName: null }),
    n("milestone", "c", "Gamma", [], { targetDate: "2026-06-01", ownerName: "Amit" }),
  ];

  it("leaves plan order alone", () => {
    expect(sortRows(rows, "plan").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by name, case-insensitively", () => {
    expect(sortRows(rows, "name").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("puts UNDATED rows LAST on the target sort", () => {
    // They are the ones without a commitment yet; burying the dated work under
    // them is the wrong way round.
    expect(sortRows(rows, "target").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("puts ownerless rows last on the owner sort", () => {
    expect(sortRows(rows, "owner").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input", () => {
    const input = [...rows];
    sortRows(input, "name");
    expect(input.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
});

describe("countPlan — over the WHOLE tree", () => {
  it("counts every level regardless of what is expanded", () => {
    // Results start collapsed, so counting rendered rows would report
    // "0 Actions" on a plan full of them.
    const c = countPlan(tree());
    expect(c).toEqual({
      total: 7,
      projects: 2,
      milestones: 2,
      results: 1,
      actions: 2,
      actionsOnly: 2,
      subActions: 0,
      subSubActions: 0,
      inWms: 1,
      notScheduled: 2,
    });
  });

  it("counts a Result as schedulable — it gets a task too", () => {
    const c = countPlan([n("project", "p", "P", [
      n("milestone", "m", "M", [n("result", "r", "R")]),
    ])]);
    expect(c.notScheduled).toBe(1);
    expect(c.inWms).toBe(0);
  });

  it("is all zeroes for an empty plan", () => {
    expect(countPlan([]).total).toBe(0);
  });
});

describe("the depth cap — \"show down to…\"", () => {
  it("stops at the named level and drops everything under it", () => {
    const open = new Set(["p1", "m1", "ra", "a2"]);
    const all = flattenTable(tree(), { expanded: open });
    expect(all.some((r) => r.node.kind === "action")).toBe(true);

    // `maxDepth` is the deepest KIND_DEPTH allowed on screen: project 0,
    // milestone 1, result 2. So 1 renders projects and milestones only.
    const capped = flattenTable(tree(), { expanded: open, maxDepth: 1 });
    expect(capped.map((r) => r.node.kind)).toEqual([
      "project",
      "milestone",
      "milestone",
      "project",
    ]);
  });

  it("includes the named level itself, not just the ones above it", () => {
    const open = new Set(["p1", "m1", "ra", "a2"]);
    const toResults = flattenTable(tree(), { expanded: open, maxDepth: 2 });
    expect(toResults.some((r) => r.node.kind === "result")).toBe(true);
    expect(toResults.some((r) => r.node.kind === "action")).toBe(false);
  });

  it("closes the caret on a row whose children the cap removed", () => {
    // A caret that opens onto nothing is a lie about what is there.
    const capped = flattenTable(tree(), {
      expanded: new Set(["p1", "m1"]),
      maxDepth: 1,
    });
    const milestone = capped.find((r) => r.node.id === "m1")!;
    expect(milestone.hasChildren).toBe(false);
    expect(milestone.expanded).toBe(false);
  });

  it("renders the whole tree when the cap is absent or null", () => {
    const open = new Set(["p1", "m1", "ra", "a2"]);
    const uncapped = flattenTable(tree(), { expanded: open, maxDepth: null });
    expect(uncapped.length).toBe(flattenTable(tree(), { expanded: open }).length);
  });
});

describe("initialExpanded", () => {
  it("opens Projects and Milestones, closes everything from Result down", () => {
    const open = initialExpanded(tree());
    expect(open.has("p1")).toBe(true);
    expect(open.has("m1")).toBe(true);
    expect(open.has("ra")).toBe(false);
  });

  it("does not open a childless row", () => {
    // A caret on a row with nothing under it is a lie.
    const open = initialExpanded(tree());
    expect(open.has("m2")).toBe(false);
    expect(open.has("p2")).toBe(false);
  });

  it("leaves a newly added row absent — so it is visible immediately", () => {
    const open = initialExpanded(tree());
    expect(open.has("brand-new-id")).toBe(false);
  });
});

describe("planCsv", () => {
  const rows = flattenTable(tree(), { expanded: new Set(["p1", "m1", "ra"]) });
  const columns = [
    { header: "Name", value: (r: (typeof rows)[number]) => r.node.name },
    { header: "Owner", value: (r: (typeof rows)[number]) => r.node.ownerName ?? "" },
  ];

  it("prefixes Full Ref, Level and Path", () => {
    const csv = planCsv(rows, columns);
    const [header, first] = csv.replace(/^﻿/, "").split("\r\n");
    expect(header).toBe("Full Ref,Level,Path,Name,Owner");
    expect(first).toBe("P1,Project,,AICL WMS,Manan Vasa");
  });

  it("exports exactly the rows on screen", () => {
    const csv = planCsv(rows, columns);
    expect(csv.trim().split("\r\n")).toHaveLength(rows.length + 1);
  });

  it("carries a UTF-8 BOM so Excel reads it as UTF-8", () => {
    expect(planCsv(rows, columns).charCodeAt(0)).toBe(0xfeff);
  });

  it("quotes RFC-4180 style", () => {
    const tricky = flattenTable(
      [n("project", "p", 'Say "hi", now', [])],
      { expanded: new Set() },
    );
    const csv = planCsv(tricky, [
      { header: "Name", value: (r) => r.node.name },
    ]);
    expect(csv).toContain('"Say ""hi"", now"');
  });

  it("names the file from local getters", () => {
    expect(planCsvName(new Date(2026, 5, 12))).toBe("Project-Plan-2026-06-12.csv");
  });
});
