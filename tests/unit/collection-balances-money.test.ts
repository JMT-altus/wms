import { describe, expect, it } from "vitest";
import { buildBalancePlan, parseMoney, type BalanceCompany } from "@/lib/collections/balances/plan";
import { nameKey } from "@/lib/collections/master/normalize";

// Bulk Upload amounts are read EXACTLY (decimal text → whole paise, no binary
// floating point). Regression: ₹31,18,55,013.28 used to be refused as "more
// than two decimal places" because 311855013.28 * 100 is not exact in a double.

const ok = (paise: number) => ({ kind: "ok", paise });
const master = (...names: string[]): Map<string, BalanceCompany> => new Map(names.map((n, i) => [nameKey(n), { id: `id-${i + 1}`, companyName: n }]));
const row = (rowNo: number, name: string, debit = "", credit = "") => ({ rowNo, name, debit, credit });

describe("parseMoney — exact", () => {
  it("reads the reported amount exactly", () => {
    expect(parseMoney("311855013.28")).toEqual(ok(31_185_501_328));
    expect(parseMoney("31,18,55,013.28")).toEqual(ok(31_185_501_328));
    expect(parseMoney("-311855013.28")).toEqual(ok(-31_185_501_328));
  });

  it("reads ₹10 crore and above, up to the column's limit, to the paisa", () => {
    expect(parseMoney("100000000")).toEqual(ok(10_000_000_000)); // ₹10 crore
    expect(parseMoney("100000000.01")).toEqual(ok(10_000_000_001));
    expect(parseMoney("4567890123.45")).toEqual(ok(456_789_012_345));
    expect(parseMoney("999999999999.99")).toEqual(ok(99_999_999_999_999)); // the largest numeric(14,2) value
    expect(parseMoney("-999999999999.99")).toEqual(ok(-99_999_999_999_999));
  });

  it("every two-decimal value in a sweep of large amounts is exact (no float drift)", () => {
    for (let r = 123_456_789n; r < 123_456_789n + 50n; r++) {
      for (const p of [1n, 7n, 28n, 29n, 57n, 99n]) {
        const text = `${r}.${String(p).padStart(2, "0")}`;
        expect(parseMoney(text)).toEqual(ok(Number(r * 100n + p)));
      }
    }
  });

  it("valid two-decimal, one-decimal and whole amounts; trailing zeros past the second decimal are exact", () => {
    expect(parseMoney("0.01")).toEqual(ok(1));
    expect(parseMoney("1,06,279.20")).toEqual(ok(10_627_920));
    expect(parseMoney("1.5")).toEqual(ok(150));
    expect(parseMoney("56202")).toEqual(ok(5_620_200));
    expect(parseMoney("1.230")).toEqual(ok(123));
    expect(parseMoney("007.10")).toEqual(ok(710));
    expect(parseMoney("-0")).toEqual(ok(0));
    expect(parseMoney("-0.00")).toEqual(ok(0));
  });

  it("refuses genuinely finer precision — nothing is rounded", () => {
    for (const s of ["1.005", "0.001", "311855013.281", "1234.5600000000002", "-0.009"]) {
      expect(parseMoney(s)).toMatchObject({ kind: "error", reason: expect.stringMatching(/more than two decimal places/) });
    }
  });

  it("range boundary: 12 integer digits accepted, 13 refused (leading zeros don't count)", () => {
    expect(parseMoney("999999999999").kind).toBe("ok");
    expect(parseMoney("000999999999999.99").kind).toBe("ok");
    for (const s of ["1000000000000", "1000000000000.00", "-1000000000000", "99999999999999"]) {
      expect(parseMoney(s)).toMatchObject({ kind: "error", reason: expect.stringMatching(/too large/) });
    }
  });

  it("refuses malformed text", () => {
    for (const s of ["abc", "12 Dr", "(500)", "1e9", "1E9", "+5", ".5", "5.", "1.2.3", "₹100", "1 000", "--5", "0x10", "Infinity", "NaN"]) {
      expect(parseMoney(s)).toMatchObject({ kind: "error" });
    }
    expect(parseMoney("   ")).toEqual({ kind: "blank" });
  });
});

describe("Grand Total verification with large amounts", () => {
  it("a file whose rows and Grand Total are in the tens of crores verifies and is importable", () => {
    const rows = [row(1, "Alpha", "311855013.28"), row(2, "Beta", "100000000.00", "2500.75")];
    const plan = buildBalancePlan(rows, master("Alpha", "Beta"), { debit: "411855013.28", credit: "2500.75" });
    expect(plan.summary.verification).toMatchObject({ status: "ok", differencePaise: { debit: 0, credit: 0 } });
    expect(plan.toWrite).toHaveLength(2);
  });

  it("a one-paisa difference on a large Grand Total is still measured exactly", () => {
    const rows = [row(1, "Alpha", "311855013.28"), row(2, "Beta", "100000000.00")];
    const v = buildBalancePlan(rows, master("Alpha", "Beta"), { debit: "411855013.29", credit: "" }).summary.verification;
    expect(v.differencePaise?.debit).toBe(1); // Grand Total − rows: exactly one paisa, inside the rounding allowance
    expect(v.status).toBe("ok");
  });

  it("a Grand Total with finer precision is unreadable (blocks the import), never rounded", () => {
    const v = buildBalancePlan([row(1, "Alpha", "1.00")], master("Alpha"), { debit: "1.005", credit: "" }).summary.verification;
    expect(v.status).toBe("unreadable");
  });
});
