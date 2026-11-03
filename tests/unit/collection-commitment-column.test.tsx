// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The commitment in the Collection Amount Confirmation column and the popup's commitment history. Server actions MOCKED;
// the real server-side gates are in tests/integration/collection-commitment-column.db.test.ts.
const a = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), setAmount: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/scorecard-actions", () => ({ getScorecardEscalations: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/marks-actions", () => ({ setCompanyMarks: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), setConfirmedAmount: (...x: unknown[]) => a.setAmount(...x), escalateForReview: vi.fn(), assignSalesCoordinator: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({
  getCompanyCommitment: (...x: unknown[]) => a.get(...x),
  saveCompanyCommitment: (...x: unknown[]) => a.save(...x),
  closeEscalation: vi.fn(),
}));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, type PartyRow } from "@/lib/collections/derive";

const TODAY = "2026-11-03";
const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const base = buildRows(
  [
    { partyName: "Alpha Traders", debit: 5000, credit: 0, outstanding: null, collectionPerson: "RIYA", coordinatorLabel: "RIYA", masterId: ALPHA, transactions: [] },
    { partyName: "Beta Works", debit: 100, credit: 0, outstanding: null, collectionPerson: "RIYA", coordinatorLabel: "RIYA", masterId: BETA, transactions: [] },
  ],
  [],
);
const T1 = new Date("2026-11-01T04:30:00Z"); // 10:00 AM IST
const T2 = new Date("2026-11-03T10:15:00Z"); // 03:45 PM IST
const current = { amount: "100000.00", committedDate: "2026-11-04", recordedAt: T2, recordedByName: "Asha" };
const history = [
  { id: "k2", ...current },
  { id: "k1", amount: "75000.00", committedDate: "2026-10-28", recordedAt: T1, recordedByName: "Bala" },
];
/** What the Tracker page gives a holder of collection.commitments.view: the commitment on every row (null = none). */
const asHolder = (rows: PartyRow[]): PartyRow[] => rows.map((r) => ({ ...r, commitment: r.masterId === ALPHA ? current : null }));
const cell = (name: string) => screen.getByRole("button", { name }).closest("tr")!.querySelectorAll("td")[6]!;

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
  a.get.mockResolvedValue({ ok: true, storageReady: true, commitment: current, history });
});
afterEach(cleanup);

describe("the Collection Amount Confirmation column", () => {
  it("shows the popup's commitment as '₹1,00,000 – 04/11/26' for a holder, 'No commitment recorded' when there is none, and no input field", () => {
    render(<CollectionTracker rows={asHolder(base)} connected storageReady today={TODAY} canSeeCommitments />);
    expect(screen.getByRole("columnheader", { name: "Collection Amount Confirmation" })).toBeTruthy();
    const alpha = within(cell("Alpha Traders"));
    // The popup's latest record: amount – date, CURRENT, and when and by whom it was recorded.
    expect(alpha.getByLabelText("Commitment for Alpha Traders").textContent).toBe("₹1,00,000 – 04/11/26CurrentRecorded 03/11/26, 03:45 PM by Asha");
    expect(alpha.getByText("Current").className).toMatch(/uppercase/);
    expect(alpha.queryByLabelText("Collection Amount Confirmation for Alpha Traders")).toBeNull(); // the "Enter confirmed amount" field is gone
    expect(cell("Alpha Traders").querySelector("input, select, textarea")).toBeNull();
    const beta = within(cell("Beta Works"));
    expect(beta.getByLabelText("Commitment for Beta Works").textContent).toBe("No commitment recorded");
    expect(cell("Beta Works").querySelector("input")).toBeNull();
    // No extra column was added.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Commitment");
  });

  it("shows nothing of it to someone the page did not send a commitment to (no collection.commitments.view)", () => {
    render(<CollectionTracker rows={base} connected storageReady today={TODAY} />);
    expect(screen.queryByLabelText("Commitment for Alpha Traders")).toBeNull();
    expect(document.body.textContent).not.toContain("1,00,000");
    expect(cell("Alpha Traders").textContent).toBe("—");
    expect(cell("Alpha Traders").querySelector("input")).toBeNull();
  });

  it("the value comes from the row the page built — never typed again; a stored confirmed amount puts no field back", () => {
    render(<CollectionTracker rows={asHolder(base).map((r) => (r.masterId === ALPHA ? { ...r, confirmedAmount: { amount: "999.00", recordedAt: T1, recordedByName: "Asha" } } : r))} connected storageReady today={TODAY} canSeeCommitments />);
    const alpha = within(cell("Alpha Traders"));
    expect(alpha.getByLabelText("Commitment for Alpha Traders").textContent).toBe("₹1,00,000 – 04/11/26CurrentRecorded 03/11/26, 03:45 PM by Asha");
    expect(alpha.queryByLabelText("Collection Amount Confirmation for Alpha Traders")).toBeNull();
    expect(cell("Alpha Traders").textContent).not.toContain("999");
  });
});

describe("the column and the popup show the same latest record", () => {
  it("the Tracker cell and the popup's Commitment History render identical text for the latest commitment", async () => {
    render(<CollectionTracker rows={asHolder(base)} connected storageReady today={TODAY} canSeeCommitments />);
    const column = screen.getByLabelText("Commitment for Alpha Traders").textContent;
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const list = await screen.findByRole("list", { name: "Commitment history for Alpha Traders: the latest record" });
    expect(within(list).getByRole("listitem").textContent).toBe(column);
    expect(column).toBe("₹1,00,000 – 04/11/26CurrentRecorded 03/11/26, 03:45 PM by Asha");
  });

  it("a newer commitment, once the page re-reads it, shows in the column exactly as the popup shows it", async () => {
    const newer = { amount: "1500000.00", committedDate: "2026-11-04", recordedAt: new Date("2026-11-02T13:04:00Z"), recordedByName: "Altus Corp" };
    a.get.mockResolvedValue({ ok: true, storageReady: true, commitment: newer, history: [{ id: "k9", ...newer }, ...history] });
    render(<CollectionTracker rows={asHolder(base).map((r) => (r.masterId === ALPHA ? { ...r, commitment: newer } : r))} connected storageReady today={TODAY} canSeeCommitments />);
    expect(screen.getByLabelText("Commitment for Alpha Traders").textContent).toBe("₹15,00,000 – 04/11/26CurrentRecorded 02/11/26, 06:34 PM by Altus Corp");
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const list = await screen.findByRole("list", { name: /Commitment history/ });
    expect(within(list).getByRole("listitem").textContent).toBe(screen.getAllByLabelText("Commitment for Alpha Traders")[0]!.textContent);
  });
});

describe("the popup's commitment history", () => {
  it("shows exactly one record — the latest — with its amount, date, Current label, time and who; older ones are not shown", async () => {
    render(<CollectionTracker rows={asHolder(base)} connected storageReady today={TODAY} canSeeCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const list = await screen.findByRole("list", { name: "Commitment history for Alpha Traders: the latest record" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("₹1,00,000 – 04/11/26");
    expect(items[0]!.textContent).toContain("Current");
    expect(items[0]!.textContent).toContain("Recorded 03/11/26, 03:45 PM by Asha");
    // The older record (still returned by the server, still stored) is not displayed anywhere in the section.
    const section = screen.getByRole("region", { name: "Commitment" });
    expect(section.textContent).not.toContain("75,000");
    expect(section.textContent).not.toContain("Bala");
    expect(screen.getByText(/Shown in the Collection Amount Confirmation column as/).textContent).toContain("₹1,00,000 – 04/11/26");
  });

  it("recording a new commitment shows it as the one latest record and refreshes the Tracker behind the popup", async () => {
    const next = { amount: "90000.00", committedDate: "2026-11-20", recordedAt: new Date("2026-11-03T12:00:00Z"), recordedByName: "Asha" };
    a.save.mockResolvedValue({ ok: true, commitment: next });
    render(<CollectionTracker rows={asHolder(base)} connected storageReady today={TODAY} canSeeCommitments canEditCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    await screen.findByRole("list", { name: /Commitment history/ });
    a.get.mockResolvedValue({ ok: true, storageReady: true, commitment: next, history: [{ id: "k3", ...next }, ...history] });
    fireEvent.change(screen.getByLabelText("Committed amount for Alpha Traders"), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText("Committed date for Alpha Traders"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledWith({ companyId: ALPHA, amount: "90000", committedDate: "2026-11-20" }));
    // The newly recorded commitment replaces the shown one; the server still returns all three (nothing is dropped).
    await waitFor(() => expect(within(screen.getByRole("list", { name: /Commitment history/ })).getByRole("listitem").textContent).toContain("₹90,000 – 20/11/26"));
    expect(within(screen.getByRole("list", { name: /Commitment history/ })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Commitment" }).textContent).not.toContain("₹1,00,000 – 04/11/26 ");
    expect(a.get).toHaveBeenCalledTimes(2); // on open, and again after the save
    expect(a.refresh).toHaveBeenCalled(); // the Tracker column re-reads the newest row
  });

  it("a refused save keeps the history as it was and refreshes nothing", async () => {
    a.save.mockResolvedValue({ ok: false, error: "Forbidden." });
    render(<CollectionTracker rows={asHolder(base)} connected storageReady today={TODAY} canSeeCommitments canEditCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    await screen.findByRole("list", { name: /Commitment history/ });
    fireEvent.change(screen.getByLabelText("Committed amount for Alpha Traders"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Committed date for Alpha Traders"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: /Commitment history/ })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("₹1,00,000 – 04/11/26"); // unchanged
    expect(a.refresh).not.toHaveBeenCalled();
  });

  it("without collection.commitments.edit there is no form; without .view nothing is fetched", async () => {
    render(<CollectionTracker rows={asHolder(base)} connected storageReady today={TODAY} canSeeCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    await screen.findByRole("list", { name: /Commitment history/ });
    expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
    cleanup();
    render(<CollectionTracker rows={base} connected storageReady today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    expect(screen.queryByRole("region", { name: "Commitment" })).toBeNull();
    expect(a.get).toHaveBeenCalledTimes(1);
  });
});
