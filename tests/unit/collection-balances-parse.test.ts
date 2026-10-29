import { describe, expect, it } from "vitest";
import { parseBalanceRows, parseTallyDate } from "@/lib/collections/balances/workbook";

// The Tally "Sundry Debtors / Group Outstandings" summary: heading lines, a
// "Particulars" row, "Debit" / "Credit" headings, one row per customer, then a
// Grand Total. Rows below copy the layout of the real export (company names here are made up).
const sheet = (): unknown[][] => [
  ["JMT DRIVE SOLUTIONS  (from 1-Apr-26)", null, null],
  ["SHOP NO.2, SOMEWHERE", null, null],
  ["Sundry Debtors", null, null],
  ["Group Outstandings", null, null],
  ["1-Apr-26 to 19-Oct-26", null, null],
  ["", "Sundry Debtors", null],
  ["Particulars", "1-Apr-26 to 19-Oct-26", null],
  ["", "Pending Bills", null],
  ["", "Debit", "Credit"],
  ["ALPHA TRADERS", 56202, null],
  ["BETA ENGINEERING", null, 12060],
  ["GAMMA WORKS", 606635, 19426],
  [null, null, null],
  ["Grand Total", 662837, 31486],
];

describe("parseBalanceRows", () => {
  it("reads company, Debit and Credit and the reporting period", () => {
    const r = parseBalanceRows(sheet(), "Sundry Debtors");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheet.periodFrom).toBe("2026-04-01");
    expect(r.sheet.periodTo).toBe("2026-10-19");
    expect(r.sheet.reportTitle).toBe("JMT DRIVE SOLUTIONS (from 1-Apr-26)");
    expect(r.sheet.rows).toEqual([
      { rowNo: 10, name: "ALPHA TRADERS", debit: "56202", credit: "" },
      { rowNo: 11, name: "BETA ENGINEERING", debit: "", credit: "12060" },
      { rowNo: 12, name: "GAMMA WORKS", debit: "606635", credit: "19426" },
    ]);
  });

  it("never returns the Grand Total as a company; it is kept only as the source total", () => {
    const r = parseBalanceRows(sheet(), "S");
    if (!r.ok) throw new Error("expected ok");
    expect(r.sheet.rows.map((x) => x.name)).not.toContain("Grand Total");
    expect(r.sheet.sourceTotal).toEqual({ debit: "662837", credit: "31486" });
    expect(r.sheet.skipped).toEqual({ blank: 1, totals: 1 });
  });

  it("skips blank rows and headings, and a bare 'Total' row is not trusted as the source total", () => {
    const rows = sheet();
    rows.splice(12, 0, ["Total", 1, 1]);
    const r = parseBalanceRows(rows, "S");
    if (!r.ok) throw new Error("expected ok");
    expect(r.sheet.rows).toHaveLength(3);
    expect(r.sheet.sourceTotal).toEqual({ debit: "662837", credit: "31486" });
  });

  it("works without a period line or a Grand Total", () => {
    const r = parseBalanceRows([["Particulars", null, null], ["", "Debit", "Credit"], ["ALPHA", 5, null]], "S");
    if (!r.ok) throw new Error("expected ok");
    expect(r.sheet.periodFrom).toBeNull();
    expect(r.sheet.periodTo).toBeNull();
    expect(r.sheet.sourceTotal).toBeNull();
  });

  it("keeps cell text exactly (negatives, text) for the server to validate", () => {
    const r = parseBalanceRows([["Particulars", null, null], ["", "Debit", "Credit"], ["ALPHA", -500, "abc"]], "S");
    if (!r.ok) throw new Error("expected ok");
    expect(r.sheet.rows[0]).toMatchObject({ debit: "-500", credit: "abc" });
  });

  it("refuses a sheet that isn't the Tally summary instead of guessing", () => {
    expect(parseBalanceRows([["Name", "Amount"], ["A", 1]], "S")).toMatchObject({ ok: false, error: expect.stringMatching(/Particulars/) });
    expect(parseBalanceRows([["Particulars", null], ["A", 1]], "S")).toMatchObject({ ok: false, error: expect.stringMatching(/Debit.*Credit/) });
    expect(parseBalanceRows([["Particulars", null, null], ["", "Debit", "Credit"], ["Grand Total", 1, 1]], "S")).toMatchObject({ ok: false });
  });
});

describe("parseTallyDate", () => {
  it("reads d-Mon-yy and rejects impossible dates", () => {
    expect(parseTallyDate("19-Oct-26")).toBe("2026-10-19");
    expect(parseTallyDate("1-Apr-2026")).toBe("2026-04-01");
    expect(parseTallyDate("31-Feb-26")).toBeNull();
    expect(parseTallyDate("nonsense")).toBeNull();
  });
});
