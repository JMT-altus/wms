// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Reimbursements' WMS table (ModuleList layout="table"): the same server actions as the cards, every field still
// reachable in the details row, and the other modules keep the card list.
const a = vi.hoisted(() => ({ decide: vi.fn(), archive: vi.fn(), remove: vi.fn(), adminFields: vi.fn() }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(app)/forms/actions", () => ({
  decideModule: (...x: unknown[]) => a.decide(...x),
  setModuleArchived: (...x: unknown[]) => a.archive(...x),
  deleteModuleSubmission: (...x: unknown[]) => a.remove(...x),
  setModuleAdminFields: (...x: unknown[]) => a.adminFields(...x),
  addProductOption: vi.fn(),
}));

import { ModuleList } from "@/components/forms/module-list";
import { MODULES } from "@/lib/forms/modules";
import type { ModuleSubmissionRow } from "@/lib/queries/modules";

const def = MODULES.reimbursement;
const row = (over: Partial<ModuleSubmissionRow> = {}): ModuleSubmissionRow => ({
  id: "s1", module: "reimbursement", employeeId: "e1", employeeName: "Asha Rao",
  fields: { expense_for: "Client visit cab", amount: "1500", expense_date: "2026-11-03", product: "Rotary", bill_url: "https://example.test/bill", notes: "Airport drop" },
  adminFields: {}, status: "pending", decidedByName: null, decidedAt: null, createdAt: new Date("2026-11-04T05:00:00Z"), ...over,
});
const props = { isAdmin: true, requestFields: def.requestFields, adminFields: def.adminFields, productOptions: ["Rotary"], grantLabel: "Approve", approvedLabel: "Approved", primaryKey: "expense_for" };

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
  a.decide.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("Reimbursements table", () => {
  it("shows the expense, employee, date, amount and status, and Approve / Reject call the same action", async () => {
    render(<ModuleList {...props} rows={[row()]} layout="table" />);
    const table = screen.getByRole("table", { name: "Submissions" });
    const cells = within(table).getAllByRole("row")[1]!.textContent!;
    expect(cells).toMatch(/Client visit cab/);
    expect(cells).toMatch(/Asha Rao/);
    expect(cells).toMatch(/₹1,500/);
    expect(cells).toMatch(/Pending/);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(a.decide).toHaveBeenCalledWith({ id: "s1", status: "approved" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(a.decide).toHaveBeenLastCalledWith({ id: "s1", status: "rejected" }));
  });

  it("Details opens every request field, the review and (for admins) the response form", () => {
    render(<ModuleList {...props} rows={[row({ status: "approved", decidedByName: "Reviewer", decidedAt: new Date("2026-11-05T05:00:00Z") })]} layout="table" />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull(); // already approved
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    for (const label of ["Expense For", "Amount ₹", "Expense Date", "Bill / Receipt Link", "Notes"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText(/Approved by Reviewer on/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save response/ })).toBeTruthy();
  });

  it("a staff member sees no review controls; an empty list shows the empty state", () => {
    render(<ModuleList {...props} isAdmin={false} rows={[row()]} layout="table" />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    cleanup();
    render(<ModuleList {...props} rows={[]} layout="table" />);
    expect(screen.getByTestId("module-empty").textContent).toMatch(/No submissions yet/);
  });

  it("the other modules keep the card list (the default layout)", () => {
    const { container } = render(<ModuleList {...props} rows={[row()]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector("ul > li")).not.toBeNull();
  });
});
