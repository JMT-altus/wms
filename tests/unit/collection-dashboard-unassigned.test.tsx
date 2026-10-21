// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Unassigned companies in the dashboard's person views: counted exactly once,
// totals reconcile with the whole list and with the Tracker's own filter.
vi.mock("@/components/charts/h-bars", () => ({
  HBars: ({ data }: { data: { label: string; value: number }[] }) => (
    <ul data-testid="hbars">{data.map((d) => <li key={d.label}>{d.label}:{d.value}</li>)}</ul>
  ),
}));
vi.mock("@/components/charts/donut", () => ({ Donut: () => <div data-testid="donut" /> }));

import { CollectionDashboard } from "@/components/collections/collection-dashboard";
import { UNASSIGNED_PERSON, buildRows, filterRows, outstandingByPerson, personSummary } from "@/lib/collections/derive";
import type { CollectionParty } from "@/lib/collections/source";

afterEach(cleanup);

const party = (partyName: string, person: string | null, outstanding: number | null): CollectionParty => ({
  partyName,
  debit: null,
  credit: null,
  outstanding,
  collectionPerson: person,
  coordinatorLabel: person,
  masterId: `m-${partyName}`,
});
const parties = [
  party("A", "Mihir", 500),
  party("B", "Mihir", 300),
  party("C", null, 200),
  party("D", null, 100),
  party("E", "Gauri", null),
  party("F", "Unassigned", 50), // a coordinator literally named "Unassigned" is a real person
];

describe("person summaries include Unassigned exactly once", () => {
  it("personSummary: one Unassigned row; rows add up to every party and every supplied amount", () => {
    const s = personSummary(parties);
    expect(s.filter((r) => r.unassigned)).toEqual([{ person: "Unassigned", parties: 2, total: 300, unassigned: true }]);
    expect(s.find((r) => r.person === "Unassigned" && !r.unassigned)).toEqual({ person: "Unassigned", parties: 1, total: 50 });
    expect(s.reduce((n, r) => n + r.parties, 0)).toBe(parties.length);
    const supplied = parties.reduce((n, p) => n + (p.outstanding ?? 0), 0);
    expect(s.reduce((n, r) => n + (r.total ?? 0), 0)).toBe(supplied);
  });

  it("outstandingByPerson: Unassigned once, reconciling with the supplied total", () => {
    const o = outstandingByPerson(parties);
    expect(o.filter((r) => r.unassigned)).toEqual([{ person: "Unassigned", total: 300, unassigned: true }]);
    expect(o.reduce((n, r) => n + r.total, 0)).toBe(1150);
  });

  it("matches the Tracker: the Unassigned row's count is what the Tracker's Unassigned filter shows", () => {
    const rows = buildRows(parties, []);
    const trackerUnassigned = filterRows(rows, { query: "", collectionPerson: UNASSIGNED_PERSON, followUp: "" }, "2026-10-19");
    expect(trackerUnassigned.map((r) => r.partyName)).toEqual(["C", "D"]);
    expect(personSummary(rows).find((r) => r.unassigned)!.parties).toBe(trackerUnassigned.length);
  });

  it("existing order is kept: by total, then name; Unassigned after named people on a tie", () => {
    const tie = [party("X", "Zed", 100), party("Y", null, 100), party("Z", "Amy", 100)];
    expect(personSummary(tie).map((r) => r.person)).toEqual(["Amy", "Zed", "Unassigned"]);
  });
});

describe("dashboard", () => {
  const rows = buildRows(parties, []);

  it("offers Unassigned in the person filter and shows it in the person-wise table", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const values = within(screen.getByLabelText("Collection person")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    // The unassigned group has its own value — never merged with a person literally named "Unassigned".
    expect(values).toEqual(["", "Gauri", "Mihir", "Unassigned", UNASSIGNED_PERSON]);
    const table = screen.getByRole("region", { name: "Collection person-wise outstanding" });
    expect(within(table).getAllByText("Unassigned").length).toBe(2); // the real "Unassigned" person + the unassigned group
  });

  it("filtering to Unassigned narrows every section to the unassigned companies", () => {
    render(<CollectionDashboard rows={rows} connected />);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: UNASSIGNED_PERSON } });
    expect(screen.getByText("Total parties").parentElement!.textContent).toContain("2");
    expect(screen.getByText("Total outstanding").parentElement!.textContent).toContain("₹300");
  });
});
