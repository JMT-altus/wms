/**
 * DCC board model — the pure derivations behind the board, dashboard and
 * ranking.
 *
 * Client-safe (no server-only, no db, no React) and free of I/O, so the same
 * functions run in the browser for optimistic updates and on the server for
 * the roster screens. Everything here routes due-ness through
 * `scheduledDueOn`, never `isDueOn`.
 */

import { addDays, isFilled, scheduledDueOn, slotKey, pctOf } from "@/lib/dcc/util";

/** A KPI definition, reduced to what the board needs. */
export interface BoardItem {
  id: string;
  section: string | null;
  code: string | null;
  title: string;
  frequency: string | null;
  weekdays: number | null;
  scheduleKind: string;
  isParticipantList: boolean;
  clientId: string | null;
  needsReview: boolean;
  targetNumber: string | null;
  unit: string | null;
  sortOrder: number | null;
}

/** One stored fill. */
export interface BoardEntry {
  itemId: string;
  entryDate: string;
  status: string | null;
  valueNumber: string | null;
  note: string | null;
  subjectId: string | null;
}

export interface BoardClient {
  id: string;
  section: string;
  name: string;
  sortOrder: number;
}

export interface BoardSubject {
  id: string;
  name: string;
  kind: string | null;
  sortOrder: number;
}

export interface BoardItemSubject {
  itemId: string;
  subjectId: string;
  sortOrder: number;
}

/** The optimistic value the board keeps per slot. */
export interface SlotValue {
  status: string | null;
  valueNumber: string | null;
  note: string | null;
}

/** Index every entry by its slot key so lookups are O(1) during render. */
export function indexEntries(entries: BoardEntry[]): Map<string, SlotValue> {
  const map = new Map<string, SlotValue>();
  for (const e of entries) {
    map.set(slotKey(e.itemId, e.subjectId, e.entryDate), {
      status: e.status,
      valueNumber: e.valueNumber,
      note: e.note,
    });
  }
  return map;
}

export interface DayStats {
  due: number;
  done: number;
  filled: number;
  pct: number;
  filledPct: number;
}

/**
 * The day's numbers, over the DUE set only.
 *
 * `done` counts status === "Done". `filled` counts any answer at all — which
 * is what the streak and the gate care about, because "Not done" honestly
 * recorded is compliance, not a miss.
 */
export function dayStats(
  items: BoardItem[],
  slots: Map<string, SlotValue>,
  date: string,
): DayStats {
  let due = 0;
  let done = 0;
  let filled = 0;
  for (const item of items) {
    if (!scheduledDueOn(item, date)) continue;
    due++;
    const v = slots.get(slotKey(item.id, null, date));
    if (v?.status === "Done") done++;
    if (isFilled(v)) filled++;
  }
  return {
    due,
    done,
    filled,
    pct: pctOf(done, due),
    filledPct: pctOf(filled, due),
  };
}

/**
 * Consecutive days, ending today, on which every due item was FILLED.
 *
 * Days with nothing due (Sundays, or a person whose KPIs are all Wed & Sat)
 * are skipped rather than counted or treated as a break — otherwise every
 * streak in the company would reset each weekend.
 *
 * Walks back at most `maxDays` so a long-tenured employee's streak is bounded
 * work, not a scan of their whole history.
 */
export function computeStreak(
  items: BoardItem[],
  slots: Map<string, SlotValue>,
  today: string,
  maxDays = 60,
): number {
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    const date = addDays(today, -i);
    const due = items.filter((it) => scheduledDueOn(it, date));
    if (due.length === 0) continue; // nothing owed — neither credit nor break
    const allFilled = due.every((it) => isFilled(slots.get(slotKey(it.id, null, date))));
    if (!allFilled) break;
    streak++;
  }
  return streak;
}

/** One row of the 21-day trend strip. */
export interface TrendDay {
  date: string;
  due: number;
  done: number;
  pct: number;
  /** True when nothing was due — the bar renders grey, not red. */
  idle: boolean;
}

export function trendDays(
  items: BoardItem[],
  slots: Map<string, SlotValue>,
  today: string,
  days = 21,
): TrendDay[] {
  const out: TrendDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const s = dayStats(items, slots, date);
    out.push({
      date,
      due: s.due,
      done: s.done,
      pct: s.due === 0 ? 0 : s.pct,
      idle: s.due === 0,
    });
  }
  return out;
}

/** A section+client card on the board. */
export interface BoardGroup {
  key: string;
  section: string;
  clientName: string | null;
  items: BoardItem[];
}

/**
 * Group the day's fill items by (section, client), preserving the order the
 * items already carry. A null section becomes "Checklist" so an item created
 * without one still lands somewhere visible instead of vanishing.
 */
export function groupItems(items: BoardItem[], clients: BoardClient[]): BoardGroup[] {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const groups = new Map<string, BoardGroup>();
  for (const item of items) {
    const client = item.clientId ? clientById.get(item.clientId) : undefined;
    const section = item.section?.trim() || "Checklist";
    const key = `${section}::${client?.id ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, section, clientName: client?.name ?? null, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

export interface BoardTrays {
  weekly: BoardItem[];
  monthly: BoardItem[];
  whenItHappens: BoardItem[];
}

/**
 * The three collapsible trays. These items are real work, but they are never
 * part of the daily due-set, so they can never inflate the count, break a
 * streak or hold a gate shut.
 */
export function buildTrays(items: BoardItem[]): BoardTrays {
  const weekly: BoardItem[] = [];
  const monthly: BoardItem[] = [];
  const whenItHappens: BoardItem[] = [];
  for (const item of items) {
    if (item.isParticipantList) continue; // has its own card
    switch (item.scheduleKind) {
      case "weekly":
        weekly.push(item);
        break;
      case "monthly":
        monthly.push(item);
        break;
      case "adhoc":
      case "event":
        whenItHappens.push(item);
        break;
      default:
        break; // 'scheduled' belongs to the daily surface
    }
  }
  return { weekly, monthly, whenItHappens };
}

/**
 * Which items the daily fill surface shows.
 *
 * Due today, plus anything already answered today (so an answer recorded on a
 * day the item wasn't due doesn't disappear the moment you reload), unless
 * "Show all" is on.
 */
export function visibleDailyItems(
  items: BoardItem[],
  slots: Map<string, SlotValue>,
  date: string,
  showAll: boolean,
): BoardItem[] {
  return items.filter((item) => {
    if (item.isParticipantList) return false;
    if (showAll) return item.scheduleKind === "scheduled";
    if (scheduledDueOn(item, date)) return true;
    return isFilled(slots.get(slotKey(item.id, null, date)));
  });
}

/** Participant-list KPIs that are due on a date (their own mask still applies). */
export function participantItemsDue(items: BoardItem[], date: string): BoardItem[] {
  return items.filter((item) => {
    if (!item.isParticipantList) return false;
    // Participant KPIs sit outside the due-set but still respect their own
    // weekday mask for display, so a "Wed & Sat" roster isn't shown on Monday.
    return scheduledDueOn({ ...item, isParticipantList: false }, date);
  });
}

export interface ParticipantStats {
  total: number;
  done: number;
  addressed: number;
}

/** Done / addressed counts for one participant KPI on one date. */
export function participantStats(
  itemId: string,
  subjectIds: string[],
  slots: Map<string, SlotValue>,
  date: string,
): ParticipantStats {
  let done = 0;
  let addressed = 0;
  for (const sid of subjectIds) {
    const v = slots.get(slotKey(itemId, sid, date));
    if (v?.status === "Done") done++;
    if (isFilled(v)) addressed++;
  }
  return { total: subjectIds.length, done, addressed };
}

/**
 * Suggest the next code for a section: take the letter prefix its items
 * already use and increment the highest number ("A6" → "A7").
 *
 * Returns "" when the section has no coded items yet — the dialog then leaves
 * the field alone rather than inventing an "A1" for a section that numbers
 * its items differently.
 */
export function suggestCode(items: BoardItem[], section: string): string {
  const wanted = section.trim().toLowerCase();
  let prefix = "";
  let max = 0;
  for (const item of items) {
    if ((item.section?.trim().toLowerCase() ?? "") !== wanted) continue;
    const m = /^([A-Za-z]+)\s*(\d+)$/.exec(item.code?.trim() ?? "");
    if (!m) continue;
    prefix = m[1]!.toUpperCase();
    const n = Number(m[2]);
    if (n > max) max = n;
  }
  return prefix ? `${prefix}${max + 1}` : "";
}

/** Per-person roster summary for the dashboard and the ranking. */
export interface PersonDay {
  ownerId: string;
  itemCount: number;
  due: number;
  done: number;
  filled: number;
  pct: number;
  streak: number;
}

export function summarisePerson(
  ownerId: string,
  items: BoardItem[],
  slots: Map<string, SlotValue>,
  date: string,
): PersonDay {
  const s = dayStats(items, slots, date);
  return {
    ownerId,
    itemCount: items.length,
    due: s.due,
    done: s.done,
    filled: s.filled,
    pct: s.pct,
    streak: computeStreak(items, slots, date),
  };
}

/**
 * Ranking score: mostly the window's done-rate, with a fifth of the weight on
 * consistency so someone at 100 % for three days doesn't outrank a month of
 * 90 %. Streak saturates at 30 days.
 */
export function rankScore(pct: number, streak: number): number {
  return Math.round(0.8 * pct + 0.2 * ((Math.min(streak, 30) / 30) * 100));
}

/** done/due across a whole window, used by the 7-day and 30-day leaderboards. */
export function windowStats(
  items: BoardItem[],
  slots: Map<string, SlotValue>,
  endDate: string,
  days: number,
): { due: number; done: number; filled: number; pct: number } {
  let due = 0;
  let done = 0;
  let filled = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(endDate, -i);
    const s = dayStats(items, slots, date);
    due += s.due;
    done += s.done;
    filled += s.filled;
  }
  return { due, done, filled, pct: pctOf(done, due) };
}
