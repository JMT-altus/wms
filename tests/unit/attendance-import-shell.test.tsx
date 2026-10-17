// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// These render the page and load the spreadsheet library lazily; allow for a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const m = vi.hoisted(() => ({
  lookup: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/app/(app)/hr/attendance-import/actions", () => ({
  previewAttendanceImport: vi.fn(),
  runAttendanceImport: vi.fn(),
}));
vi.mock("@/app/(app)/hr/attendance-import/mapping-actions", () => ({
  lookupSavedMappings: m.lookup,
  saveConfirmedMappings: m.save,
}));

import { AttendanceImportShell } from "@/components/hr/attendance-import-shell";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const people = [
  { id: A, name: "Alpha One", email: "alpha@example.test" },
  { id: B, name: "Gamma Two", email: "gamma@example.test" },
];

const CSV = [
  "Employee Code,Employee Name,Date,In Time,Out Time",
  "7,Alpha,2026-04-01,09:30,18:00",
  "8,Gamma,2026-04-01,10:00,19:00",
].join("\n");

async function upload() {
  const { container } = render(<AttendanceImportShell people={people} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([CSV], "april.csv", { type: "text/csv" });
  (file as unknown as { text: () => Promise<string> }).text = async () => CSV;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText(/Match each person to a JMT employee/);
  return container;
}

beforeEach(() => {
  m.lookup.mockReset();
  m.save.mockReset();
});
afterEach(cleanup);

describe("AttendanceImportShell: structure", () => {
  it("accepts Excel and CSV files and says the file is read in the browser", () => {
    m.lookup.mockResolvedValue({ ok: true, suggestions: {} });
    const { container } = render(<AttendanceImportShell people={[]} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain(".xlsx");
    expect(input.accept).toContain(".csv");
    expect(screen.getByText(/read in your browser/i)).toBeTruthy();
  });

  it("starts with only the file step", () => {
    render(<AttendanceImportShell people={[]} />);
    expect(screen.getByText("Choose the attendance file")).toBeTruthy();
    expect(screen.queryByText("Check import")).toBeNull();
    expect(screen.queryByText(/Match each person/)).toBeNull();
  });
});

describe("AttendanceImportShell: saved matches", () => {
  const suggestions = {
    "7": { status: "matched", employeeId: A, name: "Alpha One", email: "alpha@example.test", confirmedAt: "2026-10-01T00:00:00.000Z" },
    "8": {
      status: "unresolved",
      reason: "name_changed",
      message: 'Code 8 was saved for "Gamma Old" but this file says "Gamma". The code may now belong to someone else, so it was not matched automatically.',
      saved: { employeeId: B, employeeName: "Gamma Two", nameInFile: "Gamma Old" },
    },
  };

  it("pre-selects a verified match and leaves a flagged code unselected with its reason", async () => {
    m.lookup.mockResolvedValue({ ok: true, suggestions });
    await upload();
    expect(await screen.findByText(/Matched from your saved match for code 7/)).toBeTruthy();
    expect(screen.getByText("1 of 2 decided")).toBeTruthy();
    expect(screen.getByText(/Needs your choice\. Code 8 was saved for "Gamma Old"/)).toBeTruthy();
    // The chosen person is shown by name and email in the select.
    expect(screen.getAllByText(/Alpha One · alpha@example\.test/).length).toBeGreaterThan(0);
    // Check stays blocked until the flagged row is decided.
    expect((screen.getByRole("button", { name: /Check import/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never selects anyone when the server finds nothing, even if a name looks right", async () => {
    m.lookup.mockResolvedValue({
      ok: true,
      suggestions: {
        "7": { status: "unresolved", reason: "unknown_code", message: "Code 7 has no saved match yet.", saved: null },
        "8": { status: "unresolved", reason: "unknown_code", message: "Code 8 has no saved match yet.", saved: null },
      },
    });
    await upload();
    expect(await screen.findByText("0 of 2 decided")).toBeTruthy();
    expect(screen.getAllByText(/Needs your choice/).length).toBe(2);
  });

  it("lets HR correct a flagged row, then remember it only after an explicit review", async () => {
    m.lookup.mockResolvedValue({ ok: true, suggestions });
    m.save.mockResolvedValue({ ok: true, saved: { created: 1, changed: 0, confirmed: 0, unchanged: 0 } });
    await upload();
    await screen.findByText("1 of 2 decided");

    // HR picks the person for code 8 (the one-click suggestion).
    fireEvent.click(await screen.findByRole("button", { name: "Gamma Two" }));
    expect(await screen.findByText("2 of 2 decided")).toBeTruthy();

    // Only the new row is offered; the matched row is already saved.
    const remember = screen.getByRole("button", { name: /Remember these matches for next time \(1\)/ });
    expect((remember as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(remember);

    const saveBtn = screen.getByRole("button", { name: /Save 1 match/ }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true); // not until the review box is ticked
    fireEvent.click(screen.getByLabelText(/I have reviewed these matches/));
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
    expect(m.save).toHaveBeenCalledWith({
      items: [{ code: "8", name: "Gamma", employeeId: B, replace: undefined }],
      acknowledged: true,
    });
    expect(await screen.findByText(/Saved: 1 new, 0 changed, 0 re-confirmed/)).toBeTruthy();
  });

  it("shows a conflict and only retries with the explicit replace ticked", async () => {
    m.lookup.mockResolvedValue({ ok: true, suggestions });
    m.save
      .mockResolvedValueOnce({
        ok: false,
        error: "Some matches would change an existing link. Review them and confirm each change.",
        conflicts: [{ code: "8", employeeId: B, employeeName: "Gamma Two", messages: ["Code 8 is already saved for Gamma Old. Saving would move it to Gamma Two."] }],
      })
      .mockResolvedValueOnce({ ok: true, saved: { created: 0, changed: 1, confirmed: 0, unchanged: 0 } });
    await upload();
    await screen.findByText("1 of 2 decided");
    fireEvent.click(await screen.findByRole("button", { name: "Gamma Two" }));
    fireEvent.click(screen.getByRole("button", { name: /Remember these matches/ }));
    fireEvent.click(screen.getByLabelText(/I have reviewed these matches/));
    fireEvent.click(screen.getByRole("button", { name: /Save 1 match/ }));

    expect(await screen.findByText(/Saving would move it to Gamma Two/)).toBeTruthy();
    expect(m.save).toHaveBeenLastCalledWith({ items: [{ code: "8", name: "Gamma", employeeId: B, replace: undefined }], acknowledged: true });

    fireEvent.click(screen.getByLabelText(/Yes, change the existing link for code 8/));
    fireEvent.click(screen.getByRole("button", { name: /Save 1 match/ }));
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
    expect(m.save).toHaveBeenLastCalledWith({ items: [{ code: "8", name: "Gamma", employeeId: B, replace: true }], acknowledged: true });
  });

  it("falls back to manual choice, with a notice, when saved matches cannot be loaded", async () => {
    m.lookup.mockResolvedValue({ ok: false, error: "Forbidden" });
    await upload();
    expect(await screen.findByText(/Saved matches could not be loaded/)).toBeTruthy();
    expect(screen.getByText("0 of 2 decided")).toBeTruthy();
  });
});
