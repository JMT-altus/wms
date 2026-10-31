// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The Tracker's comments: the escalation reviewer's comments have a yellow background for EVERY viewer (the flag
// comes from the server — authorIsReviewer — so nothing here knows who the reviewer is), other comments look exactly
// as before, and the signed-in author can edit their OWN comments with Save / Cancel.
const h = vi.hoisted(() => ({ edit: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
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
vi.mock("@/app/(collection-module)/collection/actions", () => ({ editFollowUpComment: h.edit }));

import { TrackerComments } from "@/components/collections/tracker-comments";
import { CommentAudit, CommentList, REVIEWER_COMMENT_CLASS, type CommentEntry } from "@/components/collections/comment-list";

afterEach(cleanup);
beforeEach(() => {
  h.edit.mockReset();
  h.refresh.mockReset();
});

const at = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T06:00:00Z`);
const entry = (id: string, by: string, note: string, day: number, over: Partial<CommentEntry> = {}): CommentEntry => ({
  id, note, createdById: by, createdByName: `Name ${by}`, createdAt: at(day), ...over,
});
const REVIEWER = entry("r1", "emp-rev", "Please follow up today.", 5, { authorIsReviewer: true });
const WRITER = entry("w1", "emp-w", "Called accounts.", 4);
const OTHER = entry("o1", "emp-o", "Left voicemail.", 3);
const HISTORY = [REVIEWER, WRITER, OTHER];
const PLAIN_COMPACT = "block border-b border-hairline py-1 last:border-b-0";

const PLAIN_FULL = "grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px]";

// The row shows only the latest comment; the complete history is behind "See all comments". `item` looks in a
// given scope so the latest comment (present in the row AND the dialog) is never matched twice.
const itemIn = (scope: HTMLElement, note: string) => within(scope).getByText(new RegExp(note.replace(/[.?]/g, "\\$&"))).closest("[data-comment-audit]") as HTMLElement;
const item = (note: string) => itemIn(document.body, note);
const openAll = () => {
  fireEvent.click(screen.getByRole("button", { name: /See all \d+ comments/ }));
  return screen.getByRole("list", { name: /All comments for/ }) as HTMLElement;
};
const row = () => screen.getByLabelText("Comments, newest first") as HTMLElement;

describe("the escalation reviewer's comments are yellow for every viewer; others are unchanged", () => {
  for (const viewer of [null, "emp-w", "emp-o", "emp-rev"]) {
    it(`viewer ${viewer ?? "(read-only)"}: only the reviewer's comment is yellow — in the row and in the full history`, () => {
      render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId={viewer} />);
      // The reviewer's is the latest, so it is the one in the row.
      expect(itemIn(row(), REVIEWER.note!).getAttribute("data-reviewer-comment")).toBe("true");
      expect(itemIn(row(), REVIEWER.note!).className).toContain(REVIEWER_COMMENT_CLASS);
      const all = openAll();
      expect(itemIn(all, REVIEWER.note!).getAttribute("data-reviewer-comment")).toBe("true");
      expect(itemIn(all, REVIEWER.note!).className).toContain(REVIEWER_COMMENT_CLASS);
      for (const e of [WRITER, OTHER]) {
        expect(itemIn(all, e.note!).getAttribute("data-reviewer-comment")).toBeNull();
        expect(itemIn(all, e.note!).className).toBe(PLAIN_FULL); // exactly the styling the History had before
      }
    });
  }

  it("an older (non-latest) comment keeps its plain compact styling when it is the one in the row", () => {
    render(<TrackerComments companyName="Alpha Traders" history={[WRITER, OTHER]} editorId={null} />);
    expect(itemIn(row(), WRITER.note!).getAttribute("data-reviewer-comment")).toBeNull();
    expect(itemIn(row(), WRITER.note!).className).toBe(PLAIN_COMPACT);
  });

  it("the yellow comment uses the new header — User and Date & Time together, no user id — and Edit is still offered on your own", () => {
    render(<TrackerComments companyName="Alpha Traders" history={[{ ...REVIEWER, createdByName: "MV" }, WRITER]} editorId="emp-w" />);
    const yellow = itemIn(row(), "Please follow up today.");
    expect(yellow.textContent).toBe("User: MV · Date & Time: 05-Oct-2026, 11:30 AM ISTComment: Please follow up today.");
    expect(yellow.innerHTML).not.toContain("emp-rev");
    expect(yellow.className).toContain(REVIEWER_COMMENT_CLASS);
    openAll(); // emp-w's own comment is the older one, so its Edit is in the full history
    expect(screen.getByRole("button", { name: /Edit your comment/ })).toBeTruthy();
  });

  it("the yellow is a background colour (yellow) and the same in the full History view", () => {
    expect(REVIEWER_COMMENT_CLASS).toMatch(/^bg-\[#FF[EF][0-9A-F]{3}\]$/i);
    const { container } = render(<CommentAudit entry={REVIEWER} variant="full" />);
    const dl = container.querySelector("[data-comment-audit='full']")!;
    expect(dl.className).toContain(REVIEWER_COMMENT_CLASS);
    cleanup();
    const plain = render(<CommentAudit entry={WRITER} variant="full" />).container.querySelector("[data-comment-audit='full']")!;
    expect(plain.className).toBe("grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px]");
  });

  it("the shared list (commitments page, popups) highlights the same way", () => {
    render(<CommentList comments={HISTORY} />);
    expect(item(REVIEWER.note!).className).toContain(REVIEWER_COMMENT_CLASS);
    expect(item(OTHER.note!).className).toBe(PLAIN_COMPACT);
  });

  it("an edited comment says so, with who and when", () => {
    render(<CommentAudit entry={{ ...WRITER, editedAt: new Date("2026-10-28T09:40:00Z"), editedByName: "Name emp-w" }} />);
    expect(screen.getByText(/Edited 28-Oct-2026 · 03:10 PM IST by Name emp-w/)).toBeTruthy();
  });
});

describe("Edit — only on your own comments", () => {
  it("is offered on the viewer's own comment only, and not at all to a read-only viewer", () => {
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId="emp-w" />);
    expect(screen.queryByRole("button", { name: /Edit your comment/ })).toBeNull(); // the row holds the reviewer's comment
    openAll();
    expect(screen.getAllByRole("button", { name: /Edit your comment/ })).toHaveLength(1);
    cleanup();
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId={null} />);
    openAll();
    expect(screen.queryByRole("button", { name: /Edit your comment/ })).toBeNull();
  });

  it("Save sends the id, the text it started from and the trimmed new text; success closes the box and refreshes", async () => {
    h.edit.mockResolvedValue({ ok: true });
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId="emp-w" />);
    openAll();
    fireEvent.click(screen.getByRole("button", { name: /Edit your comment/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /Edit comment/ }), { target: { value: "  Called accounts again.  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(h.edit).toHaveBeenCalledWith({ id: "w1", expectedNote: "Called accounts.", note: "Called accounts again." });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("an empty comment can't be saved and says why; an unchanged one can't be saved either", () => {
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId="emp-w" />);
    openAll();
    fireEvent.click(screen.getByRole("button", { name: /Edit your comment/ }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true); // unchanged
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("A comment can't be empty.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.edit).not.toHaveBeenCalled();
  });

  it("a double click sends ONE request; Save is disabled while saving", async () => {
    let resolve!: (v: unknown) => void;
    h.edit.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId="emp-w" />);
    openAll();
    fireEvent.click(screen.getByRole("button", { name: /Edit your comment/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New text" } });
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(h.edit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ ok: true }));
  });

  it("a refused or failed save keeps the box open with the typed text and shows the reason", async () => {
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId="emp-w" />);
    openAll();
    fireEvent.click(screen.getByRole("button", { name: /Edit your comment/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My new text" } });
    h.edit.mockResolvedValueOnce({ ok: false, error: "This comment was changed by someone else after you opened it." });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert").textContent).toMatch(/changed by someone else/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("My new text");
    h.edit.mockRejectedValueOnce(new Error("network down"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert").textContent).toBe("The comment could not be saved, so nothing was changed. Please try again.");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("Cancel discards the change and sends nothing", () => {
    render(<TrackerComments companyName="Alpha Traders" history={HISTORY} editorId="emp-w" />);
    openAll();
    fireEvent.click(screen.getByRole("button", { name: /Edit your comment/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Discard me" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(h.edit).not.toHaveBeenCalled();
    expect(within(item(WRITER.note!)).getByText(/Called accounts\./)).toBeTruthy();
  });
});
