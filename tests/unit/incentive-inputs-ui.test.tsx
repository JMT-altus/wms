// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Incentive Calculation input screens, the approval/payout panel and the Forms Sales Order card, with the server
// actions MOCKED. Invented data only.
const a = vi.hoisted(() => ({ record: vi.fn(), retire: vi.fn(), rep: vi.fn(), event: vi.fn(), invoices: vi.fn(), submit: vi.fn(), withdraw: vi.fn(), decide: vi.fn(), pay: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: a.push }) }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions", () => ({
  recordOrderSalesperson: (...x: unknown[]) => a.record(...x),
  retireIncentiveInput: (...x: unknown[]) => a.retire(...x),
  recordRepresentativePeriod: (...x: unknown[]) => a.rep(...x),
  recordReceiptEvent: (...x: unknown[]) => a.event(...x),
  customerInvoices: (...x: unknown[]) => a.invoices(...x),
}));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({
  submitCategoryAMonth: (...x: unknown[]) => a.submit(...x),
  withdrawCategoryAMonth: (...x: unknown[]) => a.withdraw(...x),
  decideCategoryAMonth: (...x: unknown[]) => a.decide(...x),
  recordCategoryAPayout: (...x: unknown[]) => a.pay(...x),
  calculateCategoryAMonth: vi.fn(),
  setCategoryAMonthLocked: vi.fn(),
}));

import { OrderSalespeople, type OrderSalespeopleProps } from "@/components/admin/master/incentive-rules/order-salespeople";
import { Representatives, type RepresentativesProps } from "@/components/admin/master/incentive-rules/representatives";
import { ReceiptEvents, type ReceiptEventsProps } from "@/components/admin/master/incentive-rules/receipt-events";
import { CalcWorkflow, type WorkflowProps } from "@/components/admin/master/incentive-rules/calc-workflow";
import { SalesOrderSalespeople } from "@/components/forms/tally/sales-order-salespeople";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ORDERS: OrderSalespeopleProps = {
  ready: true,
  canEdit: true,
  truncated: false,
  employees: [{ id: ID(9), name: "Sample Rep" }],
  filters: { search: "", filter: "all", from: "", to: "" },
  focus: null,
  rows: [
    { id: ID(1), documentNo: "SO 1", documentDate: "2026-04-05", customerName: "Customer One", totalPaise: 10_00_000_00, cancelled: false, status: "none", attributions: [], retired: [] },
    { id: ID(2), documentNo: "SO 2", documentDate: "2026-04-06", customerName: "Customer One", totalPaise: 10_00_000_00, cancelled: false, status: "complete", attributions: [{ id: ID(20), employeeName: "Sample Rep", sharePpm: 1_000_000, note: null, createdAt: "2026-05-01T00:00:00Z", createdByName: "Clerk" }], retired: [{ id: ID(21), employeeName: "Old Rep", sharePpm: 1_000_000, retiredAt: "2026-04-30T00:00:00Z", retiredReason: "Wrong person" }] },
  ],
};

describe("Order salespeople", () => {
  it("shows each order's status, salespeople and retired history", () => {
    render(<OrderSalespeople {...ORDERS} />);
    expect(within(screen.getByRole("row", { name: "Order SO 1" })).getByText("Needs a salesperson")).toBeTruthy();
    const so2 = within(screen.getByRole("row", { name: "Order SO 2" }));
    expect(so2.getByText("Attributed")).toBeTruthy();
    expect(so2.getByText(/Wrong person/)).toBeTruthy();
  });
  it("records a salesperson with a share, and retires one only with a reason", async () => {
    a.record.mockResolvedValue({ ok: true, id: ID(30) });
    a.retire.mockResolvedValue({ ok: true });
    render(<OrderSalespeople {...ORDERS} />);
    fireEvent.click(within(screen.getByRole("row", { name: "Order SO 1" })).getByRole("button", { name: /Add salesperson/ }));
    fireEvent.change(screen.getByLabelText("Salesperson for SO 1"), { target: { value: ID(9) } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(a.record).toHaveBeenCalledWith({ documentId: ID(1), employeeId: ID(9), sharePpm: 1_000_000, note: null }));
    fireEvent.click(screen.getByRole("button", { name: "Retire Sample Rep on SO 2" }));
    expect((screen.getAllByRole("button", { name: "Retire" }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for retiring Sample Rep on SO 2"), { target: { value: "Moved to another salesperson" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Retire" }).at(-1)!);
    await waitFor(() => expect(a.retire).toHaveBeenCalledWith({ entity: "attribution", id: ID(20), reason: "Moved to another salesperson" }));
  });
  it("shows the server's refusal as it is worded", async () => {
    a.record.mockResolvedValue({ ok: false, error: "Sample Rep isn't included in Salesperson Eligibility on 2026-04-05 in any published Category A configuration." });
    render(<OrderSalespeople {...ORDERS} />);
    fireEvent.click(within(screen.getByRole("row", { name: "Order SO 1" })).getByRole("button", { name: /Add salesperson/ }));
    fireEvent.change(screen.getByLabelText("Salesperson for SO 1"), { target: { value: ID(9) } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/isn't included in Salesperson Eligibility/));
  });
  it("offers nothing to change without the inputs permission", () => {
    render(<OrderSalespeople {...ORDERS} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Add salesperson/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retire/ })).toBeNull();
  });
  it("searches through the URL", () => {
    render(<OrderSalespeople {...ORDERS} />);
    fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: "SO 1" } });
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(a.push).toHaveBeenCalledWith("/master-setup/incentive-rules/calculation/salespeople?search=SO+1&filter=missing");
  });
});

const REPS: RepresentativesProps = {
  ready: true,
  canEdit: true,
  truncated: false,
  employees: [{ id: ID(9), name: "Sample Rep" }],
  filters: { search: "", filter: "all" },
  rows: [{ id: ID(5), name: "Customer One", code: "C1", currentRepName: "Sample Rep", periods: [{ id: ID(50), employeeName: "Sample Rep", from: "2026-01-01", to: null, note: null, createdAt: "2026-01-02T00:00:00Z", retiredAt: null, retiredReason: null }] }],
};

describe("Representatives", () => {
  it("records a period with its dates", async () => {
    a.rep.mockResolvedValue({ ok: false, error: "The database refused this: The customer already has a representative for part of that period" });
    render(<Representatives {...REPS} />);
    fireEvent.click(screen.getByRole("button", { name: /Add period/ }));
    fireEvent.change(screen.getByLabelText("Representative for Customer One"), { target: { value: ID(9) } });
    fireEvent.change(screen.getByLabelText("From for Customer One"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(a.rep).toHaveBeenCalledWith({ customerId: ID(5), employeeId: ID(9), from: "2026-06-01", to: null, note: null }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already has a representative/));
  });
});

const RECEIPTS: ReceiptEventsProps = {
  ready: true,
  canEdit: true,
  truncated: false,
  filters: { search: "", filter: "all" },
  rows: [
    { id: ID(7), documentType: "customer-receipts", documentNo: "RC 9", documentDate: "2026-05-01", customerName: "Customer One", customerId: ID(5), totalPaise: 20_00_000_00, refId: null, refNo: null, events: [] },
    { id: ID(8), documentType: "credit-notes", documentNo: "CN 1", documentDate: "2026-05-02", customerName: "Customer One", customerId: ID(5), totalPaise: 1_00_000_00, refId: ID(3), refNo: "INV 3", events: [] },
  ],
};

describe("Receipt events", () => {
  it("allocates an on-account receipt to one of the customer's invoices, oldest first", async () => {
    a.invoices.mockResolvedValue([{ id: ID(3), no: "INV 3", date: "2026-04-05", totalPaise: 10_00_000_00 }]);
    a.event.mockResolvedValue({ ok: true, id: ID(70) });
    render(<ReceiptEvents {...RECEIPTS} />);
    expect(within(screen.getByRole("row", { name: "Document RC 9" })).getByText("On account")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("row", { name: "Document RC 9" })).getByRole("button", { name: /Add event/ }));
    await waitFor(() => expect(a.invoices).toHaveBeenCalledWith(ID(5)));
    fireEvent.change(await screen.findByLabelText("Invoice for RC 9"), { target: { value: ID(3) } });
    fireEvent.change(screen.getByLabelText("Amount for RC 9"), { target: { value: "1000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(a.event).toHaveBeenCalledWith({ documentId: ID(7), kind: "allocation", invoiceId: ID(3), amountPaise: 10_00_000_00, eventDate: "2026-05-01", note: null }));
  });
  it("a credit note can only be marked as a sales return", () => {
    render(<ReceiptEvents {...RECEIPTS} />);
    fireEvent.click(within(screen.getByRole("row", { name: "Document CN 1" })).getByRole("button", { name: /Add event/ }));
    const opts = within(screen.getByLabelText("Event for CN 1")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Sales return"]);
  });
});

const FLOW: WorkflowProps = {
  programId: ID(11),
  month: "2026-04-01",
  me: ID(12),
  rights: { submit: true, approve: true, pay: true, approvals: true, payouts: true },
  approvedTotalPaise: 925_00,
  period: { status: "submitted", rowVersion: 6, submissionNo: 1, approvalsRequired: 2, submittedByName: "Locker", submittedById: ID(13), submittedAt: "2026-10-01T00:00:00Z", releaseOn: null, payoutReference: null },
  approvals: [],
  payout: null,
};

describe("approval and payout panel", () => {
  it("rejection needs a reason; approval names its step", async () => {
    a.decide.mockResolvedValue({ ok: true, rowVersion: 7, status: "submitted", step: 1 });
    render(<CalcWorkflow {...FLOW} />);
    expect((screen.getByRole("button", { name: "Reject incentives" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Approve incentives (step 1)" }));
    await waitFor(() => expect(a.decide).toHaveBeenCalledWith({ programId: ID(11), month: "2026-04-01", rowVersion: 6, decision: "approve", reason: null }));
  });
  it("the submitter isn't offered approval", () => {
    render(<CalcWorkflow {...FLOW} me={ID(13)} />);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getByText(/another person approves it/)).toBeTruthy();
  });
  it("an approved month records its payout reference; a paid one offers nothing", () => {
    const { unmount } = render(<CalcWorkflow {...FLOW} period={{ ...FLOW.period, status: "approved", releaseOn: "2026-12-01" }} />);
    expect(screen.getByLabelText("Payout reference")).toBeTruthy();
    unmount();
    render(<CalcWorkflow {...FLOW} period={{ ...FLOW.period, status: "paid", releaseOn: "2026-12-01", payoutReference: "PAY-1" }} payout={{ reference: "PAY-1", releaseOn: "2026-12-01", paidOn: "2026-12-02", totalPaise: 925_00, recordedByName: "Payer", note: null, lines: [{ employeeName: "Sample Rep", payablePaise: 925_00, adjustmentsPaise: 0, amountPaise: 925_00 }] }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/A paid month is final/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Payout lines" })).getAllByText("₹925.00").length).toBe(2);
  });
});

describe("Forms Sales Order card", () => {
  it("says plainly when no salesperson is recorded, and links to the screen", () => {
    render(<SalesOrderSalespeople documentId={ID(1)} rows={[]} canEdit />);
    expect(screen.getByText(/No salesperson recorded/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Record or change" }).getAttribute("href")).toContain(`order=${ID(1)}`);
  });
  it("lists the salespeople and flags shares below 100%", () => {
    render(<SalesOrderSalespeople documentId={ID(1)} rows={[{ id: ID(2), employeeName: "Sample Rep", sharePpm: 600_000, active: true, retiredReason: null }]} canEdit={false} />);
    expect(screen.getByText("Sample Rep")).toBeTruthy();
    expect(screen.getByText(/add up to 60%/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View in Order salespeople" })).toBeTruthy();
  });
});

import { Approvals, type ApprovalsProps } from "@/components/admin/master/incentive-rules/approvals";

const MONTHS: ApprovalsProps = {
  ready: true,
  today: "2026-11-17",
  programs: [{ id: ID(11), code: "SALES", name: "Sales team" }],
  programId: ID(11),
  showApprovals: true,
  showPayouts: true,
  periods: [
    { id: ID(1), month: "2026-06-01", status: "submitted", run: { configVersionNo: 2, asOf: "2026-10-31", salespeople: 3, payablePaise: 3_000_00 }, approvedTotalPaise: 3_000_00, submissionNo: 2, submittedByName: "Locker", submittedAt: "2026-11-01T00:00:00Z", approvalsRequired: 2, approvals: [{ submissionNo: 1, stepNo: 1, decision: "reject", reason: "Refund missing", actorName: "Approver A", at: "2026-10-20T00:00:00Z" }, { submissionNo: 2, stepNo: 1, decision: "approve", reason: null, actorName: "Approver B", at: "2026-11-02T00:00:00Z" }], releaseOn: null, payout: null },
    { id: ID(2), month: "2026-05-01", status: "approved", run: { configVersionNo: 2, asOf: "2026-09-30", salespeople: 1, payablePaise: 925_00 }, approvedTotalPaise: 925_00, submissionNo: 1, submittedByName: "Locker", submittedAt: "2026-10-01T00:00:00Z", approvalsRequired: 1, approvals: [], releaseOn: "2026-12-01", payout: null },
    { id: ID(3), month: "2026-04-01", status: "paid", run: { configVersionNo: 1, asOf: "2026-09-30", salespeople: 1, payablePaise: 925_00 }, approvedTotalPaise: 925_00, submissionNo: 1, submittedByName: "Locker", submittedAt: "2026-10-01T00:00:00Z", approvalsRequired: 1, approvals: [], releaseOn: "2026-10-02", payout: { reference: "NEFT-001", paidOn: "2026-10-03", totalPaise: 925_00, recordedByName: "Payer" } },
  ],
};

describe("Approvals screen", () => {
  it("shows the stage, who may approve next by rule, the rejection reason, payout eligibility and reference", () => {
    render(<Approvals {...MONTHS} />);
    const june = within(screen.getByRole("row", { name: "Month 2026-06" }));
    expect(june.getByText("Awaiting Incentive Approval")).toBeTruthy();
    expect(june.getByText(/Step 2 of 2: any approver other than Locker, Approver B/)).toBeTruthy();
    expect(june.getByText(/Rejected by Approver A .*Refund missing/)).toBeTruthy();
    expect(within(screen.getByRole("row", { name: "Month 2026-05" })).getByText(/Eligible from 01 Dec 2026/)).toBeTruthy();
    const april = within(screen.getByRole("row", { name: "Month 2026-04" }));
    expect(april.getByText("NEFT-001")).toBeTruthy();
    expect(april.getByText(/recorded by Payer/)).toBeTruthy();
  });
  it("hides history and payout details without their view permissions", () => {
    render(<Approvals {...MONTHS} showApprovals={false} showPayouts={false} />);
    expect(screen.queryByText(/Refund missing/)).toBeNull();
    expect(screen.queryByText("NEFT-001")).toBeNull();
  });
  it("filters to months needing action", () => {
    render(<Approvals {...MONTHS} />);
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "action" } });
    expect(screen.queryByRole("row", { name: "Month 2026-04" })).toBeNull();
    expect(screen.getByRole("row", { name: "Month 2026-06" })).toBeTruthy();
  });
});

describe("payout amount on the approval panel", () => {
  it("sends the amount paid for reconciliation", async () => {
    a.pay.mockResolvedValue({ ok: false, error: "The amount paid (₹500.00) doesn't match the approved amount (₹925.00). Partial payouts aren't permitted by the configuration; nothing was recorded." });
    render(<CalcWorkflow {...FLOW} period={{ ...FLOW.period, status: "approved", releaseOn: "2026-11-01" }} />);
    expect(screen.getByText(/Approved for ₹925\.00/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Payout reference"), { target: { value: "NEFT-9" } });
    fireEvent.change(screen.getByLabelText("Amount paid"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payout" }));
    await waitFor(() => expect(a.pay).toHaveBeenCalledWith({ programId: ID(11), month: "2026-04-01", rowVersion: 6, reference: "NEFT-9", paidOn: "2026-11-01", amountPaise: 500_00, note: null }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/doesn't match the approved amount/));
  });
});
