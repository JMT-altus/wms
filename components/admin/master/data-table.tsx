"use client";
import * as React from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
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
}) {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [sortValue, setSortValue] = React.useState(sorts?.[0]?.value ?? "");

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
      return columns.some((c) => cellValue(row, c).toLowerCase().includes(needle));
    });
    const sort = sorts?.find((s) => s.value === sortValue);
    // Copy before sorting — `rows` is the caller's array (often straight off a
    // server component's props), and sorting in place would mutate it.
    return sort ? [...kept].sort(sort.compare) : kept;
  }, [rows, q, active, filters, columns, cellValue, sorts, sortValue]);

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

  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = columns.map((c) => esc(c.header)).join(",");
    const body = filtered
      .map((row) => columns.map((c) => esc(cellValue(row, c))).join(","))
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
  const rowH = title ? "h-9" : "h-10";

  const exportButton = (
    <button
      type="button"
      onClick={exportCsv}
      disabled={filtered.length === 0}
      title={exportLabel}
      className={`inline-flex items-center gap-1.5 rounded-chip px-3 ${rowH} ${
        title ? "text-[13px]" : "text-[14px]"
      } font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-45 whitespace-nowrap`}
    >
      <Download size={15} strokeWidth={2.3} className="shrink-0" />
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
    </span>
  );

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
            <div className="ml-auto shrink-0">{newButton}</div>
          </div>

          {/* Line two — one band, one control height (see `rowH`). */}
          <div className="flex items-center gap-2 mb-4 min-w-0">
            <SlidersHorizontal
              size={14}
              strokeWidth={2.4}
              aria-label="Filters"
              className="shrink-0 text-ink-subtle"
            />
            {/* No overflow-x-auto: a scrollbar under the chips is the row
                admitting it doesn't fit. The chips shrink and ellipsize their
                labels instead, so the row is always exactly one line. */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {filters.map((f) => (
                <FilterChip
                  key={f.key}
                  def={f}
                  value={active[f.key] ?? ""}
                  onChange={(v) => setActive((prev) => ({ ...prev, [f.key]: v }))}
                  height={rowH}
                />
              ))}
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {sorts && sorts.length > 0 && (
                <div className="inline-flex items-center gap-1.5">
                  <ArrowUpDown
                    size={14}
                    strokeWidth={2.4}
                    aria-label="Sort"
                    className="text-ink-subtle shrink-0"
                  />
                  <select
                    value={sortValue}
                    onChange={(e) => setSortValue(e.target.value)}
                    aria-label="Sort"
                    className={`rounded-chip px-2.5 ${rowH} bg-surface-card border border-hairline text-[13px] font-semibold text-ink-soft outline-none`}
                  >
                    {sorts.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {extraActions}
              {exportButton}
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

      {/* Table */}
      <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 720 }}>
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
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="px-4 py-3"
                    style={{ textAlign: c.align ?? "left", width: c.width }}
                  >
                    {c.header}
                  </th>
                ))}
                {actions && (
                  <th className="px-4 py-3 text-right">{tintHeader ? "" : "Manage"}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + (actions ? 1 : 0)}
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
                  style={{ borderColor: "var(--color-hairline)" }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className="px-4 py-3 text-ink-soft"
                      style={{ fontSize: 14, textAlign: c.align ?? "left" }}
                    >
                      {c.render ? c.render(row) : cellValue(row, c) || <Dash />}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {filtered.length > PAGE_SIZES[0]! && (
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
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
      className={`relative min-w-0 inline-flex items-center gap-1.5 rounded-chip px-2.5 ${height} bg-surface-card border border-hairline cursor-pointer`}
      style={value ? { borderColor: "color-mix(in srgb, var(--color-blue) 45%, transparent)" } : undefined}
    >
      {/* Truncates rather than forcing the row to scroll. At normal widths
          nothing is cut; when it is, the title attribute carries the full text. */}
      <span
        className="uppercase font-bold tracking-[0.08em] text-ink-subtle truncate"
        style={{ fontSize: 10 }}
      >
        {def.label}
      </span>
      {/* Nothing shown when unset. "All" was five chips repeating the same
          word — the absence of a value already means no filter. */}
      {current && (
        <span className="font-bold text-ink-strong truncate" style={{ fontSize: 12 }}>
          {current.label}
        </span>
      )}
      <ChevronDown size={12} strokeWidth={2.6} className="text-ink-subtle shrink-0" />
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
