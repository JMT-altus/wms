// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Collection Tracker table now that ₹0 / ₹0 companies live in Collection Logs: the Tracker page leaves them out
// (tests/integration/collection-logs-movement.db.test.ts), so the table has no muted rows, no "No balance" badge and
// no "shown last" ordering. It says how many companies are in Collection Logs and links there when allowed.
// Server actions are MOCKED.
vi.mock("@/app/(collection-module)/collection/scorecard-actions", () => ({ getScorecardEscalations: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/marks-actions", () => ({ setCompanyMarks: vi.fn() }));
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
  ...over,
});
const rowsOf = (parties: CollectionParty[]): PartyRow[] => buildRows(parties, []);
const names = () => screen.getAllByRole("row").slice(1).map((tr) => within(tr).getAllByRole("button")[0]!.textContent);

const LISTED = [
  party(1, "Beta Works", 0, 5000),
  party(2, "Alpha Traders", 5000, 0),
  party(3, "Eta Inc", -10, 0),
  party(4, "Delta Co", null, null), // in no upload yet: listed as usual, never treated as zero
];

afterEach(cleanup);

describe("the Tracker table after the move to Collection Logs", () => {
  it("lists every company it is given in the chosen order, with no muted rows, badges or 'shown last' wording", () => {
    render(<CollectionTracker rows={rowsOf(LISTED)} connected storageReady today={TODAY} />);
    expect(names()).toEqual(["Alpha Traders", "Beta Works", "Delta Co", "Eta Inc"]);
    for (const tr of screen.getAllByRole("row").slice(1)) {
      expect(tr.className).not.toMatch(/opacity-60|saturate-50/);
      expect(tr.hasAttribute("data-zero-balance")).toBe(false);
    }
    expect(screen.queryByText("No balance")).toBeNull();
    expect(screen.getByText("4 parties")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/shown last/);
    fireEvent.click(screen.getByRole("button", { name: /Party name/ }));
    expect(names()).toEqual(["Eta Inc", "Delta Co", "Beta Works", "Alpha Traders"]);
  });

  it("says how many companies are in Collection Logs, linking there for someone who may open it", () => {
    render(<CollectionTracker rows={rowsOf(LISTED)} connected storageReady today={TODAY} logsNote={{ count: 3, href: "/collection/logs" }} />);
    const note = screen.getByLabelText("Companies in Collection Logs");
    expect(note.textContent).toMatch(/^3 companies have ₹0 Debit and ₹0 Credit in the latest upload that included them, so they are in Collection Logs\./);
    expect(note.textContent).toMatch(/They return here automatically when an upload gives them a Debit or Credit\./);
    expect(within(note).getByRole("link", { name: "Collection Logs" }).getAttribute("href")).toBe("/collection/logs");
  });

  it("without the Logs permission the note has no link; with no logged companies there is no note", () => {
    const { unmount } = render(<CollectionTracker rows={rowsOf(LISTED)} connected storageReady today={TODAY} logsNote={{ count: 1, href: null }} />);
    const note = screen.getByLabelText("Companies in Collection Logs");
    expect(note.textContent).toMatch(/^1 company has ₹0 Debit and ₹0 Credit in the latest upload that included it, so it is in Collection Logs\./);
    expect(within(note).queryByRole("link")).toBeNull();
    unmount();
    render(<CollectionTracker rows={rowsOf(LISTED)} connected storageReady today={TODAY} />);
    expect(screen.queryByLabelText("Companies in Collection Logs")).toBeNull();
  });
});
