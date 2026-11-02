import { describe, it, expect } from "vitest";
import { commitmentLabel, COMMITMENT_SEPARATOR } from "@/lib/collections/commitment-display";

// How a commitment reads in the Collection Amount Confirmation column and the popup.

describe("commitmentLabel", () => {
  it("amount in Indian grouping, then the standard dd/mm/yy date, joined by a dash", () => {
    expect(commitmentLabel({ amount: "100000.00", committedDate: "2026-11-04" })).toBe("₹1,00,000 – 04/11/26");
    expect(commitmentLabel({ amount: "125000.50", committedDate: "2026-01-05" })).toBe("₹1,25,000.50 – 05/01/26");
    expect(commitmentLabel({ amount: "311855013.28", committedDate: "2025-12-31" })).toBe("₹31,18,55,013.28 – 31/12/25");
    expect(COMMITMENT_SEPARATOR).toBe(" – ");
  });

  it("is nothing, never a misleading half, when the amount or the date is missing or unreadable", () => {
    expect(commitmentLabel(null)).toBeNull();
    expect(commitmentLabel(undefined)).toBeNull();
    expect(commitmentLabel({ amount: "", committedDate: "2026-11-04" })).toBeNull();
    expect(commitmentLabel({ amount: "100000.00", committedDate: "" })).toBeNull();
    expect(commitmentLabel({ amount: null, committedDate: "2026-11-04" })).toBeNull();
    expect(commitmentLabel({ amount: "100000.00", committedDate: null })).toBeNull();
    expect(commitmentLabel({ amount: "100000.00", committedDate: "2026-02-30" })).toBeNull();
    expect(commitmentLabel({ amount: "not money", committedDate: "2026-11-04" })).toBeNull();
  });
});
