// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const saveFollowUp = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Collection is its own module now (Admin → Access). Its gate is mocked to follow the session's admin flag — the
// admin bypass — so these tests keep exercising the collection.* capabilities exactly as before.
vi.mock("@/lib/auth/module-access", async () => {
  const { getCurrentEmployee } = await import("@/lib/auth/current");
  const inModule = async () => {
    const me = (await getCurrentEmployee()) as { isActive?: boolean; isAdmin?: boolean } | null;
    return !!me && me.isActive !== false && me.isAdmin === true;
  };
  return {
    canAccessModule: inModule,
    requireModuleAccess: async () => {
      const me = await getCurrentEmployee();
      if (!(await inModule())) throw new Error("Forbidden");
      return me;
    },
  };
});
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({
  saveFollowUp: (...a: unknown[]) => saveFollowUp(...a),
}));
const commitments = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({
  getCompanyCommitment: (...a: unknown[]) => commitments.get(...a),
  saveCompanyCommitment: (...a: unknown[]) => commitments.save(...a),
}));
// The charts draw with a measured container; their data handling is what matters here.
vi.mock("@/components/charts/h-bars", () => ({
  HBars: ({ data }: { data: { label: string; value: number }[] }) => (
    <ul data-testid="hbars">{data.map((d) => <li key={d.label}>{d.label}:{d.value}</li>)}</ul>
  ),
}));
vi.mock("@/components/charts/donut", () => ({
  Donut: ({ data, solid }: { data: { label: string }[]; solid?: boolean }) => (
    <div data-testid="donut" data-solid={solid ? "yes" : "no"}>
      {data.length}
    </div>
  ),
}));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { CollectionDashboard } from "@/components/collections/collection-dashboard";
import { buildRows } from "@/lib/collections/derive";
import { MASTER_NOT_READY_MESSAGE, NOT_CONNECTED_MESSAGE, NO_TRANSACTION_SOURCE_MESSAGE } from "@/lib/collections/source";

const TODAY = "2026-10-13";
const rows = buildRows(
  [
    { partyName: "Alpha Traders", debit: 1000, credit: 400, outstanding: 600, collectionPerson: "Asha" },
    { partyName: "Beta Corp", debit: 500, credit: 0, outstanding: 500, collectionPerson: "Ravi" },
  ],
  [
    {
      id: "f1",
      partyName: "Alpha Traders",
      nextFollowupDate: "2026-11-10",
      note: "Promised a cheque",
      createdById: "emp-admin",
      createdByName: "Admin",
      createdAt: new Date("2026-10-12T10:00:00Z"),
    },
  ],
);

beforeEach(() => saveFollowUp.mockReset());
afterEach(cleanup);

describe("Collection Tracker", () => {
  it("with no data source it is empty and says so — no invented parties", () => {
    render(<CollectionTracker rows={[]} connected={false} storageReady today={TODAY} />);
    expect(screen.getByText(NOT_CONNECTED_MESSAGE)).toBeTruthy();
    for (const h of ["Party name", "Debit", "Credit", "Collection person", "Next follow-up", "Comments"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h, "i") })).toBeTruthy();
    }
    expect(screen.queryAllByRole("row")).toHaveLength(2); // header + the message row
  });

  it("lists each party with its figures, next follow-up and latest notes", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    const alpha = screen.getByRole("button", { name: "Alpha Traders" }).closest("tr")!;
    expect(within(alpha).getByText("Asha")).toBeTruthy();
    expect(within(alpha).getByText(/10 Nov/)).toBeTruthy();
    expect(within(alpha).getByText(/Promised a cheque/)).toBeTruthy();
    const beta = screen.getByRole("button", { name: "Beta Corp" }).closest("tr")!;
    expect(within(beta).getAllByText("—").length).toBeGreaterThanOrEqual(2); // no date, no comments
  });

  it("searches and filters", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "cheque" } });
    expect(screen.queryByRole("button", { name: "Beta Corp" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "Ravi" } });
    expect(screen.queryByRole("button", { name: "Alpha Traders" })).toBeNull();
    expect(screen.getByRole("button", { name: "Beta Corp" })).toBeTruthy();
  });

  it("shows every note with its author, user id, date and time (IST), and keeps earlier ones", () => {
    const many = buildRows(
      [{ partyName: "Alpha Traders", debit: 1, credit: 0, outstanding: 1, collectionPerson: "Asha" }],
      [
        { id: "n3", partyName: "Alpha Traders", nextFollowupDate: null, note: "Third call", createdById: "emp-a", createdByName: "A", createdAt: new Date("2026-11-12T06:00:00Z") },
        { id: "n2", partyName: "Alpha Traders", nextFollowupDate: null, note: "Second call", createdById: "emp-a", createdByName: "A", createdAt: new Date("2026-11-11T06:00:00Z") },
        { id: "n1", partyName: "Alpha Traders", nextFollowupDate: null, note: "First call", createdById: "emp-a", createdByName: "A", createdAt: new Date("2026-11-10T06:00:00Z") },
      ],
    );
    render(<CollectionTracker rows={many} connected storageReady today={TODAY} />);
    // The row shows only the latest note; the earlier ones are kept behind "See all comments".
    const cell = screen.getByLabelText("Comments, newest first");
    expect(cell.textContent).toContain("User: A · Date & Time: 12-Nov-2026, 11:30 AM ISTComment: Third call");
    expect(cell.textContent).not.toContain("Second call");
    expect(screen.getByText("Latest of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See all 3 comments for Alpha Traders" }));
    const all = within(screen.getByRole("dialog", { name: "All comments" })).getByRole("list", { name: "All comments for Alpha Traders, newest first" });
    // The full history, in the popup's own (labelled) format: every note with its author, date and time.
    for (const [day, note] of [["12-Nov-2026", "Third call"], ["11-Nov-2026", "Second call"], ["10-Nov-2026", "First call"]]) {
      expect(all.textContent).toContain(`${day}, 11:30 AM IST`);
      expect(all.textContent).toContain(note);
    }
    expect(all.querySelectorAll('[data-comment-audit="full"]')).toHaveLength(3);
    // newest first
    expect(all.textContent!.indexOf("Third call")).toBeLessThan(all.textContent!.indexOf("First call"));
  });

  it("opens the party's detail, read-only figures and history, from a click on the name", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Debit amount")).toBeTruthy();
    expect(within(dialog).getByText(/Promised a cheque/)).toBeTruthy();
    expect(within(dialog).getByText(/can't be edited here/)).toBeTruthy();
  });

  it("saves only what was entered, and reports success only after the server accepts it", async () => {
    saveFollowUp.mockResolvedValue({ ok: true });
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta Corp" }));
    fireEvent.change(screen.getByLabelText(/Next follow-up date/), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "  Call on Monday " } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => expect(saveFollowUp).toHaveBeenCalledTimes(1));
    expect(saveFollowUp).toHaveBeenCalledWith({
      partyName: "Beta Corp",
      nextFollowupDate: "2026-11-01",
      note: "Call on Monday",
    });
  });

  it("shows the server's refusal and keeps the form", async () => {
    saveFollowUp.mockResolvedValue({ ok: false, error: "That party isn't in the collection data." });
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta Corp" }));
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/isn't in the collection data/));
    expect((screen.getByLabelText(/Note/) as HTMLTextAreaElement).value).toBe("x");
  });

  it("blocks an empty save and a past date before calling the server", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta Corp" }));
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(screen.getByRole("alert").textContent).toMatch(/date or a note/);
    fireEvent.change(screen.getByLabelText(/Next follow-up date/), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(screen.getByRole("alert").textContent).toMatch(/past/);
    expect(saveFollowUp).not.toHaveBeenCalled();
  });

  it("cannot save while follow-up storage isn't set up, and says so", () => {
    render(<CollectionTracker rows={rows} connected storageReady={false} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta Corp" }));
    expect((screen.getByRole("button", { name: "Save follow-up" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/isn't set up yet/);
  });
});

describe("Collection Dashboard", () => {
  it("with no data source it shows em dashes and plain messages, no charts or figures", () => {
    render(<CollectionDashboard rows={[]} connected={false} />);
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.getAllByText(NOT_CONNECTED_MESSAGE).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByTestId("hbars")).toBeNull();
    expect(screen.queryByTestId("donut")).toBeNull();
    expect(screen.getByText(/priority rule .* has not been confirmed/i)).toBeTruthy();
  });

  it("with data it shows parties and persons, and a total only because every party supplied one", () => {
    render(<CollectionDashboard rows={rows} connected />);
    expect(screen.getByText("Total outstanding").parentElement!.textContent).toContain("₹1,100"); // 600 + 500, both supplied
    expect(screen.getAllByTestId("hbars").length).toBeGreaterThan(0);
    // Top 5 as a donut, the collection-person share as a full pie.
    const charts = screen.getAllByTestId("donut");
    expect(charts.map((c) => c.getAttribute("data-solid"))).toEqual(["no", "yes"]);
    expect(charts.every((c) => c.textContent === "2")).toBe(true);
  });

  it("has the collection-person table and the priority table frame", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const persons = screen.getByRole("region", { name: "Collection person-wise outstanding" });
    expect(within(persons).getByText("Asha")).toBeTruthy();
    expect(within(persons).getByText("₹600")).toBeTruthy();
    const priority = screen.getByRole("region", { name: "Priority collections" });
    for (const h of ["Party name", "Outstanding", "Collection person", "Next follow-up"]) {
      expect(within(priority).getByRole("columnheader", { name: h })).toBeTruthy();
    }
    expect(within(priority).getByText(/has not been confirmed yet/)).toBeTruthy();
  });

  it("never totals when any party lacks a supplied outstanding", () => {
    const partial = buildRows(
      [
        { partyName: "A", debit: 10, credit: 0, outstanding: 10, collectionPerson: "X" },
        { partyName: "B", debit: 90, credit: 0, outstanding: null, collectionPerson: "X" },
      ],
      [],
    );
    render(<CollectionDashboard rows={partial} connected />);
    const card = screen.getByText("Total outstanding").parentElement!;
    expect(card.textContent).toContain("—");
    expect(card.textContent).not.toContain("₹");
  });

  it("filters narrow every section, and Overdue stays a dash until its rule is agreed", () => {
    render(<CollectionDashboard rows={rows} connected />);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "Ravi" } });
    expect(screen.getByText("Total outstanding").parentElement!.textContent).toContain("₹500");
    expect(screen.getByText("Total parties").parentElement!.textContent).toContain("1");
    expect(screen.getByText(/Overdue follow-ups/i).parentElement!.textContent).toContain("—");
  });
});

describe("Collection Dashboard order and layout", () => {
  it("lays the four cards out as two columns, with Priority collections full width below", () => {
    render(<CollectionDashboard rows={[]} connected={false} />);
    const titles = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(titles.slice(-4)).toEqual([
      "Collection person share",
      "Collection person-wise outstanding",
      "Top 10 outstanding parties",
      "Priority collections",
    ]);
    // Only Priority spans the row; the other cards each take one column of the grid.
    for (const name of ["Outstanding by collection person", "Collection person share", "Collection person-wise outstanding", "Top 10 outstanding parties"]) {
      expect(screen.getByRole("region", { name }).className).not.toContain("col-span");
    }
    expect(screen.getByRole("region", { name: "Priority collections" }).className).toContain("col-span-2");
    // The grid stacks to one column on a small screen.
    expect(screen.getByRole("region", { name: "Top 10 outstanding parties" }).parentElement!.className).toContain("max-lg:grid-cols-1");
  });

  it("the Top 10 table has aligned headings and a right-aligned amount column", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const top = screen.getByRole("region", { name: "Top 10 outstanding parties" });
    expect(within(top).getByRole("columnheader", { name: "Outstanding" }).className).toContain("text-right");
    expect(within(top).getByText("Alpha Traders").getAttribute("title")).toBe("Alpha Traders"); // full name on hover
  });

  it("with no priority rule, Priority shows its columns and one quiet note, not a broken table", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const pr = screen.getByRole("region", { name: "Priority collections" });
    expect(within(pr).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(pr).getAllByText(/has not been confirmed yet/)).toHaveLength(1);
    expect(within(pr).getByText("No priority collections to display yet.")).toBeTruthy();
    expect(within(pr).queryByText("Alpha Traders")).toBeNull(); // no priority list is invented
  });
});

describe("Priority collections table", () => {
  it("shows its header band and one centred message row spanning all four columns when empty", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const pr = screen.getByRole("region", { name: "Priority collections" });
    const cell = within(pr).getByText(/has not been confirmed yet/).closest("td")!;
    expect(cell.tagName).toBe("TD");
    expect(cell.textContent).toContain("No priority collections to display yet.");
    expect(within(pr).getAllByRole("table")).toHaveLength(1); // no loose paragraph outside the table
    expect(cell.getAttribute("colspan")).toBe("4");
    expect(cell.className).toContain("text-center");
    // Party name and Collection person are left-aligned, Outstanding right-aligned, Next follow-up left-aligned.
    const cls = (n: string) => within(pr).getByRole("columnheader", { name: n }).className;
    expect(cls("Party name")).toContain("text-left");
    expect(cls("Collection person")).toContain("text-left");
    expect(cls("Next follow-up")).toContain("text-left");
    expect(cls("Outstanding")).toContain("text-right");
  });

  it("scrolls sideways on a small screen instead of squeezing the columns", () => {
    render(<CollectionDashboard rows={rows} connected />);
    const table = within(screen.getByRole("region", { name: "Priority collections" })).getByRole("table");
    expect(table.className).toContain("min-w-[560px]");
    expect(table.parentElement!.className).toContain("overflow-x-auto");
  });
});

describe("Collection Tracker with the Collection Master", () => {
  const NO_SOURCE = { key: "none", label: "No approved source", approved: false };
  const masterRows = buildRows(
    [
      { partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: null, masterId: "m1", coordinatorLabel: "BK", paymentTerms: "30 days", clientMasterLinked: true, transactions: [] },
      { partyName: "Beta Corp", debit: null, credit: null, outstanding: null, collectionPerson: null, masterId: "m2", coordinatorLabel: null, paymentTerms: null, transactions: [] },
    ],
    [],
  );

  it("shows each company's Sales coordinator label, or Unassigned", () => {
    render(<CollectionTracker rows={masterRows} connected storageReady today={TODAY} transactionSource={NO_SOURCE} />);
    expect(screen.getByRole("columnheader", { name: /Sales coordinator/i })).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Alpha Traders" }).closest("tr")!).getByText("BK")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Beta Corp" }).closest("tr")!).getByText("Unassigned")).toBeTruthy();
  });

  it("a click shows the name, coordinator and payment terms, with no transaction text while no source is approved", () => {
    render(<CollectionTracker rows={masterRows} connected storageReady today={TODAY} transactionSource={NO_SOURCE} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Alpha Traders" })).toBeTruthy();
    expect(within(dialog).getByText("Sales coordinator").nextSibling!.textContent).toBe("BK");
    expect(within(dialog).getByText("Payment terms").nextSibling!.textContent).toBe("30 days");
    // The popup carries no transaction section or placeholder text until there are transactions to show.
    expect(within(dialog).queryByText(NO_TRANSACTION_SOURCE_MESSAGE)).toBeNull();
    expect(within(dialog).queryByRole("region", { name: "Transactions" })).toBeNull();
    expect(dialog.textContent).not.toMatch(/transaction/i);
    // No amount is shown for a company whose figures nobody supplied.
    expect(within(dialog).getByText("Debit amount").nextSibling!.textContent).toBe("—");
    expect(within(dialog).queryByText(/₹/)).toBeNull();
    // Everything else is still there: figures note, follow-up form and history.
    expect(within(dialog).getByText(/can't be edited here/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Next follow-up date/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Save follow-up" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "History" })).toBeTruthy();
  });

  it("with an approved source, the company's transactions (and their overdue badges) still show in the popup", () => {
    const withTx = buildRows(
      [
        {
          partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: null, masterId: "m1",
          transactions: [{ id: "t1", collectionMasterId: "m1", reference: "INV-1", amount: 500, outstanding: 500, dueDate: "2026-10-10", status: null }],
        },
        { partyName: "Beta Corp", debit: null, credit: null, outstanding: null, collectionPerson: null, masterId: "m2", transactions: [] },
      ],
      [],
    );
    render(<CollectionTracker rows={withTx} connected storageReady today={TODAY} transactionSource={{ key: "test", label: "Test", approved: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    let dialog = screen.getByRole("dialog");
    const tx = within(dialog).getByRole("region", { name: "Transactions" });
    expect(within(tx).getByText("INV-1")).toBeTruthy();
    expect(within(tx).getByText("Overdue 3 days")).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
    // A company with none shows no transaction section or placeholder either.
    fireEvent.click(screen.getByRole("button", { name: "Beta Corp" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("region", { name: "Transactions" })).toBeNull();
    expect(dialog.textContent).not.toMatch(/No transactions from/);
  });

  it("an unassigned company with no terms says so plainly", () => {
    render(<CollectionTracker rows={masterRows} connected storageReady today={TODAY} transactionSource={NO_SOURCE} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta Corp" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Sales coordinator").nextSibling!.textContent).toBe("Unassigned");
    expect(within(dialog).getByText("Payment terms").nextSibling!.textContent).toBe("Not given");
  });

  it("with no transaction source no row is highlighted", () => {
    render(<CollectionTracker rows={masterRows} connected storageReady today={TODAY} transactionSource={NO_SOURCE} />);
    const levels = screen.getAllByRole("row").slice(1).map((r) => r.getAttribute("data-overdue"));
    expect(levels).toEqual(["none", "none"]);
    expect(screen.queryByText(/Overdue/)).toBeNull();
  });

  it("highlights from an approved source's due dates: yellow at 2 days, red at 3+, none when settled", () => {
    const tx = (id: string, dueDate: string | null, status: string | null = null, outstanding: number | null = 100) => ({
      id, collectionMasterId: id, reference: `INV-${id}`, amount: 100, outstanding, dueDate, status,
    });
    const withTx = buildRows(
      [
        { partyName: "Two Days", debit: null, credit: null, outstanding: null, collectionPerson: null, transactions: [tx("a", "2026-10-11")] },
        { partyName: "Three Days", debit: null, credit: null, outstanding: null, collectionPerson: null, transactions: [tx("b", "2026-10-10", "Partially paid", 40)] },
        { partyName: "Settled", debit: null, credit: null, outstanding: null, collectionPerson: null, transactions: [tx("c", "2026-09-01", "Paid")] },
        { partyName: "No Due Date", debit: null, credit: null, outstanding: null, collectionPerson: null, transactions: [tx("d", null)] },
      ],
      [],
    );
    render(<CollectionTracker rows={withTx} connected storageReady today={TODAY} transactionSource={{ key: "test", label: "Test", approved: true }} />);
    const level = (name: string) => screen.getByRole("button", { name }).closest("tr")!.getAttribute("data-overdue");
    expect(level("Two Days")).toBe("warning");
    expect(level("Three Days")).toBe("critical");
    expect(level("Settled")).toBe("none");
    expect(level("No Due Date")).toBe("none");
    // Colour is never the only signal.
    expect(within(screen.getByRole("button", { name: "Two Days" }).closest("tr")!).getByText("Overdue 2 days")).toBeTruthy();
  });

  it("says how many zero-balance companies the loader left out, and nothing when none were", () => {
    const { unmount } = render(<CollectionTracker rows={masterRows} connected storageReady today={TODAY} transactionSource={NO_SOURCE} hiddenZeroBalance={3} />);
    const note = screen.getByLabelText("Companies not listed");
    expect(note.textContent).toMatch(/^3 companies with ₹0 Debit and ₹0 Credit in the latest upload aren't listed\./);
    expect(note.textContent).toMatch(/stay in the Collection Master/);
    expect(screen.getAllByRole("row")).toHaveLength(3); // the listed companies are unaffected
    unmount();
    render(<CollectionTracker rows={masterRows} connected storageReady today={TODAY} transactionSource={NO_SOURCE} />);
    expect(screen.queryByLabelText("Companies not listed")).toBeNull();
  });

  it("shows the loader's reason when the master is empty or not set up", () => {
    render(<CollectionTracker rows={[]} connected={false} storageReady today={TODAY} emptyMessage={MASTER_NOT_READY_MESSAGE} />);
    expect(screen.getByText(MASTER_NOT_READY_MESSAGE)).toBeTruthy();
  });
});
