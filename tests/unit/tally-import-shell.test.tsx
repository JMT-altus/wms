// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

// The Tally Data Import page, with the server actions MOCKED. Files are real CSV bytes, read by the real reader.
const a = vi.hoisted(() => ({ check: vi.fn(), start: vi.fn(), chunk: vi.fn(), finish: vi.fn(), saved: vi.fn(), problems: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(forms-module)/forms/tally-import/actions", () => ({
  checkTallyChunk: (...x: unknown[]) => a.check(...x),
  startTallyImport: (...x: unknown[]) => a.start(...x),
  importTallyChunk: (...x: unknown[]) => a.chunk(...x),
  finishTallyImport: (...x: unknown[]) => a.finish(...x),
  getSavedTallyMapping: (...x: unknown[]) => a.saved(...x),
  getTallyBatchProblems: (...x: unknown[]) => a.problems(...x),
}));

import { TallyImportShell } from "@/components/admin/master/tally-import-shell";

const CSV = "Sales Register\n\nVoucher No.,Date,Party,Amount\nS/1,1-Apr-25,Alpha,100\nS/2,2-Apr-25,Beta,200\nGrand Total,,,300\n";
const fileOf = (text: string, name = "sales.csv") => {
  const f = new File([text], name);
  Object.defineProperty(f, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return f;
};
const pick = () => screen.getByLabelText("Tally export file") as HTMLInputElement;
const upload = async (file = fileOf(CSV)) => {
  fireEvent.click(screen.getByRole("button", { name: /Sales Invoices/ }));
  fireEvent.change(pick(), { target: { files: [file] } });
};
const ok = (rowNo: number, state = "valid", messages: string[] = []) => ({ rowNo, state, messages, recordKey: `k${rowNo}` });
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
  a.saved.mockResolvedValue(null);
  Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: { digest: async () => new ArrayBuffer(32) } });
});
afterEach(cleanup);

describe("before a file", () => {
  it("lists all ten categories and nothing says it's unbuilt", () => {
    render(<TallyImportShell canImport />);
    for (const name of ["Customer Master", "Vendor Master", "Sales Orders", "Sales Invoices", "Purchase Invoices", "Credit Notes", "Debit Notes", "Customer Receipts", "Vendor Payments", "Outstanding Balances"]) {
      expect(button(new RegExp(name))).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/not implemented/i);
    expect(button("Upload file").disabled).toBe(true);
    expect(button("Import").disabled).toBe(true);
  });

  it("without the permission it says so and validation stays off, even with a file", async () => {
    render(<TallyImportShell canImport={false} />);
    expect(screen.getByRole("note").textContent).toMatch(/Tally Data Import — Upload and import/);
    await upload();
    await screen.findByRole("table", { name: "File preview" });
    expect(button("Validate").disabled).toBe(true);
    expect(a.check).not.toHaveBeenCalled();
  });

  it("says what's missing while migration 0122 isn't applied", () => {
    render(<TallyImportShell canImport storageReady={false} />);
    expect(screen.getByRole("status").textContent).toMatch(/database update 0122/);
  });
});

describe("the file", () => {
  it("refuses a wrong type with the reason", async () => {
    render(<TallyImportShell canImport />);
    await upload(fileOf("x", "macro.xlsm"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/aren't accepted/);
    expect(screen.queryByRole("table", { name: "File preview" })).toBeNull();
  });

  it("finds the headings under the title, previews rows with their sheet row numbers, and suggests a mapping", async () => {
    render(<TallyImportShell canImport />);
    await upload();
    const table = await screen.findByRole("table", { name: "File preview" });
    expect(within(table).getByText("Voucher No.")).toBeTruthy();
    expect(within(table).getByText("S/1")).toBeTruthy();
    expect(within(table).getByRole("cell", { name: "4" })).toBeTruthy();
    expect((screen.getByLabelText("Document number") as HTMLSelectElement).value).toBe("0");
    expect((screen.getByLabelText("Total amount") as HTMLSelectElement).value).toBe("3");
    expect(a.check).not.toHaveBeenCalled(); // uploading imports nothing
    expect(a.start).not.toHaveBeenCalled();
  });

  it("names unmapped required fields and blocks validation until they are fixed", async () => {
    render(<TallyImportShell canImport />);
    await upload();
    await screen.findByRole("table", { name: "File preview" });
    fireEvent.change(screen.getByLabelText("Total amount"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Total amount is required/);
    expect(button("Validate").disabled).toBe(true);
  });

  it("outstanding needs an as-of date and direction before validating", async () => {
    render(<TallyImportShell canImport />);
    fireEvent.click(button(/Outstanding Balances/));
    fireEvent.change(pick(), { target: { files: [fileOf("Party,Pending\nAlpha,100\n")] } });
    await screen.findByRole("table", { name: "File preview" });
    expect(button("Validate").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Balances as of"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "receivable" } });
    expect(button("Validate").disabled).toBe(false);
  });
});

describe("validate and import", () => {
  const validated = async (rows: unknown[]) => {
    a.check.mockResolvedValue({ ok: true, rows });
    render(<TallyImportShell canImport />);
    await upload();
    await screen.findByRole("table", { name: "File preview" });
    await act(async () => fireEvent.click(button("Validate")));
    await screen.findByText("Validation summary");
  };

  it("Tally's total row isn't sent; a clean file enables Import, which asks first", async () => {
    await validated([ok(4), ok(5)]);
    expect(a.check.mock.calls[0]![0].rows.map((r: { rowNo: number }) => r.rowNo)).toEqual([4, 5]);
    expect(button("Import").disabled).toBe(false);
    fireEvent.click(button("Import"));
    expect(screen.getByRole("dialog", { name: "Import these records?" }).textContent).toMatch(/2 rows will be imported/);
    expect(a.start).not.toHaveBeenCalled();
  });

  it("invalid rows are shown with row numbers and hold Import until acknowledged", async () => {
    await validated([ok(4), ok(5, "invalid", ["The date is missing."])]);
    const table = screen.getByRole("table", { name: "Rows to review" });
    expect(within(table).getByText("The date is missing.")).toBeTruthy();
    expect(button("Import").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Don't import the 1 invalid rows/));
    expect(button("Import").disabled).toBe(false);
  });

  it("attention rows count as ready only with the opt-in, which is sent to the server", async () => {
    await validated([ok(4, "attention", ["Party isn't in the Customer Master."]), ok(5, "attention", ["Same."])]);
    expect(button("Import").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Also import the 2 rows/));
    expect(button("Import").disabled).toBe(false);
  });

  it("changing the mapping throws the validation away", async () => {
    await validated([ok(4), ok(5)]);
    fireEvent.change(screen.getByLabelText("Narration"), { target: { value: "2" } });
    expect(screen.queryByText("Validation summary")).toBeNull();
    expect(button("Import").disabled).toBe(true);
  });

  it("imports after confirming, shows the database's counts, and refreshes the history", async () => {
    a.start.mockResolvedValue({ ok: true, batchId: "b1", resumed: false, doneRowNos: [] });
    a.chunk.mockResolvedValue({ ok: true, counts: {} });
    a.finish.mockResolvedValue({ ok: true, batch: { status: "completed", totalRows: 2, importedRows: 2, skippedRows: 0, rejectedRows: 0, failedRows: 0 } });
    await validated([ok(4), ok(5)]);
    fireEvent.click(button("Import"));
    await act(async () => fireEvent.click(button("Confirm import")));
    await screen.findByText("Record counts");
    expect(a.start.mock.calls[0]![0]).toMatchObject({ category: "sales-invoices", totalRows: 2, confirm: true });
    expect(a.chunk).toHaveBeenCalledTimes(1);
    expect(a.finish).toHaveBeenCalledWith("b1");
    expect(a.refresh).toHaveBeenCalled();
    expect(a.toast).toHaveBeenCalledWith({ message: "Imported 2 rows.", type: "success" });
  });

  it("a resumed import sends only the rows still to do; a dropped connection says how to continue", async () => {
    a.start.mockResolvedValue({ ok: true, batchId: "b1", resumed: true, doneRowNos: [4] });
    a.chunk.mockRejectedValue(new Error("network"));
    a.finish.mockResolvedValue({ ok: true, batch: { status: "partial", totalRows: 2, importedRows: 1, skippedRows: 0, rejectedRows: 0, failedRows: 1 } });
    await validated([ok(4), ok(5)]);
    fireEvent.click(button("Import"));
    await act(async () => fireEvent.click(button("Confirm import")));
    await waitFor(() => expect(a.finish).toHaveBeenCalled());
    expect(a.chunk.mock.calls[0]![0].rows.map((r: { rowNo: number }) => r.rowNo)).toEqual([5]);
    expect(a.chunk).toHaveBeenCalledTimes(2); // one retry
    expect(screen.getAllByRole("alert").map((e) => e.textContent).join(" ")).toMatch(/nothing will be imported twice/);
  });
});

describe("history", () => {
  const row = { id: "12345678-aaaa", fileName: "fy25.xlsx", category: "sales-invoices", financialYears: ["2024-25"], isHistorical: true, asOfDate: null, uploadedBy: "Someone", createdAt: new Date("2026-10-01T06:00:00Z"), completedAt: new Date("2026-10-01T06:01:00Z"), totalRows: 10, importedRows: 7, skippedRows: 2, rejectedRows: 1, failedRows: 0, status: "completed" };
  it("shows each batch with its counts and opens its problems; nothing deletes it", async () => {
    a.problems.mockResolvedValue([{ rowNo: 9, status: "rejected", reason: "The date is missing." }]);
    render(<TallyImportShell history={[row as never]} />);
    const t = screen.getByRole("table", { name: "Import history" });
    expect(t.textContent).toMatch(/12345678.*fy25\.xlsx.*Sales Invoices.*2024-25 · historical.*Someone/);
    await act(async () => fireEvent.click(within(t).getByRole("button", { name: "Details" })));
    expect(await within(t).findByText(/Row 9 · rejected: The date is missing\./)).toBeTruthy();
    expect(within(t).queryByRole("button", { name: /delete|remove/i })).toBeNull();
  });
});
