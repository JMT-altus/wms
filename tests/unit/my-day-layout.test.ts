import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("My Day layout fixes (source checks)", () => {
  it("the bulk-action bar wraps instead of scrolling sideways, and keeps every action", () => {
    const bar = read("components/tasks/bulk-action-bar.tsx");
    expect(bar).toContain("flex-wrap items-center gap-x-1.5 gap-y-1.5");
    expect(bar).not.toContain("overflow-x-auto");
    for (const label of ["Archive", "Clear", "Reassign", "Initiator Status"]) {
      expect(bar, label).toContain(label);
    }
  });

  it("the Welcome heading is a sized heading element, not an <h1> the global rule would enlarge", () => {
    const ws = read("components/tasks/my-day-workspace.tsx");
    expect(ws).toContain('role="heading"');
    expect(ws).not.toContain("<h1");
    expect(ws).toContain("Welcome, {firstName}");
  });

  it("in the wrapping filter layout the groups carry no left margins, so the second row stays tight", () => {
    const bar = read("components/layout/filter-bar.tsx");
    expect(bar).toContain('wrap ? "" : "ml-[18px]"');
    expect(bar).toContain('wrap ? "" : showScopeChip ? "ml-3" : "ml-4"');
  });
});
