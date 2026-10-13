// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const applyForLeave = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(app)/attendance/leave/actions", () => ({
  applyForLeave: (...a: unknown[]) => applyForLeave(...a),
  decideLeave: vi.fn(),
  cancelLeave: vi.fn(),
  setLeaveApprover: vi.fn(),
}));

import { ApplyLeaveForm } from "@/components/attendance/leave/apply-leave-form";
import { PendingLeavePrompt } from "@/components/attendance/leave/pending-leave-prompt";

beforeEach(() => applyForLeave.mockReset());
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function fill(over: { reason?: string } = {}) {
  fireEvent.change(screen.getByLabelText("Leave From Date"), { target: { value: "2026-09-15" } });
  fireEvent.change(screen.getByLabelText("Leave To Date"), { target: { value: "2026-09-21" } });
  fireEvent.click(screen.getByRole("radio", { name: "Planned" }));
  fireEvent.change(screen.getByLabelText("Reason for Leave"), { target: { value: over.reason ?? "Wedding" } });
}

describe("ApplyLeaveForm", () => {
  it("shows the employee and approver read-only, and no calendar-entry field", () => {
    render(<ApplyLeaveForm employeeName="Asha Rao" approverName="Mihir Veera" />);
    expect((screen.getByLabelText("Employee Name") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Approver") as HTMLInputElement).value).toBe("Mihir Veera");
    expect(screen.queryByText(/calendar entry/i)).toBeNull();
  });

  it("calculates the inclusive day count as the dates change", () => {
    render(<ApplyLeaveForm employeeName="A" approverName="M" />);
    fill();
    expect(screen.getByText("7 days")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Leave To Date"), { target: { value: "2026-09-15" } });
    expect(screen.getByText("1 day")).toBeTruthy();
  });

  it("blocks submit and names the missing field, without calling the server", () => {
    render(<ApplyLeaveForm employeeName="A" approverName="M" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Leave Application" }));
    expect(screen.getByRole("alert").textContent).toMatch(/both leave dates/i);
    expect(applyForLeave).not.toHaveBeenCalled();
  });

  it("requires a reason", () => {
    render(<ApplyLeaveForm employeeName="A" approverName="M" />);
    fill({ reason: "  " });
    fireEvent.click(screen.getByRole("button", { name: "Submit Leave Application" }));
    expect(screen.getByRole("alert").textContent).toMatch(/reason for leave is required/i);
    expect(applyForLeave).not.toHaveBeenCalled();
  });

  it("sends only dates, type and reason — never an employee, approver or status", async () => {
    applyForLeave.mockResolvedValue({ ok: true, id: "x", days: 7, notified: true, routedTo: "Mihir Veera" });
    render(<ApplyLeaveForm employeeName="A" approverName="Mihir Veera" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit Leave Application" }));
    await waitFor(() => expect(applyForLeave).toHaveBeenCalledTimes(1));
    expect(applyForLeave).toHaveBeenCalledWith({
      startDate: "2026-09-15",
      endDate: "2026-09-21",
      leaveType: "planned",
      reason: "Wedding",
    });
  });

  it("ignores a second click while the first submission is in flight", async () => {
    let release!: (v: unknown) => void;
    applyForLeave.mockReturnValue(new Promise((r) => (release = r)));
    render(<ApplyLeaveForm employeeName="A" approverName="M" />);
    fill();
    const submit = screen.getByRole("button", { name: "Submit Leave Application" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(applyForLeave).toHaveBeenCalledTimes(1);
    release({ ok: false, error: "x" });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("shows the server's error instead of a success message", async () => {
    applyForLeave.mockResolvedValue({ ok: false, error: "You already have a pending request for these dates." });
    render(<ApplyLeaveForm employeeName="A" approverName="M" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit Leave Application" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already have a pending/));
  });

  it("with no default approver, shows Admins and can still be submitted", async () => {
    applyForLeave.mockResolvedValue({ ok: true, id: "x", days: 7, notified: false, routedTo: "the admins" });
    render(<ApplyLeaveForm employeeName="A" approverName={null} />);
    expect((screen.getByLabelText("Approver") as HTMLInputElement).value).toBe("Admins");
    const submit = screen.getByRole("button", { name: "Submit Leave Application" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fill();
    fireEvent.click(submit);
    await waitFor(() => expect(applyForLeave).toHaveBeenCalledTimes(1));
  });
});

describe("PendingLeavePrompt", () => {
  const req = {
    id: "r1",
    employeeName: "Asha Rao",
    startDate: "2026-09-15",
    endDate: "2026-09-21",
    days: 7,
    typeLabel: "Planned",
    reason: "Wedding",
  };
  it("shows who, when, how many days, the type and reason, with a link to open it", () => {
    render(<PendingLeavePrompt requests={[req]} total={1} />);
    expect(screen.getByText("1 leave request awaiting your decision")).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText(/2026-09-15 → 2026-09-21 · 7 days · Planned/)).toBeTruthy();
    expect(screen.getByText("Wedding")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open request" }).getAttribute("href")).toBe("/attendance/leave#leave-r1");
  });
  it("dismissing hides the popup for the session but is only a hide", () => {
    const { unmount } = render(<PendingLeavePrompt requests={[req]} total={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(<PendingLeavePrompt requests={[req]} total={1} />);
    expect(screen.queryByRole("dialog")).toBeNull(); // same session
    sessionStorage.clear();
  });
  it("renders nothing when there is nothing pending", () => {
    render(<PendingLeavePrompt requests={[]} total={0} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
