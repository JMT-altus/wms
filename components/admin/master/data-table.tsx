"use client";
import * as React from "react";
import { FullscreenToggle } from "@/components/masters/fullscreen-toggle";
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  ChevronDown,
  Columns3,
  Eye,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  FileText,
  FileType2,
  Power,
  SlidersHorizontal,
} from "lucide-react";

/**
 * The one table every master-data page uses: search, per-column filters,
 * pagination and CSV export.
 *
 * Client-side because the master sets here are small (hundreds, not millions) —
 * paginating in the browser keeps every page a single query and makes search
 * instant. If a master ever grows past a few thousand rows this needs to move
 * to a cursor query like lib/queries/tasks.ts `listTasksPage`.
 */

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. Falls back to `String(row[key])`. */
  render?: (row: T) => React.ReactNode;
  /** Value used for search + CSV export. Falls back to the same. */
  value?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  width?: number;
  /**
   * Start unticked in the Columns menu.
   *
   * For tables that carry every field of a record but only a handful are
   * worth a column by default. The data is still there — searchable,
   * exportable, and shown in full in the row detail — it just is not taking
   * up width until someone asks for it.
   */
  defaultHidden?: boolean;
}

export interface FilterDef<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  matches: (row: T, value: string) => boolean;
}

/**
 * A sort the caller offers. The comparator lives with the caller because only
 * it knows which of its columns are dates, numbers or collated text.
 */
export interface SortDef<T> {
  value: string;
  label: string;
  compare: (a: T, b: T) => number;
}

const PAGE_SIZES = [25, 50, 100];

/**
 * Confirmation for a delete.
 *
 * A real dialog rather than `window.confirm`: the native one is unstyled, its
 * wording is at the browser's mercy, and on some it can be suppressed
 * entirely with a "don't show me again" checkbox — which would turn the one
 * irreversible action in this table into a single unguarded click.
 *
 * Cancel is focused on open and Escape closes, so the safe answer is the one
 * you get by reflex. Deleting takes a deliberate click.
 */
export function ConfirmDelete({
  count,
  noun,
  busy,
  accent,
  subject,
  heading,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  count: number;
  noun: string;
  busy: boolean;
  /**
   * Names the one thing being destroyed, shown instead of the count.
   * "Purchase Contact" is a better warning than "1 option selected" when
   * there is exactly one and the user picked it by name.
   */
  subject?: string;
  /** Override for a destructive action that is not literally a delete. */
  heading?: string;
  body?: string;
  confirmLabel?: string;
  /**
   * The screen's accent, so the dialog belongs to the screen it opened from
   * rather than introducing a colour of its own. Passed in rather than
   * hardcoded red: this table is shared, and each module has its own hue.
   */
  accent: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, busy]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm delete"
    >
      <div
        className="w-full max-w-[460px] rounded-section bg-surface-card px-6 py-6"
        style={{
          border: "1px solid var(--color-ink-strong)",
          boxShadow: `0 3px 0 0 ${accent}, 0 30px 60px -20px rgba(15,23,42,0.4)`,
        }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="shrink-0 grid place-items-center rounded-full"
            style={{
              width: 38,
              height: 38,
              background: `color-mix(in srgb, ${accent} 10%, transparent)`,
              color: accent,
            }}
          >
            <AlertTriangle size={19} strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <h2
              className="font-bold text-ink-strong"
              style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 18 }}
            >
              {heading ?? "Are you sure you want to permanently delete this?"}
            </h2>
            <p className="mt-1.5 text-ink-muted" style={{ fontSize: 13.5 }}>
              {body ?? "This cannot be restored later."}
            </p>
            {/* What is about to go, stated separately from the warning rather
                than buried in it — the name (or the count) is exactly what a
                mis-click gets wrong. */}
            <p className="mt-2 font-semibold text-ink-soft" style={{ fontSize: 13 }}>
              {subject ? `"${subject}"` : `${count} ${count === 1 ? noun : `${noun}s`} selected.`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-chip px-4 h-10 text-[14px] font-semibold text-ink-soft border border-hairline disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-chip px-5 h-10 text-[14px] font-bold text-white disabled:opacity-60"
            style={{ background: accent }}
          >
            {busy ? "Working…" : (confirmLabel ?? "Delete permanently")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One record flattened to label/value text.
 *
 * Both exporters below work from this rather than from the rendered cells:
 * `render` returns React nodes — pills, icons, coloured spans — which are
 * meaningless in a document. `value` is the plain text the table already uses
 * for search and CSV, so a record reads the same everywhere it is exported.
 */
function recordPairs<T>(row: T, columns: Column<T>[]): { label: string; value: string }[] {
  return columns.map((c) => {
    const raw = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
    const text =
      raw === null || raw === undefined || raw === "" ? "—" : String(raw);
    return { label: c.header, value: text };
  });
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The record as a standalone HTML document.
 *
 * Shared by the PDF and Word buttons because both want the same thing — the
 * record, laid out, without the app's chrome. Inline styles only: a print
 * window and Word both arrive without our stylesheet.
 */
function recordDocument(title: string, pairs: { label: string; value: string }[]): string {
  const rows = pairs
    .map(
      (p) =>
        `<tr><th align="left" style="padding:6px 12px 6px 0;font:600 11px Arial,sans-serif;` +
        `text-transform:uppercase;letter-spacing:.06em;color:#64748b;white-space:nowrap;` +
        `vertical-align:top">${escapeHtml(p.label)}</th>` +
        `<td style="padding:6px 0;font:14px Arial,sans-serif;color:#0f172a">${escapeHtml(p.value)}</td></tr>`,
    )
    .join("");
  return (
    `<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:24px">` +
    `<h1 style="font:700 20px Arial,sans-serif;color:#0f172a;margin:0 0 16px">${escapeHtml(title)}</h1>` +
    `<table style="border-collapse:collapse;width:100%">${rows}</table>` +
    `</body></html>`
  );
}

/**
 * Read-only detail popup for one row.
 *
 * Generic on purpose: it lays out every column the caller declared, so a
 * screen gains this by passing `rowDetail` and writes no markup of its own.
 * ALL columns are shown, including ones currently hidden by the Columns menu
 * — hiding a column tidies the table, it does not mean the field stopped
 * being part of the record.
 */
function RowDetail<T extends { id: string }>({
  row,
  columns,
  title,
  accent,
  onClose,
  onEdit,
  onDeactivate,
  deactivateLabel,
}: {
  row: T;
  columns: Column<T>[];
  title: string;
  accent: string;
  onClose: () => void;
  /** Hands this record to the table's edit dialog. Hidden when absent. */
  onEdit?: () => void;
  /**
   * Flips the record's active flag. Only the Client Master carries one today,
   * so the button appears only where a table actually supports it rather than
   * sitting greyed out on the five that do not.
   */
  onDeactivate?: () => void;
  /** "Deactivate" or "Activate", depending on where the record currently is. */
  deactivateLabel?: string;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while this is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onMouseDown={(e) => {
        // Only a click on the backdrop itself closes — not one that started
        // inside the panel and drifted out while selecting text.
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Same treatment as the panel inside it: dark outline, accent line
          under the bottom edge. The accent shadow is listed FIRST so it draws
          against the panel; the soft drop shadow spreads behind both. */}
      <div
        className="w-full max-w-[820px] max-h-[86vh] flex flex-col rounded-section bg-surface-card"
        style={{
          border: "1px solid var(--color-ink-strong)",
          boxShadow: `0 3px 0 0 ${accent}, 0 30px 60px -20px rgba(15,23,42,0.4)`,
        }}
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-4">
          <h2
            className="flex-1 min-w-0 font-bold text-ink-strong truncate"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 20 }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 grid place-items-center rounded-full text-ink-subtle hover:text-ink-strong"
            style={{ width: 30, height: 30 }}
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5">
          {/* The panel carries a dark outline with an accent line tucked
              under its bottom edge — `box-shadow` rather than a border, so
              the line follows the corner radius instead of squaring it off,
              and adds no height that would shift the layout. */}
          <div
            className="rounded-section px-5 py-5 grid gap-x-4 gap-y-4 grid-cols-1 sm:grid-cols-2"
            style={{
              border: "1px solid var(--color-ink-strong)",
              boxShadow: `0 3px 0 0 ${accent}`,
            }}
          >
            {columns.map((c) => (
              <div key={c.key} className="min-w-0">
                <span
                  className="block uppercase font-bold tracking-[0.08em] text-ink-subtle"
                  style={{ fontSize: 10.5 }}
                >
                  {c.header}
                </span>
                <div
                  className="mt-1.5 rounded-chip px-3 py-2 text-ink-strong break-words"
                  style={{ fontSize: 13.5, background: "var(--color-surface-soft)" }}
                >
                  {c.render ? c.render(row) : <Dash />}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="flex items-center gap-2 flex-wrap px-6 py-4"
          style={{ borderTop: "1px solid var(--color-hairline)" }}
        >
          {/* Deactivate sits apart on the left. It is the one button here that
              changes the record rather than reading it, and putting it next to
              Edit is how someone means to click Edit and deactivates a client
              instead. */}
          {onDeactivate && (
            <button
              type="button"
              onClick={onDeactivate}
              className="rounded-chip px-4 h-10 text-[14px] font-bold"
              style={{
                color: "var(--color-red-deep)",
                border: "1px solid color-mix(in srgb, var(--color-red) 40%, transparent)",
                background: "var(--color-surface-card)",
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Power size={15} strokeWidth={2.5} />
                {deactivateLabel ?? "Deactivate"}
              </span>
            </button>
          )}

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* Printing rather than generating a PDF: the browser's own print
                dialog already offers "Save as PDF", renders the page's own
                fonts, and costs no dependency. A PDF library would be ~300kB
                to reproduce what every browser does natively. */}
            <button
              type="button"
              onClick={() => {
                const doc = recordDocument(title, recordPairs(row, columns));
                const w = window.open("", "_blank", "width=820,height=900");
                if (!w) return;
                w.document.write(doc);
                w.document.close();
                w.focus();
                // Give the new document a tick to lay out; printing an empty
                // window is what happens without it.
                setTimeout(() => w.print(), 150);
              }}
              className="rounded-chip px-4 h-10 text-[14px] font-bold text-ink-soft bg-surface-card border border-hairline-strong"
            >
              <span className="inline-flex items-center gap-1.5">
                <FileText size={15} strokeWidth={2.3} />
                PDF
              </span>
            </button>

            {/* A .doc of Word-flavoured HTML, which Word opens and formats.
                Not a real .docx — that needs a zip writer and an OOXML part
                tree — but it opens, prints and edits, which is the whole ask. */}
            <button
              type="button"
              onClick={() => {
                const doc = recordDocument(title, recordPairs(row, columns));
                const blob = new Blob(["\ufeff", doc], { type: "application/msword" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${title.replace(/[^\w\s-]/g, "").trim() || "record"}.doc`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded-chip px-4 h-10 text-[14px] font-bold text-ink-soft bg-surface-card border border-hairline-strong"
            >
              <span className="inline-flex items-center gap-1.5">
                <FileType2 size={15} strokeWidth={2.3} />
                Word
              </span>
            </button>

            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-chip px-5 h-10 text-[14px] font-bold text-white"
                style={{ background: accent }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Pencil size={15} strokeWidth={2.5} />
                  Edit
                </span>
              </button>
            )}
            {!onEdit && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-chip px-5 h-10 text-[14px] font-bold text-white"
                style={{ background: accent }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Columns" menu: tick a column to show it, untick to hide it.
 *
 * A plain popover rather than a library dropdown — this is the only menu in
 * the table and pulling in a headless-menu dependency for it would cost more
 * than it saves. Closes on outside click and on Escape, and the trigger is a
 * real button so the keyboard reaches it.
 *
 * The last visible column cannot be unticked: a table with no columns is not
 * a state anyone means to reach, and there would be nothing left to click to
 * get back out of it.
 */
function ColumnPicker<T>({
  columns,
  hidden,
  onToggle,
  onReset,
  height,
  accent,
}: {
  columns: Column<T>[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onReset: () => void;
  height: string;
  accent: string;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const shownCount = columns.length - hidden.size;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Show or hide columns"
        className={`inline-flex items-center gap-1 rounded-pill px-2 ${height} text-[11.5px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap`}
      >
        <Columns3 size={13} strokeWidth={2.3} className="shrink-0" />
        Columns
        {hidden.size > 0 && (
          <span className="tabular-nums font-bold" style={{ color: accent }}>
            {shownCount}/{columns.length}
          </span>
        )}
        <ChevronDown size={13} strokeWidth={2.6} className="shrink-0 text-ink-subtle" />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1.5 rounded-section bg-surface-card border border-hairline py-1.5"
          style={{ minWidth: 210, boxShadow: "0 12px 28px -12px rgba(15,23,42,0.25)" }}
        >
          <div className="max-h-[320px] overflow-y-auto">
            {columns.map((c) => {
              const shown = !hidden.has(c.key);
              const last = shown && shownCount === 1;
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={last}
                  onClick={() => onToggle(c.key)}
                  title={last ? "At least one column has to stay visible" : undefined}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-soft disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span
                    aria-hidden
                    className="grid place-items-center rounded-[5px] shrink-0"
                    style={{
                      width: 16,
                      height: 16,
                      background: shown ? accent : "var(--color-surface-card)",
                      border: `1.5px solid ${shown ? accent : "var(--color-hairline-strong)"}`,
                    }}
                  >
                    {shown && <Check size={11} strokeWidth={3.2} className="text-white" />}
                  </span>
                  <span className="truncate">{c.header}</span>
                </button>
              );
            })}
          </div>
          {hidden.size > 0 && (
            <div className="mt-1 pt-1.5 px-3" style={{ borderTop: "1px solid var(--color-hairline)" }}>
              <button
                type="button"
                onClick={onReset}
                className="text-[12.5px] font-semibold underline underline-offset-2 text-ink-subtle hover:text-ink-strong"
              >
                Show all columns
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The rounded-square tick box used by the selection column.
 *
 * A real `<input type="checkbox">` underneath, sized to fill the box and made
 * transparent, so keyboard focus, the space bar, screen readers and the
 * indeterminate state all work without being reimplemented. Only the paint is
 * ours.
 */
function TickBox({
  checked,
  indeterminate = false,
  onChange,
  label,
  accent,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  accent: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  const on = checked || indeterminate;
  return (
    <span className="relative inline-grid place-items-center align-middle" style={{ width: 20, height: 20 }}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer peer"
        style={{ margin: 0 }}
      />
      <span
        aria-hidden
        className="pointer-events-none grid place-items-center rounded-[6px] peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1"
        style={{
          width: 18,
          height: 18,
          background: checked ? accent : "var(--color-surface-card)",
          border: `1.5px solid ${on ? accent : "var(--color-hairline-strong)"}`,
        }}
      >
        {checked && <Check size={12} strokeWidth={3.2} className="text-white" />}
        {indeterminate && !checked && (
          <span style={{ width: 9, height: 2, borderRadius: 1, background: accent }} />
        )}
      </span>
    </span>
  );
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  filters = [],
  searchPlaceholder = "Search…",
  csvName = "export",
  onNew,
  newLabel = "New",
  extraActions,
  actions,
  emptyTitle = "Nothing here yet.",
  emptySub,
  accent = "#0A6CFF",
  title,
  sorts,
  exportLabel = "CSV",
  tintHeader = false,
  headerActions,
  countNoun,
  selectable = false,
  selectionActions,
  rowDetail = false,
  rowDetailTitle,
  onBulkDelete,
  deleteNoun = "row",
  onEdit,
  onToggleActive,
  fullscreen = false,
  exportable = true,
}: {
  rows: T[];
  columns: Column<T>[];
  filters?: FilterDef<T>[];
  searchPlaceholder?: string;
  csvName?: string;
  onNew?: () => void;
  newLabel?: string;
  /** Toolbar controls that sit left of CSV — e.g. the Masters bulk upload. */
  extraActions?: React.ReactNode;
  /** Per-row trailing controls (edit / delete). */
  actions?: (row: T) => React.ReactNode;
  emptyTitle?: string;
  emptySub?: string;
  accent?: string;
  /**
   * Opt into the two-row Masters chrome: title + search + sort + actions on
   * one line, then a labelled filter strip below. Omitted, the toolbar renders
   * as it always has, so the /master-setup screens are untouched.
   */
  title?: string;
  sorts?: SortDef<T>[];
  exportLabel?: string;
  tintHeader?: boolean;
  /**
   * Extra control(s) in the top-right corner of the title row, next to New —
   * e.g. Customer Master's Full Screen button. Opt-in and title-mode only:
   * omitted, row 1 renders exactly as it always has.
   */
  headerActions?: React.ReactNode;
  /**
   * Word after the row count, e.g. "clients" → "243 clients". Omitted, the
   * count renders as the bare number every existing screen already shows.
   */
  countNoun?: string;
  /**
   * Opt into a leading checkbox column with select-all in the header.
   *
   * Opt-in rather than always-on: every existing screen would otherwise gain
   * a column it never asked for, shifting each table one cell to the right.
   *
   * Selection is a filter on the export, not a staging area for a destructive
   * action — tick rows, hit Export, get those rows. Deliberately no bulk
   * delete: this table is shared with the Masters module, and handing every
   * screen that uses it an untested mass-delete is not a side effect worth
   * shipping.
   */
  selectable?: boolean;
  /**
   * Buttons for the bar that appears above the table once rows are ticked —
   * whatever THIS screen can actually do to a set of rows. Receives the
   * selected rows and a `clear` callback to reset the selection after a
   * successful action.
   *
   * A slot rather than a fixed Edit/Delete pair: this table is shared with
   * the Masters and Admin screens, and there is no bulk action that is
   * correct for all of them. Screens that pass nothing still get the count,
   * Export selected and Clear, which are the two that always make sense.
   */
  selectionActions?: (ctx: { rows: T[]; clear: () => void }) => React.ReactNode;
  /**
   * Opt into the read-only detail popup: click a row to see every field of it
   * laid out, including columns currently hidden.
   *
   * Opt-in because the Masters screens already open their own edit drawer
   * from a row menu, and a second thing happening on row click would fight
   * with it.
   */
  rowDetail?: boolean;
  /** Heading for that popup. Defaults to the first column's value. */
  rowDetailTitle?: (row: T) => string;
  /**
   * Delete the selected rows for real. Passing this is what puts a Delete
   * button in the selection bar — a screen with no safe bulk delete simply
   * omits it and gets no button, rather than one that fails.
   *
   * The table handles the confirmation and the busy state; the caller does
   * the deleting and refreshes.
   */
  onBulkDelete?: (rows: T[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Singular noun in the confirmation, e.g. "contact" → "Delete 3 contacts?" */
  deleteNoun?: string;
  /**
   * Edit the one selected row. Passing this is what puts an Edit button in
   * the selection bar; the caller owns whatever opens.
   */
  onEdit?: (row: T) => void;
  /**
   * Flip a record's active flag from the detail popup.
   *
   * Optional because only some tables have an `isActive` to flip — the Client
   * KYC directories for contacts, addresses and banks do not — and a button
   * that cannot work is worse than one that is not there.
   */
  onToggleActive?: (row: T) => void;
  /**
   * Put a "Full screen" button beside the search bar. Title mode only — the
   * legacy toolbar has no header row to put it in.
   */
  fullscreen?: boolean;
  /**
   * Whether this screen offers CSV export at all — the toolbar button and the
   * selection bar's "Export selected" together, since they are one feature
   * behind two entry points.
   *
   * Defaults on: every screen that had export before this prop existed keeps
   * it without being changed.
   */
  exportable?: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [sortValue, setSortValue] = React.useState(sorts?.[0]?.value ?? "");
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  // Seeded from the columns' own `defaultHidden`, so a table can carry far
  // more fields than it opens with.
  const defaultHidden = React.useMemo(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
    [columns],
  );
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(defaultHidden);

  /* ── Column order ────────────────────────────────────────────────────────
     Held as a list of keys rather than a reordered copy of `columns`, so the
     caller's array stays the source of truth for what each column IS and this
     only decides where it sits. */
  const [order, setOrder] = React.useState<string[]>(() => columns.map((c) => c.key));
  const [dragKey, setDragKey] = React.useState<string | null>(null);
  const [detailRow, setDetailRow] = React.useState<T | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [overKey, setOverKey] = React.useState<string | null>(null);

  // Keep the order in step if the caller's columns change shape (a screen that
  // adds a column, or swaps its column set on a tab change). Reconciled DURING
  // render, the same way `page` is below: an effect would paint one frame with
  // a column missing or duplicated first.
  const columnSig = columns.map((c) => c.key).join("|");
  const [lastColumnSig, setLastColumnSig] = React.useState(columnSig);
  if (columnSig !== lastColumnSig) {
    setLastColumnSig(columnSig);
    const keys = columns.map((c) => c.key);
    // Keep the user's arrangement for columns that survived; append anything
    // new on the end rather than dropping their ordering wholesale.
    setOrder((prev) => [...prev.filter((k) => keys.includes(k)), ...keys.filter((k) => !prev.includes(k))]);
  }

  const orderedColumns = React.useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const out = order.map((k) => byKey.get(k)).filter((c): c is Column<T> => Boolean(c));
    // Belt and braces: anything the order somehow missed still renders.
    for (const c of columns) if (!order.includes(c.key)) out.push(c);
    return out;
  }, [columns, order]);

  /**
   * Drop the dragged column onto `to`, landing it where it was released.
   *
   * Direction matters. Dragging LEFT, the column takes the target's slot and
   * pushes it right; dragging RIGHT, it goes after the target. Always
   * inserting before the target looks correct going left but silently moves a
   * rightward drag one place short of where it was dropped — the column ends
   * up beside the target instead of past it.
   */
  function moveColumn(from: string, to: string) {
    if (from === to) return;
    setOrder((prev) => {
      const fromIdx = prev.indexOf(from);
      const toIdx = prev.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = prev.filter((k) => k !== from);
      const at = next.indexOf(to);
      next.splice(fromIdx < toIdx ? at + 1 : at, 0, from);
      return next;
    });
  }

  /**
   * The columns actually on screen.
   *
   * Everything downstream reads this, not `columns`: the header, the rows,
   * the search and the export. Searching a column you have hidden would
   * return rows with no visible match, and exporting one would hand you a
   * file that does not look like the table you were reading.
   */
  const visibleColumns = React.useMemo(
    () => orderedColumns.filter((c) => !hidden.has(c.key)),
    [orderedColumns, hidden],
  );

  const cellValue = React.useCallback(
    (row: T, col: Column<T>): string => {
      const v = col.value
        ? col.value(row)
        : (row as unknown as Record<string, unknown>)[col.key];
      return v === null || v === undefined ? "" : String(v);
    },
    [],
  );

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const kept = rows.filter((row) => {
      for (const f of filters) {
        const val = active[f.key];
        if (val && !f.matches(row, val)) return false;
      }
      if (!needle) return true;
      return visibleColumns.some((c) => cellValue(row, c).toLowerCase().includes(needle));
    });
    const sort = sorts?.find((s) => s.value === sortValue);
    // Copy before sorting — `rows` is the caller's array (often straight off a
    // server component's props), and sorting in place would mutate it.
    return sort ? [...kept].sort(sort.compare) : kept;
  }, [rows, q, active, filters, visibleColumns, cellValue, sorts, sortValue]);

  // Any filter change can shrink the list below the current page — snap back so
  // the user never lands on a blank page 4 of 2.
  //
  // Adjusted DURING render rather than in an effect: React re-runs this
  // component immediately with the corrected page, so the user never sees the
  // stale page paint. An effect would render the wrong page first, then fix it.
  const filterSig = `${q}|${JSON.stringify(active)}|${pageSize}`;
  const [lastSig, setLastSig] = React.useState(filterSig);
  if (filterSig !== lastSig) {
    setLastSig(filterSig);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  /**
   * Rows the user actually asked for: the ticked ones if any are ticked,
   * otherwise everything the current search and filters leave standing.
   *
   * A tick that survives a filter change would export rows the user can no
   * longer see, so selection is intersected with `filtered` rather than
   * trusted on its own.
   */
  const selectedRows = React.useMemo(
    () => (selected.size === 0 ? filtered : filtered.filter((r) => selected.has(r.id))),
    [filtered, selected],
  );

  /**
   * How wide the table needs to be for its columns to keep the widths the
   * caller asked for.
   *
   * Without this the table is `w-full` with a flat 720px floor, so a screen
   * with a dozen columns does not overflow — it squeezes every column down to
   * fit the container, and "Invoice Mailing Address" becomes three cramped
   * lines. Setting the minimum to the sum of the declared widths makes the
   * columns hold their size and the wrapper scroll instead.
   *
   * 140 is the fallback for a column that declares no width, matching what
   * the browser would give it anyway.
   */
  const tableMinWidth = React.useMemo(() => {
    const columnsWidth = visibleColumns.reduce(
      // Never narrower than the heading needs. Headings no longer wrap, so a
      // column declared at 130 with "Sales Co-ordinator" over it is really
      // ~170 wide — counting the declared number alone would under-state the
      // table and let it compress the other columns instead of scrolling.
      // 8.2px/char is 11px bold uppercase with the 0.08em tracking the header
      // row uses; 24 is the cell's horizontal padding.
      (sum, c) => sum + Math.max(c.width ?? 140, c.header.length * 8.2 + 24),
      0,
    );
    return Math.max(
      720,
      columnsWidth + (selectable ? 44 : 0) + (actions ? 56 : 0),
    );
  }, [visibleColumns, selectable, actions]);

  const pageIds = visible.map((r) => r.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = !pageAllSelected && pageIds.some((id) => selected.has(id));

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Header box: ticks or clears every row on THIS page, not all pages. */
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) for (const id of pageIds) next.delete(id);
      else for (const id of pageIds) next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = visibleColumns.map((c) => esc(c.header)).join(",");
    const body = selectedRows
      .map((row) => visibleColumns.map((c) => esc(cellValue(row, c))).join(","))
      .join("\n");
    // UTF-8 BOM so Excel opens Indian names and ₹ correctly — same convention
    // as the existing task/employee exports.
    const blob = new Blob([`﻿${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * `flexible` search grows and shrinks with the row instead of pinning 260px.
   * The title layout needs that: with every item shrink-0 the row can only
   * overflow, which clipped the action buttons off the right edge.
   */
  const renderSearch = (flexible: boolean) => (
    <div
      className={`inline-flex items-center gap-2 rounded-chip px-4 h-10 bg-surface-card border border-hairline ${
        flexible ? "flex-1 min-w-[200px]" : "shrink-0"
      }`}
      style={flexible ? { maxWidth: 520 } : { width: 260 }}
    >
      <Search size={16} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        className="bg-transparent outline-none text-[14.5px] w-full min-w-0 text-ink-strong"
      />
    </div>
  );

  // Every control on the filter row shares one height so the row reads as a
  // single band. The legacy toolbar keeps the taller 40px controls.
  // One height for every control in the band. Compact in title mode so the
  // whole set fits on a single line inside its card.
  const rowH = title ? "h-8" : "h-10";

  /**
   * Rows-per-page, in the toolbar band rather than only at the foot of the
   * table. Down there it appeared only once a list ran past 25 rows, so the
   * control you needed in order to see more rows was itself hidden until you
   * already had them.
   */
  const rowsControl = (
    <label
      className={`shrink-0 inline-flex items-center gap-0.5 rounded-pill pl-2 pr-1 ${rowH} bg-surface-card border border-hairline text-[11.5px] font-semibold text-ink-soft`}
    >
      Rows
      <select
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value))}
        aria-label="Rows per page"
        className="bg-transparent outline-none font-bold text-ink-strong cursor-pointer"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

  const columnsControl = (
    <ColumnPicker
      columns={orderedColumns}
      hidden={hidden}
      onToggle={(key) =>
        setHidden((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
      onReset={() => setHidden(defaultHidden)}
      height={rowH}
      accent={accent}
    />
  );

  const exportButton = (
    <button
      type="button"
      onClick={exportCsv}
      disabled={selectedRows.length === 0}
      title={exportLabel}
      className={`shrink-0 inline-flex items-center gap-1 ${title ? "rounded-pill" : "rounded-chip"} ${
        title ? "px-2 text-[11.5px]" : "px-2.5 text-[14px]"
      } ${rowH} font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-45 whitespace-nowrap`}
    >
      <Download size={13} strokeWidth={2.3} className="shrink-0" />
      {exportLabel}
    </button>
  );

  const newButton = onNew ? (
    <button
      type="button"
      onClick={onNew}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-chip px-4 h-10 text-[14px] font-bold text-white whitespace-nowrap"
      style={{ background: accent }}
    >
      <Plus size={15} strokeWidth={2.6} className="shrink-0" />
      {newLabel}
    </button>
  ) : null;

  /** The legacy single-row toolbar keeps all three together. */
  const actionButtons = (
    <>
      {extraActions}
      {exportButton}
      {newButton}
    </>
  );

  const count = (
    <span className="shrink-0 text-[13px] font-semibold text-ink-muted tabular-nums">
      {filtered.length}
      {filtered.length !== rows.length && ` of ${rows.length}`}
      {countNoun && ` ${countNoun}`}
    </span>
  );

  const clearSelection = React.useCallback(() => setSelected(new Set()), []);

  /**
   * The bar that slides in above the table once rows are ticked.
   *
   * Only rendered while something is selected — a permanent "0 selected"
   * would be noise on every screen that never uses selection. Clear is always
   * present because a selection can span several pages, and scrolling back to
   * untick them one by one is not a way out.
   */
  const selectionBar =
    selectable && selected.size > 0 ? (
      <div
        className="mb-2.5 flex items-center gap-2 flex-wrap rounded-section px-3 py-2"
        style={{
          background: `color-mix(in srgb, ${accent} 5%, var(--color-surface-card))`,
          border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
        }}
      >
        <span
          className="inline-grid place-items-center rounded-full text-white font-bold tabular-nums shrink-0"
          style={{ minWidth: 22, height: 22, fontSize: 11, padding: "0 6px", background: accent }}
        >
          {selectedRows.length}
        </span>
        <span className="font-semibold text-ink-strong shrink-0" style={{ fontSize: 13 }}>
          selected
        </span>

        <span className="h-5 w-px shrink-0" style={{ background: "var(--color-hairline-strong)" }} />

        {exportable && (
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap"
          >
            <Download size={14} strokeWidth={2.3} className="shrink-0" />
            Export selected
          </button>
        )}

        {rowDetail && (
          <button
            type="button"
            // One row only: a "details" panel for several rows at once has no
            // single set of values to show.
            disabled={selectedRows.length !== 1}
            onClick={() => setDetailRow(selectedRows[0] ?? null)}
            title={
              selectedRows.length === 1
                ? "See every field of this row"
                : "Select exactly one row to see its details"
            }
            className="inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-45 whitespace-nowrap"
          >
            <Eye size={14} strokeWidth={2.3} className="shrink-0" />
            View details
          </button>
        )}

        {onBulkDelete && (
          <button
            type="button"
            disabled={deleting}
            // Deleting is the one thing here that cannot be undone, so it
            // always asks first — see ConfirmDelete.
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-bold whitespace-nowrap disabled:opacity-50"
            style={{
              color: "var(--color-red)",
              background: "color-mix(in srgb, var(--color-red) 7%, var(--color-surface-card))",
              border: "1px solid color-mix(in srgb, var(--color-red) 32%, transparent)",
            }}
          >
            <Trash2 size={14} strokeWidth={2.4} className="shrink-0" />
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}

        {onEdit && (
          <button
            type="button"
            // One row: an edit form for several rows at once would have to
            // decide what to show where their values differ.
            disabled={selectedRows.length !== 1}
            onClick={() => {
              const row = selectedRows[0];
              if (row) onEdit(row);
            }}
            title={
              selectedRows.length === 1
                ? "Edit this row"
                : "Select exactly one row to edit it"
            }
            className="inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-45 whitespace-nowrap"
          >
            <Pencil size={14} strokeWidth={2.3} className="shrink-0" />
            Edit
          </button>
        )}

        {selectionActions?.({ rows: selectedRows, clear: clearSelection })}

        <button
          type="button"
          onClick={clearSelection}
          className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold text-ink-soft hover:text-ink-strong"
        >
          <X size={14} strokeWidth={2.4} className="shrink-0" />
          Clear
        </button>
      </div>
    ) : null;

  return (
    <div>
      {title ? (
        /* Reference layout, two bands: WHO you're looking at and the one action
           that creates a row on top; everything that narrows or exports what's
           already there below. */
        <>
          {/* Line one never wraps. Title and the New button hold their width,
              so the search absorbs whatever is left. Phones wrap. */}
          <div className="flex items-center gap-3 mb-2.5 flex-nowrap max-md:flex-wrap max-md:gap-y-2">
            <h1
              className="shrink-0 font-bold text-ink-strong whitespace-nowrap"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontSize: "clamp(19px, 1.9vw, 26px)",
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {title}
            </h1>
            {renderSearch(true)}
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {fullscreen && <FullscreenToggle />}
              {headerActions}
              {newButton}
            </div>
          </div>

          {/* Line two — ONE flex row with ONE gap, so the spacing between
              every control is identical, inside a card of its own so the
              controls read as one band rather than floating on the page.
              
              One line, kept readable by making the controls small rather
              than by cutting their labels: an earlier pass ellipsized them to
              fit and turned "All designations" into "All designati…", which
              is not a filter anyone can use.
              
              One line, always. A table with a dozen filters used to spill
              onto a second row, which pushed the table down and made the band
              read as two unrelated strips.

              Two things keep it to one line. Everything is a size smaller than
              the rest of the toolbar — 11.5px labels, 4px gaps, tight padding
              — because these are controls you glance at, not ones you read.
              And the chips sit in their own scrolling strip, so a table with
              fifteen filters scrolls rather than wraps. See the note inside
              for why only the chips scroll. */}
          <div
            className="flex items-center gap-1 mb-4 flex-nowrap rounded-section px-2 py-1.5 min-w-0"
            style={{
              background: "var(--color-surface-card)",
              border: "1px solid var(--color-hairline)",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            {/* The chips scroll; the buttons on the right do not.

                Splitting the band in two is what keeps it to one line at any
                width AND keeps the Columns menu working. `overflow-x` makes an
                element a clipping context, so anything with a custom popup
                inside it gets trapped — which is exactly what happened when
                the whole band scrolled. The chips are safe in here because
                every one of them opens a NATIVE <select>, and the browser
                draws those in their own layer, outside the page's clipping.
                ColumnPicker's popup is a plain absolutely-positioned div, so
                it has to live outside this container. */}
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar py-0.5">
              <SlidersHorizontal
                size={13}
                strokeWidth={2.4}
                aria-label="Filters"
                className="shrink-0 text-ink-subtle"
              />
              {filters.map((f) => (
                <FilterChip
                  key={f.key}
                  def={f}
                  value={active[f.key] ?? ""}
                  onChange={(v) => setActive((prev) => ({ ...prev, [f.key]: v }))}
                  height={rowH}
                />
              ))}
              {sorts && sorts.length > 0 && (
                <>
                  <ArrowUpDown
                    size={13}
                    strokeWidth={2.4}
                    aria-label="Sort"
                    className="text-ink-subtle shrink-0"
                  />
                  <select
                    value={sortValue}
                    onChange={(e) => setSortValue(e.target.value)}
                    aria-label="Sort"
                    className={`shrink-0 rounded-pill px-1.5 ${rowH} bg-surface-card border border-hairline text-[11.5px] font-semibold text-ink-soft outline-none`}
                  >
                    {sorts.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {/* Never scrolled away: these are the controls you reach for
                regardless of how many filters a table happens to have. */}
            <div className="flex items-center gap-1 shrink-0">
              {rowsControl}
              {columnsControl}
              {/* Export before Bulk Upload — matches the reference band's
                  order, and the two read as a pair. */}
              {exportable && exportButton}
              {extraActions}
            </div>
          </div>
        </>
      ) : (
        /* The original single-row toolbar, unchanged for /master-setup. */
        <div className="flex items-center gap-2.5 mb-4 min-w-0">
          {renderSearch(false)}
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto py-0.5">
            {filters.map((f) => (
              <select
                key={f.key}
                value={active[f.key] ?? ""}
                onChange={(e) => setActive((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="shrink-0 rounded-pill px-3.5 h-10 bg-surface-card border border-hairline text-[14px] font-semibold text-ink-soft outline-none"
              >
                <option value="">{f.label}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ))}
            <span className="ml-1">{count}</span>
          </div>
          <div className="shrink-0 flex items-center gap-2">{actionButtons}</div>
        </div>
      )}

      {selectionBar}

      {/* Table.
          The top rule is drawn here rather than left to the selection bar's
          own border, so closing the bar does not take the line above the
          header away with it — the table keeps a defined top edge either
          way, and nothing shifts by a pixel when the bar appears. */}
      <div
        className="rounded-section border border-hairline bg-surface-card overflow-hidden"
        style={{ borderTopColor: "var(--color-hairline-strong)" }}
      >
        {/* The horizontal scroller. `overflow-hidden` on the card above
            would clip a wide table dead; this is what lets it scroll. */}
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: tableMinWidth }}>
            <thead>
              <tr
                className="text-left uppercase tracking-[0.08em]"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  // Tinted band behind the headings, per the reference layout.
                  background: tintHeader
                    ? "color-mix(in srgb, var(--color-blue) 8%, var(--color-surface-soft))"
                    : undefined,
                  color: tintHeader ? "var(--color-ink-soft)" : "var(--color-ink-subtle)",
                }}
              >
                {selectable && (
                  <th
                    className={`${title ? "px-3 py-1" : "px-4 py-3"} whitespace-nowrap`}
                    style={{ width: 44 }}
                  >
                    <TickBox
                      checked={pageAllSelected}
                      indeterminate={pageSomeSelected}
                      onChange={togglePage}
                      label={pageAllSelected ? "Clear this page" : "Select this page"}
                      accent={accent}
                    />
                  </th>
                )}
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    // Grab the heading and drop it on another to move the
                    // column. Native HTML5 drag rather than a pointer-event
                    // implementation: it gives keyboard-free reordering, a
                    // drag image and an escape-to-cancel for nothing.
                    draggable
                    onDragStart={(e) => {
                      setDragKey(c.key);
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox refuses to start a drag without payload.
                      e.dataTransfer.setData("text/plain", c.key);
                    }}
                    onDragOver={(e) => {
                      if (!dragKey || dragKey === c.key) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOverKey(c.key);
                    }}
                    onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey) moveColumn(dragKey, c.key);
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    title="Drag to move this column"
                    // `whitespace-nowrap`: a heading is a label, and "Sales
                    // Co-ordinator" broken over two lines reads as two
                    // columns. The declared width is a hint, so a long
                    // heading widens its column and the table scrolls —
                    // which is the behaviour that already exists for wide
                    // tables, rather than a new one.
                    className={`${title ? "px-3 py-1" : "px-4 py-3"} whitespace-nowrap cursor-grab select-none`}
                    style={{
                      textAlign: c.align ?? "left",
                      width: c.width,
                      opacity: dragKey === c.key ? 0.4 : 1,
                      // A rule on the edge the column will land against, so
                      // the drop is unambiguous before letting go. Which edge
                      // depends on the direction, exactly as moveColumn does.
                      boxShadow:
                        overKey === c.key && dragKey && dragKey !== c.key
                          ? order.indexOf(dragKey) < order.indexOf(c.key)
                            ? `inset -2px 0 0 0 ${accent}`
                            : `inset 2px 0 0 0 ${accent}`
                          : undefined,
                    }}
                  >
                    {c.header}
                  </th>
                ))}
                {actions && (
                  <th
                    className={`text-right whitespace-nowrap ${title ? "px-3 py-1" : "px-4 py-3"}`}
                  >
                    {tintHeader ? "" : "Manage"}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleColumns.length + (actions ? 1 : 0) + (selectable ? 1 : 0)}
                    className="px-4 py-14 text-center text-ink-muted"
                    style={{ fontSize: 14.5 }}
                  >
                    <p className="font-bold text-ink-strong" style={{ fontSize: 16 }}>
                      {rows.length === 0 ? emptyTitle : "Nothing matches those filters."}
                    </p>
                    {rows.length === 0 && emptySub && (
                      <p className="mt-1.5">{emptySub}</p>
                    )}
                  </td>
                </tr>
              )}
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className="border-t"
                  style={{
                    borderColor: "var(--color-hairline)",
                    background:
                      selectable && selected.has(row.id)
                        ? `color-mix(in srgb, ${accent} 6%, transparent)`
                        : undefined,
                    cursor: rowDetail ? "pointer" : undefined,
                  }}
                  onClick={rowDetail ? () => setDetailRow(row) : undefined}
                >
                  {selectable && (
                    <td
                      className={title ? "px-3 py-1" : "px-4 py-3"}
                      // Ticking a row must not also open it — the two are
                      // different intentions on the same row.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <TickBox
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        label="Select row"
                        accent={accent}
                      />
                    </td>
                  )}
                  {visibleColumns.map((c) => (
                    <td
                      key={c.key}
                      className={`text-ink-soft ${title ? "px-3 py-1" : "px-4 py-3"}`}
                      style={{ fontSize: title ? 12.5 : 14, textAlign: c.align ?? "left" }}
                    >
                      {c.render ? c.render(row) : cellValue(row, c) || <Dash />}
                    </td>
                  ))}
                  {actions && (
                    <td
                      className={title ? "px-3 py-1" : "px-4 py-3"}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmingDelete && onBulkDelete && (
        <ConfirmDelete
          count={selectedRows.length}
          noun={deleteNoun}
          busy={deleting}
          accent={accent}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setDeleting(true);
            void onBulkDelete(selectedRows)
              .then((res) => {
                if (res.ok) {
                  clearSelection();
                  setConfirmingDelete(false);
                }
                // On failure the dialog stays up with the error already
                // toasted, so a retry is one click rather than re-selecting.
              })
              .finally(() => setDeleting(false));
          }}
        />
      )}

      {rowDetail && detailRow && (
        <RowDetail
          row={detailRow}
          // Every column, in the user's chosen order but ignoring what the
          // Columns menu is hiding — see the component's note.
          columns={orderedColumns}
          title={
            rowDetailTitle
              ? rowDetailTitle(detailRow)
              : cellValue(detailRow, orderedColumns[0]!) || "Details"
          }
          accent={accent}
          onClose={() => setDetailRow(null)}
          // Edit hands the record to the table's own dialog, so the popup does
          // not carry a second copy of the form. Closing first keeps one modal
          // on screen at a time.
          onEdit={
            onEdit
              ? () => {
                  const r = detailRow;
                  setDetailRow(null);
                  onEdit(r);
                }
              : undefined
          }
          onDeactivate={
            onToggleActive
              ? () => {
                  const r = detailRow;
                  setDetailRow(null);
                  onToggleActive(r);
                }
              : undefined
          }
          deactivateLabel={
            (detailRow as { isActive?: boolean }).isActive === false ? "Activate" : "Deactivate"
          }
        />
      )}

      {/* Pagination */}
      {filtered.length > PAGE_SIZES[0]! && (
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          {/* Rows-per-page lives in the toolbar in title mode; the legacy
              toolbar has no room for it, so it stays down here for those. */}
          <div className="flex items-center gap-2">
            {title ? (
              <span />
            ) : (
              <>
                <span className="text-[13px] text-ink-subtle font-semibold">Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-pill px-3 h-9 bg-surface-card border border-hairline text-[13.5px] font-semibold text-ink-soft outline-none"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] text-ink-muted tabular-nums font-semibold">
              Page {safePage + 1} of {pageCount}
            </span>
            <PageBtn disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft size={16} strokeWidth={2.4} />
            </PageBtn>
            <PageBtn
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={16} strokeWidth={2.4} />
            </PageBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function PageBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-lg bg-surface-card border border-hairline text-ink-soft disabled:opacity-35"
      style={{ width: 34, height: 34 }}
    >
      {children}
    </button>
  );
}

/**
 * One filter as a compact labelled chip — "STATUS  All ⌄".
 *
 * A real <select> sits invisibly over the chip rather than a custom popup, so
 * it keeps native keyboard handling and the OS picker on mobile for free.
 * `def.label` is the FIELD NAME here ("Status"); the chip renders the current
 * value itself.
 */
function FilterChip<T>({
  def,
  value,
  onChange,
  height = "h-8",
}: {
  def: FilterDef<T>;
  value: string;
  onChange: (v: string) => void;
  /** Matched to the rest of the filter row so the band is one height. */
  height?: string;
}) {
  const current = def.options.find((o) => o.value === value);
  return (
    <label
      title={current ? `${def.label}: ${current.label}` : def.label}
      className={`relative shrink-0 inline-flex items-center gap-0.5 rounded-pill px-2 ${height} bg-surface-card border border-hairline cursor-pointer`}
      style={value ? { borderColor: "color-mix(in srgb, var(--color-blue) 45%, transparent)" } : undefined}
    >
      {/* One type style across the whole band — chips, Sort, Rows, Columns
          and Export are one set of controls. Never truncated: the label is
          the entire point of the chip. */}
      <span className="font-semibold text-ink-soft whitespace-nowrap" style={{ fontSize: 11.5 }}>
        {def.label}
      </span>
      {/* Nothing shown when unset. "All" was five chips repeating the same
          word — the absence of a value already means no filter. */}
      {current && (
        <span className="font-bold text-ink-strong whitespace-nowrap" style={{ fontSize: 11.5 }}>
          {current.label}
        </span>
      )}
      <ChevronDown size={12} strokeWidth={2.4} className="text-ink-subtle shrink-0" />
      <select
        aria-label={def.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        <option value="">All</option>
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Dash() {
  return <span className="text-ink-subtle">—</span>;
}

/** Small status/classification pill, shared by the master tables. */
export function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-bold whitespace-nowrap"
      style={{
        fontSize: 11.5,
        background: `color-mix(in srgb, var(--color-${tone}) 14%, transparent)`,
        color: `var(--color-${tone}-deep)`,
        border: `1px solid color-mix(in srgb, var(--color-${tone}) 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
