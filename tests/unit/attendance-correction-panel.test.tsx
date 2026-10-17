// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// jsdom has no ResizeObserver, which the searchable dropdown library uses.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};

const m = vi.hoisted(() => ({ lookup: vi.fn(), preview: vi.fn(), save: vi.fn() }));
vi.mock("@/app/(app)/hr/attendance-correction/actions", () => ({
  lookupDay: m.lookup,
  previewCorrection: m.preview,
  saveCorrection: m.save,
}));

import { AttendanceCorrectionPanel } from "@/components/hr/attendance-correction-panel";

const EMP = "11111111-1111-4111-8111-111111111111";
const people = [{ id: EMP, name: "Alpha One", email: "alpha@example.test" }];
const IN_ISO = "2026-04-01T04:40:00.000Z";

const day = {
  employee: { id: EMP, name: "Alpha One", email: "alpha@example.test", timezone: "Asia/Kolkata", joinDay: "2026-01-05" },
  date: "2026-04-01",
  punches: { in: { time: "10:10", loggedAt: IN_ISO, source: "self", reason: null, note: null }, out: null },
  grade: { code: "incomplete", late: false, leftEarly: false, workedMinutes: 0 },
};
const review = {
  employee: { id: EMP, name: "Alpha One", email: "alpha@example.test" },
  date: "2026-04-01",
  existing: day.punches,
  changes: [{ kind: "out", action: "add", from: null, to: "18:30" }],
  finalIn: "10:10",
  finalOut: "18:30",
  reason: { code: "power_failure", label: "Power failure" },
  explanation: "Power cut from 9 to 11:30, machine was off.",
  keepsNotes: [],
  warnings: [],
};

async function openDay() {
  render(<AttendanceCorrectionPanel people={people} today="2026-10-17" />);
  fireEvent.click(screen.getByText("Choose employee…"));
  fireEvent.click(await screen.findByText(/Alpha One · alpha@example\.test/));
  fireEvent.change(screen.getByLabelText("Attendance date"), { target: { value: "2026-04-01" } });
  await screen.findByText("Stored IN");
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("OUT time"), { target: { value: "18:30" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "power_failure" } });
  fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Power cut from 9 to 11:30, machine was off." } });
}

beforeEach(() => {
  m.lookup.mockReset().mockResolvedValue({ ok: true, day });
  m.preview.mockReset().mockResolvedValue({ ok: true, review });
  m.save.mockReset();
});
afterEach(cleanup);

describe("AttendanceCorrectionPanel", () => {
  it("shows the stored times, and keeps Review disabled until times, reason and explanation are given", async () => {
    await openDay();
    expect(m.lookup).toHaveBeenLastCalledWith({ employeeId: EMP, date: "2026-04-01" });
    expect(screen.getByText("10:10")).toBeTruthy();
    expect(screen.getByText("Not recorded")).toBeTruthy();
    const reviewBtn = screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("OUT time"), { target: { value: "18:30" } });
    expect(reviewBtn.disabled).toBe(true); // no reason yet
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "power_failure" } });
    expect(reviewBtn.disabled).toBe(true); // no explanation yet
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Power cut from 9 to 11:30, machine was off." } });
    expect(reviewBtn.disabled).toBe(false);
  });

  it("asks for a fuller explanation when Other is chosen", async () => {
    await openDay();
    fireEvent.change(screen.getByLabelText("OUT time"), { target: { value: "18:30" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "machine broke" } });
    expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/"Other" needs a fuller explanation/)).toBeTruthy();
  });

  it("reviews first, saves only after the explicit confirmation, and shows the saved result", async () => {
    m.save.mockResolvedValue({
      ok: true,
      saved: {
        date: "2026-04-01", employeeName: "Alpha One", in: "10:10", out: "18:30",
        changes: review.changes, reason: review.reason, grade: { code: "P", late: false, leftEarly: false, workedMinutes: 500 },
      },
    });
    await openDay();
    fillForm();
    expect(screen.queryByRole("button", { name: "Save correction" })).toBeNull(); // nothing to save before the review

    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByText("Review and confirm");
    expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, date: "2026-04-01", outTime: "18:30", reason: "power_failure", snapshot: { in: IN_ISO, out: null } }));
    expect(screen.getByText("Add OUT 18:30")).toBeTruthy();

    const saveBtn = screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have checked these times/));
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true, snapshot: { in: IN_ISO, out: null } }));
    expect(await screen.findByText("Correction saved")).toBeTruthy();
    expect(screen.getByText(/It appears in the attendance report/)).toBeTruthy();
    expect(m.lookup).toHaveBeenCalledTimes(2); // the stored times were reloaded
  });

  it("shows the server's message and saves nothing when the day changed meanwhile", async () => {
    m.save.mockResolvedValue({ ok: false, error: "This day was changed by someone else after you opened it. Nothing was saved. Reload the day and review it again." });
    await openDay();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByText("Review and confirm");
    fireEvent.click(screen.getByLabelText(/I have checked these times/));
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy();
    expect(screen.queryByText("Correction saved")).toBeNull();
  });

  it("shows a rule failure from the review step instead of the confirmation", async () => {
    m.preview.mockResolvedValue({ ok: false, error: "OUT (09:00) can't be earlier than IN (10:10). Overnight shifts aren't supported here." });
    await openDay();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(await screen.findByText(/can't be earlier than IN/)).toBeTruthy();
    expect(screen.queryByText("Review and confirm")).toBeNull();
  });
});
