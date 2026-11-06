import { describe, expect, it } from "vitest";
import { isLightChrome } from "@/lib/chrome-theme";

describe("isLightChrome", () => {
  it("is on for the WMS pages", () => {
    for (const p of ["/", "/tasks", "/tasks/agenda", "/tasks/kanban", "/weekly-goals", "/archived", "/inbox"]) {
      expect(isLightChrome(p), p).toBe(true);
    }
  });
  it("is off for areas with their own navy rail and for an unknown path", () => {
    for (const p of ["/collection", "/admin/users", "/master-setup", "/masters/clients", "/project-plan", "/targets"]) {
      expect(isLightChrome(p), p).toBe(false);
    }
    expect(isLightChrome(null)).toBe(false);
  });
  it("is on for the whole Employees module — the approved WMS white-and-blue shell", () => {
    for (const p of ["/attendance", "/attendance/leave", "/attendance/leave/approvals", "/attendance/dashboard", "/dcc", "/dcc/dashboard", "/dcc/ranking", "/salary", "/salary/employee", "/my-salary", "/my-salary/statement/abc", "/reimbursements", "/leave-approval"]) {
      expect(isLightChrome(p), p).toBe(true);
    }
  });
  it("is off for every other module (they keep their navy rail)", () => {
    for (const p of ["/incentive", "/outstanding", "/training", "/hr/policies", "/participant-breakthrough", "/record-reference"]) {
      expect(isLightChrome(p), p).toBe(false);
    }
  });
});
