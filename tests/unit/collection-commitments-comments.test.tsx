// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// Collection Tracker comments next to commitments. Session, queries and server
// actions are MOCKED: these check which comments go with which company, the
// order and empty cases, and that nothing new reaches non-owners.
const GRANTED = "granted@example.test";
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  claims: null as null | { email?: string; email_verified?: boolean },
  followUps: { storageReady: true, entries: [] as unknown[] },
  listFollowUps: vi.fn(),
  listCommitments: vi.fn(),
  getCommitment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
// The person explicitly granted collection.commitments.view in the permission matrix (no one else).
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => (h.me?.email === GRANTED ? { "collection.commitments.view": { allowed: true, source: "employee" } } : {}),
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: () => h.listFollowUps() }));
vi.mock("@/lib/queries/collection-commitments", () => ({ listOwnerCommitments: (...a: unknown[]) => h.listCommitments(...a) }));
vi.mock("@/lib/collections/load", () => ({ loadTransactionsByMaster: async () => new Map(), loadCollectionParties: async () => ({ connected: true, parties: [] }) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  listOpenEscalationsForReview: async () => ({ storageReady: true, rows: [] }),
}));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({ saveFollowUp: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({
  getCompanyCommitment: (...a: unknown[]) => h.getCommitment(...a),
  saveCompanyCommitment: vi.fn(),
}));

import { buildRows, commentsOf, followUpsByParty, partyKey, type FollowUpEntry } from "@/lib/collections/derive";
import { CollectionTracker } from "@/components/collections/collection-tracker";
import { CommitmentsTable, filterCommitments, type CommitmentView } from "@/components/collections/commitments-table";

const fu = (id: string, partyName: string, note: string | null, iso: string, next: string | null = null, by = "Asha"): FollowUpEntry => ({
  id,
  partyName,
  note,
  nextFollowupDate: next,
  createdByName: by,
  createdAt: new Date(iso),
});
const ENTRIES = [
  fu("a1", "Alpha Traders", "First call — will pay next week", "2026-10-10T06:00:00Z"),
  fu("a2", " alpha traders ", "Cheque promised", "2026-10-15T06:00:00Z"),
  fu("a3", "Alpha Traders", null, "2026-10-16T06:00:00Z", "2026-10-25"), // date-only entry: not a comment
  fu("b1", "Beta Corp", "Disputed invoice 114", "2026-10-12T06:00:00Z", null, "Ravi"),
];

beforeEach(() => {
  h.me = null;
  h.claims = null;
  h.listFollowUps.mockReset().mockImplementation(async () => h.followUps);
  h.followUps = { storageReady: true, entries: ENTRIES };
  h.listCommitments.mockReset();
  h.getCommitment.mockReset().mockResolvedValue({ ok: true, storageReady: true, commitment: { amount: "125000.00", committedDate: "2026-11-05", recordedAt: new Date() } });
});
afterEach(cleanup);

describe("which comments belong to which company (the Tracker's own rule)", () => {
  it("groups by party name ignoring case and spaces, most recent first; comments are the entries with a note", () => {
    const by = followUpsByParty(ENTRIES);
    expect(by.get(partyKey("Alpha Traders"))!.map((e) => e.id)).toEqual(["a3", "a2", "a1"]);
    expect(commentsOf(by.get(partyKey("Alpha Traders"))!).map((e) => e.id)).toEqual(["a2", "a1"]);
    expect(commentsOf(by.get(partyKey("Beta Corp"))!).map((e) => e.note)).toEqual(["Disputed invoice 114"]);
    expect(by.get(partyKey("Gamma Ltd"))).toBeUndefined();
  });
  it("buildRows (Tracker) gives the same history as before", () => {
    const [row] = buildRows([{ partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: null }], ENTRIES);
    expect(row!.history.map((e) => e.id)).toEqual(["a3", "a2", "a1"]);
    expect(row!.nextFollowupDate).toBe("2026-10-25");
  });
});

// ── popup ─────────────────────────────────────────────────────────────────────
const COMPANY = "11111111-1111-4111-8111-111111111111";
const trackerRows = buildRows(
  [
    { partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: "Mihir", masterId: COMPANY, transactions: [] },
    { partyName: "Gamma Ltd", debit: null, credit: null, outstanding: null, collectionPerson: null, masterId: "33333333-3333-4333-8333-333333333333", transactions: [] },
  ],
  ENTRIES,
);

describe("company popup", () => {
  it("the owner sees that company's Tracker comments beside the committed amount and date", async () => {
    render(<CollectionTracker rows={trackerRows} connected storageReady today="2026-10-19" canSeeCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const section = await screen.findByRole("region", { name: "Commitment" });
    await within(section).findByText("₹1,25,000");
    const list = within(section).getByLabelText("Tracker comments for Alpha Traders, newest first");
    expect(list.textContent).toBe("15-Oct — Cheque promised10-Oct — First call — will pay next week");
    expect(list.textContent).not.toMatch(/Disputed invoice/); // another company's comment
    expect(h.getCommitment).toHaveBeenCalledTimes(1); // comments came with the row — no extra fetch
  });

  it("a company with no comments shows a dash", async () => {
    render(<CollectionTracker rows={trackerRows} connected storageReady today="2026-10-19" canSeeCommitments />);
    fireEvent.click(screen.getByRole("button", { name: "Gamma Ltd" }));
    const section = await screen.findByRole("region", { name: "Commitment" });
    expect(within(section).getByText("Tracker comments").nextSibling!.textContent).toBe("—");
  });

  it("a non-owner gets no commitment section (and no commitment fetch); the existing History is unchanged", () => {
    render(<CollectionTracker rows={trackerRows} connected storageReady today="2026-10-19" />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("region", { name: "Commitment" })).toBeNull();
    expect(h.getCommitment).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Cheque promised")).toBeTruthy(); // History, as before
    expect(within(dialog).queryByText(/₹1,25,000/)).toBeNull();
  });

  it("the Tracker's Comments column is unchanged", () => {
    render(<CollectionTracker rows={trackerRows} connected storageReady today="2026-10-19" />);
    const alpha = screen.getByRole("button", { name: "Alpha Traders" }).closest("tr")!;
    expect(within(alpha).getByLabelText("Comments, newest first").textContent).toBe("15-Oct — Cheque promised10-Oct — First call — will pay next week");
  });
});

// ── owner page ────────────────────────────────────────────────────────────────
vi.mock("@/components/collections/commitments-table", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, CommitmentsTable: Object.assign((p: unknown) => (real.CommitmentsTable as (x: unknown) => unknown)(p), { displayName: "CommitmentsTable" }) };
});
function findProps(node: ReactNode, name: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  const t = el.type as { name?: string; displayName?: string };
  if (typeof el.type === "function" && (t.displayName === name || t.name === name)) return el.props;
  const kids = el.props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const f = findProps(k as ReactNode, name);
    if (f) return f;
  }
  return null;
}
const commitment = (companyId: string, companyName: string, collectionPerson: string | null) => ({
  companyId,
  companyName,
  amount: "50000.00",
  committedDate: "2026-11-05",
  recordedAt: new Date(),
  collectionPerson,
});

describe("commitments page (collection.commitments.view)", () => {
  const asOwner = () => {
    h.me = { id: "emp-granted", email: GRANTED, isActive: true, isAdmin: true, name: "Granted" };
  };

  it("attaches each company's own comments, most recent first; none → empty list", async () => {
    asOwner();
    h.listCommitments.mockResolvedValue({ storageReady: true, rows: [commitment("c1", "Alpha Traders", "Mihir"), commitment("c2", "Beta Corp", "Ravi"), commitment("c3", "Gamma Ltd", null)] });
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const rows = findProps(await Page(), "CommitmentsTable")!.rows as CommitmentView[];
    expect(rows.map((r) => [r.companyName, r.comments.map((c) => c.note)])).toEqual([
      ["Alpha Traders", ["Cheque promised", "First call — will pay next week"]],
      ["Beta Corp", ["Disputed invoice 114"]],
      ["Gamma Ltd", []],
    ]);
    // Only note, time and author travel — not the party name or other fields.
    expect(Object.keys(rows[0]!.comments[0]!).sort()).toEqual(["createdAt", "createdByName", "id", "note"]);
  });

  it("says so when follow-up storage isn't set up, and still shows commitments", async () => {
    asOwner();
    h.followUps = { storageReady: false, entries: [] };
    h.listCommitments.mockResolvedValue({ storageReady: true, rows: [commitment("c1", "Alpha Traders", "Mihir")] });
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const tree = await Page();
    expect(JSON.stringify(tree)).toMatch(/Tracker comments aren.+t available yet/);
    expect((findProps(tree, "CommitmentsTable")!.rows as CommitmentView[])[0]!.comments).toEqual([]);
  });

  it("is still not found without the capability, and reads neither commitments nor comments", async () => {
    h.me = { id: "emp-x", email: "other@example.test", isActive: true, isAdmin: true, name: "Other" };
    h.claims = { email: "other@example.test", email_verified: true };
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listCommitments).not.toHaveBeenCalled();
    expect(h.listFollowUps).not.toHaveBeenCalled();
  });
});

describe("owner's table", () => {
  const views: CommitmentView[] = [
    { ...commitment("c1", "Alpha Traders", "Mihir"), comments: [{ id: "a2", note: "Cheque promised", createdAt: new Date("2026-10-15T06:00:00Z"), createdByName: "Asha" }] },
    { ...commitment("c3", "Gamma Ltd", null), comments: [] },
  ];
  it("shows a Comments column with the company's comments, and a dash when there are none", () => {
    render(<CommitmentsTable rows={views} today="2026-10-19" />);
    expect(screen.getByRole("columnheader", { name: "Comments" })).toBeTruthy();
    expect(screen.getByLabelText("Comments for Alpha Traders, newest first").textContent).toBe("15-Oct — Cheque promised");
    const gamma = screen.getByText("Gamma Ltd").closest("tr")!;
    expect(gamma.lastElementChild!.textContent).toBe("—");
  });
  it("search also finds comment text, like the Tracker's search", () => {
    expect(filterCommitments(views, "cheque", "").map((r) => r.companyId)).toEqual(["c1"]);
    expect(filterCommitments(views, "gamma", "").map((r) => r.companyId)).toEqual(["c3"]);
  });
});
