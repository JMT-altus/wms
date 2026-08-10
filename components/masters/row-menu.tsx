"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
  disabled,
  label,
}: {
  onEdit: () => void;
  onDelete: () => void;
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} style={{ color: "var(--color-red-deep)" }}>
          <Trash2 size={14} strokeWidth={2.3} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Green-dot status cell from the reference layout. */
export function StatusCell({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: active ? "var(--color-green)" : "var(--color-ink-subtle)",
        }}
      />
      <span className="font-bold" style={{ fontSize: 13, color: active ? "var(--color-green-deep)" : "var(--color-ink-muted)" }}>
        {active ? "Active" : "Inactive"}
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
