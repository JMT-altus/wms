// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// The salesperson scorecard: ONLY the signed-in employee's own card, resolved on the server (salespersonIdentityFor) —
// other salespeople's figures are never computed or sent; each way the link can be absent (no link, link table not
// installed, read failure) gets its own safe empty state — a failure is never shown as a missing link; a single card;
// verified-only outstanding; the salesperson's own escalation figures; Bulk Upload kept. Session, grants and queries are
// mocked; the real escalation SQL is in tests/integration/collection-scorecards.db.test.ts.
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  caps: new Set<string>(),
  /** What the super-admin-kept link says the signed-in employee is: a label, "none" (not a Sales Coordinator) or null (not configured). */
  label: null as string | null,
  /** Simulates the link table being absent (migration 0120 not applied) or the read failing outright. */
  identity: "ok" as "ok" | "not-installed" | "throws",
  identityArgs: [] as unknown[],
  counts: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
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
  getFieldAccessFor: async () => ({}),
}));
vi.mock("@/lib/collections/salesperson-identity", () => ({
  salespersonIdentityFor: async (e: unknown) => {
    h.identityArgs.push(e);
    if (h.identity === "throws") throw Object.assign(new Error("secret connection detail: password=hunter2"), { cause: { code: "42501" } });
    if (h.identity === "not-installed") return { status: "not-installed" };
    if (!e || h.label === null) return { status: "unconfigured" };
    return h.label === "none" ? { status: "not-salesperson" } : { status: "linked", label: h.label };
  },
}));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: async () => ({
    connected: true,
    transactions: { key: "none", label: "No approved source", approved: false },
    parties: [
      { partyName: "Alpha", masterId: "m-a", coordinatorLabel: "Gauri", collectionPerson: "Gauri", debit: 500, credit: 500, outstanding: null, transactions: [] },
      { partyName: "Beta", masterId: "m-b", coordinatorLabel: "Gauri", collectionPerson: "Gauri", debit: null, credit: null, outstanding: null, transactions: [] },
      { partyName: "Secret Gamma", masterId: "m-c", coordinatorLabel: "Savita", collectionPerson: "Savita", debit: 9, credit: 0, outstanding: null, transactions: [] },
    ],
  }),
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: [] }) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  openEscalations: async () => ({ storageReady: true, byCompany: new Map() }),
}));
vi.mock("@/lib/queries/collection-master", () => ({ listCoordinatorOptions: async () => null, isMissingTable: () => false }));
vi.mock("@/lib/queries/collection-setup", () => ({ capabilityHolders: async () => null }));
vi.mock("@/lib/queries/collection-scorecards", () => ({ escalationCountsForSalesperson: (...a: unknown[]) => h.counts(...a) }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ editFollowUpComment: vi.fn(), deleteFollowUpComment: vi.fn(), saveFollowUp: vi.fn() }));
vi.mock("@/app/(collection-module)/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn() }));
vi.mock("@/components/collections/tracker-bulk-upload", () => ({ TrackerBulkUpload: () => <p>bulk upload form</p> }));

import { buildScorecards, formatInrTwoDecimals, scorecardFor, verifiedPaise, type EscalationCounts, type ScorecardView } from "@/lib/collections/scorecards";
import {
  NOT_INSTALLED_MESSAGE,
  NOT_SALESPERSON_MESSAGE,
  SCORECARD_LABELS,
  SOURCE_NOT_CONFIGURED,
  SalespersonScorecard,
  UNAVAILABLE_MESSAGE,
  UNMAPPED_MESSAGE,
} from "@/components/collections/salesperson-scorecards";
import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows } from "@/lib/collections/derive";

afterEach(cleanup);
beforeEach(() => {
  h.me = null;
  h.caps = new Set();
  h.label = null;
  h.identity = "ok";
  h.identityArgs = [];
  h.counts.mockReset();
  h.refresh.mockReset();
});

const p = (masterId: string, coordinatorLabel: string | null, outstanding: number | null = null) => ({ masterId, coordinatorLabel, outstanding });
const APPROVED = { approved: true };

describe("rules (unchanged calculations, now scoped to one salesperson)", () => {
  it("scorecardFor uses ONLY that salesperson's companies, counted by distinct id", () => {
    const card = scorecardFor("BK", [p("a", "BK"), p("a", "BK"), p("b", "BK"), p("c", "SV"), p("d", null)], { approved: false }, null);
    expect(card).toEqual({ salesperson: "BK", clients: 2, outstanding: { status: "not-configured" }, escalations: { status: "restricted" } });
  });

  it("a salesperson with no companies gets an empty card — never someone else's figures", () => {
    expect(scorecardFor("New", [p("c", "SV", 500)], APPROVED, { escalated: 0, resolvedByReviewer: 0 })).toEqual({
      salesperson: "New", clients: 0,
      outstanding: { status: "ok", clientsPending: 0, totalPaise: "0", verifiedClients: 0, unverifiedClients: 0 },
      escalations: { status: "ok", escalated: 0, resolvedByReviewer: 0 },
    });
  });

  it("approved source: verified figures only; pending = distinct clients with > ₹0; missing/null/NaN are never zero; other salespeople ignored", () => {
    const card = scorecardFor("BK", [p("a", "BK", 1234567), p("b", "BK", 0.5), p("c", "BK", 0), p("d", "BK", -300), p("e", "BK", null), p("f", "BK", Number.NaN), p("z", "SV", 999999)], APPROVED, null);
    expect(card.outstanding).toEqual({ status: "ok", clientsPending: 2, totalPaise: "123456750", verifiedClients: 4, unverifiedClients: 2 });
  });

  it("no approved source: 'not configured', even if a party carries a number", () => {
    expect(scorecardFor("BK", [p("a", "BK", 0)], { approved: false }, null).outstanding).toEqual({ status: "not-configured" });
  });

  it("escalations: restricted (null), unavailable (error) or the salesperson's own counts", () => {
    expect(scorecardFor("BK", [p("a", "BK")], undefined, "error").escalations).toEqual({ status: "unavailable" });
    expect(scorecardFor("BK", [p("a", "BK")], undefined, { escalated: 3, resolvedByReviewer: 1 }).escalations).toEqual({ status: "ok", escalated: 3, resolvedByReviewer: 1 });
    const counts: EscalationCounts = new Map([["BK", { escalated: 3, resolvedByReviewer: 1 }]]);
    expect(buildScorecards([p("a", "BK")], undefined, counts)[0]!.escalations).toEqual({ status: "ok", escalated: 3, resolvedByReviewer: 1 });
  });

  it("money: Indian grouping, always two decimals, exact", () => {
    expect(formatInrTwoDecimals(123456700n)).toBe("₹12,34,567.00");
    expect(formatInrTwoDecimals("123456750")).toBe("₹12,34,567.50");
    expect(verifiedPaise(0.1 + 0.2)).toBe(30n);
    expect(verifiedPaise(undefined)).toBeNull();
  });
});

describe("the one card", () => {
  const ok = (card: ReturnType<typeof scorecardFor>): ScorecardView => ({ status: "ok", card });

  it("a single card (one section, no list of cards) with the four metrics and concise states", () => {
    const { container } = render(<SalespersonScorecard view={ok(scorecardFor("Gauri", [p("a", "Gauri")], { approved: false }, null))} />);
    const card = screen.getByRole("region", { name: "Your scorecard" });
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(container.querySelector("ul, li")).toBeNull();
    for (const l of Object.values(SCORECARD_LABELS)) expect(within(card).getByText(l)).toBeTruthy();
    expect(within(card).getAllByText(SOURCE_NOT_CONFIGURED)).toHaveLength(2);
    expect(within(card).getAllByText("Restricted")).toHaveLength(2);
    expect(card.textContent).toContain("Gauri1 assigned client");
    expect(card.textContent).not.toMatch(/₹0/);
  });

  it("bounded width, full width on phones; metrics one column on the narrowest screens, two from 400px", () => {
    render(<SalespersonScorecard view={ok(scorecardFor("Gauri", [p("a", "Gauri")], undefined, null))} />);
    const card = screen.getByRole("region", { name: "Your scorecard" });
    expect(card.className).toMatch(/\bw-full\b/);
    expect(card.className).toMatch(/sm:max-w-\[440px\]/);
    expect(card.querySelector("dl")!.className).toMatch(/grid-cols-1.*min-\[400px\]:grid-cols-2/);
  });

  it("with figures: counts, the formatted total and the unverified note; 'Couldn't be loaded' on error", () => {
    render(<SalespersonScorecard view={ok(scorecardFor("BK", [p("a", "BK", 1234567), p("b", "BK", null)], APPROVED, { escalated: 4, resolvedByReviewer: 3 }))} />);
    const card = screen.getByRole("region", { name: "Your scorecard" });
    expect(card.textContent).toContain("₹12,34,567.00");
    expect(card.textContent).toMatch(/Entries Escalated to Mihir Bhai4/);
    expect(card.textContent).toMatch(/Escalated Entries Solved by Mihir Bhai3/);
    expect(card.textContent).toContain("1 client has no verified balance (not counted).");
    cleanup();
    render(<SalespersonScorecard view={ok(scorecardFor("BK", [p("a", "BK")], undefined, "error"))} />);
    expect(screen.getAllByText("Couldn't be loaded")).toHaveLength(2);
  });

  it("unmapped: tells the user an administrator must configure the link; no figures at all", () => {
    render(<SalespersonScorecard view={{ status: "unmapped" }} />);
    expect(screen.getByRole("status").textContent).toBe(UNMAPPED_MESSAGE);
    expect(UNMAPPED_MESSAGE).toMatch(/administrator must link your login/);
    expect(screen.queryByRole("region", { name: "Your scorecard" })).toBeNull();
  });

  it("not a Sales Coordinator (admin/system login): says so; no figures", () => {
    render(<SalespersonScorecard view={{ status: "not-salesperson" }} />);
    expect(screen.getByRole("status").textContent).toBe(NOT_SALESPERSON_MESSAGE);
    expect(screen.queryByRole("region", { name: "Your scorecard" })).toBeNull();
  });

  it("link table not installed (migration 0120 missing): names the database update — NOT 'ask an admin to link you', which nobody could do yet", () => {
    render(<SalespersonScorecard view={{ status: "not-installed" }} />);
    const s = screen.getByRole("status");
    expect(s.textContent).toBe(NOT_INSTALLED_MESSAGE);
    expect(s.getAttribute("data-scorecard-state")).toBe("not-installed");
    expect(NOT_INSTALLED_MESSAGE).toMatch(/database update 0120/);
    expect(s.textContent).not.toBe(UNMAPPED_MESSAGE);
    expect(screen.queryByRole("region", { name: "Your scorecard" })).toBeNull();
  });

  it("link unreadable (a database error): says so plainly — never 'not linked' — and carries no error detail", () => {
    render(<SalespersonScorecard view={{ status: "unavailable" }} />);
    const s = screen.getByRole("status");
    expect(s.textContent).toBe(UNAVAILABLE_MESSAGE);
    expect(UNAVAILABLE_MESSAGE).toMatch(/not a missing link/);
    expect(UNAVAILABLE_MESSAGE).not.toMatch(/SQLSTATE|42|password|postgres/i);
    expect(screen.queryByRole("region", { name: "Your scorecard" })).toBeNull();
  });
});

describe("placement on the Tracker — Bulk Upload and party count kept", () => {
  const rows = buildRows([{ partyName: "Alpha", debit: null, credit: null, outstanding: null, collectionPerson: "Gauri", coordinatorLabel: "Gauri", masterId: "m-a" }], []);
  it("one card directly above the row with Bulk Upload and the party count, both still working", async () => {
    // Bulk Upload is rendered only for a holder of collection.balances.import.
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-28" canImportBalances scorecard={{ status: "ok", card: scorecardFor("Gauri", [p("m-a", "Gauri")], undefined, null) }} />);
    expect(screen.getAllByRole("region", { name: "Your scorecard" })).toHaveLength(1);
    const card = screen.getByRole("region", { name: "Your scorecard" });
    const bulk = screen.getByRole("button", { name: /Bulk Upload/ });
    expect(card.parentElement!.nextElementSibling).toBe(bulk.parentElement);
    expect(bulk.parentElement!.textContent).toContain("1 party");
    fireEvent.click(bulk);
    expect(await screen.findByText("bulk upload form")).toBeTruthy(); // the form is lazy-loaded
  });

  it("without a scorecard (older callers) nothing extra is rendered", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-28" />);
    expect(screen.queryByRole("region", { name: "Your scorecard" })).toBeNull();
  });
});

describe("the Tracker page — the server decides whose card, and sends only that one", () => {
  const findProps = (node: ReactNode, name: string): Record<string, unknown> | null => {
    if (!isValidElement(node)) return null;
    const el = node as ReactElement<Record<string, unknown>>;
    if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el.props;
    const kids = el.props.children as ReactNode;
    for (const k of Array.isArray(kids) ? kids : [kids]) {
      const r = findProps(k, name);
      if (r) return r;
    }
    return null;
  };
  const signIn = () => (h.me = { id: "emp-gauri", email: "g@example.test", isActive: true, isAdmin: true, name: "GR" });
  const page = async () => {
    const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
    return findProps(await Page(), "CollectionTracker")!;
  };

  it("without collection.view: refused before anything is read", async () => {
    signIn();
    const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
    await expect(Page()).rejects.toThrow(/Forbidden/);
    expect(h.counts).not.toHaveBeenCalled();
  });

  it("the identity is the verified session's employee — nothing from the request", async () => {
    signIn();
    h.caps = new Set(["collection.view"]);
    await page();
    expect(h.identityArgs).toEqual([h.me]);
  });

  it("an unmapped user gets the safe empty state — no card, and NO salesperson's figures are computed or sent", async () => {
    signIn();
    h.caps = new Set(["collection.view", "collection.escalation.review"]);
    const props = await page();
    expect(props.scorecard).toEqual({ status: "unmapped" });
    expect(h.counts).not.toHaveBeenCalled();
    expect(props).not.toHaveProperty("scorecards");
  });

  it("a login marked 'not a Sales Coordinator' (admin/system account) gets that state — not everyone's data, nothing computed", async () => {
    signIn();
    h.label = "none";
    h.caps = new Set(["collection.view", "collection.escalation.review"]); // even a reviewer
    const props = await page();
    expect(props.scorecard).toEqual({ status: "not-salesperson" });
    expect(h.counts).not.toHaveBeenCalled();
  });

  it("a mapped user gets exactly ONE card — their own, with THEIR escalation figures; another salesperson's label never appears in the scorecard payload", async () => {
    signIn();
    h.label = "Gauri";
    h.caps = new Set(["collection.view"]); // an ordinary salesperson, not the reviewer
    h.counts.mockResolvedValue({ escalated: 2, resolvedByReviewer: 1 });
    const props = await page();
    expect(props.scorecard).toEqual({ status: "ok", card: { salesperson: "Gauri", clients: 2, outstanding: { status: "not-configured" }, escalations: { status: "ok", escalated: 2, resolvedByReviewer: 1 } } });
    expect(JSON.stringify(props.scorecard)).not.toMatch(/Savita|Secret Gamma|m-c/);
    // Queried once, for THEIR label only, with the Tracker's own capability proof for the signed-in employee.
    expect(h.counts).toHaveBeenCalledTimes(1);
    expect(h.counts).toHaveBeenCalledWith(expect.objectContaining({ capability: "collection.view", employeeId: "emp-gauri" }), "Gauri");
  });

  it("a failing escalation query doesn't break the page: 'unavailable', and no details are logged", async () => {
    signIn();
    h.label = "Gauri";
    h.caps = new Set(["collection.view"]);
    h.counts.mockRejectedValue(new Error("secret connection detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const props = await page();
    expect(props.scorecard).toMatchObject({ card: { escalations: { status: "unavailable" } } });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret connection detail/);
    log.mockRestore();
  });

  it("link table not installed (0120 not applied): the 'not-installed' state — NOT 'unmapped' — and nothing is computed", async () => {
    signIn();
    h.identity = "not-installed";
    h.label = "Gauri"; // would be linked if the table existed; irrelevant without it
    h.caps = new Set(["collection.view"]);
    const props = await page();
    expect(props.scorecard).toEqual({ status: "not-installed" });
    expect(h.counts).not.toHaveBeenCalled();
  });

  it("the link read fails (any other database error): the 'unavailable' state — NOT 'unmapped'; the Tracker still loads; only the error code is logged", async () => {
    signIn();
    h.identity = "throws";
    h.caps = new Set(["collection.view"]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const props = await page();
    expect(props.scorecard).toEqual({ status: "unavailable" });
    expect(props.rows).toHaveLength(3); // the Tracker itself is unaffected
    expect(h.counts).not.toHaveBeenCalled();
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toMatch(/SQLSTATE 42501/);
    expect(logged).not.toMatch(/secret connection detail|hunter2/);
    log.mockRestore();
  });
});
