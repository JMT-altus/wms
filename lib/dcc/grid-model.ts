/**
 * DCC — the spreadsheet grid model.
 *
 * The employee-wise checklist is a sheet: one row per KPI, one column per day
 * grouped into calendar weeks (Mon–Sat, as the sheet has them), then a Weekly
 * Actual and a Weekly Deficit per week. This module is the pure arithmetic
 * behind that grid — client-safe (no server-only, no db, no React) so the same
 * numbers appear in the browser while typing and on the server pages.
 *
 * Nothing here decides due-ness on its own: every daily cell asks
 * `scheduledDueOn`, the one predicate the whole module uses, so a weekly or
 * monthly KPI can never count against a day.
 *
 *   Weekly Actual   number KPI → the sum of the week's numbers (what the sheet's
 *                   "Actual" column adds up); Yes/No KPI → how many days were
 *                   answered Yes; text KPI → how many days have an answer.
 *   Weekly Deficit  the week's target minus the actual, when the KPI has a
 *                   target: a per-day target counts once for every day the
 *                   KPI is due that week, a per-week target once. A KPI with
 *                   no target has no deficit (shown as "—", never as 0).
 */

import { addDays, isoDate, isoWeekKey, pctOf, scheduledDueOn, slotKey, weekdayBit, isFilled } from "@/lib/dcc/util";
import { fmtDate } from "@/lib/dates";
import { dayStats, type BoardItem, type SlotValue } from "@/lib/dcc/board-model";

export type DccInputType = "number" | "yesno" | "text";
export type TargetPeriod = "day" | "week" | "month";

/** Monday of the week that contains `iso`. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayBit(iso));
}

/** "Week No. 45" — the ISO week number, as the sheet heads each block. */
export function weekLabel(mondayIso: string): string {
  return `Week No. ${Number(isoWeekKey(mondayIso).split("-W")[1])}`;
}

export interface GridWeek {
  /** Monday, yyyy-mm-dd. */
  monday: string;
  label: string;
  /** Mon … Sat. */
  days: string[];
  /** "2026-11" of the Monday — monthly KPIs are grouped by it. */
  month: string;
}

/** `count` consecutive weeks ending with the week of `endIso` (inclusive). */
export function gridWeeks(endIso: string, count: number): GridWeek[] {
  const last = weekStart(endIso);
  const out: GridWeek[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const monday = addDays(last, -7 * i);
    out.push({ monday, label: weekLabel(monday), days: Array.from({ length: 6 }, (_, d) => addDays(monday, d)), month: monday.slice(0, 7) });
  }
  return out;
}

/** "Mon" … "Sat" for a yyyy-mm-dd. */
export function dayName(iso: string): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekdayBit(iso)]!;
}

/** "05/11/26" — the sheet's date heading, in the WMS standard form. */
export function dayLabel(iso: string): string {
  return fmtDate(iso);
}

/** First day of the month a date is in. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * Where one KPI is answered in one week:
 *   daily (scheduled)   one cell per day it is due;
 *   weekly              one cell for the whole week, stored on the Monday;
 *   monthly             one cell for the whole month, stored on the 1st;
 *   adhoc / event       no cell in the grid (they live in the board's trays).
 * The stored date is what `setDccEntry` writes to, so a weekly fill made on the
 * day board on a Wednesday still shows (see `periodValue`).
 */
export type CellKind = "daily" | "weekly" | "monthly" | "none";

export function cellKind(item: Pick<BoardItem, "scheduleKind" | "isParticipantList">): CellKind {
  if (item.isParticipantList) return "none";
  switch (item.scheduleKind) {
    case "scheduled":
      return "daily";
    case "weekly":
      return "weekly";
    case "monthly":
      return "monthly";
    default:
      return "none";
  }
}

/** The dates of a week on which a daily KPI is due. */
export function dueDays(item: BoardItem, week: GridWeek): string[] {
  return week.days.filter((d) => scheduledDueOn(item, d));
}

/** The latest stored value for a KPI over a run of dates (a weekly or monthly cell). */
export function periodValue(itemId: string, slots: Map<string, SlotValue>, dates: readonly string[]): { date: string; value: SlotValue } | null {
  for (let i = dates.length - 1; i >= 0; i--) {
    const v = slots.get(slotKey(itemId, null, dates[i]!));
    if (isFilled(v)) return { date: dates[i]!, value: v! };
  }
  return null;
}

/** Every date of a month, for a monthly cell's lookup. */
export function monthDates(month: string): string[] {
  const first = `${month}-01`;
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ── one cell's value, in the KPI's own terms ─────────────────────────── */

export const YES_NO_OPTIONS = ["", "Y", "N", "NA"] as const;
export type YesNo = (typeof YES_NO_OPTIONS)[number];

/** What a stored fill shows in the cell: "153671", "Y", "ROTO". */
export function cellText(inputType: DccInputType, v: SlotValue | null | undefined): string {
  if (!v) return "";
  if (inputType === "number") return v.valueNumber == null ? "" : trimNumber(v.valueNumber);
  if (inputType === "yesno") return v.status === "Done" ? "Y" : v.status === "Not done" ? "N" : v.status === "NA" ? "NA" : "";
  return v.note ?? "";
}

/** "153671.00" → "153671"; "12.50" stays. */
export function trimNumber(n: string | number): string {
  const s = typeof n === "number" ? String(n) : n;
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export type CellParse = { ok: true; value: SlotValue | null } | { ok: false; error: string };

/**
 * Turn what was typed into the fill to store, or null to clear the cell.
 *   number  → value_number, with status Done so the day counts as done (the
 *             compliance engine reads status, exactly as the day board does);
 *   yesno   → status Done / Not done / NA — the answer itself, never a number;
 *   text    → note, with status Done.
 */
export function parseCell(inputType: DccInputType, raw: string): CellParse {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  if (inputType === "number") {
    const n = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(n) || Math.abs(n) > 99_999_999_999) return { ok: false, error: "Enter a number" };
    return { ok: true, value: { status: "Done", valueNumber: String(n), note: null } };
  }
  if (inputType === "yesno") {
    const u = s.toUpperCase();
    if (u === "Y" || u === "YES") return { ok: true, value: { status: "Done", valueNumber: null, note: null } };
    if (u === "N" || u === "NO") return { ok: true, value: { status: "Not done", valueNumber: null, note: null } };
    if (u === "NA" || u === "N/A") return { ok: true, value: { status: "NA", valueNumber: null, note: null } };
    return { ok: false, error: "Answer Y, N or NA" };
  }
  if (s.length > 2000) return { ok: false, error: "Keep it under 2,000 characters" };
  return { ok: true, value: { status: "Done", valueNumber: null, note: s } };
}

/* ── the week's totals ─────────────────────────────────────────────────── */

export interface WeekTotals {
  /** Days the KPI was due this week (daily KPIs), or 1 for a weekly cell. */
  due: number;
  /** Days answered. */
  filled: number;
  /** The sheet's "Actual": a sum for numbers, a count of Yes for Y/N, a count of answers for text. null = nothing entered. */
  actual: number | null;
  /** The week's target, from `targetNumber` × its period; null = no target configured. */
  target: number | null;
  /** target − actual; null when either is missing. Positive = short of target. */
  deficit: number | null;
}

export function weekTotals(item: BoardItem, slots: Map<string, SlotValue>, week: GridWeek): WeekTotals {
  const kind = cellKind(item);
  const inputType = item.inputType;
  let due = 0;
  let filled = 0;
  let actual: number | null = null;
  const add = (v: SlotValue | null | undefined) => {
    if (!isFilled(v)) return;
    filled++;
    if (inputType === "number") {
      if (v!.valueNumber != null) actual = (actual ?? 0) + Number(v!.valueNumber);
    } else if (inputType === "yesno") {
      actual = (actual ?? 0) + (v!.status === "Done" ? 1 : 0);
    } else {
      actual = (actual ?? 0) + 1;
    }
  };
  if (kind === "daily") {
    for (const d of dueDays(item, week)) {
      due++;
      add(slots.get(slotKey(item.id, null, d)));
    }
  } else if (kind === "weekly") {
    due = 1;
    add(periodValue(item.id, slots, week.days)?.value ?? null);
  } else {
    return { due: 0, filled: 0, actual: null, target: null, deficit: null };
  }
  const target = weekTarget(item, due);
  return { due, filled, actual, target, deficit: target == null || actual == null ? null : target - actual };
}

/** The week's target from the KPI's configuration; null when it has none (or its target is monthly). */
export function weekTarget(item: Pick<BoardItem, "targetNumber" | "targetPeriod">, dueThisWeek: number): number | null {
  if (item.targetNumber == null) return null;
  const t = Number(item.targetNumber);
  if (!Number.isFinite(t)) return null;
  if (item.targetPeriod === "week") return t;
  if (item.targetPeriod === "day") return t * dueThisWeek;
  return null;
}

/** Plain number text for the totals row: "719094", "12.5", "—". */
export function totalText(n: number | null): string {
  if (n == null) return "—";
  return trimNumber(Math.round(n * 100) / 100);
}

/** "Daily", "Weekly", "Monthly", "Mon · Wed" … as the sheet's Frequency column. */
export function frequencyLabel(item: Pick<BoardItem, "frequency" | "scheduleKind">): string {
  if (item.frequency?.trim()) return item.frequency.trim();
  return { scheduled: "Daily", weekly: "Weekly", monthly: "Monthly", adhoc: "Ad-hoc", event: "When it happens" }[item.scheduleKind] ?? item.scheduleKind;
}

/**
 * done / due across an inclusive date range — the dashboard's "This week"
 * (Monday → today) and "This month" (1st → today). Same per-day arithmetic as
 * the board (`dayStats`), so the three columns can never disagree with it.
 */
export function rangeStats(items: BoardItem[], slots: Map<string, SlotValue>, from: string, to: string): { due: number; done: number; filled: number; pct: number } {
  let due = 0;
  let done = 0;
  let filled = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = dayStats(items, slots, d);
    due += s.due;
    done += s.done;
    filled += s.filled;
  }
  return { due, done, filled, pct: pctOf(done, due) };
}

/** Today, in the grid's own date form (re-exported so the grid imports one module). */
export const todayGrid = (): string => isoDate(new Date());
