// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The reviewer comment on screen: the Add Comment form on the Escalations page (server action MOCKED), and how a saved
// reviewer comment looks in the Tracker's Comments column and the popup History — violet, labelled, beside unchanged
// salesperson comments.
const a = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/scorecard-actions", () => ({ getScorecardEscalations: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/marks-actions", () => ({ setCompanyMarks: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), setConfirmedAmount: vi.fn(), escalateForReview: vi.fn(), assignSalesCoordinator: vi.fn(), editFollowUpComment: vi.fn(), deleteFollowUpComment: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({
  addEscalationComment: (...x: unknown[]) => a.add(...x),
  closeEscalation: (...x: unknown[]) => a.close(...x),
  getCompanyCommitment: vi.fn(),
  saveCompanyCommitment: vi.fn(),
}));

import { CommitmentsTable, type CommitmentView } from "@/components/collections/commitments-table";
import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows } from "@/lib/collections/derive";

const ESC = "33333333-3333-4333-8333-333333333333";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const salesComment = { id: "c1", note: "Customer says the invoice is wrong", createdAt: new Date("2026-11-02T05:00:00Z"), createdById: "e-sales", createdByName: "Sales Person", reviewerEscalationId: null };
const reviewerComment = { id: "c2", note: "Checked with accounts: invoice is correct.", createdAt: new Date("2026-11-03T10:15:00Z"), createdById: "e-rev", createdByName: "Reviewer One", reviewerEscalationId: ESC };
const row: CommitmentView = {
  companyId: COMPANY,
  companyName: "Alpha Traders",
  collectionPerson: "MANGESH",
  amount: null,
  committedDate: null,
  recordedAt: null,
  comments: [reviewerComment, salesComment],
  due: [],
  confirmation: null,
  confirmedAmount: null,
  outstanding: null,
  escalation: { id: ESC, escalatedAt: new Date("2026-11-02T06:00:00Z"), escalatedByName: "Sales Person", confirmationAtEscalation: null, confirmedAmountAtEscalation: null, reason: "Customer disputes the invoice amount." },
};

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
});
afterEach(cleanup);

describe("Add Comment on the Escalations page", () => {
  const renderPage = (over: Partial<Parameters<typeof CommitmentsTable>[0]> = {}) =>
    render(<CommitmentsTable rows={[row]} today="2026-11-03" showCommitments={false} showEscalations canClose canComment {...over} />);

  it("sits beside Close; Save is refused for an empty comment; Cancel closes the form without saving", async () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Close the escalation for Alpha Traders" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a reviewer comment for Alpha Traders" }));
    const form = screen.getByRole("form", { name: "Reviewer comment for Alpha Traders" });
    expect((within(form).getByRole("button", { name: "Save Comment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Reviewer comment text for Alpha Traders"), { target: { value: "   " } });
    expect((within(form).getByRole("button", { name: "Save Comment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Reviewer comment for Alpha Traders" })).toBeNull();
    expect(a.add).not.toHaveBeenCalled();
  });

  it("saves through the action with one token per dialog, confirms, keeps the escalation open, and refreshes", async () => {
    a.add.mockResolvedValue({ ok: true, duplicate: false });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add a reviewer comment for Alpha Traders" }));
    fireEvent.change(screen.getByLabelText("Reviewer comment text for Alpha Traders"), { target: { value: "  Sent the signed delivery note.  " } });
    const save = screen.getByRole("button", { name: "Save Comment" });
    fireEvent.click(save);
    fireEvent.click(save); // a second click while saving sends nothing more
    await waitFor(() => expect(a.add).toHaveBeenCalledTimes(1));
    const sent = a.add.mock.calls[0]![0] as { escalationId: string; note: string; token: string };
    expect(sent).toMatchObject({ escalationId: ESC, note: "Sent the signed delivery note." });
    expect(sent.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Comment saved. The escalation is still open.")).toBeTruthy();
    expect(a.refresh).toHaveBeenCalled();
    expect(a.close).not.toHaveBeenCalled();
  });

  it("a refusal from the server is shown and the text is kept", async () => {
    a.add.mockResolvedValue({ ok: false, error: "That escalation has been closed, so the comment was not saved." });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add a reviewer comment for Alpha Traders" }));
    fireEvent.change(screen.getByLabelText("Reviewer comment text for Alpha Traders"), { target: { value: "Late" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Comment" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/has been closed/);
    expect((screen.getByLabelText("Reviewer comment text for Alpha Traders") as HTMLTextAreaElement).value).toBe("Late");
    expect(a.refresh).not.toHaveBeenCalled();
  });

  it("is not offered where commenting isn't allowed (the Commitments page, or no Review)", () => {
    renderPage({ canComment: false });
    expect(screen.queryByRole("button", { name: /Add a reviewer comment/ })).toBeNull();
  });

  it("the comments column on the page shows the reviewer's reply in violet, labelled with the reviewer's name", () => {
    renderPage();
    const reply = document.querySelector('[data-escalation-reply="true"]') as HTMLElement;
    expect(reply.className).toMatch(/bg-\[#F5F3FF\]/);
    expect(reply.className).toMatch(/border-\[#7C3AED\]/);
    expect(within(reply).getByText("Reviewer Comment — Reviewer One")).toBeTruthy();
    expect(reply.textContent).toContain("Checked with accounts: invoice is correct.");
  });
});

describe("in the Collection Tracker and the company popup", () => {
  const rows = buildRows(
    [{ partyName: "Alpha Traders", debit: 5000, credit: 0, outstanding: null, collectionPerson: "MANGESH", coordinatorLabel: "MANGESH", masterId: COMPANY, transactions: [] }],
    [
      { ...reviewerComment, partyName: "Alpha Traders", nextFollowupDate: null },
      { ...salesComment, partyName: "Alpha Traders", nextFollowupDate: "2026-11-10" },
    ],
  );

  it("the Comments column shows the reviewer comment in violet with its label, name and time; the salesperson comment looks as before", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-11-03" />);
    const reply = document.querySelector('[data-escalation-reply="true"]') as HTMLElement;
    expect(reply).toBeTruthy();
    expect(within(reply).getByText("Reviewer Comment — Reviewer One")).toBeTruthy();
    expect(reply.textContent).toMatch(/03\/11\/26/);
    expect(reply.textContent).toMatch(/03:45 PM/);
  });

  it("the popup History lists the reviewer comment as its own labelled event, and the salesperson comment unchanged", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-11-03" />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const dialog = screen.getByRole("dialog");
    const full = dialog.querySelectorAll('[data-comment-audit="full"]');
    const replies = [...full].filter((el) => el.getAttribute("data-escalation-reply") === "true");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.textContent).toContain("Reviewer Comment — Reviewer One");
    expect(replies[0]!.textContent).toContain("Checked with accounts: invoice is correct.");
    expect(replies[0]!.textContent).toMatch(/03\/11\/26, 03:45 PM/);
    const sales = [...full].find((el) => el.textContent?.includes("Customer says the invoice is wrong"))!;
    expect(sales.getAttribute("data-escalation-reply")).toBeNull();
    expect(sales.textContent).not.toContain("Reviewer Comment");
    expect(sales.className).not.toMatch(/F5F3FF/);
  });
});
