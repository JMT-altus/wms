// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// The Incentive Tracker ↔ Category A integration on screen: the navigation, a salesperson's own Category A on
// My Incentives (approved / paid only, kept apart from the old engine's historical Category A), and the shared
// Category A screens refusing anyone without an Incentive Calculation permission. Data access is MOCKED.
const m = vi.hoisted(() => ({ monthView: vi.fn(), listApprovalPeriods: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/queries/incentive-calc", () => ({ monthView: m.monthView, listApprovalPeriods: m.listApprovalPeriods, todayIST: () => "2026-11-17", heldItemsOf: async () => [], negativeBalancesAtLock: async () => ({ ready: true, items: [] }), aSafeguardsReady: async () => true, carryBalances: async () => [] }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({ calculateCategoryAMonth: vi.fn(), setCategoryAMonthLocked: vi.fn(), submitCategoryAMonth: vi.fn(), withdrawCategoryAMonth: vi.fn(), decideCategoryAMonth: vi.fn(), recordCategoryAPayout: vi.fn() }));

import { MODULES } from "@/lib/nav-modules";
import { MyCategoryA } from "@/components/incentive/my-category-a";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CategoryAApprovalsScreen } from "@/components/admin/master/incentive-rules/approvals-screen";
import type { IncentiveCalcRights } from "@/lib/auth/incentive-calc";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NONE: IncentiveCalcRights = { view: false, run: false, lock: false, inputs: false, approvals: false, payouts: false, submit: false, approve: false, pay: false, qualify: false, review: false, void: false };

describe("Incentive Tracker navigation", () => {
  const tracker = MODULES.find((x) => x.label === "Incentive Tracker")!;
  it("has one Incentive Management entry, admin-only in the rail, which Category A's screens light (each page checks the permissions again)", () => {
    const manage = tracker.items.find((i) => i.href === "/incentive/manage")!;
    expect([manage.label, manage.adminOnly]).toEqual(["Incentive Management", true]);
    expect(manage.match).toContain("/incentive/category-a");
    expect(tracker.items.find((i) => i.href === "/incentive")!.notMatch).toEqual(expect.arrayContaining(["/incentive/category-a", "/incentive/manage"]));
  });
  it("keeps every existing tracker screen", () => {
    expect(tracker.items.map((i) => i.href)).toEqual(expect.arrayContaining(["/incentive", "/incentive/sales", "/incentive/activity", "/incentive/history", "/incentive/admin", "/incentive/manage", "/outstanding"]));
  });
});

const APPROVED = { month: "2026-04-01", programCode: "SALES", programName: "Sales team", status: "approved" as const, amountPaise: 925_00, releaseOn: "2026-11-17", paidOn: null, payoutReference: null, explanation: ["Sales in 2026-04: ₹1,20,00,000; threshold ₹1,00,00,000 — qualifies."] };
const OLD_A = [{ lineCode: "A.1", category: "A", amountPaise: 2000_00, explanation: "A.1 · SALES SLAB — old engine.", entryType: "accrual" }];

describe("My Incentives → Category A (salesperson)", () => {
  it("an approved month shows the person's own amount and status, apart from the old engine's historical Category A", () => {
    render(<MyCategoryA period="2026-04" ready months={[APPROVED]} awaiting={[]} historical={OLD_A} />);
    const fresh = within(screen.getByLabelText("New Category A"));
    expect(fresh.getByText("₹925.00")).toBeTruthy();
    expect(fresh.getByText("APPROVED")).toBeTruthy();
    expect(fresh.getByText(/threshold/)).toBeTruthy();
    const old = within(screen.getByLabelText("Historical Category A"));
    expect(old.getByText("₹2,000.00")).toBeTruthy();
    expect(old.getByText(/Not added to the new Category A/)).toBeTruthy();
    // Never one figure combining the two.
    expect(screen.queryByText("₹2,925.00")).toBeNull();
  });
  it("a month still being calculated or approved is named, never valued", () => {
    render(<MyCategoryA period="2026-05" ready months={[APPROVED]} awaiting={["2026-05-01"]} historical={[]} />);
    const fresh = within(screen.getByLabelText("New Category A"));
    expect(fresh.getByText(/awaiting approval — your amount appears here once it is approved/)).toBeTruthy();
    expect(fresh.queryByText(/₹/)).toBeNull();
  });
  it("a paid month shows its date and reference; the history lists each approved or paid month", () => {
    render(<MyCategoryA period="2026-04" ready months={[{ ...APPROVED, status: "paid", paidOn: "2026-11-17", payoutReference: "NEFT-APR" }]} awaiting={[]} historical={[]} />);
    expect(within(screen.getByLabelText("New Category A")).getByText(/ref NEFT-APR/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Category A history" })).getByText("PAID")).toBeTruthy();
  });
});

describe("the shared Category A screens refuse anyone without an Incentive Calculation permission", () => {
  it("Calculation: no access, and nothing is read", async () => {
    render(await CategoryACalculationScreen({ me: { id: "x" } as never, rights: NONE, searchParams: {}, basePath: "/incentive/category-a", variant: "tracker", head: <h1>Category A</h1> }));
    expect(screen.getByRole("note").textContent).toMatch(/No access/);
    expect(m.monthView).not.toHaveBeenCalled();
  });
  it("Approvals: no access without the approvals or payouts view", async () => {
    render(await CategoryAApprovalsScreen({ rights: { ...NONE, view: true, run: true }, searchParams: {}, basePath: "/incentive/category-a", variant: "tracker", head: <h1>Approvals</h1> }));
    expect(screen.getByRole("note").textContent).toMatch(/No access/);
    expect(m.listApprovalPeriods).not.toHaveBeenCalled();
  });
  it("with the view right, the tracker variant links inputs and rules back to Admin & Master Setup", async () => {
    m.monthView.mockResolvedValue({ ready: true, programs: [], period: null, current: null, runs: [], adjustmentsIn: [], adjustmentsOut: [], latestProblems: [], approvals: [], payout: null, submittedByName: null, approvedTotalPaise: null });
    render(await CategoryACalculationScreen({ me: { id: "x" } as never, rights: { ...NONE, view: true }, searchParams: { month: "2026-04" }, basePath: "/incentive/category-a", variant: "tracker", head: <h1>Category A</h1> }));
    expect(m.monthView).toHaveBeenCalledWith(null, "2026-04-01");
    const nav = within(screen.getByRole("navigation", { name: "Incentive calculation sections" }));
    expect(nav.getByRole("link", { name: "Calculation" }).getAttribute("href")).toBe("/incentive/category-a");
    expect(nav.getByRole("link", { name: "Incentive Approvals" }).getAttribute("href")).toBe("/incentive/category-a/approvals");
    expect(nav.getByRole("link", { name: /Inputs/ }).getAttribute("href")).toBe("/master-setup/incentive-rules/calculation/salespeople");
    expect(screen.queryByRole("button", { name: /Calculate/ })).toBeNull(); // no run right, no Calculate
  });
});
