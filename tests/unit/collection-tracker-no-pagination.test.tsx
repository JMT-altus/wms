// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Collection Tracker shows every company it is given in ONE continuous list: no pages, no Previous / Next, and
// search, filters and sorting always cover the whole list. (The server already sends every in-scope Tracker company
// with no limit, and leaves Collection Logs companies out — see tests/integration/collection-logs-movement.db.test.ts.)
// 60 rows and several re-renders per test: allow for a busy machine (the whole suite running), as the other large Tracker UI tests do.
vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/app/(collection-module)/collection/scorecard-actions", () => ({ getScorecardEscalations: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/marks-actions", () => ({ setCompanyMarks: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), setConfirmedAmount: vi.fn(), escalateForReview: vi.fn(), assignSalesCoordinator: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn(), closeEscalation: vi.fn() }));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows } from "@/lib/collections/derive";
import type { CollectionParty } from "@/lib/collections/source";

const TODAY = "2026-11-03";
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const N = 60;
// 60 companies: two coordinators, follow-ups due on some, distinct debits for sorting.
const parties: CollectionParty[] = Array.from({ length: N }, (_, i) => {
  const name = `Company ${String(i + 1).padStart(2, "0")}`;
  const person = i % 2 === 0 ? "RIYA" : "MANGESH";
  return { partyName: name, debit: (i + 1) * 100, credit: 0, outstanding: null, collectionPerson: person, coordinatorLabel: person, masterId: uuid(i + 1), transactions: [] };
});
const followUps = [{ id: "f1", partyName: "Company 60", nextFollowupDate: "2026-11-01", note: "Overdue call", createdById: "e1", createdByName: "Asha", createdAt: new Date("2026-10-20T06:00:00Z") }];
const rows = buildRows(parties, followUps);
const names = () => screen.getAllByRole("row").slice(1).map((tr) => within(tr).getAllByRole("button")[0]!.textContent);

afterEach(cleanup);

describe("Collection Tracker without pagination", () => {
  it("lists all 60 companies at once, once each, with no Previous / Next or page count", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    const listed = names();
    expect(listed).toHaveLength(N);
    expect(new Set(listed).size).toBe(N); // no duplicates
    expect(listed[0]).toBe("Company 01");
    expect(listed[N - 1]).toBe("Company 60"); // the final company is in the list, reachable by scrolling
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
    expect(screen.getByText("60 parties")).toBeTruthy();
  });

  it("scrolls inside one box with the header pinned, and keeps sideways scrolling for narrow screens", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    const box = screen.getByTestId("tracker-scroll");
    expect(box.className).toMatch(/overflow-auto/);
    expect(box.className).toMatch(/max-h-/);
    expect(box.querySelector("table")!.className).toMatch(/min-w-\[1120px\]/);
    expect(box.querySelector("thead")!.className).toMatch(/sticky top-0/);
  });

  it("search finds a company anywhere in the list, including the last one", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "Company 60" } });
    expect(names()).toEqual(["Company 60"]);
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "Company 3" } });
    expect(names()).toEqual(["Company 30", "Company 31", "Company 32", "Company 33", "Company 34", "Company 35", "Company 36", "Company 37", "Company 38", "Company 39"]);
  });

  it("the Collection Person and follow-up filters, and sorting, cover every company", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "MANGESH" } });
    expect(names()).toHaveLength(30);
    expect(names().at(-1)).toBe("Company 60");
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Follow-up" }), { target: { value: "due" } });
    expect(names()).toEqual(["Company 60"]); // the one overdue follow-up, at the very end of the list
    fireEvent.change(screen.getByRole("combobox", { name: "Follow-up" }), { target: { value: "none" } });
    expect(names()).toHaveLength(N - 1);
    fireEvent.change(screen.getByRole("combobox", { name: "Follow-up" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Debit/ })); // ascending
    fireEvent.click(screen.getByRole("button", { name: /^Debit/ })); // descending: the largest debit, from the very end, comes first
    expect(names()[0]).toBe("Company 60");
    expect(names()).toHaveLength(N);
  });
});
