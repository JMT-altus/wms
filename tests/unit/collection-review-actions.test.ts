import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Server-side rules for confirmation, escalation and closing — called DIRECTLY,
// without the UI. Session, grants (the permission matrix's resolved decisions),
// loader and queries are MOCKED; the real SQL is covered in
// tests/integration/collection-review.db.test.ts and the real grant resolution
// in tests/integration/collection-permissions.db.test.ts.
const COMPANY = "11111111-1111-4111-8111-111111111111";
const ESCALATION = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  /** collectionPerson of the one listed party (null = unassigned). */
  person: "MANGESH" as string | null,
  holders: vi.fn(),
  admin: true as boolean,
  me: { id: "emp-asha", email: "asha@example.test", isActive: true, isAdmin: true, name: "Asha" } as Record<string, unknown> | null,
  /** The capabilities the current request holds. */
  caps: new Set<string>(),
  outstanding: 125000 as number | null,
  listed: true,
  recordConfirmation: vi.fn(),
  escalateCompany: vi.fn(),
  closeEscalationById: vi.fn(),
  listOpen: vi.fn(),
  listCommitments: vi.fn(),
  latest: vi.fn(),
  open: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error("Forbidden");
    return h.me;
  },
  getCurrentEmployee: async () => (h.me ? { ...h.me, isAdmin: h.admin } : null),
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: async () => ({
    connected: true,
    parties: h.listed
      ? [{ partyName: "Alpha Traders", masterId: COMPANY, outstanding: h.outstanding, debit: null, credit: null, collectionPerson: h.person, coordinatorLabel: h.person, transactions: [] }]
      : [],
  }),
  loadTransactionsByMaster: async () => new Map(),
}));
vi.mock("@/lib/queries/collection-review", () => ({
  recordConfirmation: (...a: unknown[]) => h.recordConfirmation(...a),
  escalateCompany: (...a: unknown[]) => h.escalateCompany(...a),
  closeEscalationById: (...a: unknown[]) => h.closeEscalationById(...a),
  listOpenEscalationsForReview: (...a: unknown[]) => h.listOpen(...a),
  latestConfirmations: (...a: unknown[]) => h.latest(...a),
  openEscalations: (...a: unknown[]) => h.open(...a),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: (e: string | null | undefined) => e === "super@example.test" }));
vi.mock("@/lib/queries/collection-setup", () => ({ capabilityHolders: (...a: unknown[]) => h.holders(...a) }));
vi.mock("@/lib/queries/collection-commitments", () => ({ listOwnerCommitments: (...a: unknown[]) => h.listCommitments(...a) }));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: [] }) }));
vi.mock("@/components/collections/commitments-table", () => ({ CommitmentsTable: () => null }));
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));

import { escalateForReview, setCollectionConfirmation } from "@/app/(forms-module)/forms/collection/actions";
import { closeEscalation } from "@/app/(forms-module)/forms/collection/commitments/actions";

const missing = Object.assign(new Error("relation does not exist"), { code: "42P01" });
const proof = (employeeId: string, capability: string) => ({ employeeId, capability });

beforeEach(() => {
  h.person = "MANGESH";
  h.holders.mockReset().mockResolvedValue({ "collection.escalation.review": { people: 0, orgWide: false }, "collection.coordinator.assign": { people: 0, orgWide: false } });
  h.admin = true;
  h.me = { id: "emp-asha", email: "asha@example.test", isActive: true, isAdmin: true, name: "Asha" };
  // An ordinary admin: the ordinary Collection operations by the admin default, nothing sensitive.
  h.caps = new Set(["collection.view", "collection.confirmation.set", "collection.escalation.create", "collection.followup.write", "collection.master.import"]);
  h.outstanding = 125000;
  h.listed = true;
  for (const f of [h.recordConfirmation, h.escalateCompany, h.closeEscalationById, h.listOpen, h.listCommitments, h.latest, h.open]) f.mockReset();
  h.escalateCompany.mockResolvedValue({ ok: true, escalationId: ESCALATION });
  h.closeEscalationById.mockResolvedValue(true);
  h.latest.mockResolvedValue({ storageReady: true, byCompany: new Map() });
  h.open.mockResolvedValue({ storageReady: true, byCompany: new Map() });
  h.listOpen.mockResolvedValue({ storageReady: true, rows: [] });
  h.listCommitments.mockResolvedValue({ storageReady: true, rows: [] });
});

describe("setCollectionConfirmation (collection.confirmation.set)", () => {
  it("non-admins, and admins without the capability, are refused before anything happens", async () => {
    h.admin = false;
    await expect(setCollectionConfirmation({ companyId: COMPANY, value: "yes" })).rejects.toThrow("Forbidden");
    h.admin = true;
    h.caps.delete("collection.confirmation.set");
    await expect(setCollectionConfirmation({ companyId: COMPANY, value: "yes" })).rejects.toThrow("Forbidden");
    expect(h.recordConfirmation).not.toHaveBeenCalled();
  });

  it("accepts only yes/no and never trusts a client-supplied actor", async () => {
    for (const bad of [{ companyId: COMPANY, value: "maybe" }, { companyId: COMPANY, value: "" }, { companyId: COMPANY }, { companyId: "x", value: "yes" }, { companyId: COMPANY, value: "yes", recordedById: "someone-else" }]) {
      expect((await setCollectionConfirmation(bad)).ok).toBe(false);
    }
    expect(h.recordConfirmation).not.toHaveBeenCalled();
  });

  it("saves Yes or No for a listed company, recorded as the signed-in employee", async () => {
    expect(await setCollectionConfirmation({ companyId: COMPANY, value: "no" })).toEqual({ ok: true });
    expect(await setCollectionConfirmation({ companyId: COMPANY, value: "yes" })).toEqual({ ok: true });
    expect(h.recordConfirmation.mock.calls).toEqual([
      [proof("emp-asha", "collection.confirmation.set"), COMPANY, "no"],
      [proof("emp-asha", "collection.confirmation.set"), COMPANY, "yes"],
    ]);
  });

  it("is unavailable when the approved source supplies no outstanding amount — nothing is saved", async () => {
    h.outstanding = null;
    const res = await setCollectionConfirmation({ companyId: COMPANY, value: "yes" });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/no outstanding amount from an approved transaction source/) });
    expect(h.recordConfirmation).not.toHaveBeenCalled();
  });

  it("refuses a company the Collection Master doesn't list, and reports missing storage plainly", async () => {
    h.listed = false;
    expect((await setCollectionConfirmation({ companyId: COMPANY, value: "yes" })).ok).toBe(false);
    h.listed = true;
    h.recordConfirmation.mockRejectedValue(missing);
    expect(await setCollectionConfirmation({ companyId: COMPANY, value: "yes" })).toEqual({ ok: false, error: expect.stringMatching(/migration 0115 is pending/) });
  });
});

describe("escalateForReview (collection.escalation.create)", () => {
  it("refused without the capability, before anything happens", async () => {
    h.admin = false;
    await expect(escalateForReview({ companyId: COMPANY })).rejects.toThrow("Forbidden");
    h.admin = true;
    h.caps.delete("collection.escalation.create");
    await expect(escalateForReview({ companyId: COMPANY })).rejects.toThrow("Forbidden");
    expect(h.escalateCompany).not.toHaveBeenCalled();
  });

  it("escalates a listed company as the signed-in employee — even with no outstanding amount (no commitment is created)", async () => {
    h.outstanding = null;
    expect(await escalateForReview({ companyId: COMPANY })).toEqual({ ok: true });
    expect(h.escalateCompany).toHaveBeenCalledWith(proof("emp-asha", "collection.escalation.create"), COMPANY);
  });

  it("a second escalation while one is open is refused with a neutral message (no reviewer named)", async () => {
    h.escalateCompany.mockResolvedValue({ ok: false, reason: "already-open" });
    const res = await escalateForReview({ companyId: COMPANY });
    expect(res).toEqual({ ok: false, error: "This company already has an open escalation awaiting review. Nothing new was created." });
  });

  it("refuses unknown companies and extra fields, and reports missing storage", async () => {
    h.listed = false;
    expect((await escalateForReview({ companyId: COMPANY })).ok).toBe(false);
    h.listed = true;
    expect((await escalateForReview({ companyId: COMPANY, escalatedById: "x" })).ok).toBe(false);
    h.escalateCompany.mockRejectedValue(missing);
    expect(await escalateForReview({ companyId: COMPANY })).toEqual({ ok: false, error: expect.stringMatching(/migration 0115 is pending/) });
  });
});

describe("closeEscalation (collection.escalation.close)", () => {
  it("an admin without it — even one who may review — is Forbidden before any database call", async () => {
    await expect(closeEscalation({ escalationId: ESCALATION })).rejects.toThrow("Forbidden");
    h.caps.add("collection.escalation.review"); // reviewing doesn't imply closing
    await expect(closeEscalation({ escalationId: ESCALATION })).rejects.toThrow("Forbidden");
    expect(h.closeEscalationById).not.toHaveBeenCalled();
  });

  it("a holder closes an open escalation as themselves; an already-closed one says so", async () => {
    h.caps.add("collection.escalation.close");
    expect(await closeEscalation({ escalationId: ESCALATION })).toEqual({ ok: true });
    expect(h.closeEscalationById).toHaveBeenCalledWith(proof("emp-asha", "collection.escalation.close"), ESCALATION);
    h.closeEscalationById.mockResolvedValue(false);
    expect(await closeEscalation({ escalationId: ESCALATION })).toEqual({ ok: false, error: "That escalation is already closed or no longer exists." });
    expect((await closeEscalation({ escalationId: "nope" })).ok).toBe(false);
  });

  it("revocation applies to the next call", async () => {
    h.caps.add("collection.escalation.close");
    expect(await closeEscalation({ escalationId: ESCALATION })).toEqual({ ok: true });
    h.caps.delete("collection.escalation.close");
    await expect(closeEscalation({ escalationId: ESCALATION })).rejects.toThrow("Forbidden");
    expect(h.closeEscalationById).toHaveBeenCalledTimes(1);
  });
});

// ── page payloads ─────────────────────────────────────────────────────────────
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

describe("pages", () => {
  it("Tracker: every Tracker user sees the confirmation and open-escalation status, never commitment data", async () => {
    h.latest.mockResolvedValue({ storageReady: true, byCompany: new Map([[COMPANY, { value: "no", recordedAt: new Date("2026-10-19T05:00:00Z"), recordedByName: "Asha" }]]) });
    h.open.mockResolvedValue({ storageReady: true, byCompany: new Map([[COMPANY, { id: ESCALATION, companyId: COMPANY, escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: "no" }]]) });
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    const props = findProps(await Page(), "CollectionTracker")!;
    const row = (props.rows as Record<string, unknown>[])[0]!;
    expect(row.confirmation).toEqual({ value: "no", recordedAt: new Date("2026-10-19T05:00:00Z"), recordedByName: "Asha" });
    expect(row.openEscalation).toEqual({ escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha" });
    expect(props.canSeeCommitments).toBe(false);
    expect(props).toMatchObject({ canSetConfirmation: true, canEscalate: true, canWriteFollowUps: true, canEditCommitments: false });
    expect(props.reviewStorageReady).toBe(true);
    expect(JSON.stringify(props.rows)).not.toMatch(/committed|commitment/i);
  });

  it("Tracker: without collection.view the page is refused before anything is loaded", async () => {
    h.caps.delete("collection.view");
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    await expect(Page()).rejects.toThrow("Forbidden");
    expect(h.latest).not.toHaveBeenCalled();
  });

  it("a reviewer (any holder — nobody is named) sees escalated companies, with no commitment data read or shown", async () => {
    h.caps.add("collection.escalation.review");
    h.listOpen.mockResolvedValue({
      storageReady: true,
      rows: [{ id: ESCALATION, companyId: COMPANY, companyName: "Alpha Traders", collectionPerson: "MANGESH", escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: null }],
    });
    h.latest.mockResolvedValue({ storageReady: true, byCompany: new Map([[COMPANY, { value: "yes", recordedAt: new Date(), recordedByName: "Asha" }]]) });
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const props = findProps(await Page(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: false, showEscalations: true, canClose: false });
    expect(h.listCommitments).not.toHaveBeenCalled();
    expect(props.rows).toEqual([
      expect.objectContaining({
        companyId: COMPANY,
        companyName: "Alpha Traders",
        collectionPerson: "MANGESH",
        amount: null,
        committedDate: null,
        confirmation: "yes",
        outstanding: 125000,
        escalation: { id: ESCALATION, escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: null },
      }),
    ]);
  });

  it("commitments-view only: commitments are read, escalations are not", async () => {
    h.caps.add("collection.commitments.view");
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const props = findProps(await Page(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: true, showEscalations: false });
    expect(h.listCommitments).toHaveBeenCalledWith(proof("emp-asha", "collection.commitments.view"));
    expect(h.listOpen).not.toHaveBeenCalled();
  });

  it("the page is not found without commitments.view or escalation.review (admins included), and reads nothing", async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listOpen).not.toHaveBeenCalled();
    expect(h.listCommitments).not.toHaveBeenCalled();
  });

  // ── reviewer discoverability, setup notice, and the review page's states ───────
  const OPEN_ONE = () => h.open.mockResolvedValue({ storageReady: true, byCompany: new Map([[COMPANY, { id: ESCALATION, companyId: COMPANY, escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: null }]]) });
  const trackerProps = async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/tracker/page");
    return findProps(await Page(), "CollectionTracker")!;
  };
  const asSuperAdmin = () => {
    h.me = { id: "emp-super", email: "super@example.test", isActive: true, isAdmin: true, name: "Super" };
  };

  it("Tracker: a holder of escalation.review gets the review-queue link with the open count; everyone else gets none", async () => {
    OPEN_ONE();
    h.caps.add("collection.escalation.review");
    expect((await trackerProps()).reviewQueue).toEqual({ openCount: 1, href: "/forms/collection/commitments" });
    h.caps.delete("collection.escalation.review");
    expect((await trackerProps()).reviewQueue).toBeUndefined();
  });

  it("Tracker: a super-admin is told which grant is missing when escalations or unassigned parties wait for nobody", async () => {
    OPEN_ONE();
    h.person = null;
    asSuperAdmin();
    const props = await trackerProps();
    expect((props.setupHints as { id: string }[]).map((x) => x.id)).toEqual(["collection.escalation.review", "collection.coordinator.assign"]);
    expect(props.setupHref).toBe("/master-setup/access-control");
    // They are told; nothing is granted.
    expect(h.caps.has("collection.escalation.review")).toBe(false);
    expect(props.reviewQueue).toBeUndefined(); // super-admin status alone doesn't give the review queue either
  });

  it("Tracker: no setup notice once someone holds the capability, when nothing is waiting, or if the grants can't be read", async () => {
    asSuperAdmin();
    OPEN_ONE();
    h.person = null;
    h.holders.mockResolvedValue({ "collection.escalation.review": { people: 1, orgWide: false }, "collection.coordinator.assign": { people: 0, orgWide: true } });
    expect((await trackerProps()).setupHints).toEqual([]);
    h.holders.mockResolvedValue(null);
    expect((await trackerProps()).setupHints).toEqual([]);
    h.holders.mockResolvedValue({ "collection.escalation.review": { people: 0, orgWide: false }, "collection.coordinator.assign": { people: 0, orgWide: false } });
    h.open.mockResolvedValue({ storageReady: true, byCompany: new Map() });
    h.person = "MANGESH";
    expect((await trackerProps()).setupHints).toEqual([]);
  });

  it("Tracker: a non-super-admin never gets the setup notice, and the grants aren't even read", async () => {
    OPEN_ONE();
    h.person = null;
    h.caps.add("collection.escalation.review");
    const props = await trackerProps();
    expect(props.setupHints).toEqual([]);
    expect(props.setupHref).toBeUndefined();
    expect(h.holders).not.toHaveBeenCalled();
  });

  it("Review page: an escalated party is listed for every reviewer regardless of the reviewer's own coordinator label", async () => {
    h.caps.add("collection.escalation.review");
    h.person = "Someone Else"; // the reviewer's label never filters the queue
    h.listOpen.mockResolvedValue({
      storageReady: true,
      rows: [{ id: ESCALATION, companyId: COMPANY, companyName: "Alpha Traders", collectionPerson: "MANGESH", escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha", confirmationAtEscalation: null }],
    });
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const rows = findProps(await Page(), "CommitmentsTable")!.rows as { companyName: string; escalation: { id: string } | null }[];
    expect(rows.map((r) => [r.companyName, r.escalation?.id])).toEqual([["Alpha Traders", ESCALATION]]);
  });

  it("Review page: a reviewer with an empty queue is told what empty means; a commitments-only viewer is told theirs", async () => {
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    h.caps.add("collection.escalation.review");
    expect(findProps(await Page(), "CommitmentsTable")!.emptyMessage).toMatch(/No escalations are waiting for review\. When someone escalates a party/);
    h.caps.delete("collection.escalation.review");
    h.caps.add("collection.commitments.view");
    expect(findProps(await Page(), "CommitmentsTable")!.emptyMessage).toMatch(/No commitments recorded yet/);
  });

  it("Review page: a failed load shows a clear error panel — no table, no details, no crash", async () => {
    h.caps.add("collection.escalation.review");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.listOpen.mockRejectedValue(new Error("password authentication failed for user secret-db-user"));
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const tree = await Page();
    expect(findProps(tree, "CommitmentsTable")).toBeNull();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/could not be loaded.*Nothing has been changed/);
    expect(html).toContain("Collection Escalations"); // the page still says where you are
    expect(html + JSON.stringify(err.mock.calls)).not.toMatch(/secret-db-user|password authentication/);
    // The same for the second stage (details for the listed companies).
    h.listOpen.mockResolvedValue({ storageReady: true, rows: [{ id: ESCALATION, companyId: COMPANY, companyName: "Alpha Traders", collectionPerson: null, escalatedAt: new Date(), escalatedByName: null, confirmationAtEscalation: null }] });
    h.latest.mockRejectedValue(new Error("boom"));
    const second = await Page();
    expect(renderToStaticMarkup(second as ReactElement)).toContain('role="alert"');
    err.mockRestore();
  });

  it("Review page: still not found without a view/review capability, and reads nothing", async () => {
    h.caps = new Set(["collection.view"]);
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listOpen).not.toHaveBeenCalled();
  });
});
