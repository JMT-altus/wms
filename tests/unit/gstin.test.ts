import { describe, expect, it } from "vitest";
import { deriveStateFromGstin, isPlausibleGstin, panFromGstin } from "@/lib/masters/gstin";

describe("panFromGstin", () => {
  it("pulls the PAN out of a well-formed GSTIN", () => {
    // 27 | ABCDE1234F | 1 | Z | 5
    expect(panFromGstin("27ABCDE1234F1Z5")).toBe("ABCDE1234F");
  });

  it("uppercases and trims first", () => {
    expect(panFromGstin("  27abcde1234f1z5 ")).toBe("ABCDE1234F");
  });

  it("returns null while the number is still being typed", () => {
    expect(panFromGstin("27ABCDE")).toBeNull();
    expect(panFromGstin("")).toBeNull();
    expect(panFromGstin(null)).toBeNull();
  });

  it("returns null rather than a wrong PAN when those ten characters are malformed", () => {
    // digits where the PAN's five leading letters belong
    expect(panFromGstin("2712345234F1Z5")).toBeNull();
  });
});

describe("deriveStateFromGstin", () => {
  it("reads the state from the leading code", () => {
    expect(deriveStateFromGstin("27ABCDE1234F1Z5")).toBe("Maharashtra");
    expect(deriveStateFromGstin("29ABCDE1234F1Z5")).toBe("Karnataka");
  });

  it("returns null for an unassigned code", () => {
    expect(deriveStateFromGstin("99ABCDE1234F1Z5")).toBeNull();
  });
});

describe("isPlausibleGstin", () => {
  it("accepts a correctly shaped number and rejects a short one", () => {
    expect(isPlausibleGstin("27ABCDE1234F1Z5")).toBe(true);
    expect(isPlausibleGstin("27ABCDE1234F")).toBe(false);
  });
});
