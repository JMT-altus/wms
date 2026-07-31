import { describe, it, expect } from "vitest";
import {
  MODULE_CODE_DEFAULTS,
  allowedToLevel,
  levelToAllowed,
  resolveModuleAccess,
  type ResolvedGrants,
} from "@/lib/access/modules";
import { MODULE_IDS, moduleIdForPath } from "@/lib/nav-modules";

const NONE: ResolvedGrants = { everyone: {}, department: {}, employee: {} };
const STAFF = { isAdmin: false, isSuperAdmin: false };
const ADMIN = { isAdmin: true, isSuperAdmin: false };
const SUPER = { isAdmin: true, isSuperAdmin: true };

describe("resolveModuleAccess", () => {
  it("falls back to the built-in defaults when nothing is set", () => {
    expect(resolveModuleAccess("wms", STAFF, NONE)).toEqual({ allowed: true, source: "default" });
    expect(resolveModuleAccess("training", STAFF, NONE)).toEqual({ allowed: true, source: "default" });
    expect(resolveModuleAccess("employees", STAFF, NONE)).toEqual({ allowed: false, source: "default" });
    expect(resolveModuleAccess("sales", STAFF, NONE)).toEqual({ allowed: false, source: "default" });
  });

  it("closes Employees and Incentive Tracker to staff by default", () => {
    expect(MODULE_CODE_DEFAULTS.employees).toBe(false);
    expect(MODULE_CODE_DEFAULTS.sales).toBe(false);
  });

  it("applies the org-wide default to staff", () => {
    const grants = { ...NONE, everyone: { sales: false } };
    expect(resolveModuleAccess("sales", STAFF, grants)).toEqual({
      allowed: false,
      source: "everyone",
    });
  });

  it("lets a department grant override the org-wide default", () => {
    const grants: ResolvedGrants = { everyone: { sales: false }, department: { sales: true }, employee: {} };
    expect(resolveModuleAccess("sales", STAFF, grants)).toEqual({
      allowed: true,
      source: "department",
    });
  });

  it("lets a personal grant override their department", () => {
    const grants: ResolvedGrants = {
      everyone: { sales: true },
      department: { sales: true },
      employee: { sales: false },
    };
    expect(resolveModuleAccess("sales", STAFF, grants)).toEqual({
      allowed: false,
      source: "employee",
    });
  });

  it("does not apply the org-wide default to admins", () => {
    const grants = { ...NONE, everyone: { employees: false } };
    expect(resolveModuleAccess("employees", ADMIN, grants)).toEqual({
      allowed: true,
      source: "admin",
    });
  });

  it("still lets a targeted grant restrict an admin", () => {
    const byName: ResolvedGrants = { everyone: {}, department: {}, employee: { employees: false } };
    expect(resolveModuleAccess("employees", ADMIN, byName)).toEqual({
      allowed: false,
      source: "employee",
    });

    const byDept: ResolvedGrants = { everyone: {}, department: { employees: false }, employee: {} };
    expect(resolveModuleAccess("employees", ADMIN, byDept)).toEqual({
      allowed: false,
      source: "department",
    });
  });

  it("never restricts a super-admin", () => {
    const grants: ResolvedGrants = {
      everyone: { sales: false },
      department: { sales: false },
      employee: { sales: false },
    };
    for (const m of MODULE_IDS) {
      expect(resolveModuleAccess(m, SUPER, grants)).toEqual({
        allowed: true,
        source: "super-admin",
      });
    }
  });
});

describe("level <-> allowed round-trip", () => {
  it("maps inherit to no stored row", () => {
    expect(levelToAllowed("inherit")).toBeNull();
    expect(allowedToLevel(null)).toBe("inherit");
    expect(allowedToLevel(undefined)).toBe("inherit");
  });

  it("round-trips allow and deny", () => {
    expect(allowedToLevel(levelToAllowed("allow"))).toBe("allow");
    expect(allowedToLevel(levelToAllowed("deny"))).toBe("deny");
  });
});

describe("moduleIdForPath", () => {
  it("maps module routes to their module", () => {
    expect(moduleIdForPath("/")).toBe("wms");
    expect(moduleIdForPath("/tasks")).toBe("wms");
    expect(moduleIdForPath("/tasks/kanban")).toBe("wms");
    expect(moduleIdForPath("/attendance")).toBe("employees");
    expect(moduleIdForPath("/attendance/dashboard")).toBe("employees");
    expect(moduleIdForPath("/salary/policy")).toBe("employees");
    expect(moduleIdForPath("/incentive")).toBe("sales");
    expect(moduleIdForPath("/outstanding/contracts")).toBe("sales");
    expect(moduleIdForPath("/training")).toBe("training");
  });

  it("returns null for routes that belong to no module", () => {
    // The hub itself must never resolve to a module — the guard redirects
    // denied users here, and a match would loop.
    expect(moduleIdForPath("/hub")).toBeNull();
    expect(moduleIdForPath("/profile")).toBeNull();
    expect(moduleIdForPath("/admin/access")).toBeNull();
    expect(moduleIdForPath("/login")).toBeNull();
  });

  it("does not match a route that is merely a string prefix", () => {
    expect(moduleIdForPath("/trainingxyz")).toBeNull();
  });
});
