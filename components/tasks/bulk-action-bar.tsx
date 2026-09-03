"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Flag,
  UserCog,
  Archive,
  Trash2,
  X,
  Loader2,
  ChevronDown,
  Tag,
  Building2,
  Gavel,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { fireToast } from "@/lib/toast";
import {
  bulkSetStatus,
  bulkSetPriority,
  bulkReassignDoer,
  bulkSetSubject,
  bulkSetClient,
  bulkSetApprovalStatus,
  bulkArchive,
  bulkDelete,
} from "@/app/(app)/tasks/actions";
import {
  DOER_TASK_STATUSES,
  TASK_PRIORITIES,
  PRIORITY_LABELS,
  type TaskStatus,
  type TaskPriority,
} from "@/db/enums";

type BulkResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string };

/**
 * The manager's rulings, grouped apart from Doer Status on purpose: these five
 * entries write TWO DIFFERENT COLUMNS. Hold and Done are points on the doer's
 * lifecycle (`status`); Approved / Not Approved / Cancelled are the manager's
 * verdict on finished work (`approval_status`). Collapsing the two axes into
 * one dropdown is the mistake the split column exists to prevent.
 */
const MANAGER_ACTIONS = [
  { label: "Mark Hold On", kind: "status", value: "on_hold" },
  { label: "Mark Approved", kind: "approval", value: "approved" },
  { label: "Mark Not Approved", kind: "approval", value: "not_approved" },
  { label: "Mark Done", kind: "status", value: "done" },
  { label: "Mark Cancelled", kind: "approval", value: "cancelled" },
] as const;

/**
 * Floating toolbar shown when at least one task is selected in the list.
 *
 * The control order is a contract, left to right:
 *
 *   [N] selected - Doer Status - Priority - Reassign - Subject - Client -
 *   Manager Status - Archive - Delete            (Clear, pinned right)
 *
 * Doer-facing edits first, then the manager's ruling, then the two destructive
 * actions. Subject and Client appear only when there are values to offer.
 *
 * The strip is ONE LINE and never wraps - a wrapped bulk bar reflows the table
 * under it every time the selection changes. It scrolls horizontally instead.
 *
 * Permissions mirror the single-task actions; the server re-checks regardless,
 * and every action reports how many rows it skipped.
 */
export function BulkActionBar({
  selectedIds,
  employees,
  subjects = [],
  clients = [],
  isAdmin,
  statusLabels,
  onClear,
}: {
  selectedIds: string[];
  employees: { id: string; name: string }[];
  subjects?: string[];
  clients?: string[];
  isAdmin: boolean;
  statusLabels: Record<TaskStatus, string>;
  onClear: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const count = selectedIds.length;

  function run(verb: string, fn: () => Promise<BulkResult>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        fireToast({ message: res.error });
        return;
      }
      fireToast({
        message:
          res.skipped > 0
            ? `${verb} ${res.updated} task${res.updated === 1 ? "" : "s"} — ${res.skipped} skipped (no permission or no change).`
            : `${verb} ${res.updated} task${res.updated === 1 ? "" : "s"}.`,
      });
      onClear();
      router.refresh();
    });
  }

  return (
    <div
      className="sticky top-[150px] z-30 mb-3 flex items-stretch overflow-hidden rounded-section border border-hairline max-md:top-[120px]"
      style={{
        // Blurred, translucent card so the rows scrolling beneath stay
        // legible as texture without competing with the controls.
        background: "color-mix(in srgb, var(--color-surface-card) 82%, transparent)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        boxShadow: "0 8px 26px -10px rgba(15,23,42,0.28)",
      }}
      role="region"
      aria-label="Bulk actions"
    >
      {/* Brand accent rail - the one piece of colour that marks the strip as a
          mode, not another row of the table. */}
      <span
        aria-hidden
        className="w-[3px] shrink-0"
        style={{
          background:
            "linear-gradient(180deg, var(--color-altus-red), var(--color-altus-red-deep))",
        }}
      />

      {/* Scroller. `min-w-0` is load-bearing: without it the flex child refuses
          to shrink and the bar widens the page instead of scrolling. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3.5 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] font-black uppercase tracking-[0.09em] text-ink-strong">
          {pending && <Loader2 size={13} className="animate-spin text-altus-red" />}
          <span className="text-[15px] tabular-nums tracking-normal">{count}</span>
          selected
        </span>

        <span className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden />

        {/* Doer Status - the worker's progress report */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={chipBtn}>
              <CheckCircle2 size={14} strokeWidth={2.2} />
              Doer Status
              <ChevronDown size={13} className="opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Set doer status to…</DropdownMenuLabel>
            {DOER_TASK_STATUSES.map((s) => (
              <DropdownMenuItem
                key={s}
                onSelect={() => run("Updated", () => bulkSetStatus(selectedIds, s))}
              >
                {statusLabels[s] ?? s}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={chipBtn}>
              <Flag size={14} strokeWidth={2.2} />
              Priority
              <ChevronDown size={13} className="opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Set priority to…</DropdownMenuLabel>
            {TASK_PRIORITIES.map((p) => (
              <DropdownMenuItem
                key={p}
                onSelect={() =>
                  run("Updated", () => bulkSetPriority(selectedIds, p as TaskPriority))
                }
              >
                {PRIORITY_LABELS[p]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Reassign */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={chipBtn}>
              <UserCog size={14} strokeWidth={2.2} />
              Reassign
              <ChevronDown size={13} className="opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Reassign doer to…</DropdownMenuLabel>
            {employees.map((e) => (
              <DropdownMenuItem
                key={e.id}
                onSelect={() => run("Reassigned", () => bulkReassignDoer(selectedIds, e.id))}
              >
                {e.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Subject - only when there is something to offer */}
        {subjects.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={pending} className={chipBtn}>
                <Tag size={14} strokeWidth={2.2} />
                Subject
                <ChevronDown size={13} className="opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Set subject to…</DropdownMenuLabel>
              {subjects.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => run("Updated", () => bulkSetSubject(selectedIds, s))}
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Client */}
        {clients.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={pending} className={chipBtn}>
                <Building2 size={14} strokeWidth={2.2} />
                Client
                <ChevronDown size={13} className="opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Set client to…</DropdownMenuLabel>
              {clients.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onSelect={() => run("Updated", () => bulkSetClient(selectedIds, c))}
                >
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isAdmin && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden />

            {/* Manager Status - the verdict, a different column */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={pending} className={chipBtn}>
                  <Gavel size={14} strokeWidth={2.2} />
                  Manager Status
                  <ChevronDown size={13} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                <DropdownMenuLabel>Manager ruling…</DropdownMenuLabel>
                {MANAGER_ACTIONS.map((a) => (
                  <DropdownMenuItem
                    key={a.label}
                    onSelect={() =>
                      run("Updated", () =>
                        a.kind === "status"
                          ? bulkSetStatus(selectedIds, a.value as TaskStatus)
                          : bulkSetApprovalStatus(selectedIds, a.value),
                      )
                    }
                  >
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden />

            {/* Destructive, last */}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(`Archive ${count} task${count === 1 ? "" : "s"}?`)) {
                  run("Archived", () => bulkArchive(selectedIds));
                }
              }}
              className={chipBtn}
            >
              <Archive size={14} strokeWidth={2.2} />
              Archive
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (
                  confirm(
                    `Permanently delete ${count} task${count === 1 ? "" : "s"}?\n\nThis removes the tasks and their history and cannot be undone.`,
                  )
                ) {
                  run("Deleted", () => bulkDelete(selectedIds));
                }
              }}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong px-3 py-1.5 text-[13px] font-bold text-red-deep transition-colors hover:bg-red/8 disabled:opacity-50"
            >
              <Trash2 size={14} strokeWidth={2.2} />
              Delete
            </button>
          </>
        )}
      </div>

      {/* Pinned right, OUTSIDE the scroller - Clear must stay reachable no
          matter how far the controls have scrolled. */}
      <div className="flex shrink-0 items-center border-l border-hairline px-2">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1.5 text-[13px] font-semibold text-ink-subtle transition-colors hover:text-ink-strong"
        >
          <X size={14} strokeWidth={2.4} />
          Clear
        </button>
      </div>
    </div>
  );
}

const chipBtn =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong px-3 py-1.5 text-[13px] font-bold text-ink-soft hover:border-altus-red hover:text-altus-red transition-colors disabled:opacity-50";
