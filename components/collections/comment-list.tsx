import type { FollowUpEntry } from "@/lib/collections/derive";

/** "10-Nov" — the date-wise note style from the design sketch. */
export const dayDash = (d: Date) => {
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", timeZone: "Asia/Kolkata" });
  const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Kolkata" });
  return `${day}-${mon}`;
};

/** A comment as the screens need it — the follow-up's note, when, and by whom. */
export type CommentEntry = Pick<FollowUpEntry, "id" | "note" | "createdAt" | "createdByName">;

/**
 * A party's Collection Tracker comments, most recent first, each as
 * "10-Nov — note" (author and full text on hover). The same rendering in the
 * Tracker's Comments column, the commitments popup and the owner's page.
 * Shows "—" when there are none.
 */
export function CommentList({
  comments,
  className = "max-h-[76px] max-w-[340px]",
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
        <span key={h.id} className="block truncate" title={h.createdByName ? `${h.note} — ${h.createdByName}` : (h.note ?? undefined)}>
          <span className="tabular-nums text-ink-subtle">{dayDash(h.createdAt)}</span> — {h.note}
        </span>
      ))}
    </span>
  );
}
