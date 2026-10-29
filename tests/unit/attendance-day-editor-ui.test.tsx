// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The admin day editor (EmployeeDetailDialog → EditRow) with its server actions
// mocked: every save or removal carries a reason, an explanation and the
// snapshot of what was loaded, and one Save is one server call.
const a = vi.hoisted(() => ({
  edit: vi.fn(),
  del: vi.fn(),
  lookup: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(app)/attendance/actions", () => ({
  adminEditDayTimes: a.edit,
  adminDeletePunch: a.del,
  adminLookupDay: a.lookup,
}));
vi.mock("@/app/(app)/attendance/dashboard/actions", () => ({
  fetchEmployeeMonthDetail: a.detail,
  fetchCompOff: vi.fn(async () => ({ ok: true, data: [] })),
  convertToCompOff: vi.fn(),
  redeemCompOff: vi.fn(),
}));
vi.mock("@/app/(app)/attendance/leave/actions", () => ({ adminMarkLeave: vi.fn() }));

import { EmployeeDetailDialog } from "@/components/attendance/dashboard/employee-detail";

const IN_ISO = "2026-09-10T04:42:00.123Z";
const day = {
  logDate: "2026-09-10",
  weekday: 4,
  inAt: "10:12",
  outAt: null,
  isWeeklyOff: false,
  code: "incomplete",
  dayValue: 0,
  late: false,
  leftEarly: false,
  lateWaived: false,
  workedMinutes: 0,
};

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
  a.detail.mockResolvedValue({ ok: true, data: { employeeId: "e1", days: [day], summary: {} } });
  a.lookup.mockResolvedValue({
    ok: true,
    day: { employeeName: "Alpha One", date: "2026-09-10", punches: { in: { time: "10:12", loggedAt: IN_ISO }, out: null }, salaryRun: { month: "2026-09", disbursed: true } },
  });
  a.edit.mockResolvedValue({ ok: true });
  a.del.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

async function openRow() {
  render(<EmployeeDetailDialog open onOpenChange={() => {}} employeeId="e1" employeeName="Alpha One" year={2026} month={9} />);
  fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
  await waitFor(() => expect(a.lookup).toHaveBeenCalledWith({ employeeId: "e1", logDate: "2026-09-10" }));
}

describe("admin day editor", () => {
  it("shows the salary-run notice for the month", async () => {
    await openRow();
    expect((await screen.findByText(/Salary for 2026-09 has already been generated and disbursed/)).textContent).toMatch(/will not update that salary run/);
  });

  it("can't save without an explanation; then saves once, with reason, explanation and snapshot", async () => {
    await openRow();
    const save = await screen.findByRole("button", { name: /Save/ });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Machine was off; supervisor confirmed." } });
    fireEvent.change(screen.getByLabelText("Check-out"), { target: { value: "18:30" } });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(a.edit).toHaveBeenCalledTimes(1));
    expect(a.edit).toHaveBeenCalledWith({
      employeeId: "e1",
      logDate: "2026-09-10",
      inHHmm: "10:12",
      outHHmm: "18:30",
      reason: "correction",
      explanation: "Machine was off; supervisor confirmed.",
      snapshot: { in: IN_ISO, out: null },
    });
  });

  it("removal asks for confirmation and carries the reason, explanation and snapshot", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openRow();
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Duplicate punch from a test device." } });
    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    expect(a.del).not.toHaveBeenCalled(); // declined
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(a.del).toHaveBeenCalledTimes(1));
    expect(a.del).toHaveBeenCalledWith({
      employeeId: "e1",
      logDate: "2026-09-10",
      kind: "in",
      reason: "correction",
      explanation: "Duplicate punch from a test device.",
      snapshot: { in: IN_ISO, out: null },
    });
    confirm.mockRestore();
  });

  it("shows the server's refusal (e.g. your own attendance) and offers no save", async () => {
    a.lookup.mockResolvedValue({ ok: false, error: "You can't change your own attendance. Ask another authorised person to make this correction." });
    await openRow();
    expect((await screen.findByRole("alert")).textContent).toMatch(/your own attendance/);
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
