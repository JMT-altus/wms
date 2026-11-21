// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Categories C–G on screen, with data access and server actions MOCKED (synthetic data).
const m = vi.hoisted(() => ({ monthView: vi.fn(), calc: vi.fn(), push: vi.fn(), cDecide: vi.fn(), cRetire: vi.fn(), writeOff: vi.fn(), decideWriteOff: vi.fn(), voidMonth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: m.push }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/queries/incentive-calc", () => ({ monthView: m.monthView, listApprovalPeriods: vi.fn(), todayIST: () => "2026-11-18", heldItemsOf: async () => [], negativeBalancesAtLock: async () => ({ ready: true, items: [] }), aSafeguardsReady: async () => true, carryBalances: async () => [] }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({ calculateCategoryAMonth: (...x: unknown[]) => m.calc(...x), setCategoryAMonthLocked: vi.fn(), submitCategoryAMonth: vi.fn(), withdrawCategoryAMonth: vi.fn(), decideCategoryAMonth: vi.fn(), recordCategoryAPayout: vi.fn(), writeOffCategoryCarry: (...x: unknown[]) => m.writeOff(...x), decideCategoryCarryWriteOff: (...x: unknown[]) => m.decideWriteOff(...x), recordCategoryCDecision: (...x: unknown[]) => m.cDecide(...x), retireCategoryCDecision: (...x: unknown[]) => m.cRetire(...x), recordCategoryBDecision: vi.fn(), retireCategoryBDecision: vi.fn(), voidCategoryCMonth: (...x: unknown[]) => m.voidMonth(...x) }));

import { MODULES } from "@/lib/nav-modules";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CategoryACalculation } from "@/components/admin/master/incentive-rules/calculation";
import { MyCategoryA } from "@/components/incentive/my-category-a";
import type { IncentiveCalcRights } from "@/lib/auth/incentive-calc";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const NONE: IncentiveCalcRights = { view: false, run: false, lock: false, inputs: false, approvals: false, payouts: false, submit: false, approve: false, pay: false, qualify: false, review: false, void: false };
const PROGRAM = "22222222-2222-4222-8222-222222222222";

describe("Categories C–G on screen", () => {
  it("the Incentive Tracker has one admin-only Incentive Management entry, which the C–G screens (and A's and B's) light", () => {
    const items = MODULES.find((x) => x.label === "Incentive Tracker")!.items;
    expect(items.find((i) => i.href === "/incentive/manage")).toMatchObject({ label: "Incentive Management", adminOnly: true });
    expect(items.find((i) => i.href === "/incentive/manage")!.match).toEqual(expect.arrayContaining(["/incentive/category-a", "/incentive/category-b", "/incentive/category/"]));
    expect(items.filter((i) => i.href.startsWith("/incentive/category"))).toEqual([]);
  });
  it("without an Incentive Calculation right nothing is read", async () => {
    render(await CategoryACalculationScreen({ me: { id: "x" } as never, rights: NONE, searchParams: {}, basePath: "/incentive/category/d", variant: "tracker", head: <h1>D</h1>, category: "D" }));
    expect(screen.getByRole("note").textContent).toMatch(/No access/);
    expect(m.monthView).not.toHaveBeenCalled();
  });
  it("reads the category's own month and links its tabs inside the tracker", async () => {
    m.monthView.mockResolvedValue({ ready: true, programs: [], period: null, current: null, runs: [], adjustmentsIn: [], adjustmentsOut: [], latestProblems: [], approvals: [], payout: null, submittedByName: null, approvedTotalPaise: null, items: [], excludedNotes: [] });
    render(await CategoryACalculationScreen({ me: { id: "x" } as never, rights: { ...NONE, view: true }, searchParams: { month: "2026-06" }, basePath: "/incentive/category/e", variant: "tracker", head: <h1>E</h1>, category: "E" }));
    expect(m.monthView).toHaveBeenCalledWith(null, "2026-06-01", undefined, "E");
    const nav = within(screen.getByRole("navigation", { name: "Incentive calculation sections" }));
    expect(nav.getByRole("link", { name: "Calculation" }).getAttribute("href")).toBe("/incentive/category/e");
    expect(nav.getByRole("link", { name: "Incentive Approvals" }).getAttribute("href")).toBe("/incentive/category/e/approvals");
  });
  it("shows each credited item and why others weren't credited; Calculate sends the category", async () => {
    m.calc.mockResolvedValue({ ok: true, runId: "r", unchanged: false, adopted: true, status: "computed", outcome: "Adopted", problems: [] });
    render(
      <CategoryACalculation
        category="F"
        ready
        canRun
        canLock={false}
        programs={[{ id: PROGRAM, code: "SALES", name: "Sales" }]}
        programId={PROGRAM}
        month="2026-06-01"
        period={{ status: "open", rowVersion: 1 }}
        latestProblems={[]}
        current={null}
        runs={[]}
        adjustmentsIn={[]}
        items={[{ id: "i1", employeeName: "Rep", lineCode: "F.3", label: "Letterhead testimonial", baseExact: "30000", earnedExact: "30000", payableExact: "30000", multiplierPpm: null, status: "credited", explanation: ["Letterhead testimonial: ₹150.00 × 2 (it names the salesperson or a teammate) = ₹300.00."] }]}
        excludedNotes={[{ documentNo: "Google review", message: "Left out: 20 words, fewer than 50." }]}
      />,
    );
    const table = within(screen.getByRole("table", { name: "Credited items" }));
    expect(table.getByText("F.3")).toBeTruthy();
    expect(table.getAllByText("₹300.00").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("list", { name: "Not credited" })).getByText(/20 words/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Calculate/ }));
    await waitFor(() => expect(m.calc).toHaveBeenCalledWith({ programId: PROGRAM, month: "2026-06-01", category: "F" }));
  });
  it("an Approvals tab names the database update its own category needs (never Category A's 0132/0133 for C–G)", async () => {
    const { Approvals } = await import("@/components/admin/master/incentive-rules/approvals");
    const base = { ready: false, today: "2026-11-18", programs: [], programId: null, periods: [] } as never;
    for (const [category, re] of [["D", /0134 and 0135/], ["B", /0134 is/], ["A", /0132 and 0133/]] as const) {
      const { container, unmount } = render(<Approvals {...(base as Omit<import("@/components/admin/master/incentive-rules/approvals").ApprovalsProps, "category">)} category={category} />);
      expect(container.textContent, category).toMatch(re);
      if (category !== "A") expect(container.textContent, category).not.toMatch(/0132/);
      unmount();
    }
  });
  it("Category C has its own Review & decisions tab; it holds unmatched records and decides them only with a reason", async () => {
    const { CalcTabs } = await import("@/components/admin/master/incentive-rules/calc-ui");
    const { unmount } = render(<CalcTabs active="Calculation" category="C" />);
    expect(within(screen.getByRole("navigation", { name: "Incentive calculation sections" })).getByRole("link", { name: "Review & decisions" }).getAttribute("href")).toBe("/master-setup/incentive-rules/calculation/c-review");
    unmount();
    const { CReview } = await import("@/components/admin/master/incentive-rules/c-review");
    const rows = [
      { caseKind: "order-customer" as const, documentId: "11111111-1111-4111-8111-111111111111", documentNo: "SO 77", customerId: null, message: "Sales Order SO 77 isn't linked to a Customer Master record: held for review.", decidable: true, targets: [{ id: "22222222-2222-4222-8222-222222222222", label: "New Co" }], decision: null, history: [] },
      { caseKind: "customer-salesperson" as const, documentId: "33333333-3333-4333-8333-333333333333", documentNo: "SO 1", customerId: "c", message: "New customer New Co: nobody can be credited.", decidable: false, targets: [], decision: null, history: [] },
    ];
    m.cDecide.mockResolvedValue({ ok: true, id: "d" });
    const props = { ready: true, programs: [{ id: PROGRAM, code: "SALES", name: "Sales" }], programId: PROGRAM, month: "2026-06-01", source: { runId: "r", adopted: true, asOf: "2026-07-31", configVersionNo: 1 }, rows };
    const ro = render(<CReview {...props} canDecide={false} />);
    expect(screen.getByText(/Read-only: deciding needs the “Decide Category C review cases” permission/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record decision" })).toBeNull();
    ro.unmount();
    render(<CReview {...props} canDecide />);
    const list = within(screen.getByRole("region", { name: "Records held for review" }));
    expect(list.getByText("Nobody can be credited")).toBeTruthy();
    expect(list.getByRole("link", { name: "Order salespeople" }).getAttribute("href")).toBe("/master-setup/incentive-rules/calculation/salespeople");
    const record = screen.getByRole("button", { name: "Record decision" }) as HTMLButtonElement;
    expect(record.disabled).toBe(true); // no target, no reason yet
    fireEvent.change(screen.getByLabelText("Belongs to (SO 77)"), { target: { value: "22222222-2222-4222-8222-222222222222" } });
    expect(record.disabled).toBe(true); // still no reason
    fireEvent.change(screen.getByLabelText("Reason for SO 77"), { target: { value: "The customer's own order" } });
    fireEvent.click(record);
    await waitFor(() => expect(m.cDecide).toHaveBeenCalledWith({ documentId: rows[0]!.documentId, caseKind: "order-customer", decision: "link", targetId: "22222222-2222-4222-8222-222222222222", reason: "The customer's own order" }));
  });
  it("Category C's carried-forward balances are listed with what happened to each; writing one off needs the right and a reason", async () => {
    const { CarryLedger } = await import("@/components/admin/master/incentive-rules/carry-ledger");
    const balances = [
      { lotId: "44444444-4444-4444-8444-444444444444", employeeId: "e", employeeName: "Rep", month: "2026-11-01", heldPaise: 300000, remainingPaise: 0, entries: [{ kind: "released", month: "2027-01-01", amountPaise: -300000, byName: "payer", reason: null, at: "2027-01-31T00:00:00Z" }] },
      { lotId: "55555555-5555-4555-8555-555555555555", employeeId: "e", employeeName: "Rep", month: "2026-12-01", heldPaise: 300000, remainingPaise: 300000, entries: [] },
    ];
    m.writeOff.mockResolvedValue({ ok: true, amountPaise: 300000 });
    const ro = render(<CarryLedger balances={balances} canWriteOff={false} />);
    const region = within(screen.getByRole("region", { name: "Carried-forward balances" }));
    expect(region.getByText(/Released in 2027-01: ₹3,000.00/)).toBeTruthy();
    expect(region.getByText("Carried forward")).toBeTruthy();
    expect(region.queryByRole("button")).toBeNull();
    ro.unmount();
    render(<CarryLedger balances={balances} canWriteOff />);
    // Only the open balance can be written off — by REQUEST (a second person decides).
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Request write-off"]);
  });
  it("a write-off takes two people: the requester only sees it awaiting a second person; someone else approves or refuses it, each with a reason", async () => {
    const { CarryLedger } = await import("@/components/admin/master/incentive-rules/carry-ledger");
    const REQ = "66666666-6666-4666-8666-666666666666";
    const pending = [{ lotId: "55555555-5555-4555-8555-555555555555", employeeId: "e", employeeName: "Rep", month: "2026-12-01", heldPaise: 300000, remainingPaise: 300000, entries: [], writeOffRequest: { requestId: REQ, amountPaise: 300000, byId: "requester", byName: "Payer One", reason: "Left the company", at: "2027-01-02T00:00:00Z" }, writeOffs: [{ kind: "request" as const, amountPaise: 300000, byName: "Payer One", reason: "Left the company", at: "2027-01-02T00:00:00Z" }] }];
    const mine = render(<CarryLedger balances={pending} canWriteOff me="requester" />);
    expect(screen.getByText(/Write-off of ₹3,000.00 requested by Payer One .* awaiting a second person/)).toBeTruthy();
    expect(screen.getByText(/You requested it: a second person decides/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    mine.unmount();
    m.decideWriteOff.mockResolvedValue({ ok: true, amountPaise: 300000 });
    render(<CarryLedger balances={pending} canWriteOff me="someone-else" />);
    expect(screen.queryByRole("button", { name: /Request write-off/ })).toBeNull(); // one open request at a time
    fireEvent.click(screen.getByRole("button", { name: /^Approve write-off/ }));
    const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is required
    fireEvent.change(screen.getByLabelText(/Reason — Approve write-off/), { target: { value: "Exit settlement seen" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(m.decideWriteOff).toHaveBeenCalledWith({ requestId: REQ, decision: "approve", reason: "Exit settlement seen" }));
  });
  it("Void month: only after a REQUIRED reason and an explicit confirmation; a voided month says so, with who, why and what was carried", async () => {
    const { VoidMonth } = await import("@/components/admin/master/incentive-rules/void-month");
    m.voidMonth.mockResolvedValue({ ok: true, rowVersion: 3, carriedToMonth: "2029-05-01", carriedPaise: 300000 });
    const { unmount } = render(<VoidMonth programId={PROGRAM} month="2029-04-01" rowVersion={2} voided={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Void month…" }));
    const go = screen.getByRole("button", { name: "Void 2029-04" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for voiding the month"), { target: { value: "Abandoned" } });
    expect(go.disabled).toBe(true); // not confirmed yet
    fireEvent.click(screen.getByRole("checkbox"));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(m.voidMonth).toHaveBeenCalledWith({ programId: PROGRAM, month: "2029-04-01", rowVersion: 2, category: "C", reason: "Abandoned" }));
    unmount();
    render(<VoidMonth programId={PROGRAM} month="2029-04-01" rowVersion={3} voided={{ reason: "Abandoned", byName: "voider", at: "2029-06-01T00:00:00Z", carriedToMonth: "2029-05-01", carriedPaise: 300000 }} />);
    const v = within(screen.getByRole("region", { name: "Voided month" }));
    expect(v.getByText(/Voided by voider .* “Abandoned”/)).toBeTruthy();
    expect(v.getByText(/₹3,000.00 was carried into 2029-05/)).toBeTruthy();
    expect(v.queryByRole("button")).toBeNull();
  });
  it("Review & decisions lists the GLOBAL unattributed records with status, a party proposal, search and status filter; deciding needs the permission and a reason", async () => {
    const { CReview } = await import("@/components/admin/master/incentive-rules/c-review");
    const rows = [
      { documentId: "66666666-6666-4666-8666-666666666666", documentType: "customer-receipts", documentNo: "RC 9", date: "2029-09-04", partyName: "Void One", totalPaise: 1180000, caseKind: "receipt-customer" as const, status: "unresolved" as const, message: "Receipt RC 9 has no customer, and nothing it names places it. Its Tally party matches Void One (a proposal only).", proposals: [{ id: "77777777-7777-4777-8777-777777777777", label: "Void One" }], targets: [{ id: "77777777-7777-4777-8777-777777777777", label: "Void One" }], decision: null, history: [] },
      { documentId: "88888888-8888-4888-8888-888888888888", documentType: "sales-invoices", documentNo: "INV 9", date: "2029-09-02", partyName: "Stranger", totalPaise: 100, caseKind: "invoice-order" as const, status: "excluded" as const, message: "Invoice INV 9 has no customer.", proposals: [], targets: [], decision: { id: "99999999-9999-4999-8999-999999999999", decision: "exclude" as const, targetId: null, targetLabel: null, reason: "Duplicate", byName: "reviewer", at: "2029-09-10T00:00:00Z" }, history: [] },
    ];
    const queue = { ready: true, from: "2027-09-01", to: "2029-12-31", counts: { unresolved: 1, linked: 0, excluded: 1 }, rows, truncated: false };
    const props = { ready: true, programs: [{ id: PROGRAM, code: "SALES", name: "Sales" }], programId: PROGRAM, month: "2029-10-01", source: null, rows: [], unattributed: queue, search: "", status: "all" };
    const ro = render(<CReview {...props} canDecide={false} />);
    const region = within(screen.getByRole("region", { name: "Unattributed records" }));
    expect(region.getByText("Unattributed records (1 unresolved)")).toBeTruthy();
    expect(region.getByText(/Void One \(a proposal only\)/)).toBeTruthy();
    expect(region.getByText("Unresolved", { selector: "span" })).toBeTruthy();
    expect(region.getByText(/Decided: excluded/)).toBeTruthy();
    expect(region.queryByRole("button", { name: "Record decision" })).toBeNull();
    fireEvent.change(region.getByLabelText("Search unattributed records"), { target: { value: "void" } });
    fireEvent.click(region.getByRole("button", { name: "Search" }));
    expect(m.push).toHaveBeenCalledWith(expect.stringMatching(/uq=void/));
    fireEvent.change(region.getByLabelText("Status"), { target: { value: "linked" } });
    expect(m.push).toHaveBeenLastCalledWith(expect.stringMatching(/us=linked/));
    ro.unmount();
    m.cDecide.mockResolvedValue({ ok: true, id: "d" });
    render(<CReview {...props} canDecide />);
    const rec = screen.getByRole("button", { name: "Record decision" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Belongs to (RC 9)"), { target: { value: "77777777-7777-4777-8777-777777777777" } });
    expect(rec.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for RC 9"), { target: { value: "Bank statement" } });
    fireEvent.click(rec);
    await waitFor(() => expect(m.cDecide).toHaveBeenCalledWith({ documentId: rows[0]!.documentId, caseKind: "receipt-customer", decision: "link", targetId: "77777777-7777-4777-8777-777777777777", reason: "Bank statement" }));
  });
  it("a voided month reads VOIDED in Approvals (with who, when, why), never 'Not yet approved'; the Calculation screen offers no Calculate, Lock, Reopen, Submit, Approve or Pay on it", async () => {
    const { Approvals } = await import("@/components/admin/master/incentive-rules/approvals");
    const period = (month: string, status: string, voided: unknown = null) => ({ id: month, month, status, run: { configVersionNo: 1, asOf: "2029-12-31", salespeople: 1, payablePaise: 0 }, approvedTotalPaise: 0, submissionNo: 0, submittedByName: null, submittedAt: null, approvalsRequired: 1, approvals: [], releaseOn: null, payout: null, voided: voided as never });
    const { unmount } = render(
      <Approvals category="C" ready today="2029-12-31" programs={[{ id: PROGRAM, code: "SALES", name: "Sales" }]} programId={PROGRAM} showApprovals showPayouts periods={[period("2029-05-01", "locked"), period("2029-04-01", "voided", { reason: "Abandoned", byName: "voider", at: "2029-06-01T00:00:00Z", carriedToMonth: "2029-05-01" })]} />,
    );
    const apr = within(screen.getByRole("row", { name: "Month 2029-04" }));
    expect(apr.getByText("Voided")).toBeTruthy();
    expect(apr.getByText(/by voider, .*: Abandoned \(carried into 2029-05\)/)).toBeTruthy();
    expect(apr.getByText("Never paid (voided)")).toBeTruthy();
    expect(apr.queryByText("Not yet approved")).toBeNull();
    expect(within(screen.getByRole("row", { name: "Month 2029-05" })).getByText("Locked")).toBeTruthy();
    unmount();
    // The Calculation screen and its approval card, with every right: nothing can be done to a voided month.
    const { CalcWorkflow } = await import("@/components/admin/master/incentive-rules/calc-workflow");
    render(
      <>
        <CategoryACalculation category="C" ready canRun canLock programs={[{ id: PROGRAM, code: "SALES", name: "Sales" }]} programId={PROGRAM} month="2029-04-01" period={{ status: "voided", rowVersion: 3 }} latestProblems={[]} current={null} runs={[]} adjustmentsIn={[]} items={[]} excludedNotes={[]} />
        <CalcWorkflow category="C" programId={PROGRAM} month="2029-04-01" me="x" rights={{ submit: true, approve: true, pay: true, approvals: true, payouts: true }} approvedTotalPaise={0} period={{ status: "voided", rowVersion: 3, submissionNo: 1, approvalsRequired: 1, submittedByName: "s", submittedById: "s", submittedAt: null, releaseOn: null, payoutReference: null }} approvals={[]} payout={null} />
      </>,
    );
    expect(screen.getByLabelText("Month status").textContent).toBe("Voided");
    expect((screen.getByRole("button", { name: /Calculate/ }) as HTMLButtonElement).disabled).toBe(true);
    for (const name of [/Lock month/, /Reopen/, /Submit for Incentive Approval/, /Approve/, /Reject/, /Record payout/, /Withdraw/]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Incentive Approval and payout" })).getByText(/Voided — it is never submitted, approved or paid/)).toBeTruthy();
  });
  it("My Incentives: a salesperson's own approved Category D, apart from the old engine's historical D", () => {
    render(<MyCategoryA category="D" period="2026-06" ready months={[{ month: "2026-06-01", programCode: "SALES", programName: "Sales team", status: "paid", amountPaise: 1_000_00, releaseOn: "2026-07-01", paidOn: "2026-07-01", payoutReference: "PAY-D", explanation: [] }]} awaiting={[]} historical={[{ lineCode: "D.1", category: "D", amountPaise: 500_00, explanation: "D.1 · LEADS — old engine.", entryType: "accrual" }]} />);
    expect(screen.getByRole("heading", { name: /Category D · Leads & Enquiries/ })).toBeTruthy();
    expect(within(screen.getByLabelText("New Category D")).getByText("₹1,000.00")).toBeTruthy();
    expect(within(screen.getByLabelText("Historical Category D")).getByText(/Not added to the new Category D/)).toBeTruthy();
  });
});
