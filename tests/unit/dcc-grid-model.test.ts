import { describe, it, expect } from "vitest";
import { indexEntries, type BoardEntry, type BoardItem } from "@/lib/dcc/board-model";
import { MASK_MON_SAT } from "@/lib/dcc/util";
import {
  cellKind,
  cellText,
  dayLabel,
  dayName,
  dueDays,
  frequencyLabel,
  gridWeeks,
  monthDates,
  parseCell,
  periodValue,
  rangeStats,
  totalText,
  weekLabel,
  weekStart,
  weekTarget,
  weekTotals,
} from "@/lib/dcc/grid-model";

// The arithmetic behind the checklist sheet: week columns, what a cell stores
// and shows for each answer type, and the Weekly Actual / Deficit totals.

const TUE = 1 << 1;
const SAT = 1 << 5;

function item(over: Partial<BoardItem> & { id: string }): BoardItem {
  return {
    section: null,
    code: null,
    title: "KPI",
    frequency: "Daily",
    weekdays: MASK_MON_SAT,
    scheduleKind: "scheduled",
    isParticipantList: false,
    clientId: null,
    needsReview: false,
    targetNumber: null,
    unit: null,
    inputType: "number",
    targetPeriod: "day",
    sortOrder: 0,
    ...over,
  };
}
const entry = (itemId: string, entryDate: string, over: Partial<BoardEntry> = {}): BoardEntry => ({
  itemId,
  entryDate,
  status: null,
  valueNumber: null,
  note: null,
  subjectId: null,
  ...over,
});
const num = (itemId: string, date: string, n: number) => entry(itemId, date, { status: "Done", valueNumber: String(n) });

// 2026-11-02 is a Monday (ISO week 45); 2026-11-05 a Thursday.
const MON = "2026-11-02";
const WEEK = gridWeeks("2026-11-05", 1)[0]!;

describe("week columns", () => {
  it("a week runs Monday to Saturday and is headed by its ISO week number", () => {
    expect(weekStart("2026-11-05")).toBe(MON);
    expect(weekStart("2026-11-08")).toBe(MON); // Sunday still belongs to the week that started on the 2nd
    expect(WEEK.days).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(WEEK.label).toBe("Week No. 45");
    expect(weekLabel("2026-01-05")).toBe("Week No. 2");
    expect(WEEK.month).toBe("2026-11");
  });

  it("several weeks end with the week asked for, oldest first", () => {
    const weeks = gridWeeks("2026-11-05", 4);
    expect(weeks.map((w) => w.monday)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", MON]);
    expect(weeks.map((w) => w.label)).toEqual(["Week No. 42", "Week No. 43", "Week No. 44", "Week No. 45"]);
  });

  it("day headings read as the sheet's", () => {
    expect(WEEK.days.map(dayName)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(dayLabel("2026-11-05")).toBe("05/11/26");
    expect(monthDates("2026-02")).toHaveLength(28);
    expect(monthDates("2028-02")).toHaveLength(29);
  });
});

describe("where a parameter is answered", () => {
  it("daily on its due days, weekly and monthly once, ad-hoc / event / participant lists nowhere on the sheet", () => {
    expect(cellKind(item({ id: "d" }))).toBe("daily");
    expect(cellKind(item({ id: "w", scheduleKind: "weekly" }))).toBe("weekly");
    expect(cellKind(item({ id: "m", scheduleKind: "monthly" }))).toBe("monthly");
    expect(cellKind(item({ id: "a", scheduleKind: "adhoc" }))).toBe("none");
    expect(cellKind(item({ id: "e", scheduleKind: "event" }))).toBe("none");
    expect(cellKind(item({ id: "p", isParticipantList: true }))).toBe("none");
  });

  it("a 'Sat / Tues' parameter is due on exactly those two days of the week", () => {
    expect(dueDays(item({ id: "x", weekdays: TUE | SAT }), WEEK)).toEqual(["2026-11-03", "2026-11-07"]);
    expect(dueDays(item({ id: "y" }), WEEK)).toHaveLength(6);
  });

  it("the frequency column shows the configured words, else the schedule kind", () => {
    expect(frequencyLabel(item({ id: "a", frequency: "Sat / Tues" }))).toBe("Sat / Tues");
    expect(frequencyLabel(item({ id: "b", frequency: null, scheduleKind: "weekly" }))).toBe("Weekly");
    expect(frequencyLabel(item({ id: "c", frequency: "  ", scheduleKind: "scheduled" }))).toBe("Daily");
  });
});

describe("what a cell stores and shows", () => {
  it("number: the figure, marked Done so the day counts; commas tolerated; junk refused", () => {
    expect(parseCell("number", " 1,53,671 ")).toEqual({ ok: true, value: { status: "Done", valueNumber: "153671", note: null } });
    expect(parseCell("number", "12.5")).toEqual({ ok: true, value: { status: "Done", valueNumber: "12.5", note: null } });
    expect(parseCell("number", "0")).toEqual({ ok: true, value: { status: "Done", valueNumber: "0", note: null } });
    expect(parseCell("number", "abc")).toEqual({ ok: false, error: "Enter a number" });
    expect(cellText("number", { status: "Done", valueNumber: "153671.00", note: null })).toBe("153671");
    expect(cellText("number", { status: "Done", valueNumber: "12.50", note: null })).toBe("12.5");
  });

  it("Yes / No: the status itself, never a number; Y/N/NA in any case; anything else refused", () => {
    expect(parseCell("yesno", "y")).toEqual({ ok: true, value: { status: "Done", valueNumber: null, note: null } });
    expect(parseCell("yesno", "No")).toEqual({ ok: true, value: { status: "Not done", valueNumber: null, note: null } });
    expect(parseCell("yesno", "n/a")).toEqual({ ok: true, value: { status: "NA", valueNumber: null, note: null } });
    expect(parseCell("yesno", "maybe")).toEqual({ ok: false, error: "Answer Y, N or NA" });
    expect(cellText("yesno", { status: "Done", valueNumber: null, note: null })).toBe("Y");
    expect(cellText("yesno", { status: "Not done", valueNumber: null, note: null })).toBe("N");
    expect(cellText("yesno", { status: "NA", valueNumber: null, note: null })).toBe("NA");
    expect(cellText("yesno", { status: "Pending", valueNumber: null, note: null })).toBe("");
  });

  it("text: kept verbatim as the note, marked Done; blank clears the cell", () => {
    expect(parseCell("text", "ROTO")).toEqual({ ok: true, value: { status: "Done", valueNumber: null, note: "ROTO" } });
    expect(cellText("text", { status: "Done", valueNumber: null, note: "ROTO" })).toBe("ROTO");
    expect(parseCell("text", "   ")).toEqual({ ok: true, value: null });
    expect(parseCell("number", "")).toEqual({ ok: true, value: null });
    expect(parseCell("text", "x".repeat(2001)).ok).toBe(false);
  });
});

describe("Weekly Actual and Weekly Deficit", () => {
  it("a number parameter: the sum of the week's figures, as the sheet's Actual column", () => {
    const so = item({ id: "so", title: "Total Value of SO Recd" });
    const slots = indexEntries([num("so", "2026-11-02", 153671), num("so", "2026-11-03", 218465), num("so", "2026-11-04", 51000), num("so", "2026-11-05", 198240), num("so", "2026-11-06", 97718)]);
    const t = weekTotals(so, slots, WEEK);
    expect(t).toEqual({ due: 6, filled: 5, actual: 719094, target: null, deficit: null });
    expect(totalText(t.actual)).toBe("719094");
    expect(totalText(t.deficit)).toBe("—");
  });

  it("a Yes / No parameter: how many days were Yes — a No or NA adds nothing", () => {
    const yn = item({ id: "yn", inputType: "yesno" });
    const slots = indexEntries([
      entry("yn", "2026-11-02", { status: "Done" }),
      entry("yn", "2026-11-03", { status: "Not done" }),
      entry("yn", "2026-11-04", { status: "NA" }),
      entry("yn", "2026-11-05", { status: "Done" }),
    ]);
    expect(weekTotals(yn, slots, WEEK)).toEqual({ due: 6, filled: 4, actual: 2, target: null, deficit: null });
  });

  it("a text parameter: how many days have an answer", () => {
    const tx = item({ id: "tx", inputType: "text" });
    const slots = indexEntries([entry("tx", "2026-11-02", { status: "Done", note: "ROTO" }), entry("tx", "2026-11-04", { status: "Done", note: "Fenesta" })]);
    expect(weekTotals(tx, slots, WEEK).actual).toBe(2);
  });

  it("nothing entered: no actual, so no deficit (never a misleading 0)", () => {
    expect(weekTotals(item({ id: "e", targetNumber: "10" }), indexEntries([]), WEEK)).toEqual({ due: 6, filled: 0, actual: null, target: 60, deficit: null });
  });

  it("a per-day target counts once for every due day that week; per-week once; monthly targets have no weekly deficit", () => {
    const daily = item({ id: "calls", targetNumber: "10", targetPeriod: "day" });
    const slots = indexEntries(WEEK.days.map((d) => num("calls", d, 8)));
    expect(weekTotals(daily, slots, WEEK)).toEqual({ due: 6, filled: 6, actual: 48, target: 60, deficit: 12 });

    const twoDays = item({ id: "two", weekdays: TUE | SAT, targetNumber: "10", targetPeriod: "day" });
    expect(weekTarget(twoDays, dueDays(twoDays, WEEK).length)).toBe(20);

    const weekly = item({ id: "wk", targetNumber: "100", targetPeriod: "week" });
    const wSlots = indexEntries([num("wk", "2026-11-02", 60), num("wk", "2026-11-03", 60)]);
    expect(weekTotals(weekly, wSlots, WEEK).deficit).toBe(-20); // over target: negative, shown green

    expect(weekTarget(item({ id: "m", targetNumber: "500", targetPeriod: "month" }), 6)).toBeNull();
    expect(weekTarget(item({ id: "n", targetNumber: null }), 6)).toBeNull();
  });

  it("a weekly parameter has one cell for the week and shows whichever day it was filled on", () => {
    const wk = item({ id: "wk", scheduleKind: "weekly", weekdays: null, inputType: "yesno" });
    const slots = indexEntries([entry("wk", "2026-11-04", { status: "Done" })]);
    expect(periodValue("wk", slots, WEEK.days)).toEqual({ date: "2026-11-04", value: { status: "Done", valueNumber: null, note: null } });
    expect(weekTotals(wk, slots, WEEK)).toEqual({ due: 1, filled: 1, actual: 1, target: null, deficit: null });
    expect(periodValue("wk", indexEntries([]), WEEK.days)).toBeNull();
  });

  it("a monthly parameter has no weekly totals at all", () => {
    const m = item({ id: "m", scheduleKind: "monthly", weekdays: 0 });
    expect(weekTotals(m, indexEntries([num("m", "2026-11-01", 5)]), WEEK)).toEqual({ due: 0, filled: 0, actual: null, target: null, deficit: null });
  });
});

describe("rangeStats (the dashboard's week- and month-to-date)", () => {
  it("counts due days over an inclusive range with the board's own per-day rule", () => {
    const d = item({ id: "d", inputType: "yesno" });
    const slots = indexEntries([entry("d", "2026-11-02", { status: "Done" }), entry("d", "2026-11-03", { status: "Not done" }), entry("d", "2026-11-04", { status: "Done" })]);
    // Mon–Thu: 4 due, 2 done, 3 filled.
    expect(rangeStats([d], slots, "2026-11-02", "2026-11-05")).toEqual({ due: 4, done: 2, filled: 3, pct: 50 });
    // Across a Sunday: the Sunday adds nothing due.
    expect(rangeStats([d], slots, "2026-11-07", "2026-11-09").due).toBe(2);
  });
});
