// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Category B on screen, with data access and server actions MOCKED (synthetic data): the navigation, the rules editor
// for a Category B version, the calculation screen's qualification evidence and its requests, the review queue's
// decision form (reason required, read-only without the permission), and a salesperson's own Category B.
const m = vi.hoisted(() => ({ monthView: vi.fn(), listApprovalPeriods: vi.fn(), calc: vi.fn(), lock: vi.fn(), decide: vi.fn(), retire: vi.fn(), refresh: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: m.push }) }));
vi.mock("@/lib/toast", () => ({ fireToast: m.toast }));
vi.mock("@/lib/queries/incentive-calc", () => ({ monthView: m.monthView, listApprovalPeriods: m.listApprovalPeriods, todayIST: () => "2026-11-17" }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({
  calculateCategoryAMonth: (...x: unknown[]) => m.calc(...x),
  setCategoryAMonthLocked: (...x: unknown[]) => m.lock(...x),
  submitCategoryAMonth: vi.fn(),
  withdrawCategoryAMonth: vi.fn(),
  decideCategoryAMonth: vi.fn(),
  recordCategoryAPayout: vi.fn(),
  recordCategoryBDecision: (...x: unknown[]) => m.decide(...x),
  retireCategoryBDecision: (...x: unknown[]) => m.retire(...x),
}));
vi.mock("@/app/(masters)/master-setup/incentive-rules/actions", () => ({ saveIncentiveDraft: vi.fn(), submitIncentiveVersion: vi.fn(), approveIncentiveVersion: vi.fn(), rejectIncentiveVersion: vi.fn(), publishIncentiveVersion: vi.fn(), withdrawIncentiveVersion: vi.fn(), returnIncentiveVersionToDraft: vi.fn(), discardIncentiveVersion: vi.fn(), createIncentiveDraft: vi.fn(), createIncentiveProgram: vi.fn() }));

import { MODULES } from "@/lib/nav-modules";
import { MyCategoryA } from "@/components/incentive/my-category-a";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CategoryACalculation, type CalcProps } from "@/components/admin/master/incentive-rules/calculation";
import { BReview } from "@/components/admin/master/incentive-rules/b-review";
import { IncentiveVersionEditor } from "@/components/admin/master/incentive-rules/version-editor";
import { CATEGORY_B_TEMPLATE, sectionsFor } from "@/lib/incentives/rules-config/spec";
import type { IncentiveCalcRights } from "@/lib/auth/incentive-calc";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NONE: IncentiveCalcRights = { view: false, run: false, lock: false, inputs: false, approvals: false, payouts: false, submit: false, approve: false, pay: false, qualify: false, review: false, void: false };
const PROGRAM = "22222222-2222-4222-8222-222222222222";

describe("navigation", () => {
  it("the Incentive Tracker has Category B and Category B Approvals (admin-only in the rail); My Incentives doesn't claim them", () => {
    const tracker = MODULES.find((x) => x.label === "Incentive Tracker")!;
    const b = tracker.items.find((i) => i.href === "/incentive/category-b")!;
    const ba = tracker.items.find((i) => i.href === "/incentive/category-b/approvals")!;
    expect([b.label, b.adminOnly, ba.label, ba.adminOnly]).toEqual(["Category B", true, "Category B Approvals", true]);
    expect(tracker.items.find((i) => i.href === "/incentive")!.notMatch).toContain("/incentive/category-b");
    expect(tracker.items.map((i) => i.href)).toEqual(expect.arrayContaining(["/incentive/category-a", "/incentive/category-a/approvals"]));
  });
});

describe("the rules editor for a Category B version", () => {
  it("shows Category B's sections (no slabs), the rate as a percentage, and what must still be entered", () => {
    render(
      <IncentiveVersionEditor
        version={{ id: "11111111-1111-4111-8111-111111111111", programId: PROGRAM, programCode: "SALES", programName: "Sales", categoryCode: "B", versionNo: 1, status: "draft", effectiveFrom: null, effectiveTo: null, rowVersion: 1, changeNote: null, rejectionReason: null, createdByName: "Author", approvedByName: null, publishedByName: null }}
        config={CATEGORY_B_TEMPLATE}
        inForce={null}
        published={[]}
        history={[]}
        choices={{ employees: [], departments: [], roles: ["doer", "initiator", "both"] }}
        rights={{ edit: true, submit: true, approve: true, publish: true, backdate: false, history: true }}
        meIsWriter={false}
        currentMonth="2026-11-01"
      />,
    );
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent!.replace(/\d+$/, ""));
    expect(tabs).toEqual([...sectionsFor("B").map((s) => s.label), "Preview", "History"]);
    expect(tabs).not.toContain("Incentive Slabs");
    expect((screen.getByLabelText("Existing customer: months looked back") as HTMLInputElement).value).toBe("24");
    expect((screen.getByLabelText("Minimum taxable value of one invoice") as HTMLInputElement).value).toBe("100000");
    expect((screen.getByLabelText("Incentive rate") as HTMLInputElement).value).toBe(""); // never assumed
    const missing = within(screen.getByRole("region", { name: "Not yet configured" }));
    expect(missing.getByText(/Incentive rate \(Category B Qualification\) isn't set/)).toBeTruthy();
    expect(missing.getByText(/Most a salesperson can earn from Category B in a month \(Rounding and Limits\) isn't set/)).toBeTruthy();
    expect(missing.getByText(/Most one Sales Order can earn from Category B \(Rounding and Limits\) isn't set/)).toBeTruthy();
  });
});

describe("the Category B calculation screen", () => {
  it("refuses anyone without an Incentive Calculation right, and reads nothing", async () => {
    render(await CategoryACalculationScreen({ me: { id: "x" } as never, rights: NONE, searchParams: {}, basePath: "/incentive/category-b", variant: "tracker", head: <h1>Category B</h1>, category: "B" }));
    expect(screen.getByRole("note").textContent).toMatch(/No access/);
    expect(m.monthView).not.toHaveBeenCalled();
  });
  it("reads Category B's month and links its tabs inside the tracker", async () => {
    m.monthView.mockResolvedValue({ ready: true, programs: [], period: null, current: null, runs: [], adjustmentsIn: [], adjustmentsOut: [], latestProblems: [], approvals: [], payout: null, submittedByName: null, approvedTotalPaise: null, qualifications: [], reviewInvoices: [] });
    render(await CategoryACalculationScreen({ me: { id: "x" } as never, rights: { ...NONE, view: true, qualify: true }, searchParams: { month: "2026-04" }, basePath: "/incentive/category-b", variant: "tracker", head: <h1>Category B</h1>, category: "B" }));
    expect(m.monthView).toHaveBeenCalledWith(null, "2026-04-01", undefined, "B");
    const nav = within(screen.getByRole("navigation", { name: "Incentive calculation sections" }));
    expect(nav.getByRole("link", { name: "Calculation" }).getAttribute("href")).toBe("/incentive/category-b");
    expect(nav.getByRole("link", { name: "Approvals" }).getAttribute("href")).toBe("/incentive/category-b/approvals");
    expect(nav.getByRole("link", { name: /Review & decisions/ }).getAttribute("href")).toBe("/master-setup/incentive-rules/calculation/qualifications");
  });
  const BASE: CalcProps = {
    category: "B",
    ready: true,
    canRun: true,
    canLock: true,
    programs: [{ id: PROGRAM, code: "SALES", name: "Sales" }],
    programId: PROGRAM,
    month: "2026-04-01",
    period: { status: "open", rowVersion: 2 },
    latestProblems: [],
    current: null,
    runs: [],
    adjustmentsIn: [],
    qualifications: [
      { id: "q1", orderNo: "SO 1", orderDate: "2026-04-02", customerName: "Customer One", outcome: "qualified", automaticOutcome: "qualified", overrideDecision: null, invoiceNo: "INV 1", invoiceDate: "2026-04-05", netTaxablePaise: 1_20_000_00, baseExact: "120000", inMonth: true, pinned: false, reasons: ["Existing customer: 1 earlier Sales Order."], evidence: { earlierOrders: [{ no: "SO H", date: "2025-06-10" }] } },
      { id: "q2", orderNo: "SO 2", orderDate: "2026-04-03", customerName: "Customer One", outcome: "qualified", automaticOutcome: "needs-review", overrideDecision: "qualify", invoiceNo: "INV 2", invoiceDate: "2026-04-08", netTaxablePaise: 2_00_000_00, baseExact: "150000", inMonth: true, pinned: false, reasons: ["Not matched to the Product Master: Unmatched spare."], evidence: { unmatchedLines: ["Unmatched spare"] } },
    ],
    reviewInvoices: [{ invoiceId: "i9", invoiceNo: "INV 9", invoiceDate: "2026-04-20", reason: "It names no Sales Order: needs an admin's review." }],
    canQualify: true,
  };
  it("shows each order's outcome with the automatic one beside a manual decision, and the invoices needing review", () => {
    render(<CategoryACalculation {...BASE} />);
    const table = within(screen.getByRole("table", { name: "Qualification" }));
    expect(table.getAllByText("Qualified")).toHaveLength(2);
    expect(table.getByText(/Decided by hand \(qualifies\); the rules alone: needs review/)).toBeTruthy();
    expect(table.getByText("₹1,500.00")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Invoices needing review" })).getByText("INV 9")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/1 needs review/);
  });
  it("Calculate and Lock send category B; nothing else changes in the request", async () => {
    m.calc.mockResolvedValue({ ok: true, runId: "r", unchanged: false, adopted: true, status: "computed", outcome: "Adopted", problems: [] });
    render(<CategoryACalculation {...BASE} current={{ runId: "r", configVersionNo: 1, asOf: "2026-05-31", computedAt: "2026-06-01T00:00:00Z", computedByName: "Runner", inputsHash: "a".repeat(64), results: [], orders: [], receipts: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Calculate/ }));
    await waitFor(() => expect(m.calc).toHaveBeenCalledWith({ programId: PROGRAM, month: "2026-04-01", category: "B" }));
    m.lock.mockResolvedValue({ ok: true, rowVersion: 3, notes: [] });
    fireEvent.click(screen.getByRole("button", { name: /Lock month/ }));
    await waitFor(() => expect(m.lock).toHaveBeenCalledWith({ programId: PROGRAM, month: "2026-04-01", lock: true, rowVersion: 2, category: "B" }));
  });
});

describe("Review & decisions", () => {
  const props = {
    ready: true,
    programs: [{ id: PROGRAM, code: "SALES", name: "Sales" }],
    programId: PROGRAM,
    month: "2026-04-01",
    all: false,
    search: "",
    source: { runId: "r", adopted: true, asOf: "2026-05-31", configVersionNo: 1 },
    rows: [{ orderId: "33333333-3333-4333-8333-333333333333", orderNo: "SO 2", orderDate: "2026-04-03", customerName: "Customer One", outcome: "needs-review" as const, automatic: "needs-review" as const, invoiceNo: "INV 2", invoiceDate: "2026-04-08", netTaxablePaise: 2_00_000_00, baseExact: null, inMonth: false, pinned: false, reasons: ["Not matched to the Product Master: Unmatched spare."], evidence: {}, override: null, history: [] }],
    reviewInvoices: [],
    found: [],
  };
  it("without the qualify permission it is read-only", () => {
    render(<BReview {...props} canDecide={false} />);
    expect(screen.getByText(/Not matched to the Product Master/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record decision" })).toBeNull();
    expect(screen.getByText(/Read-only: deciding needs/)).toBeTruthy();
  });
  it("a decision needs a reason, and is sent with it", async () => {
    m.decide.mockResolvedValue({ ok: true, id: "o1" });
    render(<BReview {...props} canDecide />);
    const record = screen.getByRole("button", { name: "Record decision" }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for SO 2"), { target: { value: "Checked: a new spare line for this customer" } });
    expect(record.disabled).toBe(false);
    fireEvent.click(record);
    await waitFor(() => expect(m.decide).toHaveBeenCalledWith({ orderId: props.rows[0]!.orderId, decision: "qualify", reason: "Checked: a new spare line for this customer" }));
  });
  it("an existing decision shows who and why, and can be retired (with a reason) by an authorised admin", () => {
    render(<BReview {...props} canDecide rows={[{ ...props.rows[0]!, outcome: "qualified", override: { id: "o1", decision: "qualify", reason: "Checked", byName: "Admin One", at: "2026-06-01T00:00:00Z" }, history: [{ action: "record", note: "Checked", actorName: "Admin One", at: "2026-06-01T00:00:00Z", decision: "qualify" }] }]} />);
    expect(screen.getByText(/Admin One/, { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retire decision on SO 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record decision" })).toBeNull();
  });
});

describe("My Incentives → Category B (salesperson)", () => {
  const APPROVED = { month: "2026-04-01", programCode: "SALES", programName: "Sales team", status: "approved" as const, amountPaise: 2_700_00, releaseOn: "2026-06-01", paidOn: null, payoutReference: null, explanation: ["2 Sales Orders credited with Category B in 2026-04."] };
  it("shows the person's own approved amount apart from the old engine's historical Category B", () => {
    render(<MyCategoryA category="B" period="2026-04" ready months={[APPROVED]} awaiting={[]} historical={[{ lineCode: "B.1", category: "B", amountPaise: 1_500_00, explanation: "B.1 · CROSS-SELL — old engine.", entryType: "accrual" }]} />);
    expect(screen.getByRole("heading", { name: /Category B · Old Customer – New Product \/ New Brand/ })).toBeTruthy();
    expect(within(screen.getByLabelText("New Category B")).getByText("₹2,700.00")).toBeTruthy();
    expect(within(screen.getByLabelText("Historical Category B")).getByText(/Not added to the new Category B/)).toBeTruthy();
    expect(screen.queryByText("₹4,200.00")).toBeNull();
  });
  it("before Category B's cut-over month it says the old engine's Category B counts", () => {
    render(<MyCategoryA category="B" period="2026-03" ready months={[]} awaiting={[]} historical={[]} oldEngineMonth />);
    expect(within(screen.getByLabelText("New Category B")).getByText(/old engine's, shown with the other categories/)).toBeTruthy();
  });
});
