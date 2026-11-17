// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Admin & Master Setup → Sales Order Fields, and the Sales Order entry form under a field configuration, with the server
// action MOCKED. All data is invented.
const a = vi.hoisted(() => ({ save: vi.fn(), saveSection: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(masters)/master-setup/sales-order-fields/actions", () => ({ saveSalesOrderField: (...x: unknown[]) => a.save(...x), saveSalesOrderSection: (...x: unknown[]) => a.saveSection(...x) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ options, value, onValueChange, ariaLabel }: { options: { value: string; label: string }[]; value: string; onValueChange: (v: string) => void; ariaLabel?: string }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Choose…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import { SalesOrderFieldsManager } from "@/components/admin/master/sales-order-fields-manager";
import { SalesOrderEntryForm } from "@/components/forms/tally/sales-order-entry-form";
import { buildCatalogue, type FieldScope, type FieldSetting } from "@/lib/tally/sales-order-config";

const setting = (over: Partial<FieldSetting> & Pick<FieldSetting, "fieldKey" | "scope">): FieldSetting => ({
  isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", rowVersion: 1, ...over,
});
const custom = (key: string, scope: FieldScope, label: string, over: Partial<FieldSetting> = {}) => setting({ fieldKey: key, scope, isCustom: true, label, section: "Extra", fieldType: "text", requirement: "optional", ...over });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Sales Order Fields (admin)", () => {
  const settings = [setting({ fieldKey: "carrier", scope: "voucher", label: "Transporter", rowVersion: 3 }), custom("custom_project", "voucher", "Project")];

  it("lists every field with its scope and requirement; locked fields can't be disabled", () => {
    render(<SalesOrderFieldsManager settings={settings} version={7} ready canManage history={[]} />);
    expect(screen.getByRole("button", { name: /All fields · 354/ })).toBeTruthy(); // the worksheet's 353 fields and the custom one
    // A pre-close field is marked as such and can't be disabled; an offered x field says so.
    const reason = screen.getByRole("button", { name: "Edit Reason for Pre-Close" }).closest("tr")!;
    expect(within(reason).getByText("Pre-close (Update)")).toBeTruthy();
    expect(within(reason).queryByRole("button", { name: /Disable/ })).toBeNull();
    expect(within(screen.getByRole("button", { name: "Edit Port of Loading" }).closest("tr")!).getByText(/x in the matrix/)).toBeTruthy();
    const voucherNo = screen.getByRole("button", { name: "Edit Voucher Number" }).closest("tr")!;
    expect(within(voucherNo).getByText("Locked")).toBeTruthy();
    expect(within(voucherNo).queryByRole("button", { name: /Disable/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Disable Project" })).toBeTruthy();
  });

  it("saves an edit with the row version it read, and shows a refusal from the server", async () => {
    a.save.mockResolvedValueOnce({ ok: false, error: "This field was changed by someone else meanwhile." });
    render(<SalesOrderFieldsManager settings={settings} version={7} ready canManage history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Transporter" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Carrier / agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save.mock.calls[0]![0]).toMatchObject({ fieldKey: "carrier", label: "Carrier / agent", expectedRowVersion: 3, status: "active" });
    // Exactly what the server's strict schema accepts: the screen's own text boxes are never sent.
    expect(Object.keys(a.save.mock.calls[0]![0]).sort()).toEqual(["condition", "displayOrder", "expectedRowVersion", "fieldKey", "fieldType", "inForm", "inImport", "isCustom", "label", "onOrderPage", "options", "requirement", "scope", "section", "status"]);
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy();
    expect(a.refresh).not.toHaveBeenCalled();
  });

  it("is read-only without the permission, and says why when 0128 isn't applied", () => {
    const { unmount } = render(<SalesOrderFieldsManager settings={[]} version={0} ready canManage={false} history={[]} />);
    expect(screen.getByText(/View only/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Edit Voucher Number" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Add custom field/ }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<SalesOrderFieldsManager settings={[]} version={0} ready={false} canManage history={[]} />);
    expect(screen.getByText(/Database update 0128 needed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Add custom field/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the entry form under a configuration", () => {
  const options = { customers: [], products: [], ledgers: [] };
  const form = (c = buildCatalogue([])) => render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={c} />);

  it("shows configured labels, hides a retired field, and renders custom fields at the order, ledger, line and allocation", () => {
    const onCheck = vi.fn();
    const c = buildCatalogue([
      setting({ fieldKey: "carrier", scope: "voucher", label: "Transporter" }),
      setting({ fieldKey: "destination", scope: "voucher", status: "retired" }),
      custom("custom_project", "voucher", "Project", { requirement: "mandatory" }),
      custom("custom_head", "ledger", "Cost Head", { fieldType: "choice", options: ["Direct", "Indirect"] }),
      custom("custom_drawing", "item", "Drawing No"),
      custom("custom_batch", "allocation", "Batch Ref"),
    ]);
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={onCheck} loadCustomer={async () => null} catalogue={c} />);
    expect(screen.getByText("Transporter")).toBeTruthy();
    expect(screen.queryByLabelText("Destination")).toBeNull();
    fireEvent.change(screen.getByLabelText("Project of the order"), { target: { value: "Plant 2" } });
    fireEvent.change(screen.getByLabelText("Cost Head of the customer ledger"), { target: { value: "Direct" } });
    fireEvent.change(screen.getByLabelText("Drawing No of item 1"), { target: { value: "D-1" } });
    fireEvent.change(screen.getByLabelText("Batch Ref of item 1 allocation 1"), { target: { value: "B-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Check order/ }));
    const order = onCheck.mock.calls[0]![0];
    expect(order.voucher.custom_project).toBe("Plant 2");
    expect(order.party.custom).toEqual({ custom_head: "Direct" });
    expect(order.items[0].values.custom_drawing).toBe("D-1");
    expect(order.items[0].allocations[0].custom_batch).toBe("B-1");
  });

  it("without a configuration it is TallyPrime's matrix as it is", () => {
    form();
    expect(screen.queryByText("Custom fields")).toBeNull();
    expect(screen.getByLabelText("Carrier Name/Agent")).toBeTruthy();
  });
});

describe("adding and disabling from the admin screen", () => {
  it("a new custom field at the chosen scope, and a disabling, are sent as complete settings", async () => {
    a.save.mockResolvedValue({ ok: true, fieldKey: "custom_x", version: 8 });
    render(<SalesOrderFieldsManager settings={[custom("custom_project", "voucher", "Project", { rowVersion: 2 })]} version={7} ready canManage history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Add custom field/ }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Batch Ref" } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "Extra" } });
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "allocation" } });
    fireEvent.change(screen.getByLabelText("Requirement"), { target: { value: "mandatory" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save.mock.calls[0]![0]).toMatchObject({ fieldKey: null, isCustom: true, scope: "allocation", label: "Batch Ref", section: "Extra", fieldType: "text", requirement: "mandatory", expectedRowVersion: 0 });
    await waitFor(() => expect(a.refresh).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Disable Project" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2));
    expect(a.save.mock.calls[1]![0]).toMatchObject({ fieldKey: "custom_project", status: "retired", expectedRowVersion: 2, label: "Project" });
  });
});

describe("the Read Me's added and corrected fields on the form and the order page", () => {
  const options = { customers: [], products: [{ value: "sku:s1", label: "Gear Motor", name: "Gear Motor", unit: "Nos" }], ledgers: [] } as unknown as Parameters<typeof SalesOrderEntryForm>[0]["options"];
  const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("Is Bill of Entry available is a required Yes/No with no value chosen; checking sends what was chosen", () => {
    const onCheck = vi.fn();
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={onCheck} loadCustomer={async () => null} catalogue={buildCatalogue([])} />);
    const group = screen.getByRole("radiogroup", { name: "Buyer/Supplier - Is Bill of Entry available" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false"]); // nothing assumed
    fireEvent.click(screen.getByRole("button", { name: /Check order/ }));
    expect(group.getAttribute("aria-invalid")).toBe("true"); // required, and still blank
    fireEvent.click(within(group).getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: /Check order/ }));
    expect(onCheck.mock.calls.at(-1)![0].voucher.buyerBillOfEntry).toBe("No");
  });

  it("GST Classification appears with “Use GST Classification” and is required then; GST Taxability Type is required under “Specify Details Here”", () => {
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={buildCatalogue([])} />);
    expect(screen.queryByLabelText("Item 1 GST Classification")).toBeNull();
    choose("Item 1 GST Rate Details", "Use GST Classification");
    const cls = screen.getByLabelText("Item 1 GST Classification");
    expect(cls.closest("label")!.textContent).toMatch(/GST Classification\*/);
    choose("Item 1 GST Rate Details", "Specify Details Here");
    expect(screen.queryByLabelText("Item 1 GST Classification")).toBeNull();
    expect(screen.getByLabelText("Item 1 GST Taxability Type").closest("label")!.textContent).toMatch(/GST Taxability Type\*/);
    choose("Item 1 HSN/SAC Details", "Specify Details Here");
    expect(screen.getByLabelText("Item 1 HSN Description").closest("label")!.textContent).not.toMatch(/\*/); // optional: x in the Read Me
  });

  it("an administrator's configuration drives them: GST Classification made optional, Is Bill of Entry relabelled", () => {
    const c = buildCatalogue([setting({ fieldKey: "gstClassification", scope: "item", requirement: "optional" }), setting({ fieldKey: "buyerBillOfEntry", scope: "voucher", label: "Bill of Entry?" })]);
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={c} />);
    expect(screen.getByText("Bill of Entry?")).toBeTruthy();
    choose("Item 1 GST Rate Details", "Use GST Classification");
    expect(screen.getByLabelText("Item 1 GST Classification").closest("label")!.textContent).not.toMatch(/\*/);
  });

  it("a single delivery with a discount different from its line's says why before the order is checked", () => {
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={buildCatalogue([])} />);
    fireEvent.click(screen.getByRole("button", { name: /Discount and MRP/ }));
    fireEvent.change(screen.getByLabelText("Item 1 Disc%"), { target: { value: "10" } });
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Allocation 1 —/ }));
    fireEvent.change(screen.getByLabelText("Item 1 allocation 1 Item Allocations - Disc%"), { target: { value: "5" } });
    expect(screen.getByRole("note").textContent).toMatch(/A single delivery is the whole line/);
    fireEvent.change(screen.getByLabelText("Item 1 allocation 1 Item Allocations - Disc%"), { target: { value: "10" } });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("the order page shows both fields, and an order stored before them shows them as not given", async () => {
    const { SalesOrderDetailsView } = await import("@/components/forms/tally/sales-order-details");
    const { soEntry, soLine, soRow, soVoucher, SO_MAPPING } = await import("../fixtures/sales-order-rows");
    const { planRows } = await import("@/lib/tally/plan");
    const rows = [
      soRow({ documentDate: "01-04-2026", documentNo: "SO/UI", partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), buyerBillOfEntry: "Yes", ...soEntry, orderDate: "01-04-2026" }),
      soRow({ partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), gstRateDetails: "Use GST Classification", gstClassification: "Motors 18%" }),
    ].map((cells, i) => ({ rowNo: i + 2, cells }));
    const d = planRows("sales-orders", rows, SO_MAPPING, { asOfDate: null, direction: null, today: "2026-10-31" }).records[0] as import("@/lib/tally/plan").DocumentRecord;
    const { unmount } = render(<SalesOrderDetailsView details={d.details!} lines={d.lines} />);
    expect(screen.getByText("Buyer/Supplier - Is Bill of Entry available").nextSibling!.textContent).toBe("Yes");
    expect(screen.getByText(/GST Classification: Motors 18%/)).toBeTruthy();
    unmount();
    const { billOfEntry: _b, ...olderBuyer } = d.details!.buyer;
    render(<SalesOrderDetailsView details={{ ...d.details!, buyer: olderBuyer }} lines={d.lines.map((l) => ({ ...l, gst: l.gst ? (({ classification: _c, ...g }) => g)(l.gst) : l.gst }))} />);
    expect(screen.getByText("Buyer/Supplier - Is Bill of Entry available").nextSibling!.textContent).toBe("—");
    expect(screen.queryByText(/GST Classification:/)).toBeNull();
  });
});

describe("every field the Read Me applies to Sales Orders has an input on the form", () => {
  it("all 112 a new order carries (the Read Me's 91 and the 21 x fields offered) — with three items in the three GST/HSN modes, a separate consignee, an optional voucher, ledgers, a cost centre, split deliveries and an additional cost", async () => {
    const { SO_FIELDS } = await import("@/lib/tally/sales-order-catalogue");
    const options = { customers: [], products: [], ledgers: [] };
    const { container } = render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={buildCatalogue([])} />);
    fireEvent.click(screen.getByLabelText("Ship to a different consignee"));
    fireEvent.click(screen.getByRole("button", { name: /Add ledger/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add item/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add item/ }));
    const modes = ["As per Masters/Company", "Specify Details Here", "Use GST Classification"];
    modes.forEach((m, i) => {
      fireEvent.change(screen.getByLabelText(`Item ${i + 1} GST Rate Details`), { target: { value: m } });
      fireEvent.change(screen.getByLabelText(`Item ${i + 1} HSN/SAC Details`), { target: { value: m } });
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Split into another delivery/ })[0]!);
    // An optional voucher: Voucher Applicable Upto applies to it.
    // (Yes is the group's first radio; its <label> names it, so it is picked by position.)
    const yes = within(screen.getByRole("radiogroup", { name: "Optional" })).getAllByRole("radio")[0]!;
    fireEvent.click(yes);
    expect(yes.getAttribute("aria-checked")).toBe("true");
    // Open every collapsed section and panel (repeatedly: opening one can reveal more).
    for (let round = 0; round < 5; round++) for (const b of [...container.querySelectorAll('button[aria-expanded="false"]')]) fireEvent.click(b);
    fireEvent.click(screen.getAllByRole("button", { name: /Add cost centre/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Add additional cost/ }));
    for (let round = 0; round < 3; round++) for (const b of [...container.querySelectorAll('button[aria-expanded="false"]')]) fireEvent.click(b);

    const labelled = new Set([...container.querySelectorAll("[title]")].map((e) => e.getAttribute("title")));
    const text = container.textContent ?? "";
    // Three fields are not typed into a labelled box: the customer's Ledger Name is chosen from the Customer Master
    // (and Item Name from the Product Master); the customer's and the sales ledger's amounts are worked out and shown.
    const elsewhere: Record<string, () => boolean> = {
      "Item Name": () => text.includes("Item Name") && !!screen.getByRole("combobox", { name: "Item 1 product" }),
      "Ledger Name": () => labelled.has("Ledger Name") && !!screen.getByRole("combobox", { name: "Customer" }),
      "Ledger Amount": () => labelled.has("Ledger Amount") && /Dr ₹/.test(text) && /Cr ₹/.test(text),
    };
    expect(SO_FIELDS.filter((f) => !f.outsideMatrix && !f.workflow)).toHaveLength(91);
    // (The 238 provisions are off by default: tests/unit/sales-order-provisions.test.tsx covers them once enabled.)
    const newOrder = SO_FIELDS.filter((f) => !f.workflow && !f.defaultOff);
    expect(newOrder).toHaveLength(112);
    const missing = newOrder.filter((f) => !(elsewhere[f.tallyName]?.() ?? labelled.has(f.tallyName))).map((f) => f.tallyName);
    expect(missing).toEqual([]);
    // The pre-close fields ("Update") are never on a new order: they belong to the order's own page.
    expect(SO_FIELDS.filter((f) => f.workflow && labelled.has(f.tallyName))).toEqual([]);
  });
});
