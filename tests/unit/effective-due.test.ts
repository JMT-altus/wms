import { describe, it, expect } from "vitest";
import {
  pickEffectiveDue,
  isRevised,
  daysUntilEffectiveDue,
  isOverdue,
} from "@/lib/tasks/effective-due";

// Due dates are stored at noon IST; the helpers compare IST calendar days.
const noonIst = (day: string) => new Date(`${day}T06:30:00.000Z`); // 12:00 IST
const NOW = noonIst("2026-09-03");

describe("pickEffectiveDue", () => {
  it("falls back to due_at when there is no revision", () => {
    const d = pickEffectiveDue({ dueAt: noonIst("2026-09-01"), revisedTargetDate: null });
    expect(d?.toISOString()).toBe(noonIst("2026-09-01").toISOString());
  });

  it("prefers the revised target date", () => {
    const d = pickEffectiveDue({
      dueAt: noonIst("2026-09-01"),
      revisedTargetDate: noonIst("2026-09-10"),
    });
    expect(d?.toISOString()).toBe(noonIst("2026-09-10").toISOString());
  });

  it("accepts ISO strings — a cache round-trip hands back strings, not Dates", () => {
    const d = pickEffectiveDue({ dueAt: noonIst("2026-09-01").toISOString() });
    expect(d).toBeInstanceOf(Date);
  });

  it("returns null when neither date parses", () => {
    expect(pickEffectiveDue({ dueAt: null })).toBeNull();
    expect(pickEffectiveDue({ dueAt: "not a date" })).toBeNull();
  });

  it("ignores an unparseable revision rather than losing the original", () => {
    const d = pickEffectiveDue({
      dueAt: noonIst("2026-09-01"),
      revisedTargetDate: "garbage",
    });
    expect(d?.toISOString()).toBe(noonIst("2026-09-01").toISOString());
  });
});

describe("isRevised", () => {
  it("is false with no revision", () => {
    expect(isRevised({ dueAt: noonIst("2026-09-01") })).toBe(false);
  });
  it("is false when the revision equals the original", () => {
    expect(
      isRevised({ dueAt: noonIst("2026-09-01"), revisedTargetDate: noonIst("2026-09-01") }),
    ).toBe(false);
  });
  it("is true when the revision moves the date", () => {
    expect(
      isRevised({ dueAt: noonIst("2026-09-01"), revisedTargetDate: noonIst("2026-09-10") }),
    ).toBe(true);
  });
});

describe("daysUntilEffectiveDue", () => {
  it("is negative for a past date", () => {
    expect(daysUntilEffectiveDue({ dueAt: noonIst("2026-09-01") }, NOW)).toBe(-2);
  });
  it("is 0 on the due day", () => {
    expect(daysUntilEffectiveDue({ dueAt: noonIst("2026-09-03") }, NOW)).toBe(0);
  });
  it("is positive for a future date", () => {
    expect(daysUntilEffectiveDue({ dueAt: noonIst("2026-09-06") }, NOW)).toBe(3);
  });
  it("counts from the revision, not the original", () => {
    expect(
      daysUntilEffectiveDue(
        { dueAt: noonIst("2026-09-01"), revisedTargetDate: noonIst("2026-09-06") },
        NOW,
      ),
    ).toBe(3);
  });
});

describe("isOverdue", () => {
  it("flags an open task past its original due date", () => {
    expect(isOverdue({ dueAt: noonIst("2026-09-01"), status: "initiated" }, NOW)).toBe(true);
  });

  // The regression this module exists for.
  it("stops flagging once the task is rescheduled into the future", () => {
    expect(
      isOverdue(
        {
          dueAt: noonIst("2026-09-01"),
          revisedTargetDate: noonIst("2026-09-20"),
          status: "initiated",
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("still flags when the revision is itself in the past", () => {
    expect(
      isOverdue(
        {
          dueAt: noonIst("2026-08-01"),
          revisedTargetDate: noonIst("2026-09-02"),
          status: "follow_up",
        },
        NOW,
      ),
    ).toBe(true);
  });

  it.each(["done", "approved", "not_approved", "cancelled", "transferred"])(
    "never flags terminal status %s",
    (status) => {
      expect(isOverdue({ dueAt: noonIst("2026-01-01"), status }, NOW)).toBe(false);
    },
  );

  it("is false when there is no date at all", () => {
    expect(isOverdue({ dueAt: null, status: "initiated" }, NOW)).toBe(false);
  });
});
