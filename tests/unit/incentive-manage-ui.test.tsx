// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Incentive Tracker → Incentive Management, and the Incentive Rules home's A–G overview, rendered with INVENTED data
// only. Nothing here reads a database or calls a server action.
const n = vi.hoisted(() => ({ pathname: "/incentive" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => n.pathname }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/actions", () => ({ createIncentiveDraft: vi.fn(), createIncentiveProgram: vi.fn() }));

import type { MonthRow } from "@/lib/queries/incentive-manage";
import { nextAction, stagesOf, type MonthFacts } from "@/components/incentive/manage/stages";
import { ManageOverview, type OverviewCategory } from "@/components/incentive/manage/overview";
import { ManageCalculate } from "@/components/incentive/manage/calculate";
import { ManageQueue } from "@/components/incentive/manage/queue";
import { ManagePayments } from "@/components/incentive/manage/payments";
import { ManageHistory } from "@/components/incentive/manage/history";
import { CategoryBar } from "@/components/incentive/manage/category-bar";
import { programsParam } from "@/components/incentive/manage/params";
import { IncentiveRulesHome } from "@/components/admin/master/incentive-rules/home";
import { MainNav } from "@/components/layout/main-nav";

afterEach(() => cleanup());

const P = "22222222-2222-4222-8222-222222222222";
const PROGRAMS = [{ id: P, code: "SALES", name: "Sales team" }];
const TODAY = "2026-11-21";

function row(over: Partial<MonthRow> & Pick<MonthRow, "category" | "month" | "status">): MonthRow {
  return {
    key: `${P}|${over.category}|${over.month}`,
    programId: P,
    programCode: "SALES",
    run: { configVersionNo: 2, asOf: "2026-11-20", salespeople: 2, payablePaise: 3_000_00 },
    approvedTotalPaise: 3_000_00,
    submissionNo: 0,
    submittedByName: null,
    submittedAt: null,
    approvalsRequired: null,
    approvalsDone: null,
    decisions: [],
    releaseOn: null,
    payout: null,
    voided: null,
    employees: [
      { key: "id:e1", name: "Sample Rep One", payablePaise: 1_000_00 },
      { key: "id:e2", name: "Sample Rep Two", payablePaise: 2_000_00 },
    ],
    ...over,
  };
}
const facts = (over: Partial<MonthFacts>): MonthFacts => ({ ready: true, rules: { versionNo: 1 }, latest: null, period: null, today: TODAY, ...over });

describe("progress stages: a stage is done only when a record shows it", () => {
  it("a month never calculated: only the published rules count", () => {
    expect(stagesOf(facts({}))).toEqual({ rules: "done", source: "todo", calculated: "todo", reviewed: "todo", submitted: "todo", approved: "todo", released: "todo", paid: "todo" });
    expect(stagesOf(facts({ rules: null })).rules).toBe("todo");
    expect(nextAction(facts({ rules: null })).label).toMatch(/Publish rules for the month first/);
  });
  it("a blocked latest calculation shows as blocked, never as ready", () => {
    const st = stagesOf(facts({ latest: { status: "blocked" } }));
    expect([st.source, st.calculated]).toEqual(["blocked", "todo"]);
    expect(nextAction(facts({ latest: { status: "blocked" } })).tone).toBe("bad");
  });
  it("locked = reviewed; submitted; approved but not yet released; paid", () => {
    const period = (status: string, releaseOn: string | null = null) => ({ status, hasRun: true, releaseOn });
    expect(stagesOf(facts({ latest: { status: "computed" }, period: period("locked") }))).toMatchObject({ calculated: "done", reviewed: "done", submitted: "todo" });
    expect(nextAction(facts({ period: period("locked") })).label).toBe("Submit for Incentive Approval");
    expect(nextAction(facts({ period: period("submitted") }), { done: 1, required: 2 }).label).toBe("Incentive Approval — step 2 of 2");
    const waiting = stagesOf(facts({ period: period("approved", "2026-12-05") }));
    expect([waiting.approved, waiting.released, waiting.paid]).toEqual(["done", "todo", "todo"]);
    expect(stagesOf(facts({ period: period("approved", "2026-11-21") })).released).toBe("done");
    expect(Object.values(stagesOf(facts({ period: period("paid", "2026-11-01") })))).toEqual(Array(8).fill("done"));
  });
  it("a voided month: the stages after calculation don't apply, and nothing is pending", () => {
    const st = stagesOf(facts({ period: { status: "voided", hasRun: true, releaseOn: null } }));
    expect([st.calculated, st.reviewed, st.paid]).toEqual(["done", "na", "na"]);
    expect(nextAction(facts({ period: { status: "voided", hasRun: true, releaseOn: null } })).tone).toBe("none");
  });
});

const CATS = (["A", "B", "C", "D", "E", "F", "G"] as const).map<OverviewCategory>((c) => ({ category: c, ready: c !== "G", rules: c === "E" ? null : { versionNo: 3, effectiveFrom: "2026-06-01" }, latest: null, row: null }));

describe("Overview", () => {
  it("shows every category's progress from its records, links each to its own screens, and counts held reviews", () => {
    const cats = CATS.map((c) =>
      c.category === "A"
        ? { ...c, latest: { status: "computed" as const, computedAt: "2026-11-20T05:00:00.000Z", asOf: "2026-11-20", problems: [], heldForReview: 0 }, row: row({ category: "A", month: "2026-11-01", status: "submitted", submittedAt: "2026-11-20T06:00:00.000Z", submittedByName: "Sample Submitter", approvalsRequired: 2, approvalsDone: 1 }) }
        : c.category === "C"
          ? { ...c, latest: { status: "blocked" as const, computedAt: "2026-11-19T05:00:00.000Z", asOf: "2026-11-19", problems: ["The month's published rules are incomplete."], heldForReview: 4 } }
          : c,
    );
    render(<ManageOverview programs={PROGRAMS} programId={P} month="2026-11-01" today={TODAY} categories={cats} f={{ unchecked: 2, onHold: 1, invalidations: 0, writeOffs: 0 }} showPayouts={false} />);
    expect(screen.getByRole("navigation", { name: "Incentive Management sections" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Rules Approval and Incentive Approval" }).textContent).toMatch(/approves nobody's incentive and pays nothing/);
    const a = within(screen.getByRole("row", { name: "Category A" }));
    expect(a.getByText("Submitted: done")).toBeTruthy();
    expect(a.getByText("Approved: not yet")).toBeTruthy();
    expect(a.getByText("Incentive Approval — step 2 of 2")).toBeTruthy();
    expect(a.getByRole("link", { name: "Open Category A calculation" }).getAttribute("href")).toBe(`/incentive/category-a?program=${P}&month=2026-11`);
    const c = within(screen.getByRole("row", { name: "Category C" }));
    expect(c.getByText("Source Data Ready: blocked")).toBeTruthy();
    expect(c.getByText("Calculated: not yet")).toBeTruthy();
    expect(c.getByRole("link", { name: "Category C Incentive Approvals" }).getAttribute("href")).toBe(`/incentive/category/c/approvals?program=${P}`);
    expect(within(screen.getByRole("row", { name: "Category E" })).getByText("Rules Published: not yet")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: "Category G" })).getByText(/before it can be calculated/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Source data and validation" }).textContent).toMatch(/published rules are incomplete/);
    const reviews = within(screen.getByRole("region", { name: "Reviews waiting" }));
    expect(reviews.getByText(/4 records held for review/)).toBeTruthy();
    expect(reviews.getByText(/2 testimonials not yet checked, 1 on hold/)).toBeTruthy();
    // Nothing here acts: the only button is the filters' Apply.
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Apply"]);
  });
});

describe("Calculate Incentives", () => {
  it("lists Categories A–G for the month and opens each one's own Calculation screen; the filters narrow it", () => {
    const { unmount } = render(<ManageCalculate programs={PROGRAMS} programId={P} month="2026-11-01" today={TODAY} category={null} status={null} categories={CATS} />);
    const table = within(screen.getByRole("table", { name: "Categories for the month" }));
    expect(table.getAllByRole("row").length).toBe(8); // header + A–G
    expect(table.getByRole("link", { name: "Open Category D calculation" }).getAttribute("href")).toBe(`/incentive/category/d?program=${P}&month=2026-11`);
    expect(table.getByRole("link", { name: "Open Category B calculation" }).getAttribute("href")).toBe(`/incentive/category-b?program=${P}&month=2026-11`);
    expect(within(table.getByRole("row", { name: "Category E" })).getByText("None published")).toBeTruthy();
    unmount();
    render(<ManageCalculate programs={PROGRAMS} programId={P} month="2026-11-01" today={TODAY} category="F" status={null} categories={CATS} />);
    expect(within(screen.getByRole("table", { name: "Categories for the month" })).getAllByRole("row").length).toBe(2);
  });
});

const ROWS: MonthRow[] = [
  row({ category: "A", month: "2026-11-01", status: "submitted", submissionNo: 2, submittedAt: "2026-11-20T06:00:00.000Z", submittedByName: "Sample Submitter", approvalsRequired: 2, approvalsDone: 0, decisions: [{ submissionNo: 1, stepNo: 1, decision: "reject", reason: "Refund missing", actorName: "Sample Approver", at: "2026-11-18T06:00:00.000Z" }] }),
  row({ category: "B", month: "2026-11-01", status: "locked" }),
  row({ category: "C", month: "2026-10-01", status: "approved", releaseOn: "2026-11-15", approvalsRequired: 1 }),
  row({ category: "D", month: "2026-10-01", status: "approved", releaseOn: "2026-12-15", approvalsRequired: 1 }),
  row({ category: "A", month: "2026-09-01", status: "paid", releaseOn: "2026-10-15", payout: { reference: "NEFT-001", paidOn: "2026-10-16", totalPaise: 3_000_00, recordedByName: "Sample Payer", lines: [{ employeeName: "Sample Rep One", payablePaise: 1_000_00, adjustmentsPaise: 0, amountPaise: 1_000_00 }, { employeeName: "Sample Rep Two", payablePaise: 2_000_00, adjustmentsPaise: 0, amountPaise: 2_000_00 }] } }),
  row({ category: "C", month: "2026-08-01", status: "voided", voided: { reason: "Imported twice", byName: "Sample Admin", at: "2026-09-01T00:00:00.000Z", carriedToMonth: "2026-09-01" } }),
];
const EMPLOYEES = [
  { key: "id:e1", name: "Sample Rep One" },
  { key: "id:e2", name: "Sample Rep Two" },
];
const REVIEWS = { month: "2026-11-01", programId: P, heldB: 0, heldC: null, f: null };

describe("Review & Incentive Approvals", () => {
  it("by default lists the months needing review or Incentive Approval, each opening its Calculation screen to act", () => {
    render(<ManageQueue programs={PROGRAMS} program="all" rows={ROWS} notReady={[]} today={TODAY} filters={{ category: null, status: "pending", month: null, employee: null }} employees={EMPLOYEES} showApprovals reviews={REVIEWS} />);
    const table = within(screen.getByRole("table", { name: "Incentive Approval queue" }));
    expect(table.getAllByRole("row").length).toBe(3); // header + A (submitted) + B (locked)
    const a = within(table.getByRole("row", { name: "Category A 2026-11" }));
    expect(a.getByText("Awaiting Incentive Approval")).toBeTruthy();
    expect(a.getByText("Incentive Approval — step 1 of 2")).toBeTruthy();
    expect(a.getByText(/Rejected by Sample Approver .*Refund missing/)).toBeTruthy();
    expect(a.getByRole("link", { name: "Open Category A, Nov 2026" }).getAttribute("href")).toBe(`/incentive/category-a?program=${P}&month=2026-11`);
    expect(within(table.getByRole("row", { name: "Category B 2026-11" })).getByText("Submit for Incentive Approval")).toBeTruthy();
    // Nothing is approved, rejected or paid from here.
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Apply"]);
  });
  it("without the approvals view, no decision (or rejection reason) is shown", () => {
    const hidden = ROWS.map((r) => ({ ...r, decisions: [], approvalsDone: null }));
    render(<ManageQueue programs={PROGRAMS} program="all" rows={hidden} notReady={[]} today={TODAY} filters={{ category: null, status: "pending", month: null, employee: null }} employees={EMPLOYEES} showApprovals={false} reviews={REVIEWS} />);
    expect(screen.queryByText(/Refund missing/)).toBeNull();
    expect(within(screen.getByRole("table", { name: "Incentive Approval queue" })).getByText("Incentive Approval")).toBeTruthy(); // no step number without the decisions
    expect(screen.queryByRole("option", { name: "Rejected — back to Locked" })).toBeNull();
  });
  it("a salesperson filter shows that salesperson's payable in each month", () => {
    render(<ManageQueue programs={PROGRAMS} program="all" rows={ROWS} notReady={[]} today={TODAY} filters={{ category: "A", status: "all", month: null, employee: "id:e2" }} employees={EMPLOYEES} showApprovals reviews={REVIEWS} />);
    const table = within(screen.getByRole("table", { name: "Incentive Approval queue" }));
    expect(table.getAllByRole("row").length).toBe(3); // header + A Nov + A Sep
    expect(within(table.getByRole("row", { name: "Category A 2026-11" })).getByText("₹2,000.00")).toBeTruthy();
  });
});

describe("Release & Payments", () => {
  it("separates approved-not-released, released-not-paid and paid; payout records need the payouts view", () => {
    const { unmount } = render(<ManagePayments programs={PROGRAMS} program="all" rows={ROWS.filter((r) => r.status === "approved" || r.status === "paid")} notReady={[]} today={TODAY} filters={{ category: null, status: "all", month: null, employee: null }} employees={EMPLOYEES} showPayouts />);
    const table = within(screen.getByRole("table", { name: "Release and payment by month" }));
    expect(within(table.getByRole("row", { name: "Category C 2026-10" })).getByText(/Released 15 Nov 2026 — eligible for payout/)).toBeTruthy();
    expect(within(table.getByRole("row", { name: "Category C 2026-10" })).getByRole("link", { name: /to record its payout/ }).getAttribute("href")).toBe(`/incentive/category/c?program=${P}&month=2026-10`);
    expect(within(table.getByRole("row", { name: "Category D 2026-10" })).getByText(/Releases on 15 Dec 2026/)).toBeTruthy();
    expect(within(table.getByRole("row", { name: "Category A 2026-09" })).getByText("NEFT-001")).toBeTruthy();
    unmount();
    render(<ManagePayments programs={PROGRAMS} program="all" rows={ROWS.filter((r) => r.status === "approved" || r.status === "paid").map((r) => ({ ...r, payout: null }))} notReady={[]} today={TODAY} filters={{ category: null, status: "paid", month: null, employee: null }} employees={EMPLOYEES} showPayouts={false} />);
    expect(screen.queryByText("NEFT-001")).toBeNull();
    expect(within(screen.getByRole("table", { name: "Release and payment by month" })).getAllByRole("row").length).toBe(2);
  });
});

describe("History & Reconciliation", () => {
  it("keeps every month — voided and rejected included — with adjustments and carried-forward balances", () => {
    render(
      <ManageHistory
        programs={PROGRAMS}
        program="all"
        rows={ROWS}
        notReady={[]}
        filters={{ category: null, status: "all", month: null, employee: null }}
        employees={EMPLOYEES}
        runCounts={{ [`${P}|A|2026-11-01`]: { runs: 3, blocked: 1 } }}
        adjustments={[{ id: "adj1", programCode: "SALES", category: "C", fromMonth: "2026-09-01", toMonth: "2026-10-01", employeeName: "Sample Rep One", kind: "recalc-difference", amountPaise: -500_00, monthsLeft: null, note: "Credit note after payout", createdAt: "2026-10-05T00:00:00.000Z" }]}
        carry={[{ programCode: "SALES", programId: P, category: "C", balances: [{ lotId: "lot1", employeeId: "e1", employeeName: "Sample Rep One", month: "2026-07-01", heldPaise: 400_00, remainingPaise: 0, entries: [{ kind: "released", month: "2026-09-01", amountPaise: -400_00, byName: "Sample Payer", reason: null, at: "2026-10-16T00:00:00.000Z" }] }] }]}
        showApprovals
        showPayouts
      />,
    );
    expect(within(screen.getByRole("table", { name: "Months and their history" })).getAllByRole("row").length).toBe(ROWS.length + 1);
    expect(within(screen.getByRole("row", { name: "Category A 2026-11" })).getByText("3 calculations")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Rejected submissions" })).getByText("Refund missing")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Voided months" })).getByText("Imported twice")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Adjustments between months" })).getByText("Recalculation difference")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Carried-forward balances" })).getByText(/Released in Sept? 2026/)).toBeTruthy();
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Apply"]);
  });
});

describe("the category screens inside Incentive Management", () => {
  it("a breadcrumb back, and Categories A–G that keep the programme and month", () => {
    render(<CategoryBar category="C" view="calculation" program={P} month="2026-11" />);
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Calculate Incentives" }).getAttribute("href")).toBe(`/incentive/manage/calculate?program=${P}&month=2026-11`);
    const cats = within(screen.getByRole("navigation", { name: "Categories" }));
    expect(cats.getAllByRole("link").length).toBe(7);
    expect(cats.getByRole("link", { name: /^A · / }).getAttribute("href")).toBe(`/incentive/category-a?program=${P}&month=2026-11`);
    expect(cats.getByRole("link", { name: /^C · / }).getAttribute("aria-current")).toBe("page");
  });
  it("the Incentive Management entry stays lit on every category route (and My Incentives doesn't)", () => {
    for (const path of ["/incentive/manage/overview", "/incentive/category-a/approvals", "/incentive/category-b", "/incentive/category/f"]) {
      n.pathname = path;
      const { unmount } = render(<MainNav activeTasks={0} archivedTasks={0} isAdmin />);
      expect(screen.getByRole("link", { name: /Incentive Management/ }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("link", { name: /My Incentives/ }).getAttribute("aria-current")).toBeNull();
      unmount();
    }
    n.pathname = "/incentive";
  });
  it("an unknown programme in the address falls back to every programme", () => {
    expect(programsParam("nope", PROGRAMS)).toEqual({ program: "all", selected: PROGRAMS });
    expect(programsParam(P, PROGRAMS)).toEqual({ program: P, selected: PROGRAMS });
  });
});

describe("Incentive Rules home: Categories A–G", () => {
  it("shows the workflow, that publishing isn't Incentive Approval, and each category's rules state and completeness", () => {
    const v = (id: string, categoryCode: string, versionNo: number, status: "draft" | "submitted" | "approved" | "published", effectiveFrom: string | null = null) => ({ id, categoryCode, versionNo, status, effectiveFrom, effectiveTo: null, createdByName: "Sample Editor", approvedByName: null, publishedByName: null, updatedAt: "2026-11-16T00:00:00.000Z" });
    const programs = [{ id: P, code: "SALES", name: "Sales team", description: null, isActive: true, versions: [v("a2", "A", 2, "submitted"), v("a1", "A", 1, "published", "2026-06-01"), v("b1", "B", 1, "draft"), v("c1", "C", 1, "published", "2026-12-01")] }];
    render(<IncentiveRulesHome programs={programs} ready canEdit currentMonth="2026-11-01" checks={{ a2: { problems: 0, missing: 0, messages: [] }, b1: { problems: 1, missing: 2, messages: ["Monthly sales threshold isn't set."] } }} />);
    expect(screen.getByRole("region", { name: "Rules workflow" }).textContent).toMatch(/Rules Approval is not Incentive Approval/);
    const table = within(screen.getByRole("table", { name: "SALES categories" }));
    const a = within(table.getByRole("row", { name: "Category A" }));
    expect(a.getByText("Version 1")).toBeTruthy();
    expect(a.getByText("Awaiting Rules Approval", { selector: "td" })).toBeTruthy();
    expect(a.getByText("Complete")).toBeTruthy();
    const b = within(table.getByRole("row", { name: "Category B" }));
    expect(b.getByText("Not yet submitted")).toBeTruthy();
    expect(b.getByText("2 missing, 1 to correct")).toBeTruthy();
    expect(b.getByText("Monthly sales threshold isn't set.")).toBeTruthy();
    const c = within(table.getByRole("row", { name: "Category C" }));
    expect(c.getByText("Yes — v1, not yet in force")).toBeTruthy();
    expect(c.getByText("from 2026-12")).toBeTruthy();
    expect(within(table.getByRole("row", { name: "Category G" })).getByText("Not configured")).toBeTruthy();
  });
});
