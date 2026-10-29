// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

type Proof = { employeeId: string; capability: string } | null;
const h = vi.hoisted(() => ({
  me: { id: "u1", name: "Asha", email: "asha@example.test", isAdmin: false } as { id: string; name: string; email: string; isAdmin: boolean },
  caps: { view: null, decide: null, override: null } as { view: Proof; decide: Proof; override: Proof },
  defaultApprover: { employeeId: "a1", name: "Default Approver", isDefault: true } as null | { employeeId: string; name: string; isDefault: boolean },
  settingsProps: null as null | Record<string, unknown>,
  adminDenied: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/layout/footer", () => ({ DashboardFooter: () => null }));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (h.adminDenied || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/capability", () => ({ getLeaveCapabilityProofs: async () => h.caps }));
vi.mock("@/lib/queries/leave", () => ({
  getDefaultLeaveApprover: async () => h.defaultApprover,
  listMyLeave: async () => [],
  listPendingLeaveFor: async () => [],
  listLeaveApprovers: async () => (h.defaultApprover ? [h.defaultApprover] : []),
  getDefaultApproverStatus: async () => (h.defaultApprover ? { state: "ok", name: h.defaultApprover.name } : { state: "missing" }),
  listApproverCandidates: async () => [{ id: "a1", name: "Default Approver", email: "default@example.test" }],
  listPendingRouting: async () => [{ id: "r1", employeeId: "e1", approverId: null }],
  getDefaultApproverAccess: async () => ({ view: true, decide: true }),
}));
vi.mock("@/app/(app)/attendance/leave/actions", () => ({
  applyForLeave: vi.fn(),
  setLeaveApprover: vi.fn(),
  reassignPendingLeave: vi.fn(),
  decideLeave: vi.fn(),
  cancelLeave: vi.fn(),
}));
vi.mock("@/components/attendance/leave/approver-settings", () => ({
  ApproverSettings: (props: Record<string, unknown>) => {
    h.settingsProps = props;
    return <section data-testid="approver-settings">Leave approvers</section>;
  },
}));

import LeavePage from "@/app/(app)/attendance/leave/page";
import LeaveApproversPage from "@/app/(admin)/admin/leave-approvers/page";

const grant = (...keys: ("view" | "decide")[]) => {
  const p = (c: string): Proof => ({ employeeId: "u1", capability: c });
  h.caps = { view: keys.includes("view") ? p("leave.approvals.view") : null, decide: keys.includes("decide") ? p("leave.approvals.decide") : null, override: null };
};
const leaveHtml = async () => renderToStaticMarkup((await LeavePage()) as ReactElement);

beforeEach(() => {
  h.me = { id: "u1", name: "Asha", email: "asha@example.test", isAdmin: false };
  grant();
  h.defaultApprover = { employeeId: "a1", name: "Default Approver", isDefault: true };
  h.settingsProps = null;
  h.adminDenied = false;
});

describe("Apply for Leave page", () => {
  it("shows the application form for an ordinary employee, with no approver-management card", async () => {
    const out = await leaveHtml();
    expect(out).toContain("Submit Leave Application");
    expect(out).toContain("My leave applications");
    expect(out).not.toContain("Leave approvers");
    expect(out).not.toContain("Add approver");
    expect(out).not.toContain("approver-settings");
    expect(h.settingsProps).toBeNull();
  });

  it("an administrator doesn't get the card here either — it lives in the Admin area", async () => {
    h.me = { ...h.me, isAdmin: true };
    const out = await leaveHtml();
    expect(out).not.toContain("approver-settings");
    expect(out).not.toContain("Leave approvers");
    expect(out).toContain("Submit Leave Application");
  });

  it("keeps the read-only Approver field, showing who the application goes to", async () => {
    const out = await leaveHtml();
    expect(out).toContain("Approver");
    expect(out).toContain('value="Default Approver"');
  });

  it("with no default approver the field says the application goes to the admins, and the form still renders", async () => {
    h.defaultApprover = null;
    const out = await leaveHtml();
    expect(out).toContain('value="Admins"');
    expect(out).toContain("No default approver is set");
    expect(out).toContain("Submit Leave Application");
  });

  it("the pending-approvals section appears only with the view permission", async () => {
    expect(await leaveHtml()).not.toContain("Pending approvals");
    grant("view");
    expect(await leaveHtml()).toContain("Pending approvals");
  });
});

describe("Admin · Leave approvers page", () => {
  it("is admin-only: a non-admin is refused before anything is read", async () => {
    await expect(LeaveApproversPage()).rejects.toThrow("Forbidden");
    expect(h.settingsProps).toBeNull();
  });

  it("gives an administrator the same card, with the routing data and the permission warning inputs", async () => {
    h.me = { ...h.me, isAdmin: true };
    const out = renderToStaticMarkup((await LeaveApproversPage()) as ReactElement);
    expect(out).toContain("Leave approvers");
    expect(out).toContain('data-testid="approver-settings"');
    expect(h.settingsProps).toMatchObject({
      defaultName: "Default Approver",
      reassignable: 1,
      defaultAccess: { view: true, decide: true },
      status: { state: "ok", name: "Default Approver" },
    });
    expect(h.settingsProps!.people).toEqual([{ id: "a1", name: "Default Approver", email: "default@example.test" }]);
  });

  it("is linked from both admin navigations", () => {
    for (const f of ["components/admin/admin-sidebar.tsx", "components/admin/admin-mobile-bar.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../..", f), "utf8");
      expect(src, f).toContain('href: "/admin/leave-approvers"');
      expect(src, f).toContain('label: "Leave Approvers"');
    }
  });
});

describe("authorization is untouched by moving the card", () => {
  const actions = readFileSync(resolve(__dirname, "../../app/(app)/attendance/leave/actions.ts"), "utf8");
  const body = (name: string) => {
    const i = actions.indexOf(`export async function ${name}`);
    const j = actions.indexOf("export async function", i + 10);
    return actions.slice(i, j === -1 ? undefined : j);
  };
  it("changing approvers and re-routing still require an admin on the server", () => {
    expect(body("setLeaveApprover")).toContain("await requireAdmin()");
    expect(body("reassignPendingLeave")).toContain("await requireAdmin()");
  });
  it("deciding still checks the Field Permissions grants and requires a reason to reject", () => {
    expect(body("decideLeave")).toContain("getLeaveCapabilityProofs");
    expect(body("decideLeave")).toContain("checkCanDecide(");
    const v = readFileSync(resolve(__dirname, "../../lib/validators/leave.ts"), "utf8");
    expect(v).toContain("A reason is required to reject a leave request.");
  });
});
