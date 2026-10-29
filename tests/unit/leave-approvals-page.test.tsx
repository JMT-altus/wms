// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

type Proof = { employeeId: string; capability: string } | null;
const h = vi.hoisted(() => ({
  caps: { view: null, decide: null, override: null } as { view: Proof; decide: Proof; override: Proof },
  rows: [] as unknown[],
  listError: false,
  listArgs: null as unknown[] | null,
  pathname: "/attendance/leave",
  reassign: vi.fn(),
}));
const proof = (capability: string): Proof => ({ employeeId: "u1", capability });
const grant = (...keys: ("view" | "decide" | "override")[]) => {
  h.caps = {
    view: keys.includes("view") ? proof("leave.approvals.view") : null,
    decide: keys.includes("decide") ? proof("leave.approvals.decide") : null,
    override: keys.includes("override") ? proof("leave.approvals.override") : null,
  };
};

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/auth/capability", () => ({ getLeaveCapabilityProofs: async () => h.caps }));
vi.mock("@/lib/queries/leave", () => ({
  listPendingApprovalsFor: async (...args: unknown[]) => {
    h.listArgs = args;
    if (h.listError) throw new Error("password authentication failed for user secret-db-user");
    return h.rows;
  },
}));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/layout/footer", () => ({ DashboardFooter: () => null }));
vi.mock("@/components/attendance/leave/leave-list", () => ({
  LeaveList: ({ rows, mode, canDecide }: { rows: unknown[]; mode: string; canDecide?: boolean }) => (
    <div data-testid="leave-list" data-mode={mode} data-count={rows.length} data-can-decide={String(canDecide)} />
  ),
}));
vi.mock("@/app/(app)/attendance/leave/actions", () => ({
  setLeaveApprover: vi.fn(),
  reassignPendingLeave: (...a: unknown[]) => h.reassign(...a),
}));
vi.mock("@/components/layout/rail-group", () => ({ RailGroup: () => null }));

import LeaveApprovalsPage from "@/app/(app)/attendance/leave/approvals/page";
import { MainNav } from "@/components/layout/main-nav";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ApproverSettings } from "@/components/attendance/leave/approver-settings";

beforeEach(() => {
  grant();
  h.rows = [];
  h.listError = false;
  h.listArgs = null;
  h.pathname = "/attendance/leave";
  h.reassign.mockReset().mockResolvedValue({ ok: true, moved: 2, routedTo: "Default Approver" });
});
afterEach(cleanup);

const html = async () => renderToStaticMarkup((await LeaveApprovalsPage()) as ReactElement);

describe("Leave Approvals page — permission-driven", () => {
  it("is a 404 without the view permission, and reads no requests", async () => {
    await expect(LeaveApprovalsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    grant("decide"); // deciding without viewing does not open the page either
    await expect(LeaveApprovalsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    grant("override");
    await expect(LeaveApprovalsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listArgs).toBeNull();
  });

  it("with view + decide: the queue in decide mode, with the pending count", async () => {
    grant("view", "decide");
    h.rows = [{ id: "a" }, { id: "b" }];
    const out = await html();
    expect(out).toContain("Leave Approvals");
    expect(out).toContain('data-mode="pending"');
    expect(out).toContain('data-count="2"');
    expect(out).toContain('data-can-decide="true"');
    expect(out).toContain("2 pending");
    expect(out).not.toContain("view these requests but not approve");
  });

  it("with view only: the queue is shown read-only and the page says why", async () => {
    grant("view");
    h.rows = [{ id: "a" }];
    const out = await html();
    expect(out).toContain('data-can-decide="false"');
    expect(out).toContain("You can view these requests but not approve or reject them.");
  });

  it("the queue query is handed the view proof, and the override proof only when held", async () => {
    grant("view", "decide");
    await html();
    expect(h.listArgs).toEqual([proof("leave.approvals.view"), null]);
    grant("view", "decide", "override");
    await html();
    expect(h.listArgs).toEqual([proof("leave.approvals.view"), proof("leave.approvals.override")]);
  });

  it("an empty queue renders the list (which carries the empty message) and no error", async () => {
    grant("view", "decide");
    const out = await html();
    expect(out).toContain('data-count="0"');
    expect(out).not.toContain('role="alert"');
  });

  it("a failed load shows a plain error panel — nothing about the database leaks", async () => {
    grant("view", "decide");
    h.listError = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await html();
    expect(out).toContain('role="alert"');
    expect(out).toMatch(/could not be loaded.*Nothing has been changed/);
    expect(out).not.toContain("leave-list");
    expect(out + JSON.stringify(err.mock.calls.map((c) => String(c[0])))).not.toMatch(/secret-db-user|password authentication/);
    err.mockRestore();
  });
});

describe("navigation entry — desktop sidebar and mobile drawer", () => {
  const entry = () => screen.queryByRole("link", { name: /Leave Approvals/ });
  const held = ["leave.approvals.view"];

  it("the mobile drawer (MainNav) shows it only to someone who holds the view permission", () => {
    render(<MainNav activeTasks={0} archivedTasks={0} isAdmin={false} capabilities={held} variant="drawer" />);
    expect(entry()).not.toBeNull();
    cleanup();
    // An administrator without the grant does not get it.
    render(<MainNav activeTasks={0} archivedTasks={0} isAdmin capabilities={[]} variant="drawer" />);
    expect(entry()).toBeNull();
    cleanup();
    render(<MainNav activeTasks={0} archivedTasks={0} isAdmin={false} variant="drawer" />);
    expect(entry()).toBeNull();
    expect(screen.queryByRole("link", { name: /Apply for Leave/ })).not.toBeNull();
  });

  it("the desktop sidebar shows it only to someone who holds the view permission", () => {
    render(<AppSidebar activeTasks={0} archivedTasks={0} isAdmin={false} capabilities={held} />);
    expect(entry()).not.toBeNull();
    cleanup();
    render(<AppSidebar activeTasks={0} archivedTasks={0} isAdmin capabilities={["leave.approvals.decide"]} />);
    expect(entry()).toBeNull(); // deciding alone does not show the page
    cleanup();
    render(<AppSidebar activeTasks={0} archivedTasks={0} isAdmin={false} />);
    expect(entry()).toBeNull();
    expect(screen.queryByRole("link", { name: /Apply for Leave/ })).not.toBeNull();
  });

  it("the Apply for Leave pill is not lit on the approvals page", () => {
    h.pathname = "/attendance/leave/approvals";
    render(<MainNav activeTasks={0} archivedTasks={0} isAdmin={false} capabilities={held} variant="drawer" />);
    const apply = screen.getByRole("link", { name: /Apply for Leave/ });
    const approvals = screen.getByRole("link", { name: /Leave Approvals/ });
    expect(apply.getAttribute("aria-current")).not.toBe("page");
    expect(approvals.getAttribute("aria-current")).toBe("page");
  });
});

describe("Approver settings: routing, the permission warning, and re-routing", () => {
  const people = [
    { id: "p1", name: "Mihir", email: "first@example.test" },
    { id: "p2", name: "Mihir", email: "second@example.test" },
  ];
  const ok = { state: "ok", name: "Default Approver" } as const;

  it("lists the e-mail beside each name, so two similar names can be told apart", () => {
    render(<ApproverSettings approvers={[]} status={{ state: "missing" }} people={people} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Mihir (first@example.test)", "Mihir (second@example.test)"]));
  });

  it("warns when the default approver can't see or decide requests, and points to Field Permissions", () => {
    render(<ApproverSettings approvers={[]} status={ok} people={people} defaultAccess={{ view: false, decide: false }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Default Approver is the default approver but holds neither/);
    expect(screen.getByRole("alert").textContent).toMatch(/super-admin grants these.*Field\s*Permissions.*Leave approvals/);
    cleanup();
    render(<ApproverSettings approvers={[]} status={ok} people={people} defaultAccess={{ view: true, decide: false }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/doesn.t hold the .Approve or reject. permission/);
    cleanup();
    render(<ApproverSettings approvers={[]} status={ok} people={people} defaultAccess={{ view: false, decide: true }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/doesn.t hold the .View queue. permission/);
  });

  it("no permission warning when the default holds both, or when it is unknown", () => {
    render(<ApproverSettings approvers={[]} status={ok} people={people} defaultAccess={{ view: true, decide: true }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(<ApproverSettings approvers={[]} status={ok} people={people} defaultAccess={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers re-routing only when something is waiting; nothing runs until the admin confirms", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ApproverSettings approvers={[]} status={ok} people={people} reassignable={2} defaultName="Default Approver" />);
    expect(screen.getByText(/2 pending requests are not routed to Default Approver/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Route pending to Default Approver" }));
    expect(confirm).toHaveBeenCalled();
    expect(h.reassign).not.toHaveBeenCalled(); // declined
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Route pending to Default Approver" }));
    await waitFor(() => expect(h.reassign).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });

  it("shows no re-route control when nothing needs moving", () => {
    render(<ApproverSettings approvers={[]} status={ok} people={people} reassignable={0} defaultName="Default Approver" />);
    expect(screen.queryByRole("button", { name: /Route pending/ })).toBeNull();
  });
});
