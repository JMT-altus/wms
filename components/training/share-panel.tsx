"use client";
import * as React from "react";
import { CheckCircle2, ExternalLink, Send, Video } from "lucide-react";
import { toast } from "sonner";
import type { ShareRow } from "@/lib/queries/training";
import { logWeeklyShare, rateShare } from "@/app/(app)/training/actions";
import { EmptyState, Panel, Stars, TRAINING_ACCENT, TRAINING_ACCENT_SOFT } from "./ui";
import { StarRating } from "./star-rating";

export function SharePanel({
  mine,
  colleagues,
  weekLabel,
  minMinutes,
}: {
  mine: ShareRow | null;
  colleagues: ShareRow[];
  weekLabel: string;
  /** Org policy, set by admins in Training → Settings. Not a constant. */
  minMinutes: number;
}) {
  return (
    <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-5 items-start">
      <MyShare mine={mine} weekLabel={weekLabel} minMinutes={minMinutes} />
      <Panel>
        <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
          Recent colleague shares
        </h2>
        <p className="mt-1 text-ink-muted" style={{ fontSize: 14 }}>
          Rate each 1–5 and leave a line of feedback.
        </p>
        <div className="mt-4 grid gap-3">
          {colleagues.length === 0 ? (
            <EmptyState
              title="No colleague shares yet"
              sub="Once your teammates log theirs, they'll appear here to rate."
            />
          ) : (
            colleagues.map((s) => <ColleagueShare key={s.id} share={s} />)
          )}
        </div>
      </Panel>
    </div>
  );
}

function MyShare({
  mine,
  weekLabel,
  minMinutes,
}: {
  mine: ShareRow | null;
  weekLabel: string;
  minMinutes: number;
}) {
  const [topic, setTopic] = React.useState(mine?.topic ?? "");
  const [minutes, setMinutes] = React.useState(mine?.minutes ?? minMinutes);
  const [videoLink, setVideoLink] = React.useState(mine?.videoLink ?? "");
  const [notes, setNotes] = React.useState(mine?.notes ?? "");
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await logWeeklyShare({ topic, minutes, videoLink, notes });
      if (res.ok) toast.success(mine ? "Share updated" : "Share logged");
      else toast.error(res.error);
    });
  }

  return (
    <Panel>
      <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
        Your share this week
      </h2>
      <p className="mt-1 text-ink-muted" style={{ fontSize: 14 }}>
        {weekLabel}
      </p>

      <div
        className="mt-4 rounded-chip px-4 py-3.5 flex items-start gap-3"
        style={
          mine
            ? {
                background: "color-mix(in srgb, var(--color-green) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-green) 30%, transparent)",
              }
            : {
                background: "color-mix(in srgb, var(--color-red) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-red) 26%, transparent)",
              }
        }
      >
        {mine ? (
          <CheckCircle2
            size={19}
            strokeWidth={2.4}
            style={{ color: "var(--color-green-deep)", flexShrink: 0, marginTop: 1 }}
          />
        ) : (
          <Video
            size={19}
            strokeWidth={2.4}
            style={{ color: "var(--color-red-deep)", flexShrink: 0, marginTop: 1 }}
          />
        )}
        <div>
          <p
            className="font-bold"
            style={{
              fontSize: 15,
              color: mine ? "var(--color-green-deep)" : "var(--color-red-deep)",
            }}
          >
            {mine ? "This week's share is done" : "You haven't done this week's share yet"}
          </p>
          <p
            className="mt-0.5 font-semibold"
            style={{
              fontSize: 13,
              color: mine ? "var(--color-green-deep)" : "var(--color-red-deep)",
              opacity: 0.85,
            }}
          >
            {weekLabel} · {minMinutes} min compulsory
            {mine && ` · rated ${mine.ratingCount} ${mine.ratingCount === 1 ? "time" : "times"}`}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3.5">
        <div>
          <Label>Topic — what are you sharing?</Label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            placeholder="e.g. A faster way to close the monthly books"
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
          />
        </div>

        <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
          <div>
            <Label>Minutes</Label>
            <input
              type="number"
              min={minMinutes}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums"
            />
            <p className="mt-1 text-ink-subtle" style={{ fontSize: 12.5 }}>
              Minimum {minMinutes} minutes.
            </p>
          </div>
          <div>
            <Label>Video link</Label>
            <input
              value={videoLink}
              onChange={(e) => setVideoLink(e.target.value)}
              placeholder="https://… (Drive, Loom, YouTube)"
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
            />
          </div>
        </div>

        <div>
          <Label>Notes (optional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What colleagues should take away"
            className="w-full rounded-chip px-3.5 py-2.5 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong resize-y"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="justify-self-end inline-flex items-center gap-2 rounded-xl px-6 py-3 text-white font-bold disabled:opacity-60"
          style={{
            fontSize: 15,
            background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
            boxShadow: "0 10px 22px -10px rgba(11,124,138,0.6)",
          }}
        >
          <Video size={16} strokeWidth={2.4} />
          {pending ? "Saving…" : mine ? "Update this week's share" : "Log this week's share"}
        </button>
      </form>
    </Panel>
  );
}

function ColleagueShare({ share }: { share: ShareRow }) {
  const [rating, setRating] = React.useState(share.myRating ?? 0);
  const [comment, setComment] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function send() {
    if (rating < 1) {
      toast.error("Pick a rating from 1 to 5.");
      return;
    }
    startTransition(async () => {
      const res = await rateShare(share.id, rating, comment);
      if (res.ok) {
        toast.success("Feedback sent");
        setComment("");
      } else {
        toast.error(res.error);
      }
    });
  }

  const initials = (share.employeeName ?? "??")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="rounded-chip p-4 bg-surface-card"
      style={{ border: "1px solid var(--color-hairline)" }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid place-items-center rounded-full shrink-0 text-white font-bold"
          style={{
            width: 38,
            height: 38,
            fontSize: 13,
            background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
          }}
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
            {share.employeeName ?? "Someone"}{" "}
            <span className="text-ink-subtle font-semibold" style={{ fontSize: 13 }}>
              · week of {share.weekStart}
            </span>
          </p>
          <p className="mt-0.5 font-semibold text-ink-soft" style={{ fontSize: 14.5 }}>
            {share.topic}
          </p>
          <p className="mt-1 flex items-center gap-3 text-ink-subtle" style={{ fontSize: 13 }}>
            <span className="tabular-nums">{share.minutes} min</span>
            {share.videoLink && (
              <a
                href={share.videoLink}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-bold hover:underline"
                style={{ color: TRAINING_ACCENT }}
              >
                <Video size={13} strokeWidth={2.4} /> Watch
                <ExternalLink size={11} strokeWidth={2.6} />
              </a>
            )}
            <Stars value={share.avgRating} size={13} />
          </p>
          {share.notes && (
            <p
              className="mt-2.5 rounded-chip px-3 py-2 text-ink-muted bg-surface-soft"
              style={{ fontSize: 13.5 }}
            >
              {share.notes}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid var(--color-hairline)" }}>
        <Label>{share.myRating ? "Your rating (click to change)" : "Rate this share"}</Label>
        <StarRating value={rating} onChange={setRating} disabled={pending} />
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="A line of feedback (optional)"
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
          {pending ? "Sending…" : "Give feedback"}
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
      style={{ fontSize: 11.5 }}
    >
      {children}
    </span>
  );
}
