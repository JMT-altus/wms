"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import {
  optionsFor,
  splitMulti,
  type ClientBulkColumn,
  type ClientBulkOptions,
} from "@/lib/forms/client-bulk-columns";
import { KYC_ACCENT } from "./kyc/tokens";

/**
 * One cell of a client sheet.
 *
 * Lifted out of the Bulk Import sheet so the Client Master's Grid View can be
 * the same thing over existing rows. The two screens do different jobs — one
 * creates clients from a blank sheet, the other edits the ones already there —
 * but a Customer Type cell has to look and behave identically in both, and two
 * copies of a popup carrying a search box, a multi-select and a "use what I
 * typed" escape hatch would not stay identical for long.
 *
 * Everything here is presentational: it renders a `<td>`, reports changes, and
 * knows nothing about where the value is stored or when it is written.
 */

export function SheetCell({
  column,
  value,
  error,
  rowFlagged,
  options,
  optionList,
  onChange,
  onCommit,
  onFocus,
  registerRef,
  tdStyle,
}: {
  column: ClientBulkColumn;
  value: string;
  error: string | null;
  rowFlagged: boolean;
  /** The Client KYC option bag. Omit when passing `optionList` instead. */
  options?: ClientBulkOptions;
  /**
   * This cell's options, spelled out.
   *
   * The Bulk Import sheet resolves its lists through `optionsFor`, which knows
   * the Client KYC columns by name. The master grids don't have that bag —
   * their lists come from whatever loader that master uses — so they hand the
   * list over directly and skip the lookup.
   */
  optionList?: readonly string[];
  onChange: (value: string) => void;
  /**
   * The cell is finished with — the box lost focus or took Enter, a value was
   * picked off the list, the popup closed.
   *
   * Separate from `onChange` because a sheet that writes has to know the
   * difference between "the value is currently this" and "I'm done with this
   * cell": saving on every keystroke writes half-typed values, and a timer
   * guessing when the typing stopped writes them too. Bulk Import has nothing
   * to save to and leaves it off; the master grids save on it.
   *
   */
  onCommit?: () => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
  /**
   * Overrides for the cell's own `<td>` — the Client Master grid freezes its
   * first column with these. Merged over the defaults, so width and the
   * error tint still come from the column unless deliberately replaced.
   */
  tdStyle?: React.CSSProperties;
}) {
  const tone = error
    ? "color-mix(in srgb, var(--color-red) 11%, transparent)"
    : rowFlagged
      ? "color-mix(in srgb, var(--color-red) 5%, transparent)"
      : undefined;

  return (
    <td
      title={error ?? undefined}
      style={{
        width: column.width,
        minWidth: column.width,
        background: tone,
        borderRight: "1px solid var(--color-hairline)",
        borderBottom: "1px solid var(--color-hairline)",
        padding: 0,
        ...tdStyle,
      }}
    >
      {column.kind === "select" || column.kind === "multi" ? (
        <OptionCell
          column={column}
          value={value}
          options={options}
          optionList={optionList}
          onChange={onChange}
          onCommit={onCommit}
          onFocus={onFocus}
          registerRef={registerRef}
        />
      ) : (
        <input
          ref={registerRef as (el: HTMLInputElement | null) => void}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            // Enter commits where you stand. The grid's own key handler then
            // walks to the row below, so Enter reads as "done, next" — the
            // same two things it does in a spreadsheet.
            if (e.key === "Enter") onCommit?.();
          }}
          onFocus={onFocus}
          inputMode={column.kind === "number" ? "decimal" : undefined}
          className="sheet-control"
          // Figures right, words left — a column of amounts is read down its
          // last digit, and a column of names down its first letter.
          style={column.kind === "number" ? { textAlign: "right" } : undefined}
        />
      )}
    </td>
  );
}

/**
 * A cell backed by a master list — one value, or several.
 *
 * A hand-rolled popup rather than `<select>` because three of these columns
 * are multi-value (Customer Type, Industry Type, Product Types), and a
 * `<select multiple>` is unusable at row height. The same popup does both, so
 * a single-value and a multi-value cell look and behave the same everywhere
 * except in what a click does.
 *
 * Free-text columns keep a typing box: State and Payment Terms are stored as
 * text, and the list is a suggestion, not a constraint.
 */
function OptionCell({
  column,
  value,
  options,
  optionList,
  onChange,
  onCommit,
  onFocus,
  registerRef,
}: {
  column: ClientBulkColumn;
  value: string;
  options?: ClientBulkOptions;
  optionList?: readonly string[];
  onChange: (value: string) => void;
  onCommit?: () => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);

  /**
   * Where the popup sits on the page.
   *
   * The list is rendered in a PORTAL at fixed coordinates rather than
   * absolutely inside the cell. Inside the cell it was a child of the sheet's
   * `overflow: auto` scroller, so it was clipped at the table's edge — a
   * dropdown near the right-hand columns lost most of its options, and one on
   * the last row was cut off entirely.
   *
   * Recomputed on open and on every scroll or resize while open, so the list
   * tracks its cell instead of floating where the cell used to be.
   */
  const [at, setAt] = React.useState<{ left: number; top: number; width: number; up: boolean } | null>(
    null,
  );

  const place = React.useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(column.width, 220);
    const height = popupRef.current?.offsetHeight ?? 280;
    // Flip above the cell when there isn't room below, and never run off the
    // right edge of the window.
    const up = r.bottom + height > window.innerHeight && r.top > height;
    setAt({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: up ? r.top - height - 2 : r.bottom + 2,
      width,
      up,
    });
  }, [column.width]);

  React.useLayoutEffect(() => {
    // Nothing to clear when closing: the popup isn't rendered, and this runs
    // before paint on the way back open, so it never flashes at the old spot.
    if (!open) return;
    place();
    // `true` for capture, so this sees the sheet's own scroller and not just
    // the window — the cell moves when the table scrolls, not the page.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Dismiss counts the popup as "inside": it is a portal, so a click in the
  // list is outside `boxRef` as far as the DOM tree is concerned.
  const dismissRefs = React.useMemo(() => [boxRef, popupRef], []);
  useDismissAny(dismissRefs, open, () => {
    setOpen(false);
    setQuery("");
    // A multi-select is ticked several times in one visit, so the commit is
    // the popup closing rather than each tick. A single-select commits in
    // `pick` instead — the popup is already shutting by then.
    onCommit?.();
  });

  // Memoised because the `??` branch builds a fresh array when it falls
  // through to the empty default, which would re-run the filter below on every
  // render of every cell in the sheet.
  const list = React.useMemo(
    () => optionList ?? (options ? optionsFor(column, options) : []),
    [optionList, options, column],
  );
  const selected = column.kind === "multi" ? splitMulti(value) : value.trim() ? [value.trim()] : [];
  const selectedKeys = new Set(selected.map((s) => s.toLowerCase()));

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((o) => o.toLowerCase().includes(q)) : list;
  }, [list, query]);

  function pick(option: string) {
    if (column.kind === "multi") {
      const next = selectedKeys.has(option.toLowerCase())
        ? selected.filter((s) => s.toLowerCase() !== option.toLowerCase())
        : [...selected, option];
      onChange(next.join(", "));
    } else {
      onChange(option);
      setOpen(false);
      setQuery("");
      onCommit?.();
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={registerRef as (el: HTMLButtonElement | null) => void}
        type="button"
        onFocus={onFocus}
        // Tabbing off a closed list cell commits it. While the popup is open
        // focus moves INTO the popup, which is not the cell being left —
        // that commit belongs to the dismiss handler above.
        onBlur={() => {
          if (!open) onCommit?.();
        }}
        onClick={() => setOpen((v) => !v)}
        className="sheet-control"
        title={selected.length > 0 ? selected.join(", ") : undefined}
      >
        {selected.length === 0 ? (
          // An em dash, not "— leave blank —": the box already says this is a
          // cell you can fill, so the words were only ever restating it.
          <span className="flex-1 min-w-0 text-ink-subtle">—</span>
        ) : column.kind === "multi" ? (
          <span className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
            {selected.map((s) => (
              <span key={s} className="sheet-pill">
                {s}
              </span>
            ))}
          </span>
        ) : (
          <span className="flex-1 min-w-0 truncate font-semibold">{selected.join(", ")}</span>
        )}
        <ChevronDown size={13} strokeWidth={2.4} className="shrink-0 text-ink-subtle" />
      </button>

      {open && (
        <Portal>
        <div
          ref={popupRef}
          className="fixed z-[200] rounded-chip border border-hairline bg-surface-card shadow-xl overflow-hidden"
          style={{
            width: at?.width ?? Math.max(column.width, 220),
            left: at?.left ?? -9999,
            top: at?.top ?? -9999,
            // Hidden until measured, so it never paints at the corner first.
            visibility: at ? "visible" : "hidden",
          }}
        >
          {(list.length > 8 || column.freeText) && (
            <div className="p-1.5" style={{ borderBottom: "1px solid var(--color-hairline)" }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && column.freeText && query.trim()) {
                    e.preventDefault();
                    pick(query.trim());
                    setQuery("");
                  }
                }}
                placeholder={column.freeText ? "Search or type your own…" : "Search…"}
                className="w-full rounded-chip px-2 h-7 bg-surface-soft border border-hairline text-[12.5px] text-ink-strong outline-none"
              />
            </div>
          )}

          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
                onCommit?.();
              }}
              className="w-full text-left px-3 py-1.5 text-ink-muted transition-colors hover:bg-surface-soft"
              style={{ fontSize: 12.5 }}
            >
              — leave blank —
            </button>

            {column.freeText && query.trim() && !list.some((o) => o.toLowerCase() === query.trim().toLowerCase()) && (
              <button
                type="button"
                onClick={() => {
                  pick(query.trim());
                  setQuery("");
                }}
                className="w-full text-left px-3 py-1.5 font-semibold transition-colors hover:bg-surface-soft"
                style={{ fontSize: 12.5, color: KYC_ACCENT }}
              >
                Use “{query.trim()}”
              </button>
            )}

            {shown.map((option) => {
              const on = selectedKeys.has(option.toLowerCase());
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => pick(option)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors hover:bg-surface-soft"
                  style={{ fontSize: 12.5 }}
                >
                  {column.kind === "multi" && (
                    <span
                      aria-hidden
                      className="shrink-0 grid place-items-center rounded"
                      style={{
                        width: 14,
                        height: 14,
                        border: `1.5px solid ${on ? KYC_ACCENT : "var(--color-hairline-strong)"}`,
                        background: on ? KYC_ACCENT : "transparent",
                      }}
                    >
                      {on && (
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.5L5 9L9.5 3.5"
                            stroke="#fff"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  )}
                  <span
                    className="truncate"
                    style={{
                      color: on ? "var(--color-ink-strong)" : "var(--color-ink-soft)",
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {option}
                  </span>
                </button>
              );
            })}

            {shown.length === 0 && !column.freeText && (
              <p className="px-3 py-2 text-ink-muted" style={{ fontSize: 12.5 }}>
                Nothing matches. Add it to the master first.
              </p>
            )}
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

/**
 * Renders into `document.body`, so a popup escapes the sheet's scroller.
 *
 * No mounted guard: this only ever renders while a popup is open, and a popup
 * only opens on a click, which is after hydration by definition.
 */
function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

/** Close a popup on a click outside ANY of these, or on Escape. */
function useDismissAny(
  refs: React.RefObject<HTMLElement | null>[],
  active: boolean,
  close: () => void,
): void {
  React.useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [refs, active, close]);
}

/** Close a popup on an outside click or Escape. */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  close: () => void,
): void {
  React.useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ref, active, close]);
}
