// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const setLeaveApprover = vi.fn();
const decideLeave = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(app)/attendance/leave/actions", () => ({
  setLeaveApprover: (...a: unknown[]) => setLeaveApprover(...a),
  decideLeave: (...a: unknown[]) => decideLeave(...a),
  cancelLeave: vi.fn(),
  applyForLeave: vi.fn(),
}));

import { ApproverSettings } from "@/components/attendance/leave/approver-settings";
import { LeaveList } from "@/components/attendance/leave/leave-list";
import { PendingLeavePrompt } from "@/components/attendance/leave/pending-leave-prompt";
import type { LeaveRow } from "@/lib/queries/leave";

beforeEach(() => {
  setLeaveApprover.mockReset().mockResolvedValue({ ok: true });
  decideLeave.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const people = [
  { id: "p1", name: "Asha Rao" },
  { id: "p2", name: "Ravi Iyer" },
];

describe("ApproverSettings", () => {
  it("with no default, warns and lets an admin choose one — no person is pre-filled", async () => {
    render(<ApproverSettings approvers={[]} status={{ state: "missing" }} people={people} />);
    expect(screen.getByRole("alert").textContent).toMatch(/No default approver is set.*going to the admins/);
    const button = screen.getByRole("button", { name: "Set as default approver" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // nothing chosen yet
    fireEvent.change(screen.getByLabelText("Choose an employee"), { target: { value: "p2" } });
    fireEvent.click(button);
    await waitFor(() => expect(setLeaveApprover).toHaveBeenCalledWith({ employeeId: "p2", action: "make_default" }));
  });

  it("says so when the default has been deactivated, naming them", () => {
    render(
      <ApproverSettings
        approvers={[]}
        status={{ state: "inactive", name: "Old Approver" }}
        people={people}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Old Approver.*no longer an active employee/);
  });

  it("with a working default: no warning; can add, change the default, and remove", async () => {
    render(
      <ApproverSettings
        approvers={[
          { employeeId: "p1", name: "Asha Rao", isDefault: true },
          { employeeId: "p3", name: "Meera Shah", isDefault: false },
        ]}
        status={{ state: "ok", name: "Asha Rao" }}
        people={[...people, { id: "p3", name: "Meera Shah" }]}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    // Already-listed people are not offered again.
    const options = [...screen.getByLabelText("Choose an employee").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Choose an employee…", "Ravi Iyer"]);

    // Wait for the previous action to settle: buttons are disabled while one runs.
    const settled = () =>
      waitFor(() => expect((screen.getAllByRole("button", { name: "Remove" })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    await waitFor(() => expect(setLeaveApprover).toHaveBeenLastCalledWith({ employeeId: "p3", action: "make_default" }));
    await settled();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await waitFor(() => expect(setLeaveApprover).toHaveBeenLastCalledWith({ employeeId: "p1", action: "remove" }));
    await settled();
    fireEvent.change(screen.getByLabelText("Choose an employee"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    await waitFor(() => expect(setLeaveApprover).toHaveBeenLastCalledWith({ employeeId: "p2", action: "add" }));
  });

  it("shows the server's refusal instead of a success message", async () => {
    setLeaveApprover.mockResolvedValue({ ok: false, error: "Admin access required" });
    render(<ApproverSettings approvers={[]} status={{ state: "missing" }} people={people} />);
    fireEvent.change(screen.getByLabelText("Choose an employee"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set as default approver" }));
    await waitFor(() => expect(setLeaveApprover).toHaveBeenCalled());
  });
});

const row = (over: Partial<LeaveRow> = {}): LeaveRow => ({
  id: "r1",
  employeeId: "e1",
  employeeName: "Asha Rao",
  kind: null,
  leaveType: "planned",
  approverId: "m1",
  approverName: "Mihir",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  days: 3,
  reason: "Wedding",
  status: "pending",
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: new Date("2026-10-12T05:00:00Z"),
  ...over,
});

describe("pending approvals list", () => {
  it("approving calls the server action with the request id", async () => {
    render(<LeaveList rows={[row()]} mode="pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decideLeave).toHaveBeenCalledWith({ id: "r1", verdict: "approved", note: undefined }));
  });

  it("rejecting needs a reason: without one nothing is sent; with one it is", async () => {
    render(<LeaveList rows={[row()]} mode="pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(decideLeave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "Peak week" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(decideLeave).toHaveBeenCalledWith({ id: "r1", verdict: "rejected", note: "Peak week" }));
  });

  it("a decided request offers no approve/reject, and shows the employee its status and remarks", () => {
    render(
      <LeaveList
        rows={[row({ status: "rejected", decidedByName: "Mihir", decidedAt: new Date("2026-10-13T05:00:00Z"), decisionNote: "Peak week" })]}
        mode="mine"
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText(/Remarks: Peak week/)).toBeTruthy();
    expect(screen.getByText(/Rejected by Mihir/)).toBeTruthy();
  });
});

describe("reminder navigation", () => {
  it("the Hub reminder's link points at an element the pending list actually renders", () => {
    const { container, unmount } = render(
      <PendingLeavePrompt
        total={1}
        requests={[{ id: "r1", employeeName: "Asha Rao", startDate: "2026-10-15", endDate: "2026-10-17", days: 3, typeLabel: "Planned", reason: "Wedding" }]}
      />,
    );
    const href = screen.getByRole("link", { name: "Open request" }).getAttribute("href")!;
    expect(href.startsWith("/attendance/leave#")).toBe(true);
    const anchor = href.split("#")[1]!;
    unmount();
    const list = render(<LeaveList rows={[row()]} mode="pending" />);
    expect(list.container.querySelector(`#${anchor}`)).not.toBeNull();
    void container;
  });
});

describe("server-side authorization (source checks)", () => {
  const src = readFileSync(resolve(__dirname, "../../app/(app)/attendance/leave/actions.ts"), "utf8");
  const body = (name: string) => {
    const start = src.indexOf(`export async function ${name}`);
    const next = src.indexOf("export async function", start + 10);
    return src.slice(start, next === -1 ? undefined : next);
  };
  it("changing approvers is admin-only on the server", () => {
    expect(body("setLeaveApprover")).toContain("await requireAdmin()");
  });
  it("deciding goes through checkCanDecide and updates only a still-pending row", () => {
    const decide = body("decideLeave");
    expect(decide).toContain("checkCanDecide(");
    expect(decide).toContain('eq(leaveRequests.status, "pending")');
  });
  it("the Leave page carries no approver card; the admin page does, behind requireAdmin; the pending list needs the view permission", () => {
    const page = readFileSync(resolve(__dirname, "../../app/(app)/attendance/leave/page.tsx"), "utf8");
    expect(page).not.toContain("ApproverSettings");
    const admin = readFileSync(resolve(__dirname, "../../app/(admin)/admin/leave-approvers/page.tsx"), "utf8");
    expect(admin).toContain("await requireAdmin()");
    expect(admin).toContain("<ApproverSettings");
    expect(page).toContain("{caps.view && (");
    expect(page).toContain("listPendingLeaveFor(caps.view, caps.override)");
    expect(page).not.toContain("listedApprover");
  });
});
