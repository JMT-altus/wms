// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The admin Employee Salary Report (/salary/employee/[employeeId]) composed from the SAME loader My Salary uses, with
// the session, the loader, the employee lookups and navigation mocked. Checked: only admins (requireAdmin) get in; the
// loader is asked for the CHOSEN employee (not the signed-in admin) and the URL's month; the day-by-day report shows
// check-in, check-out and hours (HR-imported punches are ordinary attendance, so they arrive the same way); a day with
// a punch missing shows no hours; the picker lists every employee; My Salary keeps its own wording.
const ADMIN = { id: "emp-admin", name: "Admin One", email: "admin@example.test", isAdmin: true, isActive: true, timezone: "Asia/Kolkata" };
const STAFF = { id: "emp-staff", name: "Staff One", email: "s@example.test", isAdmin: false, isActive: true, timezone: "Asia/Kolkata" };
const ALPHA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BETA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const h = vi.hoisted(() => ({
  me: null as null | Record<string, unknown>,
  today: "2026-10-29",
  data: null as unknown,
  loads: [] as unknown[],
  push: vi.fn(),
  recalc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/layout/footer", () => ({ DashboardFooter: () => null }));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => h.me,
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me || !(h.me as { isAdmin?: boolean }).isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), localDateString: () => h.today }));
vi.mock("@/lib/salary/my-salary", () => ({
  loadMySalary: async (...a: unknown[]) => {
    h.loads.push(a);
    return h.data;
  },
}));
vi.mock("@/lib/salary/employee-report", () => ({
  listReportEmployees: async () => [
    { id: ALPHA, name: "Alpha Imported", inactive: false, timezone: "Asia/Kolkata" },
    { id: BETA, name: "Beta Left", inactive: true, timezone: "Asia/Kolkata" },
  ],
  getReportEmployee: async (id: string) =>
    id === ALPHA ? { id: ALPHA, name: "Alpha Imported", inactive: false, timezone: "Asia/Kolkata" } : id === BETA ? { id: BETA, name: "Beta Left", inactive: true, timezone: "Asia/Kolkata" } : null,
}));
vi.mock("@/lib/queries/salary", () => ({ getRun: async () => null }));
vi.mock("@/app/(app)/salary/actions", () => ({ recalculateEmployeeRun: (...a: unknown[]) => h.recalc(...a) }));

import type { DayRow, MonthSummary } from "@/lib/queries/attendance-status";
import type { SalaryRunRow } from "@/lib/queries/salary";
import type { MySalaryData } from "@/lib/salary/my-salary";

const run = (over: Partial<SalaryRunRow> = {}): SalaryRunRow => ({
  id: "11111111-1111-4111-8111-111111111111", employeeId: ALPHA, employeeName: "Alpha Imported", designationName: "Executive", payingEntityName: "Legacy Creators",
  fy: "FY 26-27", month: "2026-10", annualCtc: 372_000, daysInMonth: 31, payableDays: 28.5, lateMarks: 3, lateDeductionDays: 0.5, gross: 28_000, pt: 200, tds: 0,
  advances: 0, pendingBalanceIn: 0, netPayable: 27_800, disbursed: false, disbursedAmount: null, source: "generated", createdAt: new Date("2026-10-28T10:00:00Z"), ...over,
});
const day = (logDate: string, over: Partial<DayRow> = {}): DayRow => ({
  logDate, weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(), inAt: "09:32", outAt: "18:41", isWeeklyOff: false, code: "P", dayValue: 1, late: false, leftEarly: false, lateWaived: false, workedMinutes: 549, ...over,
});
const summary: MonthSummary = {
  payableDays: 28.5, present: 17, absent: 3, halfDay: 1, weeklyOff: 4, incomplete: 1, late: 3, lateRaw: 3, leftEarly: 0, lateWaived: 0,
  holiday: 1, holidayPresent: 0, holidayHalfDay: 0, paidLeave: 0, unpaidLeave: 0, compOff: 0,
};
// Days as getEmployeeMonthStatus grades imported punches: a full day, and a day with the check-out missing
// (the grader measures that one to 23:59).
const data = (over: Partial<MySalaryData> = {}): MySalaryData => ({
  month: "2026-10", year: 2026, monthNumber: 10, run: run(),
  profile: { designationName: "Executive", payingEntityName: "Legacy Creators", hasProfile: true },
  attendance: { days: [day("2026-10-26"), day("2026-10-27", { outAt: null, code: "incomplete", dayValue: 0, workedMinutes: 868 })], summary },
  stale: { status: "current" }, history: [run()], bounds: { earliest: "2026-04", latest: "2026-10" }, ...over,
});

const page = async (employeeId: string, sp: Record<string, string> = {}) => {
  const { default: Page } = await import("@/app/(app)/salary/employee/[employeeId]/page");
  return render(await Page({ params: Promise.resolve({ employeeId }), searchParams: Promise.resolve(sp) }));
};

beforeEach(() => {
  h.me = ADMIN;
  h.data = data();
  h.loads = [];
  h.push.mockReset();
  h.recalc.mockReset();
});
afterEach(cleanup);

describe("Employee Salary Report (admin)", () => {
  it("is for admins only: anyone else is refused before anything is loaded", async () => {
    h.me = STAFF;
    await expect(page(ALPHA)).rejects.toThrow("Forbidden");
    h.me = null;
    await expect(page(ALPHA)).rejects.toThrow("Forbidden");
    const { default: Index } = await import("@/app/(app)/salary/employee/page");
    await expect(Index()).rejects.toThrow("Forbidden");
    expect(h.loads).toEqual([]);
  });

  it("loads the CHOSEN employee's month with the same loader as My Salary — never the signed-in admin's", async () => {
    await page(ALPHA, { month: "2026-09" });
    expect(h.loads).toEqual([[{ id: ALPHA }, "2026-09", "2026-10-29"]]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Alpha Imported");
    expect(screen.getByTestId("net-pay").textContent).toBe("₹27,800.00");
    // Wording names the employee, not "you".
    expect(document.body.textContent).toContain("How Alpha Imported's salary is calculated");
    expect(document.body.textContent).not.toMatch(/\byour salary\b/i);
  });

  it("a future or malformed month falls back to the current one; an unknown or malformed employee is not found", async () => {
    await page(ALPHA, { month: "2027-01" });
    await page(ALPHA, { month: "bad" });
    expect(h.loads.map((l) => (l as unknown[])[1])).toEqual(["2026-10", "2026-10"]);
    await expect(page("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the daily report shows each day's check-in, check-out and hours; a day missing its check-out shows no hours", async () => {
    await page(ALPHA);
    const rows = [...document.querySelectorAll("table tbody tr")];
    const full = rows.find((r) => r.textContent?.includes("26/10/26"))!;
    expect(full.textContent).toContain("09:32");
    expect(full.textContent).toContain("18:41");
    expect(full.textContent).toContain("9h 9m");
    const open = rows.find((r) => r.textContent?.includes("27/10/26"))!;
    expect(open.textContent).toContain("09:32");
    expect(open.textContent).not.toMatch(/14h|\d+h \d+m/); // no hours to the end of the day
  });

  it("the picker lists every employee (inactive marked) and opens the chosen one for the month on screen", async () => {
    await page(ALPHA, { month: "2026-09" });
    const picker = screen.getByLabelText("Employee") as HTMLSelectElement;
    expect(picker.value).toBe(ALPHA);
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Choose an employee…", "Alpha Imported", "Beta Left (inactive)"]);
    fireEvent.change(picker, { target: { value: BETA } });
    expect(h.push).toHaveBeenCalledWith(`/salary/employee/${BETA}?month=2026-09`);
  });

  it("month links and history stay on this employee's report", async () => {
    await page(ALPHA, { month: "2026-09" });
    // The calendar's arrow (a link) and the month picker both offer "Previous month"; the link stays on this report.
    const prevLinks = screen.getAllByLabelText("Previous month").filter((el) => el.tagName === "A");
    expect(prevLinks.map((a) => a.getAttribute("href"))).toEqual([`/salary/employee/${ALPHA}?month=2026-08`]);
    const history = screen.getByRole("list", { name: "Salary history" });
    expect(within(history).getAllByRole("link")[0]!.getAttribute("href")).toBe(`/salary/employee/${ALPHA}?month=2026-10`);
  });

  it("recalculate is offered (admin action, checked again by the server) for the chosen employee", async () => {
    h.recalc.mockResolvedValue({ ok: true, netPayable: 27_800 });
    await page(ALPHA);
    fireEvent.click(screen.getByRole("button", { name: "Recalculate salary" }));
    expect(h.recalc).toHaveBeenCalledWith(expect.objectContaining({ employeeId: ALPHA, month: "2026-10" }));
  });

  it("the starting page asks for an employee and lists them", async () => {
    const { default: Index } = await import("@/app/(app)/salary/employee/page");
    render(await Index());
    expect(screen.getByRole("heading", { name: "Employee Salary Report" })).toBeTruthy();
    expect((screen.getByLabelText("Employee") as HTMLSelectElement).value).toBe("");
  });
});
