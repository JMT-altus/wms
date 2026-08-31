import { describe, expect, it } from "vitest";
import {
  annualKey,
  annualPeriod,
  childKind,
  childPeriods,
  deadlineFor,
  fyBounds,
  fyLabel,
  fyStartYearForDate,
  growthSplit,
  hygieneScore,
  isLocked,
  isValidKey,
  kindOfKey,
  monthPeriods,
  parentKeyOf,
  parentKind,
  periodsOfKind,
  quarterPeriods,
  splitPaise,
  valueFromQtyRate,
  weekPeriods,
} from "@/lib/targets/period";

const CADENCE = { monthlyDay: 27, weeklyDow: 5, lockDays: 3 };

describe("financial year", () => {
  it("labels the April-to-March year", () => {
    expect(fyLabel(2026)).toBe("FY 26-27");
    expect(fyLabel(2099)).toBe("FY 99-00");
    expect(annualKey(2026)).toBe("FY2026");
  });

  it("puts Jan–Mar in the previous financial year", () => {
    expect(fyStartYearForDate("2026-04-01")).toBe(2026);
    expect(fyStartYearForDate("2026-12-31")).toBe(2026);
    expect(fyStartYearForDate("2027-03-31")).toBe(2026);
    expect(fyStartYearForDate("2027-04-01")).toBe(2027);
  });

  it("bounds the year Apr 1 → Mar 31", () => {
    expect(fyBounds(2026)).toEqual({ startDate: "2026-04-01", endDate: "2027-03-31" });
  });
});

describe("period enumeration", () => {
  it("gives four quarters, Q1 starting in April and Q4 ending in March", () => {
    const qs = quarterPeriods(2026);
    expect(qs).toHaveLength(4);
    expect(qs[0]).toMatchObject({ key: "2026-Q1", startDate: "2026-04-01", endDate: "2026-06-30" });
    expect(qs[3]).toMatchObject({ key: "2026-Q4", startDate: "2027-01-01", endDate: "2027-03-31" });
    expect(qs[0]!.label).toBe("Q1 Apr–Jun");
    expect(qs[3]!.label).toBe("Q4 Jan–Mar");
  });

  it("gives twelve months rolling across the calendar-year boundary", () => {
    const ms = monthPeriods(2026);
    expect(ms).toHaveLength(12);
    expect(ms[0]!.key).toBe("2026-04");
    expect(ms[8]!.key).toBe("2026-12");
    expect(ms[9]!.key).toBe("2027-01");
    expect(ms[11]).toMatchObject({ key: "2027-03", endDate: "2027-03-31" });
  });

  it("handles February in a leap financial year", () => {
    // FY 2027-28 contains Feb 2028, a leap February.
    const feb = monthPeriods(2027).find((m) => m.key === "2028-02");
    expect(feb?.endDate).toBe("2028-02-29");
  });

  it("gives Monday-start weeks that stay inside the year", () => {
    const ws = weekPeriods(2026);
    expect(ws.length).toBeGreaterThanOrEqual(52);
    expect(ws.length).toBeLessThanOrEqual(53);
    for (const w of ws) {
      expect(new Date(`${w.startDate}T00:00:00Z`).getUTCDay()).toBe(1); // Monday
      expect(w.startDate >= "2026-04-01").toBe(true);
      expect(w.startDate <= "2027-03-31").toBe(true);
    }
  });

  it("never lists the same week in two consecutive years", () => {
    const a = new Set(weekPeriods(2026).map((w) => w.key));
    const b = weekPeriods(2027).map((w) => w.key);
    expect(b.some((k) => a.has(k))).toBe(false);
  });

  it("routes periodsOfKind to the right enumerator", () => {
    expect(periodsOfKind(2026, "annual")).toEqual([annualPeriod(2026)]);
    expect(periodsOfKind(2026, "quarter")).toHaveLength(4);
    expect(periodsOfKind(2026, "month")).toHaveLength(12);
  });
});

describe("key parsing", () => {
  it("recognises each kind", () => {
    expect(kindOfKey("FY2026")).toBe("annual");
    expect(kindOfKey("2026-Q3")).toBe("quarter");
    expect(kindOfKey("2026-04")).toBe("month");
    expect(kindOfKey("2026-04-06")).toBe("week");
  });

  it("rejects malformed keys rather than guessing", () => {
    expect(kindOfKey("2026-Q5")).toBeNull();
    expect(kindOfKey("FY26")).toBeNull();
    expect(kindOfKey("nonsense")).toBeNull();
    expect(isValidKey("month", "2026-Q1")).toBe(false);
    expect(isValidKey("month", "2026-04")).toBe(true);
  });

  it("sorts lexicographically within a kind", () => {
    const keys = monthPeriods(2026).map((m) => m.key);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("cascade", () => {
  it("walks the levels in both directions", () => {
    expect(childKind("annual")).toBe("quarter");
    expect(childKind("quarter")).toBe("month");
    expect(childKind("month")).toBe("week");
    expect(childKind("week")).toBeNull();
    expect(parentKind("week")).toBe("month");
    expect(parentKind("annual")).toBeNull();
  });

  it("gives a year four quarters and a quarter three months", () => {
    expect(childPeriods(2026, annualPeriod(2026))).toHaveLength(4);
    const q1 = quarterPeriods(2026)[0]!;
    expect(childPeriods(2026, q1).map((m) => m.key)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("gives a month 4 or 5 weeks — the real calendar, not a fixed 4", () => {
    for (const m of monthPeriods(2026)) {
      const weeks = childPeriods(2026, m);
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(5);
    }
    // Every week of the year belongs to exactly one month.
    const assigned = monthPeriods(2026).flatMap((m) => childPeriods(2026, m).map((w) => w.key));
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.length).toBe(weekPeriods(2026).length);
  });

  it("finds the parent of a child", () => {
    const apr = monthPeriods(2026)[0]!;
    expect(parentKeyOf(2026, apr)).toBe("2026-Q1");
    const jan = monthPeriods(2026).find((m) => m.key === "2027-01")!;
    expect(parentKeyOf(2026, jan)).toBe("2026-Q4");
    expect(parentKeyOf(2026, annualPeriod(2026))).toBeNull();
  });
});

describe("splitPaise", () => {
  it("splits evenly when it divides cleanly", () => {
    expect(splitPaise(1000, 4)).toEqual([250, 250, 250, 250]);
  });

  it("never loses a paisa to rounding", () => {
    for (const [total, n] of [[100, 3], [1, 4], [999_999, 7], [12_345_678, 13]] as const) {
      const parts = splitPaise(total, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("spreads the remainder across the leading parts", () => {
    expect(splitPaise(100, 3)).toEqual([34, 33, 33]);
  });

  it("handles negatives symmetrically and zero parts", () => {
    expect(splitPaise(-100, 3).reduce((a, b) => a + b, 0)).toBe(-100);
    expect(splitPaise(1000, 0)).toEqual([]);
  });
});

describe("valueFromQtyRate", () => {
  it("multiplies quantity by rate, rounded to whole paise", () => {
    expect(valueFromQtyRate(120, 125_000)).toBe(15_000_000);
    expect(valueFromQtyRate(2.5, 101)).toBe(253); // 252.5 → 253
  });

  it("returns null when either side is missing, rather than treating it as 0", () => {
    expect(valueFromQtyRate(null, 100)).toBeNull();
    expect(valueFromQtyRate(10, null)).toBeNull();
    expect(valueFromQtyRate(undefined, undefined)).toBeNull();
    expect(valueFromQtyRate(Number.NaN, 100)).toBeNull();
  });
});

describe("growthSplit", () => {
  it("splits the GROWTH, not the whole target", () => {
    // ₹12 Cr target on ₹9.2 Cr last year → ₹2.8 Cr of growth, 30/70.
    const s = growthSplit(120_000_000_00, 92_000_000_00, 30);
    expect(s.existingPaise + s.newPaise).toBe(120_000_000_00);
    expect(s.newPaise).toBe(Math.round(28_000_000_00 * 0.7));
    expect(s.existingPaise).toBe(92_000_000_00 + Math.round(28_000_000_00 * 0.3));
    expect(s.newPct).toBe(70);
  });

  it("treats the whole target as growth when there is no prior year", () => {
    const s = growthSplit(1_000_000, 0, 30);
    expect(s.existingPaise).toBe(300_000);
    expect(s.newPaise).toBe(700_000);
  });

  it("asks for no new business when the target is below last year", () => {
    const s = growthSplit(500_000, 900_000, 30);
    expect(s.newPaise).toBe(0);
    expect(s.existingPaise).toBe(500_000);
  });

  it("always sums back to the target and clamps the percentage", () => {
    for (const pct of [-10, 0, 33.3, 100, 150]) {
      const s = growthSplit(7_777_777, 1_111_111, pct);
      expect(s.existingPaise + s.newPaise).toBe(7_777_777);
      expect(s.existingPct).toBeGreaterThanOrEqual(0);
      expect(s.existingPct).toBeLessThanOrEqual(100);
    }
  });
});

describe("deadlines and locking", () => {
  it("puts the monthly deadline on the configured day of the closing month", () => {
    const apr = monthPeriods(2026)[0]!;
    expect(deadlineFor(apr, CADENCE)).toBe("2026-04-27");
    const q1 = quarterPeriods(2026)[0]!;
    expect(deadlineFor(q1, CADENCE)).toBe("2026-06-27");
  });

  it("clamps a monthly day that overflows a short month", () => {
    const feb = monthPeriods(2026).find((m) => m.key === "2027-02")!;
    expect(deadlineFor(feb, { monthlyDay: 31, weeklyDow: 5 })).toBe("2027-02-28");
  });

  it("puts the weekly deadline on the configured weekday of that week", () => {
    const week = weekPeriods(2026)[0]!; // a Monday
    expect(deadlineFor(week, CADENCE)).toBe(
      new Date(new Date(`${week.startDate}T00:00:00Z`).getTime() + 4 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  });

  it("locks only after the grace days have passed", () => {
    const apr = monthPeriods(2026)[0]!; // deadline 2026-04-27, +3 days grace
    expect(isLocked(apr, CADENCE, "2026-04-27")).toBe(false);
    expect(isLocked(apr, CADENCE, "2026-04-30")).toBe(false);
    expect(isLocked(apr, CADENCE, "2026-05-01")).toBe(true);
  });
});

describe("hygieneScore", () => {
  it("is 100 for a complete, fully-noted, on-time period", () => {
    expect(
      hygieneScore({ totalRows: 10, estimatedRows: 10, estimatedWithoutNotes: 0, onTime: true }).score,
    ).toBe(100);
  });

  it("penalises missing notes as heavily as missing estimates", () => {
    const noNotes = hygieneScore({ totalRows: 10, estimatedRows: 10, estimatedWithoutNotes: 10, onTime: true });
    const halfDone = hygieneScore({ totalRows: 10, estimatedRows: 5, estimatedWithoutNotes: 0, onTime: true });
    expect(noNotes.score).toBe(50);
    expect(halfDone.score).toBe(75);
  });

  it("docks 10 points for missing the deadline", () => {
    const a = hygieneScore({ totalRows: 10, estimatedRows: 10, estimatedWithoutNotes: 0, onTime: false });
    expect(a.score).toBe(90);
  });

  it("never goes below zero or above 100", () => {
    const worst = hygieneScore({ totalRows: 10, estimatedRows: 0, estimatedWithoutNotes: 0, onTime: false });
    expect(worst.score).toBe(0);
  });

  it("reports zero for a period with no rows rather than dividing by zero", () => {
    const s = hygieneScore({ totalRows: 0, estimatedRows: 0, estimatedWithoutNotes: 0, onTime: true });
    expect(s.score).toBe(0);
    expect(Number.isNaN(s.notedPct)).toBe(false);
  });

  it("clamps inputs that claim more estimates than rows", () => {
    const s = hygieneScore({ totalRows: 5, estimatedRows: 99, estimatedWithoutNotes: 99, onTime: true });
    expect(s.coveragePct).toBe(100);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});
