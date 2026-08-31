import { describe, it, expect } from "vitest";
import {
  indexEntries,
  dayStats,
  computeStreak,
  trendDays,
  groupItems,
  buildTrays,
  visibleDailyItems,
  participantItemsDue,
  participantStats,
  suggestCode,
  rankScore,
  windowStats,
  type BoardItem,
  type BoardEntry,
} from "@/lib/dcc/board-model";
import { MASK_MON_SAT } from "@/lib/dcc/util";

const WED = 1 << 2;
const SAT = 1 << 5;

function item(over: Partial<BoardItem> & { id: string }): BoardItem {
  return {
    section: "A",
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
    sortOrder: 0,
    ...over,
  };
}

function entry(over: Partial<BoardEntry> & { itemId: string; entryDate: string }): BoardEntry {
  return { status: null, valueNumber: null, note: null, subjectId: null, ...over };
}

// 2026-07-15 is a Wednesday; 2026-07-13 a Monday; 2026-07-19 a Sunday.
const WEDNESDAY = "2026-07-15";

describe("dayStats", () => {
  it("counts only scheduled non-participant items due that day", () => {
    const items = [
      item({ id: "daily" }),
      item({ id: "wed-sat", weekdays: WED | SAT }),
      item({ id: "sat-only", weekdays: SAT }),
      item({ id: "weekly", scheduleKind: "weekly", weekdays: null }),
      item({ id: "monthly", scheduleKind: "monthly", weekdays: 0 }),
      item({ id: "adhoc", scheduleKind: "adhoc", weekdays: null }),
      item({ id: "event", scheduleKind: "event", weekdays: null }),
      item({ id: "roster", isParticipantList: true, weekdays: null }),
    ];
    const stats = dayStats(items, indexEntries([]), WEDNESDAY);
    // daily + wed-sat only. Everything else is out of the due-set.
    expect(stats.due).toBe(2);
  });

  it("separates done from filled", () => {
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    const slots = indexEntries([
      entry({ itemId: "a", entryDate: WEDNESDAY, status: "Done" }),
      entry({ itemId: "b", entryDate: WEDNESDAY, status: "Not done" }),
      entry({ itemId: "c", entryDate: WEDNESDAY, note: "  " }), // whitespace ≠ filled
    ]);
    const s = dayStats(items, slots, WEDNESDAY);
    expect(s).toMatchObject({ due: 3, done: 1, filled: 2 });
    expect(s.pct).toBe(33);
    expect(s.filledPct).toBe(67);
  });

  it("reports 100% when nothing is due", () => {
    const s = dayStats([item({ id: "sat", weekdays: SAT })], indexEntries([]), WEDNESDAY);
    expect(s).toMatchObject({ due: 0, done: 0, pct: 100 });
  });

  it("ignores participant sub-rows when scoring the item's own slot", () => {
    const items = [item({ id: "a" })];
    const slots = indexEntries([
      entry({ itemId: "a", entryDate: WEDNESDAY, status: "Done", subjectId: "s1" }),
    ]);
    // The Done belongs to a participant slot, not the item's own row.
    expect(dayStats(items, slots, WEDNESDAY)).toMatchObject({ due: 1, done: 0, filled: 0 });
  });
});

describe("computeStreak", () => {
  const daily = [item({ id: "a" })];

  it("counts consecutive fully-filled days ending today", () => {
    const slots = indexEntries([
      entry({ itemId: "a", entryDate: "2026-07-15", status: "Done" }),
      entry({ itemId: "a", entryDate: "2026-07-14", status: "Not done" }),
      entry({ itemId: "a", entryDate: "2026-07-13", status: "Done" }),
    ]);
    // Filled, not Done — an honest "Not done" keeps the streak alive.
    expect(computeStreak(daily, slots, "2026-07-15")).toBe(3);
  });

  it("breaks on the first unfilled day", () => {
    const slots = indexEntries([
      entry({ itemId: "a", entryDate: "2026-07-15", status: "Done" }),
      // 07-14 missing
      entry({ itemId: "a", entryDate: "2026-07-13", status: "Done" }),
    ]);
    expect(computeStreak(daily, slots, "2026-07-15")).toBe(1);
  });

  it("skips days with nothing due instead of breaking", () => {
    // Wed & Sat only. Walking back from Sat 18th: Sat(due) Fri Thu (none due)
    // Wed(due) — the streak must survive the gap.
    const wedSat = [item({ id: "a", weekdays: WED | SAT })];
    const slots = indexEntries([
      entry({ itemId: "a", entryDate: "2026-07-18", status: "Done" }),
      entry({ itemId: "a", entryDate: "2026-07-15", status: "Done" }),
    ]);
    expect(computeStreak(wedSat, slots, "2026-07-18")).toBe(2);
  });

  it("is zero when today is due and unfilled", () => {
    expect(computeStreak(daily, indexEntries([]), "2026-07-15")).toBe(0);
  });

  it("bounds the walk at maxDays DAYS, not maxDays streak-points", () => {
    // Every day filled for a long time. maxDays caps how far back we look, so
    // a Sunday inside the window is walked and skipped: it costs an iteration
    // but earns no streak point. Walking 10 days back from Wed 2026-07-15
    // crosses Sun 2026-07-12, hence 9 — the cap is bounded work, not a
    // guaranteed count.
    const slots = new Map();
    for (let i = 0; i < 90; i++) {
      const d = new Date(2026, 6, 15);
      d.setDate(d.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      slots.set(`a||${iso}`, { status: "Done", valueNumber: null, note: null });
    }
    expect(computeStreak(daily, slots, "2026-07-15", 10)).toBe(9);
    expect(computeStreak(daily, slots, "2026-07-15", 10)).toBeLessThanOrEqual(10);
  });
});

describe("trendDays", () => {
  it("returns N days ending today, oldest first, flagging idle days", () => {
    const items = [item({ id: "a", weekdays: WED })];
    const days = trendDays(items, indexEntries([]), "2026-07-15", 3);
    expect(days.map((d) => d.date)).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
    expect(days.map((d) => d.idle)).toEqual([true, true, false]);
  });
});

describe("groupItems", () => {
  it("groups by section and client, and names an unsectioned item", () => {
    const clients = [{ id: "c1", section: "B", name: "Client X", sortOrder: 0 }];
    const groups = groupItems(
      [
        item({ id: "1", section: "A" }),
        item({ id: "2", section: "A" }),
        item({ id: "3", section: "B", clientId: "c1" }),
        item({ id: "4", section: null }),
      ],
      clients,
    );
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ section: "A", clientName: null });
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]).toMatchObject({ section: "B", clientName: "Client X" });
    expect(groups[2]).toMatchObject({ section: "Checklist" });
  });

  it("keeps the same section as separate cards per client", () => {
    const clients = [
      { id: "x", section: "B", name: "X", sortOrder: 0 },
      { id: "y", section: "B", name: "Y", sortOrder: 1 },
    ];
    const groups = groupItems(
      [item({ id: "1", section: "B", clientId: "x" }), item({ id: "2", section: "B", clientId: "y" })],
      clients,
    );
    expect(groups.map((g) => g.clientName)).toEqual(["X", "Y"]);
  });
});

describe("buildTrays", () => {
  it("routes each kind to its tray and excludes scheduled + participant items", () => {
    const trays = buildTrays([
      item({ id: "s", scheduleKind: "scheduled" }),
      item({ id: "w", scheduleKind: "weekly" }),
      item({ id: "m", scheduleKind: "monthly" }),
      item({ id: "a", scheduleKind: "adhoc" }),
      item({ id: "e", scheduleKind: "event" }),
      item({ id: "p", scheduleKind: "weekly", isParticipantList: true }),
    ]);
    expect(trays.weekly.map((i) => i.id)).toEqual(["w"]);
    expect(trays.monthly.map((i) => i.id)).toEqual(["m"]);
    expect(trays.whenItHappens.map((i) => i.id)).toEqual(["a", "e"]);
  });
});

describe("visibleDailyItems", () => {
  const items = [
    item({ id: "due", weekdays: WED }),
    item({ id: "notdue", weekdays: SAT }),
    item({ id: "answered", weekdays: SAT }),
    item({ id: "weekly", scheduleKind: "weekly" }),
    item({ id: "roster", isParticipantList: true }),
  ];
  const slots = indexEntries([
    entry({ itemId: "answered", entryDate: WEDNESDAY, status: "Done" }),
  ]);

  it("shows due items plus anything already answered today", () => {
    const ids = visibleDailyItems(items, slots, WEDNESDAY, false).map((i) => i.id);
    expect(ids).toEqual(["due", "answered"]);
  });

  it("show-all reveals every scheduled item but still no trays or rosters", () => {
    const ids = visibleDailyItems(items, slots, WEDNESDAY, true).map((i) => i.id);
    expect(ids).toEqual(["due", "notdue", "answered"]);
  });
});

describe("participant KPIs", () => {
  it("shows a roster only on its own weekdays", () => {
    const items = [
      item({ id: "r1", isParticipantList: true, weekdays: WED }),
      item({ id: "r2", isParticipantList: true, weekdays: SAT }),
      item({ id: "plain" }),
    ];
    expect(participantItemsDue(items, WEDNESDAY).map((i) => i.id)).toEqual(["r1"]);
  });

  it("counts done and addressed across the roster", () => {
    const slots = indexEntries([
      entry({ itemId: "r", entryDate: WEDNESDAY, subjectId: "a", status: "Done" }),
      entry({ itemId: "r", entryDate: WEDNESDAY, subjectId: "b", status: "NA" }),
    ]);
    expect(participantStats("r", ["a", "b", "c"], slots, WEDNESDAY)).toEqual({
      total: 3,
      done: 1,
      addressed: 2,
    });
  });
});

describe("suggestCode", () => {
  it("increments the highest number using the section's own prefix", () => {
    const items = [
      item({ id: "1", section: "A", code: "A5" }),
      item({ id: "2", section: "A", code: "A6" }),
      item({ id: "3", section: "B", code: "B2" }),
    ];
    expect(suggestCode(items, "A")).toBe("A7");
    expect(suggestCode(items, "B")).toBe("B3");
  });

  it("is case-insensitive on the section name", () => {
    expect(suggestCode([item({ id: "1", section: "Weekly KPI", code: "W1" })], "weekly kpi")).toBe("W2");
  });

  it("returns empty when the section has no coded items to learn from", () => {
    expect(suggestCode([item({ id: "1", section: "A", code: null })], "A")).toBe("");
    expect(suggestCode([], "A")).toBe("");
  });
});

describe("rankScore", () => {
  it("weights compliance 80 / consistency 20 and saturates the streak at 30", () => {
    expect(rankScore(100, 30)).toBe(100);
    expect(rankScore(100, 60)).toBe(100); // saturated, not more than 100
    expect(rankScore(100, 0)).toBe(80);
    expect(rankScore(0, 30)).toBe(20);
    expect(rankScore(90, 15)).toBe(82); // 72 + 10
  });
});

describe("windowStats", () => {
  it("sums due and done across the window", () => {
    const items = [item({ id: "a" })]; // daily Mon–Sat
    const slots = indexEntries([
      entry({ itemId: "a", entryDate: "2026-07-15", status: "Done" }),
      entry({ itemId: "a", entryDate: "2026-07-14", status: "Done" }),
      entry({ itemId: "a", entryDate: "2026-07-13", status: "Not done" }),
    ]);
    const w = windowStats(items, slots, "2026-07-15", 3);
    expect(w).toMatchObject({ due: 3, done: 2, filled: 3 });
    expect(w.pct).toBe(67);
  });

  it("skips Sundays because a Mon–Sat mask owes nothing then", () => {
    const items = [item({ id: "a" })];
    // 2026-07-19 is a Sunday; a 1-day window there is due 0.
    expect(windowStats(items, indexEntries([]), "2026-07-19", 1).due).toBe(0);
  });
});
