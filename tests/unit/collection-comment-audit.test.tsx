// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Collection comments audit details: who wrote a comment (name + employee id), the
// date and time in IST, and the comment — in every place comments are shown.
// Server actions are MOCKED; nothing here reaches a database.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({ saveFollowUp: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn() }));

import { COMMENT_TIME_ZONE, HISTORICAL_AUTHOR, UNAVAILABLE_USER_ID, commentAuthor, commentDate, commentTime } from "@/lib/collections/comment-audit";
import { CommentAudit, CommentList, type CommentEntry } from "@/components/collections/comment-list";
import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, type FollowUpEntry } from "@/lib/collections/derive";

afterEach(cleanup);

const RAHUL = "0d3b7c1e-5a4f-4e9b-9c1d-2f6a8b0c4d11";
const entry = (over: Partial<FollowUpEntry> = {}): FollowUpEntry => ({
  id: "f1",
  partyName: "Alpha Traders",
  nextFollowupDate: null,
  note: "Customer confirmed payment will be made by Friday.",
  createdById: RAHUL,
  createdByName: "Rahul Sharma",
  createdAt: new Date("2026-10-27T08:05:00Z"), // 01:35 PM IST
  ...over,
});

describe("date and time are shown in IST", () => {
  it("uses Asia/Kolkata", () => {
    expect(COMMENT_TIME_ZONE).toBe("Asia/Kolkata");
  });
  it("formats the example exactly: 27-Oct-2026, 01:35 PM IST", () => {
    const d = new Date("2026-10-27T08:05:00Z");
    expect(commentDate(d)).toBe("27-Oct-2026");
    expect(commentTime(d)).toBe("01:35 PM IST");
  });
  it("the IST day, not the UTC day, decides the date (crossing midnight)", () => {
    const d = new Date("2026-10-26T19:00:00Z"); // 27-Oct 00:30 IST
    expect(commentDate(d)).toBe("27-Oct-2026");
    expect(commentTime(d)).toBe("12:30 AM IST");
  });
  it("noon and the last minute of the day", () => {
    expect(commentTime(new Date("2026-10-27T06:30:00Z"))).toBe("12:00 PM IST");
    expect(commentTime(new Date("2026-10-27T18:29:00Z"))).toBe("11:59 PM IST");
    expect(commentDate(new Date("2026-12-31T18:30:00Z"))).toBe("01-Jan-2027");
  });
  it("month names are fixed three-letter forms (never 'Sept')", () => {
    const months = Array.from({ length: 12 }, (_, i) => commentDate(new Date(Date.UTC(2026, i, 15, 6))).slice(3, 6));
    expect(months).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });
});

describe("author attribution", () => {
  it("shows the stored author's name and employee id", () => {
    expect(commentAuthor({ createdById: RAHUL, createdByName: "Rahul Sharma" })).toEqual({ name: "Rahul Sharma", userId: RAHUL, known: true });
  });
  it("is honest when the author is not on record — never someone else", () => {
    expect(commentAuthor({ createdById: null, createdByName: null })).toEqual({ name: HISTORICAL_AUTHOR, userId: UNAVAILABLE_USER_ID, known: false });
    expect(HISTORICAL_AUTHOR).toBe("Historical author unavailable");
  });
  it("a name without an id (or an id without a name) is not treated as known", () => {
    expect(commentAuthor({ createdById: null, createdByName: "Rahul Sharma" })).toEqual({ name: HISTORICAL_AUTHOR, userId: UNAVAILABLE_USER_ID, known: false });
    expect(commentAuthor({ createdById: RAHUL, createdByName: null })).toEqual({ name: HISTORICAL_AUTHOR, userId: RAHUL, known: false });
  });
});

describe("CommentAudit rendering", () => {
  it("full: one labelled line each — User, Date & Time (together), Comment; no user id", () => {
    const { container } = render(<CommentAudit entry={entry()} variant="full" />);
    const terms = [...container.querySelectorAll("dt")].map((n) => n.textContent);
    const values = [...container.querySelectorAll("dd")].map((n) => n.textContent);
    expect(terms).toEqual(["User:", "Date & Time:", "Comment:"]);
    expect(values).toEqual(["Rahul Sharma", "27-Oct-2026, 01:35 PM IST", "Customer confirmed payment will be made by Friday."]);
    expect(container.textContent).not.toContain(RAHUL);
    expect(container.textContent).not.toMatch(/User ID|Comment by/);
  });
  it("compact: User and Date & Time in one meta line, then the comment; no user id", () => {
    const { container } = render(<CommentAudit entry={entry()} />);
    expect(container.textContent).toBe(`User: Rahul Sharma · Date & Time: 27-Oct-2026, 01:35 PM ISTComment: Customer confirmed payment will be made by Friday.`);
    expect(container.textContent).not.toContain(RAHUL);
    expect(container.textContent).not.toMatch(/User ID|Comment by/);
  });
  it("date and time stay together and in IST across the day boundary (no conversion drift)", () => {
    // 18:45 UTC on 27 Oct is 00:15 on 28 Oct in IST; 18:29 UTC is still 27 Oct (11:59 PM IST).
    const late = render(<CommentAudit entry={entry({ createdAt: new Date("2026-10-27T18:45:00Z") })} />);
    expect(late.container.textContent).toContain("Date & Time: 28-Oct-2026, 12:15 AM IST");
    cleanup();
    const before = render(<CommentAudit entry={entry({ createdAt: new Date("2026-10-27T18:29:00Z") })} variant="full" />);
    expect([...before.container.querySelectorAll("dd")][1]!.textContent).toBe("27-Oct-2026, 11:59 PM IST");
  });
  it("the user id is not rendered anywhere — not in text, attributes or titles", () => {
    for (const variant of ["compact", "full"] as const) {
      const { container } = render(<CommentAudit entry={entry()} variant={variant} />);
      expect(container.innerHTML).not.toContain(RAHUL);
      cleanup();
    }
  });
  it("preserves the original comment text exactly (line breaks and spacing included)", () => {
    const note = "Line one\n  Line two — ₹1,25,000 <b>not html</b>";
    const { container } = render(<CommentAudit entry={entry({ note })} variant="full" />);
    expect([...container.querySelectorAll("dd")].at(-1)!.textContent).toBe(note);
    expect(container.querySelector("b")).toBeNull();
  });
  it("a historical comment with no author shows the fallback in both layouts", () => {
    const old = entry({ createdById: null, createdByName: null });
    const full = render(<CommentAudit entry={old} variant="full" />);
    expect([...full.container.querySelectorAll("dd")].map((n) => n.textContent).slice(0, 2)).toEqual([HISTORICAL_AUTHOR, "27-Oct-2026, 01:35 PM IST"]);
    expect(full.container.textContent).not.toContain(UNAVAILABLE_USER_ID);
    cleanup();
    const compact = render(<CommentAudit entry={old} />);
    expect(compact.container.textContent).toContain(`User: ${HISTORICAL_AUTHOR} · Date & Time: 27-Oct-2026, 01:35 PM IST`);
    expect(compact.container.textContent).not.toContain(UNAVAILABLE_USER_ID);
  });
});

describe("CommentList (Tracker Comments column, commitment popup, commitments page)", () => {
  const list: CommentEntry[] = [
    { id: "c2", note: "Second", createdAt: new Date("2026-10-28T04:00:00Z"), createdById: "emp-b", createdByName: "Bina" },
    { id: "c1", note: "First", createdAt: new Date("2026-10-27T08:05:00Z"), createdById: RAHUL, createdByName: "Rahul Sharma" },
  ];
  it("shows every comment with its own author, in the given (newest-first) order", () => {
    render(<CommentList comments={list} />);
    const items = [...screen.getByLabelText("Comments, newest first").querySelectorAll("[data-comment-audit]")].map((n) => n.textContent);
    expect(items).toEqual([
      "User: Bina · Date & Time: 28-Oct-2026, 09:30 AM ISTComment: Second",
      `User: Rahul Sharma · Date & Time: 27-Oct-2026, 01:35 PM ISTComment: First`,
    ]);
  });
  it("shows a dash when there are no comments, and leaves out date-only follow-ups", () => {
    render(<CommentList comments={[{ ...list[0]!, note: null }]} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("Party popup History", () => {
  const rows = buildRows(
    [{ partyName: "Alpha Traders", debit: null, credit: null, outstanding: null, collectionPerson: null }],
    [
      entry(),
      entry({ id: "f0", note: "Before the audit details existed", createdById: null, createdByName: null, createdAt: new Date("2026-09-01T05:00:00Z") }),
      entry({ id: "f2", note: null, nextFollowupDate: "2026-11-05", createdAt: new Date("2026-10-28T04:00:00Z"), createdById: "emp-b", createdByName: "Bina" }),
    ],
  );
  it("each entry shows who, date & time and the comment (no user id); a date-only entry shows its next date", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-27" />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha Traders" }));
    const dialog = screen.getByRole("dialog");
    const items = within(dialog).getAllByRole("listitem").filter((li) => li.querySelector("[data-comment-audit='full']"));
    expect(items).toHaveLength(3);
    const values = (li: HTMLElement) => [...li.querySelectorAll("dd")].map((n) => n.textContent);
    // newest first
    expect(values(items[0]!)).toEqual(["Bina", "28-Oct-2026, 09:30 AM IST"]);
    expect(items[0]!.textContent).toContain("Next follow-up: 05 Nov 2026");
    expect(values(items[1]!)).toEqual(["Rahul Sharma", "27-Oct-2026, 01:35 PM IST", "Customer confirmed payment will be made by Friday."]);
    expect(values(items[2]!)).toEqual([HISTORICAL_AUTHOR, "01-Sep-2026, 10:30 AM IST", "Before the audit details existed"]);
    expect(dialog.textContent).not.toMatch(/User ID|emp-b/);
    expect(dialog.textContent).not.toContain(RAHUL);
  });
});
