// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Delete beside Edit on the Tracker's comments: only on your own comments, a confirmation first, one request at a
// time, the reason shown on a refusal or failure, and a refreshed list (and "Latest of N") after success. The
// server's checks are tested in tests/integration/collection-comment-delete.db.test.ts.
const h = vi.hoisted(() => ({ edit: vi.fn(), del: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: h.toast }));
vi.mock("@/app/(collection-module)/collection/actions", () => ({ editFollowUpComment: h.edit, deleteFollowUpComment: h.del }));

import { TrackerComments } from "@/components/collections/tracker-comments";
import { REVIEWER_COMMENT_CLASS, type CommentEntry } from "@/components/collections/comment-list";

afterEach(cleanup);
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
});

const c = (id: string, by: string, day: number, over: Partial<CommentEntry> = {}): CommentEntry => ({
  id, note: `Note ${id}`, createdById: by, createdByName: `Name ${by}`, createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T06:00:00Z`), ...over,
});
// Seven comments; the newest (c7) is mine, c6 is the reviewer's (yellow), the rest are someone else's.
const SEVEN = [c("c7", "me", 7), c("c6", "rev", 6, { authorIsReviewer: true }), c("c5", "x", 5), c("c4", "x", 4), c("c3", "x", 3), c("c2", "x", 2), c("c1", "x", 1)];
const renderAs = (editorId: string | null, history = SEVEN) => render(<TrackerComments companyName="Alpha Traders" history={history} editorId={editorId} />);
const deleteBtn = () => screen.getByRole("button", { name: "Delete your comment for Alpha Traders" });

describe("visibility", () => {
  it("Delete sits beside Edit, only on the signed-in author's own comment", () => {
    renderAs("me");
    const edit = screen.getByRole("button", { name: "Edit your comment for Alpha Traders" });
    expect(edit.parentElement).toBe(deleteBtn().parentElement);
    expect(screen.getAllByRole("button", { name: /^Delete your comment/ })).toHaveLength(1);
    expect(deleteBtn().className).toMatch(/B42318/); // red, unlike the blue Edit
    expect(edit.className).not.toMatch(/B42318/);
  });

  it("a read-only viewer, or someone else, gets no Delete (and no Edit)", () => {
    renderAs(null);
    expect(screen.queryByRole("button", { name: /Delete your comment/ })).toBeNull();
    cleanup();
    renderAs("someone-else");
    expect(screen.queryByRole("button", { name: /Delete your comment/ })).toBeNull();
  });

  it("the comment layout is unchanged: header format in the row, and the reviewer's yellow in the full history", () => {
    renderAs("me");
    const mine = screen.getByText(/Note c7/).closest("[data-comment-audit]")!;
    expect(mine.textContent).toBe("User: Name me · Date & Time: 07-Oct-2026, 11:30 AM ISTComment: Note c7");
    // Only the latest comment is in the row; the reviewer's (c6) is in "See all comments".
    expect(screen.queryByText(/Note c6/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See all 7 comments for Alpha Traders" }));
    expect(screen.getByText(/Note c6/).closest("[data-comment-audit]")!.className).toContain(REVIEWER_COMMENT_CLASS);
  });
});

describe("confirmation", () => {
  it("asks first, showing the comment; Cancel does nothing", () => {
    renderAs("me");
    fireEvent.click(deleteBtn());
    const dialog = screen.getByRole("dialog", { name: "Delete comment?" });
    expect(dialog.textContent).toContain("Are you sure you want to delete this comment? This action may not be reversible.");
    expect(dialog.textContent).toContain("Note c7");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("deleting", () => {
  it("confirming sends the id, the company and the text shown; success says so, closes and refreshes", async () => {
    h.del.mockResolvedValue({ ok: true });
    renderAs("me");
    fireEvent.click(deleteBtn());
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })));
    expect(h.del).toHaveBeenCalledWith({ id: "c7", partyName: "Alpha Traders", expectedNote: "Note c7" });
    expect(h.toast).toHaveBeenCalledWith({ message: "Comment deleted.", type: "success" });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("after the refresh the list and the count follow the server: 'Latest of 7' → 'Latest of 6', the deleted one gone", () => {
    const view = renderAs("me");
    expect(screen.getByText("Latest of 7")).toBeTruthy();
    view.rerender(<TrackerComments companyName="Alpha Traders" history={SEVEN.slice(1)} editorId="me" />);
    expect(screen.getByText("Latest of 6")).toBeTruthy();
    expect(screen.queryByText(/Note c7/)).toBeNull();
    expect(screen.getByText(/Note c6/)).toBeTruthy(); // the next-newest becomes the one shown
  });

  it("one request at a time: a double click sends one; both buttons are disabled and say 'Deleting…' meanwhile", async () => {
    let resolve!: (v: unknown) => void;
    h.del.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAs("me");
    fireEvent.click(deleteBtn());
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(h.del).toHaveBeenCalledTimes(1);
    expect((within(dialog).getByRole("button", { name: "Deleting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ ok: true }));
  });

  it("a refusal shows the server's reason and keeps the dialog open; a failure shows a safe message; nothing refreshes", async () => {
    renderAs("me");
    fireEvent.click(deleteBtn());
    const dialog = screen.getByRole("dialog");
    h.del.mockResolvedValueOnce({ ok: false, error: "You can only delete your own comments." });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    expect(within(dialog).getByRole("alert").textContent).toBe("You can only delete your own comments.");
    h.del.mockRejectedValueOnce(new Error("network down"));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    expect(within(dialog).getByRole("alert").textContent).toBe("The comment could not be deleted, so nothing was changed. Please try again.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("is also offered in the 'All comments' history for your own comment", () => {
    renderAs("me");
    fireEvent.click(screen.getByRole("button", { name: /See all 7 comments/ }));
    const all = screen.getByRole("dialog", { name: "All comments" });
    expect(within(all).getAllByRole("button", { name: "Delete your comment for Alpha Traders" })).toHaveLength(1);
  });
});
