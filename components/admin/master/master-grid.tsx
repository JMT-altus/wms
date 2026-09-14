"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Minus, Plus, Search, TriangleAlert } from "lucide-react";
import type { ClientBulkColumn } from "@/lib/forms/client-bulk-columns";
import { SheetCell } from "@/components/forms/sheet-cell";
import { announceSave } from "@/lib/masters/save-toast";
import type { SaveResult } from "./inline-edit";

/**
 * Grid View, for any master.
 *
 * The master as one editable sheet: a row per record, every field as a cell,
 * edit anywhere. The table view is for finding a record and correcting it;
 * this is for the pass where a column needs filling in across the register and
 * opening thirty dialogs is the wrong shape of work.
 *
 * Every master's grid is this one component with a different column list, so
 * the sheet behaves identically wherever you meet it — same popups, same
 * sticky first column, same save-as-you-go. The cells themselves are the Bulk
 * Import sheet's (`SheetCell`), which is where the multi-select and the "use
 * what I typed" escape hatch already live.
 *
 * It is never a second way to WRITE a record. `save` is handed back to the
 * caller, which sends it through the same server action that master's dialog
 * uses, so validation is the one that already existed.
 */

export type GridKind = "text" | "number" | "select" | "multi";

export interface GridCol<T> {
  key: string;
  label: string;
  width: number;
  kind: GridKind;
  /** For `select` / `multi`. */
  options?: readonly string[];
  /** A list that is a suggestion rather than a constraint — typing is allowed. */
  freeText?: boolean;
  maxLength?: number;
  /**
   * Pinned to the left while the sheet scrolls. Must be a run of columns from
   * the left edge — a frozen column with a scrolling one before it would slide
   * over its own neighbour.
   */
  frozen?: boolean;
  /**
   * Shown, not edited. The record's own identity (a client code) and its
   * parent (which client a contact belongs to): changing either here would be
   * renumbering or re-parenting, neither of which is a cell edit.
   */
  readOnly?: boolean;
  /** Render read-only text as a code rather than as prose. */
  mono?: boolean;
  /** Heading alignment, for the money columns whose figures sit right. */
  align?: "right";
  /**
   * Put − / + buttons either side of a `number` cell, stepping by this much.
   *
   * For the columns where the work is "move this figure", not "type this
   * figure" — a credit limit being raised or reduced in a review pass. The
   * cell stays typable: the buttons are the common move made cheap, not a
   * replacement for entering a number.
   *
   * Shift-click steps by ten times this.
   */
  step?: number;
  /** What this cell shows for a row. */
  get: (row: T) => string;
  /**
   * Richer content for a `readOnly` column — a pill, a tone, a glyph.
   * Falls back to `get`, which is still what search and keyboard nav read.
   */
  render?: (row: T) => React.ReactNode;
}

type RowState = "clean" | "dirty" | "saving" | "saved" | "error";
type Cells = Record<string, string>;

/** `SheetCell` speaks the bulk-import column shape; this is the adapter. */
function asSheetColumn<T>(c: GridCol<T>): ClientBulkColumn {
  return {
    key: c.key,
    label: c.label,
    kind: c.kind,
    group: "",
    width: c.width,
    freeText: c.freeText,
    maxLength: c.maxLength,
  };
}

export function MasterGrid<T extends { id: string }>({
  rows: allRows,
  columns,
  title,
  primaryKey,
  primarySearchLabel,
  accent,
  accentSoft,
  toolbar,
  leading,
  emptyTitle,
  save,
  noun = "records",
}: {
  rows: T[];
  columns: GridCol<T>[];
  title: string;
  /** Which column the first search box matches. Defaults to the first. */
  primaryKey?: string;
  /** "Search company", "Search product" — names that search. */
  primarySearchLabel: string;
  accent: string;
  accentSoft: string;
  /** The view switch, rendered in this sheet's own header bar. */
  toolbar?: React.ReactNode;
  /**
   * Controls that sit with the title, left of the searches — filter chips and
   * the like. Kept apart from `toolbar` so a sheet's filters land where its
   * table view puts them rather than at the far right.
   */
  leading?: React.ReactNode;
  /**
   * What to say when there are no rows at all. Defaults to "No <noun> yet.",
   * which is wrong for a sheet whose caller has already filtered the list —
   * the records exist, none of them match.
   */
  emptyTitle?: string;
  /**
   * Write one row. Handed the whole row as the sheet now holds it, so the
   * caller can send whatever shape its action wants.
   */
  save: (row: T, cells: Cells) => Promise<SaveResult>;
  noun?: string;
}) {
  const router = useRouter();
  const [primaryQuery, setPrimaryQuery] = React.useState("");
  const [query, setQuery] = React.useState("");
  /** Which column the second search looks in. "" is every column. */
  const [scope, setScope] = React.useState("");
  const [edits, setEdits] = React.useState<Record<string, Cells>>({});
  const [status, setStatus] = React.useState<Record<string, RowState>>({});

  const cellRefs = React.useRef(new Map<string, HTMLElement>());

  /**
   * The row as it stands this instant, for the commit to send.
   *
   * The same cells as `edits`, kept in a ref because a commit arrives in an
   * event and state only reaches a handler on the render after the change —
   * and the two halves can be one event, as picking off a list is. Reading
   * state there would send the row as it stood BEFORE the pick. `edits` is
   * what the sheet renders; this is what it writes, and `change` sets both.
   */
  const liveCells = React.useRef<Record<string, Cells>>({});
  /** Rows with a write out, and the ones that were edited again while it was. */
  const inFlight = React.useRef(new Set<string>());
  const again = React.useRef(new Set<string>());

  /**
   * Which server render each row is waiting for before it lets go of its local
   * copy, and a count of the renders that have arrived.
   *
   * A saved row keeps showing what was typed until a LATER list than the one
   * it was saved against comes back, at which point the server has the edit
   * and the two agree. Counting renders rather than comparing values is what
   * makes a normalised write (a credit limit typed "10,00,000", stored and
   * returned as "1000000") settle instead of holding the typed form forever.
   *
   * Rows that have not been saved are never in the map, so a refresh caused by
   * one row landing can't take away what is being typed into another.
   */
  const generation = React.useRef(0);
  const pendingDrop = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    generation.current += 1;
    const due: string[] = [];
    pendingDrop.current.forEach((at, id) => {
      if (generation.current > at) due.push(id);
    });
    if (due.length === 0) return;
    due.forEach((id) => {
      pendingDrop.current.delete(id);
      // The server is now the truth for this row, so the next edit rebases on
      // it rather than on a copy taken before the write.
      delete liveCells.current[id];
    });
    setEdits((p) => {
      const next = { ...p };
      for (const id of due) delete next[id];
      return next;
    });
  }, [allRows]);

  /**
   * What each row has had changed since it was last written, in the order the
   * cells were touched, so the toast that confirms the save can say which
   * fields it covered rather than just "saved".
   *
   * Keyed by column so tabbing back over a cell twice reports it once, and
   * the `from` kept is the value the row had before the FIRST edit — a figure
   * nudged 3 → 4 → 5 by the stepper reads "3 → 5", which is the change that
   * actually reached the server.
   */
  const touched = React.useRef(new Map<string, Map<string, { label: string; from: string; to: string }>>());

  /**
   * Left offsets for the frozen run, so each pinned column sits flush against
   * the one before it.
   */
  const frozenLeft = React.useMemo(() => {
    const out = new Map<string, number>();
    let x = 0;
    for (const c of columns) {
      if (!c.frozen) break;
      out.set(c.key, x);
      x += c.width;
    }
    return out;
  }, [columns]);

  const primary = columns.find((c) => c.key === primaryKey) ?? columns[0];

  const cellsOf = React.useCallback(
    (row: T): Cells => Object.fromEntries(columns.map((c) => [c.key, c.get(row)])),
    [columns],
  );
  const cellsFor = (row: T): Cells => edits[row.id] ?? cellsOf(row);

  const rows = React.useMemo(() => {
    const p = primaryQuery.trim().toLowerCase();
    const q = query.trim().toLowerCase();
    if (!p && !q) return allRows;
    return allRows.filter((row) => {
      if (p && primary && !primary.get(row).toLowerCase().includes(p)) return false;
      if (!q) return true;
      const cells = cellsOf(row);
      if (scope) return (cells[scope] ?? "").toLowerCase().includes(q);
      return Object.values(cells).some((v) => v.toLowerCase().includes(q));
    });
  }, [allRows, primaryQuery, query, scope, cellsOf, primary]);

  function writeRow(row: T, next: Cells) {
    const id = row.id;
    inFlight.current.add(id);
    setStatus((p) => ({ ...p, [id]: "saving" }));
    void save(row, next)
      .then((res) => {
        if (res.ok) {
          setStatus((p) => ({ ...p, [id]: "saved" }));
          const changed = touched.current.get(id);
          touched.current.delete(id);
          if (changed && changed.size > 0) {
            // The sheet's copy, not the server's: if the cell just edited IS
            // the name column, the toast should carry the name that was
            // written, not the one being replaced.
            const label = primary ? (next[primary.key] ?? primary.get(row)).trim() : "";
            announceSave(label, [...changed.values()]);
          }
          // The local copy is NOT dropped here. `router.refresh()` is a round
          // trip, and until it lands the table is still rendering the row the
          // server last sent — the one without this edit. Dropping the copy
          // now paints the old value straight back for the width of the
          // request, which on a cleared cell is the erased text reappearing
          // and looking for all the world like a save that didn't happen.
          // `pendingDrop` releases it once the server has actually caught up.
          pendingDrop.current.set(id, generation.current);
          router.refresh();
        } else {
          setStatus((p) => ({ ...p, [id]: "error" }));
          toast.error(res.error);
        }
      })
      .catch(() => {
        setStatus((p) => ({ ...p, [id]: "error" }));
        toast.error("Couldn't reach the server. Try again in a moment.");
      })
      .finally(() => {
        inFlight.current.delete(id);
        // Another cell on this row was finished with while the write was out.
        // It was held rather than sent, so that the two writes couldn't cross
        // and the older one land last; now it goes.
        if (again.current.delete(id)) commitRow(row);
      });
  }

  /**
   * The cell has been left — write the row if it is holding anything.
   *
   * Called when a cell is finished with, not while it is being typed in. A
   * timer guessing when the typing has stopped writes half-typed values —
   * "50000" entered digit by digit saved 5, then 50, then 500 — and it writes
   * them while the cursor is still in the cell, so a figure you were in the
   * middle of changing your mind about is already on the server. Leaving the
   * cell is the moment the value is meant, so that is the moment it goes.
   *
   * Every way out of a cell ends up here — blur, Enter, an arrow to the row
   * below, a value picked off a list, a popup closing — and several of them
   * fire for one departure, so this has to be safe to call repeatedly. Only a
   * row actually holding a change writes.
   *
   * A row already being written is not written again on top of itself — the
   * second edit is held and sent when the first comes back, so two writes of
   * the same row can't cross and leave the older one on the server.
   */
  function commitRow(row: T) {
    const id = row.id;
    const next = liveCells.current[id];
    if (!next) return;

    // Touched and put back the way it was. Nothing to write, and nothing to
    // hold on to either — the local copy matches the row.
    const changed = touched.current.get(id);
    if (!changed || changed.size === 0) {
      touched.current.delete(id);
      delete liveCells.current[id];
      setStatus((p) => ({ ...p, [id]: "clean" }));
      setEdits((p) => {
        const { [id]: _same, ...rest } = p;
        return rest;
      });
      return;
    }

    if (inFlight.current.has(id)) {
      again.current.add(id);
      return;
    }
    writeRow(row, next);
  }

  function change(row: T, key: string, value: string) {
    const current = liveCells.current[row.id] ?? cellsOf(row);
    const next = { ...current, [key]: value };
    noteChange(row.id, key, current[key] ?? "", value);
    liveCells.current[row.id] = next;
    setEdits((p) => ({ ...p, [row.id]: next }));
    setStatus((p) => ({ ...p, [row.id]: "dirty" }));
  }

  /**
   * Remember one cell edit for the save confirmation.
   *
   * A cell typed back to what it started as is dropped rather than reported:
   * the write still goes out (the row is what changed, not the cell), but
   * telling someone a field was "saved" as the value it already had is noise.
   */
  function noteChange(id: string, key: string, from: string, to: string) {
    const label = columns.find((c) => c.key === key)?.label ?? key;
    let row = touched.current.get(id);
    if (!row) {
      row = new Map();
      touched.current.set(id, row);
    }
    const first = row.get(key);
    if (first && first.from === to) row.delete(key);
    else row.set(key, { label, from: first?.from ?? from, to });
  }

  /**
   * ↑/↓ and Enter walk the column, the way a spreadsheet does.
   *
   * The row being left is written on the way out. The cell's own blur commits
   * it too and one of the two is redundant — `commitRow` is a no-op on a row
   * with nothing outstanding — but a `select`/`multi` cell hands focus to a
   * portal rather than to the next cell, so the blur alone cannot be relied on
   * to fire before the row scrolls past.
   */
  function onGridKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    const at = (document.activeElement as HTMLElement | null)?.dataset.cell;
    if (!at) return;
    const [rs, key] = at.split("|");
    const to = e.key === "ArrowUp" ? Number(rs) - 1 : Number(rs) + 1;
    const from = rows[Number(rs)];
    if (from) commitRow(from);
    if (to < 0 || to >= rows.length) return;
    const target = cellRefs.current.get(`${to}|${key}`);
    if (!target) return;
    e.preventDefault();
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
  }

  const registrar = (rowIndex: number, key: string) => (el: HTMLElement | null) => {
    const k = `${rowIndex}|${key}`;
    if (el) {
      el.dataset.cell = k;
      cellRefs.current.set(k, el);
    } else {
      cellRefs.current.delete(k);
    }
  };

  return (
    <section
      className="rounded-section bg-surface-card overflow-hidden"
      style={{
        border: "2px solid var(--color-table-edge)",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <header
        className="flex items-center gap-3 flex-wrap px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-hairline)" }}
      >
        <h2
          className="font-bold text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 17 }}
        >
          {title}
        </h2>
        <span className="text-ink-subtle" style={{ fontSize: 12.5 }}>
          {rows.length} {rows.length === 1 ? noun.replace(/s$/, "") : noun} · edits save on their own
        </span>

        {leading}

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {/* The first column's own search — the record you already have in
              mind — kept apart from the one below, which answers "which rows
              carry this value at all". */}
          <span className="relative">
            <Search
              size={14}
              strokeWidth={2.4}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              value={primaryQuery}
              onChange={(e) => setPrimaryQuery(e.target.value)}
              placeholder={primarySearchLabel}
              aria-label={primarySearchLabel}
              className="rounded-chip pl-8 pr-3 h-8 bg-surface-soft border border-hairline outline-none text-[12.5px] text-ink-strong"
              style={{ width: 185 }}
            />
          </span>

          {/* The second search, with the column it looks in. A bare "search
              everything" box answers the wrong question on a sheet this wide:
              typing a value finds the row, but typing a COLUMN'S NAME finds
              nothing, which reads as the search being broken. Naming the
              column is the thing people reach for, so it is a control. */}
          <span
            className="inline-flex items-stretch rounded-chip overflow-hidden"
            style={{ border: "1px solid var(--color-hairline)" }}
          >
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Column to search"
              title="Which column to search in"
              className="h-8 pl-2.5 pr-1.5 bg-surface-soft outline-none text-[12.5px] font-semibold text-ink-soft"
              style={{ borderRight: "1px solid var(--color-hairline)", maxWidth: 175 }}
            >
              <option value="">All columns</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="relative">
              <Search
                size={14}
                strokeWidth={2.4}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={scope ? "Search that column" : "Search all columns"}
                aria-label="Search"
                className="h-8 pl-8 pr-3 bg-surface-soft outline-none text-[12.5px] text-ink-strong"
                style={{ width: 185 }}
              />
            </span>
          </span>

          {toolbar}
        </div>
      </header>

      {/* One scroller for the whole sheet. The identity columns are sticky
          inside it, so scrolling right never leaves you looking at a row you
          can no longer name. */}
      <div
        className="data-grid-scroll overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 210px)" }}
        onKeyDown={onGridKeyDown}
      >
        {/* `width: 100%` with a filler column at the end: the columns keep the
            widths they were given, and whatever the container has left over
            goes to one cell that is part of the sheet — rather than leaving a
            bare strip of card beside the last column. */}
        <table
          className="data-grid-sheet"
          style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}
        >
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    ...headStyle(frozenLeft.get(c.key), c.width, Boolean(c.frozen)),
                    textAlign: c.align ?? "left",
                  }}
                >
                  {c.label}
                </th>
              ))}
              <th style={headStyle(undefined, 44, false)} />
              <th
                aria-hidden
                style={{
                  ...headStyle(undefined, 0, false),
                  width: "auto",
                  minWidth: 0,
                  borderRight: "none",
                }}
              />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="px-4 py-10 text-center text-ink-muted"
                  style={{ fontSize: 13.5 }}
                >
                  <span className="block">
                    {allRows.length === 0
                      ? (emptyTitle ?? `No ${noun} yet.`)
                      : "Nothing matches that search."}
                  </span>
                  {allRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrimaryQuery("");
                        setQuery("");
                        setScope("");
                      }}
                      className="mt-2 rounded-chip px-3 h-8 font-semibold"
                      style={{ fontSize: 12.5, background: accentSoft, color: accent }}
                    >
                      Clear both searches
                    </button>
                  )}
                </td>
              </tr>
            )}
            {rows.map((row, rowIndex) => {
              const cells = cellsFor(row);
              const state = status[row.id] ?? "clean";
              return (
                <tr key={row.id} data-state={state}>
                  {columns.map((column) => {
                    // A frozen cell has to be PAINTED, not left transparent, or
                    // the columns scrolling beneath show through it.
                    const pinned = column.frozen
                      ? {
                          ...frozenStyle(frozenLeft.get(column.key) ?? 0, column.width),
                          background: "var(--grid-row-bg)",
                        }
                      : undefined;

                    if (column.readOnly) {
                      return (
                        <td key={column.key} style={pinned ?? { ...cellBorder, width: column.width, minWidth: column.width }}>
                          <span
                            className="block px-3 py-2 truncate text-ink-soft"
                            title={column.get(row)}
                            style={
                              column.mono
                                ? { fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12 }
                                : undefined
                            }
                          >
                            {column.render ? column.render(row) : column.get(row) || "—"}
                          </span>
                        </td>
                      );
                    }

                    if (column.step) {
                      return (
                        <StepperCell
                          key={column.key}
                          value={cells[column.key] ?? ""}
                          step={column.step}
                          accent={accent}
                          accentSoft={accentSoft}
                          flagged={state === "error"}
                          label={column.label}
                          onChange={(v) => change(row, column.key, v)}
                          onCommit={() => commitRow(row)}
                          registerRef={registrar(rowIndex, column.key)}
                          tdStyle={pinned ?? { ...cellBorder, width: column.width, minWidth: column.width, padding: 0 }}
                        />
                      );
                    }

                    return (
                      <SheetCell
                        key={column.key}
                        column={asSheetColumn(column)}
                        value={cells[column.key] ?? ""}
                        error={null}
                        rowFlagged={state === "error"}
                        optionList={column.options}
                        onChange={(v) => change(row, column.key, v)}
                        onCommit={() => commitRow(row)}
                        onFocus={() => {}}
                        registerRef={registrar(rowIndex, column.key)}
                        tdStyle={pinned}
                      />
                    );
                  })}

                  <td style={{ ...cellBorder, width: 44, minWidth: 44 }}>
                    <span className="grid place-items-center" style={{ height: 38 }}>
                      <RowStatus state={state} accent={accent} />
                    </span>
                  </td>
                  <td aria-hidden style={{ ...cellBorder, borderRight: "none" }} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A number cell you can nudge.
 *
 * Typing still works and is still the way to enter a figure from scratch —
 * these buttons are for the other job, where the number already exists and the
 * decision is "up a bit" or "down a bit". A credit review reads as a column of
 * raises and reductions, and making each one a click rather than a
 * select-all-and-retype is the difference between the pass being done here and
 * being done in a spreadsheet.
 *
 * Shift-click steps by ten times, so a ₹1,00,000 move is two clicks rather
 * than a hundred. Never goes below zero: a negative credit limit is not a
 * thing, and getting there by holding a button is not an edit anyone meant.
 *
 * Nothing here writes on its own. Six taps on "+" are one figure being arrived
 * at, so the cell is written when it is left — which also means the box and
 * the two buttons are one cell for that purpose, not three: moving between
 * them is still being in the cell.
 */
function StepperCell({
  value,
  step,
  accent,
  accentSoft,
  flagged,
  label,
  onChange,
  onCommit,
  registerRef,
  tdStyle,
}: {
  value: string;
  step: number;
  accent: string;
  accentSoft: string;
  flagged: boolean;
  label: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  registerRef: (el: HTMLElement | null) => void;
  tdStyle?: React.CSSProperties;
}) {
  function bump(direction: 1 | -1, big: boolean) {
    // An empty cell is a limit that was never set, so the first + starts from
    // nothing rather than refusing to move.
    const current = Number(value.replace(/,/g, "").trim());
    const from = Number.isFinite(current) ? current : 0;
    const by = step * (big ? 10 : 1);
    // Rounded back to paise: 0.1 + 0.2 arithmetic has no business in a figure
    // someone is about to approve.
    const next = Math.max(0, Math.round((from + direction * by) * 100) / 100);
    onChange(String(next));
  }

  return (
    <td
      // React's onBlur is focusout, so it catches the box and both buttons.
      // `relatedTarget` is where focus is going: still inside this cell means
      // the stepper run isn't over, so nothing is written yet.
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onCommit?.();
      }}
      style={{
        background: flagged ? "color-mix(in srgb, var(--color-red) 5%, transparent)" : undefined,
        ...tdStyle,
      }}
    >
      <span className="sheet-control" style={{ gap: 2, padding: "0 3px" }}>
        <StepButton
          dir="down"
          label={`Decrease ${label}`}
          step={step}
          accent={accent}
          accentSoft={accentSoft}
          onClick={(big) => bump(-1, big)}
        />
        <input
          ref={registerRef as (el: HTMLInputElement | null) => void}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit?.();
          }}
          inputMode="decimal"
          aria-label={label}
          className="min-w-0 flex-1 px-1 bg-transparent text-ink-strong outline-none text-right tabular-nums"
          style={{ fontSize: 13, height: 26 }}
        />
        <StepButton
          dir="up"
          label={`Increase ${label}`}
          step={step}
          accent={accent}
          accentSoft={accentSoft}
          onClick={(big) => bump(1, big)}
        />
      </span>
    </td>
  );
}

function StepButton({
  dir,
  label,
  step,
  accent,
  accentSoft,
  onClick,
}: {
  dir: "up" | "down";
  label: string;
  step: number;
  accent: string;
  accentSoft: string;
  onClick: (big: boolean) => void;
}) {
  return (
    <button
      type="button"
      // `tabIndex={-1}`: tabbing along a row should reach the next FIGURE, not
      // two buttons per cell. The mouse is what these are for; the keyboard
      // already has typing.
      tabIndex={-1}
      aria-label={label}
      title={`${label} by ${step.toLocaleString("en-IN")} — hold Shift for ${(step * 10).toLocaleString("en-IN")}`}
      onClick={(e) => onClick(e.shiftKey)}
      className="grid place-items-center rounded-chip shrink-0 transition-colors hover:brightness-95"
      style={{ width: 20, height: 20, background: accentSoft, color: accent }}
    >
      {dir === "up" ? <Plus size={12} strokeWidth={3} /> : <Minus size={12} strokeWidth={3} />}
    </button>
  );
}

/** Where this row stands with the server, in one glyph. */
function RowStatus({ state, accent }: { state: RowState; accent: string }) {
  if (state === "saving")
    return <Loader2 size={13} strokeWidth={2.6} className="animate-spin text-ink-subtle" />;
  if (state === "saved")
    return <Check size={13} strokeWidth={3} style={{ color: "var(--color-green-deep)" }} />;
  if (state === "error")
    return <TriangleAlert size={13} strokeWidth={2.6} style={{ color: "var(--color-red-deep)" }} />;
  if (state === "dirty")
    return <span className="rounded-full" style={{ width: 6, height: 6, background: accent }} />;
  return null;
}

const cellBorder: React.CSSProperties = {
  borderRight: "1px solid var(--color-hairline)",
  borderBottom: "1px solid var(--color-hairline)",
};

function frozenStyle(left: number, width: number): React.CSSProperties {
  return { ...cellBorder, position: "sticky", left, zIndex: 1, width, minWidth: width, padding: 0 };
}

function headStyle(
  left: number | undefined,
  width: number,
  frozen: boolean,
): React.CSSProperties {
  return {
    ...cellBorder,
    // The same lid and the same column rules the tables carry — see the
    // notes in globals.css.
    borderBottom: "2px solid var(--color-table-edge)",
    borderRight: "1px solid var(--color-hairline-strong)",
    position: "sticky",
    top: 0,
    left: frozen ? left : undefined,
    // A frozen header has to outrank both the scrolling headers and the frozen
    // body cells, or a column slides over it.
    zIndex: frozen ? 3 : 2,
    width,
    minWidth: width,
    background: "color-mix(in srgb, var(--color-blue) 8%, var(--color-surface-soft))",
    backdropFilter: "blur(6px)",
    padding: "8px 12px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--color-ink-soft)",
    whiteSpace: "nowrap",
  };
}
