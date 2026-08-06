import { describe, it, expect } from "vitest";

function pct(count: number, denom: number): string {
  if (denom === 0) return "0.0%";
  return `${((count / denom) * 100).toFixed(1)}%`;
}

describe("status distribution percentage", () => {
  // Changed deliberately: the panel used to hide Approved and divide by
  // (total - approved), so the shares read as "% of open work". Approved is now
  // one of the nine status tiles, so the denominator is the whole set and the
  // shares add up to 100%. Dividing by (total - approved) now would total more
  // than 100% across the tiles shown.
  it("uses the full total as the denominator, so shares sum to 100%", () => {
    const counts = { not_started: 4, done: 2, approved: 4 };
    const denom = counts.not_started + counts.done + counts.approved;
    expect(denom).toBe(10);
    expect(pct(counts.not_started, denom)).toBe("40.0%");

    const sum =
      (counts.not_started / denom) * 100 +
      (counts.done / denom) * 100 +
      (counts.approved / denom) * 100;
    expect(Math.round(sum)).toBe(100);
  });
  it("returns 0.0% when denominator is zero", () => {
    expect(pct(0, 0)).toBe("0.0%");
  });
});
