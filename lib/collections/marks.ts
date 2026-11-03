import { z } from "zod";

/**
 * MARK AS PRIORITY and COLLECTION DONE — the Tracker's two company marks
 * (migration 0125). Pure vocabulary and rules, shared by the server and the
 * browser: no database, no clock.
 *
 * A company may hold both marks. COLLECTION DONE takes precedence: a done
 * company sits at the bottom, faded, whatever its priority mark says; undoing
 * done brings an active priority mark back into force (top of the list), so
 * a mistake can be reversed without losing the earlier decision.
 */

export const MARK_KINDS = ["priority", "done"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** An active mark: who set it (null = not on record) and when. */
export interface MarkInfo {
  setAt: Date;
  setByName: string | null;
}

/** A company's active marks, as read from the database. */
export interface CompanyMarks {
  priority: MarkInfo | null;
  done: MarkInfo | null;
}

/** Where a company sits in the Tracker: top (priority), middle (pending) or bottom (done). */
export type MarkState = "priority" | "pending" | "done";
export const MARK_STATES: readonly MarkState[] = ["priority", "pending", "done"];

export const STATE_LABELS: Record<MarkState, string> = {
  priority: "Priority",
  pending: "Pending",
  done: "Collection done",
};

/** The one precedence rule: done beats priority; no marks = pending. */
export function markStateOf(m: CompanyMarks | null | undefined): MarkState {
  if (m?.done) return "done";
  if (m?.priority) return "priority";
  return "pending";
}

/** Group order in the Tracker; ordinary column sorting applies within a group only. */
export const STATE_RANK: Record<MarkState, number> = { priority: 0, pending: 1, done: 2 };

export const MARKS_NOT_READY = "Priority and Collection Done aren't available yet (migration 0125 is pending).";

/** The marks action's input: which companies, which mark, and whether to set (true) or clear (false) it. */
export const MarksInput = z
  .object({
    companyIds: z.array(z.string().uuid()).min(1, "Choose at least one company.").max(500, "Choose at most 500 companies at a time."),
    kind: z.enum(MARK_KINDS),
    active: z.boolean(),
  })
  .strict();
export type MarksInputT = z.infer<typeof MarksInput>;

const plural = (n: number) => (n === 1 ? "1 company" : `${n.toLocaleString("en-IN")} companies`);

/** The success message for a completed marks action. */
export function marksMessage(kind: MarkKind, active: boolean, updated: number, skipped: number): string {
  const verb =
    kind === "priority"
      ? active
        ? `Marked ${plural(updated)} as priority.`
        : `Removed priority from ${plural(updated)}.`
      : active
        ? `Marked ${plural(updated)} as collection done.`
        : `Undid collection done for ${plural(updated)}.`;
  return skipped > 0 ? `${verb} ${skipped.toLocaleString("en-IN")} skipped (already in that state, or not in your scope).` : verb;
}
