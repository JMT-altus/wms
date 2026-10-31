// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Collection Tracker table with zero-balance companies: they are listed LAST and muted, never removed — searchable,
// filterable, sortable within their group, paged after every normal company, and counted. Server actions are MOCKED.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), setConfirmedAmount: vi.fn(), escalateForReview: vi.fn(), assignSalesCoordinator: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn(), closeEscalation: vi.fn() }));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, type PartyRow } from "@/lib/collections/derive";
import type { CollectionParty } from "@/lib/collections/source";

const TODAY = "2026-10-19";
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const party = (n: number, name: string, debit: number | null, credit: number | null, over: Partial<CollectionParty> = {}): CollectionParty => ({
  partyName: name,
  debit,
  credit,
  outstanding: null,
  collectionPerson: "MANGESH",
  masterId: uuid(n),
  coordinatorLabel: "MANGESH",
  transactions: [],
  // What the loader sets with a confirmed upload in place: no amount on either side — ₹0 / ₹0, or no line (— / —) — is empty-balance.
  zeroBalance: Math.round(Math.abs(debit ?? 0) * 100) === 0 && Math.round(Math.abs(credit ?? 0) * 100) === 0,
  ...over,
});
const rowsOf = (parties: CollectionParty[], followUps: Parameters<typeof buildRows>[1] = []): PartyRow[] => buildRows(parties, followUps);
const listed = () => screen.getAllByRole("row").slice(1).map((tr) => ({ name: within(tr).getAllByRole("button")[0]!.textContent, zero: tr.getAttribute("data-zero-balance") === "true", muted: tr.className.includes("opacity-60") }));
const names = () => listed().map((r) => r.name);

const FIVE = [
  party(1, "Alpha Traders", 5000, 0), // normal: debit
  party(2, "Beta Works", 0, 5000), // normal: credit
  party(3, "Gamma Pvt Ltd", 0, 0), // zero-balance
  party(4, "Delta Co", null, null), // no line in any upload: — / —, empty-balance
  party(5, "Eta Inc", -10, 0), // negative: normal
  party(6, "Zeta Ltd", 0, 0, { collectionPerson: null, coordinatorLabel: null }), // zero-balance, unassigned
];

afterEach(cleanup);

describe("zero-balance companies in the Tracker table", () => {
  it("₹0/₹0 and — / — go last and muted with a badge; debit, credit and negative amounts stay normal, in alphabetical order", () => {
    render(<CollectionTracker rows={rowsOf(FIVE)} connected storageReady today={TODAY} />);
    expect(names()).toEqual(["Alpha Traders", "Beta Works", "Eta Inc", "Delta Co", "Gamma Pvt Ltd", "Zeta Ltd"]);
    expect(listed().map((r) => r.zero)).toEqual([false, false, false, true, true, true]);
    expect(listed().map((r) => r.muted)).toEqual([false, false, false, true, true, true]);
    const gamma = screen.getByRole("button", { name: "Gamma Pvt Ltd" }).closest("tr")!;
    expect(within(gamma).getByText("No balance")).toBeTruthy();
    expect(within(gamma).getByText("No balance").getAttribute("title")).toMatch(/No Debit or Credit in the confirmed uploads/);
    const delta = screen.getByRole("button", { name: "Delta Co" }).closest("tr")!;
    expect(within(delta).getByText("No balance")).toBeTruthy();
    expect(delta.textContent).toContain("—"); // its figures stay dashes: nothing is invented
    expect(within(screen.getByRole("button", { name: "Eta Inc" }).closest("tr")!).queryByText("No balance")).toBeNull();
    // Still every bit a row: the name opens the party, the amount field and escalate button are there.
    expect(within(gamma).getByLabelText("Collection Amount Confirmation for Gamma Pvt Ltd")).toBeTruthy();
    expect(within(gamma).getByRole("button", { name: "Escalate Gamma Pvt Ltd" })).toBeTruthy();
    // The count says what is listed, and the note explains.
    expect(screen.getByText("6 parties (3 with no balance, shown last)")).toBeTruthy();
    expect(screen.getByLabelText("Empty-balance companies").textContent).toMatch(/^3 companies with no Debit or Credit in the confirmed uploads are shown last, muted\./);
  });

  it("search finds muted companies too; the filters work across both groups; the count follows the filter", () => {
    render(<CollectionTracker rows={rowsOf(FIVE)} connected storageReady today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "gamma" } });
    expect(names()).toEqual(["Gamma Pvt Ltd"]);
    expect(listed()[0]!.zero).toBe(true);
    expect(screen.getByText("1 party (1 with no balance, shown last)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "MANGESH" } });
    expect(names()).toEqual(["Alpha Traders", "Beta Works", "Eta Inc", "Delta Co", "Gamma Pvt Ltd"]);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "__unassigned__" } });
    expect(names()).toEqual(["Zeta Ltd"]);
  });

  it("a chosen sort applies within each group; the zero-balance group never moves above the normal one", () => {
    render(<CollectionTracker rows={rowsOf(FIVE)} connected storageReady today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: /Party name/ })); // descending
    expect(names()).toEqual(["Eta Inc", "Beta Works", "Alpha Traders", "Zeta Ltd", "Gamma Pvt Ltd", "Delta Co"]);
    fireEvent.click(screen.getByRole("button", { name: /^Debit/ })); // ascending by debit: negatives first; nulls last within each group
    expect(names()).toEqual(["Eta Inc", "Beta Works", "Alpha Traders", "Gamma Pvt Ltd", "Zeta Ltd", "Delta Co"]);
  });

  it("paging: a page never shows a zero-balance company above a normal one", () => {
    const many = [...Array.from({ length: 30 }, (_, i) => party(100 + i, `Normal ${String(i + 1).padStart(2, "0")}`, 100 + i, 0)), ...Array.from({ length: 10 }, (_, i) => party(200 + i, `Aaa Zero ${String(i + 1).padStart(2, "0")}`, 0, 0))];
    render(<CollectionTracker rows={rowsOf(many)} connected storageReady today={TODAY} />);
    expect(screen.getByText("40 parties (10 with no balance, shown last)")).toBeTruthy();
    const page1 = listed();
    expect(page1).toHaveLength(25);
    expect(page1.every((r) => !r.zero)).toBe(true); // 25 of the 30 normal ones, although "Aaa Zero…" sorts first alphabetically
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const page2 = listed();
    expect(page2.map((r) => r.zero)).toEqual([false, false, false, false, false, ...Array(10).fill(true)]);
    expect(page2.map((r) => r.name).slice(5)).toEqual(Array.from({ length: 10 }, (_, i) => `Aaa Zero ${String(i + 1).padStart(2, "0")}`));
  });

  it("a company's comments, follow-up and collection person are shown exactly the same when it is empty-balance", () => {
    const rows = rowsOf([party(3, "Gamma Pvt Ltd", 0, 0)], [{ id: "f1", partyName: "Gamma Pvt Ltd", nextFollowupDate: "2026-11-05", note: "Called while zero", createdById: "e1", createdByName: "Asha", createdAt: new Date("2026-10-15T06:00:00Z") }]);
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    const tr = screen.getByRole("button", { name: "Gamma Pvt Ltd" }).closest("tr")!;
    expect(tr.getAttribute("data-zero-balance")).toBe("true");
    expect(within(tr).getByText("MANGESH")).toBeTruthy();
    expect(tr.textContent).toContain("Called while zero");
    expect(tr.textContent).toMatch(/05[- ]Nov|5 Nov|2026-11-05/);
  });
});
