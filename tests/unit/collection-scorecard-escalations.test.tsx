// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The scorecard's two escalation metrics, clickable: each opens the records it counts. The REAL server action
// (getScorecardEscalations) runs behind the real dialog, with the session, grants, the salesperson link and the queries
// mocked. Checked: the gate (collection.view) is the server's, and whose card it is comes from the server-side link —
// never from the browser; "solved" lists only reviewer-closed records; reasons reach reviewers only; the latest reviewer
// comment per escalation; loading, empty and error states; close. The list-vs-count SQL is covered by
// tests/integration/collection-scorecards.db.test.ts.
const h = vi.hoisted(() => ({
  viewer: true,
  reviewer: false,
  identity: { status: "linked", label: "BK" } as { status: string; label?: string },
  labels: [] as string[],
  rows: [] as unknown[],
  followUps: [] as unknown[],
  fail: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current", () => ({ getCurrentEmployee: async () => ({ id: "emp-bk", isActive: true }) }));
vi.mock("@/lib/auth/capability", () => ({
  requireCollectionCapability: async (key: string) => {
    if (!h.viewer) throw new Error("Forbidden");
    return { employeeId: "emp-bk", capability: key };
  },
  getCollectionCapability: async (key: string) => (h.reviewer ? { employeeId: "emp-bk", capability: key } : null),
}));
vi.mock("@/lib/collections/salesperson-identity", () => ({ salespersonIdentityFor: async () => h.identity }));
vi.mock("@/lib/queries/collection-scorecards", () => ({
  listEscalationsForSalesperson: async (_viewer: unknown, label: string) => {
    h.labels.push(label);
    if (h.fail) throw new Error("secret connection detail");
    return h.rows;
  },
}));
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: async () => ({ storageReady: true, entries: h.followUps }) }));

import { getScorecardEscalations } from "@/app/(collection-module)/collection/scorecard-actions";
import { EscalationMetricButton } from "@/components/collections/scorecard-escalations";

const esc = (id: string, over: Record<string, unknown> = {}) => ({
  id, companyId: `co-${id}`, companyName: `Company ${id}`, coordinatorLabel: "BK", status: "open", reason: `Reason ${id}`,
  escalatedAt: new Date("2026-10-20T05:30:00Z"), escalatedByName: "Staff One", closedAt: null, closedById: null, closedByName: null, resolvedByReviewer: false, ...over,
});
const closedByReviewer = { status: "closed", closedAt: new Date("2026-10-25T06:00:00Z"), closedById: "emp-rev", closedByName: "Reviewer R", resolvedByReviewer: true };
const comment = (escalationId: string, note: string, at: string) => ({ id: `f-${note}`, note, createdByName: "Reviewer R", createdAt: new Date(at), reviewerEscalationId: escalationId });

beforeEach(() => {
  h.viewer = true;
  h.reviewer = false;
  h.identity = { status: "linked", label: "BK" };
  h.labels = [];
  h.fail = false;
  h.rows = [esc("a"), esc("b", closedByReviewer), esc("c", { status: "closed", closedById: "emp-x", closedByName: "Other Admin", closedAt: new Date("2026-10-24T06:00:00Z") })];
  // Newest first, as listFollowUps returns them; plus an ordinary comment that is not a reviewer comment.
  h.followUps = [
    comment("b", "Settled with the client", "2026-10-25T05:00:00Z"),
    comment("b", "Called them", "2026-10-22T05:00:00Z"),
    { id: "f-plain", note: "plain note", createdByName: "Staff One", createdAt: new Date("2026-10-21T05:00:00Z"), reviewerEscalationId: null },
  ];
});
afterEach(cleanup);

describe("getScorecardEscalations (server)", () => {
  it("refuses without collection.view, before anything is read", async () => {
    h.viewer = false;
    await expect(getScorecardEscalations({ metric: "escalated" })).rejects.toThrow("Forbidden");
    expect(h.labels).toEqual([]);
  });

  it("reads the signed-in salesperson's OWN label; the browser cannot choose whose card it is", async () => {
    expect((await getScorecardEscalations({ metric: "escalated", label: "SV" })).ok).toBe(false); // extra keys refused
    expect(h.labels).toEqual([]);
    await getScorecardEscalations({ metric: "escalated" });
    expect(h.labels).toEqual(["BK"]);
    h.identity = { status: "not-salesperson" };
    expect(await getScorecardEscalations({ metric: "escalated" })).toEqual({ ok: false, error: expect.stringMatching(/isn't linked/) });
  });

  it("'escalated' is every record; 'resolved' only those closed by the reviewer — the same counts as the card", async () => {
    const all = await getScorecardEscalations({ metric: "escalated" });
    const solved = await getScorecardEscalations({ metric: "resolved" });
    if (!all.ok || !solved.ok) throw new Error("expected ok");
    expect(all.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(solved.rows.map((r) => r.id)).toEqual(["b"]);
    expect(solved.rows[0]).toMatchObject({ closedByName: "Reviewer R", latestReviewerComment: { note: "Settled with the client", byName: "Reviewer R" } });
    expect(all.rows.find((r) => r.id === "a")!.latestReviewerComment).toBeNull();
  });

  it("reasons go to reviewers only", async () => {
    const plain = await getScorecardEscalations({ metric: "escalated" });
    if (!plain.ok) throw new Error("expected ok");
    expect(plain.reasonsVisible).toBe(false);
    expect(plain.rows.every((r) => r.reason === null)).toBe(true);
    h.reviewer = true;
    const rev = await getScorecardEscalations({ metric: "escalated" });
    if (!rev.ok) throw new Error("expected ok");
    expect(rev.reasonsVisible).toBe(true);
    expect(rev.rows.map((r) => r.reason)).toEqual(["Reason a", "Reason b", "Reason c"]);
  });

  it("a read failure is a plain message, never the error's details", async () => {
    h.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await getScorecardEscalations({ metric: "resolved" });
    expect(res).toEqual({ ok: false, error: "The entries couldn't be loaded. Please try again." });
    expect(JSON.stringify(res)).not.toContain("secret");
  });
});

describe("the clickable metrics", () => {
  const open = (metric: "escalated" | "resolved", count: number, label = metric === "resolved" ? "Escalated Entries Solved by Mihir Bhai" : "Entries Escalated to Mihir Bhai") => {
    render(<EscalationMetricButton metric={metric} label={label} count={count} />);
    const button = screen.getByRole("button", { name: new RegExp(`^${label}`) });
    expect(button.className).toMatch(/cursor-pointer/);
    fireEvent.click(button);
    return label;
  };

  it("'escalated' opens its own titled list with every record, its columns, status and the latest reviewer comment", async () => {
    const label = open("escalated", 3);
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
    const table = await screen.findByRole("table", { name: label });
    expect(screen.getAllByText(label).length).toBeGreaterThan(1); // button + dialog title
    const heads = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(heads).toEqual(["Company", "Sales Coordinator", "Escalation Reason", "Escalated By", "Escalated", "Status", "Latest Reviewer Comment"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Company a");
    expect(rows[0]!.textContent).toContain("Open");
    expect(rows[0]!.textContent).toContain("Visible to reviewers"); // not a reviewer
    expect(rows[1]!.textContent).toContain("Settled with the client");
    expect(rows[1]!.textContent).not.toContain("Called them"); // only the latest
    expect(rows[2]!.textContent).toContain("Closed");
    expect(document.body.textContent).toContain("3 entries");
  });

  it("'solved' lists only the reviewer-closed records, with the solved date and the reviewer's comment", async () => {
    h.reviewer = true;
    const label = open("resolved", 1);
    const table = await screen.findByRole("table", { name: label });
    const heads = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(heads).toEqual(["Company", "Sales Coordinator", "Escalation Reason", "Escalated By", "Escalated", "Solved", "Reviewer Comment"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Company b");
    expect(rows[0]!.textContent).toContain("Reason b");
    expect(rows[0]!.textContent).toContain("25/10/26");
    expect(rows[0]!.textContent).toContain("by Reviewer R");
    expect(document.body.textContent).toContain("1 entry");
  });

  it("empty and error states, with a retry; the close action shuts the view", async () => {
    h.rows = [];
    open("resolved", 0);
    expect(await screen.findByText(/has been solved by the reviewer yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the Tracker" }));
    await waitFor(() => expect(screen.queryByText(/has been solved by the reviewer yet/)).toBeNull());
    cleanup();

    h.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    open("escalated", 2);
    expect((await screen.findByRole("alert")).textContent).toContain("The entries couldn't be loaded.");
    h.fail = false;
    h.rows = [esc("a")];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Company a")).toBeTruthy();
  });
});
