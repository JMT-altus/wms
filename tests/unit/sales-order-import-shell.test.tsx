// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

// The Sales Order import screen (Forms → Sales Orders → Import), with the server actions MOCKED. The file is real CSV
// bytes in Tally's layout, read by the real reader and planned by the real planner. All data is invented.
const a = vi.hoisted(() => ({ check: vi.fn(), start: vi.fn(), chunk: vi.fn(), finish: vi.fn(), saved: vi.fn(), problems: vi.fn(), customer: vi.fn(), toast: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: a.push }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(forms-module)/forms/tally-import/actions", () => ({
  checkTallyChunk: (...x: unknown[]) => a.check(...x),
  startTallyImport: (...x: unknown[]) => a.start(...x),
  importTallyChunk: (...x: unknown[]) => a.chunk(...x),
  finishTallyImport: (...x: unknown[]) => a.finish(...x),
  getSavedTallyMapping: (...x: unknown[]) => a.saved(...x),
  getTallyBatchProblems: (...x: unknown[]) => a.problems(...x),
  getSalesOrderCustomer: (...x: unknown[]) => a.customer(...x),
}));
// The house picker is a popover; a plain <select> with the same contract keeps the test about the screen, not the widget.
vi.mock("@/components/ui/select", () => ({
  Select: ({ options, value, onValueChange, ariaLabel, disabled }: { options: { value: string; label: string }[]; value: string; onValueChange: (v: string) => void; ariaLabel?: string; disabled?: boolean }) => (
    <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Choose…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import { TallyImportShell } from "@/components/admin/master/tally-import-shell";
import { planRows, type RawRow } from "@/lib/tally/plan";
import type { TallyMapping } from "@/lib/tally/mapping";
import { SO_HEADERS, soEntry, soLine, soRow, soVoucher } from "../fixtures/sales-order-rows";

const BETA = "22222222-2222-4222-8222-222222222222";
const SKU = "33333333-3333-4333-8333-333333333333";
const OPTIONS = {
  customers: [{ value: "11111111-1111-4111-8111-111111111111", label: "Alpha Traders · 00001", name: "Alpha Traders" }, { value: BETA, label: "Beta Corp · 00002", name: "Beta Corp" }],
  products: [{ value: `sku:${SKU}`, label: "Gear Motor · 1 HP (GM-1HP)", name: "Gear Motor", unit: "Nos" }],
  ledgers: [{ value: "Sales", label: "Sales" }],
};

// Tally's layout with every Sales Order field of the matrix (the import template's headings), every Y field filled.
// Row 2: SO/1 for Alpha Traders · 3: its sales ledger with Gear Motor · 4: Gearbox · 5: SO/2 for Nobody Ltd · 6: Coupling.
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const order = (no: string, date: string, party: string, total: string) => soRow({ documentDate: date, documentNo: no, partyName: party, amount: total, drCr: "Dr", ...soVoucher(party), ...soEntry, orderDate: date });
const line = (name: string, qty: string, rate: string, amount: string, ledger?: { name: string; amount: string }) =>
  soRow({ ...(ledger ? { partyName: ledger.name, amount: ledger.amount, drCr: "Cr", ...soEntry } : {}), itemName: name, quantity: qty, rate, lineAmount: amount, ...soLine(amount) });
const CSV = [
  SO_HEADERS,
  order("SO/1", "01-04-2026", "Alpha Traders", "3000"),
  line("Gear Motor", "1", "1000", "1000", { name: "Sales", amount: "3000" }),
  line("Gearbox", "1", "2000", "2000"),
  order("SO/2", "02-04-2026", "Nobody Ltd", "500"),
  line("Coupling", "1", "500", "500", { name: "Sales", amount: "500" }),
]
  .map((r) => r.map(csvCell).join(","))
  .concat("")
  .join("\n");
const fileOf = (text: string, name = "orders.csv") => {
  const f = new File([text], name);
  Object.defineProperty(f, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return f;
};
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
// Read from the DOM, not by role: while the confirmation dialog is open the page behind it is hidden from assistive tech.
const step = () => document.querySelector('ol[aria-label="Import steps"] [aria-current="step"] > span')?.textContent?.replace(/\s+/g, " ").trim();
const tile = (label: string) => screen.getByText(label, { selector: "p" }).nextElementSibling?.textContent;

/** What the server would answer: the real plan, with SO/2 held back until its customer is matched by hand. */
const serverCheck = async (input: { rows: RawRow[]; mapping: TallyMapping; links?: { customers: Record<string, string> } }) => {
  const plan = planRows("sales-orders", input.rows, input.mapping, { today: "2026-10-31" });
  const linked = input.links?.customers.nobodyltd === BETA;
  const rows = plan.rows.map((r) => (r.block === 5 && !linked ? { ...r, state: "invalid" as const, messages: [r.rowNo === 5 ? `"Nobody Ltd" isn't in the Customer Master.` : "Not imported: row 5 of this order has an error."] } : r));
  const product = (key: string, name: string, rowNo: number) => ({ key, name, status: "matched" as const, label: `${name} (master)`, ref: `sku:${SKU}`, rows: [rowNo] });
  return {
    ok: true,
    rows,
    matches: {
      customers: [
        { key: "alphatraders", name: "Alpha Traders", status: "matched", label: "Alpha Traders · 00001", ref: OPTIONS.customers[0]!.value, rows: [2] },
        { key: "nobodyltd", name: "Nobody Ltd", status: linked ? "manual" : "unmatched", label: linked ? "Beta Corp · 00002" : null, ref: linked ? BETA : null, rows: [5] },
      ],
      products: [product("gearmotor", "Gear Motor", 3), product("gearbox", "Gearbox", 4), product("coupling", "Coupling", 6)],
    },
  };
};

const shell = (over: Partial<React.ComponentProps<typeof TallyImportShell>> = {}) => render(<TallyImportShell lockedCategory="sales-orders" canImport linkOptions={OPTIONS} {...over} />);
const upload = async (file = fileOf(CSV)) => {
  fireEvent.change(screen.getByLabelText("Sales Order file"), { target: { files: [file] } });
  await screen.findByRole("table", { name: "File preview" });
};
const validated = async (over: Partial<React.ComponentProps<typeof TallyImportShell>> = {}) => {
  shell(over);
  await upload();
  await act(async () => fireEvent.click(button("Validate")));
  await screen.findByText("Validation summary");
};

let saved: { blob: Blob; name: string }[] = [];
beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
  a.saved.mockResolvedValue(null);
  a.check.mockImplementation(serverCheck);
  saved = [];
  Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: { digest: async () => new ArrayBuffer(32) } });
  let last: Blob | null = null;
  URL.createObjectURL = vi.fn((b: Blob) => ((last = b), "blob:test"));
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (last) saved.push({ blob: last, name: this.download });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the screen", () => {
  it("is the Sales Order import only: no category to choose, the steps in order, and Tally's template to download", async () => {
    shell();
    expect(screen.queryByRole("button", { name: /Sales Invoices/ })).toBeNull();
    expect(screen.queryByText(/What are you importing/)).toBeNull();
    expect(within(screen.getByRole("list", { name: "Import steps" })).getAllByRole("listitem").map((li) => li.textContent?.replace(/[›\d\s]+/g, " ").trim())).toEqual(["Upload", "Column mapping", "Validation", "Preview", "Confirmation", "Import result"]);
    expect(step()).toBe("1 Upload");
    expect(button("Upload file").disabled).toBe(false);
    expect(button("Import").disabled).toBe(true);
    await act(async () => fireEvent.click(button("Download template")));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ name: "Sales Order import template.xlsx" });
    expect(saved[0]!.blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(saved[0]!.blob.size).toBeGreaterThan(2000);
  });

  it("the general Tally page sends its Sales Orders card here, so there is one Sales Order import", () => {
    render(<TallyImportShell canImport />);
    fireEvent.click(button(/Sales Orders/));
    expect(a.push).toHaveBeenCalledWith("/forms/documents/sales-orders/import");
    expect(button("Upload file").disabled).toBe(true); // nothing was selected on this page
  });

  it("without the permission it is read-only: nothing validates and nothing can be matched", async () => {
    shell({ canImport: false, linkOptions: { customers: [], products: [] } });
    expect(screen.getByRole("note").textContent).toMatch(/View only/);
    await upload();
    expect(button("Validate").disabled).toBe(true);
    expect(a.check).not.toHaveBeenCalled();
  });
});

describe("upload and column mapping", () => {
  it("reads Tally's layout, maps its headings by themselves, and imports nothing", async () => {
    shell();
    await upload();
    expect(step()).toBe("2 Column mapping");
    const mapped = (label: string) => (screen.getByLabelText(label) as HTMLSelectElement).selectedOptions[0]!.textContent;
    // Every field is labelled with its exact Tally name, and the template's columns map themselves.
    for (const name of ["Voucher Number", "Voucher Date", "Ledger Name", "Ledger Amount", "Ledger Amount Dr/Cr", "Item Name", "Billed Quantity", "Item Rate per", "Item Amount", "Item Allocations - Order Due on", "GST Rate Details", "Buyer/Supplier - State", "Change Mode"]) {
      expect(mapped(name), name).toBe(name);
    }
    expect(screen.getByText(/112 of 112 fields have a column/)).toBeTruthy();
    expect(button("Validate").disabled).toBe(false);
    expect(a.check).not.toHaveBeenCalled();
    expect(a.start).not.toHaveBeenCalled();
  });

  it("a required column left unmapped is named and blocks validation", async () => {
    shell();
    await upload();
    fireEvent.change(screen.getByLabelText("Item Name"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Item Name is required and has no column/);
    expect(button("Validate").disabled).toBe(true);
  });

  it("refuses a file that isn't .xlsx or .csv, and a template with no rows", async () => {
    shell();
    fireEvent.change(screen.getByLabelText("Sales Order file"), { target: { files: [fileOf("x", "orders.xlsm")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/aren't accepted/);
    fireEvent.change(screen.getByLabelText("Sales Order file"), { target: { files: [fileOf(CSV.split("\n")[0]! + "\n")] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/headings but no data rows/));
  });
});

describe("validation and preview", () => {
  it("counts orders and product lines, not rows, and shows each order with its lines", async () => {
    await validated();
    expect(step()).toBe("4 Preview");
    // Every row of an order goes to the server in one part.
    expect(a.check.mock.calls[0]![0]).toMatchObject({ category: "sales-orders", links: { customers: {}, products: {} } });
    expect(a.check.mock.calls[0]![0].rows.map((r: RawRow) => r.rowNo)).toEqual([2, 3, 4, 5, 6]);
    expect([tile("Sales orders"), tile("Product lines"), tile("Valid"), tile("Invalid"), tile("Duplicate"), tile("Warnings")]).toEqual(["2", "3", "1", "1", "0", "0"]);
    const table = screen.getByRole("table", { name: "Sales orders in this file" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows.map((r) => r.textContent?.replace(/\s+/g, " "))).toEqual([expect.stringMatching(/2SO\/101\/04\/26Alpha Traders2₹3,000.*Valid/), expect.stringMatching(/5SO\/202\/04\/26Nobody LtdNot in the Customer Master1₹500.*Invalid"Nobody Ltd" isn't in the Customer Master\./)]);
    // One order opens to all of its product lines.
    fireEvent.click(button("Show the lines of SO/1"));
    const lines = screen.getByRole("table", { name: "Product lines of SO/1" });
    // Each line with its description, delivery date, GST and HSN/SAC.
    expect(within(lines).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^3Gear MotorStandardGear Motor \(master\)1Nos1000₹1,00030\/04\/27As per Masters\/CompanyAs per Masters\/Company$/),
      expect.stringMatching(/^4GearboxStandardGearbox \(master\)1Nos2000₹2,00030\/04\/27As per Masters\/CompanyAs per Masters\/Company$/),
    ]);
    expect(screen.queryByRole("table", { name: "Rows to review" })).toBeNull();
  });

  it("an invalid order holds Import until it is left out on purpose", async () => {
    await validated();
    expect(button("Import").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Leave out the 1 invalid order/));
    expect(button("Import").disabled).toBe(false);
    fireEvent.click(button("Import"));
    expect(screen.getByRole("dialog", { name: "Import these sales orders?" }).textContent).toMatch(/1 sales order with 2 product lines will be imported into Forms → Sales Orders/);
    expect(a.start).not.toHaveBeenCalled();
  });

  it("the error report downloads the problems with their file rows", async () => {
    await validated();
    fireEvent.click(button("Download error report"));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe("orders - problems.csv");
    const text = await saved[0]!.blob.text();
    expect(text).toContain(`"5","SO/2","2026-04-02","Nobody Ltd","Invalid","""Nobody Ltd"" isn't in the Customer Master."`);
    expect(text).not.toContain("SO/1");
  });

  it("the filter shows one kind of order at a time", async () => {
    await validated();
    fireEvent.click(button("Invalid · 1"));
    const table = screen.getByRole("table", { name: "Sales orders in this file" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).queryByText("SO/1")).toBeNull();
  });
});

describe("matching a customer by hand", () => {
  it("lists the unmatched name, keeps Import off until it is validated again, and sends the match to the server", async () => {
    await validated();
    const list = screen.getByRole("list", { name: "Customers to match" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list.textContent).toMatch(/Nobody LtdNot in the Customer Master · row 5/);
    expect(screen.queryByRole("list", { name: "Items to match" })).toBeNull(); // every item matched on its own
    expect(button("Validate again").disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Match customer Nobody Ltd"), { target: { value: BETA } });
    expect(screen.getAllByRole("status").map((e) => e.textContent).join(" ")).toMatch(/The matches changed/);
    fireEvent.click(screen.getByLabelText(/Leave out the 1 invalid order/));
    expect(button("Import").disabled).toBe(true); // a match that the server hasn't checked imports nothing
    expect(a.check).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.click(button("Validate again")));
    await screen.findByText("Validation summary");
    expect(a.check.mock.calls[1]![0].links).toEqual({ customers: { nobodyltd: BETA }, products: {}, ledgers: {} });
    expect([tile("Valid"), tile("Invalid")]).toEqual(["2", "0"]);
    expect(screen.getByRole("list", { name: "Customers to match" }).textContent).toMatch(/Matched by hand/);
    expect(button("Import").disabled).toBe(false);
  });

  it("clearing a match puts the order back to waiting", async () => {
    await validated();
    fireEvent.change(screen.getByLabelText("Match customer Nobody Ltd"), { target: { value: BETA } });
    await act(async () => fireEvent.click(button("Validate again")));
    await screen.findByText("Validation summary");
    fireEvent.click(button("Clear the match for Nobody Ltd"));
    await act(async () => fireEvent.click(button("Validate again")));
    await screen.findByText("Validation summary");
    expect(a.check.mock.calls[2]![0].links).toEqual({ customers: {}, products: {}, ledgers: {} });
    expect(tile("Invalid")).toBe("1");
  });
});

describe("confirmation, import and result", () => {
  const finishWith = (batch: Record<string, unknown>, documents: number) => a.finish.mockResolvedValue({ ok: true, batch: { status: "completed", totalRows: 5, importedRows: 5, skippedRows: 0, rejectedRows: 0, failedRows: 0, ...batch }, documents });

  it("imports only after confirming, sends the matches with every part, and reports the orders the database created", async () => {
    a.start.mockResolvedValue({ ok: true, batchId: "b1", resumed: false, doneRowNos: [] });
    a.chunk.mockResolvedValue({ ok: true, counts: {} });
    finishWith({}, 2);
    await validated();
    fireEvent.change(screen.getByLabelText("Match customer Nobody Ltd"), { target: { value: BETA } });
    await act(async () => fireEvent.click(button("Validate again")));
    await screen.findByText("Validation summary");
    fireEvent.click(button("Import"));
    expect(step()).toBe("5 Confirmation");
    expect(screen.getByRole("dialog", { name: "Import these sales orders?" }).textContent).toMatch(/2 sales orders with 3 product lines/);
    expect(a.start).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(button("Confirm import")));
    await screen.findByRole("heading", { name: "Import result" });
    expect(a.start.mock.calls[0]![0]).toMatchObject({ category: "sales-orders", fileName: "orders.csv", totalRows: 5, includeAttention: false, confirm: true });
    expect(a.start.mock.calls[0]![0]).not.toHaveProperty("links"); // matches travel with the rows they are for
    expect(a.chunk).toHaveBeenCalledTimes(1);
    expect(a.chunk.mock.calls[0]![0]).toMatchObject({ batchId: "b1", links: { customers: { nobodyltd: BETA }, products: {} } });
    expect(a.chunk.mock.calls[0]![0].rows.map((r: RawRow) => r.rowNo)).toEqual([2, 3, 4, 5, 6]);
    expect(a.finish).toHaveBeenCalledWith("b1");
    expect(step()).toBe("6 Import result");
    expect(tile("Sales orders created")).toBe("2");
    expect(a.toast).toHaveBeenCalledWith({ message: "Imported 2 sales orders.", type: "success" });
    expect(a.refresh).toHaveBeenCalled();
    expect((screen.getByRole("link", { name: "Open Sales Orders" }) as HTMLAnchorElement).getAttribute("href")).toBe("/forms/documents/sales-orders");
  });

  it("a dropped connection is retried once, then says how to carry on; a resumed import sends only what is left", async () => {
    a.start.mockResolvedValue({ ok: true, batchId: "b1", resumed: true, doneRowNos: [2, 3, 4] });
    a.chunk.mockRejectedValue(new Error("network"));
    finishWith({ status: "partial", importedRows: 3, failedRows: 2 }, 1);
    await validated();
    fireEvent.click(screen.getByLabelText(/Leave out the 1 invalid order/));
    fireEvent.click(button("Import"));
    await act(async () => fireEvent.click(button("Confirm import")));
    await waitFor(() => expect(a.finish).toHaveBeenCalled());
    expect(a.chunk).toHaveBeenCalledTimes(2);
    expect(a.chunk.mock.calls[0]![0].rows.map((r: RawRow) => r.rowNo)).toEqual([5, 6]);
    expect(screen.getAllByRole("alert").map((e) => e.textContent).join(" ")).toMatch(/nothing will be imported twice/);
    expect(a.toast).toHaveBeenCalledWith({ message: "Import finished with 2 rows not saved.", type: "error" });
  });

  it("a refusal from the server is shown and nothing is sent", async () => {
    a.start.mockResolvedValue({ ok: false, error: "The column mapping isn't complete. Fix it and validate again." });
    await validated();
    fireEvent.click(screen.getByLabelText(/Leave out the 1 invalid order/));
    fireEvent.click(button("Import"));
    await act(async () => fireEvent.click(button("Confirm import")));
    expect((await screen.findByRole("alert")).textContent).toMatch(/mapping isn't complete/);
    expect(a.chunk).not.toHaveBeenCalled();
  });
});

describe("history", () => {
  const row = { id: "12345678-aaaa", fileName: "april.xlsx", category: "sales-orders", financialYears: ["2026-27"], isHistorical: false, asOfDate: null, uploadedBy: "Someone", createdAt: new Date("2026-10-01T06:00:00Z"), completedAt: new Date("2026-10-01T06:01:00Z"), totalRows: 40, importedRows: 31, skippedRows: 6, rejectedRows: 3, failedRows: 0, status: "completed", documentCount: 9 };

  it("lists each Sales Order import with its file, uploader, time, order and row totals and status, and opens its problems", async () => {
    a.problems.mockResolvedValue([{ rowNo: 9, status: "rejected", reason: `"X" isn't in the Product Master.` }]);
    shell({ history: [row as never] });
    const t = screen.getByRole("table", { name: "Import history" });
    expect(within(t).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Batch", "File", "Orders", "Period", "Uploaded by", "Uploaded", "Rows", "Imported", "Skipped", "Failed", "Status", "Completed", ""]);
    const cellsOf = within(t).getAllByRole("row")[1]!.querySelectorAll("td");
    expect([...cellsOf].map((c) => c.textContent).filter((_, i) => [0, 1, 2, 3, 4, 6, 7, 8, 9, 10].includes(i))).toEqual(["12345678", "april.xlsx", "9", "2026-27", "Someone", "40", "31", "6", "3", "completed"]);
    expect((within(t).getByRole("link", { name: "Open batch 12345678" }) as HTMLAnchorElement).getAttribute("href")).toBe("/forms/tally-import/batches/12345678-aaaa");
    await act(async () => fireEvent.click(within(t).getByRole("button", { name: "Details" })));
    expect(await within(t).findByText(/Row 9 · rejected: "X" isn't in the Product Master\./)).toBeTruthy();
    expect(within(t).queryByRole("button", { name: /delete|remove/i })).toBeNull();
  });
});

describe("entering an order on the form", () => {
  const openForm = () => {
    shell();
    fireEvent.click(screen.getByRole("tab", { name: "Enter an order" }));
    return screen.getByLabelText("Enter a Sales Order");
  };

  it("lays the order out A–J with Tally's field names; Y fields are starred, the ? and optional ones are folded away", () => {
    const form = openForm();
    expect(screen.getByRole("tab", { name: "Enter an order" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText("Sales Order file")).toBeNull(); // no upload while entering an order
    const titles = within(form).getAllByRole("button", { expanded: true }).map((b) => b.textContent ?? "");
    for (const t of ["Voucher and order", "Buyer / Supplier", "Consignee (ship to)", "Ledgers", "Items", "Dispatch and delivery", "Voucher status"]) expect(titles.some((x) => x.includes(t)), t).toBe(true);
    expect(within(form).getByRole("button", { name: /Additional details/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(form).getByLabelText("Voucher Number")).toBeTruthy();
    expect(within(form).getByLabelText("Carrier Name/Agent")).toBeTruthy();
    expect(within(form).queryByLabelText("Price Level")).toBeNull(); // Provision: folded until opened
    fireEvent.click(within(form).getByRole("button", { name: /More voucher details/ }));
    expect(within(form).getByLabelText("Price Level")).toBeTruthy();
    // Tally's defaults for a Sales Order are filled in, visibly.
    expect((within(form).getByLabelText("Voucher Type Name") as HTMLInputElement).value).toBe("Sales Order");
    expect((within(form).getByLabelText("Change Mode") as HTMLSelectElement).value).toBe("Item Invoice");
  });

  it("GST and HSN/SAC fields appear only for the choice that needs them, and the consignee only when it differs", () => {
    const form = openForm();
    expect(within(form).queryByLabelText("Item 1 IGST Rate")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Item 1 GST Rate Details"), { target: { value: "Specify Details Here" } });
    expect(within(form).getByLabelText("Item 1 IGST Rate")).toBeTruthy();
    expect(within(form).getByLabelText("Item 1 GST Taxability Type")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Item 1 GST Rate Details"), { target: { value: "As per Masters/Company" } });
    expect(within(form).queryByLabelText("Item 1 IGST Rate")).toBeNull();
    expect(within(form).getByLabelText("Item 1 GST Source Type of Master")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Item 1 HSN/SAC Details"), { target: { value: "Specify Details Here" } });
    expect(within(form).getByLabelText("Item 1 HSN/SAC")).toBeTruthy();
    expect(within(form).queryByLabelText("Consignee (ship to)")).toBeNull();
    fireEvent.click(within(form).getByLabelText("Ship to a different consignee"));
    expect(within(form).getByLabelText("Consignee (ship to)")).toBeTruthy();
    expect(within(form).getByLabelText("Consignee - GSTIN/UIN")).toBeTruthy();
  });

  it("choosing the customer fills the buyer from the Customer Master; items work out their amounts and the order total", async () => {
    a.customer.mockResolvedValue({ name: "Alpha Traders", gstin: "27ABCDE1234F1Z5", state: "Maharashtra", country: "India", registrationType: "Regular", address: "1 Test Road", pincode: "411001" });
    const form = openForm();
    await act(async () => fireEvent.change(within(form).getByLabelText("Customer"), { target: { value: OPTIONS.customers[0]!.value } }));
    expect(a.customer).toHaveBeenCalledWith(OPTIONS.customers[0]!.value);
    expect((within(form).getByLabelText("Buyer/Supplier - GSTIN/UIN") as HTMLInputElement).value).toBe("27ABCDE1234F1Z5");
    expect((within(form).getByLabelText("Buyer/Supplier - State") as HTMLSelectElement).value).toBe("Maharashtra");
    expect((within(form).getByLabelText("Buyer/Supplier - GST Registration Type") as HTMLSelectElement).value).toBe("Regular");
    fireEvent.change(within(form).getByLabelText("Item 1 product"), { target: { value: `sku:${SKU}` } });
    expect((within(form).getByLabelText("Item 1 Item Rate per") as HTMLInputElement).value).toBe("Nos");
    fireEvent.change(within(form).getByLabelText("Item 1 Billed Quantity"), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("Item 1 Item Rate"), { target: { value: "1000" } });
    expect((within(form).getByLabelText("Item 1 Item Amount") as HTMLInputElement).value).toBe("3000.00");
    expect((within(form).getByLabelText("Item 1 Taxable Value") as HTMLInputElement).value).toBe("3000.00");
    fireEvent.click(within(form).getByRole("button", { name: "Add ledger" }));
    fireEvent.change(within(form).getByLabelText("Ledger 1 amount"), { target: { value: "540" } });
    expect(within(form).getByText("Order total").nextElementSibling?.textContent).toBe("₹3,540");
  });

  it("“Check order” sends the order as template rows through the same validation, and shows each problem against its part of the form", async () => {
    const form = openForm();
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Check order" })));
    await screen.findByText("Validation summary");
    const sent = a.check.mock.calls[0]![0];
    expect(sent).toMatchObject({ category: "sales-orders", links: { customers: {}, products: {}, ledgers: {} } });
    expect(sent.rows.map((r: RawRow) => r.rowNo)).toEqual([2, 3]);
    expect(sent.rows[0].cells).toHaveLength(SO_HEADERS.length);
    expect(Object.keys(sent.mapping)).toHaveLength(SO_HEADERS.length);
    const fix = screen.getByRole("alert", { name: "What to fix" });
    // An empty form stops where an empty file would: no voucher number, date, customer or total.
    expect(fix.textContent).toMatch(/Order and customer ledger:.*The voucher number is missing/);
    expect(fix.textContent).toMatch(/The date is missing/);
    expect(fix.textContent).toMatch(/The customer \(ledger name\) is missing/);
    expect(fix.textContent).not.toMatch(/Not imported: row/); // pointers between rows aren't repeated to the person
    expect(a.start).not.toHaveBeenCalled();
    expect(button("Import").disabled).toBe(true);
  });

  it("if the server would match a different customer than the one chosen, the import stays off and says why", async () => {
    a.customer.mockResolvedValue(null);
    a.check.mockImplementation(async (input: { rows: RawRow[]; mapping: TallyMapping }) => {
      const plan = planRows("sales-orders", input.rows, input.mapping, { today: "2026-10-31" });
      return { ok: true, rows: plan.rows.map((r) => ({ ...r, state: "valid", messages: [] })), matches: { customers: [{ key: "alphatraders", name: "Alpha Traders", status: "matched", label: "Beta Corp · 00002", ref: BETA, rows: [2] }], products: [], ledgers: [] } };
    });
    const form = openForm();
    await act(async () => fireEvent.change(within(form).getByLabelText("Customer"), { target: { value: OPTIONS.customers[0]!.value } }));
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Check order" })));
    await screen.findByText("Validation summary");
    expect(screen.getByRole("alert", { name: "What to fix" }).textContent).toMatch(/Customer: The import would match this order to "Beta Corp · 00002", not the customer you chose/);
    expect(button("Import").disabled).toBe(true);
  });
});
