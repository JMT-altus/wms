"use client";

import { toast } from "sonner";

/**
 * The "saved" confirmation the masters put up after an edit in place.
 *
 * One helper rather than one per screen because the Grid View and the table
 * views are the same register edited two ways, and a confirmation that reads
 * differently depending on which view you happened to be in is a confirmation
 * you have to stop and read. Both go through here.
 */

export interface SavedChange {
  /** The column's own heading — "Credit Limit", not `creditLimit`. */
  label: string;
  /** What the cell held before the edit. */
  from: string;
  /** What it holds now. Empty means it was cleared. */
  to: string;
}

/**
 * Say what was written.
 *
 * Clearing a cell is deliberately SILENT. Erasing a value is unambiguous the
 * moment you do it — the cell is empty, you are looking at it — so a popup
 * saying "Address Line 2: testing → —" tells you only what the screen already
 * shows, and does it over the top of the next row you were about to edit. A
 * value that was written is worth confirming; a value that was removed is not.
 *
 * A save that only cleared cells therefore says nothing at all. The write
 * still happens, and the row's own tick still marks it.
 */
export function announceSave(rowLabel: string, changes: SavedChange[]): void {
  const worth = changes.filter((c) => c.to.trim() !== "");
  if (worth.length === 0) return;
  toast.success(rowLabel.trim() ? `${rowLabel.trim()} — saved` : "Saved", {
    description: describeChanges(worth),
  });
}

/**
 * The one line under "saved" that says what was actually written.
 *
 * "Credit Limit: 3,00,000 → 5,00,000" for a single field, because on a sheet
 * where a whole column is being filled in the field name alone doesn't tell
 * you which row you just moved. Past three fields it stops listing and counts
 * — one save can cover a whole row, and a toast is not a diff.
 */
const SHOWN = 3;

export function describeChanges(changes: SavedChange[]): string {
  const shown = changes
    .slice(0, SHOWN)
    .map((c) =>
      changes.length === 1
        ? `${c.label}: ${cellText(c.from)} → ${cellText(c.to)}`
        : `${c.label}: ${cellText(c.to)}`,
    )
    .join(" · ");
  const rest = changes.length - SHOWN;
  return rest > 0 ? `${shown} · +${rest} more` : shown;
}

/** A cell value as the toast should read it. */
export function cellText(v: string): string {
  const t = v.trim();
  if (!t) return "—";
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}
