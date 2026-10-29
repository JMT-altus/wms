// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkRunAgainstAttendance } from "@/lib/salary/stale";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(app)/salary/actions", () => ({ generateSalary: vi.fn(), setDisbursed: vi.fn() }));

import { SalaryReport } from "@/components/salary/salary-report";
import type { SalaryRunRow } from "@/lib/queries/salary";

afterEach(cleanup);

describe("checkRunAgainstAttendance (pure)", () => {
  const run = { source: "generated", payableDays: 30, lateMarks: 2 };
  it("current when the attendance inputs still match (2-decimal precision)", () => {
    expect(checkRunAgainstAttendance(run, { payableDays: 30.001, lateMarks: 2 })).toEqual({ status: "current" });
  });
  it("stale when payable days or late marks changed, with both values", () => {
    expect(checkRunAgainstAttendance(run, { payableDays: 29.5, lateMarks: 2 })).toEqual({
      status: "stale",
      savedPayableDays: 30,
      nowPayableDays: 29.5,
      savedLateMarks: 2,
      nowLateMarks: 2,
    });
    expect(checkRunAgainstAttendance(run, { payableDays: 30, lateMarks: 3 }).status).toBe("stale");
  });
  it("unknown (never 'current') when attendance can't be read; imported runs aren't compared", () => {
    expect(checkRunAgainstAttendance(run, undefined)).toEqual({ status: "unknown" });
    expect(checkRunAgainstAttendance({ ...run, source: "imported" }, { payableDays: 1, lateMarks: 0 })).toEqual({ status: "not-applicable" });
  });
});

const row = (over: Partial<SalaryRunRow> = {}): SalaryRunRow => ({
  id: "r1",
  employeeId: "e1",
  employeeName: "Alpha One",
  designationName: null,
  payingEntityName: null,
  fy: "FY 26-27",
  month: "2026-08",
  annualCtc: 600000,
  daysInMonth: 31,
  payableDays: 30,
  lateMarks: 0,
  lateDeductionDays: 0,
  gross: 48387,
  pt: 200,
  tds: 0,
  advances: 0,
  pendingBalanceIn: 0,
  netPayable: 48187,
  disbursed: true,
  disbursedAmount: 48187,
  source: "generated",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

describe("salary report stale indicator", () => {
  it("flags the run that needs review and says nothing was recalculated", () => {
    render(
      <SalaryReport
        month="2026-08"
        monthLabel="Aug 2026"
        rows={[row(), row({ id: "r2", employeeId: "e2", employeeName: "Beta Two" })]}
        stale={{ e1: { status: "stale", savedPayableDays: 30, nowPayableDays: 29.5, savedLateMarks: 0, nowLateMarks: 0 }, e2: { status: "current" } }}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/1 salary run no longer matches the attendance recorded for Aug 2026.*nothing has been recalculated/);
    const alpha = screen.getByText("Alpha One").closest("tr")!;
    expect(within(alpha).getByText(/Needs review/)).toBeTruthy();
    expect(within(alpha).getByText(/payable days 30 → 29.5/)).toBeTruthy();
    expect(within(screen.getByText("Beta Two").closest("tr")!).queryByText(/Needs review/)).toBeNull();
  });

  it("shows no banner when every run is current, and works without stale data at all", () => {
    render(<SalaryReport month="2026-08" monthLabel="Aug 2026" rows={[row()]} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Needs review/)).toBeNull();
  });
});

describe("payroll integrity (source checks)", () => {
  it("no attendance-correction module calls salary generation or writes salary runs", () => {
    for (const f of [
      "lib/attendance/correction/apply.ts",
      "lib/attendance/correction/plan.ts",
      "app/(app)/hr/attendance-correction/actions.ts",
      "app/(app)/attendance/actions.ts",
      "lib/queries/salary-stale.ts",
    ]) {
      const src = readFileSync(resolve(__dirname, "../..", f), "utf8");
      expect(src, f).not.toMatch(/generateSalary|computeSalary|assembleMonthInputs/);
      expect(src, f).not.toMatch(/(insert|update|delete)\(\s*salaryRuns\s*\)/);
    }
  });
});
