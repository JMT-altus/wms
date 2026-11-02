// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Collection Amount Confirmation column's text field (the confirmed amount, migration 0123) and the "Escalate" button in
// the Tracker, with the server actions MOCKED: what the field accepts, what it refuses before calling the server, and what it
// shows. The real action, SQL and permissions are covered in tests/integration/collection-confirmed-amounts.db.test.ts.
const a = vi.hoisted(() => ({ amount: vi.fn(), confirm: vi.fn(), escalate: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({
  saveFollowUp: vi.fn(),
  setCollectionConfirmation: (...x: unknown[]) => a.confirm(...x),
  setConfirmedAmount: (...x: unknown[]) => a.amount(...x),
  escalateForReview: (...x: unknown[]) => a.escalate(...x),
}));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn(), closeEscalation: vi.fn() }));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { CommitmentsTable, type CommitmentView } from "@/components/collections/commitments-table";
import { buildRows, type PartyRow } from "@/lib/collections/derive";
import { CONFIRMED_AMOUNT_PLACEHOLDER, ConfirmedAmountInput, parseConfirmedAmount } from "@/lib/collections/review";

const CO = "11111111-1111-4111-8111-111111111111";
const party = (over: Partial<PartyRow> = {}): PartyRow =>
  ({
    ...buildRows([{ partyName: "Alpha Traders", debit: 5000, credit: 0, outstanding: null, collectionPerson: "MANGESH", masterId: CO, transactions: [] }], [])[0]!,
    ...over,
  }) as PartyRow;
const field = () => screen.getByLabelText("Collection Amount Confirmation for Alpha Traders") as HTMLInputElement;
const saveButton = () => screen.queryByRole("button", { name: "Save confirmed amount for Alpha Traders" }) as HTMLButtonElement | null;
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
});
afterEach(cleanup);

describe("parseConfirmedAmount — the one rule the field and the server share", () => {
  it("accepts whole rupees and paise, with or without ₹ and digit grouping, to exact canonical text", () => {
    expect(parseConfirmedAmount("25450")).toEqual({ ok: true, text: "25450.00", paise: 2545000n });
    expect(parseConfirmedAmount("25450.5")).toEqual({ ok: true, text: "25450.50", paise: 2545050n });
    expect(parseConfirmedAmount("₹25,450.50")).toEqual({ ok: true, text: "25450.50", paise: 2545050n });
    expect(parseConfirmedAmount("Rs. 31,18,55,013.28")).toEqual({ ok: true, text: "311855013.28", paise: 31185501328n });
    expect(parseConfirmedAmount(" 1,000,000 ")).toEqual({ ok: true, text: "1000000.00", paise: 100000000n });
    expect(parseConfirmedAmount("0.01")).toEqual({ ok: true, text: "0.01", paise: 1n });
    expect(parseConfirmedAmount("999999999999.99").ok).toBe(true);
  });

  it("refuses negatives, zero, more than 2 decimals, too-large, text and anything not a string", () => {
    const err = (v: unknown) => {
      const r = parseConfirmedAmount(v);
      return r.ok ? "ACCEPTED" : r.error;
    };
    expect(err("-5")).toMatch(/can't be negative/);
    expect(err("₹-5")).toMatch(/can't be negative/);
    expect(err("(500)")).toMatch(/can't be negative/);
    expect(err("0")).toMatch(/more than zero/);
    expect(err("0.00")).toMatch(/more than zero/);
    expect(err("12.345")).toMatch(/at most 2 decimal places/);
    expect(err("1234567890123")).toMatch(/too large/);
    expect(err("1e5")).toMatch(/Enter the amount in rupees/);
    expect(err("abc")).toMatch(/Enter the amount in rupees/);
    expect(err("12,34")).toMatch(/Enter the amount in rupees/);
    expect(err("3,11,85,50,13.28")).toMatch(/Enter the amount in rupees/); // a stray last group
    expect(err("1,,000")).toMatch(/Enter the amount in rupees/);
    expect(err("")).toMatch(/Enter the confirmed amount/);
    expect(err("   ")).toMatch(/Enter the confirmed amount/);
    expect(err(25450)).toMatch(/Enter the confirmed amount/); // a number has been through floating point
    expect(err(null)).toMatch(/Enter the confirmed amount/);
    expect(err("1".repeat(41))).toMatch(/too long/);
  });

  it("the action's input shape takes only a company id and the typed amount", () => {
    expect(ConfirmedAmountInput.safeParse({ companyId: CO, amount: "100" }).success).toBe(true);
    expect(ConfirmedAmountInput.safeParse({ companyId: CO, amount: 100 }).success).toBe(false);
    expect(ConfirmedAmountInput.safeParse({ companyId: "x", amount: "100" }).success).toBe(false);
    expect(ConfirmedAmountInput.safeParse({ companyId: CO, amount: "100", recordedById: "me" }).success).toBe(false);
  });
});

describe("the Collection Amount Confirmation column (Tracker)", () => {
  it("keeps its heading, shows a text field with the placeholder and no dropdown; the other columns are unchanged", () => {
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    expect(screen.getByRole("columnheader", { name: "Collection Amount Confirmation" })).toBeTruthy();
    const f = field();
    expect(f.tagName).toBe("INPUT");
    expect(f.type).toBe("text");
    expect(f.getAttribute("inputmode")).toBe("decimal");
    expect(f.placeholder).toBe(CONFIRMED_AMOUNT_PLACEHOLDER);
    expect(f.placeholder).toBe("Enter confirmed amount");
    expect(f.value).toBe("");
    expect(f.disabled).toBe(false);
    expect(screen.queryByRole("combobox", { name: /Collection Amount Confirmation/ })).toBeNull();
    expect(field().closest("td")!.querySelector("select")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Unavailable|Not set/);
    for (const h of ["Party name", "Debit", "Credit", "Collection person", "Next follow-up", "Comments", "Collection Amount Confirmation", "Escalation"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h, "i") })).toBeTruthy();
    }
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Party name", "Debit", "Credit", "Collection person (Sales coordinator)", "Next follow-up", "Comments", "Collection Amount Confirmation", "Escalation"]);
  });

  it("a valid amount is sent to the server in canonical form once Save is pressed, then shown as saved", async () => {
    a.amount.mockResolvedValue({ ok: true });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    expect(saveButton()).toBeNull(); // nothing to save yet
    type("₹25,450.50");
    expect(saveButton()).toBeTruthy();
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(a.amount).toHaveBeenCalledWith({ companyId: CO, amount: "25450.50" }));
    expect((await screen.findByRole("status")).textContent).toBe("Saved.");
    expect(field().value).toBe("25450.50");
    expect(a.refresh).toHaveBeenCalled();
    expect(a.confirm).not.toHaveBeenCalled(); // the Yes/No answer is never written by the field
  });

  it("Enter in the field saves too", async () => {
    a.amount.mockResolvedValue({ ok: true });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    type("1200");
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(a.amount).toHaveBeenCalledWith({ companyId: CO, amount: "1200.00" }));
  });

  it("an invalid or negative amount is refused in the browser — the server is never called", async () => {
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    for (const [typed, message] of [
      ["-500", /can't be negative/],
      ["abc", /Enter the amount in rupees/],
      ["12.345", /at most 2 decimal places/],
      ["0", /more than zero/],
    ] as const) {
      type(typed);
      fireEvent.click(saveButton()!);
      expect((await screen.findByRole("alert")).textContent).toMatch(message);
      expect(field().getAttribute("aria-invalid")).toBe("true");
    }
    expect(a.amount).not.toHaveBeenCalled();
    // Typing again clears the message.
    type("12");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refusal from the server is shown and the field keeps what was typed", async () => {
    a.amount.mockResolvedValue({ ok: false, error: "Confirmed amounts can't be stored yet (migration 0123 is pending), so nothing was saved." });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    type("500");
    fireEvent.click(saveButton()!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/migration 0123/);
    expect(field().value).toBe("500");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the saved amount, who entered it and when, for every Tracker user; a holder may change it, others see it read-only", () => {
    const current = { amount: "25450.50", recordedAt: new Date("2026-10-19T05:00:00Z"), recordedByName: "Asha" };
    render(<CollectionTracker rows={[party({ confirmedAmount: current })]} connected storageReady today="2026-10-19" />);
    expect(field().value).toBe("25450.50");
    expect(screen.getByText(/₹25,450\.50 · Asha, 19\/10\/26/)).toBeTruthy();
    expect(saveButton()).toBeNull();
    cleanup();
    render(<CollectionTracker rows={[party({ confirmedAmount: current })]} connected storageReady today="2026-10-19" canSetConfirmation={false} />);
    expect(field().value).toBe("25450.50");
    expect(field().disabled).toBe(true);
    expect(screen.getByText("You can view this but not change it.")).toBeTruthy();
    type("1");
    expect(saveButton()).toBeNull();
    expect(a.amount).not.toHaveBeenCalled();
  });

  it("is read-only and says why while migration 0123 isn't applied; the escalation control is independent of it", () => {
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" amountStorageReady={false} />);
    expect(field().disabled).toBe(true);
    expect(screen.getByText(/migration 0123 is pending/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Escalate Alpha Traders" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Escalate (Tracker)", () => {
  it("reads 'Escalate' and still runs the escalation workflow with the reason", async () => {
    a.escalate.mockResolvedValue({ ok: true });
    render(<CollectionTracker rows={[party()]} connected storageReady today="2026-10-19" />);
    const btn = screen.getByRole("button", { name: "Escalate Alpha Traders" });
    expect(btn.textContent).toBe("Escalate");
    fireEvent.click(btn);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for Escalation/), { target: { value: "Customer disputes the invoice amount." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(a.escalate).toHaveBeenCalledWith({ companyId: CO, reason: "Customer disputes the invoice amount." }));
    expect((await screen.findByRole("status")).textContent).toBe("Escalation submitted for review.");
  });
});

describe("the review page shows the amount beside the Yes/No answer", () => {
  const row: CommitmentView = {
    companyId: CO,
    companyName: "Alpha Traders",
    collectionPerson: "MANGESH",
    amount: null,
    committedDate: null,
    recordedAt: null,
    comments: [],
    confirmation: "no",
    confirmedAmount: "25450.50",
    outstanding: null,
    escalation: { id: "e1", escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: "no", confirmedAmountAtEscalation: "25000.00", reason: "Customer disputes the invoice amount." },
  };

  it("current amount under the confirmation, and the amount in force when escalated under the escalation", () => {
    render(<CommitmentsTable rows={[row]} today="2026-10-19" />);
    const tr = screen.getByText("Alpha Traders").closest("tr")!;
    expect(within(tr).getByText("No")).toBeTruthy();
    expect(within(tr).getByText("Amount: ₹25,450.50")).toBeTruthy();
    expect(within(tr).getByText("Confirmation then: No")).toBeTruthy();
    expect(within(tr).getByText("Confirmed amount then: ₹25,000")).toBeTruthy();
    cleanup();
    render(<CommitmentsTable rows={[{ ...row, confirmedAmount: null, escalation: { ...row.escalation!, confirmedAmountAtEscalation: null } }]} today="2026-10-19" />);
    const tr2 = screen.getByText("Alpha Traders").closest("tr")!;
    expect(within(tr2).queryByText(/^Amount:/)).toBeNull();
    expect(within(tr2).getByText("Confirmed amount then: Not entered")).toBeTruthy();
  });
});
