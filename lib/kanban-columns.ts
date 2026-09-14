import { USER_TASK_STATUSES, type TaskStatus } from "@/db/enums";

// Sentinel id for the synthetic "Archived" column (not a real TaskStatus).
export const ARCHIVE_COL = "__archived__" as const;
// Sentinel for the synthetic "Unassigned" pool column — ownerless tasks Mihir
// Veera / Altus Corp quick-dumped, pinned first on the admin board.
export const UNASSIGNED_COL = "__unassigned__" as const;
export type ColId = TaskStatus | typeof ARCHIVE_COL;

// Default admin board order (sir's changes #7): the working lane, then the
// terminal verdicts, then Archived, with On Hold pulled out to the very end —
// "On Hold has to be placed after Archived". Deprecated statuses
// (follow_up_1/2/3, cancelled, transferred) are intentionally absent.
export const DEFAULT_ADMIN_COLUMN_ORDER: ColId[] = [
  "dont_know",
  "not_started",
  "initiated",
  "follow_up",
  "need_info",
  "done",
  "abandoned",
  "not_approved",
  "approved",
  ARCHIVE_COL,
  "on_hold",
];

// Non-admins: their curated lifecycle list with Archived appended.
export const USER_COLUMN_ORDER: ColId[] = [...USER_TASK_STATUSES, ARCHIVE_COL];

const ADMIN_COLUMN_SET = new Set<string>(DEFAULT_ADMIN_COLUMN_ORDER);

/* ── The two SIDES of the board ──────────────────────────────────────────── */

/**
 * Which half of the board a column belongs to.
 *
 * A task carries two independent answers and the board has to show both: the
 * DOER's progress report (`status`) and the INITIATOR's ruling on it
 * (`approval_status`). They were one undifferentiated strip, so a column that
 * writes a ruling sat next to one that writes a report with nothing saying
 * they are different acts — which is how On Hold ended up read as a progress
 * status by everyone who used it.
 *
 * Archived rides with the rulings: taking work off the board is the
 * initiator's call, not a report about how it is going.
 *
 * ON HOLD stays on the DOER side despite being a manager's instruction in
 * spirit, because it is a value of `tasks.status` — the very column the doer
 * half buckets by. Move it across and a task on hold has no card in the doer
 * half at all, which would make that half stop being a complete view of the
 * status it claims to show. Where a value LIVES decides which half can
 * display it; what it MEANS decides who is offered it, and the doer's picker
 * already leaves it out.
 *
 * The plan module splits its board the same way, under the same two headings.
 */
const INITIATOR_SIDE = new Set<string>([
  "not_approved",
  "approved",
  "cancelled",
  "transferred",
  ARCHIVE_COL,
]);

export function sideOfColumn(col: ColId): "doer" | "initiator" {
  return INITIATOR_SIDE.has(col) ? "initiator" : "doer";
}

/**
 * A flat column order, split into the two halves the board renders.
 *
 * Relative order inside each half is preserved, so a person's own arrangement
 * survives the split — a stored order from before there were two sides simply
 * lands in the right halves.
 */
export function splitBySide(columns: ColId[]): {
  doer: ColId[];
  initiator: ColId[];
} {
  const doer: ColId[] = [];
  const initiator: ColId[] = [];
  for (const c of columns) {
    (sideOfColumn(c) === "doer" ? doer : initiator).push(c);
  }
  return { doer, initiator };
}

/**
 * Re-flatten the two halves into the single list that gets persisted.
 *
 * Kept CONTIGUOUS BY SIDE on purpose: the reorder handler moves a column by
 * its index in this flat list, and that is only well-defined while every
 * column of a side sits together. Normalising here means it cannot drift.
 */
export function normaliseBySide(columns: ColId[]): ColId[] {
  const { doer, initiator } = splitBySide(columns);
  return [...doer, ...initiator];
}

/** True if `id` is a column the admin board can render/reorder. */
export function isValidColumnId(id: string): id is ColId {
  return ADMIN_COLUMN_SET.has(id);
}

/**
 * Resolve the effective admin column order from a stored order that may be
 * null, stale, or partial. Drops unknown/deprecated ids, de-dupes, and
 * appends any live columns the stored order didn't mention — so a status
 * added after the order was saved never silently disappears.
 */
export function resolveAdminColumnOrder(
  stored: string[] | null | undefined,
): ColId[] {
  if (!stored || stored.length === 0) return DEFAULT_ADMIN_COLUMN_ORDER;
  const seen = new Set<string>();
  const ordered: ColId[] = [];
  for (const id of stored) {
    if (ADMIN_COLUMN_SET.has(id) && !seen.has(id)) {
      ordered.push(id as ColId);
      seen.add(id);
    }
  }
  for (const id of DEFAULT_ADMIN_COLUMN_ORDER) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * Which board column a weekly goal belongs in, derived from its % done.
 *
 * Goals have no status column of their own — the site treats `pct_done >= 100`
 * as complete everywhere else (the leaderboard's `completed` count, the profile
 * criteria metrics), so the board reads the same field the same way: untouched
 * goals sit in Not Started, anything part-done is Initiated, and a finished
 * goal lands in Done.
 */
export function goalColumn(pctDone: number): TaskStatus {
  if (pctDone >= 100) return "done";
  return pctDone > 0 ? "initiated" : "not_started";
}
