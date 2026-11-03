// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// MARK AS PRIORITY / COLLECTION DONE in the Collection Tracker's UI: the Status filter chip, the three groups and
// their styling, the per-row ⋯ menu and the bulk bar (checkboxes, "N selected", Priority / Status), confirmation
// before COLLECTION DONE, one request at a time, toasts and refresh — and nothing of it for someone without the
// capabilities (the server decides; flags are passed down). The server action is mocked.
vi.setConfig({ testTimeout: 30_000 });
const h = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), setMarks: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/scorecard-actions", () => ({ getScorecardEscalations: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: (o: unknown) => h.toast(o) }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), setConfirmedAmount: vi.fn(), escalateForReview: vi.fn(), assignSalesCoordinator: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn(), closeEscalation: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/marks-actions", () => ({ setCompanyMarks: (...a: unknown[]) => h.setMarks(...a) }));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, type PartyRow } from "@/lib/collections/derive";
import type { CompanyMarks } from "@/lib/collections/marks";
import type { CollectionParty } from "@/lib/collections/source";

// Radix menus measure with ResizeObserver, which jsdom lacks.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const TODAY = "2026-11-03";
const at = new Date("2026-11-01T06:00:00Z");
const mark = (p: boolean, d: boolean): CompanyMarks => ({ priority: p ? { setAt: at, setByName: "Asha" } : null, done: d ? { setAt: at, setByName: "Ravi" } : null });
const ID: Record<string, string> = {
  Alpha: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  Bravo: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  Charlie: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  Delta: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  Echo: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};
const party = (name: string, debit: number, person: string): CollectionParty => ({ partyName: name, debit, credit: 0, outstanding: null, collectionPerson: person, coordinatorLabel: person, masterId: ID[name], transactions: [] });
const MARKS: Record<string, CompanyMarks | null> = { Alpha: null, Bravo: mark(true, false), Charlie: mark(false, true), Delta: mark(true, true), Echo: null };
const rows: PartyRow[] = buildRows([party("Alpha", 100, "BK"), party("Bravo", 200, "SV"), party("Charlie", 300, "BK"), party("Delta", 400, "SV"), party("Echo", 500, "BK")], []).map((r) => ({ ...r, marks: MARKS[r.partyName] }));

const bodyRows = () => screen.getAllByRole("row").slice(1);
const names = () => bodyRows().map((tr) => within(tr).getAllByRole("button")[0]!.textContent);
const rowOf = (name: string) => bodyRows().find((tr) => tr.textContent?.includes(name))!;
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });
const menuItem = async (name: string) => screen.findByRole("menuitem", { name });
const tracker = (over: Partial<React.ComponentProps<typeof CollectionTracker>> = {}) => render(<CollectionTracker rows={rows} connected storageReady today={TODAY} {...over} />);
const both = { canSetPriority: true, canSetDone: true };

beforeEach(() => {
  h.refresh.mockReset();
  h.toast.mockReset();
  h.setMarks.mockReset().mockResolvedValue({ ok: true, updated: 1, skipped: 0 });
});
afterEach(cleanup);

describe("groups, styling and the Status filter (for every Tracker user)", () => {
  it("priority on top (yellow, badge), pending in the middle, done at the bottom (faded, badge); both-marked = done", () => {
    tracker();
    // Badges sit in the first cell next to the name button; the name button's own text is the company only.
    expect(names()).toEqual(["Bravo", "Alpha", "Echo", "Charlie", "Delta"]);
    const bravo = rowOf("Bravo");
    expect(bravo.getAttribute("data-mark-state")).toBe("priority");
    expect(bravo.style.background).toMatch(/254, 249, 195|#FEF9C3/i);
    expect(within(bravo).getByText("Priority").closest("[data-mark]")!.getAttribute("data-mark")).toBe("priority");
    const delta = rowOf("Delta");
    expect(delta.getAttribute("data-mark-state")).toBe("done");
    expect(delta.style.opacity).toBe("0.6");
    expect(within(delta).getByText("Collection done")).toBeTruthy();
    expect(within(delta).queryByText("Priority")).toBeNull(); // done takes precedence
    expect(rowOf("Alpha").getAttribute("data-mark-state")).toBe("pending");
    expect(within(rowOf("Alpha")).queryByText(/Priority|Collection done/)).toBeNull();
  });

  it("sorting by a column reorders within the groups only", () => {
    tracker();
    fireEvent.click(screen.getByRole("button", { name: "Debit" }));
    fireEvent.click(screen.getByRole("button", { name: "Debit" })); // desc
    expect(names()).toEqual(["Bravo", "Echo", "Alpha", "Delta", "Charlie"]);
  });

  it("the Status chip narrows to one group and works together with Collection person and the search", () => {
    tracker();
    const status = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(status.closest(".filter-chip")).toBeTruthy();
    expect([...status.options].map((o) => o.textContent)).toEqual(["All status", "Priority", "Pending", "Collection done"]);
    fireEvent.change(status, { target: { value: "done" } });
    expect(names()).toEqual(["Charlie", "Delta"]);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "SV" } });
    expect(names()).toEqual(["Delta"]);
    fireEvent.change(status, { target: { value: "pending" } });
    expect(screen.getByText("No parties match these filters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "ech" } });
    expect(names()).toEqual(["Echo"]);
    expect(screen.getByLabelText("Follow-up").closest(".filter-chip")).toBeTruthy();
  });

  it("without either capability there are no checkboxes, no bulk bar and no row menus — the marks still show", () => {
    tracker();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(document.querySelectorAll('[data-mark="done"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-mark="priority"]')).toHaveLength(1);
  });
});

describe("the row menu", () => {
  it("offers only what the viewer may do: priority entries with collection.priority.set, done entries with collection.done.set", async () => {
    tracker({ canSetPriority: true });
    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    expect(await menuItem("Mark as priority")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Collection done" })).toBeNull();
    cleanup();
    tracker({ canSetDone: true });
    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    expect(await menuItem("Collection done")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Mark as priority" })).toBeNull();
  });

  it("Mark as priority sends that one company, then toasts and refreshes", async () => {
    tracker(both);
    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    fireEvent.click(await menuItem("Mark as priority"));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Alpha], kind: "priority", active: true }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Marked 1 company as priority.", type: "success" }));
  });

  it("a priority row offers Remove priority; a done row offers Undo collection done (and not Mark as priority)", async () => {
    tracker(both);
    openMenu(screen.getByRole("button", { name: "Actions for Bravo" }));
    fireEvent.click(await menuItem("Remove priority"));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Bravo], kind: "priority", active: false }));
    openMenu(screen.getByRole("button", { name: "Actions for Delta" }));
    expect(await menuItem("Undo collection done")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Mark as priority" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Remove priority" })).toBeTruthy(); // its lingering priority mark can be cleared
    fireEvent.click(screen.getByRole("menuitem", { name: "Undo collection done" }));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Delta], kind: "done", active: false }));
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Undid collection done for 1 company." }));
  });

  it("Collection done asks first: Cancel sends nothing; confirming sends it", async () => {
    tracker(both);
    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    fireEvent.click(await menuItem("Collection done"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mark collection done?")).toBeTruthy();
    expect(within(dialog).getByText("Alpha")).toBeTruthy();
    expect(h.setMarks).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.setMarks).not.toHaveBeenCalled();

    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    fireEvent.click(await menuItem("Collection done"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, collection done" }));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Alpha], kind: "done", active: true }));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Marked 1 company as collection done." }));
  });

  it("an error from the server is shown and nothing refreshes; a thrown request too", async () => {
    h.setMarks.mockResolvedValueOnce({ ok: false, error: "The change could not be saved. Please try again." });
    tracker(both);
    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    fireEvent.click(await menuItem("Mark as priority"));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    expect(h.refresh).not.toHaveBeenCalled();
    h.setMarks.mockRejectedValueOnce(new Error("network"));
    openMenu(screen.getByRole("button", { name: "Actions for Echo" }));
    fireEvent.click(await menuItem("Mark as priority"));
    await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(2));
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("before migration 0125 the menus are disabled and the page says why", () => {
    tracker({ ...both, marksStorageReady: false });
    expect((screen.getByRole("button", { name: "Actions for Alpha" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(/migration 0125/);
  });
});

describe("selection and the bulk bar", () => {
  it("ticking rows shows 'N selected' with the chips the viewer may use; Clear empties it", async () => {
    tracker({ canSetPriority: true });
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Echo" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByTestId("selected-count").textContent).toBe("2");
    expect(within(bar).getByRole("button", { name: "Priority" })).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: "Status" })).toBeNull(); // no collection.done.set
    expect(rowOf("Alpha").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("the header checkbox ticks every SHOWN company (the filtered list), and untick all", () => {
    tracker(both);
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "BK" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown companies" }));
    expect(screen.getByTestId("selected-count").textContent).toBe("3");
    fireEvent.change(screen.getByLabelText("Collection person"), { target: { value: "" } });
    expect(screen.getByTestId("selected-count").textContent).toBe("3"); // SV companies were never ticked
    expect(screen.getByRole("checkbox", { name: "Select all shown companies" }).getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown companies" }));
    expect(screen.getByTestId("selected-count").textContent).toBe("5");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown companies" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("Priority → Mark as priority sends every ticked company at once and clears the selection", async () => {
    h.setMarks.mockResolvedValue({ ok: true, updated: 2, skipped: 1 });
    tracker(both);
    for (const n of ["Alpha", "Bravo", "Echo"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select ${n}` }));
    openMenu(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Priority" }));
    fireEvent.click(await menuItem("Mark as priority"));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Alpha, ID.Bravo, ID.Echo], kind: "priority", active: true }));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Marked 2 companies as priority. 1 skipped (already in that state, or not in your scope)." }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull());
    expect(h.refresh).toHaveBeenCalled();
  });

  it("Status → Collection done lists the companies and asks first; Undo collection done runs at once", async () => {
    tracker(both);
    for (const n of ["Alpha", "Echo"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select ${n}` }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    openMenu(within(bar).getByRole("button", { name: "Status" }));
    fireEvent.click(await menuItem("Collection done"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("2 companies")).toBeTruthy();
    expect(within(dialog).getByRole("list", { name: "Companies to mark" }).textContent).toBe("AlphaEcho");
    expect(h.setMarks).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, mark 2 done" }));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Alpha, ID.Echo], kind: "done", active: true }));

    cleanup();
    h.setMarks.mockClear();
    tracker(both);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Charlie" }));
    openMenu(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Status" }));
    fireEvent.click(await menuItem("Undo collection done"));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledWith({ companyIds: [ID.Charlie], kind: "done", active: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only one request at a time: a second click while one is in flight sends nothing", async () => {
    let release!: (v: { ok: true; updated: number; skipped: number }) => void;
    h.setMarks.mockImplementationOnce(() => new Promise((r) => (release = r)));
    tracker(both);
    openMenu(screen.getByRole("button", { name: "Actions for Alpha" }));
    fireEvent.click(await menuItem("Mark as priority"));
    await waitFor(() => expect(h.setMarks).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Actions for Echo" }) as HTMLButtonElement).disabled).toBe(true);
    release({ ok: true, updated: 1, skipped: 0 });
    await waitFor(() => expect((screen.getByRole("button", { name: "Actions for Echo" }) as HTMLButtonElement).disabled).toBe(false));
    expect(h.setMarks).toHaveBeenCalledTimes(1);
  });

  it("ticking a row does not open the company popup", () => {
    tracker(both);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
