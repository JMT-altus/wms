// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Tracker's confirmation dropdown and escalate button, and the owner's
// escalation column, with their server actions MOCKED: the UI shows only what
// the server answered, never a default "Yes".
const a = vi.hoisted(() => ({ confirm: vi.fn(), escalate: vi.fn(), close: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({
  saveFollowUp: vi.fn(),
  setCollectionConfirmation: (...x: unknown[]) => a.confirm(...x),
  escalateForReview: (...x: unknown[]) => a.escalate(...x),
}));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({
  getCompanyCommitment: vi.fn(),
  saveCompanyCommitment: vi.fn(),
  closeEscalation: (...x: unknown[]) => a.close(...x),
}));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { CommitmentsTable, type CommitmentView } from "@/components/collections/commitments-table";
import { buildRows, type PartyRow } from "@/lib/collections/derive";

const CO = "11111111-1111-4111-8111-111111111111";
const party = (over: Partial<PartyRow> = {}): PartyRow =>
  ({
    ...buildRows([{ partyName: "Alpha Traders", debit: null, credit: null, outstanding: 125000, collectionPerson: "MANGESH", masterId: CO, transactions: [] }], [])[0]!,
    ...over,
  }) as PartyRow;

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
});
afterEach(cleanup);

const select = () => screen.getByLabelText("Collection Amount Confirmation for Alpha Traders") as HTMLSelectElement;

describe("Collection Amount Confirmation (Tracker)", () => {
  it("starts at Not set — never a default Yes", () => {
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    expect(screen.getByRole("columnheader", { name: "Collection Amount Confirmation" })).toBeTruthy();
    expect(select().value).toBe("");
    expect(select().selectedOptions[0]!.textContent).toBe("Not set");
    expect(select().disabled).toBe(false);
  });

  it("is unavailable (disabled, explained) when the source supplies no outstanding amount", () => {
    render(<CollectionTracker rows={[party({ outstanding: null })]} connected storageReady today="2026-10-19" />);
    expect(select().disabled).toBe(true);
    expect(select().selectedOptions[0]!.textContent).toBe("Unavailable");
    expect(screen.getByText("No outstanding amount from an approved source.")).toBeTruthy();
  });

  it("saving calls the server with the chosen value and refreshes; a refusal is shown and nothing changes", async () => {
    a.confirm.mockResolvedValue({ ok: true });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    fireEvent.change(select(), { target: { value: "no" } });
    await waitFor(() => expect(a.confirm).toHaveBeenCalledWith({ companyId: CO, value: "no" }));
    await waitFor(() => expect(a.refresh).toHaveBeenCalled());
    cleanup();
    a.confirm.mockResolvedValue({ ok: false, error: "There is no outstanding amount from an approved transaction source to confirm for this company." });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    fireEvent.change(select(), { target: { value: "yes" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/no outstanding amount/);
  });

  it("every Tracker user sees the current value and who set it", () => {
    render(<CollectionTracker rows={[party({ confirmation: { value: "yes", recordedAt: new Date("2026-10-19T05:00:00Z"), recordedByName: "Asha" } })]} connected storageReady today="2026-10-19" />);
    expect(select().value).toBe("yes");
    expect(screen.getByText(/Asha, 19 Oct/)).toBeTruthy();
  });

  it("is disabled while migration 0115 isn't applied", () => {
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" reviewStorageReady={false} />);
    expect(select().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Escalate Alpha Traders to Mihir Sir" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Escalate to Mihir Sir (Tracker)", () => {
  const escalateWith = async (reason: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Escalate Alpha Traders to Mihir Sir" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for Escalation/), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    return dialog;
  };

  it("escalates through the server with the reason, and says so only after it succeeds", async () => {
    a.escalate.mockResolvedValue({ ok: true });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    await escalateWith("  Customer disputes the invoice amount.  ");
    expect((await screen.findByRole("status")).textContent).toBe("Escalation submitted for review.");
    expect(a.escalate).toHaveBeenCalledWith({ companyId: CO, reason: "Customer disputes the invoice amount." });
    expect(a.refresh).toHaveBeenCalled();
  });

  it("shows the server's duplicate message instead of pretending", async () => {
    a.escalate.mockResolvedValue({ ok: false, error: "This company already has an open escalation awaiting review. Nothing new was created." });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    await escalateWith("Customer disputes the invoice amount.");
    expect((await screen.findByRole("alert")).textContent).toMatch(/already has an open escalation/);
  });

  it("an open escalation shows who and when instead of the button", () => {
    render(<CollectionTracker rows={[party({ openEscalation: { escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha" } })]} connected storageReady today="2026-10-19" />);
    expect(screen.queryByRole("button", { name: /Escalate Alpha Traders/ })).toBeNull();
    expect(screen.getByText("Escalated")).toBeTruthy();
    expect(screen.getByText(/Asha, 19 Oct/)).toBeTruthy();
  });

  it("existing columns are unchanged", () => {
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    for (const h of ["Party name", "Debit", "Credit", "Collection person", "Next follow-up", "Comments"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h, "i") })).toBeTruthy();
    }
  });
});

describe("Commitments & escalations page — escalations", () => {
  const escalatedOnly: CommitmentView = {
    companyId: CO,
    companyName: "Alpha Traders",
    collectionPerson: "MANGESH",
    amount: null,
    committedDate: null,
    recordedAt: null,
    comments: [{ id: "c1", note: "Cheque promised", createdAt: new Date("2026-10-15T06:00:00Z"), createdById: "emp-asha", createdByName: "Asha" }],
    due: [{ dueDate: "2026-10-17" }],
    confirmation: "no",
    outstanding: null,
    escalation: { id: "e1", escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: null, reason: "Customer disputes the invoice amount." },
  };

  it("shows an escalation-only company clearly — no invented commitment, its data, comments and overdue colour", () => {
    render(<CommitmentsTable rows={[escalatedOnly]} today="2026-10-19" />);
    const row = screen.getByText("Alpha Traders").closest("tr")!;
    expect(within(row).getByText("Escalated")).toBeTruthy();
    expect(within(row).queryByText("Commitment recorded")).toBeNull();
    expect(within(row).getAllByText("Not recorded")).toHaveLength(2); // amount and date
    expect(within(row).getByText("No")).toBeTruthy(); // current confirmation
    expect(within(row).getByText("Confirmation then: Not set")).toBeTruthy();
    expect(within(row).getByText("Escalated by: Asha · 19-Oct-2026 · 11:30 AM IST")).toBeTruthy();
    expect(within(row).getByText("Reason for Escalation")).toBeTruthy();
    expect(within(row).getByText("Customer disputes the invoice amount.")).toBeTruthy();
    expect(within(row).getByText("17 Oct 2026")).toBeTruthy(); // the actual due date
    expect(row.getAttribute("data-overdue")).toBe("warning"); // 2 days overdue → yellow, shared rule
    expect(within(row).getByLabelText("Comments for Alpha Traders, newest first").textContent).toBe("User: Asha · Date & Time: 15-Oct-2026, 11:30 AM ISTComment: Cheque promised");
    expect(screen.getByText(/1 company · ₹0 committed · 1 open escalation/)).toBeTruthy();
  });

  it("a company with both shows both, and totals only recorded commitments", () => {
    render(<CommitmentsTable rows={[{ ...escalatedOnly, amount: "50000.00", committedDate: "2026-11-05", recordedAt: new Date() }]} today="2026-10-19" />);
    const row = screen.getByText("Alpha Traders").closest("tr")!;
    expect(within(row).getByText("Escalated")).toBeTruthy();
    expect(within(row).getByText("Commitment recorded")).toBeTruthy();
    expect(within(row).getByText("₹50,000")).toBeTruthy();
  });

  it("Close calls the owner-only action and refreshes; a refusal is shown", async () => {
    a.close.mockResolvedValue({ ok: true });
    render(<CommitmentsTable rows={[escalatedOnly]} today="2026-10-19" />);
    fireEvent.click(screen.getByRole("button", { name: "Close the escalation for Alpha Traders" }));
    await waitFor(() => expect(a.close).toHaveBeenCalledWith({ escalationId: "e1" }));
    await waitFor(() => expect(a.refresh).toHaveBeenCalled());
    cleanup();
    a.close.mockResolvedValue({ ok: false, error: "That escalation is already closed or no longer exists." });
    render(<CommitmentsTable rows={[escalatedOnly]} today="2026-10-19" />);
    fireEvent.click(screen.getByRole("button", { name: "Close the escalation for Alpha Traders" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already closed/);
  });
});

describe("Tracker — review queue link and setup notice", () => {
  const render0 = (extra: Record<string, unknown>) =>
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" {...extra} />);

  it("a reviewer sees how many escalations are waiting and a link to the review queue", () => {
    render0({ reviewQueue: { openCount: 1, href: "/forms/collection/commitments" } });
    const note = screen.getByRole("note", { name: "Escalations awaiting review" });
    expect(within(note).getByText("1 escalation is waiting for your review.")).toBeTruthy();
    expect(within(note).getByRole("link", { name: "Open the review queue" }).getAttribute("href")).toBe("/forms/collection/commitments");
  });

  it("pluralises, formats large counts, and says plainly when the queue is empty", () => {
    render0({ reviewQueue: { openCount: 1204, href: "/forms/collection/commitments" } });
    expect(screen.getByText("1,204 escalations are waiting for your review.")).toBeTruthy();
    cleanup();
    render0({ reviewQueue: { openCount: 0, href: "/forms/collection/commitments" } });
    expect(screen.getByText("No escalations are waiting for review.")).toBeTruthy();
  });

  it("nobody else sees a review-queue banner", () => {
    render0({});
    expect(screen.queryByRole("note", { name: "Escalations awaiting review" })).toBeNull();
  });

  it("a super-admin's setup notice lists what to grant and links to Field Permissions", () => {
    render0({
      setupHints: [
        { id: "collection.escalation.review", text: "1 escalation is waiting, but no one has been granted “Review escalations”." },
        { id: "collection.coordinator.assign", text: "309 parties have no Sales Coordinator, but no one has been granted “Assign Sales Coordinator”." },
      ],
      setupHref: "/master-setup/access-control",
    });
    const note = screen.getByRole("note", { name: "Setup needed" });
    expect(within(note).getByText("Setup needed (shown to super-admins only)")).toBeTruthy();
    expect(within(note).getAllByRole("listitem")).toHaveLength(2);
    expect(within(note).getByRole("link", { name: "Field Permissions" }).getAttribute("href")).toBe("/master-setup/access-control");
    expect(within(note).getByText(/never to a department/)).toBeTruthy();
  });

  it("no setup notice when there are no hints", () => {
    render0({ setupHints: [] });
    expect(screen.queryByRole("note", { name: "Setup needed" })).toBeNull();
  });
});
