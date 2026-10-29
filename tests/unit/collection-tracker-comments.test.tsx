// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Tracker's Comments column: the latest five comments per company, and
// "See all comments" for that company's complete history. Display only — the
// history is what the Tracker page already loaded for the row.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({ saveFollowUp: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn() }));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { TrackerComments } from "@/components/collections/tracker-comments";
import { TRACKER_COMMENT_LIMIT, buildRows, commentHistory, type FollowUpEntry } from "@/lib/collections/derive";

const TODAY = "2026-10-27";
afterEach(cleanup);

/** A comment saved on 2026-10-<day> at 06:00 UTC (11:30 AM IST). */
const c = (id: string, party: string, day: number, over: Partial<FollowUpEntry> = {}): FollowUpEntry => ({
  id,
  partyName: party,
  nextFollowupDate: null,
  note: `${party} note ${id}`,
  createdById: "emp-1",
  createdByName: "Asha",
  createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T06:00:00Z`),
  ...over,
});

// Alpha: eight comments saved on days 1..8, given out of order. The OLDEST (a1) carries the LATEST next-follow-up date,
// to prove ordering is by when a comment was saved, never by its follow-up date. Plus a note-less date-only entry.
const ALPHA = [
  c("a3", "Alpha Traders", 3),
  c("a8", "Alpha Traders", 8),
  c("a1", "Alpha Traders", 1, { nextFollowupDate: "2026-12-31" }),
  c("a6", "Alpha Traders", 6),
  c("a5", "Alpha Traders", 5),
  c("a2", "Alpha Traders", 2),
  c("a7", "Alpha Traders", 7),
  c("a4", "Alpha Traders", 4),
  c("d9", "Alpha Traders", 9, { note: null, nextFollowupDate: "2026-11-15" }),
];
const BETA = [c("b1", "Beta Corp", 9), c("b2", "Beta Corp", 10)];
const rows = buildRows(
  [
    { partyName: "Alpha Traders", debit: 1, credit: 0, outstanding: 1, collectionPerson: "Asha" },
    { partyName: "Beta Corp", debit: 1, credit: 0, outstanding: 1, collectionPerson: "Ravi" },
  ],
  [...ALPHA, ...BETA],
);
const row = (name: string) => screen.getByRole("button", { name }).closest("tr")!;
const notesIn = (el: Element) => [...el.textContent!.matchAll(/note (\w\d)/g)].map((m) => m[1]);

describe("commentHistory", () => {
  it("keeps notes only, each id once, newest first by when it was saved", () => {
    const h = commentHistory([...ALPHA, ALPHA[1]!, { ...ALPHA[0]!, note: "duplicate id, later copy" }]);
    expect(h.map((x) => x.id)).toEqual(["a8", "a7", "a6", "a5", "a4", "a3", "a2", "a1"]);
    expect(h.find((x) => x.id === "a3")!.note).toBe("Alpha Traders note a3"); // the first copy wins; nothing merged or rewritten
    expect(commentHistory([])).toEqual([]);
  });

  it("does not change the entries it is given", () => {
    const input = [...ALPHA];
    const snapshot = JSON.stringify(input);
    commentHistory(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("Tracker Comments column", () => {
  it("shows exactly the five newest comments, newest first, with their existing author/date/time", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    const alpha = row("Alpha Traders");
    expect(TRACKER_COMMENT_LIMIT).toBe(5);
    expect(notesIn(alpha)).toEqual(["a8", "a7", "a6", "a5", "a4"]);
    expect(alpha.querySelectorAll('[data-comment-audit="compact"]')).toHaveLength(5);
    expect(alpha.textContent).toContain("User: Asha · Date & Time: 08-Oct-2026, 11:30 AM ISTComment: Alpha Traders note a8");
    expect(within(alpha).getByText("Latest 5 of 8")).toBeTruthy();
  });

  it("offers 'See all comments' only when there are more than five — a real, labelled, focusable button", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    const btn = within(row("Alpha Traders")).getByRole("button", { name: "See all 8 comments for Alpha Traders" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.textContent).toBe("See all comments →");
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(within(row("Beta Corp")).queryByRole("button", { name: /See all/ })).toBeNull();
    expect(notesIn(row("Beta Corp"))).toEqual(["b2", "b1"]);
  });

  it("the dialog shows that company's complete history — all, newest first, none missing or repeated, no other company's", () => {
    render(<CollectionTracker rows={rows} connected storageReady today={TODAY} />);
    fireEvent.click(within(row("Alpha Traders")).getByRole("button", { name: /See all 8 comments/ }));
    const dialog = screen.getByRole("dialog", { name: "All comments" });
    expect(within(dialog).getByText("Alpha Traders · 8 comments, newest first")).toBeTruthy();
    const list = within(dialog).getByRole("list", { name: "All comments for Alpha Traders, newest first" });
    expect(notesIn(list)).toEqual(["a8", "a7", "a6", "a5", "a4", "a3", "a2", "a1"]);
    expect(list.querySelectorAll('[data-comment-audit="full"]')).toHaveLength(8);
    expect(dialog.textContent).not.toMatch(/Beta Corp/);
    // Same full format as the party's History: labelled user and date & time together; no user id.
    expect(within(list.querySelectorAll("li")[7] as HTMLElement).getByText("01-Oct-2026, 11:30 AM IST")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/User ID|emp-1/);
    const closes = within(dialog).getAllByRole("button", { name: "Close" }); // the header ✕ and the footer "Close"
    expect(closes.map((b) => b.textContent)).toEqual(["", "Close"]);
    fireEvent.click(closes[1]!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exactly five: all five shown, no button; none: 'No comments yet', no button", () => {
    const five = ALPHA.slice(0, 5);
    render(<TrackerComments companyName="Alpha Traders" history={five} />);
    expect(notesIn(document.body)).toEqual(["a8", "a6", "a5", "a3", "a1"]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Latest 5 of/)).toBeNull();
    cleanup();
    render(<TrackerComments companyName="Alpha Traders" history={[ALPHA[8]!]} />); // a follow-up date without a note is not a comment
    expect(document.body.textContent).toBe("No comments yet");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls only the two comment actions — editing or deleting your own comment — fetches nothing else, and the page's authorization is unchanged", () => {
    const src = readFileSync(resolve(__dirname, "../../components/collections/tracker-comments.tsx"), "utf8");
    expect(src).not.toMatch(/fetch\(|server-only|\bdb\b/);
    expect([...src.matchAll(/import \{([^}]*)\} from "@\/app\/\(forms-module\)\/forms\/collection\/actions"/g)].map((m) => m[1]!.trim())).toEqual(["deleteFollowUpComment, editFollowUpComment"]);
    expect(src.match(/await \w+\(/g)).toEqual(["await editFollowUpComment(", "await deleteFollowUpComment("]);
    const page = readFileSync(resolve(__dirname, "../../app/(forms-module)/forms/collection/tracker/page.tsx"), "utf8");
    expect(page).toMatch(/collection\.view/); // still gated on the server before any row (or comment) is loaded
  });
});
