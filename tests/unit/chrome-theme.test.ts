import { describe, expect, it } from "vitest";
import { isLightChrome } from "@/lib/chrome-theme";

describe("isLightChrome", () => {
  it("is on for the WMS pages", () => {
    for (const p of ["/", "/tasks", "/tasks/agenda", "/tasks/kanban", "/weekly-goals", "/archived", "/inbox"]) {
      expect(isLightChrome(p), p).toBe(true);
    }
  });
  it("is off for areas with their own navy rail and for an unknown path", () => {
    for (const p of ["/forms/collection", "/admin/users", "/master-setup", "/masters/clients", "/project-plan", "/targets"]) {
      expect(isLightChrome(p), p).toBe(false);
    }
    expect(isLightChrome(null)).toBe(false);
  });
  it("is off for the other modules", () => {
    expect(isLightChrome("/attendance/dashboard")).toBe(false);
  });
});
