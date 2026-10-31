// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// The Tracker's Comments column, end to end on the client, plus the page's server-side gate:
//   - only the latest comment of EACH company is shown in full in its row (no inner scroll box);
//   - "See all comments" (more than one) opens that company's complete history;
//   - exactly one → that one, no button; none → "No comments yet";
//   - a refresh after adding / editing shows the new state; companies never mix;
//   - without collection.view the page refuses before any comment is read.
// The comments come with the page (the server loads every follow-up once); nothing is fetched when the dialog opens.
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  caps: new Set<string>(),
  listFollowUps: vi.fn(),
  edit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("server-only", () => ({}));
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: async () => ({
    connected: true,
    parties: [
      { partyName: "Alpha Traders", masterId: "m-a", debit: null, credit: null, outstanding: null, collectionPerson: null, coordinatorLabel: null, transactions: [] },
      { partyName: "Beta Corp", masterId: "m-b", debit: null, credit: null, outstanding: null, collectionPerson: null, coordinatorLabel: null, transactions: [] },
    ],
  }),
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: (...a: unknown[]) => h.listFollowUps(...a) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  openEscalations: async () => ({ storageReady: true, byCompany: new Map() }),
}));
vi.mock("@/lib/queries/collection-master", () => ({ listCoordinatorOptions: async () => null, isMissingTable: () => false }));
vi.mock("@/lib/queries/collection-setup", () => ({ capabilityHolders: async () => null }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ editFollowUpComment: h.edit, saveFollowUp: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn() }));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, type FollowUpEntry } from "@/lib/collections/derive";

const TODAY = "2026-10-28";
/** A comment saved at the given UTC instant. */
const c = (id: string, party: string, iso: string, over: Partial<FollowUpEntry> = {}): FollowUpEntry => ({
  id, partyName: party, nextFollowupDate: null, note: `${party} note ${id}`, createdById: "emp-1", createdByName: "Asha", createdAt: new Date(iso), ...over,
});
const PARTIES = ["Alpha Traders", "Beta Corp", "Gamma Ltd", "Delta Co"].map((partyName) => ({ partyName, debit: null, credit: null, outstanding: null, collectionPerson: null }));
// Alpha: 7 comments, given out of order and on the SAME day at different minutes (ordering must use the full timestamp).
const ALPHA = [
  c("a3", "Alpha Traders", "2026-10-27T05:03:00Z"),
  c("a7", "Alpha Traders", "2026-10-27T05:07:00Z"),
  c("a1", "Alpha Traders", "2026-10-27T05:01:00Z", { nextFollowupDate: "2026-12-31" }),
  c("a5", "Alpha Traders", "2026-10-27T05:05:00Z"),
  c("a6", "Alpha Traders", "2026-10-27T05:06:00Z"),
  c("a2", "Alpha Traders", "2026-10-27T05:02:00Z"),
  c("a4", "Alpha Traders", "2026-10-27T05:04:00Z"),
];
const BETA = [c("b2", "Beta Corp", "2026-10-26T06:00:00Z"), c("b1", "Beta Corp", "2026-10-25T06:00:00Z")]; // fewer than five
const GAMMA = [c("g1", "Gamma Ltd", "2026-10-20T06:00:00Z", { note: null, nextFollowupDate: "2026-11-01" })]; // a date-only entry is not a comment
const rowsOf = (entries: FollowUpEntry[]) => buildRows(PARTIES, entries);
const renderTracker = (entries: FollowUpEntry[], extra: Record<string, unknown> = {}) =>
  render(<CollectionTracker rows={rowsOf(entries)} connected storageReady today={TODAY} {...extra} />);
const row = (name: string) => screen.getByRole("button", { name }).closest("tr")!;
const notesIn = (el: Element) => [...el.textContent!.matchAll(/note (\w\d)/g)].map((m) => m[1]);

afterEach(cleanup);
beforeEach(() => {
  h.me = null;
  h.caps = new Set();
  h.listFollowUps.mockReset().mockResolvedValue({ storageReady: true, entries: [] });
  h.edit.mockReset();
  h.refresh.mockReset();
});

describe("the latest comment of each company, directly in its row", () => {
  it("exactly one — the newest by full timestamp — visible; the count says how many there are in all", () => {
    renderTracker([...ALPHA, ...BETA, ...GAMMA]);
    const alpha = row("Alpha Traders");
    expect(notesIn(alpha)).toEqual(["a7"]);
    expect(alpha.querySelectorAll('[data-comment-audit="compact"]')).toHaveLength(1);
    expect(within(alpha).getByText("Latest of 7")).toBeTruthy();
    const list = within(alpha).getByLabelText("Comments, newest first");
    expect(list.className).not.toMatch(/max-h-/); // no height cap
    // Two comments: the newest in the row, the count and the button for the rest.
    const beta = row("Beta Corp");
    expect(notesIn(beta)).toEqual(["b2"]);
    expect(within(beta).getByText("Latest of 2")).toBeTruthy();
    expect(within(beta).getByRole("button", { name: "See all 2 comments for Beta Corp" })).toBeTruthy();
  });

  it("the same for the signed-in author's view: one comment, one Edit button", () => {
    renderTracker([...ALPHA], { canWriteFollowUps: true, commentEditorId: "emp-1" });
    const alpha = row("Alpha Traders");
    expect(notesIn(alpha)).toEqual(["a7"]);
    expect(within(alpha).getAllByRole("button", { name: /Edit your comment/ })).toHaveLength(1);
    expect(within(alpha).getByLabelText("Comments, newest first").className).not.toMatch(/max-h-/);
  });

  it("exactly one comment: it is shown, with no 'See all comments' and no count", () => {
    renderTracker([...ALPHA, BETA[0]!]);
    const beta = row("Beta Corp");
    expect(notesIn(beta)).toEqual(["b2"]);
    expect(within(beta).queryByRole("button", { name: /See all/ })).toBeNull();
    expect(within(beta).queryByText(/Latest/)).toBeNull();
  });

  it("no comments (none, or only date-only follow-ups): a clear empty state", () => {
    renderTracker([...GAMMA]);
    for (const name of ["Gamma Ltd", "Delta Co"]) {
      expect(within(row(name)).getByText("No comments yet")).toBeTruthy();
      expect(within(row(name)).queryByRole("button", { name: /See all/ })).toBeNull();
    }
  });

  it("companies never mix: every row shows only its own company's comments", () => {
    renderTracker([...ALPHA, ...BETA, ...GAMMA]);
    expect(row("Alpha Traders").textContent).not.toMatch(/Beta Corp note/);
    expect(row("Beta Corp").textContent).not.toMatch(/Alpha Traders note/);
  });
});

describe("See all comments", () => {
  it("opens that company's complete history at once — all seven, newest first, nothing fetched", () => {
    renderTracker([...ALPHA, ...BETA]);
    fireEvent.click(within(row("Alpha Traders")).getByRole("button", { name: "See all 7 comments for Alpha Traders" }));
    const dialog = screen.getByRole("dialog", { name: "All comments" });
    const list = within(dialog).getByRole("list", { name: "All comments for Alpha Traders, newest first" });
    expect(notesIn(list)).toEqual(["a7", "a6", "a5", "a4", "a3", "a2", "a1"]); // the latest once, then the rest, nothing repeated
    expect(dialog.textContent).not.toMatch(/Beta Corp/);
    expect(h.listFollowUps).not.toHaveBeenCalled();
    expect(h.edit).not.toHaveBeenCalled();
    // Closing returns to the single-comment row, unchanged.
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[1]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(notesIn(row("Alpha Traders"))).toEqual(["a7"]);
  });

  it("is enabled for every Tracker viewer — read-only or author — and is never disabled", () => {
    for (const extra of [{}, { canWriteFollowUps: true, commentEditorId: "emp-1" }, { canWriteFollowUps: false, commentEditorId: null }]) {
      renderTracker([...ALPHA], extra);
      const btn = within(row("Alpha Traders")).getByRole("button", { name: /See all 7 comments/ }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      cleanup();
    }
  });
});

describe("refresh after adding or editing a comment", () => {
  it("a newly added comment replaces the shown one and the count updates", () => {
    const view = renderTracker([...ALPHA]);
    view.rerender(<CollectionTracker rows={rowsOf([...ALPHA, c("a8", "Alpha Traders", "2026-10-28T09:00:00Z")])} connected storageReady today={TODAY} />);
    const alpha = row("Alpha Traders");
    expect(notesIn(alpha)).toEqual(["a8"]);
    expect(within(alpha).getByText("Latest of 8")).toBeTruthy();
  });

  it("an edit of the shown comment shows the new text in place (ordering is by when it was first saved), with the Edited mark", async () => {
    h.edit.mockResolvedValue({ ok: true });
    const view = renderTracker([...ALPHA], { canWriteFollowUps: true, commentEditorId: "emp-1" });
    fireEvent.click(within(row("Alpha Traders")).getByRole("button", { name: /Edit your comment/ })); // a7, the one shown
    fireEvent.change(screen.getByRole("textbox", { name: /Edit comment/ }), { target: { value: "Alpha Traders note a7 (corrected)" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(h.edit).toHaveBeenCalledWith({ id: "a7", expectedNote: "Alpha Traders note a7", note: "Alpha Traders note a7 (corrected)" });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    // the server's refreshed data:
    const edited = ALPHA.map((e) => (e.id === "a7" ? { ...e, note: "Alpha Traders note a7 (corrected)", editedAt: new Date("2026-10-28T10:00:00Z"), editedByName: "Asha" } : e));
    view.rerender(<CollectionTracker rows={rowsOf(edited)} connected storageReady today={TODAY} canWriteFollowUps commentEditorId="emp-1" />);
    const alpha = row("Alpha Traders");
    expect(notesIn(alpha)).toEqual(["a7"]);
    expect(alpha.textContent).toContain("Alpha Traders note a7 (corrected)");
    expect(within(alpha).getByText(/Edited 28-Oct-2026/)).toBeTruthy();
  });

  it("an older comment is still editable and deletable by its author from the full history", () => {
    renderTracker([...ALPHA], { canWriteFollowUps: true, commentEditorId: "emp-1" });
    fireEvent.click(within(row("Alpha Traders")).getByRole("button", { name: /See all 7 comments/ }));
    const dialog = screen.getByRole("dialog", { name: "All comments" });
    expect(within(dialog).getAllByRole("button", { name: /Edit your comment/ })).toHaveLength(7);
    expect(within(dialog).getAllByRole("button", { name: /Delete your comment/ })).toHaveLength(7);
    cleanup();
    // A reader without followup.write gets no Edit or Delete anywhere.
    renderTracker([...ALPHA]);
    fireEvent.click(within(row("Alpha Traders")).getByRole("button", { name: /See all 7 comments/ }));
    expect(screen.queryByRole("button", { name: /Edit your comment|Delete your comment/ })).toBeNull();
  });
});

describe("access — the page's server-side gate", () => {
  const findProps = (node: ReactNode, name: string): Record<string, unknown> | null => {
    if (!isValidElement(node)) return null;
    const el = node as ReactElement<Record<string, unknown>>;
    const type = el.type as { name?: string };
    if (typeof el.type === "function" && type.name === name) return el.props;
    const kids = el.props.children as ReactNode;
    for (const k of Array.isArray(kids) ? kids : [kids]) {
      const p = findProps(k, name);
      if (p) return p;
    }
    return null;
  };

  it("without collection.view the page refuses BEFORE any comment is read", async () => {
    h.me = { id: "emp-x", email: "x@example.test", isActive: true, isAdmin: true, name: "X" };
    h.caps = new Set(); // no collection.view
    const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
    await expect(Page()).rejects.toThrow(/Forbidden/);
    h.me = { ...h.me, isAdmin: false }; // a non-admin, even with the grant
    h.caps = new Set(["collection.view"]);
    await expect(Page()).rejects.toThrow(/Forbidden/);
    expect(h.listFollowUps).not.toHaveBeenCalled();
  });

  it("with collection.view, each company's row carries only its own comments; Edit only for followup.write holders", async () => {
    h.me = { id: "emp-1", email: "a@example.test", isActive: true, isAdmin: true, name: "Asha" };
    h.caps = new Set(["collection.view"]);
    h.listFollowUps.mockResolvedValue({ storageReady: true, entries: [...ALPHA, ...BETA] });
    const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
    let props = findProps(await Page(), "CollectionTracker")!;
    const rows = props.rows as { partyName: string; history: FollowUpEntry[] }[];
    expect(rows.find((r) => r.partyName === "Alpha Traders")!.history.every((e) => e.partyName === "Alpha Traders")).toBe(true);
    expect(rows.find((r) => r.partyName === "Beta Corp")!.history.map((e) => e.id).sort()).toEqual(["b1", "b2"]);
    expect(props.commentEditorId).toBeNull();
    h.caps = new Set(["collection.view", "collection.followup.write"]);
    props = findProps(await Page(), "CollectionTracker")!;
    expect(props.commentEditorId).toBe("emp-1");
  });
});
