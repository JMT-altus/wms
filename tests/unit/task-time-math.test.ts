import { describe, it, expect } from "vitest";
import {
  AUTO_CLOSE_AFTER_SECONDS,
  compareToEstimate,
  foldRollup,
  formatClock,
  formatDuration,
  isOpen,
  pairEvents,
  shouldAutoClose,
  spanSeconds,
} from "@/lib/tasks/time-math";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-04T10:00:00.000Z");

describe("spanSeconds", () => {
  it("measures a closed span from its timestamps", () => {
    expect(
      spanSeconds({
        startedAt: at("2026-09-04T09:00:00.000Z"),
        endedAt: at("2026-09-04T09:30:00.000Z"),
      }),
    ).toBe(1800);
  });

  it("prefers a stored duration over recomputing it", () => {
    // Recomputing would quietly rewrite history if the row was adjusted.
    expect(
      spanSeconds({
        startedAt: at("2026-09-04T09:00:00.000Z"),
        endedAt: at("2026-09-04T09:30:00.000Z"),
        durationSeconds: 900,
      }),
    ).toBe(900);
  });

  it("measures an open span against now, so the timer ticks", () => {
    expect(
      spanSeconds({ startedAt: at("2026-09-04T09:45:00.000Z"), endedAt: null }, NOW),
    ).toBe(900);
  });

  it("clamps a backwards clock to zero rather than negative work", () => {
    expect(
      spanSeconds({
        startedAt: at("2026-09-04T09:30:00.000Z"),
        endedAt: at("2026-09-04T09:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("accepts ISO strings, as a cache round-trip hands them back", () => {
    expect(
      spanSeconds({
        startedAt: "2026-09-04T09:00:00.000Z",
        endedAt: "2026-09-04T09:10:00.000Z",
      }),
    ).toBe(600);
  });

  it("returns zero for an unparseable start", () => {
    expect(spanSeconds({ startedAt: "not a date", endedAt: null }, NOW)).toBe(0);
  });
});

describe("isOpen", () => {
  it("is true only while no stop is recorded", () => {
    expect(isOpen({ startedAt: NOW, endedAt: null })).toBe(true);
    expect(isOpen({ startedAt: NOW })).toBe(true);
    expect(isOpen({ startedAt: NOW, endedAt: NOW })).toBe(false);
  });
});

describe("foldRollup", () => {
  const spans = [
    {
      startedAt: at("2026-09-04T08:00:00.000Z"),
      endedAt: at("2026-09-04T08:30:00.000Z"),
    },
    {
      startedAt: at("2026-09-04T09:00:00.000Z"),
      endedAt: at("2026-09-04T09:15:00.000Z"),
    },
  ];

  it("sums, counts and brackets the spans", () => {
    const r = foldRollup(spans, NOW);
    expect(r.totalSeconds).toBe(1800 + 900);
    expect(r.sessionCount).toBe(2);
    expect(r.firstStartedAt?.toISOString()).toBe("2026-09-04T08:00:00.000Z");
    expect(r.lastEndedAt?.toISOString()).toBe("2026-09-04T09:15:00.000Z");
  });

  it("counts an open span in the total but not in lastEndedAt", () => {
    // The number on screen should include the timer you are watching run;
    // lastEndedAt describes finished work only.
    const r = foldRollup(
      [...spans, { startedAt: at("2026-09-04T09:50:00.000Z"), endedAt: null }],
      NOW,
    );
    expect(r.totalSeconds).toBe(1800 + 900 + 600);
    expect(r.sessionCount).toBe(3);
    expect(r.lastEndedAt?.toISOString()).toBe("2026-09-04T09:15:00.000Z");
  });

  it("folds an empty list into a zero rollup, not a crash", () => {
    expect(foldRollup([], NOW)).toEqual({
      totalSeconds: 0,
      sessionCount: 0,
      firstStartedAt: null,
      lastEndedAt: null,
    });
  });

  it("takes the earliest start even when the spans arrive out of order", () => {
    const r = foldRollup([spans[1]!, spans[0]!], NOW);
    expect(r.firstStartedAt?.toISOString()).toBe("2026-09-04T08:00:00.000Z");
  });
});

describe("shouldAutoClose", () => {
  it("leaves a normal open session alone", () => {
    expect(
      shouldAutoClose({ startedAt: at("2026-09-04T08:00:00.000Z"), endedAt: null }, NOW),
    ).toBe(false);
  });

  it("closes a session that outlived the window", () => {
    const started = new Date(NOW.getTime() - (AUTO_CLOSE_AFTER_SECONDS + 60) * 1000);
    expect(shouldAutoClose({ startedAt: started, endedAt: null }, NOW)).toBe(true);
  });

  it("never re-closes a finished session", () => {
    const started = new Date(NOW.getTime() - 40 * 60 * 60 * 1000);
    expect(shouldAutoClose({ startedAt: started, endedAt: NOW }, NOW)).toBe(false);
  });
});

describe("formatDuration", () => {
  it("drops the hour part under an hour", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(59)).toBe("0m");
  });

  it("pads minutes so a column of figures lines up", () => {
    expect(formatDuration(4 * 3600 + 5 * 60)).toBe("4h 05m");
    expect(formatDuration(3600)).toBe("1h 00m");
  });

  it("never renders negative time", () => {
    expect(formatDuration(-500)).toBe("0m");
  });
});

describe("formatClock", () => {
  it("shows MM:SS under an hour and H:MM:SS above it", () => {
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(0)).toBe("00:00");
  });
});

describe("compareToEstimate", () => {
  it("says 'we don't know' when nothing was estimated", () => {
    const c = compareToEstimate(null, 3600);
    expect(c.estimatedSeconds).toBeNull();
    expect(c.ratio).toBeNull();
    expect(c.over).toBe(false);
    expect(c.actualSeconds).toBe(3600);
  });

  it("treats a zero estimate as no estimate, not a division by zero", () => {
    expect(compareToEstimate(0, 3600).ratio).toBeNull();
  });

  it("computes the ratio and flags an overrun", () => {
    const c = compareToEstimate(60, 5400); // estimate 1h, actual 1.5h
    expect(c.estimatedSeconds).toBe(3600);
    expect(c.ratio).toBeCloseTo(1.5);
    expect(c.over).toBe(true);
    expect(c.overBySeconds).toBe(1800);
  });

  it("reports no overrun, and never a negative one, when under estimate", () => {
    const c = compareToEstimate(120, 3600);
    expect(c.over).toBe(false);
    expect(c.overBySeconds).toBe(0);
  });
});

describe("pairEvents", () => {
  it("pairs a clean start/stop log", () => {
    const spans = pairEvents([
      { kind: "start", at: "2026-09-04T08:00:00.000Z" },
      { kind: "stop", at: "2026-09-04T08:30:00.000Z" },
    ]);
    expect(spans).toHaveLength(1);
    expect(spanSeconds(spans[0]!)).toBe(1800);
  });

  it("sorts out-of-order arrivals before pairing", () => {
    const spans = pairEvents([
      { kind: "stop", at: "2026-09-04T08:30:00.000Z" },
      { kind: "start", at: "2026-09-04T08:00:00.000Z" },
    ]);
    expect(spans).toHaveLength(1);
    expect(spanSeconds(spans[0]!)).toBe(1800);
  });

  it("closes the previous stretch when a second start arrives", () => {
    const spans = pairEvents([
      { kind: "start", at: "2026-09-04T08:00:00.000Z" },
      { kind: "start", at: "2026-09-04T08:20:00.000Z" },
      { kind: "stop", at: "2026-09-04T08:50:00.000Z" },
    ]);
    expect(spans).toHaveLength(2);
    expect(spanSeconds(spans[0]!)).toBe(1200);
    expect(spanSeconds(spans[1]!)).toBe(1800);
  });

  it("drops a stop with nothing open — a duplicate tap", () => {
    const spans = pairEvents([
      { kind: "stop", at: "2026-09-04T08:00:00.000Z" },
      { kind: "start", at: "2026-09-04T08:10:00.000Z" },
      { kind: "stop", at: "2026-09-04T08:20:00.000Z" },
      { kind: "stop", at: "2026-09-04T08:25:00.000Z" },
    ]);
    expect(spans).toHaveLength(1);
    expect(spanSeconds(spans[0]!)).toBe(600);
  });

  it("leaves a trailing start open — the timer really is running", () => {
    const spans = pairEvents([{ kind: "start", at: "2026-09-04T09:50:00.000Z" }]);
    expect(spans).toHaveLength(1);
    expect(isOpen(spans[0]!)).toBe(true);
    expect(spanSeconds(spans[0]!, NOW)).toBe(600);
  });

  it("ignores events with an unparseable timestamp", () => {
    expect(pairEvents([{ kind: "start", at: "nonsense" }])).toEqual([]);
  });

  it("folds a raw log straight into a rollup", () => {
    const rollup = foldRollup(
      pairEvents([
        { kind: "start", at: "2026-09-04T08:00:00.000Z" },
        { kind: "stop", at: "2026-09-04T08:30:00.000Z" },
        { kind: "start", at: "2026-09-04T09:00:00.000Z" },
        { kind: "stop", at: "2026-09-04T09:10:00.000Z" },
      ]),
      NOW,
    );
    expect(rollup.totalSeconds).toBe(2400);
    expect(rollup.sessionCount).toBe(2);
  });
});
