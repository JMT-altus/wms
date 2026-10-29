import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERMISSION_FIELD_DEFS, isSensitivePermission, permissionFieldDef } from "@/db/enums";
import { resolveFieldAccess, type ResolvedFieldGrants } from "@/lib/access/field-permissions";
import { MODULES, NAV_REQUIRED_CAPABILITIES } from "@/lib/nav-modules";

const KEYS = ["leave.approvals.view", "leave.approvals.decide", "leave.approvals.override"] as const;
const none: ResolvedFieldGrants = { everyone: {}, department: {}, employee: {} };
const root = (p: string) => resolve(__dirname, "../..", p);

describe("the leave-approval capabilities in the permission registry", () => {
  it("are registered once each, in their own group, so the Field Permissions matrix lists them", () => {
    for (const k of KEYS) {
      expect(PERMISSION_FIELD_DEFS.filter((f) => f.key === k)).toHaveLength(1);
      expect(permissionFieldDef(k)).toMatchObject({ group: "Leave approvals", defaultAllowed: false });
    }
    expect(new Set(PERMISSION_FIELD_DEFS.map((f) => f.key)).size).toBe(PERMISSION_FIELD_DEFS.length);
  });

  it("are sensitive: explicit grants only, made by a super-admin, never implied by admin status", () => {
    for (const k of KEYS) {
      expect(isSensitivePermission(k)).toBe(true);
      expect(permissionFieldDef(k)).toMatchObject({ adminBypass: false, superAdminBypass: false });
    }
  });

  it("resolve to 'not allowed' for everyone — admins and super-admins included — until someone is granted them", () => {
    for (const k of KEYS) {
      for (const subject of [
        { isAdmin: false, isSuperAdmin: false },
        { isAdmin: true, isSuperAdmin: false },
        { isAdmin: true, isSuperAdmin: true },
      ]) {
        expect(resolveFieldAccess(k, subject, none)).toEqual({ allowed: false, source: "default" });
      }
    }
  });

  it("honour a person-level grant (even for a non-admin) and a person-level deny", () => {
    const grants = (allowed: boolean): ResolvedFieldGrants => ({ ...none, employee: { "leave.approvals.view": allowed } });
    expect(resolveFieldAccess("leave.approvals.view", { isAdmin: false, isSuperAdmin: false }, grants(true))).toEqual({ allowed: true, source: "employee" });
    expect(resolveFieldAccess("leave.approvals.view", { isAdmin: true, isSuperAdmin: true }, grants(false))).toEqual({ allowed: false, source: "employee" });
  });

  it("ignore a department grant (membership is managed by any admin)", () => {
    const grants: ResolvedFieldGrants = { ...none, department: { "leave.approvals.decide": true } };
    expect(resolveFieldAccess("leave.approvals.decide", { isAdmin: true, isSuperAdmin: false }, grants).allowed).toBe(false);
  });

  it("the three permissions are independent: viewing grants no deciding, and the reverse", () => {
    const g: ResolvedFieldGrants = { ...none, employee: { "leave.approvals.view": true } };
    const me = { isAdmin: false, isSuperAdmin: false };
    expect(resolveFieldAccess("leave.approvals.view", me, g).allowed).toBe(true);
    expect(resolveFieldAccess("leave.approvals.decide", me, g).allowed).toBe(false);
    expect(resolveFieldAccess("leave.approvals.override", me, g).allowed).toBe(false);
  });
});

describe("navigation configuration", () => {
  it("the Leave Approvals item declares the view permission, and no hard-coded flag remains", () => {
    const item = MODULES.find((m) => m.id === "employees")!.items.find((i) => i.href === "/attendance/leave/approvals");
    expect(item).toMatchObject({ label: "Leave Approvals", requires: "leave.approvals.view" });
    expect(item).not.toHaveProperty("approverOnly");
    expect(item).not.toHaveProperty("adminOnly");
    expect(NAV_REQUIRED_CAPABILITIES).toContain("leave.approvals.view");
  });

  it("every permission a nav item requires is a registered permission", () => {
    const registered = new Set(PERMISSION_FIELD_DEFS.map((f) => f.key));
    for (const k of NAV_REQUIRED_CAPABILITIES) expect(registered.has(k), k).toBe(true);
  });
});

describe("no person is hard-coded into the leave approval feature", () => {
  const FILES = [
    "lib/leave/workflow.ts",
    "lib/queries/leave.ts",
    "lib/auth/capability.ts",
    "lib/nav-modules.ts",
    "app/(app)/attendance/leave/actions.ts",
    "app/(app)/attendance/leave/page.tsx",
    "app/(app)/attendance/leave/approvals/page.tsx",
    "components/attendance/leave/leave-list.tsx",
    "components/attendance/leave/approver-settings.tsx",
    "app/(admin)/admin/leave-approvers/page.tsx",
    "components/attendance/leave/pending-leave-prompt-server.tsx",
    "components/layout/app-sidebar.tsx",
    "components/layout/app-sidebar-server.tsx",
    "components/layout/main-nav.tsx",
    "components/layout/main-nav-server.tsx",
  ];
  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

  it("names no e-mail address, person or employee id", () => {
    for (const f of FILES) {
      const src = readFileSync(root(f), "utf8");
      expect(src, f).not.toMatch(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
      expect(src, f).not.toMatch(/mihir|jmtds/i);
      expect(src, f).not.toMatch(UUID);
    }
  });

  it("no longer decides access from admin status or the leave_approvers list", () => {
    const decide = readFileSync(root("app/(app)/attendance/leave/actions.ts"), "utf8");
    const approvals = readFileSync(root("app/(app)/attendance/leave/approvals/page.tsx"), "utf8");
    const queries = readFileSync(root("lib/queries/leave.ts"), "utf8");
    expect(decide).not.toMatch(/isLeaveApprover|deciderIsAdmin|deciderIsListedApprover/);
    expect(approvals).not.toMatch(/isAdmin|isLeaveApprover/);
    expect(queries).not.toMatch(/isLeaveApprover|canReviewLeave|isAdmin\b/);
    // The decision and the queue are tied to the capability proofs.
    expect(decide).toContain("getLeaveCapabilityProofs");
    expect(approvals).toContain("getLeaveCapabilityProofs");
    expect(queries).toMatch(/viewer: CapabilityProof<"leave\.approvals\.view">/);
  });

  it("the earlier migration that seeded a default by name is untouched, already-applied history", () => {
    const m = readFileSync(root("db/migrations/0108_leave_apply_workflow.sql"), "utf8");
    expect(m).toContain("mihir veera"); // history, already applied — not edited
  });
});
