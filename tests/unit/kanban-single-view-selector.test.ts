import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("Kanban has one Doer/Initiator selector", () => {
  it("the Kanban page turns the filter bar's own View selector off", () => {
    expect(read("app/(app)/tasks/kanban/page.tsx")).toContain("showView={false}");
  });

  it("no other page turns it off: My Day, Tasks, Dashboard and Archive keep theirs", () => {
    for (const f of [
      "app/(app)/tasks/page.tsx",
      "app/(app)/tasks/agenda/page.tsx",
      "app/(app)/page.tsx",
      "app/(app)/archived/page.tsx",
    ]) {
      expect(read(f), f).not.toContain("showView");
    }
  });

  it("the filter bar draws the selector unless told not to, and the board keeps its Status view control", () => {
    const bar = read("components/layout/filter-bar.tsx");
    expect(bar).toContain("showView = true");
    expect(bar).toContain("{showView && !headerSlot && (");
    expect(read("components/tasks/kanban-board.tsx")).toContain("<SideToggle");
  });
});
