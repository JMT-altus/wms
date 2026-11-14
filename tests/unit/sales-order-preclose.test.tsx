// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Pre-closing a delivery of a stored Sales Order (the Read Me's "Update" fields): the checks the server applies, and
// the order page's deliveries, history and form. All data is invented.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(forms-module)/forms/documents/[type]/[id]/actions", () => ({ preCloseDelivery: vi.fn() }));

import { checkPreClose, deliveriesOf, deliveryState, type PreClosure } from "@/lib/tally/sales-order-preclose";
import { buildCatalogue } from "@/lib/tally/sales-order-config";
import { SalesOrderPreClose } from "@/components/forms/tally/sales-order-preclose";

afterEach(() => cleanup());

const TODAY = "2026-10-31";
const lines = [
  { item: "Gear Motor", allocations: [{ quantity: 1.5, ratePer: "Nos", dueDate: "2026-04-15" }, { quantity: 0.5, ratePer: "Nos", dueDate: "2026-04-30" }] },
  { item: "Coupling", allocations: [{ quantity: 3, ratePer: "Nos", dueDate: null }] },
];
const order = { documentDate: "2026-04-01", cancelled: false, lines };
const pc = (lineNo: number, allocationNo: number, quantity: number, n = 1): PreClosure => ({ id: `p${n}`, lineNo, allocationNo, quantity, reason: "Short supply", precloseDate: "2026-04-10", recordedBy: "A. Person", recordedAt: "2026-04-10T05:00:00.000Z" });
const input = (over: Partial<Parameters<typeof checkPreClose>[2]> = {}) => ({ lineNo: 1, allocationNo: 1, quantity: "0.5", reason: "Customer reduced the order", date: "2026-04-10", expectedCount: 0, ...over });
const errors = (r: ReturnType<typeof checkPreClose>) => (r.ok ? "" : r.errors.join(" "));

describe("the deliveries of an order and what is open on each", () => {
  it("numbers deliveries by line and allocation, from 1; open = Billed Quantity less everything pre-closed", () => {
    const d = deliveriesOf(lines);
    expect(d.map((x) => [x.lineNo, x.allocationNo, x.item, x.quantity])).toEqual([
      [1, 1, "Gear Motor", 1.5],
      [1, 2, "Gear Motor", 0.5],
      [2, 1, "Coupling", 3],
    ]);
    // Decimal quantities add up exactly (0.1 + 0.2 is 0.3).
    expect(deliveryState(d[2]!, [pc(2, 1, 0.1), pc(2, 1, 0.2, 2), pc(1, 1, 1, 3)])).toEqual({ preClosed: 0.3, open: 2.7 });
    expect(deliveriesOf([{ item: "Old", allocations: undefined }])).toEqual([]); // stored before deliveries were kept
  });
});

describe("checking a pre-closure", () => {
  it("a valid one gives the delivery, the quantity, the reason (spaces tidied) and the date as yyyy-mm-dd", () => {
    expect(checkPreClose(order, [], input({ reason: "  Customer   reduced ", date: "10-04-2026" }), TODAY)).toMatchObject({ ok: true, quantity: 0.5, reason: "Customer reduced", date: "2026-04-10", delivery: { lineNo: 1, allocationNo: 1 } });
    // Several partial pre-closures, up to exactly what is open.
    expect(checkPreClose(order, [pc(1, 1, 1)], input({ quantity: "0.5", expectedCount: 1 }), TODAY)).toMatchObject({ ok: true });
  });

  it("refuses more than is open, zero, negative or non-numbers, and more than 6 decimals", () => {
    expect(errors(checkPreClose(order, [pc(1, 1, 1)], input({ quantity: "0.6", expectedCount: 1 }), TODAY))).toMatch(/Pre-Close Quantity 0.6 is more than the delivery's open quantity, 0.5 Nos/);
    expect(errors(checkPreClose(order, [], input({ quantity: "0" }), TODAY))).toMatch(/more than zero/);
    expect(errors(checkPreClose(order, [], input({ quantity: "-1" }), TODAY))).toMatch(/isn't a number/);
    expect(errors(checkPreClose(order, [], input({ quantity: "half" }), TODAY))).toMatch(/isn't a number/);
    expect(errors(checkPreClose(order, [], input({ quantity: "0.1234567" }), TODAY))).toMatch(/up to 6 decimals/);
    expect(errors(checkPreClose(order, [], input({ quantity: "" }), TODAY))).toMatch(/Pre-Close Quantity is required/);
  });

  it("refuses a date before the order, after today or unreadable, and a missing or over-long reason", () => {
    expect(errors(checkPreClose(order, [], input({ date: "2026-03-31" }), TODAY))).toMatch(/before the order's Voucher Date 2026-04-01/);
    expect(errors(checkPreClose(order, [], input({ date: "2026-11-01" }), TODAY))).toMatch(/after today \(2026-10-31\)/);
    expect(errors(checkPreClose(order, [], input({ date: "31-02-2026" }), TODAY))).toMatch(/can't be read as a date/);
    expect(errors(checkPreClose(order, [], input({ date: "" }), TODAY))).toMatch(/Pre-Close Date is required/);
    expect(errors(checkPreClose(order, [], input({ reason: " " }), TODAY))).toMatch(/Reason for Pre-Close is required/);
    expect(errors(checkPreClose(order, [], input({ reason: "x".repeat(501) }), TODAY))).toMatch(/longer than 500/);
  });

  it("refuses a delivery that isn't in the order, a cancelled order, a fully pre-closed delivery and a stale screen", () => {
    expect(errors(checkPreClose(order, [], input({ allocationNo: 3 }), TODAY))).toMatch(/isn't in this order/);
    expect(errors(checkPreClose({ ...order, cancelled: true }, [], input(), TODAY))).toMatch(/marked Cancelled/);
    expect(errors(checkPreClose(order, [pc(1, 2, 0.5)], input({ allocationNo: 2, expectedCount: 1 }), TODAY))).toMatch(/already fully pre-closed/);
    // The screen saw no pre-closure, but one was recorded meanwhile: refused, so nothing is added by accident.
    expect(errors(checkPreClose(order, [pc(1, 1, 0.5)], input({ expectedCount: 0 }), TODAY))).toMatch(/someone else meanwhile/);
  });

  it("follows the configuration: its labels, and a reason made optional", () => {
    const c = buildCatalogue([{ fieldKey: "preCloseReason", isCustom: false, scope: "allocation", label: "Why", section: null, displayOrder: null, requirement: "optional", condition: null, fieldType: null, options: null, inForm: true, inImport: false, onOrderPage: true, status: "active", rowVersion: 1 },
      { fieldKey: "preCloseQuantity", isCustom: false, scope: "allocation", label: "Qty to close", section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: false, onOrderPage: true, status: "active", rowVersion: 1 }]);
    expect(checkPreClose(order, [], input({ reason: "" }), TODAY, c)).toMatchObject({ ok: true, reason: null });
    expect(errors(checkPreClose(order, [], input({ quantity: "9" }), TODAY, c))).toMatch(/^Qty to close 9 is more than/);
  });
});

describe("the order page's deliveries and pre-closures", () => {
  const labels = { quantity: "Pre-Close Quantity", reason: "Reason for Pre-Close", date: "Pre-Close Date", reasonRequired: true };
  const deliveries = deliveriesOf(lines);
  const view = (over: Partial<React.ComponentProps<typeof SalesOrderPreClose>> = {}) => render(<SalesOrderPreClose documentId="00000000-0000-4000-8000-000000000001" deliveries={deliveries} records={[pc(1, 1, 1)]} ready canPreClose cancelled={false} labels={labels} {...over} />);

  it("shows each delivery's Billed Quantity, pre-closed and open quantity, and every pre-closure with who and when", () => {
    view();
    const table = screen.getByRole("table", { name: "Deliveries and pre-closures" });
    const first = within(table).getByText("1.1").closest("tr")!;
    expect(within(first).getByText("1.5 Nos")).toBeTruthy();
    expect(within(first).getByText("1 Nos")).toBeTruthy(); // pre-closed
    expect(within(first).getByText("0.5 Nos")).toBeTruthy(); // open
    expect(within(table).getByText(/Pre-closed 1 Nos on .* — Short supply · recorded by A\. Person/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Pre-close delivery/ })).toHaveLength(3);
  });

  it("offers no Pre-close without the permission, before the database update, or on a cancelled order — the history still shows", () => {
    for (const over of [{ canPreClose: false }, { ready: false }, { cancelled: true }]) {
      view(over);
      expect(screen.queryAllByRole("button", { name: /^Pre-close delivery/ })).toEqual([]);
      expect(screen.getByText(/recorded by A\. Person/)).toBeTruthy();
      cleanup();
    }
    view({ ready: false });
    expect(screen.getByRole("status").textContent).toMatch(/needs database update 0129/);
  });

  it("sends one submission with its own request id, once, however many times it is clicked; a repeat is said to be one", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const record = vi.fn(() => new Promise((r) => (resolve = r))) as unknown as React.ComponentProps<typeof SalesOrderPreClose>["record"];
    view({ record });
    fireEvent.click(screen.getByRole("button", { name: "Pre-close delivery 1.2" }));
    const form = screen.getByRole("group", { name: "Pre-close delivery 1.2" });
    fireEvent.change(within(form).getByLabelText("Pre-Close Quantity"), { target: { value: "0.5" } });
    fireEvent.change(within(form).getByLabelText("Reason for Pre-Close"), { target: { value: "Not needed" } });
    fireEvent.change(within(form).getByLabelText("Pre-Close Date"), { target: { value: "20/04/26" } });
    const send = within(form).getByRole("button", { name: /Record pre-closure/ });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const sent = (record as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls[0]![0];
    expect(sent).toMatchObject({ lineNo: 1, allocationNo: 2, quantity: "0.5", reason: "Not needed", date: "2026-04-20", expectedCount: 0 });
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
    resolve({ ok: true, repeated: true, record: pc(1, 2, 0.5) });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/already recorded; it wasn't recorded again/));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("says what is missing before sending, and shows the server's reason when it refuses", async () => {
    const record = vi.fn(async () => ({ ok: false as const, error: "Pre-Close Quantity 9 is more than the delivery's open quantity, 0.5 Nos." }));
    view({ record });
    fireEvent.click(screen.getByRole("button", { name: "Pre-close delivery 1.1" }));
    const form = screen.getByRole("group", { name: "Pre-close delivery 1.1" });
    fireEvent.click(within(form).getByRole("button", { name: /Record pre-closure/ }));
    expect(within(form).getByRole("alert").textContent).toMatch(/Pre-Close Quantity, Reason for Pre-Close, Pre-Close Date are required/);
    expect(record).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Pre-Close Quantity"), { target: { value: "9" } });
    fireEvent.change(within(form).getByLabelText("Reason for Pre-Close"), { target: { value: "x" } });
    fireEvent.change(within(form).getByLabelText("Pre-Close Date"), { target: { value: "20/04/26" } });
    fireEvent.click(within(form).getByRole("button", { name: /Record pre-closure/ }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toMatch(/more than the delivery's open quantity/));
  });
});
