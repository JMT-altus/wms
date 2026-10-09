import { describe, it, expect, vi } from "vitest";

// The module under test imports the database client; the rule itself is pure.
vi.mock("@/lib/db", () => ({ db: {}, employees: {}, tasks: {} }));
vi.mock("@/lib/auth/task-visibility", () => ({ visibleTaskCondition: vi.fn() }));
vi.mock("@/lib/queries/departments", () => ({ employeeIdsInDepartments: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { resolveProjectClient } from "@/lib/queries/tasks";

describe("resolveProjectClient — the Tasks list's Client column for plan tasks", () => {
  it("shows the project's Client Name, not the project's name", () => {
    // Stored client is just the project name (the plan's last-resort fallback).
    expect(resolveProjectClient("Website Development", "Website Development", "ABC Company")).toBe(
      "ABC Company",
    );
  });

  it("shows nothing when the project has no Client Name and the stored value is its name", () => {
    expect(resolveProjectClient("Website Development", "Website Development", null)).toBeNull();
    expect(resolveProjectClient("Website Development", "Website Development", "  ")).toBeNull();
  });

  it("fills in an empty stored client from the project", () => {
    expect(resolveProjectClient(null, "Website Development", "ABC Company")).toBe("ABC Company");
    expect(resolveProjectClient("", "Website Development", "ABC Company")).toBe("ABC Company");
  });

  it("keeps a real client that was typed or chosen on the row", () => {
    expect(resolveProjectClient("XYZ Ltd", "Website Development", "ABC Company")).toBe("XYZ Ltd");
    expect(resolveProjectClient("XYZ Ltd", "Website Development", null)).toBe("XYZ Ltd");
  });

  it("ignores edge whitespace on the stored value", () => {
    expect(resolveProjectClient("  XYZ Ltd ", "Website Development", null)).toBe("XYZ Ltd");
    expect(resolveProjectClient(" Website Development ", "Website Development", "ABC")).toBe("ABC");
  });
});
