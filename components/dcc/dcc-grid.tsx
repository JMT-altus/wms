"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Upload,
} from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { DccItemDialog } from "@/components/dcc/dcc-item-dialog";
import { DccBulkImportDialog } from "@/components/dcc/dcc-bulk-import-dialog";
import type { DccTabPerson } from "@/components/dcc/dcc-tabs";
import { setDccEntry } from "@/app/(app)/dcc/actions";
import {
  addDays,
  scheduledDueOn,
  slotKey,
  type DccStatus,
} from "@/lib/dcc/util";
import {
  indexEntries,
  type BoardClient,
  type BoardEntry,
  type BoardItem,
  type SlotValue,
} from "@/lib/dcc/board-model";
import {
  YES_NO_OPTIONS,
  cellKind,
  cellText,
  dayLabel,
  dayName,
  frequencyLabel,
  monthDates,
  monthStart,
  parseCell,
  periodValue,
  totalText,
  weekStart,
  weekTotals,
  type GridWeek,
} from "@/lib/dcc/grid-model";

export interface DccGridProps {
  ownerId: string;
  ownerName: string;
  ownerSub: string | null;
  meId: string;
  today: string;
  /** Any date inside the last week shown. */
  anchor: string;
  weeks: GridWeek[];
  items: BoardItem[];
  entries: BoardEntry[];
  clients: BoardClient[];
  sections: string[];
  /** Everyone in the viewer's scope — the bulk setup's mapping choices. */
  people: DccTabPerson[];
  canFill: boolean;
  canManage: boolean;
}

type CellState =
  { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * The spreadsheet view of one person's checklist.
 *
 * Rows are KPI parameters; columns are the days of each week (Mon–Sat) with
 * a Weekly Actual and Weekly Deficit after each week, exactly as the sheet
 * had them. Every cell is its own save: it is marked saving the moment it
 * loses focus, saved when the server confirms, and put back to what it held
 * with the error shown if the server refuses. Nothing is written until the
 * typed value parses in the KPI's own terms (a number, Y/N/NA, or text).
 *
 * The totals are computed from the same slot map the cells render from, so
 * Weekly Actual moves as soon as a cell is saved, without a page reload.
 */
export function DccGrid(props: DccGridProps) {
  const router = useRouter();
  const serverSlots = React.useMemo(
    () => indexEntries(props.entries),
    [props.entries],
  );
  const [overlay, setOverlay] = React.useState<Map<string, SlotValue | null>>(
    new Map(),
  );
  const [states, setStates] = React.useState<Map<string, CellState>>(new Map());
  const [drafts, setDrafts] = React.useState<Map<string, string>>(new Map());
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    item: BoardItem | null;
  }>({ open: false, item: null });
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // A fresh server payload supersedes anything held optimistically — reset
  // during render (React's "adjust state when a prop changes" pattern), not in
  // an effect, so there is never a frame showing stale optimistic values.
  const [seenSlots, setSeenSlots] = React.useState(serverSlots);
  if (seenSlots !== serverSlots) {
    setSeenSlots(serverSlots);
    setOverlay(new Map());
    setStates(new Map());
    setDrafts(new Map());
  }
  React.useEffect(() => {
    const t = timers.current;
    return () => t.forEach((h) => clearTimeout(h));
  }, []);

  /** Server truth with the optimistic overlay on top — what the cells and totals both read. */
  const slots = React.useMemo(() => {
    const m = new Map(serverSlots);
    overlay.forEach((v, k) => (v ? m.set(k, v) : m.delete(k)));
    return m;
  }, [serverSlots, overlay]);

  const setState = React.useCallback((key: string, s: CellState | null) => {
    setStates((prev) => {
      const next = new Map(prev);
      if (s) next.set(key, s);
      else next.delete(key);
      return next;
    });
  }, []);

  /** Parse what was typed and save it to one slot. */
  const commit = React.useCallback(
    (item: BoardItem, date: string, raw: string) => {
      const key = slotKey(item.id, null, date);
      const previous = slots.get(key) ?? null;
      const parsed = parseCell(item.inputType, raw);
      if (!parsed.ok) {
        setState(key, { kind: "error", message: parsed.error });
        return;
      }
      setDrafts((d) => {
        const n = new Map(d);
        n.delete(key);
        return n;
      });
      if (
        cellText(item.inputType, parsed.value) ===
        cellText(item.inputType, previous)
      ) {
        setState(key, null);
        return;
      }
      setOverlay((prev) => new Map(prev).set(key, parsed.value));
      setState(key, { kind: "saving" });
      const v = parsed.value;
      void setDccEntry({
        itemId: item.id,
        date,
        status: (v?.status as DccStatus | null) ?? null,
        value: v?.valueNumber == null ? null : Number(v.valueNumber),
        note: v?.note ?? null,
        subjectId: null,
        silent: true,
      }).then((res) => {
        if (res.ok) {
          setState(key, { kind: "saved" });
          const old = timers.current.get(key);
          if (old) clearTimeout(old);
          timers.current.set(
            key,
            setTimeout(() => setState(key, null), 1800),
          );
        } else {
          // Put back exactly what the cell held; the error stays on the cell.
          setOverlay((prev) => new Map(prev).set(key, previous));
          setState(key, { kind: "error", message: res.error });
          toast.error(res.error);
        }
      });
    },
    [slots, setState],
  );

  const gridItems = props.items.filter((i) => cellKind(i) !== "none");
  const otherCount = props.items.length - gridItems.length;
  const thisWeek = weekStart(props.today);
  const anchorWeek = weekStart(props.anchor);
  const go = (anchor: string) =>
    router.push(`/dcc?emp=${props.ownerId}&view=grid&week=${anchor}`);

  return (
    <div className="space-y-3">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DCE4F0] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
        <div className="flex items-center gap-2">
          <EmployeeAvatar name={props.ownerName} size="sm" />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold text-[#0B1F44]">
              {props.ownerName}
            </div>
            {props.ownerSub && (
              <div className="text-[11.5px] text-[#64748B]">
                {props.ownerSub}
              </div>
            )}
          </div>
        </div>

        <div className="ml-auto flex h-8 items-center gap-0.5 rounded-lg border border-[#D6DEEB] bg-white px-0.5 max-md:ml-0">
          <button
            type="button"
            aria-label="Earlier weeks"
            onClick={() => go(addDays(anchorWeek, -7))}
            className={STEP}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] px-2 text-center text-[13px] font-semibold text-[#0B1F44]">
            {props.weeks[0]?.label} –{" "}
            {props.weeks[props.weeks.length - 1]?.label}
          </span>
          <button
            type="button"
            aria-label="Later weeks"
            disabled={anchorWeek >= thisWeek}
            onClick={() => go(addDays(anchorWeek, 7))}
            className={STEP}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {anchorWeek !== thisWeek && (
          <button
            type="button"
            onClick={() => go(thisWeek)}
            className="text-[12.5px] font-semibold text-[#0A6CFF] hover:underline"
          >
            This week
          </button>
        )}
        <Link
          href={`/dcc?emp=${props.ownerId}&view=day`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#D6DEEB] bg-white px-3 text-[12.5px] font-semibold text-[#0B1F44] transition-colors hover:border-[#0A6CFF] hover:text-[#0B4FB8]"
        >
          Day view
        </Link>
        {props.canManage && (
          <button
            type="button"
            onClick={() => setDialog({ open: true, item: null })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0A6CFF] px-3 text-[12.5px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] transition-colors hover:bg-[#0058D6]"
          >
            <Plus size={14} /> Add KPI
          </button>
        )}
        {props.canManage && (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#D6DEEB] bg-white px-3 text-[12.5px] font-semibold text-[#0B1F44] transition-colors hover:border-[#0A6CFF] hover:text-[#0B4FB8]"
          >
            <Upload size={14} /> Bulk setup
          </button>
        )}
      </div>

      {/* ── The sheet ───────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-[#DCE4F0] bg-white shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
        <table
          className="min-w-max border-collapse text-[12.5px]"
          data-testid="dcc-grid"
        >
          <thead className="text-ink-subtle">
            <tr>
              <th className={`${TH} ${STICKY_1}`} rowSpan={3}>
                Sr No
              </th>
              <th className={`${TH} ${STICKY_2} text-left`} rowSpan={3}>
                Parameters
              </th>
              <th className={`${TH} ${STICKY_3} text-left`} rowSpan={3}>
                Frequency
              </th>
              {props.weeks.map((w) => (
                <th
                  key={w.monday}
                  colSpan={8}
                  className={`${TH} dcc-week-head ${WEEK_SEP} text-[12px]`}
                >
                  {w.label}
                </th>
              ))}
            </tr>
            <tr>
              {props.weeks.map((w) => (
                <React.Fragment key={w.monday}>
                  {w.days.map((d) => (
                    <th
                      key={d}
                      className={`${TH} ${d === props.today ? TODAY : ""} ${d === w.days[0] ? "border-l-2 border-l-[#C9DAFB]" : ""}`}
                    >
                      {dayName(d)}
                    </th>
                  ))}
                  <th className={`${TH} dcc-sum-head w-[92px]`} rowSpan={2}>
                    Weekly
                    <br />
                    Actual
                  </th>
                  <th className={`${TH} dcc-sum-head w-[84px]`} rowSpan={2}>
                    Weekly
                    <br />
                    Deficit
                  </th>
                </React.Fragment>
              ))}
            </tr>
            <tr>
              {props.weeks.map((w) =>
                w.days.map((d) => (
                  <th
                    key={d}
                    className={`${TH} font-semibold tabular-nums ${d === props.today ? TODAY : ""} ${d === w.days[0] ? "border-l-2 border-l-[#C9DAFB]" : ""}`}
                  >
                    {dayLabel(d)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {gridItems.length === 0 && (
              <tr>
                <td
                  colSpan={3 + props.weeks.length * 8}
                  className="px-4 py-10 text-center text-[13px] text-ink-subtle"
                >
                  {props.canManage
                    ? "No KPI parameters yet. Use Add KPI to set up this checklist."
                    : "No KPI parameters have been set up for this checklist yet."}
                </td>
              </tr>
            )}
            {gridItems.map((item, idx) => {
              const kind = cellKind(item);
              return (
                <tr
                  key={item.id}
                  className="group border-t border-[#EEF2F7] hover:bg-[#F6F9FF]"
                >
                  <td
                    className={`${TD} ${STICKY_1} text-center tabular-nums text-ink-subtle`}
                  >
                    {idx + 1}
                  </td>
                  <td className={`${TD} ${STICKY_2}`}>
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink-strong">
                          {item.code && (
                            <span className="mr-1.5 text-ink-subtle">
                              {item.code}
                            </span>
                          )}
                          {item.title}
                        </div>
                        {(item.section || item.unit) && (
                          <div className="text-[11px] text-ink-subtle">
                            {[item.section, item.unit]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                      {props.canManage && (
                        <button
                          type="button"
                          aria-label={`Edit ${item.title}`}
                          onClick={() => setDialog({ open: true, item })}
                          className="ml-auto rounded p-1 text-ink-subtle opacity-0 transition hover:bg-surface-track hover:text-ink-strong focus:opacity-100 group-hover:opacity-100"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td
                    className={`${TD} ${STICKY_3} whitespace-nowrap text-ink-soft`}
                  >
                    {frequencyLabel(item)}
                  </td>

                  {props.weeks.map((w) => {
                    const totals = weekTotals(item, slots, w);
                    return (
                      <React.Fragment key={w.monday}>
                        {kind === "daily" ? (
                          w.days.map((d) => {
                            const due = scheduledDueOn(item, d);
                            const key = slotKey(item.id, null, d);
                            return (
                              <td
                                key={d}
                                className={`${TD} p-0 ${d === props.today ? TODAY : ""} ${d === w.days[0] ? "border-l-2 border-l-[#C9DAFB]" : ""} ${due ? "" : "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--color-surface-track)_6px,var(--color-surface-track)_7px)]"}`}
                              >
                                {due && (
                                  <div className="w-[96px]">
                                    <Cell
                                      item={item}
                                      value={slots.get(key) ?? null}
                                      draft={drafts.get(key)}
                                      state={states.get(key) ?? null}
                                      editable={
                                        props.canFill && d <= props.today
                                      }
                                      onDraft={(s) =>
                                        setDrafts((m) => new Map(m).set(key, s))
                                      }
                                      onCommit={(raw) => commit(item, d, raw)}
                                    />
                                  </div>
                                )}
                              </td>
                            );
                          })
                        ) : (
                          <PeriodCell
                            item={item}
                            week={w}
                            kind={kind as "weekly" | "monthly"}
                            slots={slots}
                            drafts={drafts}
                            states={states}
                            today={props.today}
                            canFill={props.canFill}
                            onDraft={(key, s) =>
                              setDrafts((m) => new Map(m).set(key, s))
                            }
                            onCommit={commit}
                          />
                        )}
                        <td
                          className={`${TD} dcc-sum text-right font-semibold tabular-nums text-[#0B1F44]`}
                        >
                          {kind === "monthly" ? (
                            <span className="text-ink-subtle">—</span>
                          ) : (
                            <>
                              {totalText(totals.actual)}
                              {item.inputType === "yesno" &&
                                totals.actual != null && (
                                  <span className="ml-0.5 text-[10.5px] font-semibold text-ink-subtle">
                                    Y
                                  </span>
                                )}
                            </>
                          )}
                        </td>
                        <td
                          className={`${TD} dcc-sum text-right font-semibold tabular-nums`}
                          style={{ color: deficitColor(totals.deficit) }}
                        >
                          {totalText(totals.deficit)}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[12px] leading-relaxed text-[#5B6B85]">
        Weekly Actual adds up the week&apos;s numbers (for Yes / No parameters,
        how many days were Yes; for text, how many days have an answer). Weekly
        Deficit is the week&apos;s target minus the actual, shown only where a
        target is configured. Weekly parameters have one cell per week and
        monthly ones one per month.
        {otherCount > 0 && (
          <>
            {" "}
            {otherCount} ad-hoc, event or participant{" "}
            {otherCount === 1 ? "parameter is" : "parameters are"} on the{" "}
            <Link
              href={`/dcc?emp=${props.ownerId}&view=day`}
              className="font-semibold text-[#0A6CFF] hover:underline"
            >
              Day view
            </Link>
            .
          </>
        )}
      </p>

      <DccBulkImportDialog
        open={bulkOpen}
        onClose={(applied) => {
          setBulkOpen(false);
          if (applied) router.refresh();
        }}
        people={props.people}
      />
      <DccItemDialog
        open={dialog.open}
        onClose={() => {
          setDialog({ open: false, item: null });
          router.refresh();
        }}
        ownerId={props.ownerId}
        item={dialog.item}
        allItems={props.items}
        clients={props.clients}
        sections={props.sections}
      />
    </div>
  );
}

/* ── one week-or-month cell for a weekly / monthly parameter ──────────── */

function PeriodCell({
  item,
  week,
  kind,
  slots,
  drafts,
  states,
  today,
  canFill,
  onDraft,
  onCommit,
}: {
  item: BoardItem;
  week: GridWeek;
  kind: "weekly" | "monthly";
  slots: Map<string, SlotValue>;
  drafts: Map<string, string>;
  states: Map<string, CellState>;
  today: string;
  canFill: boolean;
  onDraft: (key: string, s: string) => void;
  onCommit: (item: BoardItem, date: string, raw: string) => void;
}) {
  const dates = kind === "weekly" ? week.days : monthDates(week.month);
  const existing = periodValue(item.id, slots, dates);
  // Write to where the value already is, else the period's first day.
  const date =
    existing?.date ??
    (kind === "weekly" ? week.monday : monthStart(week.monday));
  const key = slotKey(item.id, null, date);
  const first = kind === "weekly" ? week.monday : monthStart(week.monday);
  return (
    <td colSpan={6} className={`${TD} border-l-2 border-l-[#C9DAFB] p-0`}>
      <div className="flex items-center gap-2 px-2">
        <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wide text-ink-subtle">
          {kind === "weekly" ? "Week" : `Month ${week.month}`}
        </span>
        <div className="min-w-[120px] flex-1">
          <Cell
            item={item}
            value={existing?.value ?? null}
            draft={drafts.get(key)}
            state={states.get(key) ?? null}
            editable={canFill && first <= today}
            onDraft={(s) => onDraft(key, s)}
            onCommit={(raw) => onCommit(item, date, raw)}
          />
        </div>
      </div>
    </td>
  );
}

/* ── a single cell ───────────────────────────────────────────────────── */

function Cell({
  item,
  value,
  draft,
  state,
  editable,
  onDraft,
  onCommit,
}: {
  item: BoardItem;
  value: SlotValue | null;
  draft: string | undefined;
  state: CellState | null;
  editable: boolean;
  onDraft: (s: string) => void;
  onCommit: (raw: string) => void;
}) {
  const text = cellText(item.inputType, value);
  const shown = draft ?? text;
  const base = `h-9 w-full min-w-[74px] bg-transparent px-2 text-[12.5px] text-ink-strong outline-none ${
    item.inputType === "number" ? "text-right tabular-nums" : ""
  } ${state?.kind === "error" ? "ring-2 ring-inset ring-[var(--color-red)]" : "focus:ring-2 focus:ring-inset focus:ring-[#0A6CFF]"}`;

  let field: React.ReactNode;
  if (!editable) {
    field = (
      <div
        className={`${base} flex items-center ${item.inputType === "number" ? "justify-end" : ""} text-ink-soft`}
      >
        {text}
      </div>
    );
  } else if (item.inputType === "yesno") {
    field = (
      <select
        aria-label={`${item.title} answer`}
        className={`${base} cursor-pointer appearance-none text-center font-bold`}
        value={text}
        onChange={(e) => onCommit(e.target.value)}
        data-state={state?.kind}
      >
        {YES_NO_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o === "" ? "–" : o}
          </option>
        ))}
      </select>
    );
  } else {
    field = (
      <input
        aria-label={`${item.title} value`}
        className={base}
        inputMode={item.inputType === "number" ? "decimal" : "text"}
        value={shown}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") onDraft(text);
        }}
        data-state={state?.kind}
      />
    );
  }

  return (
    <div
      className="relative"
      title={state?.kind === "error" ? state.message : undefined}
    >
      {field}
      {state && (
        <span
          className="pointer-events-none absolute right-0.5 top-0.5"
          aria-live="polite"
          data-testid="cell-state"
        >
          {state.kind === "saving" && (
            <Loader2 size={11} className="animate-spin text-ink-subtle" />
          )}
          {state.kind === "saved" && (
            <Check size={11} style={{ color: "var(--color-green)" }} />
          )}
          {state.kind === "error" && (
            <AlertCircle size={11} style={{ color: "var(--color-red)" }} />
          )}
        </span>
      )}
      {state?.kind === "error" && (
        <span className="sr-only">{state.message}</span>
      )}
    </div>
  );
}

function deficitColor(deficit: number | null): string | undefined {
  if (deficit == null) return "var(--color-ink-subtle)";
  return deficit > 0 ? "var(--color-red-deep)" : "var(--color-green-deep)";
}

// The WMS table look (white rows, pale blue-grey header, blue week bands); page-level rules in globals.css (.dcc-page).
const TH =
  "border-b border-[#E2E8F0] px-2 py-1.5 text-center text-[11.5px] font-semibold align-bottom";
const TD = "border-b border-[#EEF2F7] px-2 py-1 align-middle";
/** Today's column keeps its amber highlight (dcc-today restores it over the module's header colour). */
const TODAY = "dcc-today bg-[var(--color-amber-bg)]";
/** Where each week starts: a blue rule. */
const WEEK_SEP = "border-l-2 border-l-[#C9DAFB]";
const STICKY_1 = "sticky left-0 z-[2] w-[52px] bg-white";
const STICKY_2 =
  "sticky left-[52px] z-[2] min-w-[240px] max-w-[320px] bg-white";
const STICKY_3 =
  "sticky left-[292px] z-[2] bg-white shadow-[4px_0_6px_-4px_rgba(11,31,68,0.18)]";
const STEP =
  "grid size-7 place-items-center rounded-md text-[#475569] transition hover:bg-[#EEF4FF] hover:text-[#0B4FB8] disabled:opacity-30";
