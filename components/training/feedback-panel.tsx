"use client";
import * as React from "react";
import { Lock, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import type { SessionFeedbackRow } from "@/lib/queries/training";
import { rateSession } from "@/app/(app)/training/actions";
import { EmptyState, Panel, Stars } from "./ui";
import { StarRating } from "./star-rating";

export interface FeedbackComment {
  name: string | null;
  rating: number;
  comment: string | null;
}

export function FeedbackPanel({
  sessions,
  commentsBySession,
  canSeeAllComments,
}: {
  sessions: SessionFeedbackRow[];
  commentsBySession: Record<string, FeedbackComment[]>;
  /** Admins see every attendee's comment; staff see only their own. */
  canSeeAllComments: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No sessions to rate yet"
        sub="Once a training session has been held, it appears here for the people who attended."
      />
    );
  }

  return (
    <div className="grid gap-4">
      {sessions.map((s) => (
        <SessionFeedback
          key={s.sessionId}
          session={s}
          comments={commentsBySession[s.sessionId] ?? []}
          canSeeAllComments={canSeeAllComments}
        />
      ))}
    </div>
  );
}

function SessionFeedback({
  session,
  comments,
  canSeeAllComments,
}: {
  session: SessionFeedbackRow;
  comments: FeedbackComment[];
  canSeeAllComments: boolean;
}) {
  const [rating, setRating] = React.useState(session.myRating ?? 0);
  const [comment, setComment] = React.useState(session.myComment ?? "");
  const [pending, startTransition] = React.useTransition();

  const locked = !session.iAttended;

  function send() {
    if (rating < 1) {
      toast.error("Pick a rating from 1 to 5.");
      return;
    }
    startTransition(async () => {
      const res = await rateSession(session.sessionId, rating, comment);
      if (res.ok) toast.success("Feedback saved");
      else toast.error(res.error);
    });
  }

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
            {session.sessionTitle}
          </p>
          <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
            {session.scheduledAt.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {session.trainerName && ` · ${session.trainerName}`}
            {` · ${session.attendeeCount} attended`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <Stars value={session.avgRating} />
          <p className="mt-1 text-ink-subtle tabular-nums" style={{ fontSize: 12.5 }}>
            {session.ratingCount} {session.ratingCount === 1 ? "rating" : "ratings"}
          </p>
        </div>
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-hairline)" }}>
        {locked ? (
          <p
            className="inline-flex items-center gap-2 rounded-chip px-3.5 py-2.5 font-semibold text-ink-muted bg-surface-soft"
            style={{ fontSize: 14, border: "1px solid var(--color-hairline)" }}
          >
            <Lock size={15} strokeWidth={2.3} />
            Only people marked present can rate this session.
          </p>
        ) : (
          <>
            <span
              className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
              style={{ fontSize: 11.5 }}
            >
              {session.myRating ? "Your rating (click to change)" : "How was it?"}
            </span>
            <StarRating value={rating} onChange={setRating} disabled={pending} />
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="What worked, what would make it better (optional)"
              className="mt-2.5 w-full rounded-chip px-3.5 py-2.5 bg-surface-soft border border-hairline outline-none text-[14.5px] text-ink-strong resize-y"
            />
            <button
              type="button"
              onClick={send}
              disabled={pending}
              className="mt-2.5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-bold disabled:opacity-60"
              style={{
                fontSize: 14,
                background: "rgba(15,23,42,0.05)",
                color: "var(--color-ink-strong)",
                border: "1px solid var(--color-hairline)",
              }}
            >
              <Send size={14} strokeWidth={2.4} />
              {pending ? "Saving…" : session.myRating ? "Update feedback" : "Send feedback"}
            </button>
          </>
        )}
      </div>

      {canSeeAllComments && comments.length > 0 && (
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-hairline)" }}>
          <p
            className="uppercase font-bold tracking-[0.08em] text-ink-subtle mb-2.5"
            style={{ fontSize: 11.5 }}
          >
            <MessageSquare size={12} strokeWidth={2.6} className="inline mr-1.5 -mt-0.5" />
            All feedback
          </p>
          <ul className="grid gap-2">
            {comments.map((c, i) => (
              <li
                key={i}
                className="rounded-chip px-3.5 py-2.5 bg-surface-soft"
                style={{ border: "1px solid var(--color-hairline)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-ink-strong" style={{ fontSize: 14 }}>
                    {c.name ?? "Someone"}
                  </span>
                  <Stars value={c.rating} size={13} />
                </div>
                {c.comment && (
                  <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
                    {c.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
