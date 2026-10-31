import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { TALLY_CATEGORIES, TALLY_CATEGORY_KEYS, type TallyCategoryKey } from "@/lib/tally/categories";
import { financialYear, parseTallyAmount, parseTallyDateValue } from "@/lib/tally/values";
import { checkMapping, findHeaderRow, mappingIsUsable, mappingToHeadings, suggestMapping } from "@/lib/tally/mapping";
import { chunkRows, documentIdentity, planRows, summarize, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { importDecisions, resolveRows, type RecordResolution } from "@/lib/tally/resolve";
import { checkTallyFile, decodeCsv, readTallyBytes } from "@/lib/tally/workbook";

// The pure rules of Tally import. All data is invented.
const today = "2026-10-31";
const rows = (...r: string[][]): RawRow[] => r.map((cells, i) => ({ rowNo: i + 2, cells }));
const none = (over: Partial<RecordResolution> = {}): RecordResolution => ({ existing: "none", existingBatchId: null, partyId: "p", refId: null, collectionCompanyId: null, attention: [], invalid: null, note: null, ...over });

const SALES = { documentNo: 0, documentDate: 1, partyName: 2, amount: 3 };
const LINES = { ...SALES, itemName: 4, quantity: 5, lineAmount: 6 };

describe("values", () => {
  it("reads Tally's dates, day first, and refuses impossible ones", () => {
    expect(parseTallyDateValue("1-Apr-26")).toBe("2026-04-01");
    expect(parseTallyDateValue("01-04-2026")).toBe("2026-04-01");
    expect(parseTallyDateValue("31/03/2025")).toBe("2025-03-31");
    expect(parseTallyDateValue("2026-04-01")).toBe("2026-04-01");
    expect(parseTallyDateValue("46113")).toBe("2026-04-01"); // Excel serial
    for (const bad of ["31-Feb-26", "32/01/2026", "soon", "", "12345"]) expect(parseTallyDateValue(bad), bad).toBeNull();
  });

  it("reads exact paise from Indian grouping, currency, Dr/Cr and brackets; never rounds real precision", () => {
    expect(parseTallyAmount("1,23,456.78")).toEqual({ paise: 12345678, side: null });
    expect(parseTallyAmount("₹ 100")).toEqual({ paise: 10000, side: null });
    expect(parseTallyAmount("500.50 Dr")).toEqual({ paise: 50050, side: "dr" });
    expect(parseTallyAmount("(250.00) Cr")).toEqual({ paise: -25000, side: "cr" });
    expect(parseTallyAmount("-10")!.paise).toBe(-1000);
    expect(parseTallyAmount("0.1000000000001")!.paise).toBe(10); // spreadsheet noise
    for (const bad of ["12.345", "abc", "1.2.3", ""]) expect(parseTallyAmount(bad), bad).toBeNull();
  });

  it("financial years run April to March", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
    expect(financialYear("2099-04-01")).toBe("2099-00");
  });
});

describe("column mapping", () => {
  const headers = ["Date", "Particulars", "Voucher No.", "Gross Total", "GSTIN/UIN"];
  const sample = [["1-Apr-26", "Alpha Traders", "S/1", "1,180.00", "27ABCDE1234F1Z5"]];

  it("every category has a required field, and suggestions cover its required fields from typical Tally headings", () => {
    for (const c of TALLY_CATEGORY_KEYS) expect(TALLY_CATEGORIES[c].fields.some((f) => f.required), c).toBe(true);
    const m = suggestMapping("sales-invoices", headers, sample);
    expect(m).toMatchObject({ documentDate: 0, partyName: 1, documentNo: 2, amount: 3, gstin: 4 });
    expect(mappingIsUsable(checkMapping("sales-invoices", m, headers, sample))).toBe(true);
  });

  it("never suggests a column whose data doesn't fit, whatever its heading says", () => {
    const m = suggestMapping("sales-invoices", ["Date", "Amount"], [["not a date", "nope"], ["still not", "no"]]);
    expect(m.documentDate).toBeUndefined();
    expect(m.amount).toBeUndefined();
  });

  it("a saved mapping wins and survives reordered columns, and only as headings", () => {
    const saved = mappingToHeadings({ amount: 3, documentNo: 2 }, headers);
    expect(saved).toEqual({ amount: "Gross Total", documentNo: "Voucher No." });
    const moved = ["Gross Total", "Voucher No.", "Date", "Particulars"];
    expect(suggestMapping("sales-invoices", moved, [["10", "S/1", "1-Apr-26", "A"]], saved)).toMatchObject({ amount: 0, documentNo: 1 });
  });

  it("reports missing required fields, a column used twice, and an incompatible column", () => {
    const p = checkMapping("sales-invoices", { documentNo: 2, amount: 1, documentDate: 1, partyName: 1 }, headers, sample);
    expect(p.duplicated).toEqual(["Particulars"]);
    expect(p.incompatible.map((i) => i.field.key).sort()).toEqual(["amount", "documentDate"]);
    expect(checkMapping("sales-invoices", {}, headers, sample).missingRequired.map((f) => f.key).sort()).toEqual(["amount", "documentDate", "documentNo", "partyName"]);
  });

  it("finds the heading row under Tally's title block", () => {
    expect(findHeaderRow("sales-invoices", [["JMT Drive"], ["Sales Register"], ["1-Apr-26 to 31-Mar-27"], [], headers, sample[0]!])).toBe(4);
  });
});

describe("planning — every voucher category", () => {
  const docCategories = TALLY_CATEGORY_KEYS.filter((c) => TALLY_CATEGORIES[c].kind === "document");
  it.each(docCategories)("%s: a clean row is valid, with its financial year and original number kept", (c) => {
    const plan = planRows(c, rows(["V-1", "15-Apr-25", "Alpha", "1,000.00"]), SALES, { today });
    expect(plan.rows[0]).toMatchObject({ state: "valid", messages: [] });
    expect(plan.records[0]).toMatchObject({ kind: "document", documentType: c, documentNo: "V-1", documentDate: "2025-04-15", financialYear: "2025-26", totalPaise: 100000 });
  });

  it.each(docCategories)("%s: required fields, dates and amounts each refuse with the reason", (c) => {
    const plan = planRows(c, rows(["", "bad", "", "x"], ["V-2", "1-Apr-25", "A", "0"], ["V-3", "1-Apr-1990", "A", "5"]), SALES, { today });
    expect(plan.rows.map((r) => r.state)).toEqual(["invalid", "invalid", "invalid"]);
    expect(plan.rows[0]!.messages.join(" ")).toMatch(/document number is missing.*party is missing.*Date "bad".*Total "x"/);
    expect(plan.rows[1]!.messages).toEqual(["The total is zero."]);
    expect(plan.rows[2]!.messages[0]).toMatch(/too old/);
    expect(plan.records).toEqual([]);
  });

  it("the same number in two financial years is two documents; a repeat in one year is a duplicate", () => {
    const plan = planRows("sales-invoices", rows(["1", "1-Mar-25", "A", "10"], ["1", "1-Apr-25", "A", "10"], ["1", "1-Apr-25", "A", "10"]), SALES, { today });
    expect(plan.records).toHaveLength(2);
    expect(plan.rows.map((r) => r.state)).toEqual(["valid", "valid", "duplicate"]);
    expect(plan.rows[2]!.messages[0]).toBe("Repeats row 3 of this file.");
  });

  it("the same number with different details is refused, never merged; name or amount alone is no identity", () => {
    const plan = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "10"], ["1", "1-Apr-25", "A", "20"]), SALES, { today });
    expect(plan.rows[1]!.state).toBe("invalid");
    const twin = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "10"], ["2", "1-Apr-25", "A", "10"]), SALES, { today });
    expect(twin.records).toHaveLength(2);
  });

  it("a supplier's bill number is only unique to that supplier", () => {
    expect(documentIdentity("purchase-invoices", "2025-26", "101", "alpha")).not.toBe(documentIdentity("purchase-invoices", "2025-26", "101", "beta"));
    const plan = planRows("purchase-invoices", rows(["101", "1-Apr-25", "Alpha", "10"], ["101", "1-Apr-25", "Beta", "99"]), SALES, { today });
    expect(plan.records).toHaveLength(2);
  });

  it("rows with different items are lines of one document; products, quantities and amounts are kept", () => {
    const plan = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "300", "Motor", "2", "100"], ["1", "1-Apr-25", "A", "300", "Gearbox", "1", "200"]), LINES, { today });
    expect(plan.records).toHaveLength(1);
    const d = plan.records[0] as DocumentRecord;
    expect(d.totalPaise).toBe(30000);
    expect(d.lines.map((l) => [l.item, l.quantity, l.amountPaise])).toEqual([["Motor", 2, 10000], ["Gearbox", 1, 20000]]);
  });

  it("flags inconsistent figures for attention rather than importing them quietly", () => {
    const m = { ...SALES, taxableValue: 4, taxAmount: 5, dueDate: 6 };
    const p = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "1000", "500", "10", "1-Mar-25"]), m, { today });
    expect(p.rows[0]!.state).toBe("attention");
    expect(p.rows[0]!.messages.join(" ")).toMatch(/doesn't equal the total.*due date is before/);
    expect(planRows("sales-invoices", rows(["1", "1-Jan-27", "A", "10"]), SALES, { today }).rows[0]!.messages[0]).toMatch(/future/);
    expect(planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "1000", "Motor", "1", "5000"]), LINES, { today }).rows[0]!.state).toBe("attention");
  });

  it("ignores Tally's total lines and blank rows instead of importing them", () => {
    const plan = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "10"], ["", "", "", ""], ["", "", "Grand Total", "10"]), SALES, { today });
    expect(plan.rows).toHaveLength(1);
  });
});

describe("planning — masters", () => {
  it.each(["customer-master", "vendor-master"] as TallyCategoryKey[])("%s: spelling variants are one party; a clashing GSTIN is refused", (c) => {
    const m = { name: 0, gstin: 1 };
    const plan = planRows(c, rows(["ABC Engg. Pvt Ltd", "27ABCDE1234F1Z5"], ["abc engg pvt ltd", "27ABCDE1234F1Z5"], ["ABC ENGG PVT LTD", "29ZZZZZ9999Z9Z9"], ["", ""]), m, { today });
    expect(plan.records).toHaveLength(1);
    expect(plan.rows.map((r) => r.state)).toEqual(["valid", "duplicate", "invalid"]);
  });
  it("a malformed GSTIN needs attention", () => {
    expect(planRows("customer-master", rows(["A", "NOPE"]), { name: 0, gstin: 1 }, { today }).rows[0]!.state).toBe("attention");
  });
});

describe("planning — outstanding", () => {
  const m = { partyName: 0, billRef: 1, pendingAmount: 2 };
  const opts = { today, asOfDate: "2026-09-30", direction: "receivable" as const };
  it("keeps the as-of date and direction, and needs both", () => {
    expect(planRows("outstanding-balances", rows(["A", "B1", "100"]), m, opts).records[0]).toMatchObject({ kind: "outstanding", asOfDate: "2026-09-30", direction: "receivable", pendingPaise: 10000 });
    expect(planRows("outstanding-balances", rows(["A", "B1", "100"]), m, { today }).rows[0]!.state).toBe("invalid");
  });
  it("a credit balance stays negative and is flagged; a repeated bill is a duplicate; a clash is refused", () => {
    const p = planRows("outstanding-balances", rows(["A", "B1", "100 Cr"], ["A", "B2", "5"], ["A", "B2", "5"], ["A", "B2", "6"]), m, opts);
    expect((p.records[0] as { pendingPaise: number }).pendingPaise).toBe(-10000);
    expect(p.rows.map((r) => r.state)).toEqual(["attention", "valid", "duplicate", "invalid"]);
  });
  it("several unreferenced lines for one party are not mistaken for duplicates", () => {
    expect(planRows("outstanding-balances", rows(["A", "", "5"], ["A", "", "5"]), m, opts).records).toHaveLength(2);
  });
});

describe("resolving against the database", () => {
  const plan = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "10"]), SALES, { today });
  const key = plan.records[0]!.key;

  it("existing identical records are duplicates; a changed one is invalid and never overwritten", () => {
    expect(resolveRows(plan, new Map([[key, none({ existing: "same", note: "Already imported; skipped." })]]))[0]).toMatchObject({ state: "duplicate" });
    const conflict = new Map([[key, none({ existing: "conflict", invalid: "Already imported with different details." })]]);
    expect(resolveRows(plan, conflict)[0]).toMatchObject({ state: "invalid" });
    expect(importDecisions(plan, conflict, true, "b").records.get(key)).toBe("skip");
  });

  it("attention rows import only with the opt-in, and a document is all-or-nothing", () => {
    const multi = planRows("sales-invoices", rows(["1", "1-Apr-25", "A", "300", "Motor", "2", "100"], ["1", "1-Apr-25", "A", "300", "Gear", "1", "200"]), LINES, { today });
    const res = new Map([[multi.records[0]!.key, none({ attention: ["Party isn't in the Customer Master."] })]]);
    const held = importDecisions(multi, res, false, "b");
    expect(held.records.get(multi.records[0]!.key)).toBe("skip");
    expect(held.rows.every((r) => r.status === "skipped")).toBe(true);
    const taken = importDecisions(multi, res, true, "b");
    expect(taken.records.get(multi.records[0]!.key)).toBe("insert");
    expect(taken.rows.every((r) => r.status === "imported")).toBe(true);
  });

  it("invalid rows are recorded as rejected with their reason, never dropped", () => {
    const p = planRows("sales-invoices", rows(["", "1-Apr-25", "A", "10"]), SALES, { today });
    expect(importDecisions(p, new Map(), true, "b").rows).toEqual([{ rowNo: 2, status: "rejected", reason: "The document number is missing.", recordKey: null }]);
  });

  it("a record created by this same batch is a retry, not a duplicate", () => {
    const d = importDecisions(plan, new Map([[key, none({ existing: "same", existingBatchId: "b" })]]), false, "b");
    expect(d.rows[0]!.status).toBe("imported");
  });

  it("summary counts each state; ready follows the opt-in", () => {
    const s = [{ state: "valid" }, { state: "attention" }, { state: "duplicate" }, { state: "invalid" }] as const;
    expect(summarize(s, false)).toEqual({ total: 4, valid: 1, invalid: 1, duplicate: 1, attention: 1, ready: 1 });
    expect(summarize(s, true).ready).toBe(2);
  });
});

describe("chunking", () => {
  it("never splits a document across calls, and respects the row limit", () => {
    const r = rows(...Array.from({ length: 10 }, (_, i) => [String(Math.floor(i / 3)), "1-Apr-25", "A", "300", `Item ${i}`, "1", "100"]));
    const plan = planRows("sales-invoices", r, LINES, { today });
    const chunks = chunkRows(r, plan.rows, 4);
    expect(chunks.flat()).toHaveLength(10);
    for (const c of chunks) expect(new Set(c.map((x) => x.cells[0])).size).toBeLessThanOrEqual(2);
    for (const doc of ["0", "1", "2", "3"]) expect(chunks.filter((c) => c.some((x) => x.cells[0] === doc))).toHaveLength(1);
  });
});

describe("reading files", () => {
  const sheet = [["Sales Register"], [], ["Voucher No.", "Date", "Party", "Amount"], ["S/1", "1-Apr-25", "Alpha", 1180]];
  const xlsxBytes = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Register");
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  };

  it("reads real .xlsx bytes as text cells", () => {
    const res = readTallyBytes("sales.xlsx", xlsxBytes());
    expect(res).toMatchObject({ ok: true, sheet: "Register" });
    if (res.ok) expect(res.grid[3]).toEqual(["S/1", "1-Apr-25", "Alpha", "1180"]);
  });

  it("reads CSV, including UTF-16 and BOM exports, with quoted commas intact", () => {
    const res = readTallyBytes("a.csv", new TextEncoder().encode('Voucher No.,Party\nS/1,"Alpha, Traders"\n'));
    expect(res.ok && res.grid[1]).toEqual(["S/1", "Alpha, Traders"]);
    const utf16 = new Uint8Array([0xff, 0xfe, ...[..."Hi"].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeCsv(utf16)).toBe("Hi");
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
  });

  it("refuses wrong types, oversized and empty files, and a fake workbook", () => {
    for (const n of ["a.xls", "a.xlsm", "a.pdf", "a.exe"]) expect(checkTallyFile(n, 10), n).toMatch(/\.xlsx/);
    expect(checkTallyFile("a.csv", 16 * 1024 * 1024)).toMatch(/larger than 15 MB/);
    expect(checkTallyFile("a.csv", 0)).toMatch(/empty/);
    expect(readTallyBytes("a.xlsx", new TextEncoder().encode("not a workbook"))).toEqual({ ok: false, error: expect.stringMatching(/isn't a valid/) });
    expect(readTallyBytes("a.xlsx", new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toEqual({ ok: false, error: expect.stringMatching(/could not be read|No sheet/) });
    expect(readTallyBytes("a.csv", new TextEncoder().encode(" \n "))).toEqual({ ok: false, error: expect.stringMatching(/No sheet/) });
  });
});
