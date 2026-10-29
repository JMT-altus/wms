"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CenterDialog } from "@/components/ui/center-dialog";
import { CommentAudit, CommentList, type CommentEntry } from "@/components/collections/comment-list";
import { deleteFollowUpComment, editFollowUpComment } from "@/app/(forms-module)/forms/collection/actions";
import { fireToast } from "@/lib/toast";
import { TRACKER_COMMENT_LIMIT, commentHistory } from "@/lib/collections/derive";

/**
 * The Collection Tracker's Comments cell for one company: its latest five
 * comments (newest first, by when they were saved), all five shown in full in
 * the row, and — only when there are more — "See all comments", which opens
 * that company's complete history. No comments → "No comments yet".
 *
 * Everything shown is the company's own follow-up history, which the Tracker
 * page already loaded on the server for this row. When `editorId` is set (the
 * signed-in employee, who holds collection.followup.write), that person's OWN
 * comments get Edit and Delete; the server actions check all of it again.
 */
export function TrackerComments({
  companyName,
  history,
  editorId = null,
}: {
  companyName: string;
  history: CommentEntry[];
  editorId?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const all = commentHistory(history);
  const latest = all.slice(0, TRACKER_COMMENT_LIMIT);
  const more = all.length > TRACKER_COMMENT_LIMIT;
  const canEdit = (h: CommentEntry) => !!editorId && h.createdById === editorId && !!h.note;

  return (
    <div className="max-w-[340px]">
      {more && (
        <div className="mb-0.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-ink-subtle tabular-nums">
            Latest {TRACKER_COMMENT_LIMIT} of {all.length}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`See all ${all.length} comments for ${companyName}`}
            aria-haspopup="dialog"
            className="shrink-0 whitespace-nowrap rounded text-[11.5px] font-semibold text-[#0B4FB8] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#14336B]"
          >
            See all comments →
          </button>
        </div>
      )}
      {/* The latest five are shown in full — no inner scroll box hiding some of them. The full history is in "See all comments". */}
      {all.length === 0 ? (
        <span className="text-ink-subtle" data-comments-empty="true">
          No comments yet
        </span>
      ) : editorId && latest.some(canEdit) ? (
        <span className="block pr-1" aria-label="Comments, newest first">
          {latest.map((h) => (
            <span key={h.id} className="block">
              <CommentAudit entry={h} />
              {canEdit(h) && <EditComment entry={h} companyName={companyName} />}
            </span>
          ))}
        </span>
      ) : (
        <CommentList comments={latest} className="" />
      )}
      {more && (
        <CenterDialog
          open={open}
          title="All comments"
          subtitle={`${companyName} · ${all.length} comments, newest first`}
          onClose={() => setOpen(false)}
          accentBar="linear-gradient(90deg, #0A6CFF 0%, #0B4FB8 100%)"
          footer={
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong hover:bg-[#F7F9FD]"
            >
              Close
            </button>
          }
        >
          <ol className="grid gap-2" aria-label={`All comments for ${companyName}, newest first`}>
            {all.map((h) => (
              <li key={h.id} className="rounded-lg bg-[#F8FAFD] px-3 py-2 text-[13px]">
                <CommentAudit entry={h} variant="full" />
                {canEdit(h) && <EditComment entry={h} companyName={companyName} />}
              </li>
            ))}
          </ol>
        </CenterDialog>
      )}
    </div>
  );
}

/**
 * Edit one of your own comments: Edit → a text box with Save / Cancel. Save is
 * disabled while empty, unchanged or already saving (one request at a time);
 * the server re-validates, checks the author, refuses a concurrent change, and
 * records the edit in the audit trail. A failure keeps the box open with the
 * text, so nothing typed is lost.
 */
function EditComment({ entry, companyName }: { entry: CommentEntry; companyName: string }) {
  const router = useRouter();
  const original = entry.note ?? "";
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(original);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  const trimmed = text.trim();
  const unchanged = trimmed === original;
  const emptyError = editing && trimmed.length === 0 ? "A comment can't be empty." : null;

  async function save() {
    if (inFlight.current || trimmed.length === 0 || unchanged) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await editFollowUpComment({ id: entry.id, expectedNote: original, note: trimmed });
      if (!res.ok) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    } catch {
      setError("The comment could not be saved, so nothing was changed. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="flex items-center gap-3">
        <button
          type="button"
          className="text-[11.5px] font-bold text-[#0B4FB8] underline-offset-2 hover:underline"
          aria-label={`Edit your comment for ${companyName}`}
          onClick={() => {
            setText(original);
            setError(null);
            setEditing(true);
          }}
        >
          Edit
        </button>
        <DeleteComment entry={entry} companyName={companyName} />
      </span>
    );
  }
  return (
    <span className="mt-1 block">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
        disabled={busy}
        aria-label={`Edit comment for ${companyName}`}
        aria-invalid={emptyError ? true : undefined}
        className="block w-full rounded-md border border-hairline-strong px-2 py-1 text-[13px] text-ink-strong"
      />
      {(emptyError || error) && (
        <span role="alert" className="mt-0.5 block text-[12px] font-semibold text-[#B42318]">
          {emptyError ?? error}
        </span>
      )}
      <span className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || trimmed.length === 0 || unchanged}
          className="h-7 rounded-md bg-[#0B4FB8] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setText(original);
            setError(null);
          }}
          disabled={busy}
          className="h-7 rounded-md border border-hairline-strong bg-white px-3 text-[12.5px] font-semibold text-ink-strong disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    </span>
  );
}

/**
 * Delete one of your own comments, after a confirmation. One request at a time
 * (the button and the dialog are disabled while it runs); a refusal or failure is
 * shown in the dialog and nothing changes; success closes it, says so and
 * refreshes the list (and its "Latest 5 of N" count) from the server. The server
 * checks the author, the company and the permissions again, and the deletion is
 * soft: the comment and its history stay in the records.
 */
function DeleteComment({ entry, companyName }: { entry: CommentEntry; companyName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  async function confirmDelete() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteFollowUpComment({ id: entry.id, partyName: companyName, expectedNote: entry.note ?? "" });
      if (!res.ok) setError(res.error);
      else {
        setConfirming(false);
        fireToast({ message: "Comment deleted.", type: "success" });
        router.refresh();
      }
    } catch {
      setError("The comment could not be deleted, so nothing was changed. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="text-[11.5px] font-bold text-[#B42318] underline-offset-2 hover:underline"
        aria-label={`Delete your comment for ${companyName}`}
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Delete
      </button>
      <CenterDialog
        open={confirming}
        title="Delete comment?"
        subtitle={companyName}
        width={480}
        onClose={() => {
          if (!busy) setConfirming(false);
        }}
        accentBar="linear-gradient(90deg, #D92D20 0%, #B42318 100%)"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong hover:bg-[#F7F9FD] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy}
              className="h-9 rounded-lg bg-[#B42318] px-4 text-[13.5px] font-semibold text-white hover:bg-[#912018] disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        }
      >
        <p className="text-[14px] text-ink-strong">Are you sure you want to delete this comment? This action may not be reversible.</p>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[#F8FAFD] px-3 py-2 text-[13px] text-ink-soft">{entry.note}</p>
        {error && (
          <p role="alert" className="mt-2 text-[13px] font-semibold text-[#B42318]">
            {error}
          </p>
        )}
      </CenterDialog>
    </>
  );
}
