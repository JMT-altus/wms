"use client";

import * as React from "react";
import { Grid3x3, Rows3 } from "lucide-react";

export type MasterView = "table" | "grid";

/**
 * Table ⇄ Grid, for the master screens.
 *
 * Two readings of the same rows, not two screens: Table is for finding a
 * record and correcting it, Grid is for the pass where a column needs filling
 * in across the register. Both write through the same action, so neither is
 * the "real" one — which is why this is a switch and not a link.
 */
export function ViewSwitch({
  view,
  onChange,
  accent,
  gridHint = "Every field as an editable sheet",
  tableHint = "One row per record, with filters and export",
}: {
  view: MasterView;
  onChange: (v: MasterView) => void;
  accent: string;
  gridHint?: string;
  tableHint?: string;
}) {
  return (
    <div
      className="shrink-0 inline-flex items-center rounded-chip p-0.5 bg-surface-soft"
      style={{ border: "1px solid var(--color-hairline)" }}
      role="group"
      aria-label="View"
    >
      {(["table", "grid"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          title={v === "table" ? tableHint : gridHint}
          className="inline-flex items-center gap-1.5 rounded-chip px-2.5 h-7 text-[12.5px] font-semibold whitespace-nowrap transition-colors"
          style={
            view === v ? { background: accent, color: "#fff" } : { color: "var(--color-ink-soft)" }
          }
        >
          {v === "table" ? <Rows3 size={13} strokeWidth={2.5} /> : <Grid3x3 size={13} strokeWidth={2.5} />}
          {v === "table" ? "Table" : "Grid"}
        </button>
      ))}
    </div>
  );
}
