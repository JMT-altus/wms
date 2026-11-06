// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// Salary Slip: the signed-in employee's OWN stored salary runs, each linking to the existing statement and PDF
// payslip. Session and loader are mocked; what's checked: the runs are read for the session's employee only (never an
// id from the URL), the figures are the runs' stored ones, the empty states, and the menu placement.
const h = vi.hoisted(() => ({
  me: { id: "emp-a", name: "Alpha One", email: "a@example.test", isAdmin: false, isActive: true, timezone: "Asia/Kolkata" } as Record<string, unknown>,
  runs: [] as unknown[],
  calls: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/salary-slip" }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/lib/auth/current", () => ({ requireUser: async () => h.me }));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), localDateString: () => "2026-11-06" }));
vi.mock("@/lib/queries/salary", () => ({
  listRunsForEmployee: async (id: string) => {
    h.calls.push(id);
    return h.runs;
  },
}));

import type { SalaryRunRow } from "@/lib/queries/salary";
import { MODULES } from "@/lib/nav-modules";

const run = (over: Partial<SalaryRunRow> = {}): SalaryRunRow => ({
  id: "11111111-1111-4111-8111-111111111111", employeeId: "emp-a", employeeName: "Alpha One", designationName: "Executive", payingEntityName: "Legacy Creators", fy: "FY 26-27",
  month: "2026-10", annualCtc: 372_000, daysInMonth: 31, payableDays: 28.5, lateMarks: 0, lateDeductionDays: 0, gross: 28_000, pt: 200, tds: 500, advances: 0, pendingBalanceIn: 0,
  netPayable: 27_300, disbursed: false, disbursedAmount: null, source: "generated", createdAt: new Date("2026-11-02T10:00:00Z"), ...over,
});

const page = async (sp: Record<string, string> = {}) => {
  const { default: Page } = await import("@/app/(app)/salary-slip/page");
  return render(await Page({ searchParams: Promise.resolve(sp) }));
};

beforeEach(() => {
  h.runs = [run(), run({ id: "22222222-2222-4222-8222-222222222222", month: "2026-09", netPayable: 27_800, tds: 0, disbursed: true, disbursedAmount: 27_800 })];
  h.calls = [];
});
afterEach(cleanup);

describe("Salary Slip page", () => {
  it("reads only the signed-in employee's runs — a URL parameter can't name someone else", async () => {
    await page({ employee: "emp-b", employeeId: "emp-b", month: "2026-10" });
    expect(h.calls).toEqual(["emp-a"]);
  });

  it("shows the newest slip by default with the run's stored figures, and the existing statement and PDF links", async () => {
    await page();
    const card = screen.getByTestId("slip-month-card");
    expect(card.textContent).toMatch(/Salary slip · October 2026/);
    expect(screen.getByTestId("slip-net").textContent).toBe("₹27,300.00");
    expect(card.textContent).toMatch(/− ₹700\.00/); // PT 200 + TDS 500, as stored
    expect(within(card).getByRole("link", { name: /View slip/ }).getAttribute("href")).toBe("/my-salary/statement/11111111-1111-4111-8111-111111111111");
    expect(within(card).getByRole("link", { name: /Download PDF/ }).getAttribute("href")).toBe("/salary/payslip/11111111-1111-4111-8111-111111111111");
    const table = screen.getByRole("table", { name: "Salary slips" });
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + two slips
    expect(within(table).getByRole("link", { name: /Download September 2026 salary slip as PDF/ }).getAttribute("href")).toBe("/salary/payslip/22222222-2222-4222-8222-222222222222");
  });

  it("a month without a slip says so; with no slips at all, the list shows its empty state — nothing is invented", async () => {
    await page({ month: "2026-11" });
    expect(screen.getByTestId("slip-month-empty").textContent).toBe("No salary slip for November 2026");
    cleanup();
    h.runs = [];
    await page();
    expect(screen.getByTestId("slip-empty").textContent).toMatch(/No salary slips yet/);
    expect(screen.queryByRole("table", { name: "Salary slips" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Download PDF/ })).toBeNull();
  });
});

describe("Employees menu", () => {
  it("lists Salary Slip directly below My Salary, and the Salary item does not light up on /salary-slip", () => {
    const items = MODULES.find((m) => m.id === "employees")!.items;
    const hrefs = items.map((i) => i.href);
    expect(hrefs.slice(hrefs.indexOf("/dcc/dashboard"))).toEqual(["/dcc/dashboard", "/my-salary", "/salary-slip", "/salary", "/reimbursements"]);
    expect(items.find((i) => i.href === "/salary")!.notMatch).toContain("/salary-slip");
    expect(MODULES.find((m) => m.id === "employees")!.routes).toContain("/salary-slip");
  });
});
