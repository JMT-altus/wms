// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// jsdom has no ResizeObserver, which the searchable dropdown library uses.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};

const m = vi.hoisted(() => ({ month: vi.fn(), lookup: vi.fn(), preview: vi.fn(), save: vi.fn(), wPreview: vi.fn(), waive: vi.fn(), reverse: vi.fn() }));
vi.mock("@/app/(app)/hr/attendance-correction/waiver-actions", () => ({ previewWaiver: m.wPreview, waiveDay: m.waive, reverseWaiver: m.reverse }));
vi.mock("@/app/(app)/hr/attendance-correction/actions", () => ({
  loadMonth: m.month,
  lookupDay: m.lookup,
  previewCorrection: m.preview,
  saveCorrection: m.save,
}));

import { AttendanceCorrectionPanel } from "@/components/hr/attendance-correction-panel";
import { fmtDate } from "@/lib/dates";

// HR attendance correction, employee-wise by month: the server actions are mocked, so these tests check the page's
// behaviour (what it loads, shows, sends and refreshes) — the actions' own rules are covered in attendance-correction-actions.test.ts.

const EMP = "11111111-1111-4111-8111-111111111111";
const people = [{ id: EMP, name: "Alpha One", email: "alpha@example.test" }];
const IN_ISO = "2026-04-02T04:40:00.000Z";

const d = (date: string, code: string, inAt: string | null, outAt: string | null, workedMinutes = 0) => ({
  logDate: date,
  weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  inAt,
  outAt,
  isWeeklyOff: code === "W/O",
  code,
  dayValue: 1,
  late: false,
  leftEarly: false,
  lateWaived: false,
  workedMinutes,
});
// April 2026, "today" = Fri 10 Apr. Week 1 = Wed 1 – Sun 5, week 2 = Mon 6 – Sun 12, …
const days = [
  d("2026-04-01", "P", "09:30", "18:30", 540),
  d("2026-04-02", "incomplete", "10:10", null), // IN without OUT → needs correction
  d("2026-04-03", "A", null, null),
  d("2026-04-04", "P", "09:30", "18:00", 510),
  d("2026-04-05", "W/O", null, null),
  d("2026-04-06", "H", null, null),
  d("2026-04-07", "H/D", "09:30", "13:30", 240),
  d("2026-04-08", "P", "09:30", "18:30", 540),
  d("2026-04-09", "P", "09:30", "18:30", 540),
  d("2026-04-10", "P", "09:30", null), // today, not checked out yet — NOT flagged
];
const monthView = (over: Record<string, unknown> = {}) => ({
  ok: true,
  view: { employee: { id: EMP, name: "Alpha One", email: "alpha@example.test", timezone: "Asia/Kolkata", joinDay: "2026-01-05" }, month: "2026-04", today: "2026-04-10", days, bands: {}, highlight: { shortBelowMinutes: 510, longAboveMinutes: 570 }, waivers: [], canWaive: false, ...over },
});

const day = {
  employee: { id: EMP, name: "Alpha One", email: "alpha@example.test", timezone: "Asia/Kolkata", joinDay: "2026-01-05" },
  date: "2026-04-02",
  punches: { in: { time: "10:10", loggedAt: IN_ISO, source: "self", reason: null, note: null }, out: null },
  grade: { code: "incomplete", late: false, leftEarly: false, workedMinutes: 0 },
};
const review = {
  employee: { id: EMP, name: "Alpha One", email: "alpha@example.test" },
  date: "2026-04-02",
  existing: day.punches,
  changes: [{ kind: "out", action: "add", from: null, to: "18:30" }],
  finalIn: "10:10",
  finalOut: "18:30",
  reason: { code: "power_failure", label: "Power failure" },
  explanation: "Power cut from 9 to 11:30, machine was off.",
  keepsNotes: [],
  warnings: [],
  salaryRun: null,
};

async function pickEmployee() {
  render(<AttendanceCorrectionPanel people={people} currentMonth="2026-04" />);
  fireEvent.click(screen.getByText("Choose employee…"));
  fireEvent.click(await screen.findByText(/Alpha One · alpha@example\.test/));
  await screen.findByLabelText("Month summary");
}
async function openEditor(date = "2026-04-02") {
  await pickEmployee();
  fireEvent.click(screen.getByRole("button", { name: `Edit ${fmtDate(date)}` }));
  await screen.findByText("Original (stored)");
}
function fillForm() {
  fireEvent.change(screen.getByLabelText("Corrected check-out"), { target: { value: "18:30" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "power_failure" } });
  fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Power cut from 9 to 11:30, machine was off." } });
}

beforeEach(() => {
  m.month.mockReset().mockResolvedValue(monthView());
  m.lookup.mockReset().mockResolvedValue({ ok: true, day });
  m.preview.mockReset().mockResolvedValue({ ok: true, review });
  m.save.mockReset();
});
afterEach(cleanup);

describe("Attendance Correction — choosing the employee and the month", () => {
  it("loads the chosen employee's current month once, with the monthly summary from the attendance report", async () => {
    await pickEmployee();
    expect(m.month).toHaveBeenCalledTimes(1);
    expect(m.month).toHaveBeenCalledWith({ employeeId: EMP, month: "2026-04" });
    const summary = within(screen.getByLabelText("Month summary"));
    const fig = (label: string) => summary.getByText(label).nextElementSibling?.textContent;
    expect(fig("Present")).toBe("5"); // 1, 4, 8, 9, 10 Apr
    expect(fig("Absent")).toBe("1");
    expect(fig("Half days")).toBe("1");
    expect(fig("Holidays")).toBe("1");
    expect(fig("Weekly offs")).toBe("1");
    expect(fig("Work hours")).toBe("39h 30m"); // only days with both punches: 540+510+240+540+540 min
    expect(fig("To correct")).toBe("1"); // 2 Apr (IN, no OUT); today is not flagged
  });

  it("changes month with the arrows (never past the current month) and reloads for the same employee", async () => {
    await pickEmployee();
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(m.month).toHaveBeenLastCalledWith({ employeeId: EMP, month: "2026-03" }));
  });

  it("shows the server's message when the month can't be loaded", async () => {
    m.month.mockResolvedValue({ ok: false, error: "That month hasn't started yet." });
    render(<AttendanceCorrectionPanel people={people} currentMonth="2026-04" />);
    fireEvent.click(screen.getByText("Choose employee…"));
    fireEvent.click(await screen.findByText(/Alpha One · alpha@example\.test/));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("hasn't started"));
  });
});

describe("Attendance Correction — weeks and days", () => {
  it("shows the weeks with their counts and hours, opening the week that needs correction and the current week", async () => {
    await pickEmployee();
    const w1 = screen.getByRole("button", { name: /Week 1/ });
    expect(w1.textContent).toMatch(/2 present/); // 1 and 4 Apr
    expect(w1.textContent).toMatch(/1 absent/);
    expect(w1.textContent).toMatch(/1 weekly off/);
    expect(w1.textContent).toMatch(/0 holidays/);
    expect(w1.textContent).toMatch(/1 to check/);
    expect(w1.getAttribute("aria-expanded")).toBe("true"); // has the 2 Apr gap
    expect(screen.getByRole("button", { name: /Week 2/ }).getAttribute("aria-expanded")).toBe("true"); // current week
    expect(screen.getByRole("button", { name: /Week 3/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByLabelText("Week 1 work hours").textContent).toBe("17h 30m");
    // The day table has exactly the agreed columns.
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "Day", "Status", "Check-in", "Check-out", "Work hours", "Action"]);
    expect(screen.getByText("missing")).toBeTruthy(); // 2 Apr's absent check-out
  });

  it("offers Edit for past days and today, not for upcoming days", async () => {
    await pickEmployee();
    expect(screen.getByRole("button", { name: `Edit ${fmtDate("2026-04-10")}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Week 3/ }));
    const w3 = screen.getAllByRole("table").at(-1)!;
    expect(within(w3).queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(within(w3).getAllByText("Upcoming").length).toBe(7);
  });
});

describe("Attendance Correction — the day editor", () => {
  it("shows the original stored values beside the corrected inputs, and keeps Review disabled until times, reason and explanation are given", async () => {
    await openEditor();
    expect(m.lookup).toHaveBeenLastCalledWith({ employeeId: EMP, date: "2026-04-02" });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("10:10")).toBeTruthy();
    expect(dialog.getByText("Not recorded")).toBeTruthy();
    const reviewBtn = dialog.getByRole("button", { name: "Review changes" }) as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText("Corrected check-out"), { target: { value: "18:30" } });
    expect(reviewBtn.disabled).toBe(true); // no reason yet
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "power_failure" } });
    expect(reviewBtn.disabled).toBe(true); // no explanation yet
    fireEvent.change(dialog.getByLabelText("Explanation"), { target: { value: "Power cut from 9 to 11:30, machine was off." } });
    expect(reviewBtn.disabled).toBe(false);
  });

  it("asks for a fuller explanation when Other is chosen", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Corrected check-out"), { target: { value: "18:30" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "machine broke" } });
    expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/"Other" needs a fuller explanation/)).toBeTruthy();
  });

  it("reviews first, saves only after the confirmation, then closes, reports success and reloads the month", async () => {
    m.save.mockResolvedValue({
      ok: true,
      saved: {
        date: "2026-04-02", employeeName: "Alpha One", in: "10:10", out: "18:30",
        changes: review.changes, reason: review.reason, grade: { code: "P", late: false, leftEarly: false, workedMinutes: 500 },
      },
    });
    await openEditor();
    fillForm();
    const saveBtn = screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true); // nothing to save before the review

    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByText("Review and confirm");
    expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, date: "2026-04-02", outTime: "18:30", reason: "power_failure", snapshot: { in: IN_ISO, out: null } }));
    expect(screen.getByText("Add OUT 18:30")).toBeTruthy();
    expect(saveBtn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have checked these times/));
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true, snapshot: { in: IN_ISO, out: null } }));
    expect(await screen.findByText(/Correction saved/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(m.month).toHaveBeenCalledTimes(2)); // day, week and month totals recalculated
    expect(m.month).toHaveBeenLastCalledWith({ employeeId: EMP, month: "2026-04" });
  });

  it("shows the server's message and saves nothing when the day changed meanwhile", async () => {
    m.save.mockResolvedValue({ ok: false, error: "This day was changed by someone else after you opened it. Nothing was saved. Reload the day and review it again." });
    await openEditor();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByText("Review and confirm");
    fireEvent.click(screen.getByLabelText(/I have checked these times/));
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy();
    expect(screen.queryByText(/Correction saved/)).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy(); // stays open
    expect(m.month).toHaveBeenCalledTimes(1);
  });

  it("shows a rule failure from the review step instead of the confirmation", async () => {
    m.preview.mockResolvedValue({ ok: false, error: "OUT (09:00) can't be earlier than IN (10:10). Overnight shifts aren't supported here." });
    await openEditor();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(await screen.findByText(/can't be earlier than IN/)).toBeTruthy();
    expect(screen.queryByText("Review and confirm")).toBeNull();
  });

  it("Cancel closes the editor without saving", async () => {
    await openEditor();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.preview).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });
});

describe("Attendance Correction — hours highlight and waivers", () => {
  const preview = {
    employee: { id: EMP, name: "Alpha One", email: "alpha@example.test" },
    date: "2026-04-03",
    current: { code: "A", label: "Absent", dayValue: 0, late: false, leftEarly: false, lateWaived: false, inAt: null, outAt: null, workedMinutes: 0 },
    payable: { before: 0, after: 1 },
    removesLateMark: false,
    removesEarlyMark: false,
    salaryRun: { month: "2026-04", disbursed: false },
  };

  it("colours days by the server's bands and counts them in the summary; other days look normal", async () => {
    m.month.mockResolvedValue(monthView({ bands: { "2026-04-01": "long", "2026-04-07": "short" } }));
    await pickEmployee();
    const row = (date: string) => screen.getByRole("button", { name: `Edit ${fmtDate(date)}` }).closest("tr")!;
    expect(row("2026-04-01").getAttribute("data-hours")).toBe("long");
    expect(row("2026-04-07").getAttribute("data-hours")).toBe("short");
    expect(row("2026-04-04").getAttribute("data-hours")).toBe("normal");
    const summary = within(screen.getByLabelText("Month summary"));
    expect(summary.getByText("Under 8h 30m").nextElementSibling?.textContent).toBe("1");
    expect(summary.getByText("Over 9h 30m").nextElementSibling?.textContent).toBe("1");
    expect(screen.getByLabelText("Hours highlight legend").textContent).toMatch(/Display only/);
  });

  it("without the waiver permission there are no Waive actions", async () => {
    await pickEmployee();
    expect(screen.queryByRole("button", { name: /^Waive / })).toBeNull();
  });

  it("offers Waive only where something can be waived, and waives after preview, reason and confirmation", async () => {
    m.month.mockResolvedValue(monthView({ canWaive: true }));
    m.wPreview.mockResolvedValue({ ok: true, preview });
    m.waive.mockResolvedValue({ ok: true, waived: { date: "2026-04-03", employeeName: "Alpha One" } });
    await pickEmployee();
    expect(screen.getByRole("button", { name: `Waive ${fmtDate("2026-04-03")}` })).toBeTruthy(); // absent
    expect(screen.getByRole("button", { name: `Waive ${fmtDate("2026-04-02")}` })).toBeTruthy(); // no check-out
    expect(screen.queryByRole("button", { name: `Waive ${fmtDate("2026-04-01")}` })).toBeNull(); // complete day
    expect(screen.queryByRole("button", { name: `Waive ${fmtDate("2026-04-05")}` })).toBeNull(); // weekly off

    fireEvent.click(screen.getByRole("button", { name: `Waive ${fmtDate("2026-04-03")}` }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(m.wPreview).toHaveBeenCalledWith({ employeeId: EMP, date: "2026-04-03" });
    await dialog.findByText(/0 payable days/);
    expect(dialog.getByText(/already generated/)).toBeTruthy(); // salary-run warning
    const go = dialog.getByRole("button", { name: "Waive attendance" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText("Waiver reason"), { target: { value: "Approved client visit" } });
    expect(go.disabled).toBe(true); // not confirmed yet
    fireEvent.click(dialog.getByLabelText(/I confirm waiving/));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(m.waive).toHaveBeenCalledWith({ employeeId: EMP, date: "2026-04-03", reason: "Approved client visit", confirmed: true }));
    expect(await screen.findByText(/Attendance waived — Alpha One/)).toBeTruthy();
    await waitFor(() => expect(m.month).toHaveBeenCalledTimes(2)); // totals recalculated
  });

  it("shows a waived day distinctly, with who / when / why, and reverses it with a reason", async () => {
    const waiver = { id: "99999999-9999-4999-8999-999999999999", date: "2026-04-03", reason: "Approved client visit", waivedBy: "Hr Person", waivedAt: "2026-04-04T05:00:00.000Z", reversedBy: null, reversedAt: null, reverseReason: null };
    const waivedDays = days.map((x) => (x.logDate === "2026-04-03" ? { ...x, code: "WV", dayValue: 1 } : x));
    m.month.mockResolvedValue(monthView({ canWaive: true, days: waivedDays, waivers: [waiver] }));
    m.reverse.mockResolvedValue({ ok: true, reversed: { date: "2026-04-03" } });
    await pickEmployee();
    const row = screen.getByRole("button", { name: `Reverse waiver ${fmtDate("2026-04-03")}` }).closest("tr")!;
    expect(row.getAttribute("data-status")).toBe("waived");
    expect(within(row).getByText("Waived")).toBeTruthy();
    expect(within(row).getByText(/by Hr Person/)).toBeTruthy();
    expect(within(screen.getByLabelText("Waiver history")).getByText("Approved client visit")).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: /Reverse waiver/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const go = dialog.getByRole("button", { name: "Reverse waiver" }) as HTMLButtonElement;
    fireEvent.change(dialog.getByLabelText("Reversal reason"), { target: { value: "Visit not approved" } });
    fireEvent.click(dialog.getByLabelText(/I confirm reversing/));
    fireEvent.click(go);
    await waitFor(() => expect(m.reverse).toHaveBeenCalledWith({ waiverId: waiver.id, reason: "Visit not approved", confirmed: true }));
    expect(await screen.findByText(/Waiver reversed/)).toBeTruthy();
  });
});
