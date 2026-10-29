import { describe, expect, it } from "vitest";
import { buildBalancePlan, parseMoney, totalsTolerancePaise, type BalanceCompany } from "@/lib/collections/balances/plan";
import { nameKey } from "@/lib/collections/master/normalize";

const master = (...names: string[]): Map<string, BalanceCompany> => new Map(names.map((n, i) => [nameKey(n), { id: `id-${i + 1}`, companyName: n }]));
const row = (rowNo: number, name: string, debit = "", credit = "") => ({ rowNo, name, debit, credit });
const byRow = (p: ReturnType<typeof buildBalancePlan>, n: number) => p.rows.find((r) => r.rowNo === n)!;

describe("parseMoney", () => {
  it("parses plain numbers, commas and negatives exactly; blank is blank", () => {
    expect(parseMoney("56202")).toEqual({ kind: "ok", paise: 5_620_200 });
    expect(parseMoney("1,06,279.20")).toEqual({ kind: "ok", paise: 10_627_920 });
    expect(parseMoney("-500")).toEqual({ kind: "ok", paise: -50_000 });
    expect(parseMoney("0")).toEqual({ kind: "ok", paise: 0 });
    expect(parseMoney("  ")).toEqual({ kind: "blank" });
  });
  it("rejects text, extra decimals and absurd sizes — nothing is rounded or re-signed", () => {
    expect(parseMoney("abc").kind).toBe("error");
    expect(parseMoney("12 Dr").kind).toBe("error");
    expect(parseMoney("(500)").kind).toBe("error");
    expect(parseMoney("1.005").kind).toBe("error");
    expect(parseMoney("1e9").kind).toBe("error");
    expect(parseMoney("99999999999999").kind).toBe("error");
  });
});

describe("buildBalancePlan", () => {
  it("matches existing companies case/punctuation-insensitively; unmatched are skipped, never created", () => {
    const p = buildBalancePlan([row(1, "alpha traders pvt. ltd", "100"), row(2, "Unknown Co", "50")], master("Alpha Traders Pvt Ltd"), null);
    expect(byRow(p, 1)).toMatchObject({ status: "matched", companyId: "id-1", companyName: "Alpha Traders Pvt Ltd", debit: 100, credit: null });
    expect(byRow(p, 2)).toMatchObject({ status: "unmatched", companyId: null });
    expect(p.toWrite.map((r) => r.rowNo)).toEqual([1]);
    expect(p.summary).toMatchObject({ matched: 1, unmatched: 1, rejected: 0 });
  });

  it("rejects non-numeric values and rows with both cells blank", () => {
    const p = buildBalancePlan([row(1, "A", "x"), row(2, "A2"), row(3, "A3", "", "5")], master("A", "A2", "A3"), null);
    expect(byRow(p, 1).status).toBe("rejected");
    expect(byRow(p, 1).messages[0]!.text).toMatch(/Debit: .*not a number/);
    expect(byRow(p, 2)).toMatchObject({ status: "rejected" });
    expect(byRow(p, 2).messages[0]!.text).toMatch(/Both Debit and Credit are blank/);
    expect(byRow(p, 3).status).toBe("matched");
    expect(p.summary.rejected).toBe(2);
  });

  it("keeps negatives as written and flags them", () => {
    const p = buildBalancePlan([row(1, "A", "-250.50", "10")], master("A"), null);
    expect(byRow(p, 1)).toMatchObject({ status: "matched", debit: -250.5, credit: 10, negative: true });
    expect(byRow(p, 1).messages.some((m) => m.level === "warning" && /Negative/.test(m.text))).toBe(true);
    expect(p.summary.negatives).toBe(1);
    expect(p.summary.totals.imported).toEqual({ debit: -250.5, credit: 10 });
  });

  it("identical duplicates: first counts once, repeat is flagged and ignored (never double-counted)", () => {
    const p = buildBalancePlan([row(1, "A", "100", "5"), row(2, "a", "100", "5")], master("A"), null);
    expect(byRow(p, 1).status).toBe("matched");
    expect(byRow(p, 2).status).toBe("duplicate");
    expect(p.toWrite).toHaveLength(1);
    expect(p.summary.totals.imported).toEqual({ debit: 100, credit: 5 });
    expect(p.summary.totals.ignoredDuplicates).toEqual({ debit: 100, credit: 5 });
    expect(p.summary.duplicates).toBe(1);
  });

  it("conflicting duplicates: every row of that company is rejected from the import", () => {
    const p = buildBalancePlan([row(1, "A", "100"), row(2, "A", "200"), row(3, "B", "7")], master("A", "B"), null);
    expect(byRow(p, 1).status).toBe("conflict");
    expect(byRow(p, 2).status).toBe("conflict");
    expect(p.toWrite.map((r) => r.rowNo)).toEqual([3]);
    expect(p.summary.conflicts).toBe(2);
    expect(p.summary.totals.conflicting).toEqual({ debit: 300, credit: 0 });
  });

  it("reports source totals against the rows and the imported amounts", () => {
    const rows = [row(1, "A", "100"), row(2, "B", "", "40.25"), row(3, "Ghost", "10")];
    const p = buildBalancePlan(rows, master("A", "B"), { debit: "110", credit: "40.25" });
    expect(p.summary.totals.source).toEqual({ debit: 110, credit: 40.25 });
    expect(p.summary.totals.sheetRows).toEqual({ debit: 110, credit: 40.25 });
    expect(p.summary.totals.imported).toEqual({ debit: 100, credit: 40.25 });
    expect(p.summary.totals.unmatched).toEqual({ debit: 10, credit: 0 });
    expect(p.summary.totals.difference).toEqual({ debit: 0, credit: 0 });
    expect(p.summary.fingerprint).toEqual({ matched: 2, debitPaise: 10_000, creditPaise: 4_025 });
  });

  it("surfaces a mismatch between the rows and the file's own Grand Total", () => {
    const p = buildBalancePlan([row(1, "A", "100")], master("A"), { debit: "150", credit: "0" });
    expect(p.summary.totals.difference).toEqual({ debit: 50, credit: 0 });
  });

  it("no source total, or an unreadable one, gives no comparison", () => {
    expect(buildBalancePlan([row(1, "A", "1")], master("A"), null).summary.totals).toMatchObject({ source: null, difference: null });
    expect(buildBalancePlan([row(1, "A", "1")], master("A"), { debit: "n/a", credit: "" }).summary.totals.source).toBeNull();
  });

  it("sums exactly in paise (no floating-point drift)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, `C${i}`, "0.10"));
    const p = buildBalancePlan(rows, master(...rows.map((r) => r.name)), null);
    expect(p.summary.totals.imported.debit).toBe(1);
    expect(p.summary.fingerprint.debitPaise).toBe(100);
  });

  it("rejects a blank name and a name with no letters or digits", () => {
    const p = buildBalancePlan([row(1, "", "5"), row(2, "---", "5")], master("A"), null);
    expect(p.rows.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});

describe("totals verification (rows vs the file's own Grand Total)", () => {
  const rows = [row(1, "A", "100.10", "0.05"), row(2, "B", "200", "")];
  const verify = (total: { debit: string; credit: string } | null, input = rows) => buildBalancePlan(input, master("A", "B"), total).summary.verification;

  it("ok when the rows add up exactly", () => {
    expect(verify({ debit: "300.10", credit: "0.05" })).toMatchObject({ status: "ok", message: null });
  });

  it("a blank Grand Total cell counts as zero (a column with nothing in it)", () => {
    expect(verify({ debit: "300.10", credit: "" }, [row(1, "A", "300.10")])).toMatchObject({ status: "ok" });
  });

  it("is blocked, with a reason, when there is no Grand Total", () => {
    expect(verify(null)).toMatchObject({ status: "missing", differencePaise: null });
    expect(verify(null).message).toMatch(/no Grand Total/);
  });

  it("is blocked when the Grand Total isn't a number", () => {
    expect(verify({ debit: "n/a", credit: "0.05" })).toMatchObject({ status: "unreadable" });
  });

  it("is blocked when the rows are off by more than the rounding gap, in either column, and says by how much", () => {
    const d = verify({ debit: "310.10", credit: "0.05" });
    expect(d).toMatchObject({ status: "mismatch", differencePaise: { debit: 1000, credit: 0 } });
    expect(d.message).toMatch(/Debit off by ₹10\.00/);
    expect(verify({ debit: "300.10", credit: "5.05" })).toMatchObject({ status: "mismatch" });
  });

  it("an invalid row is left out of the sum, so it can't be silently dropped", () => {
    const withBad = [row(1, "A", "100"), row(2, "B", "abc")];
    expect(verify({ debit: "100", credit: "0" }, withBad)).toMatchObject({ status: "ok" }); // 'abc' carried nothing readable
    expect(verify({ debit: "150", credit: "0" }, withBad)).toMatchObject({ status: "mismatch" });
  });

  it("tolerance is ceil((rows + 1) / 2) paise: tight for a few rows, ₹1.34 for 266, never enough to hide a customer", () => {
    expect(totalsTolerancePaise(1)).toBe(1);
    expect(totalsTolerancePaise(3)).toBe(2);
    expect(totalsTolerancePaise(266)).toBe(134);
    expect(verify({ debit: "300.11", credit: "0.05" })).toMatchObject({ status: "ok" }); // 1 paisa off, 2 rows → allowed gap 2
    expect(verify({ debit: "300.14", credit: "0.05" })).toMatchObject({ status: "mismatch" }); // 4 paise
  });
});
