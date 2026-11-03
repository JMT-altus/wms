"use client";

import * as React from "react";
import { CheckCircle2, ChevronDown, Flag, Loader2, Undo2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MarkKind } from "@/lib/collections/marks";
import type { MarkTarget } from "./mark-controls";

/**
 * The strip shown while companies are ticked in the Tracker — the Tasks list's
 * bulk bar, with the Tracker's two marks:
 *
 *   [N] selected · Priority ▾ · Status ▾                      Clear
 *
 * Priority offers Mark as priority / Remove priority (collection.priority.set);
 * Status offers Collection done / Undo collection done (collection.done.set).
 * A chip is drawn only for a capability the viewer holds (decided on the
 * server, checked again by the action). The actions run through the same
 * runner as the row menu, so Collection done asks first here too, and the
 * server reports how many companies it skipped.
 */
export function TrackerBulkBar({
  targets,
  canSetPriority,
  canSetDone,
  storageReady,
  pending,
  onRun,
  onClear,
}: {
  targets: MarkTarget[];
  canSetPriority: boolean;
  canSetDone: boolean;
  storageReady: boolean;
  pending: boolean;
  onRun: (targets: MarkTarget[], kind: MarkKind, active: boolean) => void;
  onClear: () => void;
}) {
  const count = targets.length;
  const disabled = pending || !storageReady;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="mb-3 flex items-stretch overflow-hidden rounded-xl border border-hairline"
      style={{
        background: "color-mix(in srgb, var(--color-surface-card) 82%, transparent)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        boxShadow: "0 8px 26px -10px rgba(15,23,42,0.28)",
      }}
    >
      {/* Brand accent rail — the one piece of colour marking the strip as a mode, not a row. */}
      <span aria-hidden className="w-[3px] shrink-0" style={{ background: "linear-gradient(180deg, var(--color-altus-red), var(--color-altus-red-deep))" }} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1.5 px-3 py-2">
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] font-black uppercase tracking-[0.09em] text-ink-strong">
          {pending && <Loader2 size={13} className="animate-spin text-altus-red" aria-hidden />}
          <span className="text-[15px] tabular-nums tracking-normal" data-testid="selected-count">
            {count}
          </span>
          selected
        </span>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-hairline" aria-hidden />

        {canSetPriority && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={disabled} className={chipBtn}>
                <Flag size={14} strokeWidth={2.2} />
                Priority
                <ChevronDown size={12} className="opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Priority for the selected…</DropdownMenuLabel>
              <DropdownMenuItem className="text-[13.5px]" onSelect={() => onRun(targets, "priority", true)}>
                <Flag size={15} /> Mark as priority
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[13.5px]" onSelect={() => onRun(targets, "priority", false)}>
                <Undo2 size={15} /> Remove priority
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canSetDone && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={disabled} className={chipBtn}>
                <CheckCircle2 size={14} strokeWidth={2.2} />
                Status
                <ChevronDown size={12} className="opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Status for the selected…</DropdownMenuLabel>
              <DropdownMenuItem className="text-[13.5px]" onSelect={() => onRun(targets, "done", true)}>
                <CheckCircle2 size={15} /> Collection done
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[13.5px]" onSelect={() => onRun(targets, "done", false)}>
                <Undo2 size={15} /> Undo collection done
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* Pinned right: Clear must stay reachable whatever the row holds. */}
      <div className="flex shrink-0 items-center border-l border-hairline px-2">
        <button type="button" onClick={onClear} aria-label="Clear selection" className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12px] font-semibold text-ink-subtle transition-colors hover:text-ink-strong">
          <X size={14} strokeWidth={2.4} />
          Clear
        </button>
      </div>
    </div>
  );
}

const chipBtn =
  "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-hairline-strong bg-white px-2 text-[12px] font-semibold text-ink-soft hover:border-altus-red hover:text-altus-red transition-colors disabled:opacity-50";
