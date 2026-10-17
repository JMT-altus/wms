import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("Archive page layout opt-ins (source checks)", () => {
  const page = read("app/(app)/archived/page.tsx");

  it("uses the wrapping filter layout and the compact list layout", () => {
    expect(page).toMatch(/<FilterBar\s+wrap\b/);
    expect(page).toMatch(/<TaskListPage\s+compact\b/);
  });

  it("keeps its scope and its list-only options exactly as they were", () => {
    expect(page).toContain("showStats={false}");
    expect(page).toContain('basePath="/archived"');
    expect(page).toContain('title="Archived"');
  });

  it("the Tasks page's compact layout is not what the Archive's filter data comes from", () => {
    // The Archive still builds its own filters (no status or client chips here).
    expect(page).not.toContain("statusOptions=");
    expect(page).not.toContain("clients={");
  });
});
