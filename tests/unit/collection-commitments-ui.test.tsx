// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// UI for commitments, with the owner-only server actions MOCKED: the popup
// section appears (and fetches) only when the server said this is the owner;
// the owner's table filters by company and collection person.
const a = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), follow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({ saveFollowUp: a.follow }));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({
  getCompanyCommitment: (...x: unknown[]) => a.get(...x),
  saveCompanyCommitment: (...x: unknown[]) => a.save(...x),
}));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { CommitmentsTable, filterCommitments } from "@/components/collections/commitments-table";
import { buildRows } from "@/lib/collections/derive";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const rows = buildRows(
  [
    { partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: "Mihir", coordinatorLabel: "Mihir", masterId: COMPANY, transactions: [] },
    { partyName: "Beta Corp", debit: null, credit: null, outstanding: null, collectionPerson: null, coordinatorLabel: null, masterId: "22222222-2222-4222-8222-222222222222", transactions: [] },
  ],
  [],
);

beforeEach(() => {
  a.get.mockReset().mockResolvedValue({ ok: true, storageReady: true, commitment: { amount: "125000.00", committedDate: "2026-11-05", recordedAt: new Date() } });
  a.save.mockReset();
});
afterEach(cleanup);

describe("party popup", () => {
  it("a non-owner sees no commitment section and the browser never asks for one", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/Committed amount/i)).toBeNull();
    expect(a.get).not.toHaveBeenCalled();
  });

  it("the owner sees the committed amount and date, fetched for that company only", async () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" canSeeCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const section = await screen.findByRole("region", { name: "Commitment" });
    expect(a.get).toHaveBeenCalledWith(COMPANY);
    await waitFor(() => expect(within(section).getByText("₹1,25,000")).toBeTruthy());
    expect(within(section).getByText("05 Nov 2026")).toBeTruthy();
  });

  it("a holder of collection.commitments.edit records a new commitment through the capability-checked action", async () => {
    a.save.mockResolvedValue({ ok: true, commitment: { amount: "90000.00", committedDate: "2026-11-20", recordedAt: new Date() } });
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" canSeeCommitments canEditCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    await screen.findByText("₹1,25,000");
    fireEvent.change(screen.getByLabelText("Committed amount for Alpha Traders"), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText("Committed date for Alpha Traders"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledWith({ companyId: COMPANY, amount: "90000", committedDate: "2026-11-20" }));
    expect(await screen.findByText("₹90,000")).toBeTruthy();
  });

  it("shows the Collection Master coordinator as the collection person, and filters by it (incl. Unassigned)", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" />);
    expect(within(screen.getByRole("button", { name: "Alpha Traders" }).closest("tr")!).getByText("Mihir")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Beta Corp" }).closest("tr")!).getByText("Unassigned")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "Mihir" } });
    expect(screen.queryByRole("button", { name: "Beta Corp" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "__unassigned__" } });
    expect(screen.queryByRole("button", { name: "Alpha Traders" })).toBeNull();
    expect(screen.getByRole("button", { name: "Beta Corp" })).toBeTruthy();
  });
});

describe("owner's commitments table", () => {
  const data = [
    { companyId: "c1", companyName: "Alpha Traders", amount: "125000.00", committedDate: "2026-11-05", recordedAt: new Date(), collectionPerson: "Mihir", comments: [] },
    { companyId: "c2", companyName: "Beta Corp", amount: "40000.00", committedDate: "2026-10-25", recordedAt: new Date(), collectionPerson: "Gauri", comments: [] },
    { companyId: "c3", companyName: "Gamma Ltd", amount: "10000.00", committedDate: "2026-12-01", recordedAt: new Date(), collectionPerson: null, comments: [] },
  ];

  it("lists company, committed amount, committed date and collection person", () => {
    render(<CommitmentsTable rows={data} today="2026-10-19" />);
    for (const h of ["Company", "Committed amount", "Committed date", "Collection person"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
    }
    const alpha = screen.getByText("Alpha Traders").closest("tr")!;
    expect(within(alpha).getByText("₹1,25,000")).toBeTruthy();
    expect(within(alpha).getByText("05 Nov 2026")).toBeTruthy();
    expect(within(alpha).getByText("Mihir")).toBeTruthy();
    expect(within(screen.getByText("Gamma Ltd").closest("tr")!).getByText("Unassigned")).toBeTruthy();
  });

  it("filters by search and by collection person", () => {
    expect(filterCommitments(data, "beta", "").map((r) => r.companyId)).toEqual(["c2"]);
    expect(filterCommitments(data, "gauri", "").map((r) => r.companyId)).toEqual(["c2"]);
    expect(filterCommitments(data, "", "Mihir").map((r) => r.companyId)).toEqual(["c1"]);
    expect(filterCommitments(data, "", "__unassigned__").map((r) => r.companyId)).toEqual(["c3"]);
    render(<CommitmentsTable rows={data} today="2026-10-19" />);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "Gauri" } });
    expect(screen.queryByText("Alpha Traders")).toBeNull();
    expect(screen.getByText(/1 company · ₹40,000 committed/)).toBeTruthy();
  });
});
