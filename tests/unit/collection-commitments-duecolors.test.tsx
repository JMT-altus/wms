// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// The commitments page colours a company exactly as the Collection Tracker
// does: the transaction source's due dates through lib/collections/overdue.ts
// (2 days OVERDUE → yellow, 3+ → red, India business date). Session, queries
// and actions are MOCKED.
const GRANTED = "granted@example.test";
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  claims: null as null | { email?: string; email_verified?: boolean },
  listCommitments: vi.fn(),
  txByMaster: vi.fn(),
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
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: [] }) }));
vi.mock("@/lib/queries/collection-commitments", () => ({ listOwnerCommitments: (...a: unknown[]) => h.listCommitments(...a) }));
vi.mock("@/lib/collections/load", () => ({ loadTransactionsByMaster: (...a: unknown[]) => h.txByMaster(...a), loadCollectionParties: async () => ({ connected: true, parties: [] }) }));
vi.mock("@/lib/queries/collection-review", () => ({
  latestConfirmations: async () => ({ storageReady: true, byCompany: new Map() }),
  listOpenEscalationsForReview: async () => ({ storageReady: true, rows: [] }),
}));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({ saveFollowUp: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn() }));

import { CommitmentsTable, type CommitmentView } from "@/components/collections/commitments-table";
import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows } from "@/lib/collections/derive";
import type { OverdueInput } from "@/lib/collections/overdue";

const TODAY = "2026-10-19";
const row = (companyName: string, due: OverdueInput[] | undefined): CommitmentView => ({
  companyId: `id-${companyName}`,
  companyName,
  amount: "50000.00",
  committedDate: "2026-11-30", // the commitment date is NOT a due date and never colours a row
  recordedAt: new Date(),
  collectionPerson: "Mihir",
  comments: [],
  ...(due ? { due } : {}),
});
const levelOf = (name: string) => screen.getByText(name).closest("tr")!.getAttribute("data-overdue");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("owner page colours rows with the Tracker's rule", () => {
  const cases: [string, OverdueInput[] | undefined, "none" | "warning" | "critical"][] = [
    ["Two days overdue", [{ dueDate: "2026-10-17" }], "warning"],
    ["Three days overdue", [{ dueDate: "2026-10-16" }], "critical"],
    ["One day overdue", [{ dueDate: "2026-10-18" }], "none"],
    ["Four days overdue", [{ dueDate: "2026-10-15" }], "critical"],
    ["Due today", [{ dueDate: "2026-10-19" }], "none"],
    ["Due in two days", [{ dueDate: "2026-10-21" }], "none"],
    ["Due in three days", [{ dueDate: "2026-10-22" }], "none"],
    ["No due date", [{ dueDate: null }], "none"],
    ["Invalid due date", [{ dueDate: "2026-02-30" }], "none"],
    ["No transactions", [], "none"],
    ["No due data at all", undefined, "none"],
    ["Settled long ago", [{ dueDate: "2026-09-01", status: "Paid" }], "none"],
    ["Fully paid", [{ dueDate: "2026-09-01", outstanding: 0 }], "none"],
    ["Partly paid, balance left", [{ dueDate: "2026-10-17", status: "Partially paid", outstanding: 1200 }], "warning"],
    ["Worst of several", [{ dueDate: "2026-10-18" }, { dueDate: "2026-10-17" }, { dueDate: "2026-10-10" }], "critical"],
  ];

  it.each(cases)("%s → %s", (name, due, expected) => {
    render(<CommitmentsTable rows={[row(name, due)]} today={TODAY} />);
    expect(levelOf(name)).toBe(expected);
  });

  it("shows the same yellow/red tint, edge and 'Overdue N days' label as the Tracker", () => {
    render(<CommitmentsTable rows={[row("Two days overdue", [{ dueDate: "2026-10-17" }]), row("Three days overdue", [{ dueDate: "2026-10-16" }])]} today={TODAY} />);
    const yellow = screen.getByText("Two days overdue").closest("tr")!;
    const red = screen.getByText("Three days overdue").closest("tr")!;
    expect(yellow.style.background).toBe("rgb(255, 251, 235)"); // #FFFBEB
    expect(red.style.background).toBe("rgb(254, 242, 242)"); // #FEF2F2
    expect(within(yellow).getByText("Overdue 2 days")).toBeTruthy();
    expect(within(red).getByText("Overdue 3 days")).toBeTruthy();
  });

  it("gives exactly the Tracker's level for the same due facts", () => {
    const facts: [string, OverdueInput[]][] = [
      ["P1", [{ dueDate: "2026-10-17" }]],
      ["P2", [{ dueDate: "2026-10-16" }]],
      ["P3", [{ dueDate: "2026-10-18" }]],
      ["P4", [{ dueDate: null }]],
    ];
    render(<CommitmentsTable rows={facts.map(([n, d]) => row(n, d))} today={TODAY} />);
    const owner = facts.map(([n]) => levelOf(n));
    cleanup();
    const trackerRows = buildRows(
      facts.map(([n, d], i) => ({
        partyName: n,
        debit: null,
        credit: null,
        outstanding: null,
        collectionPerson: null,
        transactions: d.map((x) => ({ id: `t${i}`, collectionMasterId: `m${i}`, reference: null, amount: null, outstanding: null, status: null, ...x, dueDate: x.dueDate ?? null })),
      })),
      [],
    );
    render(<CollectionTracker rows={trackerRows} connected storageReady today={TODAY} />);
    const tracker = facts.map(([n]) => screen.getByRole("button", { name: n }).closest("tr")!.getAttribute("data-overdue"));
    expect(owner).toEqual(tracker);
    expect(owner).toEqual(["warning", "critical", "none", "none"]);
  });

  it("rolls over at India midnight without a reload (2 days → yellow, then 3 days → red)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-18T18:29:00Z")); // 23:59 IST on the 18th
    render(<CommitmentsTable rows={[row("Rolls over", [{ dueDate: "2026-10-16" }])]} today="2026-10-18" />);
    expect(levelOf("Rolls over")).toBe("warning");
    act(() => {
      vi.advanceTimersByTime(2 * 60_000); // past 00:00 IST on the 19th
    });
    expect(levelOf("Rolls over")).toBe("critical");
  });
});

// ── the page: due dates from the Tracker's own source, for the right company ──
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

describe("owner page data", () => {
  beforeEach(() => {
    h.me = null;
    h.claims = null;
    h.listCommitments.mockReset();
    h.txByMaster.mockReset();
  });

  it("passes each company only its own due-date facts (no invoice references or amounts) and India's business date", async () => {
    h.me = { id: "emp-granted", email: GRANTED, isActive: true, isAdmin: true, name: "Granted" };
    h.listCommitments.mockResolvedValue({
      storageReady: true,
      rows: [
        { companyId: "c1", companyName: "Alpha", amount: "1.00", committedDate: "2026-11-01", recordedAt: new Date(), collectionPerson: null },
        { companyId: "c2", companyName: "Beta", amount: "1.00", committedDate: "2026-11-01", recordedAt: new Date(), collectionPerson: null },
      ],
    });
    h.txByMaster.mockResolvedValue(
      new Map([["c1", [{ id: "t1", collectionMasterId: "c1", reference: "INV-77", amount: 9999, outstanding: 500, dueDate: "2026-10-17", status: "open" }]]]),
    );
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    const props = findProps(await Page(), "CommitmentsTable")!;
    expect(h.txByMaster).toHaveBeenCalledWith(["c1", "c2"]);
    const rows = props.rows as CommitmentView[];
    expect(rows.map((r) => [r.companyId, r.due])).toEqual([
      ["c1", [{ dueDate: "2026-10-17", status: "open", outstanding: 500 }]],
      ["c2", []],
    ]);
    expect(JSON.stringify(props)).not.toMatch(/INV-77|9999/);
    expect(props.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("without the capability: not found, and no due dates are read", async () => {
    h.me = { id: "emp-x", email: "other@example.test", isActive: true, isAdmin: true, name: "Other" };
    h.claims = { email: "other@example.test", email_verified: true };
    const { default: Page } = await import("@/app/(forms-module)/forms/collection/commitments/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.txByMaster).not.toHaveBeenCalled();
    expect(h.listCommitments).not.toHaveBeenCalled();
  });
});
