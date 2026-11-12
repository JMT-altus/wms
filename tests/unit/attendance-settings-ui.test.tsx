// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};

const m = vi.hoisted(() => ({ shifts: vi.fn(), grace: vi.fn(), hl: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(admin)/admin/attendance-settings/actions", () => ({ saveWorkShifts: m.shifts, saveGrace: m.grace, saveHoursHighlight: m.hl }));
vi.mock("@/lib/toast", () => ({ fireToast: m.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

import { AttendanceSettingsPanel } from "@/components/admin/attendance-settings";

// The settings screen: what it shows and what it sends. Rules and permissions are server-side (see the db test).
const legacy = { lateAfter: "10:50", earlyBefore: "19:20", fullDayMinutes: 540, halfDayMinutes: 300 };
const base = {
  today: "2026-11-07",
  minDate: "2026-11-01",
  paidThrough: null,
  readError: null,
  legacy,
  people: [{ id: "11111111-1111-4111-8111-111111111111", name: "Alpha One" }],
  departments: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Store" }],
  overrides: [],
  upcoming: [],
  history: [],
};
const saved = { id: "general", name: "General", start: "09:00", end: "18:00", workingHours: 8.5, active: true, isDefault: true, employeeIds: [], departmentIds: [] };

beforeEach(() => {
  m.shifts.mockReset().mockResolvedValue({ ok: true, message: "Shifts saved" });
  m.grace.mockReset().mockResolvedValue({ ok: true, message: "Check-in grace saved" });
  m.toast.mockReset();
  m.refresh.mockReset();
});
afterEach(cleanup);

describe("Attendance Settings panel", () => {
  it("shows the three sections and, with nothing configured, the company times in use", () => {
    render(<AttendanceSettingsPanel {...base} current={{ shifts: null, checkIn: null, checkOut: null, hoursHighlight: null }} />);
    for (const t of ["Work Shift Configuration", "Check-in Grace Period", "Check-out Grace Period", "Change history"]) expect(screen.getByRole("heading", { name: t })).toBeTruthy();
    expect(screen.getByText(/No shifts yet/)).toBeTruthy();
    expect(screen.getByText("10:50")).toBeTruthy();
  });

  it("previews the on-time window from the shift and the grace, and sends the shift list with date and reason", async () => {
    render(<AttendanceSettingsPanel {...base} current={{ shifts: { shifts: [saved] }, checkIn: { enabled: true, minutes: 15 }, checkOut: { enabled: true, minutes: 10 }, hoursHighlight: null }} />);
    expect(screen.getByText(/check-in up to 09:15 is on time/)).toBeTruthy();
    expect(screen.getByText(/check-out from 17:50 is on time/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Shift 1 start"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByLabelText("Shifts reason"), { target: { value: "New timings" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]!);
    await waitFor(() => expect(m.shifts).toHaveBeenCalledTimes(1));
    expect(m.shifts).toHaveBeenCalledWith({ shifts: [{ ...saved, start: "09:30" }], effectiveFrom: "2026-11-07", reason: "New timings" });
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ type: "success", message: "Shifts saved" }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it("check-in and check-out grace are saved independently", async () => {
    render(<AttendanceSettingsPanel {...base} current={{ shifts: { shifts: [saved] }, checkIn: null, checkOut: null, hoursHighlight: null }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Check-in grace enabled" }));
    fireEvent.change(screen.getByLabelText("Check-in grace minutes"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Check-in grace reason"), { target: { value: "Traffic" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[1]!);
    await waitFor(() => expect(m.grace).toHaveBeenCalledWith({ key: "check_in_grace", enabled: true, minutes: 15, effectiveFrom: "2026-11-07", reason: "Traffic" }));
    expect(m.shifts).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as an error message", async () => {
    m.grace.mockResolvedValue({ ok: false, error: "Salary is already generated for 2026-11, so a change can take effect from 01/12/26 at the earliest." });
    render(<AttendanceSettingsPanel {...base} current={{ shifts: null, checkIn: null, checkOut: null, hoursHighlight: null }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[2]!);
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ type: "error", message: expect.stringMatching(/Salary is already generated/) }));
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("adds a shift (the first new one becomes the default) and lists employees with personal times", () => {
    render(<AttendanceSettingsPanel {...base} overrides={[{ name: "Beta Two", lateAfter: "10:00:00", earlyBefore: null }]} current={{ shifts: null, checkIn: null, checkOut: null, hoursHighlight: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /Add shift/ }));
    expect(screen.getAllByTestId("shift-row")).toHaveLength(1);
    expect((screen.getByLabelText("Shift 1 is the default") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Beta Two \(late after 10:00\)/)).toBeTruthy();
  });
});

describe("Daily Hours Highlight card", () => {
  it("starts at 8h 30m / 9h 30m and saves changed limits in minutes, with date and reason", async () => {
    m.hl.mockResolvedValue({ ok: true, message: "Daily hours highlight saved" });
    render(<AttendanceSettingsPanel {...base} current={{ shifts: null, checkIn: null, checkOut: null, hoursHighlight: null }} />);
    expect(screen.getByRole("heading", { name: "Daily Hours Highlight" })).toBeTruthy();
    expect((screen.getByLabelText("Short-day limit hours") as HTMLInputElement).value).toBe("8");
    expect((screen.getByLabelText("Short-day limit minutes") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Long-day limit hours") as HTMLInputElement).value).toBe("9");
    fireEvent.change(screen.getByLabelText("Short-day limit minutes"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Hours highlight reason"), { target: { value: "New norm" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[3]!);
    await waitFor(() => expect(m.hl).toHaveBeenCalledWith({ shortBelowMinutes: 480, longAboveMinutes: 570, effectiveFrom: "2026-11-07", reason: "New norm" }));
  });
});
