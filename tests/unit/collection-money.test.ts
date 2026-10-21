import { describe, expect, it } from "vitest";
import { formatInrExact, MAX_AMOUNT_TEXT, parseAmount, paiseToText, toPaise } from "@/lib/collections/money";
import { CommitmentInput } from "@/lib/collections/validate";

// Exact money for commitments: decimal strings and BigInt paise, never binary
// floating point. The old check rejected about 8% of valid amounts above ₹10 crore.
const ok = (s: unknown) => parseAmount(s);

describe("parseAmount — valid amounts are accepted exactly", () => {
  it("the reported failing example ₹31,18,55,013.28", () => {
    expect(ok("311855013.28")).toEqual({ ok: true, text: "311855013.28", paise: 31185501328n });
  });
  it("amounts around ₹10 crore", () => {
    for (const s of ["99999999.99", "100000000", "100000000.01", "100000000.10", "123456789.07", "550516400.30"]) {
      const r = ok(s);
      expect(r.ok, s).toBe(true);
      if (r.ok) expect(toPaise(r.text)).toBe(toPaise(s));
    }
  });
  it("up to the column maximum ₹9,99,99,99,99,999.99, and every two-decimal amount in a sweep", () => {
    expect(ok(MAX_AMOUNT_TEXT)).toEqual({ ok: true, text: "999999999999.99", paise: 99999999999999n });
    expect(ok("999999999999.98")).toMatchObject({ ok: true });
    // A deterministic sweep across magnitudes: none rejected, none changed.
    for (let i = 1n; i < 2000n; i++) {
      const paise = (i * 7919n * 1000003n * 4513n) % 99999999999999n || 1n;
      const text = paiseToText(paise);
      const r = ok(text);
      expect(r.ok && r.paise === paise, text).toBe(true);
    }
  });
  it("normalises to two decimals without changing the value", () => {
    expect(ok("125000")).toMatchObject({ text: "125000.00" });
    expect(ok(" 125000.5 ")).toMatchObject({ text: "125000.50" });
    expect(ok("0.01")).toMatchObject({ text: "0.01", paise: 1n });
  });
});

describe("parseAmount — anything else is refused safely", () => {
  it("zero and negative", () => {
    expect(ok("0")).toEqual({ ok: false, error: "The committed amount must be more than zero." });
    expect(ok("0.00")).toMatchObject({ ok: false });
    expect(ok("-5")).toMatchObject({ ok: false });
  });
  it("more than two decimals", () => {
    expect(ok("10.123")).toEqual({ ok: false, error: "Use at most 2 decimal places." });
    expect(ok("311855013.285")).toEqual({ ok: false, error: "Use at most 2 decimal places." });
  });
  it("too large for the column", () => {
    expect(ok("1000000000000")).toEqual({ ok: false, error: "That amount is too large." });
    expect(ok("1000000000000.00")).toMatchObject({ ok: false });
  });
  it("malformed text, exponents, Infinity, NaN, grouping, signs and non-strings", () => {
    for (const bad of ["", "  ", "abc", "1e5", "1E5", "Infinity", "NaN", "1,25,000", "+100", "12.", ".5", "0012", "12 34", "₹100"]) {
      expect(ok(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    for (const bad of [125000, 311855013.28, Infinity, NaN, null, undefined, {}, 10n]) {
      expect(ok(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe("exact display", () => {
  it("whole rupees as before, paise shown — never rounded away", () => {
    expect(formatInrExact("125000.00")).toBe("₹1,25,000");
    expect(formatInrExact("311855013.28")).toBe("₹31,18,55,013.28");
    expect(formatInrExact("999999999999.99")).toBe("₹9,99,99,99,99,999.99");
    expect(formatInrExact("0.05")).toBe("₹0.05");
    expect(formatInrExact(31185501328n + 40000n)).toBe("₹31,18,55,413.28");
  });
});

describe("CommitmentInput uses the exact check", () => {
  const base = { companyId: "11111111-1111-4111-8111-111111111111", committedDate: "2026-11-05" };
  it("accepts the large example and hands on canonical text", () => {
    const r = CommitmentInput.safeParse({ ...base, amount: "311855013.28" });
    expect(r.success && r.data.amount).toBe("311855013.28");
  });
  it("rejects floats, extra decimals and zero", () => {
    for (const amount of [311855013.28, "10.123", "0"]) expect(CommitmentInput.safeParse({ ...base, amount }).success).toBe(false);
  });
});
