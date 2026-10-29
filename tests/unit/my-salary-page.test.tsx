// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The My Salary page composed from a loader result, with the session, the loader
// and the navigation mocked. What's checked: the page shows the signed-in
// employee's OWN month (the loader is called with the session's employee and the
// URL's month only), the figures reconcile, the counts come from the summary,
// history shows only what the loader returned, Recalculate is admins-only, the
// main column is full width, and the statement page refuses another
// employee's run with a 404.
const h = vi.hoisted(() => ({
  me: { id: "emp-a", name: "Alpha One", email: "a@example.test", isAdmin: false, isActive: true, timezone: "Asia/Kolkata" } as Record<string, unknown>,
  today: "2026-10-29",
  data: null as unknown,
  loads: [] as unknown[],
  runs: new Map<string, unknown>(),
  recalc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/layout/footer", () => ({ DashboardFooter: () => null }));
vi.mock("@/lib/auth/current", () => ({ requireUser: async () => h.me, getCurrentEmployee: async () => h.me }));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), localDateString: () => h.today }));
vi.mock("@/lib/salary/my-salary", () => ({
  loadMySalary: async (...a: unknown[]) => {
    h.loads.push(a);
    return h.data;
  },
}));
vi.mock("@/lib/queries/salary", () => ({ getRun: async (id: string) => h.runs.get(id) ?? null }));
vi.mock("@/app/(app)/salary/actions", () => ({ recalculateEmployeeRun: (...a: unknown[]) => h.recalc(...a) }));

import type { DayRow, MonthSummary } from "@/lib/queries/attendance-status";
import type { SalaryRunRow } from "@/lib/queries/salary";
import type { MySalaryData } from "@/lib/salary/my-salary";

const run = (over: Partial<SalaryRunRow> = {}): SalaryRunRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  employeeId: "emp-a",
  employeeName: "Alpha One",
  designationName: "Executive",
  payingEntityName: "Legacy Creators",
  fy: "FY 26-27",
  month: "2026-10",
  annualCtc: 372_000,
  daysInMonth: 31,
  payableDays: 28.5,
  lateMarks: 3,
  lateDeductionDays: 0.5,
  gross: 28_000,
  pt: 200,
  tds: 0,
  advances: 0,
  pendingBalanceIn: 0,
  netPayable: 27_800,
  disbursed: false,
  disbursedAmount: null,
  source: "generated",
  createdAt: new Date("2026-10-28T10:00:00Z"),
  ...over,
});
const day = (logDate: string, over: Partial<DayRow> = {}): DayRow => ({
  logDate, weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(), inAt: "10:00", outAt: "19:00", isWeeklyOff: false, code: "P", dayValue: 1, late: false, leftEarly: false, lateWaived: false, workedMinutes: 540, ...over,
});
const summary: MonthSummary = {
  payableDays: 28.5, present: 17, absent: 3, halfDay: 1, weeklyOff: 4, incomplete: 0, late: 3, lateRaw: 3, leftEarly: 0, lateWaived: 0,
  holiday: 1, holidayPresent: 0, holidayHalfDay: 0, paidLeave: 0, unpaidLeave: 0, compOff: 0,
};
const data = (over: Partial<MySalaryData> = {}): MySalaryData => ({
  month: "2026-10",
  year: 2026,
  monthNumber: 10,
  run: run(),
  profile: { designationName: "Executive", payingEntityName: "Legacy Creators", hasProfile: true },
  attendance: { days: [day("2026-10-01"), day("2026-10-05", { code: "A", dayValue: 0, inAt: null, outAt: null, workedMinutes: 0 })], summary },
  stale: { status: "current" },
  history: [run(), run({ id: "22222222-2222-4222-8222-222222222222", month: "2026-09", netPayable: 200, gross: 400, disbursed: true, disbursedAmount: 200 })],
  bounds: { earliest: "2026-01", latest: "2026-10" },
  ...over,
});

const page = async (sp: Record<string, string> = {}) => {
  const { default: Page } = await import("@/app/(app)/my-salary/page");
  return render(await Page({ searchParams: Promise.resolve(sp) }));
};

beforeEach(() => {
  h.me = { id: "emp-a", name: "Alpha One", email: "a@example.test", isAdmin: false, isActive: true, timezone: "Asia/Kolkata" };
  h.data = data();
  h.loads = [];
  h.runs = new Map();
  h.recalc.mockReset();
});
afterEach(cleanup);

describe("My Salary page", () => {
  it("loads the SESSION's employee for the URL's month — never an employee from the request — and shows that month's net pay", async () => {
    await page({ month: "2026-09", employeeId: "emp-b" });
    expect(h.loads).toEqual([[h.me, "2026-09", "2026-10-29"]]);
    expect(screen.getByTestId("net-pay").textContent).toBe("₹27,800.00");
    expect(screen.getByTestId("final-payment").textContent).toBe("₹27,800.00"); // the breakdown reconciles to the headline
    expect(screen.getAllByText("Payment pending")).toHaveLength(2); // the headline pill and this month's history row
    expect(screen.getByText(/Executive · Legacy Creators/)).toBeTruthy();
  });

  it("the Net Pay card follows the reference: wallet label with the month, picker top-right, red statement link, amount, designation, neutral status pill — all from the run", async () => {
    await page();
    const card = screen.getByTestId("net-pay-card");
    expect(card.className).toMatch(/\bw-full\b/);
    expect(card.className).toMatch(/rounded-\[20px\]/);
    expect(within(card).getByText(/Net pay · October 2026/i)).toBeTruthy();
    expect(within(card).getByLabelText("Salary month")).toBeTruthy();
    const link = within(card).getByRole("link", { name: /Salary Statement/ });
    expect(link.getAttribute("href")).toBe(`/my-salary/statement/${run().id}`);
    expect(link.getAttribute("style")).toMatch(/color: rgb\(194, 64, 58\)/); // the module's red, not the blue nav colour
    expect(within(card).getByText("Executive · Legacy Creators")).toBeTruthy();
    const pill = within(card).getByText("Payment pending").closest("span")!;
    expect(pill.getAttribute("data-variant")).toBe("neutral");
    expect(pill.getAttribute("data-payment-status")).toBe("pending");
  });

  it("the breakdown card is collapsed to Base Salary / Deductions (red total) / Final Payment, and the + button reveals the itemised deductions and the figures behind the gross", async () => {
    h.data = data({ run: run({ tds: 500, netPayable: 27_300 }) });
    await page();
    const card = screen.getByTestId("breakdown-card");
    expect(card.className).toMatch(/\bw-full\b/);
    expect(within(card).getByTestId("base-salary").textContent).toBe("₹28,000.00");
    expect(within(card).getByTestId("deductions-total").textContent).toBe("− ₹700.00"); // PT 200 + TDS 500, one line, in red
    expect(within(card).getByTestId("final-payment").textContent).toBe("₹27,300.00");
    expect(within(card).queryByText("Professional tax")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Show calculation details" }));
    expect(within(card).getByText("Professional tax").nextElementSibling?.textContent).toBe("− ₹200.00");
    expect(within(card).getByText("TDS").nextElementSibling?.textContent).toBe("− ₹500.00");
    expect(within(card).getByText("Per-day rate")).toBeTruthy();
    expect(within(card).getByText("28.5 of 31")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Hide calculation details" }));
    expect(within(card).queryByText("Professional tax")).toBeNull();
  });

  it("a missing, malformed or future month falls back to the current month", async () => {
    await page({});
    await page({ month: "nonsense" });
    await page({ month: "2027-03" });
    expect(h.loads.map((a) => (a as unknown[])[1])).toEqual(["2026-10", "2026-10", "2026-10"]);
  });

  it("attendance counts come from the grader's summary; the calendar and history render; history lists only the loader's runs", async () => {
    await page();
    expect(screen.getByTestId("days-worked").textContent?.replace(/\s+/g, " ")).toBe("17 / 21");
    expect(screen.getByTestId("half-days").textContent).toBe("1");
    expect(screen.getByTestId("absent").textContent).toBe("3");
    expect(screen.getByLabelText("Monthly attendance calendar")).toBeTruthy();
    const hist = screen.getByRole("list", { name: "Salary history" });
    expect(within(hist).getAllByRole("link")).toHaveLength(2);
    expect(within(hist).getByText("September 2026").closest("a")?.getAttribute("href")).toBe("/my-salary?month=2026-09");
    expect(within(hist).getAllByText("Paid")).toHaveLength(1);
  });

  it("Recalculate is offered to administrators only; the employee sees the saved figure and, when attendance changed, a notice", async () => {
    h.data = data({ stale: { status: "stale", savedPayableDays: 28.5, nowPayableDays: 29.5, savedLateMarks: 3, nowLateMarks: 3 } });
    await page();
    expect(screen.queryByRole("button", { name: /Recalculate my salary/ })).toBeNull();
    expect(screen.getByText(/changed after this salary was calculated/).textContent).toMatch(/28\.5 → 29\.5/);
    cleanup();
    h.me = { ...h.me, isAdmin: true };
    await page();
    const btn = screen.getByRole("button", { name: /Recalculate my salary/ });
    h.recalc.mockResolvedValue({ ok: true, netPayable: 28_800 });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(h.recalc).toHaveBeenCalledWith({ month: "2026-10", employeeId: "emp-a" }));
  });

  it("with no run: says so (and why, without a CTC profile), shows no breakdown, keeps the live attendance; history empty state", async () => {
    h.data = data({ run: null, history: [], profile: { designationName: null, payingEntityName: null, hasProfile: false } });
    await page();
    expect(screen.getByText(/No salary run for October 2026 yet/)).toBeTruthy();
    expect(screen.getByText(/No salary profile \(CTC\) is set/)).toBeTruthy();
    expect(screen.queryByTestId("final-payment")).toBeNull();
    expect(screen.getByTestId("days-worked")).toBeTruthy();
    expect(screen.getByText(/No salary has been generated for you yet/)).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0); // the daily report prices nothing
  });

  it("when attendance can't be read the page still renders the pay, and says the attendance couldn't be loaded", async () => {
    h.data = data({ attendance: null, stale: null });
    await page();
    expect(screen.getByTestId("net-pay").textContent).toBe("₹27,800.00");
    expect(screen.getAllByText(/Couldn.t load this month/).length).toBeGreaterThan(0);
  });

  it("uses the full content width: no centred max-width container on the main column; the title sits in a white card with the subtitle", async () => {
    await page();
    const main = screen.getByTestId("my-salary-main");
    expect(main.className).toMatch(/\bw-full\b/);
    expect(main.className).not.toMatch(/max-w-/);
    expect(main.className).not.toMatch(/\bmx-auto\b/);
    const panel = screen.getByTestId("my-salary-title-panel");
    expect(within(panel).getByRole("heading", { level: 1 }).textContent).toBe("My Salary");
    expect(panel.textContent).toMatch(/visible only to you/);
    expect(panel.className).toMatch(/rounded-2xl/);
    expect(within(panel).queryByRole("button", { name: /Recalculate/ })).toBeNull(); // not an admin
  });

  it("for an administrator, Recalculate sits in the title panel, right-aligned", async () => {
    h.me = { ...h.me, isAdmin: true };
    await page();
    const panel = screen.getByTestId("my-salary-title-panel");
    const btn = within(panel).getByRole("button", { name: /Recalculate my salary/ });
    expect(btn.closest("div")?.className).toMatch(/justify-end/);
  });
});

describe("Salary statement page", () => {
  const statement = async (runId: string) => {
    const { default: Page } = await import("@/app/(app)/my-salary/statement/[runId]/page");
    return Page({ params: Promise.resolve({ runId }) });
  };
  it("an employee opens their OWN run; another employee's run — or a made-up id — is a 404", async () => {
    h.runs.set(run().id, run());
    h.runs.set("33333333-3333-4333-8333-333333333333", run({ id: "33333333-3333-4333-8333-333333333333", employeeId: "emp-b", employeeName: "Beta Two" }));
    render(await statement(run().id));
    expect(screen.getByTestId("statement-net").textContent).toBe("₹27,800.00");
    expect(screen.getByText(/October 2026 · FY 26-27/)).toBeTruthy();
    await expect(statement("33333333-3333-4333-8333-333333333333")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(statement("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(statement("44444444-4444-4444-8444-444444444444")).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("an administrator may open any run", async () => {
    h.me = { ...h.me, isAdmin: true };
    const other = run({ id: "33333333-3333-4333-8333-333333333333", employeeId: "emp-b", employeeName: "Beta Two" });
    h.runs.set(other.id, other);
    render(await statement(other.id));
    expect(screen.getByText("Beta Two")).toBeTruthy();
  });
});
