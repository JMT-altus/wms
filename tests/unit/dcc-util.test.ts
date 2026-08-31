import { describe, it, expect } from "vitest";
import {
  parseFrequency,
  parseFrequencyToMask,
  scheduledDueOn,
  isDueOn,
  weekdayBit,
  isoDate,
  fromIsoDate,
  addDays,
  isoWeekKey,
  yearMonthKey,
  maskLabel,
  slotKey,
  pctOf,
  isFilled,
  MASK_MON_SAT,
} from "@/lib/dcc/util";

/** Bit helpers so the expectations read as day names, not magic numbers. */
const MON = 1 << 0;
const TUE = 1 << 1;
const WED = 1 << 2;
const THU = 1 << 3;
const FRI = 1 << 4;
const SAT = 1 << 5;
const SUN = 1 << 6;

describe("parseFrequencyToMask", () => {
  it("recognises abbreviations", () => {
    expect(parseFrequencyToMask("Wed & Sat")).toBe(WED | SAT);
    expect(parseFrequencyToMask("Mon, Tue, Thu")).toBe(MON | TUE | THU);
  });

  it("recognises FULL day names, not just abbreviations", () => {
    // The regression this pattern exists for: "Every Friday" used to fall
    // through to null and become due every single day.
    expect(parseFrequencyToMask("Every Friday")).toBe(FRI);
    expect(parseFrequencyToMask("Wednesday and Saturday")).toBe(WED | SAT);
    expect(parseFrequencyToMask("Thursday")).toBe(THU);
    expect(parseFrequencyToMask("Sunday")).toBe(SUN);
  });

  it("treats daily as Mon–Sat", () => {
    expect(parseFrequencyToMask("Daily")).toBe(MASK_MON_SAT);
    expect(parseFrequencyToMask("every day")).toBe(MASK_MON_SAT);
  });

  it("returns null when nothing is recognised", () => {
    expect(parseFrequencyToMask("asdf")).toBeNull();
    expect(parseFrequencyToMask("")).toBeNull();
    expect(parseFrequencyToMask(null)).toBeNull();
    expect(parseFrequencyToMask(undefined)).toBeNull();
  });
});

describe("parseFrequency", () => {
  it("Daily → scheduled Mon–Sat", () => {
    expect(parseFrequency("Daily")).toEqual({
      scheduleKind: "scheduled",
      weekdays: MASK_MON_SAT,
      needsReview: false,
    });
  });

  it("Wed & Sat → scheduled on those two days", () => {
    expect(parseFrequency("Wed & Sat")).toEqual({
      scheduleKind: "scheduled",
      weekdays: WED | SAT,
      needsReview: false,
    });
  });

  it("Every Sat → weekly, one slot on Saturday", () => {
    expect(parseFrequency("Every Sat")).toEqual({
      scheduleKind: "weekly",
      weekdays: SAT,
      needsReview: false,
    });
  });

  it("Every Friday (full name) → weekly, one slot on Friday", () => {
    expect(parseFrequency("Every Friday")).toEqual({
      scheduleKind: "weekly",
      weekdays: FRI,
      needsReview: false,
    });
  });

  it("Mon or Thu → weekly with both bits (one slot, either day)", () => {
    expect(parseFrequency("Mon or Thu")).toEqual({
      scheduleKind: "weekly",
      weekdays: MON | THU,
      needsReview: false,
    });
  });

  it("Weekly → weekly, any day", () => {
    expect(parseFrequency("Weekly")).toEqual({
      scheduleKind: "weekly",
      weekdays: 0,
      needsReview: false,
    });
  });

  it("Every Month → monthly", () => {
    expect(parseFrequency("Every Month")).toEqual({
      scheduleKind: "monthly",
      weekdays: 0,
      needsReview: false,
    });
    expect(parseFrequency("Monthly").scheduleKind).toBe("monthly");
  });

  it("Adhoc → adhoc, not flagged", () => {
    expect(parseFrequency("Adhoc")).toEqual({
      scheduleKind: "adhoc",
      weekdays: null,
      needsReview: false,
    });
  });

  it("As per HH call scheduled → event", () => {
    expect(parseFrequency("As per HH call scheduled")).toEqual({
      scheduleKind: "event",
      weekdays: null,
      needsReview: false,
    });
    expect(parseFrequency("as and when").scheduleKind).toBe("event");
    expect(parseFrequency("when it happens").scheduleKind).toBe("event");
  });

  it("blank → adhoc + needsReview (never due every day)", () => {
    expect(parseFrequency("")).toEqual({
      scheduleKind: "adhoc",
      weekdays: null,
      needsReview: true,
    });
    expect(parseFrequency(null).scheduleKind).toBe("adhoc");
    expect(parseFrequency(undefined).needsReview).toBe(true);
  });

  it("unparseable → adhoc + needsReview (never due every day)", () => {
    expect(parseFrequency("asdf")).toEqual({
      scheduleKind: "adhoc",
      weekdays: null,
      needsReview: true,
    });
  });

  it("never returns a scheduled item with a null mask", () => {
    // A scheduled item with a null mask is "due every day" — the exact
    // failure mode that makes a typo tank everyone's compliance.
    for (const raw of ["", "   ", "asdf", "???", "tbd", null, undefined]) {
      const p = parseFrequency(raw);
      expect(p.scheduleKind === "scheduled" && p.weekdays == null).toBe(false);
    }
  });
});

describe("weekdayBit", () => {
  it("maps Monday to 0 and Sunday to 6", () => {
    expect(weekdayBit("2026-07-13")).toBe(0); // Monday
    expect(weekdayBit("2026-07-18")).toBe(5); // Saturday
    expect(weekdayBit("2026-07-19")).toBe(6); // Sunday
  });
});

describe("isDueOn", () => {
  it("a null or zero mask is always due", () => {
    expect(isDueOn(null, "2026-07-13")).toBe(true);
    expect(isDueOn(0, "2026-07-19")).toBe(true);
  });

  it("matches only the days in the mask", () => {
    const wedSat = WED | SAT;
    expect(isDueOn(wedSat, "2026-07-15")).toBe(true); // Wed
    expect(isDueOn(wedSat, "2026-07-18")).toBe(true); // Sat
    expect(isDueOn(wedSat, "2026-07-13")).toBe(false); // Mon
  });
});

describe("scheduledDueOn — the daily due-set predicate", () => {
  const wed = "2026-07-15";

  it("is true for a scheduled non-participant item due that weekday", () => {
    expect(scheduledDueOn({ scheduleKind: "scheduled", weekdays: WED }, wed)).toBe(true);
  });

  it("defaults a missing scheduleKind to scheduled", () => {
    expect(scheduledDueOn({ weekdays: WED }, wed)).toBe(true);
    expect(scheduledDueOn({ scheduleKind: null, weekdays: null }, wed)).toBe(true);
  });

  it("is false for every non-scheduled kind, even on a matching weekday", () => {
    for (const kind of ["weekly", "monthly", "adhoc", "event"]) {
      expect(scheduledDueOn({ scheduleKind: kind, weekdays: WED }, wed)).toBe(false);
      // …and even with an always-due mask, which is the tempting shape.
      expect(scheduledDueOn({ scheduleKind: kind, weekdays: null }, wed)).toBe(false);
    }
  });

  it("is false for a participant-list item however it is scheduled", () => {
    expect(
      scheduledDueOn(
        { scheduleKind: "scheduled", weekdays: null, isParticipantList: true },
        wed,
      ),
    ).toBe(false);
  });

  it("is false for a scheduled item on a weekday outside its mask", () => {
    expect(scheduledDueOn({ scheduleKind: "scheduled", weekdays: SAT }, wed)).toBe(false);
  });
});

describe("isoDate", () => {
  it("uses local calendar fields, not UTC", () => {
    // 00:30 IST on the 13th is 19:00 UTC on the 12th. toISOString() would
    // report the 12th; we must report the 13th.
    const d = new Date(2026, 6, 13, 0, 30);
    expect(isoDate(d)).toBe("2026-07-13");
  });

  it("round-trips through fromIsoDate", () => {
    expect(isoDate(fromIsoDate("2026-02-29"))).toBe("2026-03-01"); // 2026 isn't a leap year
    expect(isoDate(fromIsoDate("2026-07-13"))).toBe("2026-07-13");
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-07-13", 0)).toBe("2026-07-13");
  });
});

describe("isoWeekKey / yearMonthKey", () => {
  it("anchors the ISO week on Thursday", () => {
    // Mon 2026-07-13 … Sun 2026-07-19 are all the same ISO week.
    expect(isoWeekKey("2026-07-13")).toBe(isoWeekKey("2026-07-19"));
    expect(isoWeekKey("2026-07-20")).not.toBe(isoWeekKey("2026-07-19"));
    expect(isoWeekKey("2026-07-13")).toMatch(/^2026-W\d{2}$/);
  });

  it("yearMonthKey formats as YYYY-MM", () => {
    expect(yearMonthKey("2026-07-13")).toBe("2026-07");
    expect(yearMonthKey("2026-12-31")).toBe("2026-12");
  });
});

describe("maskLabel", () => {
  it("names the special cases and lists the rest", () => {
    expect(maskLabel(null)).toBe("Any");
    expect(maskLabel(0)).toBe("Any");
    expect(maskLabel(MASK_MON_SAT)).toBe("Daily");
    expect(maskLabel(MON | WED | SAT)).toBe("Mon · Wed · Sat");
  });
});

describe("slotKey", () => {
  it("distinguishes a simple row from a participant row", () => {
    expect(slotKey("i1", null, "2026-07-13")).toBe("i1||2026-07-13");
    expect(slotKey("i1", "s1", "2026-07-13")).toBe("i1|s1|2026-07-13");
    expect(slotKey("i1", undefined, "2026-07-13")).toBe(slotKey("i1", null, "2026-07-13"));
  });
});

describe("pctOf", () => {
  it("treats nothing-due as 100 rather than NaN", () => {
    expect(pctOf(0, 0)).toBe(100);
    expect(pctOf(3, 4)).toBe(75);
    expect(pctOf(0, 5)).toBe(0);
  });
});

describe("isFilled", () => {
  it("counts any of status, value or note", () => {
    expect(isFilled({ status: "Done" })).toBe(true);
    expect(isFilled({ valueNumber: "12.00" })).toBe(true);
    expect(isFilled({ note: "spoke to them" })).toBe(true);
    expect(isFilled({ valueNumber: 0 })).toBe(true); // zero is a real answer
  });

  it("is false for empty, whitespace-only and missing entries", () => {
    expect(isFilled(null)).toBe(false);
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled({})).toBe(false);
    expect(isFilled({ status: null, valueNumber: null, note: "   " })).toBe(false);
  });
});
