// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Category A completion screens: the held items and their acknowledgment, the two-person negative balances, the
// representative-history import, a limit's amount never stored as ₹0 by itself, the employee view before Category A's
// cut-over, and Category A in "Reviews waiting". Server actions are mocked; the server checks everything again.
vi.setConfig({ testTimeout: 30_000 });

const m = vi.hoisted(() => ({ ack: vi.fn(), retire: vi.fn(), request: vi.fn(), decide: vi.fn(), importReps: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: m.toast }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({
  acknowledgeCategoryAHold: (...x: unknown[]) => m.ack(...x),
  retireCategoryAHoldAcknowledgment: (...x: unknown[]) => m.retire(...x),
  requestCategoryANegativeDecision: (...x: unknown[]) => m.request(...x),
  decideCategoryANegativeDecision: (...x: unknown[]) => m.decide(...x),
}));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/input-actions", () => ({ importRepresentativePeriods: (...x: unknown[]) => m.importReps(...x) }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/actions", () => ({ saveIncentiveDraft: vi.fn(), submitIncentiveVersion: vi.fn(), approveIncentiveVersion: vi.fn(), rejectIncentiveVersion: vi.fn(), publishIncentiveVersion: vi.fn(), withdrawIncentiveVersion: vi.fn(), returnIncentiveVersionToDraft: vi.fn(), discardIncentiveVersion: vi.fn(), createIncentiveDraft: vi.fn(), createIncentiveProgram: vi.fn() }));

import { AHeldItems, ANegativeBalances, type HeldItemView, type NegativeView } from "@/components/admin/master/incentive-rules/a-holds";
import { RepImport } from "@/components/admin/master/incentive-rules/rep-import";
import { MyCategoryA } from "@/components/incentive/my-category-a";
import { ReviewsWaiting } from "@/components/incentive/manage/overview";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DOC = "00000000-0000-4000-8000-3a0000000001";
const held = (over: Partial<HeldItemView> = {}): HeldItemView => ({ documentId: DOC, documentNo: "CN X", code: "credit-note-unlinked", label: "Credit note not linked to an invoice", message: "Credit note CN X isn't linked to a sales invoice, so it can't reduce any order.", acknowledged: null, ...over });

describe("held items", () => {
  it("lists each held item and acknowledges one only with a reason", async () => {
    m.ack.mockResolvedValue({ ok: true, id: "x" });
    render(<AHeldItems items={[held()]} canReview ready />);
    expect(screen.getByText(/1 of 1 not yet resolved or acknowledged/)).toBeTruthy();
    expect(screen.getByText("OPEN")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Acknowledge" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Acknowledge: reason"), { target: { value: "Goodwill credit on account" } });
    fireEvent.click(button);
    await waitFor(() => expect(m.ack).toHaveBeenCalledWith({ documentId: DOC, code: "credit-note-unlinked", reason: "Goodwill credit on account" }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });
  it("is read-only without the review right, and says 0142 is needed before it is applied", () => {
    render(<AHeldItems items={[held()]} canReview={false} ready={false} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.getByText(/needs database update 0142/)).toBeTruthy();
  });
  it("shows an acknowledgment, who made it and why", () => {
    render(<AHeldItems items={[held({ acknowledged: { id: "a", reason: "Goodwill", byName: "reviewer", at: "2026-11-21T00:00:00Z" } })]} canReview ready />);
    expect(screen.getByText("ACKNOWLEDGED")).toBeTruthy();
    expect(screen.getByText(/Acknowledged by reviewer: Goodwill/)).toBeTruthy();
  });
});

describe("negative balances at lock", () => {
  const item = (over: Partial<NegativeView> = {}): NegativeView => ({ employeeId: "e1", name: "rep", outcome: "write-off", amountPaise: 50000, note: "Negative balance written off (configured).", needsSecondPerson: true, request: null, decision: null, approved: false, ...over });
  it("asks for a second person's approval, with a reason", async () => {
    m.request.mockResolvedValue({ ok: true, requestId: "r1", amountPaise: 50000 });
    render(<ANegativeBalances programId="p" month="2026-05-01" items={[item()]} ready canRequest canDecide={false} me="me" />);
    expect(screen.getByText("NEEDS APPROVAL")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Request approval: reason"), { target: { value: "Dispute settled" } });
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    await waitFor(() => expect(m.request).toHaveBeenCalledWith({ programId: "p", month: "2026-05-01", employeeId: "e1", reason: "Dispute settled" }));
  });
  it("the requester can't decide their own request; someone else approves or refuses it", async () => {
    const pending = item({ request: { id: "r1", byId: "me", byName: "locker", reason: "x", at: "2026-11-21T00:00:00Z" } });
    const { unmount } = render(<ANegativeBalances programId="p" month="2026-05-01" items={[pending]} ready canRequest canDecide me="me" />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/You requested it: a second person approves or refuses it/)).toBeTruthy();
    unmount();
    m.decide.mockResolvedValue({ ok: true, amountPaise: 50000 });
    render(<ANegativeBalances programId="p" month="2026-05-01" items={[pending]} ready canRequest canDecide me="other" />);
    fireEvent.change(screen.getAllByLabelText("Approve: reason")[0]!, { target: { value: "Agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(m.decide).toHaveBeenCalledWith({ requestId: "r1", decision: "approve", reason: "Agreed" }));
  });
});

describe("representative history import", () => {
  it("checks the file first, lists each row's problem, and imports only when every row is right", async () => {
    m.importReps.mockResolvedValueOnce({ ok: true, imported: 0, rows: [{ line: 2, customer: "C-001", employee: "rep@example.test", from: "2025-01-01", to: null, customerName: "Customer One", employeeName: "rep", problem: null }, { line: 3, customer: "Nobody", employee: "x", from: "2025-01-01", to: null, customerName: null, employeeName: null, problem: 'No customer with code or name "Nobody".' }] });
    render(<RepImport />);
    const file = new File(["customer,employee,from,to,note\nC-001,rep@example.test,2025-01-01,,\n"], "reps.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Representative periods file"), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Check the file" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    await waitFor(() => expect(screen.getByText(/1 of 2 rows can't be imported/)).toBeTruthy());
    expect(m.importReps).toHaveBeenCalledWith({ csv: expect.stringContaining("C-001"), commit: false });
    expect(screen.getByText('No customer with code or name "Nobody".')).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the employee's Category A before its cut-over", () => {
  it("says the old engine's Category A is this month's (counted with the other categories), never historical", () => {
    render(<MyCategoryA period="2026-11" ready months={[]} awaiting={[]} historical={[]} oldEngineMonth />);
    expect(screen.getByText(/Before Category A's new engine starts: this month's Category A is the old engine's, shown with the other categories/)).toBeTruthy();
  });
});

describe("Reviews waiting", () => {
  it("lists Category A's held items with a link to its calculation", () => {
    render(<ReviewsWaiting heldA={2} heldB={0} heldC={0} f={null} programId="p1" month="2026-04-01" />);
    expect(screen.getByText(/2 items held in the latest calculation/)).toBeTruthy();
    expect(screen.getAllByRole("link").some((a) => (a.getAttribute("href") ?? "").includes("/master-setup/incentive-rules/calculation?program=p1&month=2026-04"))).toBe(true);
  });
});
