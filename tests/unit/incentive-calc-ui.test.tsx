// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Admin & Master Setup → Incentive Rules → Calculation, with the server actions MOCKED. Invented data only.
const a = vi.hoisted(() => ({ calc: vi.fn(), lock: vi.fn(), refresh: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: a.push }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({
  calculateCategoryAMonth: (...x: unknown[]) => a.calc(...x),
  setCategoryAMonthLocked: (...x: unknown[]) => a.lock(...x),
}));

import { CategoryACalculation, type CalcProps } from "@/components/admin/master/incentive-rules/calculation";

const PROGRAM = "22222222-2222-4222-8222-222222222222";
const BASE: CalcProps = {
  ready: true,
  canRun: true,
  canLock: true,
  programs: [{ id: PROGRAM, code: "SALES", name: "Sales team" }],
  programId: PROGRAM,
  month: "2026-04-01",
  period: { status: "open", rowVersion: 2 },
  latestProblems: [],
  current: {
    runId: "r1",
    configVersionNo: 1,
    asOf: "2026-09-30",
    computedAt: "2026-10-01T05:00:00Z",
    computedByName: "Runner",
    inputsHash: "a".repeat(64),
    results: [{ employeeName: "Sample Rep", salesPaise: 12_00_00_000_00, qualified: true, earnedPaise: 925_00, payablePaise: 925_00, pendingPaise: 0, projectedPaise: 0, explanation: ["Sales in 2026-04: ₹1,20,00,000; threshold ₹1,00,00,000 — qualifies."] }],
    orders: [],
    receipts: [],
  },
  runs: [{ id: "r1", computedAt: "2026-10-01T05:00:00Z", computedByName: "Runner", status: "computed", adopted: true, outcome: "Adopted: the month's first calculation.", configVersionNo: 1, asOf: "2026-09-30" }],
  adjustmentsIn: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Category A calculation screen", () => {
  it("shows the adopted figures, the version used and the reasons", () => {
    render(<CategoryACalculation {...BASE} />);
    expect(screen.getByText("Sample Rep")).toBeTruthy();
    expect(screen.getAllByText("₹925.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Configuration version 1/)).toBeTruthy();
    expect(screen.getByText(/qualifies/)).toBeTruthy();
    expect(screen.getByLabelText("Month status").textContent).toBe("Open");
  });
  it("offers only what the rights allow", () => {
    render(<CategoryACalculation {...BASE} canRun={false} canLock={false} />);
    expect(screen.queryByRole("button", { name: /Calculate/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lock month/ })).toBeNull();
  });
  it("never offers to calculate a paid month, or to reopen it", () => {
    render(<CategoryACalculation {...BASE} period={{ status: "paid", rowVersion: 5 }} />);
    expect((screen.getByRole("button", { name: /Calculate/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Reopen/ })).toBeNull();
  });
  it("shows why a calculation was blocked", async () => {
    a.calc.mockResolvedValue({ ok: true, runId: "r2", unchanged: false, adopted: false, status: "blocked", outcome: "Blocked", problems: ["No published Category A (Sales Order Received) configuration is in force for 2026-04."] });
    render(<CategoryACalculation {...BASE} current={null} runs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Calculate/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No published Category A/));
    expect(a.calc).toHaveBeenCalledWith({ programId: PROGRAM, month: "2026-04-01" });
  });
  it("locks with the row version it read", async () => {
    a.lock.mockResolvedValue({ ok: true, rowVersion: 3, notes: [] });
    render(<CategoryACalculation {...BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /Lock month/ }));
    await waitFor(() => expect(a.lock).toHaveBeenCalledWith({ programId: PROGRAM, month: "2026-04-01", lock: true, rowVersion: 2 }));
  });
  it("says when the database update is still needed", () => {
    render(<CategoryACalculation {...BASE} ready={false} />);
    expect(screen.getByRole("status").textContent).toMatch(/0132/);
  });
});
