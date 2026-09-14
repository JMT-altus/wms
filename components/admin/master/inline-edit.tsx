"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, Minus, Plus } from "lucide-react";
import { announceSave } from "@/lib/masters/save-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Editable cells for the master tables.
 *
 * The masters are read across and corrected in place — a credit limit nudged
 * after a review, a customer type that was picked wrong at onboarding. Doing
 * that through a dialog means opening a form of thirty fields to change one,
 * so the fields with a master list behind them are the control itself: the
 * cell IS the dropdown, and the stepper sits on the number.
 *
 * Three rules hold for all of them:
 *
 *   Nothing opens the row.  Every control stops the click, because the row
 *                           itself opens the detail panel.
 *   The screen leads.       The new value paints immediately and only rolls
 *                           back if the server refuses it, so a dropdown
 *                           doesn't sit on the old value waiting for a round
 *                           trip.
 *   One save per edit.      Nothing is written per keystroke. A box is saved
 *                           when it loses focus or on Enter, a list when you
 *                           pick, and five taps on a stepper are one write.
 *
 * The edit dialog stays for everything else: free text, flags, and the fields
 * with no list to pick from.
 */

export type SaveResult = { ok: true } | { ok: false; error: string };
export type SaveFn<T> = (next: T) => Promise<SaveResult>;

/**
 * What a cell needs in order to confirm its own save.
 *
 * The same confirmation the Grid View puts up, because the table and the grid
 * are the same register edited two ways — a value corrected here should say
 * so exactly as it does there. Optional throughout: a screen that hasn't been
 * given the two names it takes simply stays quiet, as these cells always did.
 */
export interface Announce<T> {
  /** The column's heading, as the toast should name it. */
  field?: string;
  /** Which record this row is — the company, the product, the contact. */
  rowLabel?: string;
  /** The cell's value as words, for both halves of "before → after". */
  show: (v: T) => string;
}

/** The shell every inline control sits in — one border, one focus ring. */
const SHELL =
  "w-full inline-flex items-center gap-1 rounded-md border bg-surface-card text-left transition-colors hover:border-hairline-strong disabled:opacity-60";

const BORDER = "var(--color-hairline)";

/**
 * Saving, with the screen already showing the new value.
 *
 * The override is what the cell renders; it follows the row until an edit,
 * then leads it until the next server round trip catches up. Without that the
 * value would flick back to the old one for the width of the request — the
 * table is re-rendered from the server row, which is still stale at that
 * point.
 *
 * The override is a BOX (`{ v }`) rather than the value itself, because half
 * these cells are `T = string | null` and a bare `null` cannot say whether it
 * means "no override" or "override this to empty". It read as "no override",
 * so clearing a field showed the old value coming straight back — the write
 * went out and landed, but the cell sat on the stale text until the refresh
 * arrived, which is indistinguishable from an erase that didn't save.
 */
function useOptimistic<T>(row: T, save: SaveFn<T>, announce?: Announce<T>) {
  // The row this override was made against travels with it, so a new row from
  // the server drops it during render — React's own "adjust state when a prop
  // changes" pattern. An effect would repaint the stale value for a frame
  // first, which on a table is a visible flicker back to the old option.
  const [state, setState] = React.useState<{ base: T; local: { v: T } | null }>({
    base: row,
    local: null,
  });
  const [busy, setBusy] = React.useState(false);

  if (!Object.is(state.base, row)) setState({ base: row, local: null });
  const override = Object.is(state.base, row) ? state.local : null;
  const value = override ? override.v : row;

  /** Show `next` now, ahead of the server. */
  const setLocal = React.useCallback((next: T) => setState((p) => ({ ...p, local: { v: next } })), []);
  /** Put the row's own value back, after a write the server refused. */
  const rollback = React.useCallback(() => setState((p) => ({ ...p, local: null })), []);

  const commit = React.useCallback(
    (next: T) => {
      const before = row;
      setLocal(next);
      setBusy(true);
      void save(next)
        .then((res) => {
          if (!res.ok) {
            rollback();
            toast.error(res.error);
            return;
          }
          if (announce?.field) {
            announceSave(announce.rowLabel ?? "", [
              { label: announce.field, from: announce.show(before), to: announce.show(next) },
            ]);
          }
        })
        .catch(() => {
          rollback();
          toast.error("Couldn't reach the server. Try again in a moment.");
        })
        .finally(() => setBusy(false));
    },
    [save, setLocal, rollback, row, announce],
  );

  return { value, busy, commit, setLocal, rollback };
}

/** A spinner where the chevron goes, so the cell doesn't change width. */
function Trailing({ busy }: { busy: boolean }) {
  return busy ? (
    <Loader2 size={12} strokeWidth={2.6} className="shrink-0 animate-spin text-ink-subtle" />
  ) : (
    <ChevronDown size={12} strokeWidth={2.6} className="shrink-0 text-ink-subtle" />
  );
}

/* ── One value off a list ────────────────────────────────────────────────── */

/**
 * A dropdown in the cell, for a column whose value comes from a master list.
 *
 * `allowCustom` decides what happens to a value that isn't on the list: on a
 * free-text column the current value is kept as an extra option rather than
 * silently dropped, because those lists are admin-managed suggestions and a
 * row may well predate the list.
 */
export function InlineSelect({
  value: rowValue,
  options,
  onSave,
  field,
  rowLabel,
  placeholder = "—",
  accent,
  accentSoft,
  align = "start",
  width,
  clearable = true,
}: {
  value: string | null;
  options: readonly string[];
  onSave: SaveFn<string | null>;
  placeholder?: string;
  /** Colours the chosen value, matching the pill the column used to render. */
  accent?: string;
  accentSoft?: string;
  align?: "start" | "end";
  width?: number;
  /** False for a field with no "neither" — Yes/No, Active/Inactive. */
  /** The column's heading, so a save can say which field it wrote. */
  field?: string;
  /** Which record this row is, for the same reason. */
  rowLabel?: string;
  clearable?: boolean;
}) {
  const announce = React.useMemo(
    () => ({ field, rowLabel, show: (v: string | null) => v ?? "" }),
    [field, rowLabel],
  );
  const { value, busy, commit } = useOptimistic(rowValue ?? null, onSave, announce);
  const onList = value == null || options.some((o) => o === value);
  const all = onList ? options : [value, ...options];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => e.stopPropagation()}
          title={value ?? placeholder}
          className={`${SHELL} px-1.5 h-7`}
          style={{ borderColor: BORDER, width }}
        >
          <span
            className="flex-1 min-w-0 truncate font-semibold"
            style={{
              fontSize: 12,
              color: value ? (accent ?? "var(--color-ink-strong)") : "var(--color-ink-subtle)",
            }}
          >
            {value || placeholder}
          </span>
          <Trailing busy={busy} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="max-h-[320px] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {all.map((o) => (
          <DropdownMenuItem
            key={o}
            onClick={() => commit(o === value ? value : o)}
            style={o === value && accentSoft ? { background: accentSoft } : undefined}
          >
            <Check
              size={13}
              strokeWidth={3}
              style={{ opacity: o === value ? 1 : 0, color: accent ?? "currentColor" }}
            />
            {o}
          </DropdownMenuItem>
        ))}
        {clearable && all.length > 0 && <DropdownMenuSeparator />}
        {clearable && (
          <DropdownMenuItem onClick={() => commit(null)}>
            <Check size={13} strokeWidth={3} style={{ opacity: value ? 0 : 1 }} />
            <span className="text-ink-subtle">Clear</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Several values off a list ───────────────────────────────────────────── */

/**
 * Chips in the cell, each removable, with a dropdown of the rest.
 *
 * Ticking stays open — picking three customer types is one visit to the menu,
 * not three — so each tick is its own save. That is the honest trade for a
 * control with no OK button: a menu that saved on close would lose the edit
 * if the row scrolled away under it.
 */
export function InlineMulti({
  value: rowValue,
  options,
  onSave,
  field,
  rowLabel,
  label,
  accent,
  accentSoft,
  placeholder = "—",
}: {
  value: string[];
  options: readonly string[];
  onSave: SaveFn<string[]>;
  /** The column's heading, so a save can say which field it wrote. */
  field?: string;
  /** Which record this row is, for the same reason. */
  rowLabel?: string;
  /** Named in the menu's empty state: "No industry types on the list yet." */
  label: string;
  accent?: string;
  accentSoft?: string;
  placeholder?: string;
}) {
  // A fresh array every render would restart the optimistic state on each
  // pass, so the row value is compared by content, not identity.
  const key = rowValue.join(" ");
  const stable = React.useMemo(() => rowValue, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const announce = React.useMemo(
    () => ({ field, rowLabel, show: (v: string[]) => v.join(", ") }),
    [field, rowLabel],
  );
  const { value, busy, commit } = useOptimistic(stable, onSave, announce);

  const has = (o: string) => value.includes(o);
  const toggle = (o: string) =>
    commit(has(o) ? value.filter((v) => v !== o) : [...value, o]);

  // Values already on the row that have since left the master list still show
  // and can still be removed — they're on the record either way.
  const all = [...options, ...value.filter((v) => !options.includes(v))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => e.stopPropagation()}
          title={value.length ? value.join(", ") : placeholder}
          className={`${SHELL} px-1.5 py-1 min-h-7`}
          style={{ borderColor: BORDER }}
        >
          <span className="flex-1 min-w-0 flex flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="text-ink-subtle" style={{ fontSize: 12 }}>
                {placeholder}
              </span>
            ) : (
              value.map((v) => (
                <span
                  key={v}
                  className="inline-flex rounded-pill px-1.5 font-semibold"
                  style={{
                    fontSize: 10.5,
                    lineHeight: "16px",
                    background: accentSoft,
                    color: accent,
                  }}
                >
                  {v}
                </span>
              ))
            )}
          </span>
          <Trailing busy={busy} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {all.length === 0 ? (
          <div className="px-2 py-1.5 text-ink-subtle" style={{ fontSize: 12.5 }}>
            No {label.toLowerCase()} on the list yet.
          </div>
        ) : (
          all.map((o) => (
            <DropdownMenuItem
              key={o}
              // Keeps the menu open so several can be ticked in one visit.
              onSelect={(e) => e.preventDefault()}
              onClick={() => toggle(o)}
              style={has(o) && accentSoft ? { background: accentSoft } : undefined}
            >
              <Check
                size={13}
                strokeWidth={3}
                style={{ opacity: has(o) ? 1 : 0, color: accent ?? "currentColor" }}
              />
              {o}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Free text ───────────────────────────────────────────────────────────── */

/**
 * A box in the cell, for a field with no master list behind it.
 *
 * Account Name and the like: typed per record, so there is nothing to pick
 * from — but `suggestions` still fills a datalist where values repeat across
 * rows, which is what keeps one branch from being spelled three ways.
 *
 * Writes when the box loses focus or on Enter, not per keystroke; Escape puts
 * back what was there.
 */
export function InlineText({
  value: rowValue,
  onSave,
  field,
  rowLabel,
  suggestions,
  placeholder = "—",
  maxLength,
  width,
}: {
  value: string | null;
  onSave: SaveFn<string | null>;
  /** The column's heading, so a save can say which field it wrote. */
  field?: string;
  /** Which record this row is, for the same reason. */
  rowLabel?: string;
  suggestions?: readonly string[];
  placeholder?: string;
  maxLength?: number;
  width?: number;
}) {
  const announce = React.useMemo(
    () => ({ field, rowLabel, show: (v: string | null) => v ?? "" }),
    [field, rowLabel],
  );
  const { value, busy, commit } = useOptimistic(rowValue ?? null, onSave, announce);
  const [draft, setDraft] = React.useState<string | null>(null);
  const listId = React.useId();

  const shown = draft ?? value ?? "";

  const finish = () => {
    if (draft === null) return;
    const next = draft.trim() === "" ? null : draft.trim();
    setDraft(null);
    if (next !== value) commit(next);
  };

  return (
    <span
      className="flex items-center"
      onClick={(e) => e.stopPropagation()}
      style={{ width: width ?? "100%" }}
    >
      <input
        value={shown}
        disabled={busy}
        placeholder={placeholder}
        maxLength={maxLength}
        list={suggestions && suggestions.length > 0 ? listId : undefined}
        onFocus={() => setDraft(value ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className="w-full min-w-0 rounded-md border bg-surface-card px-2 outline-none focus:border-hairline-strong"
        style={{
          height: 26,
          fontSize: 12.5,
          borderColor: BORDER,
          color: shown ? "var(--color-ink-strong)" : "var(--color-ink-subtle)",
        }}
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </span>
  );
}

/* ── A figure, with steppers ─────────────────────────────────────────────── */

/**
 * A figure you type, in the cell.
 *
 * A box first and foremost: any figure can be typed straight in, because a
 * credit limit is a negotiated number, not one you arrive at by clicking.
 *
 * `step` is optional and adds −/+ buttons either side for the fields that
 * genuinely move in fixed units (credit days, in fortnights). Leave it off and
 * the cell is the box alone — which is what Credit Limit wants: stepping a
 * limit by a lakh is an assumption about how limits are set, and the ones that
 * aren't round multiples were the ones it got in the way of.
 *
 * A typed figure is written when the box loses focus or on Enter, never per
 * keystroke — "50000" typed into an empty cell would otherwise save 5, then
 * 50, then 500. Stepping is the one thing that still batches: five taps on
 * "+" are one figure being arrived at, so they go half a second after the last
 * one, and leaving the cell sends them immediately.
 *
 * While the box has focus it holds raw digits — formatting a number under the
 * cursor moves the cursor — and it returns to ₹10,00,000 on the way out.
 */
export function InlineNumber({
  value: rowValue,
  onSave,
  field,
  rowLabel,
  step,
  min = 0,
  format,
  placeholder = "—",
  width,
}: {
  value: number | null;
  onSave: SaveFn<number | null>;
  /** The column's heading, so a save can say which field it wrote. */
  field?: string;
  /** Which record this row is, for the same reason. */
  rowLabel?: string;
  /** Omit for a plain box. Set it to add −/+ buttons moving by this much. */
  step?: number;
  min?: number;
  /** How the figure reads when the box is not being typed in. */
  format?: (n: number) => string;
  placeholder?: string;
  width?: number;
}) {
  const { value, busy, setLocal, rollback } = useOptimistic(rowValue ?? null, onSave);
  const shownFigure = React.useCallback(
    (v: number | null) => (v == null ? "" : format ? format(v) : v.toLocaleString("en-IN")),
    [format],
  );
  /**
   * Where the figure stood when the current run of changes began.
   *
   * A stepper run is several taps arriving at one number, so the confirmation
   * should read 15 → 45, not 30 → 45. Set on the first change of a run and
   * cleared by the write that ends it.
   */
  const runFrom = React.useRef<{ v: number | null } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = React.useState(false);
  /** Raw text while the box is being typed in; null the rest of the time. */
  const [draft, setDraft] = React.useState<string | null>(null);

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const write = React.useCallback(
    (next: number | null) => {
      const before = runFrom.current?.v ?? null;
      runFrom.current = null;
      setSaving(true);
      void onSave(next)
        .then((res) => {
          if (!res.ok) {
            rollback();
            toast.error(res.error);
            return;
          }
          if (field) {
            announceSave(rowLabel ?? "", [
              { label: field, from: shownFigure(before), to: shownFigure(next) },
            ]);
          }
        })
        .catch(() => {
          rollback();
          toast.error("Couldn't reach the server. Try again in a moment.");
        })
        .finally(() => setSaving(false));
    },
    [onSave, rollback, field, rowLabel, shownFigure],
  );

  /**
   * Show the new figure now, and write it.
   *
   * `defer` is for the steppers alone: five taps on "+" are one figure being
   * arrived at, so they collect for half a second and go as one write. Typing
   * doesn't defer — a figure typed or erased is written when you leave the
   * box, which is the moment you said you were done with it.
   */
  const push = React.useCallback(
    (next: number | null, defer = false) => {
      if (!runFrom.current) runFrom.current = { v: value };
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      if (!defer) {
        timer.current = null;
        write(next);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        write(next);
      }, 500);
    },
    [setLocal, write, value],
  );

  const bump = (dir: 1 | -1) => {
    if (!step) return;
    const base = value ?? min;
    // Snap onto the step grid, so +/- from an odd 47,500 lands on round
    // numbers rather than carrying the 2,500 along forever.
    const next = Math.max(
      min,
      dir === 1 ? Math.floor(base / step) * step + step : Math.ceil(base / step) * step - step,
    );
    if (next === value) return;
    // A stepper click while typing takes over from the draft.
    setDraft(null);
    push(next, true);
  };

  /** What the box shows: the draft while typing, the formatted figure after. */
  const shown =
    draft ?? (value == null ? "" : format ? format(value) : value.toLocaleString("en-IN"));

  const commitDraft = () => {
    if (draft === null) return;
    const text = draft.replace(/,/g, "").trim();
    const next = text === "" ? null : Number(text);
    setDraft(null);
    if (next !== null && (!Number.isFinite(next) || next < min)) return; // ignore junk
    // Unchanged, but a stepper run may still be sitting on its timer — leaving
    // the cell is a commit, so send it now rather than after the box is gone.
    if (next === value) {
      if (timer.current) push(value);
      return;
    }
    push(next);
  };

  const btn =
    "shrink-0 grid place-items-center rounded border text-ink-muted hover:text-ink-strong hover:bg-surface-soft disabled:opacity-35";
  const btnStyle = { width: 20, height: 22, borderColor: BORDER } as const;

  return (
    <span
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      // Fills the cell by default. The box is `flex-1`, so without a width to
      // flex against it would collapse to nothing — the buttons would size the
      // row and leave a sliver to type in.
      style={{ width: width ?? "100%" }}
    >
      {step != null && (
        <button
          type="button"
          onClick={() => bump(-1)}
          disabled={busy || (value != null && value <= min)}
          aria-label="Decrease"
          title={`− ${step.toLocaleString("en-IN")}`}
          className={btn}
          style={btnStyle}
        >
          <Minus size={11} strokeWidth={3} />
        </button>
      )}

      <input
        value={shown}
        inputMode="numeric"
        placeholder={placeholder}
        disabled={busy}
        // Raw digits under the cursor; the formatted figure on the way out.
        onFocus={() => setDraft(value == null ? "" : String(value))}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || /^[0-9,]*\.?[0-9]*$/.test(raw)) setDraft(raw);
        }}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          } else if (step != null && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            // The steppers, from the keyboard — the box is already focused.
            e.preventDefault();
            bump(e.key === "ArrowUp" ? 1 : -1);
          }
        }}
        className="flex-1 min-w-0 rounded-md border bg-surface-card px-1.5 text-center tabular-nums outline-none focus:border-hairline-strong"
        style={{
          height: 22,
          minWidth: 56,
          fontSize: 12.5,
          borderColor: BORDER,
          color: value == null && draft === null ? "var(--color-ink-subtle)" : "var(--color-ink-strong)",
          opacity: saving ? 0.55 : 1,
        }}
      />

      {step != null && (
        <button
          type="button"
          onClick={() => bump(1)}
          disabled={busy}
          aria-label="Increase"
          title={`+ ${step.toLocaleString("en-IN")}`}
          className={btn}
          style={btnStyle}
        >
          <Plus size={11} strokeWidth={3} />
        </button>
      )}
    </span>
  );
}
