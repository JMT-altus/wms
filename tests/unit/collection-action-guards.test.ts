import { beforeEach, describe, expect, it, vi } from "vitest";

// Every protected Collection server action and page, called DIRECTLY by an
// admin who lacks its capability: refused ("Forbidden", or "not found" for the
// restricted page) BEFORE any protected data is read or written. The database
// and every data loader are spies that must stay untouched. Session and
// resolved grants are MOCKED.
const { h, touch } = vi.hoisted(() => {
  const h = { caps: new Set<string>(), touched: [] as string[] };
  /** A stand-in for protected data: records the access and fails loudly. */
  const touch = (what: string) => () => {
    h.touched.push(what);
    throw new Error(`protected data accessed: ${what}`);
  };
  return { h, touch };
});

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
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => ({ id: "emp-asha", email: "asha@example.test", isActive: true, isAdmin: true, name: "Asha" }),
  requireAdmin: async () => ({ id: "emp-asha", email: "asha@example.test", isActive: true, isAdmin: true, name: "Asha" }),
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
// Any database use at all is a failure here.
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, prop) => touch(`db.${String(prop)}`) }),
}));
vi.mock("@/lib/collections/load", () => ({ loadCollectionParties: touch("loadCollectionParties"), loadTransactionsByMaster: touch("loadTransactionsByMaster") }));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: touch("listFollowUps") }));
vi.mock("@/lib/queries/collection-commitments", () => ({ getCommitment: touch("getCommitment"), recordCommitment: touch("recordCommitment"), listOwnerCommitments: touch("listOwnerCommitments") }));
vi.mock("@/lib/queries/collection-review", () => ({
  recordConfirmation: touch("recordConfirmation"),
  escalateCompany: touch("escalateCompany"),
  closeEscalationById: touch("closeEscalationById"),
  listOpenEscalationsForReview: touch("listOpenEscalationsForReview"),
  latestConfirmations: touch("latestConfirmations"),
  openEscalations: touch("openEscalations"),
}));
vi.mock("@/lib/queries/collection-master", () => ({
  isMissingTable: () => false,
  assignCoordinatorLabel: touch("assignCoordinatorLabel"),
  listCoordinatorOptions: touch("listCoordinatorOptions"),
  listMasterCompanies: touch("listMasterCompanies"),
  listRecentImports: touch("listRecentImports"),
  getMasterCompany: touch("getMasterCompany"),
  loadExistingByKeys: touch("loadExistingByKeys"),
  listKnownCoordinatorLabels: touch("listKnownCoordinatorLabels"),
  loadClientMasterIndex: touch("loadClientMasterIndex"),
  TRACKER_ASSIGNMENT_SOURCE: "tracker-assignment",
}));

// The pages' client components aren't under test (the guard runs before rendering); stubbed to keep imports fast.
vi.mock("@/components/collections/collection-dashboard", () => ({ CollectionDashboard: () => null }));
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));
vi.mock("@/components/collections/master/collection-master-import", () => ({ CollectionMasterImport: () => null }));
vi.mock("@/components/collections/commitments-table", () => ({ CommitmentsTable: () => null }));

import * as tracker from "@/app/(collection-module)/collection/actions";
import * as commitments from "@/app/(collection-module)/collection/commitments/actions";
import * as master from "@/app/(collection-module)/collection/master/actions";

const CO = "11111111-1111-4111-8111-111111111111";
const ALL = [
  "collection.view",
  "collection.master.import",
  "collection.followup.write",
  "collection.confirmation.set",
  "collection.escalation.create",
  "collection.coordinator.assign",
  "collection.commitments.view",
  "collection.commitments.edit",
  "collection.escalation.review",
  "collection.escalation.close",
];
const importBody = {
  mapping: { company: "Name", coordinator: null, paymentTerms: null },
  rows: [{ rowNo: 2, company: "Alpha", coordinator: "", paymentTerms: "" }],
};

/** [capability, call] — each call is made with every capability EXCEPT its own. */
const ACTIONS: [string, string, () => Promise<unknown>][] = [
  ["saveFollowUp", "collection.followup.write", () => tracker.saveFollowUp({ partyName: "Alpha", note: "x" })],
  ["setCollectionConfirmation", "collection.confirmation.set", () => tracker.setCollectionConfirmation({ companyId: CO, value: "yes" })],
  ["escalateForReview", "collection.escalation.create", () => tracker.escalateForReview({ companyId: CO })],
  ["assignSalesCoordinator", "collection.coordinator.assign", () => tracker.assignSalesCoordinator({ companyId: CO, coordinatorLabel: "X", expected: null })],
  ["previewCollectionMaster", "collection.master.import", () => master.previewCollectionMaster(importBody)],
  ["importCollectionMaster", "collection.master.import", () => master.importCollectionMaster({ ...importBody, confirm: true })],
  ["getCompanyCommitment", "collection.commitments.view", () => commitments.getCompanyCommitment(CO)],
  ["saveCompanyCommitment", "collection.commitments.edit", () => commitments.saveCompanyCommitment({ companyId: CO, amount: "5000", committedDate: "2026-11-05" })],
  ["closeEscalation", "collection.escalation.close", () => commitments.closeEscalation({ escalationId: CO })],
];

const PAGES: [string, string[], () => Promise<unknown>, RegExp][] = [
  ["tracker page", ["collection.view"], async () => (await import("@/app/(collection-module)/collection/tracker/page")).default(), /Forbidden/],
  ["dashboard page", ["collection.view"], async () => (await import("@/app/(collection-module)/collection/dashboard/page")).default(), /Forbidden/],
  ["master page", ["collection.view"], async () => (await import("@/app/(collection-module)/collection/master/page")).default({ searchParams: Promise.resolve({}) }), /Forbidden/],
  ["master company page", ["collection.view"], async () => (await import("@/app/(collection-module)/collection/master/[id]/page")).default({ params: Promise.resolve({ id: CO }) }), /Forbidden/],
  ["commitments & escalations page", ["collection.commitments.view", "collection.escalation.review"], async () => (await import("@/app/(collection-module)/collection/commitments/page")).default(), /NEXT_NOT_FOUND/],
];

beforeEach(() => {
  h.touched = [];
});

describe("protected actions, called directly without their capability", () => {
  it.each(ACTIONS)("%s needs %s — refused before any data access", async (_name, key, call) => {
    h.caps = new Set(ALL.filter((k) => k !== key));
    await expect(call()).rejects.toThrow("Forbidden");
    expect(h.touched).toEqual([]);
  });
});

describe("protected pages, without their capability", () => {
  it.each(PAGES)("%s — refused before anything is loaded", async (_name, keys, render, refusal) => {
    h.caps = new Set(ALL.filter((k) => !keys.includes(k)));
    await expect(render()).rejects.toThrow(refusal);
    expect(h.touched).toEqual([]);
  });
});
