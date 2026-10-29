// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The administrators' Salary page, laid out like My Salary: a payroll card
// with the month's net payable and payment state, the breakdown, the runs
// grouped by paying entity with filters and sorting, the history, and the
// same Import / Export / Generate actions. Every figure is the server's sum.
const a = vi.hoisted(() => ({ generate: vi.fn(), disburse: vi.fn(), toast: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: a.push, refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: (...x: unknown[]) => a.toast(...x) }));
vi.mock("@/app/(app)/salary/actions", () => ({ generateSalary: (...x: unknown[]) => a.generate(...x), setDisbursed: (...x: unknown[]) => a.disburse(...x) }));

import { GenerateButton } from "@/components/salary/admin/generate-button";
import { PayrollCard } from "@/components/salary/admin/payroll-card";
import { PayrollBreakdownCard } from "@/components/salary/admin/payroll-breakdown-card";
import { SalaryRunsReport } from "@/components/salary/admin/salary-runs-report";
import { PayrollHistoryCard } from "@/components/salary/admin/payroll-history-card";
import { SalaryMonthPicker } from "@/components/salary/my/month-picker";
import { AttendanceSummaryCards } from "@/components/salary/my/attendance-cards";
import type { SalaryRunRow } from "@/lib/queries/salary";
import { buildPayrollSummary } from "@/lib/salary/payroll";

const row = (over: Partial<SalaryRunRow>): SalaryRunRow => ({
  id: "r", employeeId: "e", employeeName: "Someone", designationName: null, payingEntityName: null, fy: "FY 26-27", month: "2026-10", annualCtc: 120_000, daysInMonth: 31,
  payableDays: 31, lateMarks: 0, lateDeductionDays: 0, gross: 10_000, pt: 200, tds: 0, advances: 0, pendingBalanceIn: 0, netPayable: 9_800, disbursed: false, disbursedAmount: null,
  source: "generated", createdAt: new Date(), ...over,
});
const rows = [
  row({ id: "r1", employeeId: "e1", employeeName: "Asha Rao", designationName: "Executive", payingEntityName: "Legacy Creators", netPayable: 9_800 }),
  row({ id: "r2", employeeId: "e2", employeeName: "Bala Iyer", designationName: "Manager", payingEntityName: "JSV HUF", gross: 50_000, netPayable: 49_800, disbursed: true, disbursedAmount: 49_800 }),
  row({ id: "r3", employeeId: "e3", employeeName: "Chitra Nair", designationName: "Executive", payingEntityName: "Legacy Creators", gross: 20_000, lateDeductionDays: 0.5, netPayable: 19_800, disbursed: true, disbursedAmount: 10_000 }),
];
const profiles = [
  { employeeId: "e1", name: "Asha Rao", annualCtc: 120_000 },
  { employeeId: "e2", name: "Bala Iyer", annualCtc: 600_000 },
  { employeeId: "e3", name: "Chitra Nair", annualCtc: 240_000 },
  { employeeId: "e4", name: "Dev Kumar", annualCtc: 300_000 },
  { employeeId: "e5", name: "Eka Singh", annualCtc: 0 },
];
const stale = { e1: { status: "stale", savedPayableDays: 31, nowPayableDays: 30, savedLateMarks: 0, nowLateMarks: 0 }, e2: { status: "current" }, e3: { status: "current" } } as const;
const summary = buildPayrollSummary(rows, profiles, stale);
const picker = <SalaryMonthPicker month="2026-10" min="2026-04" max="2026-10" basePath="/salary" inputId="salary-month" label="Payroll month" />;

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
});
afterEach(cleanup);

describe("PayrollCard (the month's net payable)", () => {
  it("follows the reference's Net Pay card: wallet label with the month, the picker top-right, a red Export link, the summed amount, coverage and a neutral status pill", () => {
    render(<PayrollCard s={summary} month="2026-10" monthTitle="October 2026" selector={picker} />);
    const card = screen.getByTestId("payroll-card");
    expect(card.textContent).toMatch(/Net payable · October 2026/);
    expect((within(card).getByLabelText("Payroll month") as HTMLInputElement).value).toBe("2026-10");
    expect(within(card).getByRole("link", { name: /Export Excel/ }).getAttribute("href")).toBe("/salary/export.xlsx?month=2026-10");
    expect(screen.getByTestId("net-payable").textContent).toBe("₹79,400.00");
    expect(screen.getByTestId("payroll-coverage").textContent).toBe("3 runs · 3 of 4 eligible employees · 1 without a CTC profile · ₹59,800.00 paid out");
    const pill = within(card).getByText("Partly paid").closest("[data-payment-status]")!;
    expect(pill.getAttribute("data-variant")).toBe("neutral");
    // One run's attendance changed after generation: the notice says so and that nothing was recalculated.
    expect(within(card).getByRole("status").textContent).toMatch(/1 salary run no longer matches the attendance recorded for October 2026.*nothing has been recalculated/);
    expect(screen.getByTestId("not-generated").textContent).toMatch(/No run yet for Dev Kumar/);
  });

  it("with no runs: says so, how many are eligible and skipped, no amount, no export link, and the hero Generate action", () => {
    const empty = buildPayrollSummary([], profiles);
    render(<PayrollCard s={empty} month="2026-11" monthTitle="November 2026" selector={picker} emptyAction={<GenerateButton month="2026-11" monthLabel="November 2026" rows={[]} hero />} />);
    expect(screen.getByTestId("payroll-empty-title").textContent).toBe("No salary runs for November 2026 yet");
    const card = screen.getByTestId("payroll-card");
    expect(card.textContent).toMatch(/4 of 5 active employees are eligible/);
    expect(card.textContent).toMatch(/Employees without a CTC profile are skipped \(1 of 5 active employees at the moment\)\./);
    expect(screen.queryByTestId("net-payable")).toBeNull();
    expect(within(card).queryByRole("link", { name: /Export Excel/ })).toBeNull();
    expect(within(card).getByRole("button", { name: /Generate Salary for November 2026/ }).getAttribute("data-variant")).toBe("hero");
    expect(within(card).queryByRole("status")).toBeNull();
  });
});

describe("PayrollBreakdownCard", () => {
  it("collapsed: Gross salaries / Deductions (red total) / Net payable; the + button reveals the itemised deductions and the figures behind the month", () => {
    render(<PayrollBreakdownCard s={summary} />);
    expect(screen.getByTestId("gross-total").textContent).toBe("₹80,000.00");
    expect(screen.getByTestId("deductions-total").textContent).toBe("− ₹600.00");
    expect(screen.getByTestId("net-total").textContent).toBe("₹79,400.00");
    expect(screen.queryByText("Professional tax")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show payroll details" }));
    expect(screen.getByText("Professional tax").parentElement!.textContent).toMatch(/− ₹600\.00/);
    expect(screen.getByText("Eligible employees").parentElement!.textContent).toMatch(/4 of 5/);
    expect(screen.getByText("Runs generated").parentElement!.textContent).toMatch(/3 of 4.*No run yet: Dev Kumar/);
    expect(screen.getByText("Paid out").parentElement!.textContent).toMatch(/₹59,800\.00.*1 paid · 1 partly paid · 1 pending/);
    expect(screen.getByText("Needs review").parentElement!.textContent).toMatch(/1/);
    fireEvent.click(screen.getByRole("button", { name: "Hide payroll details" }));
    expect(screen.queryByText("Professional tax")).toBeNull();
  });
});

describe("SalaryRunsReport (the month's runs)", () => {
  const names = () => screen.getAllByRole("row").filter((r) => r.hasAttribute("data-payment-status")).map((r) => r.querySelector("td")?.textContent?.replace(/Needs review.*$/, "").trim());

  it("groups runs by paying entity with totals, every row carries its payment status, late deductions and stale rows are marked, and the month total matches the summary", () => {
    render(<SalaryRunsReport rows={rows} stale={stale} summary={summary} monthTitle="October 2026" />);
    const groups = screen.getAllByTestId("run-group");
    expect(groups.map((g) => g.querySelector("button")!.textContent)).toEqual([expect.stringMatching(/JSV HUF1 employee1 paid/), expect.stringMatching(/Legacy Creators2 employees1 partly paid · 1 pending · 1 needs review/)]);
    expect(names()).toEqual(["Bala Iyer", "Asha Rao", "Chitra Nair"]);
    const withStatus = (status: string) => screen.getAllByRole("row").filter((r) => r.getAttribute("data-payment-status") === status);
    expect(withStatus("paid")).toHaveLength(1);
    expect(withStatus("partial")).toHaveLength(1);
    expect(withStatus("pending")).toHaveLength(1);
    expect(screen.getAllByText("Paid", { selector: "[data-payment-status]" })).toHaveLength(1);
    const asha = screen.getByText("Asha Rao").closest("tr")!;
    expect(within(asha).getByText(/Needs review/)).toBeTruthy();
    expect(within(asha).getByText(/payable days 31 → 30/)).toBeTruthy();
    expect(within(screen.getByText("Chitra Nair").closest("tr")!).getByText("− 0.5 d")).toBeTruthy();
    expect(within(groups[1]!).getByText("Group total").closest("tr")!.textContent).toMatch(/₹30,000\.00.*− ₹400\.00.*₹29,600\.00.*Paid ₹10,000\.00/);
    expect(screen.getByTestId("runs-net-total").textContent).toBe("₹79,400.00");
    expect(screen.getByText("Paid so far").parentElement!.textContent).toMatch(/₹59,800\.00.*2 of 3 runs disbursed/);
  });

  it("the status filter, the entity filter, the search and the sort narrow and order the rows; a group collapses on its header", () => {
    render(<SalaryRunsReport rows={rows} stale={stale} summary={summary} monthTitle="October 2026" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter runs by status" }), { target: { value: "stale" } });
    expect(names()).toEqual(["Asha Rao"]);
    expect(screen.getByText("1 of 3 runs shown")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter runs by status" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter runs by paying entity" }), { target: { value: "Legacy Creators" } });
    expect(names()).toEqual(["Asha Rao", "Chitra Nair"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort runs" }), { target: { value: "net-desc" } });
    expect(names()).toEqual(["Chitra Nair", "Asha Rao"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter runs by paying entity" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "manager" } });
    expect(names()).toEqual(["Bala Iyer"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nobody" } });
    expect(screen.getByTestId("no-match").textContent).toBe("No runs match “nobody”.");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /JSV HUF/ }));
    expect(names()).toEqual(["Chitra Nair", "Asha Rao"]); // JSV HUF collapsed; Legacy Creators still by net, highest first
  });

  it("the disbursed switch asks before marking paid, calls the action and refreshes; each row links to its statement and payslip", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    a.disburse.mockResolvedValue({ ok: true });
    render(<SalaryRunsReport rows={rows} summary={summary} monthTitle="October 2026" />);
    fireEvent.click(screen.getByRole("switch", { name: "Mark Asha Rao disbursed" }));
    expect(confirm).toHaveBeenCalledWith("Mark Asha Rao's salary as disbursed?");
    await vi.waitFor(() => expect(a.disburse).toHaveBeenCalledWith("r1", true));
    await vi.waitFor(() => expect(a.refresh).toHaveBeenCalled());
    const asha = screen.getByText("Asha Rao").closest("tr")!;
    expect(within(asha).getByRole("link", { name: /Statement/ }).getAttribute("href")).toBe("/my-salary/statement/r1");
    expect(within(asha).getByRole("link", { name: /Payslip/ }).getAttribute("href")).toBe("/salary/payslip/r1");
    fireEvent.click(screen.getByRole("button", { name: /How these runs add up to ₹79,400\.00/ }));
    expect(screen.getByText(/Gross salaries ₹80,000\.00 − professional tax ₹600\.00/)).toBeTruthy();
    confirm.mockRestore();
  });
});

describe("GenerateButton", () => {
  it("regenerating a month with existing runs asks first and says disbursed runs stay; declining writes nothing; accepting reports what was skipped", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GenerateButton month="2026-10" monthLabel="October 2026" rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Salary for October 2026/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/Recalculate 3 existing salary runs/);
    expect(confirm.mock.calls[0]![0]).toMatch(/2 runs are marked disbursed and will be left unchanged/);
    expect(a.generate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    a.generate.mockResolvedValue({ ok: true, generated: 2, skippedDisbursed: 2, skippedNoProfile: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Generate Salary for October 2026/ }));
    await vi.waitFor(() => expect(a.generate).toHaveBeenCalledWith({ month: "2026-10" }));
    await vi.waitFor(() => expect(a.toast).toHaveBeenCalled());
    expect((a.toast.mock.calls[0]![0] as { message: string }).message).toBe("Generated 2 salary runs for October 2026. 2 disbursed runs left unchanged. 1 without a CTC profile skipped.");
    expect(a.refresh).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("an empty month generates without a prompt; a failure is shown as a toast", async () => {
    const confirm = vi.spyOn(window, "confirm");
    a.generate.mockResolvedValue({ ok: false, error: "Policy unreadable" });
    render(<GenerateButton month="2026-11" monthLabel="November 2026" rows={[]} hero />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Salary for November 2026/ }));
    expect(confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: "Policy unreadable" }));
    expect(a.refresh).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("PayrollHistoryCard and the roster's attendance cards", () => {
  it("lists every month with its total, run count and payment state, newest first, each linking to that month; the current month is marked", () => {
    render(
      <PayrollHistoryCard
        history={[
          { month: "2026-10", fy: "FY 26-27", runs: 17, netPayable: 212_345.5, disbursed: 0, imported: 0 },
          { month: "2026-09", fy: "FY 26-27", runs: 17, netPayable: 210_000, disbursed: 17, imported: 17 },
          { month: "2026-08", fy: "FY 26-27", runs: 16, netPayable: 200_000, disbursed: 3, imported: 0 },
        ]}
        current="2026-10"
      />,
    );
    const items = within(screen.getByRole("list", { name: "Salary history" })).getAllByRole("link");
    expect(items.map((l) => l.getAttribute("href"))).toEqual(["/salary?month=2026-10", "/salary?month=2026-09", "/salary?month=2026-08"]);
    expect(items[0]!.getAttribute("aria-current")).toBe("page");
    expect(items[0]!.textContent).toMatch(/October 2026.*17 runs · 0 paid.*Payment pending.*₹2,12,345\.50/);
    expect(items[1]!.textContent).toMatch(/17 paid · 17 imported.*Paid/);
    expect(items[2]!.textContent).toMatch(/Partly paid/);
    cleanup();
    render(<PayrollHistoryCard history={[]} current="2026-10" />);
    expect(screen.getByText(/No salary has been generated yet/)).toBeTruthy();
  });

  it("the roster scope words the cards for the whole roster and says how many employees were counted", () => {
    render(
      <AttendanceSummaryCards
        scope="roster"
        employees={17}
        a={{ daysWorked: 300, workingDays: 357, halfDays: 12, absent: 20, noCheckOut: 0, paidLeave: 0, unpaidLeave: 0, compOff: 0, offDays: 85, workedOffDays: 0, payableDays: 306, lateMarks: 9 }}
      />,
    );
    expect(screen.getByTestId("days-worked").textContent).toBe("300 / 357");
    expect(screen.getByTestId("half-days").textContent).toBe("12");
    expect(screen.getByTestId("absent").textContent).toBe("20");
    expect(screen.getByText(/of the roster's working days so far/)).toBeTruthy();
    expect(screen.getByText(/Across 17 active employees · payable days so far:/).textContent).toMatch(/306.*late marks: 9/);
    cleanup();
    render(<AttendanceSummaryCards scope="roster" a={null} error />);
    expect(screen.getByText(/Couldn.t load this month.s attendance/)).toBeTruthy();
  });
});

describe("the page (source checks)", () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const page = src("app/(app)/salary/page.tsx");

  it("neither salary page centres its content in a capped column", () => {
    for (const p of ["app/(app)/salary/page.tsx", "app/(app)/my-salary/page.tsx", "app/(app)/my-salary/statement/[runId]/page.tsx"]) {
      const mains = src(p).match(/<main[^>]*>/g) ?? [];
      expect(mains.length, p).toBeGreaterThan(0);
      for (const m of mains) {
        expect(m, p).toMatch(/\bw-full\b/);
        expect(m, p).not.toMatch(/max-w-\[/);
        expect(m, p).not.toMatch(/\bmx-auto\b/);
      }
    }
  });

  it("the Salary pages ask the header for the full-width breadcrumb — in JMT's blue, never a page-specific colour — so the bar lines up with their gutters", () => {
    for (const p of ["app/(app)/salary/page.tsx", "app/(app)/my-salary/page.tsx", "app/(app)/my-salary/statement/[runId]/page.tsx"]) {
      const s = src(p);
      expect(s, p).toMatch(/<DashboardHeader [^>]*title="Employees ▸ [^"]+"[^>]*fullWidth/);
      expect(s, p).not.toMatch(/titleTone|#E53935|#B71C1C/);
    }
    const header = src("components/layout/header.tsx");
    expect(header).toMatch(/fullWidth \? "px-6 lg:px-8"/);
    expect(header).toMatch(/color: "#0B4FB8"/);
    expect(page).toMatch(/<main className="w-full px-6[^"]*lg:px-8/);
    expect(src("app/(app)/my-salary/page.tsx")).toMatch(/<main className="w-full px-6[^"]*lg:px-8/);
  });

  it("the Salary page is built from the same sections as My Salary, in the reference's order: title panel, payroll card, breakdown, attendance cards, runs report, history", () => {
    const order = ['data-testid="salary-title-panel"', "<PayrollCard", "<PayrollBreakdownCard", "<AttendanceSummaryCards", "<SalaryRunsReport", "<PayrollHistoryCard"];
    const at = order.map((m) => page.indexOf(m));
    expect(at.every((i) => i >= 0), order.join(", ")).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    // The title panel is the My Salary card: white, bordered, the heading with its subtitle, Import then Generate on the right.
    const panel = page.slice(page.indexOf('aria-labelledby="salary-title"'), page.indexOf("</section>"));
    expect(panel).toMatch(/style=\{CARD\}/);
    expect(panel).not.toMatch(/max-w-|#[0-9A-Fa-f]{6}/);
    expect(panel).toMatch(/<h1[^>]*>\s*Salary\s*<\/h1>/);
    expect(panel.indexOf("<SalaryImportDialog")).toBeLessThan(panel.indexOf("&& generate}"));
    // The month is the page's only input, synchronised through the URL: one picker, bounded to the months on record, never past the current month.
    expect(page).toMatch(/raw <= current \? raw : current/);
    expect(page).toMatch(/<SalaryMonthPicker [^>]*basePath="\/salary"/);
    // The roster's attendance is read once, read-only, and feeds both the stale check and the cards.
    expect(page).toMatch(/readMonthAttendance\(month\)/);
    expect(page).toMatch(/staleChecksFrom\(rows, attendance\)/);
    expect(page).toMatch(/rosterAttendance\(attendance\)/);
    expect(page).not.toMatch(/generateSalary|computeSalary|assembleMonthInputs/);
  });

  it("the primary action keeps JMT's blue gradient; secondary controls share My Salary's white button with the module's border and navy text", () => {
    expect(src("components/salary/admin/generate-button.tsx")).toMatch(/#0A6CFF, #0751BE/);
    const dialog = src("components/salary/salary-import-dialog.tsx");
    const trigger = dialog.slice(dialog.indexOf("<Dialog.Trigger"), dialog.indexOf("</Dialog.Trigger>"));
    expect(trigger).toMatch(/border: `1px solid \$\{BORDER\}`, color: NAVY/);
    expect(trigger).not.toMatch(/border-hairline|bg-surface-card|text-ink-strong/);
    expect(src("components/salary/my/recalculate-button.tsx")).toMatch(/border: `1px solid \$\{BORDER\}`, color: NAVY/);
  });
});
