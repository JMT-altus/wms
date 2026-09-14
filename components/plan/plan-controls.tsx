"use client";

import * as React from "react";
import {
  ArrowDownUp,
  Columns3,
  Download,
  LayoutList,
  Layers,
  Plus,
  Rows3,
  SquareKanban,
  Table2,
} from "lucide-react";
import { KIND_LABEL_PLURAL, PLAN_KINDS, KIND_DEPTH } from "@/lib/plan/levels";
import type { PlanSort } from "@/lib/plan/table";
import { PLAN_RED, TABULAR } from "./theme";

/**
 * The band of controls above the plan table.
 *
 * Everything here narrows or re-shapes what the table below already has in
 * memory — no control on this row costs a round-trip, which is why they can
 * all sit together instead of behind an "Apply".
 */

export type PlanView = "list" | "kanban" | "table";

interface ProjectOption {
  id: string;
  name: string;
  ref: string;
}

interface Props {
  view: PlanView;
  onView: (v: PlanView) => void;

  projectId: string | null;
  onProject: (id: string | null) => void;
  projects: ProjectOption[];

  /** "Show down to…" — the deepest KIND_DEPTH to render, or null for all. */
  maxDepth: number | null;
  onMaxDepth: (d: number | null) => void;

  sort: PlanSort;
  onSort: (s: PlanSort) => void;

  /** Page size, or null for every row. Omitted where the view has no rows. */
  rows?: number | null;
  onRows?: (n: number | null) => void;

  /** Omitted on views that have no column model of their own. */
  visibleColumns?: number;
  totalColumns?: number;
  onColumns?: () => void;
  columnsOpen?: React.ReactNode;

  /** Omitted where there is nothing to export. */
  onExport?: () => void;
  onNew: () => void;
  newLabel: string;
}

const ROW_SIZES: (number | null)[] = [25, 50, 100, null];

export function PlanControls({
  view,
  onView,
  projectId,
  onProject,
  projects,
  maxDepth,
  onMaxDepth,
  sort,
  onSort,
  rows,
  onRows,
  visibleColumns,
  totalColumns,
  onColumns,
  columnsOpen,
  onExport,
  onNew,
  newLabel,
}: Props) {
  return (
    <div
      className="mb-3 rounded-xl px-2.5 py-2"
      style={{
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline-strong)",
      }}
    >
      {/* ONE LINE, always. `flex-wrap` let Export drop to a second row the
          moment the window narrowed, which turned a control strip into two
          bands of unequal weight. Nowrap plus a hidden-bar scroll keeps the
          row intact and lets a narrow window reach the far end by dragging. */}
      <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto">
        {/* The three ways of looking at the same rows. */}
        <div
          className="inline-flex shrink-0 rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--color-hairline-strong)" }}
        >
          <ViewBtn active={view === "list"} onClick={() => onView("list")}>
            <LayoutList size={13} strokeWidth={2.4} />
            List
          </ViewBtn>
          <ViewBtn active={view === "kanban"} onClick={() => onView("kanban")}>
            <SquareKanban size={13} strokeWidth={2.4} />
            Kanban
          </ViewBtn>
          <ViewBtn active={view === "table"} onClick={() => onView("table")}>
            <Table2 size={13} strokeWidth={2.4} />
            Table
          </ViewBtn>
        </div>

        <button
          type="button"
          onClick={onNew}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 h-8 text-[13px] font-bold whitespace-nowrap"
          style={{
            color: PLAN_RED,
            background: "transparent",
            border: `1px solid color-mix(in srgb, ${PLAN_RED} 40%, transparent)`,
          }}
        >
          <Plus size={13} strokeWidth={2.8} />
          {newLabel}
        </button>

        <Picker
          icon={<Layers size={13} strokeWidth={2.4} />}
          value={projectId ?? ""}
          onChange={(v) => onProject(v || null)}
          ariaLabel="Filter by project"
          width={124}
        >
          <option value="">All projects ({projects.length})</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ref} · {p.name}
            </option>
          ))}
        </Picker>

        <Picker
          icon={<Layers size={13} strokeWidth={2.4} />}
          value={maxDepth == null ? "" : String(maxDepth)}
          onChange={(v) => onMaxDepth(v === "" ? null : Number(v))}
          ariaLabel="Show down to"
          width={112}
        >
          <option value="">Show down to…</option>
          {PLAN_KINDS.map((k) => (
            <option key={k} value={KIND_DEPTH[k]}>
              {KIND_LABEL_PLURAL[k]}
            </option>
          ))}
        </Picker>

        <Picker
          icon={<ArrowDownUp size={13} strokeWidth={2.4} />}
          value={sort}
          onChange={(v) => onSort(v as PlanSort)}
          ariaLabel="Sort"
          width={94}
        >
          <option value="plan">Plan order</option>
          <option value="name">Name A–Z</option>
          <option value="target">Target date</option>
          <option value="owner">Doer</option>
        </Picker>

        <span className="flex-1 min-w-0" />

        {onRows && (
        <Picker
          icon={<Rows3 size={13} strokeWidth={2.4} />}
          value={rows == null ? "" : String(rows)}
          onChange={(v) => onRows(v === "" ? null : Number(v))}
          ariaLabel="Rows per page"
          width={66}
        >
          {ROW_SIZES.map((n) => (
            <option key={String(n)} value={n == null ? "" : n}>
              {n == null ? "All" : n}
            </option>
          ))}
        </Picker>
        )}

        {onColumns && (
          <div className="relative shrink-0">
            <Btn onClick={onColumns}>
              <Columns3 size={13} strokeWidth={2.4} />
              Columns{" "}
              <span style={TABULAR}>
                {visibleColumns}/{totalColumns}
              </span>
            </Btn>
            {columnsOpen}
          </div>
        )}

        {onExport && (
          <Btn onClick={onExport}>
            <Download size={13} strokeWidth={2.4} />
            Export
          </Btn>
        )}
      </div>
    </div>
  );
}

function ViewBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1 px-2.5 h-8 text-[13px] font-bold whitespace-nowrap"
      style={
        active
          ? { background: PLAN_RED, color: "#fff" }
          : { color: "var(--color-ink)", background: "var(--color-surface-card)" }
      }
    >
      {children}
    </button>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 h-8 text-[13px] font-semibold whitespace-nowrap"
      style={{
        color: "var(--color-ink)",
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline-strong)",
      }}
    >
      {children}
    </button>
  );
}

/** A select with a leading glyph, so the row reads as controls not fields. */
function Picker({
  icon,
  value,
  onChange,
  ariaLabel,
  width,
  children,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  /** Fixed, so one long option cannot widen the whole row. */
  width: number;
  children: React.ReactNode;
}) {
  return (
    <label
      className="inline-flex shrink-0 items-center gap-1 rounded-lg pl-2 pr-0.5 h-8"
      style={{
        color: "var(--color-ink)",
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline-strong)",
      }}
    >
      <span aria-hidden style={{ color: "var(--color-ink-subtle)" }}>
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="bg-transparent pr-0.5 text-[13px] font-semibold outline-none"
        style={{ color: "var(--color-ink)", width }}
      >
        {children}
      </select>
    </label>
  );
}
