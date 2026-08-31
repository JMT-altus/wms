import { describe, it, expect } from "vitest";
import { getVisibleDashboards, EXTERNAL_DASHBOARDS } from "@/lib/external-dashboards";
import type { Employee } from "@/db/schema";

// Minimal Employee factory — only the fields the predicate reads.
// Casting through `unknown` keeps us from having to spell out every nullable
// column on the schema for a test that exercises 2 booleans + 1 string.
function fakeEmployee(over: Partial<Employee>): Employee {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    name: "Test",
    email: "noone@example.com",
    role: "doer",
    avatarUrl: null,
    department: null,
    departmentId: null,
    createdAt: new Date(),
    firebaseUid: null,
    isAdmin: false,
    isActive: true,
    invitedAt: null,
    joinedAt: null,
    lastInboxVisitAt: new Date(),
    slackUserId: null,
    emailOptIn: true,
    slackOptIn: true,
    whatsappPhone: null,
    whatsappOptedIn: false,
    whatsappTemplateLocale: "en",
    ...over,
  } as unknown as Employee;
}

describe("EXTERNAL_DASHBOARDS", () => {
  // JMT Drive Solutions ships with no external dashboards — the Altus-specific
  // Google Apps Script links were dropped during the rebrand. When JMT's own
  // links are added, the shape assertions below start doing real work.
  it("is empty until JMT's own dashboards are registered", () => {
    expect(EXTERNAL_DASHBOARDS).toEqual([]);
  });

  it("every registered dashboard has a unique id, an https URL and a known accent", () => {
    const ids = EXTERNAL_DASHBOARDS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of EXTERNAL_DASHBOARDS) {
      expect(d.url).toMatch(/^https:\/\//);
      expect(["blue", "amber", "purple"]).toContain(d.accent);
      expect(d.label.trim()).not.toBe("");
    }
  });
});

describe("getVisibleDashboards", () => {
  it("returns empty array for null employee", () => {
    expect(getVisibleDashboards(null)).toEqual([]);
  });

  it("returns nothing for a regular employee while the registry is empty", () => {
    const me = fakeEmployee({ email: "shilpa@jmtds.com", isAdmin: false });
    expect(getVisibleDashboards(me)).toEqual([]);
  });

  it("returns nothing for an admin while the registry is empty", () => {
    const me = fakeEmployee({ email: "mihir.jmtds@gmail.com", isAdmin: true });
    expect(getVisibleDashboards(me)).toEqual([]);
  });

  it("never returns more links than are registered", () => {
    const me = fakeEmployee({ isAdmin: true });
    expect(getVisibleDashboards(me).length).toBeLessThanOrEqual(
      EXTERNAL_DASHBOARDS.length,
    );
  });

  it("drops the visibleTo predicate from what it hands the client", () => {
    const me = fakeEmployee({ isAdmin: true });
    for (const d of getVisibleDashboards(me)) {
      expect(d).not.toHaveProperty("visibleTo");
    }
  });
});
