import { describe, it, expect } from "vitest";
import {
  fmtDate,
  fmtDateLong,
  fmtDateTime,
  fmtTime,
  fmtDateRange,
  fmtMonth,
  fmtWeekday,
  fmtDateWithWeekday,
  parseDmy,
  isValidYmd,
  isLeapYear,
  daysInMonth,
  ymdOf,
  todayYmd,
  dateParts,
} from "@/lib/dates";

// The one date vocabulary: DD/MM/YY everywhere, ISO underneath.

describe("fmtDate — the standard DD/MM/YY", () => {
  it("reads a calendar date from its digits", () => {
    expect(fmtDate("2026-11-02")).toBe("02/11/26");
    expect(fmtDate("2026-01-05")).toBe("05/01/26");
    expect(fmtDate("2025-12-31")).toBe("31/12/25");
    expect(fmtDate("2000-02-29")).toBe("29/02/00");
  });

  it("never shifts a date-only value across midnight, whatever the server clock says", () => {
    // A ymd is formatted without ever becoming a Date, so UTC vs IST cannot move it.
    expect(fmtDate("2026-11-02")).toBe("02/11/26");
    expect(fmtDate("2026-01-01")).toBe("01/01/26");
    expect(fmtDate("2026-12-31")).toBe("31/12/26");
    expect(fmtDate("2026-11-02T00:00:00")).toBe("02/11/26"); // zoneless date-time: as written
  });

  it("shows an instant on the Indian clock by default", () => {
    // 2026-11-02 20:30 UTC is 2026-11-03 02:00 IST.
    expect(fmtDate(new Date("2026-11-02T20:30:00Z"))).toBe("03/11/26");
    expect(fmtDate(new Date("2026-11-02T20:30:00Z"), { tz: "UTC" })).toBe("02/11/26");
    expect(fmtDate("2026-11-02T20:30:00Z")).toBe("03/11/26"); // zoned ISO string is an instant
    expect(fmtDate("2026-11-02T20:30:00+05:30")).toBe("02/11/26");
    expect(fmtDate(Date.UTC(2026, 10, 2, 12))).toBe("02/11/26");
  });

  it("is empty for nothing, and for values that are not dates", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
    expect(fmtDate("")).toBe("");
    expect(fmtDate("not a date")).toBe("");
    expect(fmtDate(new Date("garbage"))).toBe("");
    expect(fmtDate("2026-02-30")).toBe(""); // impossible calendar date
    expect(fmtDate("2026-13-01")).toBe("");
  });

  it("four-digit years on request", () => {
    expect(fmtDateLong("2026-11-02")).toBe("02/11/2026");
    expect(fmtDate("2026-11-02", { fullYear: true })).toBe("02/11/2026");
  });
});

describe("date and time, weekday, month, range", () => {
  it("date and time: 02/11/26, 03:45 PM", () => {
    expect(fmtDateTime(new Date("2026-11-02T10:15:00Z"))).toBe("02/11/26, 03:45 PM"); // 15:45 IST
    expect(fmtDateTime(new Date("2026-11-02T18:30:00Z"))).toBe("03/11/26, 12:00 AM");
    expect(fmtDateTime(new Date("2026-11-02T06:30:00Z"))).toBe("02/11/26, 12:00 PM");
    expect(fmtTime(new Date("2026-11-02T03:35:00Z"))).toBe("09:05 AM");
    expect(fmtDateTime(null)).toBe("");
  });

  it("weekday", () => {
    expect(fmtWeekday("2026-11-02")).toBe("Monday");
    expect(fmtWeekday("2026-11-08", "short")).toBe("Sun");
    expect(fmtDateWithWeekday("2026-11-02")).toBe("Monday, 02/11/26");
    expect(fmtDateWithWeekday("2026-11-02", "short")).toBe("Mon, 02/11/26");
    expect(fmtWeekday(new Date("2026-11-02T20:30:00Z"))).toBe("Tuesday"); // already Tuesday in IST
  });

  it("month and year where a full date is unnecessary", () => {
    expect(fmtMonth("2026-11")).toBe("Nov 2026");
    expect(fmtMonth("2026-11-02")).toBe("Nov 2026");
    expect(fmtMonth(new Date("2026-11-30T20:30:00Z"))).toBe("Dec 2026"); // 1 Dec in IST
    expect(fmtMonth("2026-11", "long")).toBe("November 2026");
    expect(fmtMonth("2026-13")).toBe("");
  });

  it("ranges", () => {
    expect(fmtDateRange("2026-11-01", "2026-11-30")).toBe("01/11/26 – 30/11/26");
    expect(fmtDateRange("2026-12-29", "2027-01-04")).toBe("29/12/26 – 04/01/27");
    expect(fmtDateRange("2026-11-02", "2026-11-02")).toBe("02/11/26");
    expect(fmtDateRange("2026-11-02", null)).toBe("02/11/26");
    expect(fmtDateRange(null, null)).toBe("");
  });
});

describe("parseDmy — what a person types", () => {
  it("accepts dd/mm/yy and its relatives, day first always", () => {
    expect(parseDmy("02/11/26")).toBe("2026-11-02");
    expect(parseDmy("2/11/26")).toBe("2026-11-02");
    expect(parseDmy("02/11/2026")).toBe("2026-11-02");
    expect(parseDmy("02-11-26")).toBe("2026-11-02");
    expect(parseDmy("02.11.26")).toBe("2026-11-02");
    expect(parseDmy("02 11 26")).toBe("2026-11-02");
    expect(parseDmy("  31/12/25 ")).toBe("2025-12-31");
    expect(parseDmy("2026-11-02")).toBe("2026-11-02"); // pasted ISO
  });

  it("is never mm/dd: 11/02/26 is 11 February", () => {
    expect(parseDmy("11/02/26")).toBe("2026-02-11");
    expect(parseDmy("12/13/26")).toBeNull(); // month 13 does not exist — not silently swapped
  });

  it("two-digit years: 00–69 → 2000s, 70–99 → 1900s", () => {
    expect(parseDmy("01/01/00")).toBe("2000-01-01");
    expect(parseDmy("01/01/69")).toBe("2069-01-01");
    expect(parseDmy("15/08/70")).toBe("1970-08-15");
    expect(parseDmy("15/08/85")).toBe("1985-08-15");
  });

  it("rejects impossible dates", () => {
    expect(parseDmy("31/02/26")).toBeNull();
    expect(parseDmy("30/02/24")).toBeNull();
    expect(parseDmy("29/02/26")).toBeNull(); // not a leap year
    expect(parseDmy("29/02/00")).toBe("2000-02-29"); // 2000 is
    expect(parseDmy("29/02/24")).toBe("2024-02-29");
    expect(parseDmy("29/02/1900")).toBeNull(); // 1900 is not
    expect(parseDmy("31/04/26")).toBeNull();
    expect(parseDmy("00/01/26")).toBeNull();
    expect(parseDmy("01/00/26")).toBeNull();
    expect(parseDmy("32/01/26")).toBeNull();
  });

  it("rejects partial or foreign text", () => {
    expect(parseDmy("")).toBeNull();
    expect(parseDmy("   ")).toBeNull();
    expect(parseDmy(null)).toBeNull();
    expect(parseDmy(undefined)).toBeNull();
    expect(parseDmy("02/11")).toBeNull();
    expect(parseDmy("02/11/2")).toBeNull();
    expect(parseDmy("02/11/202")).toBeNull();
    expect(parseDmy("2 Nov 2026")).toBeNull();
    expect(parseDmy("02/11/26 extra")).toBeNull();
    expect(parseDmy("2026-02-30")).toBeNull();
  });

  it("round-trips through the display format", () => {
    for (const ymd of ["2024-02-29", "2026-01-01", "2026-12-31", "2026-03-31", "2026-04-30", "1999-12-31"]) {
      expect(parseDmy(fmtDate(ymd))).toBe(ymd);
      expect(parseDmy(fmtDateLong(ymd))).toBe(ymd);
    }
  });
});

describe("calendar arithmetic", () => {
  it("leap years and month lengths", () => {
    expect([2000, 2024, 2026, 1900, 2100].map(isLeapYear)).toEqual([true, true, false, false, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect([1, 3, 4, 12].map((m) => daysInMonth(2026, m))).toEqual([31, 31, 30, 31]);
  });

  it("isValidYmd", () => {
    expect(isValidYmd("2026-11-02")).toBe(true);
    expect(isValidYmd("2024-02-29")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-11-2")).toBe(false);
    expect(isValidYmd("02/11/26")).toBe(false);
    expect(isValidYmd(null)).toBe(false);
  });

  it("the calendar day of an instant, in a timezone", () => {
    expect(ymdOf(new Date("2026-11-02T20:30:00Z"))).toBe("2026-11-03");
    expect(ymdOf(new Date("2026-11-02T20:30:00Z"), "UTC")).toBe("2026-11-02");
    expect(ymdOf("2026-11-02")).toBe("2026-11-02");
    expect(ymdOf(null)).toBe("");
    expect(todayYmd("UTC", new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
    expect(todayYmd("Asia/Kolkata", new Date("2026-12-31T23:59:59Z"))).toBe("2027-01-01"); // year end rolls over in IST
  });

  it("parts", () => {
    expect(dateParts("2026-11-02")).toEqual({ y: 2026, m: 11, d: 2, hh: 0, mm: 0, dow: 1 });
    expect(dateParts(new Date("2026-11-02T18:30:00Z"))).toEqual({ y: 2026, m: 11, d: 3, hh: 0, mm: 0, dow: 2 });
    expect(dateParts("nope")).toBeNull();
  });
});
