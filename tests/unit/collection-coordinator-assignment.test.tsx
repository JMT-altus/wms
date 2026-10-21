// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// Sales Coordinator assignment (collection.coordinator.assign — sensitive: an
// explicit grant only) — the server action called DIRECTLY, the Tracker page's
// payload, and the Tracker cell. Session, resolved grants and queries are
// MOCKED; the real SQL and grant rows are in
// tests/integration/collection-coordinator-assignment.db.test.ts.
const CO = "11111111-1111-4111-8111-111111111111";
const ORDINARY = ["collection.view", "collection.followup.write", "collection.confirmation.set", "collection.escalation.create", "collection.master.import"];
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  /** Capabilities the current request holds (what the permission matrix resolved). */
  caps: new Set<string>(),
  assign: vi.fn(),
  options: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
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
vi.mock("@/lib/queries/collection-master", () => ({
  isMissingTable: (e: { code?: string }) => e?.code === "42P01",
  assignCoordinatorLabel: (...a: unknown[]) => h.assign(...a),
  listCoordinatorOptions: (...a: unknown[]) => h.options(...a),
}));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: async () => ({
    connected: true,
    parties: [
      { partyName: "Alpha Traders", masterId: CO, debit: null, credit: null, outstanding: null, collectionPerson: null, coordinatorLabel: null, paymentTerms: "30 days", transactions: [] },
    ],
  }),
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: [] }) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  openEscalations: async () => ({ storageReady: true, byCompany: new Map() }),
}));

import { assignSalesCoordinator } from "@/app/(forms-module)/forms/collection/actions";
import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, type PartyRow } from "@/lib/collections/derive";

/** An admin granted collection.coordinator.assign explicitly in the permission matrix. */
const asGranted = () => {
  h.me = { id: "emp-granted", email: "granted@example.test", isActive: true, isAdmin: true, name: "Granted" };
  h.caps = new Set([...ORDINARY, "collection.coordinator.assign"]);
};
/** An admin with every ordinary Collection capability, but not this one. */
const asAdmin = () => {
  h.me = { id: "emp-asha", email: "asha@example.test", isActive: true, isAdmin: true, name: "Asha" };
  h.caps = new Set(ORDINARY);
};
const PROOF = { employeeId: "emp-granted", capability: "collection.coordinator.assign" };
const input = (over: Record<string, unknown> = {}) => ({ companyId: CO, coordinatorLabel: "MANGESH", expected: null, ...over });

beforeEach(() => {
  h.me = null;
  h.caps = new Set();
  h.assign.mockReset();
  h.options.mockReset();
  h.refresh.mockReset();
});
afterEach(cleanup);

describe("assignSalesCoordinator — server-side, called directly", () => {
  it("anyone without the explicit grant is Forbidden before any query runs (an admin with every ordinary capability, signed out, deactivated)", async () => {
    asAdmin();
    await expect(assignSalesCoordinator(input())).rejects.toThrow("Forbidden");
    h.me = null;
    await expect(assignSalesCoordinator(input())).rejects.toThrow("Forbidden");
    asGranted();
    h.me!.isActive = false;
    await expect(assignSalesCoordinator(input())).rejects.toThrow("Forbidden");
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("a revoked grant stops working on the next call", async () => {
    asGranted();
    h.assign.mockResolvedValue({ ok: true, changed: true, from: null, to: "MANGESH" });
    expect((await assignSalesCoordinator(input())).ok).toBe(true);
    h.caps.delete("collection.coordinator.assign");
    await expect(assignSalesCoordinator(input())).rejects.toThrow("Forbidden");
    expect(h.assign).toHaveBeenCalledTimes(1);
  });

  it("the grant alone isn't enough without admin (the Forms area is admin-only)", async () => {
    asGranted();
    h.me!.isAdmin = false;
    await expect(assignSalesCoordinator(input())).rejects.toThrow("Forbidden");
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("refuses a blank choice, a bad id and any extra field (e.g. a client-supplied actor) without a query", async () => {
    asGranted();
    expect(await assignSalesCoordinator(input({ coordinatorLabel: "   " }))).toEqual({ ok: false, error: "Choose a Sales Coordinator." });
    expect((await assignSalesCoordinator(input({ companyId: "nope" }))).ok).toBe(false);
    expect((await assignSalesCoordinator(input({ actorId: "emp-asha" }))).ok).toBe(false);
    expect((await assignSalesCoordinator({ companyId: CO, coordinatorLabel: "MANGESH" })).ok).toBe(false); // must say what it replaces
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("saves as the signed-in holder, with the cleaned label and the value the screen showed", async () => {
    asGranted();
    h.assign.mockResolvedValue({ ok: true, changed: true, from: null, to: "MANGESH" });
    expect(await assignSalesCoordinator(input({ coordinatorLabel: "  MANGESH " }))).toEqual({ ok: true, changed: true });
    expect(h.assign).toHaveBeenCalledWith(PROOF, { companyId: CO, coordinatorLabel: "MANGESH", expected: null });
  });

  it("reports each refusal plainly, and missing storage honestly", async () => {
    asGranted();
    for (const [reason, msg] of [
      ["not-found", /isn't in the Collection Master/],
      ["stale", /changed meanwhile/],
      ["unknown-label", /from the list/],
    ] as const) {
      h.assign.mockResolvedValueOnce({ ok: false, reason });
      expect(await assignSalesCoordinator(input())).toEqual({ ok: false, error: expect.stringMatching(msg) });
    }
    h.assign.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(await assignSalesCoordinator(input())).toEqual({ ok: false, error: expect.stringMatching(/migration 0112 is pending/) });
    h.assign.mockRejectedValueOnce(new Error("connection reset: secret details"));
    const res = await assignSalesCoordinator(input());
    expect(res).toEqual({ ok: false, error: "The Sales Coordinator could not be saved, so nothing was changed. Please try again." });
  });
});

// ── the Tracker page: only holders of the capability get an editor and the options ──
function findProps(node: ReactNode, name: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el.props;
  const kids = el.props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const f = findProps(k as ReactNode, name);
    if (f) return f;
  }
  return null;
}

describe("Tracker page payload", () => {
  it("other Tracker users get no editor, and the options aren't even read", async () => {
    asAdmin();
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    const props = findProps(await Page(), "CollectionTracker")!;
    expect(props.coordinatorEditor).toBeUndefined();
    expect(h.options).not.toHaveBeenCalled();
  });

  it("a holder gets the Collection Master's coordinators as the only options", async () => {
    asGranted();
    h.options.mockResolvedValue({ storageReady: true, labels: ["Gauri", "MANGESH"] });
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    const props = findProps(await Page(), "CollectionTracker")!;
    expect(props.coordinatorEditor).toEqual({ options: ["Gauri", "MANGESH"] });
  });
});

// ── the Tracker cell ──
const row = (person: string | null): PartyRow =>
  buildRows([{ partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: person, coordinatorLabel: person, masterId: CO, transactions: [] }], [])[0]!;
const renderTracker = (person: string | null, editor?: { options: string[] }) =>
  render(<CollectionTracker rows={[row(person)]} connected storageReady today="2026-10-21" coordinatorEditor={editor} />);
const select = () => screen.getByLabelText("Sales Coordinator for Alpha Traders") as HTMLSelectElement;

describe("Tracker Sales Coordinator cell", () => {
  it("other users see the coordinator (or Unassigned) as plain text — no dropdown, no Change", () => {
    renderTracker(null);
    expect(within(screen.getByRole("table")).getByText("Unassigned")).toBeTruthy();
    expect(screen.queryByLabelText("Sales Coordinator for Alpha Traders")).toBeNull();
    cleanup();
    renderTracker("MANGESH");
    expect(within(screen.getByRole("table")).getByText("MANGESH")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Change the Sales Coordinator/ })).toBeNull();
  });

  it("a holder picks for an Unassigned company; nothing is saved until Save, and there is no blank choice", async () => {
    asGranted(); // the cell calls the real action, which checks the session again
    h.assign.mockResolvedValue({ ok: true, changed: true, from: null, to: "Gauri" });
    renderTracker(null, { options: ["Gauri", "MANGESH"] });
    expect([...select().options].map((o) => [o.value, o.disabled])).toEqual([
      ["", true],
      ["Gauri", false],
      ["MANGESH", false],
    ]);
    const save = within(select().closest("td")!).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(select(), { target: { value: "Gauri" } });
    expect(h.assign).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.assign).toHaveBeenCalledWith(PROOF, { companyId: CO, coordinatorLabel: "Gauri", expected: null });
  });

  it("an assigned company shows its coordinator with Change; correcting sends the current value as expected", async () => {
    asGranted();
    h.assign.mockResolvedValue({ ok: false, reason: "stale" });
    renderTracker("MANGESH", { options: ["Gauri", "MANGESH"] });
    expect(within(screen.getByRole("table")).getByText("MANGESH")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change the Sales Coordinator for Alpha Traders" }));
    expect([...select().options].map((o) => o.value)).toEqual(["", "Gauri"]); // the current one isn't offered again
    fireEvent.change(select(), { target: { value: "Gauri" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/changed meanwhile/);
    expect(h.assign).toHaveBeenCalledWith(PROOF, expect.objectContaining({ coordinatorLabel: "Gauri", expected: "MANGESH" }));
    expect(h.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Sales Coordinator for Alpha Traders")).toBeNull();
  });
});
