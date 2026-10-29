import type { FollowUpEntry } from "@/lib/collections/derive";
import { commentAuthor, commentDate, commentTime } from "@/lib/collections/comment-audit";

/** A comment as the screens need it — the follow-up's note, when, and by whom (id and name). */
export type CommentEntry = Pick<FollowUpEntry, "id" | "note" | "createdAt" | "createdById" | "createdByName" | "authorIsReviewer" | "editedAt" | "editedByName">;

/** Comments by the escalation reviewer (authorIsReviewer, resolved on the server) have a yellow background for every viewer. */
export const REVIEWER_COMMENT_CLASS = "bg-[#FFF3B0]";

/** "Edited 28-Oct-2026 · 03:10 PM IST by …" — from the audit trail; nothing when never edited. */
function EditedNote({ entry }: { entry: Pick<CommentEntry, "editedAt" | "editedByName"> }) {
  if (!entry.editedAt) return null;
  return (
    <span className="block text-[11px] italic text-ink-subtle" data-comment-edited="true">
      Edited {commentDate(entry.editedAt)} · {commentTime(entry.editedAt)}
      {entry.editedByName ? ` by ${entry.editedByName}` : ""}
    </span>
  );
}

/**
 * Who wrote a comment and when, then the comment itself — the one format every
 * Collection screen uses: "User", "Date & Time" (IST, e.g. "27-Oct-2026,
 * 02:12 PM IST") and "Comment". All of it was recorded by the server when the
 * comment was saved; a missing author shows as "Historical author unavailable",
 * never as the person viewing it. The author's user id is kept with the comment
 * (and in the data) but is not shown.
 *
 *   compact — a meta line and the comment, for table cells and small panels
 *   full    — one labelled line each, for the party's History
 */
export function CommentAudit({
  entry,
  variant = "compact",
}: {
  entry: Pick<CommentEntry, "note" | "createdAt" | "createdById" | "createdByName" | "authorIsReviewer" | "editedAt" | "editedByName">;
  variant?: "compact" | "full";
}) {
  const reviewer = entry.authorIsReviewer === true;
  const author = commentAuthor(entry);
  const dateTime = `${commentDate(entry.createdAt)}, ${commentTime(entry.createdAt)}`;
  if (variant === "full") {
    return (
      <dl
        className={`grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px]${reviewer ? ` rounded px-1 ${REVIEWER_COMMENT_CLASS}` : ""}`}
        data-comment-audit="full"
        data-reviewer-comment={reviewer ? "true" : undefined}
      >
        <dt className="text-ink-subtle">User:</dt>
        <dd className={author.known ? "font-semibold text-ink-strong" : "italic text-ink-subtle"}>{author.name}</dd>
        <dt className="text-ink-subtle">Date &amp; Time:</dt>
        <dd className="tabular-nums text-ink-soft">{dateTime}</dd>
        {entry.note && (
          <>
            <dt className="text-ink-subtle">Comment:</dt>
            <dd className="whitespace-pre-wrap text-ink-strong">{entry.note}</dd>
          </>
        )}
        {entry.editedAt && (
          <dd className="col-span-2">
            <EditedNote entry={entry} />
          </dd>
        )}
      </dl>
    );
  }
  return (
    <span
      className={`block border-b border-hairline py-1 last:border-b-0${reviewer ? ` rounded px-1 ${REVIEWER_COMMENT_CLASS}` : ""}`}
      data-comment-audit="compact"
      data-reviewer-comment={reviewer ? "true" : undefined}
    >
      <span className="block text-[11.5px] leading-snug text-ink-subtle">
        <span>
          User: <span className={author.known ? "font-semibold text-ink-soft" : "italic"}>{author.name}</span>
        </span>
        {" · "}
        <span className="tabular-nums">Date &amp; Time: {dateTime}</span>
      </span>
      {entry.note && <span className="block whitespace-pre-wrap text-ink-strong">Comment: {entry.note}</span>}
      <EditedNote entry={entry} />
    </span>
  );
}

/**
 * A party's Collection Tracker comments, most recent first, each with its
 * author, user id, date and time (IST). The same rendering in the Tracker's
 * Comments column, the commitment popup and the commitments page.
 * Shows "—" when there are none.
 */
export function CommentList({
  comments,
  className = "max-h-[120px] max-w-[340px]",
  label = "Comments, newest first",
}: {
  comments: CommentEntry[];
  className?: string;
  label?: string;
}) {
  const notes = comments.filter((h) => h.note);
  if (notes.length === 0) return <span className="text-ink-subtle">—</span>;
  return (
    <span className={`block overflow-y-auto pr-1 ${className}`} aria-label={label}>
      {notes.map((h) => (
        <CommentAudit key={h.id} entry={h} />
      ))}
    </span>
  );
}
