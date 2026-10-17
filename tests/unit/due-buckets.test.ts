import { describe, expect, it } from "vitest";
import { DUE_BUCKETS, dueBucketRange, isDueBucket, startOfTodayIst, type DueBucket } from "@/lib/due-buckets";
import { parseFilters } from "@/lib/filters";

const NOW = new Date("2026-10-15T10:00:00Z"); // 15:30 IST
const S = startOfTodayIst(NOW).getTime();
const DAY = 24 * 60 * 60 * 1000;
const inBucket = (b: DueBucket, due: number) => {
  const { from, to } = dueBucketRange(b, NOW);
  return (from == null || due >= from.getTime()) && (to == null || due < to.getTime());
};
const bucketsFor = (due: number) => DUE_BUCKETS.map((b) => b.value).filter((b) => inBucket(b, due));

describe("due buckets", () => {
  it("starts the day at IST midnight", () => {
    expect(new Date(S).toISOString()).toBe("2026-10-14T18:30:00.000Z");
  });

  it("puts a task k whole days overdue in the matching bucket (and Overdue)", () => {
    const k = (n: number) => S - n * DAY;
    expect(bucketsFor(k(1))).toEqual(["overdue", "o1"]);
    expect(bucketsFor(k(3))).toEqual(["overdue", "o1"]);
    expect(bucketsFor(k(4))).toEqual(["overdue", "o4"]);
    expect(bucketsFor(k(7))).toEqual(["overdue", "o4"]);
    expect(bucketsFor(k(8))).toEqual(["overdue", "o8"]);
    expect(bucketsFor(k(14))).toEqual(["overdue", "o8"]);
    expect(bucketsFor(k(15))).toEqual(["overdue", "o15"]);
    expect(bucketsFor(k(21))).toEqual(["overdue", "o15"]);
    expect(bucketsFor(k(22))).toEqual(["overdue", "o22"]);
    expect(bucketsFor(k(90))).toEqual(["overdue", "o22"]);
  });

  it("puts today and future due dates in exactly one bucket each", () => {
    expect(bucketsFor(S)).toEqual(["today"]);
    expect(bucketsFor(S + 1 * DAY)).toEqual(["b1"]);
    expect(bucketsFor(S + 3 * DAY)).toEqual(["b1"]);
    expect(bucketsFor(S + 4 * DAY)).toEqual(["b4"]);
    expect(bucketsFor(S + 7 * DAY)).toEqual(["b4"]);
    expect(bucketsFor(S + 8 * DAY)).toEqual(["b8"]);
    expect(bucketsFor(S + 60 * DAY)).toEqual(["b8"]);
  });

  it("parses the ?due= param and ignores unknown values", () => {
    expect(parseFilters({ due: "o15" }).dueBucket).toBe("o15");
    expect(parseFilters({ due: "nonsense" }).dueBucket).toBeNull();
    expect(parseFilters({}).dueBucket).toBeNull();
    expect(isDueBucket("today")).toBe(true);
  });
});
