"use client";

import * as React from "react";
import {
  ChevronDown,
  CheckCircle2,
  Copy,
  Eye,
  Flag,
  Gavel,
  Loader2,
  Pencil,
  Trash2,
  UserCog,
  UserRound,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { TASK_PRIORITIES, PRIORITY_LABELS, type TaskPriority } from "@/db/enums";
import {
  PLAN_STATUS_LABEL,
  PLAN_RESTRICTED_STATUSES,
  PLAN_WORKING_STATUSES,
  type PlanRestrictedStatusChoice,
  type PlanWorkingStatus,
} from "@/lib/plan/status";
import { PLAN_RED } from "./theme";

/**
 * The selection bar — the actions a set of ticked plan rows can take.
 *
 * ONE bar for both plan surfaces, and the SAME shape as the task list's:
 * quick row actions first, then the doer-facing edits, then the manager's
 * ruling, then the one destructive action, with Clear pinned right and
 * OUTSIDE the scroller so it stays reachable however far the strip has
 * scrolled. The plan had a four-button strip while the task list had this;
 * ticking rows in the two places offered you different work for no reason
 * anybody could state.
 *
 *   [N] selected · View detail · Edit · Duplicate · Owner · Doer Status ·
 *   Priority · Reassign · Initiator Status · Delete          (Clear, right)
 *
 * ONE LINE, never wrapping — a wrapped bar reflows the table beneath it every
 * time the selection changes. It scrolls horizontally instead.
 *
 * It takes handlers rather than ids: the two tables select over different row
 * shapes, and the bar has no business knowing which. Initiator Status is NOT
 * hidden from non-admins — a project's owner may rule on their own rows, the
 * server decides per row, and the count reports what it skipped.
 *
 * "Initiator Status" is what this menu has always written: `approval_status`,
 * the ruling of the person who RAISED the work. It was labelled "Manager
 * Status", which named a role the plan does not have — the table's own column
 * now says Initiator Status too, and a menu and a column that write the same
 * field must not call it two things.
 */

interface Props {
  count: number;
  employees: { id: string; name: string }[];
  /** Opening one row's detail needs exactly one row; omitted, it isn't shown. */
  onDetail?: () => void;
  /** Editing is one row at a time — the button is shut unless exactly one is
   *  ticked, the same rule View detail follows. */
  onEdit: () => void;
  onDuplicate: () => void;
  /** The Owner column is the row's INITIATOR — see the column note. */
  onOwner: (employeeId: string) => void;
  onStatus: (status: PlanWorkingStatus) => void;
  onPriority: (priority: TaskPriority) => void;
  /** The Doer — `project_nodes.owner_id`, which moves the task's doer too. */
  onReassign: (employeeId: string) => void;
  onInitiatorStatus: (status: PlanRestrictedStatusChoice) => void;
  onDelete: () => void;
  onClear: () => void;
  /** A write is in flight — every action but Clear stays shut. */
  busy?: boolean;
}

export function PlanBulkBar({
  count,
  employees,
  onDetail,
  onEdit,
  onDuplicate,
  onOwner,
  onStatus,
  onPriority,
  onReassign,
  onInitiatorStatus,
  onDelete,
  onClear,
  busy,
}: Props) {
  if (count === 0) return null;
  return (
    <div
      className="mb-3 flex items-stretch overflow-hidden rounded-section border border-hairline"
      style={{
        background: "var(--color-surface-card)",
        boxShadow: `0 8px 26px -12px color-mix(in srgb, ${PLAN_RED} 45%, rgba(15,23,42,0.28))`,
      }}
      role="region"
      aria-label="Bulk actions"
    >
      {/* The one piece of colour that marks the strip as a mode, not another
          row of the table. */}
      <span
        aria-hidden
        className="w-[3px] shrink-0"
        style={{
          background:
            "linear-gradient(180deg, var(--color-altus-red), var(--color-altus-red-deep))",
        }}
      />

      {/* `min-w-0` is load-bearing: without it the flex child refuses to
          shrink and the bar widens the page instead of scrolling. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3.5 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px] font-black uppercase tracking-[0.09em] text-ink-strong">
          {busy && <Loader2 size={13} className="animate-spin text-altus-red" />}
          <span className="text-[16px] tabular-nums tracking-normal">{count}</span>
          selected
        </span>

        <Divider />

        {onDetail && (
          <button
            type="button"
            onClick={onDetail}
            disabled={busy || count !== 1}
            title={count === 1 ? undefined : "Tick one row to open it"}
            className={chipBtn}
          >
            <Eye size={14} strokeWidth={2.2} />
            View detail
          </button>
        )}

        {/* Edit opens ONE row's form. There is no multi-row edit: a form that
            writes six fields across a dozen rows at once is how a whole branch
            gets a date nobody meant to give it. The per-field menus to the
            right are the deliberate way to change one thing across a
            selection. */}
        <button
          type="button"
          onClick={onEdit}
          disabled={busy || count !== 1}
          title={count === 1 ? undefined : "Tick one row to edit it"}
          className={chipBtn}
        >
          <Pencil size={14} strokeWidth={2.2} />
          Edit
        </button>

        <button type="button" onClick={onDuplicate} disabled={busy} className={chipBtn}>
          <Copy size={14} strokeWidth={2.2} />
          Duplicate
        </button>

        <Divider />

        <PickMenu
          icon={<UserRound size={14} strokeWidth={2.2} />}
          label="Owner"
          heading="Set owner to…"
          disabled={busy}
          options={employees.map((e) => ({ key: e.id, label: e.name }))}
          onPick={onOwner}
        />

        <PickMenu
          icon={<CheckCircle2 size={14} strokeWidth={2.2} />}
          label="Doer Status"
          heading="Set doer status to…"
          disabled={busy}
          options={PLAN_WORKING_STATUSES.map((s) => ({
            key: s,
            label: PLAN_STATUS_LABEL[s],
          }))}
          onPick={(v) => onStatus(v as PlanWorkingStatus)}
        />

        <PickMenu
          icon={<Flag size={14} strokeWidth={2.2} />}
          label="Priority"
          heading="Set priority to…"
          disabled={busy}
          options={TASK_PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABELS[p] }))}
          onPick={(v) => onPriority(v as TaskPriority)}
        />

        <PickMenu
          icon={<UserCog size={14} strokeWidth={2.2} />}
          label="Reassign"
          heading="Reassign doer to…"
          disabled={busy}
          options={employees.map((e) => ({ key: e.id, label: e.name }))}
          onPick={onReassign}
        />

        <Divider />

        {/* The verdict — a different column from Doer Status above, and the
            reason the two are never collapsed into one menu. */}
        <PickMenu
          icon={<Gavel size={14} strokeWidth={2.2} />}
          label="Initiator Status"
          heading="Initiator ruling…"
          disabled={busy}
          options={PLAN_RESTRICTED_STATUSES.map((s) => ({
            key: s,
            label: `Mark ${PLAN_STATUS_LABEL[s]}`,
          }))}
          onPick={(v) => onInitiatorStatus(v as PlanRestrictedStatusChoice)}
        />

        <Divider />

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong px-3 py-1.5 text-[14px] font-bold text-red-deep transition-colors hover:bg-red/8 disabled:opacity-50"
        >
          <Trash2 size={14} strokeWidth={2.2} />
          Delete
        </button>
      </div>

      {/* Pinned right, OUTSIDE the scroller — Clear must stay reachable no
          matter how far the controls have scrolled. */}
      <div className="flex shrink-0 items-center border-l border-hairline px-2">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1.5 text-[14px] font-semibold text-ink-subtle transition-colors hover:text-ink-strong"
        >
          <X size={14} strokeWidth={2.4} />
          Clear
        </button>
      </div>
    </div>
  );
}

function PickMenu({
  icon,
  label,
  heading,
  options,
  onPick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  heading: string;
  options: { key: string; label: string }[];
  onPick: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} className={chipBtn}>
          {icon}
          {label}
          <ChevronDown size={13} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>{heading}</DropdownMenuLabel>
        {options.length === 0 ? (
          <DropdownMenuItem disabled>Nothing to choose from</DropdownMenuItem>
        ) : (
          options.map((o) => (
            <DropdownMenuItem key={o.key} onSelect={() => onPick(o.key)}>
              {o.label}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden />;
}

const chipBtn =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-hairline-strong px-3 py-1.5 text-[14px] font-bold text-ink-soft hover:border-altus-red hover:text-altus-red transition-colors disabled:opacity-50";
