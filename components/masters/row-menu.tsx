"use client";

import { MoonStar, MoreHorizontal, Pencil, Sunrise, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "⋯" row menu from the reference layout.
 *
 * A menu rather than two always-visible icon buttons because the master tables
 * are going to gain per-row actions (duplicate, merge, view usage) and a row of
 * five icons competes with the data for attention.
 */
export function RowMenu({
  onEdit,
  onDelete,
  onToggleDormant,
  dormant = false,
  disabled,
  label,
}: {
  onEdit: () => void;
  onDelete: () => void;
  /**
   * Park this row as dormant, or bring it back (0101). Optional: only the
   * customer tables carry dormancy — a contact or a bank account is not a
   * thing you stop trading with.
   */
  onToggleDormant?: () => void;
  dormant?: boolean;
  disabled?: boolean;
  /** Named in the a11y label so screen readers don't hear "More" ten times. */
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${label}`}
          disabled={disabled}
          className="inline-flex items-center justify-center rounded-lg text-ink-muted hover:bg-surface-soft disabled:opacity-40 transition-colors"
          style={{ width: 32, height: 30, border: "1px solid var(--color-hairline)" }}
        >
          <MoreHorizontal size={16} strokeWidth={2.4} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil size={14} strokeWidth={2.3} />
          Edit
        </DropdownMenuItem>
        {onToggleDormant && (
          <DropdownMenuItem onClick={onToggleDormant}>
            {dormant ? (
              <>
                <Sunrise size={14} strokeWidth={2.3} />
                Reactivate
              </>
            ) : (
              <>
                <MoonStar size={14} strokeWidth={2.3} />
                Set Dormant
              </>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} style={{ color: "var(--color-red-deep)" }}>
          <Trash2 size={14} strokeWidth={2.3} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Green-dot status cell from the reference layout.
 *
 * Three states, not two. Dormant (0101) outranks the Active/Inactive switch
 * because it is the stronger fact: a dormant customer is off the working list
 * whatever its Active flag happens to say, and showing it as "Active" in the
 * one view that can see dormant records would be the cell contradicting the
 * filter that surfaced it.
 */
export function StatusCell({ active, dormant = false }: { active: boolean; dormant?: boolean }) {
  const tone = dormant
    ? { dot: "var(--color-amber)", text: "var(--color-amber-deep)", label: "Dormant" }
    : active
      ? { dot: "var(--color-green)", text: "var(--color-green-deep)", label: "Active" }
      : { dot: "var(--color-ink-subtle)", text: "var(--color-ink-muted)", label: "Inactive" };

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 999, background: tone.dot }}
      />
      <span className="font-bold" style={{ fontSize: 13, color: tone.text }}>
        {tone.label}
      </span>
    </span>
  );
}

/** Monospace, accent-coloured identifier — the reference's ITEM CODE column. */
export function CodeCell({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-semibold whitespace-nowrap"
      style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 13, color: "#3730A3" }}
    >
      {children}
    </span>
  );
}
