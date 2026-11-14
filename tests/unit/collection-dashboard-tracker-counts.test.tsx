// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Dashboard's "Collection person-wise outstanding" table counts the parties the Tracker lists: companies in
// Collection Logs (an open closure — ₹0 Debit and ₹0 Credit in the latest confirmed upload that included them) are
// left out by the one shared rule, `trackerParties`, that both pages build their rows from.
vi.mock("@/components/charts/h-bars", () => ({
  HBars: ({ data }: { data: { label: string; value: number }[] }) => (
    <ul data-testid="hbars">{data.map((d) => <li key={d.label}>{d.label}:{d.value}</li>)}</ul>
  ),
}));
vi.mock("@/components/charts/donut", () => ({ Donut: () => <div data-testid="donut" /> }));

import { CollectionDashboard } from "@/components/collections/collection-dashboard";
import { UNASSIGNED_PERSON, buildRows, filterRows, personSummary, trackerParties } from "@/lib/collections/derive";
import type { CollectionParty } from "@/lib/collections/source";

afterEach(cleanup);

const party = (partyName: string, person: string | null, debit: number | null, credit: number | null, inLogs = false, outstanding: number | null = null): CollectionParty => ({
  partyName,
  debit,
  credit,
  outstanding,
  collectionPerson: person,
  coordinatorLabel: person,
  masterId: `m-${partyName}`,
  inLogs,
});
// What the loader returns for a scope: every company, the ones in Collection Logs flagged.
const loaded = [
  party("A", "Mihir", 500, 0), // Debit only
  party("B", "Mihir", 0, 300), // Credit only
  party("C", "Mihir", 0, 0, true), // ₹0 / ₹0 in the latest upload → Collection Logs
  party("D", "Gauri", 0, 0, true), // Gauri's only company, in Collection Logs
  party("E", null, null, null), // in no upload at all: no balance is not a zero balance
  party("F", null, 0, 0, true),
  party("G", null, -125, 0), // a negative balance is a balance
  party("H", "Ajay", 10, 20),
];

describe("trackerParties", () => {
  it("keeps every party except those in Collection Logs, in order, each once", () => {
    expect(trackerParties(loaded).map((p) => p.partyName)).toEqual(["A", "B", "E", "G", "H"]);
  });

  it("reads the Collection Logs flag only — it never re-derives it from the figures", () => {
    // A blank or missing flag is "listed"; the figures on the row are not consulted.
    expect(trackerParties([party("X", null, 0, 0), { ...party("Y", null, 0, 0), inLogs: undefined }]).map((p) => p.partyName)).toEqual(["X", "Y"]);
    expect(trackerParties([party("Z", "Mihir", 900, 0, true)])).toEqual([]);
  });

  it("does not change the list it is given", () => {
    const before = loaded.map((p) => p.partyName);
    trackerParties(loaded);
    expect(loaded.map((p) => p.partyName)).toEqual(before);
  });
});

describe("the Dashboard table against the Tracker's own filter", () => {
  // The same rows both pages build.
  const rows = buildRows(trackerParties(loaded), []);
  const trackerCount = (collectionPerson: string) => filterRows(rows, { query: "", collectionPerson, followUp: "" }, "2026-11-13").length;

  it("personSummary gives each person the number of parties the Tracker lists for them, Unassigned included", () => {
    const summary = personSummary(rows);
    expect(Object.fromEntries(summary.map((r) => [r.unassigned ? UNASSIGNED_PERSON : r.person, r.parties]))).toEqual({ Mihir: 2, Ajay: 1, [UNASSIGNED_PERSON]: 2 });
    for (const r of summary) expect(r.parties).toBe(trackerCount(r.unassigned ? UNASSIGNED_PERSON : r.person));
    expect(summary.reduce((n, r) => n + r.parties, 0)).toBe(rows.length);
    // Before the correction the table was built from every loaded company: Mihir 3, Gauri 1, Unassigned 3.
    expect(Object.fromEntries(personSummary(loaded).map((r) => [r.person, r.parties]))).toEqual({ Mihir: 3, Gauri: 1, Ajay: 1, Unassigned: 3 });
  });

  it("renders those counts, and no row for a person whose companies are all in Collection Logs", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const table = within(screen.getByRole("region", { name: "Collection person-wise outstanding" }));
    const cells = table.getAllByRole("row").slice(1).map((tr) => within(tr).getAllByRole("cell").map((td) => td.textContent));
    expect(Object.fromEntries(cells.map((c) => [c[0], c[1]]))).toEqual({ Mihir: "2", Ajay: "1", Unassigned: "2" });
    expect(table.queryByText("Gauri")).toBeNull();
    expect(screen.getByText("Total parties").parentElement!.textContent).toContain(String(rows.length));
  });

  it("the Dashboard's person filter and party search still narrow the same rows", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const options = within(screen.getByLabelText("Collection person")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["", "Ajay", "Mihir", UNASSIGNED_PERSON]);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "Mihir" } });
    expect(screen.getByText("Total parties").parentElement!.textContent).toContain(String(trackerCount("Mihir")));
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Party name"), { target: { value: "g" } });
    expect(screen.getByText("Total parties").parentElement!.textContent).toContain("1");
  });

  it("outstanding figures are summed exactly as before, over the rows shown", () => {
    const withAmounts = buildRows(trackerParties([party("A", "Mihir", 500, 0, false, 500), party("B", "Mihir", 0, 300, false, 300), party("C", "Mihir", 0, 0, true, 0), party("E", null, 1, 0, false, 200)]), []);
    expect(personSummary(withAmounts)).toEqual([
      { person: "Mihir", parties: 2, total: 800 },
      { person: "Unassigned", parties: 1, total: 200, unassigned: true },
    ]);
  });
});
