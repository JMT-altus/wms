"use client";
import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
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

const PAGE_SIZES = [25, 50, 100];

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  filters = [],
  searchPlaceholder = "Search…",
  csvName = "export",
  onNew,
  newLabel = "New",
  actions,
  emptyTitle = "Nothing here yet.",
  emptySub,
  accent = "#0A6CFF",
}: {
  rows: T[];
  columns: Column<T>[];
  filters?: FilterDef<T>[];
  searchPlaceholder?: string;
  csvName?: string;
  onNew?: () => void;
  newLabel?: string;
  /** Per-row trailing controls (edit / delete). */
  actions?: (row: T) => React.ReactNode;
  emptyTitle?: string;
  emptySub?: string;
  accent?: string;
}) {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);

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
    return rows.filter((row) => {
      for (const f of filters) {
        const val = active[f.key];
        if (val && !f.matches(row, val)) return false;
      }
      if (!needle) return true;
      return columns.some((c) => cellValue(row, c).toLowerCase().includes(needle));
    });
  }, [rows, q, active, filters, columns, cellValue]);

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

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        <div
          className="inline-flex items-center gap-2 rounded-pill px-4 h-10 bg-surface-card border border-hairline"
          style={{ minWidth: 260 }}
        >
          <Search size={16} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="bg-transparent outline-none text-[14.5px] w-full text-ink-strong"
          />
        </div>

        {filters.map((f) => (
          <select
            key={f.key}
            value={active[f.key] ?? ""}
            onChange={(e) =>
              setActive((prev) => ({ ...prev, [f.key]: e.target.value }))
            }
            className="rounded-pill px-3.5 h-10 bg-surface-card border border-hairline text-[14px] font-semibold text-ink-soft outline-none"
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}

        <span className="text-[13.5px] font-semibold text-ink-muted tabular-nums ml-1">
          {filtered.length}
          {filtered.length !== rows.length && ` of ${rows.length}`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-pill px-3.5 h-10 text-[14px] font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-45"
          >
            <Download size={15} strokeWidth={2.3} />
            CSV
          </button>
          {onNew && (
            <button
              type="button"
              onClick={onNew}
              className="inline-flex items-center gap-1.5 rounded-pill px-4 h-10 text-[14px] font-bold text-white"
              style={{ background: accent }}
            >
              <Plus size={15} strokeWidth={2.6} />
              {newLabel}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr
                className="text-left uppercase tracking-[0.08em] text-ink-subtle"
                style={{ fontSize: 11, fontWeight: 700 }}
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
                {actions && <th className="px-4 py-3 text-right">Manage</th>}
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
