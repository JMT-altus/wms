import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("Task detail page layout (source checks)", () => {
  const body = read("components/tasks/task-detail.tsx");
  const view = read("components/tasks/task-detail-view.tsx");
  const rail = read("components/tasks/action-rail.tsx");

  it("the title is a sized heading element, not an <h1> the global rule would blow up", () => {
    expect(body).toContain('role="heading"');
    expect(body).not.toContain("<h1");
    // the whole headline is still rendered, line breaks preserved
    expect(body).toContain("{headline}");
    expect(body).toContain('whiteSpace: "pre-wrap"');
  });

  it("the page keeps every header control and its target", () => {
    for (const s of ["router.back()", "router.forward()", "/tasks/${task.id}/focus", "/tasks/new?from=${task.id}", "Edit Task", "Duplicate", "Focus"]) {
      expect(view, s).toContain(s);
    }
  });

  it("the sidebar keeps its status picker, details, archive toggle and action rail", () => {
    expect(view).toContain("<InteractiveStatusPill");
    for (const label of ["Task No.", "Created", "Updated", "Approved", "Priority"]) {
      expect(view, label).toContain(`label="${label}"`);
    }
    expect(view).toContain("<ArchiveToggle");
    expect(view).toContain("<ActionRail");
    expect(rail).toContain("Admin & Process Actions");
  });

  it("archive/restore stays admin-only", () => {
    expect(view).toMatch(/me\?\.isAdmin && \(\s*<ArchiveToggle/);
  });
});
