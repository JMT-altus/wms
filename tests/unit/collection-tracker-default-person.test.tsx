// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Collection Tracker's starting Collection person filter. A viewer who may see EVERY company (scope "all") but is
// linked to a Sales Coordinator label through the super-admin-kept link opens the Tracker on their OWN companies —
// the filter starts on their label, shown as "<label> (you)" — while "All collection persons" and every other
// coordinator stay available. An all-scope viewer with no link, and a linked coordinator (who already sees only
// their own companies), are unchanged. Decided on the server from the verified session and the link; nobody is named.
// Session, grants, scope, the link and the loaders are mocked (the real scope SQL is in
// tests/integration/collection-tracker-scope.db.test.ts).
// The whole Tracker page renders per test: allow for a busy machine (the full suite running), as the other large Tracker UI tests do.
vi.setConfig({ testTimeout: 30_000 });
const h = vi.hoisted(() => ({
  me: { id: "emp-1", email: "someone@example.test", isActive: true, isAdmin: true, name: "Someone" },
  scope: { kind: "all" } as { kind: "all" } | { kind: "coordinator"; label: string },
  /** The link: a label, or null (not configured). */
  label: null as string | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => h.scope }));
vi.mock("@/lib/auth/module-access", () => ({ canAccessModule: async () => true, requireModuleAccess: async () => h.me }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/current", () => ({ getCurrentEmployee: async () => h.me, requireAdmin: async () => h.me }));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => ({ "collection.view": { allowed: true, source: "employee" } }),
  getFieldAccessFor: async () => ({}),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: () => h.scope.kind === "all" }));
vi.mock("@/lib/collections/salesperson-identity", () => ({
  salespersonIdentityFor: async () => (h.label === null ? { status: "unconfigured" } : { status: "linked", label: h.label }),
}));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: async () => ({
    connected: true,
    transactions: { key: "none", label: "No approved source", approved: false },
    parties: [
      { partyName: "Alpha", masterId: "m-a", coordinatorLabel: "Gauri", collectionPerson: "Gauri", debit: 500, credit: 0, outstanding: null, transactions: [] },
      { partyName: "Beta", masterId: "m-b", coordinatorLabel: "Gauri", collectionPerson: "Gauri", debit: 200, credit: 0, outstanding: null, transactions: [] },
      { partyName: "Gamma", masterId: "m-c", coordinatorLabel: "Savita", collectionPerson: "Savita", debit: 900, credit: 0, outstanding: null, transactions: [] },
      { partyName: "Delta", masterId: "m-d", coordinatorLabel: null, collectionPerson: null, debit: 100, credit: 0, outstanding: null, transactions: [] },
    ],
  }),
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: [] }) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmedAmounts: async () => ({ storageReady: true, byCompany: new Map() }),
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  openEscalations: async () => ({ storageReady: true, byCompany: new Map() }),
}));
vi.mock("@/lib/queries/collection-master", () => ({ listCoordinatorOptions: async () => null, isMissingTable: () => false }));
vi.mock("@/lib/queries/collection-setup", () => ({ capabilityHolders: async () => null }));
vi.mock("@/lib/queries/collection-scorecards", () => ({ escalationCountsForSalesperson: async () => ({ escalated: 0, resolvedByReviewer: 0 }) }));
vi.mock("@/lib/queries/collection-marks", () => ({ activeMarks: async () => ({ storageReady: true, byCompany: new Map() }) }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), setConfirmedAmount: vi.fn(), escalateForReview: vi.fn(), assignSalesCoordinator: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn(), closeEscalation: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/scorecard-actions", () => ({ getScorecardEscalations: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/marks-actions", () => ({ setCompanyMarks: vi.fn() }));
vi.mock("@/components/collections/tracker-bulk-upload", () => ({ TrackerBulkUpload: () => <p>bulk upload form</p> }));

const page = async () => {
  const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
  render(await Page());
};
const person = () => screen.getByLabelText("Collection person") as HTMLSelectElement;
const names = () => screen.getAllByRole("row").slice(1).map((tr) => within(tr).getAllByRole("button")[0]!.textContent);
const options = () => [...person().options].map((o) => o.textContent);

beforeEach(() => {
  h.scope = { kind: "all" };
  h.label = null;
});
afterEach(cleanup);

describe("an all-scope viewer linked to a Sales Coordinator label", () => {
  beforeEach(() => {
    h.label = "Gauri";
  });

  it("opens on their OWN companies: the filter starts on their label, shown with their name, before anything is listed", async () => {
    await page();
    expect(person().value).toBe("Gauri");
    expect(person().selectedOptions[0]!.textContent).toBe("Gauri (you)");
    expect(names()).toEqual(["Alpha", "Beta"]);
    expect(screen.getByText("2 parties")).toBeTruthy();
  });

  it("keeps All collection persons and every other coordinator: all → everyone (once each); another person → theirs; back → own", async () => {
    await page();
    expect(options()).toEqual(["All collection persons", "Gauri (you)", "Savita", "Unassigned"]);
    fireEvent.change(person(), { target: { value: "" } });
    expect(names()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
    expect(new Set(names()).size).toBe(4);
    fireEvent.change(person(), { target: { value: "Savita" } });
    expect(names()).toEqual(["Gamma"]);
    fireEvent.change(person(), { target: { value: "Gauri" } });
    expect(names()).toEqual(["Alpha", "Beta"]);
  });

  it("search, sorting and the other filters work on top of the starting choice", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Debit" }));
    fireEvent.click(screen.getByRole("button", { name: "Debit" }));
    expect(names()).toEqual(["Alpha", "Beta"]); // 500 before 200, still only Gauri's
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "bet" } });
    expect(names()).toEqual(["Beta"]);
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "gam" } });
    expect(screen.getByText("No parties match these filters.")).toBeTruthy(); // Gamma is Savita's
    fireEvent.change(screen.getByLabelText("Search the tracker"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "done" } });
    expect(screen.getByText("No parties match these filters.")).toBeTruthy();
  });

  it("their label is offered and selected even when none of their companies is on the list", async () => {
    h.label = "Mihir";
    await page();
    expect(person().value).toBe("Mihir");
    expect(options()).toContain("Mihir (you)");
    expect(screen.getByText("No parties match these filters.")).toBeTruthy();
    fireEvent.change(person(), { target: { value: "" } });
    expect(names()).toHaveLength(4);
  });

  it("every page load starts on their own label again (no stored 'all')", async () => {
    await page();
    fireEvent.change(person(), { target: { value: "" } });
    expect(names()).toHaveLength(4);
    cleanup();
    await page();
    expect(person().value).toBe("Gauri");
    expect(names()).toEqual(["Alpha", "Beta"]);
  });
});

describe("everyone else is unchanged", () => {
  it("an all-scope viewer with no link starts on everyone", async () => {
    await page();
    expect(person().value).toBe("");
    expect(names()).toHaveLength(4);
    expect(options().some((o) => o?.includes("(you)"))).toBe(false);
  });

  it("a linked Sales Coordinator keeps the existing behaviour: the scope already limits the list, the filter starts on everyone it holds", async () => {
    h.scope = { kind: "coordinator", label: "Gauri" };
    h.label = "Gauri";
    await page();
    expect(person().value).toBe("");
    expect(options().some((o) => o?.includes("(you)"))).toBe(false);
    expect(screen.getByLabelText("Companies shown").textContent).toContain("assigned to you as Sales Coordinator (Gauri)");
  });
});
