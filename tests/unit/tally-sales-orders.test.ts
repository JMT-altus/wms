import { describe, expect, it } from "vitest";
import { checkMapping, findHeaderRow, mappingIsUsable, suggestMapping } from "@/lib/tally/mapping";
import { chunkRows, planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { importDecisions, resolveRows } from "@/lib/tally/resolve";
import { isSalesOrderType, salesOrderSignature, salesOrderViews, summarizeSalesOrders } from "@/lib/tally/sales-orders";
import { MatchCollector, NO_LINKS, buildSalesOrderMasters, findCustomer, findProduct, mergeMatches, resolveSalesOrder, type SalesOrderLinks } from "@/lib/tally/sales-order-match";
import { salesOrderErrorReport } from "@/lib/tally/error-report";
import { SO_TEMPLATE_EXAMPLE, SO_TEMPLATE_HEADINGS, salesOrderTemplateSheets } from "@/lib/tally/sales-order-template";
import { readTallyBytes, writeWorkbook } from "@/lib/tally/workbook";
import { SO_ORDER_FIELDS as SO_FIELDS } from "@/lib/tally/sales-order-catalogue";

// The pure rules of the Sales Order Excel import (TallyPrime's "Import data format"). All data is invented.
// Every column of the field catalogue is mapped; the row helpers fill every field the matrix marks Y with a valid
// value, so each test changes only what it is about.
const today = "2026-10-31";
const M: Record<string, number> = Object.fromEntries(SO_FIELDS.map((f, i) => [f.key, i]));
type Cells = Partial<Record<string, string>>;
const cells = (c: Cells): string[] => {
  const out = Array.from({ length: SO_FIELDS.length }, () => "");
  for (const [k, v] of Object.entries(c)) {
    if (M[k] === undefined) throw new Error(`unknown field ${k}`);
    out[M[k]!] = v ?? "";
  }
  return out;
};
/** The order-level Y fields, valid. An unregistered buyer, so no GSTIN is needed unless a test gives one. */
const VOUCHER = (party: string): Cells => ({
  narration: "Test order", costCentreClass: "Primary Cost Category", gstRegistration: "Test Registration",
  referenceNo: "PO-1", orderDate: "28-03-2026", paymentTerms: "30 days", otherReferences: "None", deliveryTerms: "Ex-works",
  dispatchedThrough: "Road", destination: "Pune", carrier: "Test Transport",
  buyerBillTo: party, buyerAddressType: "Primary", buyerMailingName: party, buyerAddress: "1 Test Road", buyerCountry: "India", buyerState: "Maharashtra", buyerRegType: "Unregistered/Consumer", buyerBillOfEntry: "No", buyerSec7: "No", placeOfSupply: "Maharashtra", buyerPincode: "411001",
  supplyType: "Goods", isOptional: "No", isPostDated: "No", isCancelled: "No", changeMode: "Item Invoice",
});
const ENTRY: Cells = { ledgerRate: "0", ledgerNarration: "Narration", ledgerDescription: "Description" };
/** A product line's Y fields beyond the core ones: GST and HSN/SAC from Tally's masters, one delivery date. */
const LINE = (amount: string): Cells => ({ ratePer: "Nos", itemDescription: "Standard", gstRateDetails: "As per Masters/Company", reverseCharge: "No", itcEligible: "No", taxableValue: amount, hsnDetails: "As per Masters/Company", dueDate: "30-04-2026" });
/** The first row of a voucher: its date, type, number and the customer's ledger line (Dr, the order total). */
const head = (no: string, party: string, total: string, over: Cells = {}) =>
  cells({ documentDate: "01-04-2026", voucherType: "Sales Order", documentNo: no, partyName: party, amount: total, drCr: "Dr", ...VOUCHER(party), ...ENTRY, ...(over.itemName ? LINE(over.lineAmount ?? "") : {}), ...over });
/** A product line on the sales ledger's row. */
const item = (name: string, qty: string, rate: string, amount: string, over: Cells = {}) => cells({ partyName: "Sales", amount, drCr: "Cr", ...ENTRY, itemName: name, quantity: qty, rate, ratePer: "Nos", lineAmount: amount, ...LINE(amount), ...over });
/** A product line on a row of its own, with no ledger. */
const more = (name: string, qty: string, rate: string, amount: string, over: Cells = {}) => cells({ itemName: name, quantity: qty, rate, ratePer: "Nos", lineAmount: amount, ...LINE(amount), ...over });
const ledger = (name: string, amount: string, side = "Cr") => cells({ partyName: name, amount, drCr: side, ...ENTRY });
const rows = (...r: string[][]): RawRow[] => r.map((c, i) => ({ rowNo: i + 2, cells: c }));
const plan = (...r: string[][]) => planRows("sales-orders", rows(...r), M, { today });
const states = (p: ReturnType<typeof plan>) => p.rows.map((r) => r.state);
const doc = (p: ReturnType<typeof plan>, i = 0) => p.records[i] as DocumentRecord;

describe("the file's shape", () => {
  it("1 · a single-product order: one voucher, one line", () => {
    const p = plan(head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", "10", "500", "5000"));
    expect(states(p)).toEqual(["valid", "valid"]);
    expect(p.records).toHaveLength(1);
    expect(doc(p)).toMatchObject({ documentType: "sales-orders", documentNo: "SO/1", documentDate: "2026-04-01", financialYear: "2026-27", partyName: "Alpha Traders", totalPaise: 500000, voucherType: "Sales Order", rowNos: [2, 3] });
    expect(doc(p).lines).toEqual([
      expect.objectContaining({ item: "Gear Motor", quantity: 10, ratePaise: 50000, amountPaise: 500000, uom: "Nos", description: "Standard", dueDate: "2026-04-30", rowNo: 3 }),
    ]);
    // The line's single allocation is the line itself (its blank allocation figures are the line's).
    expect(doc(p).lines[0]!.allocations).toEqual([{ trackingNo: null, orderNo: null, quantity: 10, ratePaise: 50000, ratePer: "Nos", amountPaise: 500000, dueDate: "2026-04-30", discPct: null, discountPaise: null, costTracking: null, rowNo: 3 }]);
    expect(doc(p).lines[0]).toMatchObject({ gst: { rateDetails: "As per Masters/Company", reverseCharge: false, itcEligible: false, taxablePaise: 500000 }, hsn: { details: "As per Masters/Company", code: null } });
  });

  it("2 · a multi-product order is ONE order with every line, and the tax ledger completes the total", () => {
    const p = plan(head("SO/2", "Alpha Traders", "11800", { referenceNo: "PO-77", narration: "Urgent" }), item("Gear Motor", "10", "400", "4000", { dueDate: "20-04-2026" }), more("Gearbox", "3", "2000", "6000", { dueDate: "15-04-2026", itemDescription: "With kit" }), ledger("Output IGST 18%", "1800"));
    expect(states(p)).toEqual(["valid", "valid", "valid", "valid"]);
    expect(p.records).toHaveLength(1);
    const d = doc(p);
    expect(d.lines.map((l) => [l.item, l.quantity, l.amountPaise, l.rowNo])).toEqual([["Gear Motor", 10, 400000, 3], ["Gearbox", 3, 600000, 4]]);
    expect(d).toMatchObject({ totalPaise: 1180000, taxablePaise: 1000000, referenceNo: "PO-77", narration: "Urgent", dueDate: "2026-04-15" });
    expect(d.lines[1]).toMatchObject({ description: "With kit", dueDate: "2026-04-15" });
    expect(d.ledgers).toEqual([expect.objectContaining({ name: "Output IGST 18%", signedPaise: 180000, rowNo: 5 })]);
  });

  it("a sales ledger on a row of its own, with its items listed beneath, is not counted twice", () => {
    const p = plan(head("SO/3", "Alpha Traders", "11800"), ledger("Sales", "10000"), more("Gear Motor", "10", "400", "4000"), more("Gearbox", "3", "2000", "6000"), ledger("Output IGST 18%", "1800"));
    expect(states(p)).toEqual(["valid", "valid", "valid", "valid", "valid"]);
    expect(doc(p).lines).toHaveLength(2);
  });

  it("a discount ledger (Dr) reduces the total, and a rupee of round-off is not an error", () => {
    const p = plan(head("SO/4", "Alpha Traders", "4900.40"), item("Gear Motor", "10", "500", "5000"), ledger("Trade Discount", "100", "Dr"));
    expect(states(p)).toEqual(["valid", "valid", "valid"]);
  });

  it("3 · 4 · several customers and several vouchers in one file stay separate orders", () => {
    const p = plan(head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", "10", "500", "5000"), head("SO/2", "Beta Corp", "2000"), item("Gearbox", "1", "2000", "2000"), head("SO/3", "Alpha Traders", "900"), item("Coupling", "3", "300", "900"));
    expect(states(p).every((s) => s === "valid")).toBe(true);
    expect(p.records.map((r) => [(r as DocumentRecord).documentNo, (r as DocumentRecord).partyName, (r as DocumentRecord).lines.length])).toEqual([["SO/1", "Alpha Traders", 1], ["SO/2", "Beta Corp", 1], ["SO/3", "Alpha Traders", 1]]);
  });

  it("5 · continuation rows: a blank voucher number, or the number repeated on every row, both belong to the order above", () => {
    const blankNumber = plan(head("SO/5", "Alpha Traders", "3000"), item("Gear Motor", "1", "1000", "1000"), more("Gearbox", "1", "2000", "2000"));
    expect(blankNumber.records).toHaveLength(1);
    expect(doc(blankNumber).lines).toHaveLength(2);
    // "Flattened": every row repeats the voucher cells, the customer and the total, with one item each.
    const flat = (name: string, amount: string) => head("SO/5", "Alpha Traders", "3000", { itemName: name, quantity: "1", rate: amount, ratePer: "Nos", lineAmount: amount });
    const flattened = plan(flat("Gear Motor", "1000"), flat("Gearbox", "2000"));
    expect(states(flattened)).toEqual(["valid", "valid"]);
    expect(flattened.records).toHaveLength(1);
    expect(doc(flattened).lines.map((l) => l.item)).toEqual(["Gear Motor", "Gearbox"]);
  });

  it("the same number in two financial years is two orders, even on neighbouring rows", () => {
    const row = (date: string) => head("1", "Alpha Traders", "100", { documentDate: date, itemName: "Coupling", quantity: "1", rate: "100", lineAmount: "100" });
    const p = plan(row("31-03-2026"), row("01-04-2026"));
    expect(p.records.map((r) => (r as DocumentRecord).financialYear)).toEqual(["2025-26", "2026-27"]);
  });

  it("ignores blank rows and Tally's total lines", () => {
    const p = plan(head("SO/1", "Alpha Traders", "5000"), cells({}), item("Gear Motor", "10", "500", "5000"), cells({ partyName: "Grand Total", amount: "5000" }));
    expect(p.rows.map((r) => r.rowNo)).toEqual([2, 4]);
    expect(states(p)).toEqual(["valid", "valid"]);
  });
});

describe("what is refused, and why", () => {
  const held = (p: ReturnType<typeof plan>) => {
    expect(p.records).toEqual([]);
    expect(states(p).every((s) => s === "invalid")).toBe(true);
  };

  it("6 · a missing voucher number", () => {
    const p = plan(head("", "Alpha Traders", "5000"), item("Gear Motor", "10", "500", "5000"));
    held(p);
    expect(p.rows[0]!.messages).toEqual(["The voucher number is missing."]);
    expect(p.rows[1]!.messages).toEqual(["Not imported: row 2 of this order has an error."]);
  });

  it("7 · an invalid or impossible date, a date that is too old, and a missing one", () => {
    for (const [date, why] of [["31-02-2026", /Date "31-02-2026" can't be read/], ["soon", /can't be read/], ["01-04-1990", /too old/], ["", /date is missing/]] as const) {
      const p = plan(head("SO/1", "Alpha Traders", "5000", { documentDate: date }), item("Gear Motor", "10", "500", "5000"));
      held(p);
      expect(p.rows[0]!.messages.join(" "), date).toMatch(why);
    }
    const future = plan(head("SO/1", "Alpha Traders", "5000", { documentDate: "01-01-2027" }), item("Gear Motor", "10", "500", "5000", { dueDate: "15-01-2027" }));
    expect(future.rows[0]).toMatchObject({ state: "attention", messages: ["Date 2027-01-01 is in the future."] });
  });

  it("8 · a missing customer", () => {
    const p = plan(head("SO/1", "", "5000"), item("Gear Motor", "10", "500", "5000"));
    held(p);
    expect(p.rows[0]!.messages).toEqual(["The customer (ledger name) is missing."]);
  });

  it("9 · a missing stock item, and an order with no product line at all", () => {
    const p = plan(head("SO/1", "Alpha Traders", "5000"), item("", "10", "500", "5000"));
    held(p);
    expect(p.rows[1]!.messages).toEqual(["The item name is missing."]);
    expect(p.rows[0]!.messages).toEqual(["Not imported: row 3 of this order has an error."]);
    const none = plan(head("SO/2", "Alpha Traders", "5000"), ledger("Sales", "5000"));
    held(none);
    expect(none.rows[0]!.messages).toEqual(["This order has no product line."]);
  });

  it("10 · an invalid quantity: text, zero, negative or missing", () => {
    for (const [qty, why] of [["ten", /Quantity "ten" isn't a number/], ["0", /more than zero/], ["-2", /more than zero/], ["", /quantity is missing/]] as const) {
      const p = plan(head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", qty, "", "5000"));
      held(p);
      expect(p.rows[1]!.messages.join(" "), qty).toMatch(why);
    }
  });

  it("11 · an invalid rate: not an amount, more precision than paise, or negative", () => {
    for (const [rate, why] of [["cheap", /Rate "cheap" isn't a valid amount/], ["500.123", /isn't a valid amount/], ["-500", /can't be negative/]] as const) {
      const p = plan(head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", "10", rate, "5000"));
      held(p);
      expect(p.rows[1]!.messages.join(" "), rate).toMatch(why);
    }
    // Item Rate is marked Y in Tally's Sales Order matrix: a line without one is held back and says so.
    const noRate = plan(head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", "10", "", "5000"));
    held(noRate);
    expect(noRate.rows[1]!.messages).toContain("“Item Rate” is required.");
  });

  it("12 · a line amount that isn't quantity × rate", () => {
    const p = plan(head("SO/1", "Alpha Traders", "4000"), item("Gear Motor", "10", "500", "4000"));
    held(p);
    expect(p.rows[1]!.messages).toEqual(["Item amount ₹4,000.00 doesn't equal quantity × rate (₹5,000.00)."]);
    const missing = plan(head("SO/1", "Alpha Traders", "4000"), item("Gear Motor", "10", "500", ""));
    expect(missing.rows[1]!.messages.join(" ")).toMatch(/item amount is missing/);
  });

  it("13 · a voucher total that the lines and ledgers don't add up to, and a zero or unreadable total", () => {
    const p = plan(head("SO/1", "Alpha Traders", "6000"), item("Gear Motor", "10", "500", "5000"));
    held(p);
    expect(p.rows[0]!.messages).toEqual(["The product lines add up to ₹5,000.00, but the order total is ₹6,000.00."]);
    expect(p.rows[1]!.messages).toEqual(["Not imported: row 2 of this order has an error."]);
    const withTax = plan(head("SO/1", "Alpha Traders", "6000"), item("Gear Motor", "10", "500", "5000"), ledger("IGST", "900"));
    expect(withTax.rows[0]!.messages[0]).toBe("The product lines add up to ₹5,000.00 plus ₹900.00 of other ledgers, but the order total is ₹6,000.00.");
    expect(plan(head("SO/1", "Alpha Traders", "0"), item("Gear Motor", "1", "0", "0")).rows[0]!.messages).toContain("The order total is zero.");
    expect(plan(head("SO/1", "Alpha Traders", "lots"), item("Gear Motor", "1", "1", "1")).rows[0]!.messages.join(" ")).toMatch(/Ledger amount "lots" isn't a valid amount/);
  });

  it("a voucher that isn't a sales order, and a Dr/Cr cell that is neither", () => {
    expect(isSalesOrderType("Sales Order - Export")).toBe(true);
    const p = plan(head("S/1", "Alpha Traders", "5000", { voucherType: "Sales" }), item("Gear Motor", "10", "500", "5000"));
    held(p);
    expect(p.rows[0]!.messages).toEqual([`Voucher type "Sales" isn't a Sales Order.`]);
    expect(plan(head("SO/1", "Alpha Traders", "5000", { drCr: "Both" }), item("Gear Motor", "10", "500", "5000")).rows[0]!.messages).toEqual([`Dr/Cr "Both" isn't Dr or Cr.`]);
  });

  it("one bad line holds the whole order back, and leaves the other orders alone", () => {
    const p = plan(head("SO/1", "Alpha Traders", "3000"), item("Gear Motor", "1", "1000", "1000"), more("Gearbox", "x", "2000", "2000"), head("SO/2", "Beta Corp", "900"), item("Coupling", "3", "300", "900"));
    expect(states(p)).toEqual(["invalid", "invalid", "invalid", "valid", "valid"]);
    expect(p.rows[0]!.messages).toEqual(["Not imported: row 4 of this order has an error."]);
    expect(p.records.map((r) => (r as DocumentRecord).documentNo)).toEqual(["SO/2"]);
  });
});

describe("duplicates and conflicts inside one file", () => {
  const a = [head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", "10", "500", "5000")];
  const b = [head("SO/2", "Beta Corp", "900"), item("Coupling", "3", "300", "900")];

  it("14 · the same voucher again, saying the same thing, is a duplicate and adds nothing", () => {
    const p = plan(...a, ...b, ...a);
    expect(states(p)).toEqual(["valid", "valid", "valid", "valid", "duplicate", "duplicate"]);
    expect(p.rows[4]!.messages).toEqual(["Repeats row 2 of this file."]);
    expect(p.records).toHaveLength(2);
    expect(doc(p).lines).toHaveLength(1); // not merged into the first
  });

  it("16 · the same voucher number for a different customer is refused, never merged, and the first order is untouched", () => {
    const p = plan(...a, ...b, head("SO/1", "Beta Corp", "5000"), item("Gear Motor", "10", "500", "5000"));
    expect(states(p)).toEqual(["valid", "valid", "valid", "valid", "invalid", "invalid"]);
    expect(p.rows[4]!.messages).toEqual([`Same voucher number as row 2, but a different customer ("Beta Corp" vs "Alpha Traders"), so it can't be the same order.`]);
    expect(p.rows[5]!.messages).toEqual(["Not imported: row 6 of this order has an error."]);
    expect(doc(p)).toMatchObject({ documentNo: "SO/1", partyName: "Alpha Traders" });
    expect(doc(p).lines).toHaveLength(1);
  });

  it("the same number with a different date, total, voucher type or product lines is refused too", () => {
    const again = (over: Cells, line = item("Gear Motor", "10", "500", "5000")) => plan(...a, ...b, head("SO/1", "Alpha Traders", "5000", over), line);
    expect(again({ documentDate: "02-04-2026" }).rows[4]!.messages[0]).toMatch(/a different date \(2026-04-02 vs 2026-04-01\)/);
    expect(again({ amount: "7000" }).rows[4]!.messages[0]).toMatch(/a different order total \(₹7,000.00 vs ₹5,000.00\)/);
    expect(again({ voucherType: "Sales Order - Export" }).rows[4]!.messages[0]).toMatch(/a different voucher type/);
    const lines = again({}, item("Gearbox", "10", "500", "5000"));
    // The whole order is compared, and what differs is named.
    expect(lines.rows[4]!.state).toBe("invalid");
    expect(lines.rows[4]!.messages[0]).toBe(`Same voucher number as row 2, but different product lines, so it can't be the same order: Item "Gear Motor" ("present" → "blank"); Item "Gearbox" ("blank" → "present"). Keep one version of the order in the file.`);
    expect(lines.records).toHaveLength(2);
  });

  it("a second customer, date or total on a row INSIDE one voucher is refused", () => {
    const second = plan(head("SO/1", "Alpha Traders", "5000"), ledger("Beta Corp", "5000", "Dr"), item("Gear Motor", "10", "500", "5000"));
    expect(second.records).toEqual([]);
    expect(second.rows[1]!.messages[0]).toMatch(/continues the order on row 2, but a different customer \("Beta Corp" vs "Alpha Traders"\)/);
    const flat = (over: Cells) => plan(head("SO/1", "Alpha Traders", "3000", { itemName: "A", quantity: "1", rate: "1000", lineAmount: "1000" }), head("SO/1", "Alpha Traders", "3000", { itemName: "B", quantity: "1", rate: "2000", lineAmount: "2000", ...over }));
    expect(flat({ documentDate: "05-04-2026" }).rows[1]!.messages[0]).toBe("Same voucher number as row 2, but a different date (2026-04-05 vs 2026-04-01).");
    expect(flat({ amount: "9000" }).rows[1]!.messages[0]).toBe("Same voucher number as row 2, but a different order total (₹9,000.00 vs ₹3,000.00).");
    expect(flat({}).records).toHaveLength(1);
  });

  it("what makes two readings the same order ignores line order and nothing else", () => {
    const base = { partyKey: "alpha", documentDate: "2026-04-01", totalPaise: 300, lines: [{ item: "A", quantity: 1, amountPaise: 100 }, { item: "B", quantity: 1, amountPaise: 200 }] };
    expect(salesOrderSignature({ ...base, lines: [...base.lines].reverse() })).toBe(salesOrderSignature(base));
    expect(salesOrderSignature({ ...base, lines: [base.lines[0]!] })).not.toBe(salesOrderSignature(base));
    expect(salesOrderSignature({ ...base, partyKey: "beta" })).not.toBe(salesOrderSignature(base));
  });
});

describe("sending the file to the server in parts", () => {
  it("keeps every block of one voucher number together, and marks the gap so a repeat is never read as more lines", () => {
    const a = [head("SO/1", "Alpha Traders", "5000"), item("Gear Motor", "10", "500", "5000")];
    const b = [head("SO/2", "Beta Corp", "900"), item("Coupling", "3", "300", "900")];
    const all = rows(...a, ...b, ...a);
    const whole = planRows("sales-orders", all, M, { today });
    const chunks = chunkRows(all, whole.rows, 2);
    expect(chunks.map((c) => c.map((r) => r.rowNo))).toEqual([[2, 3, 6, 7], [4, 5]]);
    expect(chunks[0]!.map((r) => !!r.breakBefore)).toEqual([false, false, true, false]);
    // The server plans each part on its own and reaches the same answer as the whole file.
    const part = planRows("sales-orders", chunks[0]!, M, { today });
    expect(part.rows.map((r) => r.state)).toEqual(["valid", "valid", "duplicate", "duplicate"]);
    expect(part.records).toHaveLength(1);
    expect((part.records[0] as DocumentRecord).lines).toHaveLength(1);
  });

  it("a held-back order travels whole too", () => {
    const all = rows(head("", "Alpha Traders", "5000"), item("Gear Motor", "10", "500", "5000"), head("SO/2", "Beta Corp", "900"), item("Coupling", "3", "300", "900"));
    const whole = planRows("sales-orders", all, M, { today });
    expect(chunkRows(all, whole.rows, 1).map((c) => c.map((r) => r.rowNo))).toEqual([[2, 3], [4, 5]]);
  });
});

describe("matching to the masters", () => {
  const masters = buildSalesOrderMasters(
    [
      { id: "c-alpha", name: "Alpha Traders", code: "00001", gstin: "27ABCDE1234F1Z5" },
      { id: "c-beta", name: "Beta Corp", code: null, gstin: null },
      { id: "c-twin1", name: "Twin Co", code: null, gstin: null },
      { id: "c-twin2", name: "Twin Co.", code: null, gstin: null },
    ],
    [
      { id: "p-motor", name: "Gear Motor", code: "GM", tallyName: "GEAR MOTOR RANGE", isActive: true },
      { id: "p-box", name: "Helical Gearbox", code: "HG", tallyName: null, isActive: true },
      { id: "p-old", name: "Old Pump", code: null, tallyName: null, isActive: false },
      { id: "p-d1", name: "Drive Unit", code: null, tallyName: null, isActive: true },
      { id: "p-d2", name: "Drive-Unit", code: null, tallyName: null, isActive: true },
    ],
    [
      { id: "s-1hp", productId: "p-motor", skuCode: "GM-1HP", variantLabel: "1 HP", uom: "Nos", tallyItemName: "Gear Motor 1HP B3", isActive: true },
      { id: "s-2hp", productId: "p-motor", skuCode: "GM-2HP", variantLabel: "2 HP", uom: "Nos", tallyItemName: null, isActive: true },
      { id: "s-box", productId: "p-box", skuCode: "HG-50", variantLabel: null, uom: "Set", tallyItemName: null, isActive: true },
      { id: "s-off", productId: "p-motor", skuCode: "GM-OLD", variantLabel: null, uom: "Nos", tallyItemName: null, isActive: false },
    ],
  );
  const order = (lines: string[][], party = "Alpha Traders", total = "1000") => doc(plan(head("SO/1", party, total), ...lines));
  const one = (name: string, over: Cells = {}) => order([item(name, "1", "1000", "1000", over)]);
  const resolve = (rec: DocumentRecord, links: SalesOrderLinks = NO_LINKS, existing?: Parameters<typeof resolveSalesOrder>[3]) => {
    const collect = new MatchCollector();
    return { res: resolveSalesOrder(rec, masters, links, existing, collect), matches: collect.result() };
  };

  it("links a product by its Tally item name, Tally name, SKU code, name or code — the most specific first — and only when exactly one record has it", () => {
    expect(findProduct(masters, "gearmotor1hpb3")).toMatchObject({ kind: "one", hit: { ref: "sku:s-1hp", skuId: "s-1hp", productId: "p-motor", uom: "Nos" } });
    expect(findProduct(masters, "gearmotorrange")).toMatchObject({ kind: "one", hit: { ref: "product:p-motor", skuId: null } });
    expect(findProduct(masters, "gm2hp")).toMatchObject({ kind: "one", hit: { ref: "sku:s-2hp" } });
    // A product with exactly one variant is that variant.
    expect(findProduct(masters, "helicalgearbox")).toMatchObject({ kind: "one", hit: { ref: "product:p-box", skuId: "s-box", uom: "Set" } });
    expect(findProduct(masters, "hg")).toMatchObject({ kind: "one", hit: { productId: "p-box" } });
    expect(findProduct(masters, "driveunit")).toEqual({ kind: "many", count: 2 });
    expect(findProduct(masters, "nosuchthing")).toEqual({ kind: "none" });
    // Switched-off records never match on their own.
    expect(findProduct(masters, "oldpump")).toEqual({ kind: "none" });
    expect(findProduct(masters, "gmold")).toEqual({ kind: "none" });
  });

  it("links a customer by GSTIN first, then by name; two with one name link to neither", () => {
    expect(findCustomer(masters, null, "alphatraders")).toMatchObject({ kind: "one", hit: { id: "c-alpha" } });
    expect(findCustomer(masters, "27abcde1234f1z5", "someothername")).toMatchObject({ kind: "one", hit: { id: "c-alpha" } });
    expect(findCustomer(masters, null, "twinco")).toEqual({ kind: "many", count: 2 });
    expect(findCustomer(masters, null, "nobody")).toEqual({ kind: "none" });
  });

  it("a fully matched order is ready, with each line carrying its product", () => {
    const { res, matches } = resolve(order([item("Gear Motor 1HP B3", "1", "400", "400"), more("HG", "1", "600", "600")]));
    expect(res).toMatchObject({ existing: "none", invalid: null, partyId: "c-alpha" });
    expect(res.rowInvalid).toBeUndefined();
    expect(res.lines!.map((l) => [l.productId, l.skuId, l.productLabel])).toEqual([["p-motor", "s-1hp", "Gear Motor · 1 HP (GM-1HP)"], ["p-box", "s-box", "Helical Gearbox (HG)"]]);
    expect(matches.customers).toEqual([{ key: "alphatraders", name: "Alpha Traders", status: "matched", label: "Alpha Traders · 00001", ref: "c-alpha", rows: [2] }]);
    expect(matches.products.map((m) => m.status)).toEqual(["matched", "matched"]);
  });

  it("8 · an unknown or ambiguous customer holds the order back, on the customer's row, and is never created", () => {
    const unknown = resolve(one("GM-2HP"), NO_LINKS);
    expect(unknown.res.invalid).toBeNull();
    const nobody = resolve(doc(plan(head("SO/1", "Nobody Ltd", "1000"), item("GM-2HP", "1", "1000", "1000"))));
    expect(nobody.res.partyId).toBeNull();
    expect(nobody.res.rowInvalid).toEqual({ 2: [`"Nobody Ltd" isn't in the Customer Master. Match it under Match customers and items, or add the customer first.`] });
    expect(nobody.res.invalid).toMatch(/isn't in the Customer Master/);
    expect(nobody.matches.customers[0]).toMatchObject({ status: "unmatched", label: null });
    const twin = resolve(doc(plan(head("SO/1", "Twin Co", "1000"), item("GM-2HP", "1", "1000", "1000"))));
    expect(twin.res.rowInvalid![2]![0]).toMatch(/^2 Customer Master records match "Twin Co"/);
    expect(twin.matches.customers[0]!.status).toBe("ambiguous");
  });

  it("9 · an unknown, ambiguous or switched-off item holds the order back, on that line's row, and is never created or substituted", () => {
    const rec = order([item("Mystery Motor", "1", "400", "400"), more("Drive Unit", "1", "300", "300"), more("Old Pump", "1", "300", "300")]);
    const { res, matches } = resolve(rec);
    expect(res.rowInvalid).toEqual({
      3: [`"Mystery Motor" isn't in the Product Master. Match it under Match customers and items, or add the item first.`],
      4: [`2 items in the Product Master match "Drive Unit". Choose the right one under Match customers and items.`],
      5: [`"Old Pump" is switched off in the Product Master. Match it to an active item under Match customers and items.`],
    });
    expect(res.lines!.every((l) => l.productId === null)).toBe(true);
    expect(matches.products.map((m) => [m.name, m.status])).toEqual([["Mystery Motor", "unmatched"], ["Drive Unit", "ambiguous"], ["Old Pump", "unmatched"]]);
  });

  it("a person's match settles a name the masters couldn't, is recorded, and can never replace an exact match or point at nothing", () => {
    const rec = doc(plan(head("SO/1", "Nobody Ltd", "1000"), item("Mystery Motor", "1", "400", "400"), more("GM-2HP", "1", "600", "600")));
    const links: SalesOrderLinks = { customers: { nobodyltd: "c-beta" }, products: { mysterymotor: "sku:s-1hp", gm2hp: "sku:s-1hp" } };
    const { res, matches } = resolve(rec, links);
    expect(res).toMatchObject({ invalid: null, partyId: "c-beta" });
    expect(res.lines!.map((l) => l.skuId)).toEqual(["s-1hp", "s-2hp"]); // GM-2HP keeps its own exact match
    expect(res.manual).toEqual([`Customer "Nobody Ltd" was matched by hand to "Beta Corp".`, `Item "Mystery Motor" was matched by hand to "Gear Motor · 1 HP (GM-1HP)".`]);
    expect(matches.customers[0]).toMatchObject({ status: "manual", ref: "c-beta" });
    expect(matches.products.map((m) => m.status)).toEqual(["manual", "matched"]);
    // An id that isn't in the masters (or a switched-off one) is not a match.
    const bogus = resolve(rec, { customers: { nobodyltd: "c-nope" }, products: { mysterymotor: "sku:s-off" } });
    expect(Object.keys(bogus.res.rowInvalid!)).toEqual(["2", "3"]);
    // A link for a name the masters already settle is ignored.
    expect(resolve(one("GM-2HP"), { customers: { alphatraders: "c-beta" }, products: {} }).res.partyId).toBe("c-alpha");
  });

  it("a unit that differs from the master's, and a customer matched by GSTIN under another name, are warnings on their rows", () => {
    expect(resolve(one("GM-2HP", { ratePer: "NOS." })).res.rowAttention).toBeUndefined();
    expect(resolve(one("GM-2HP", { ratePer: "Kg" })).res.rowAttention).toEqual({ 3: [`Unit "Kg" differs from the Product Master's "Nos" for Gear Motor · 2 HP (GM-2HP).`] });
    const byGstin = resolve(doc(plan(head("SO/1", "Alpha Trading Company", "1000", { gstin: "27ABCDE1234F1Z5" }), item("GM-2HP", "1", "1000", "1000"))));
    expect(byGstin.res).toMatchObject({ partyId: "c-alpha", invalid: null });
    expect(byGstin.res.rowAttention![2]![0]).toMatch(/Matched by GSTIN to "Alpha Traders"/);
  });

  it("a ledger line naming another customer makes it two customers on one voucher: refused", () => {
    const rec = doc(plan(head("SO/1", "Alpha Traders", "1100"), item("GM-2HP", "1", "1000", "1000"), ledger("Beta Corp", "100")));
    expect(resolve(rec).res.rowInvalid).toEqual({ 4: [`"Beta Corp" is another customer in the Customer Master. One order can't belong to two customers.`] });
  });

  it("15 · an order already in the WMS: identical is a duplicate, anything else is a conflict and never overwritten", () => {
    const rec = one("GM-2HP");
    const stored = { id: "d1", batch: "b0", totalPaise: 100000, documentDate: "2026-04-01", partyKey: "alphatraders", lines: [{ item: "GM-2HP", quantity: 1, ratePaise: null, amountPaise: 100000 }] };
    expect(resolve(rec, NO_LINKS, stored).res).toMatchObject({ existing: "same", existingBatchId: "b0", existingId: "d1", invalid: null, note: "Already in Sales Orders; skipped." });
    for (const [change, why] of [[{ partyKey: "betacorp" }, /a different customer/], [{ documentDate: "2026-04-09" }, /a different date \(2026-04-09\)/], [{ totalPaise: 5 }, /a different total/], [{ lines: [{ item: "Other", quantity: 1, ratePaise: null, amountPaise: 100000 }] }, /different product lines/]] as const) {
      const { res } = resolve(rec, NO_LINKS, { ...stored, ...change });
      expect(res.existing).toBe("conflict");
      expect(res.invalid).toMatch(why);
      expect(res.invalid).toMatch(/never overwritten/);
    }
  });

  it("the rows say it: the cause on its own row, the rest of the order pointing at it, and nothing of it imports", () => {
    const p = plan(head("SO/1", "Alpha Traders", "1000"), item("Mystery Motor", "1", "400", "400"), more("GM-2HP", "1", "600", "600"), head("SO/2", "Beta Corp", "600"), item("GM-2HP", "1", "600", "600", { ratePer: "Kg" }));
    const collect = new MatchCollector();
    const resolutions = new Map(p.records.map((r) => [r.key, resolveSalesOrder(r as DocumentRecord, masters, NO_LINKS, undefined, collect)]));
    const shown = resolveRows(p, resolutions);
    expect(shown.map((r) => r.state)).toEqual(["invalid", "invalid", "invalid", "valid", "attention"]);
    expect(shown[0]!.messages).toEqual(["Not imported: row 3 of this order has an error."]);
    expect(shown[1]!.messages[0]).toMatch(/"Mystery Motor" isn't in the Product Master/);
    expect(shown[4]!.messages[0]).toMatch(/Unit "Kg" differs/);
    const decided = importDecisions(p, resolutions, false, "b");
    expect([...decided.records.values()]).toEqual(["skip", "skip"]); // SO/2 waits for the warning opt-in
    expect(decided.rows.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "skipped", "skipped"]);
    expect([...importDecisions(p, resolutions, true, "b").records.values()]).toEqual(["skip", "insert"]);
  });

  it("matches from several parts of one file are one list", () => {
    const m = (rowNo: number) => ({ customers: [{ key: "a", name: "A", status: "unmatched" as const, label: null, ref: null, rows: [rowNo] }], products: [], ledgers: [] });
    expect(mergeMatches([m(9), m(4)]).customers).toEqual([{ key: "a", name: "A", status: "unmatched", label: null, ref: null, rows: [9, 4] }]);
  });
});

describe("the preview, the error report and the template", () => {
  const file = rows(head("SO/1", "Alpha Traders", "3000"), item("Gear Motor", "1", "1000", "1000"), more("Gearbox", "1", "2000", "2000"), head("SO/2", "Beta Corp", "999"), item("Coupling", "3", "300", "900"), head("SO/1", "Alpha Traders", "3000"), item("Gear Motor", "1", "1000", "1000"), more("Gearbox", "1", "2000", "2000"), head("SO/3", "Alpha Traders", "100", { documentDate: "01-01-2027" }), item("=Bolt", "1", "100", "100", { dueDate: "15-01-2027" }));
  const planned = planRows("sales-orders", file, M, { today }).rows;
  const views = salesOrderViews(planned, file, M);

  it("shows one entry per order with its lines, and counts orders, not rows", () => {
    expect(views.map((v) => [v.rowNo, v.documentNo, v.partyName, v.state, v.lines.length, v.totalPaise])).toEqual([
      [2, "SO/1", "Alpha Traders", "valid", 2, 300000],
      [5, "SO/2", "Beta Corp", "invalid", 1, 99900],
      [7, "SO/1", "Alpha Traders", "duplicate", 2, 300000],
      [10, "SO/3", "Alpha Traders", "attention", 1, 10000],
    ]);
    expect(views[0]!.lines[1]).toEqual({ rowNo: 4, item: "Gearbox", quantity: "1", rate: "2000", unit: "Nos", amountPaise: 200000, description: "Standard", dueDates: ["2026-04-30"], allocations: 1, gst: "As per Masters/Company", hsn: "As per Masters/Company" });
    // The sales ledger carrying the lines is listed with the order; the customer's own entry isn't repeated.
    expect(views[0]!.ledgers).toEqual([{ rowNo: 3, name: "Sales", amountPaise: 100000, side: "Cr" }]);
    expect(views[0]!.facts).toEqual(expect.arrayContaining([{ label: "Order No(s)", value: "PO-1" }, { label: "Change Mode", value: "Item Invoice" }]));
    expect(views[2]!.repeatsInFile).toBe(true);
    expect(summarizeSalesOrders(views, false)).toEqual({ orders: 3, lines: 6, valid: 1, invalid: 1, duplicate: 1, warnings: 1, ready: 1, readyLines: 2 });
    expect(summarizeSalesOrders(views, true)).toMatchObject({ ready: 2, readyLines: 3 });
  });

  it("the error report lists every problem with its file row, leaves ready orders out, and can't be turned into a formula", () => {
    const csv = salesOrderErrorReport(views);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(`"File row","Voucher number","Voucher date","Customer","Result","What to fix"`);
    expect(lines).toHaveLength(1 + 2 + 3 + 1);
    expect(lines[1]).toBe(`"5","SO/2","2026-04-01","Beta Corp","Invalid","The product lines add up to ₹900.00, but the order total is ₹999.00."`);
    expect(lines[3]).toBe(`"7","SO/1","2026-04-01","Alpha Traders","Duplicate","Repeats row 2 of this file."`);
    expect(lines[6]).toMatch(/"10","SO\/3","2027-01-01","Alpha Traders","Warning","Date 2027-01-01 is in the future\."/);
    expect(salesOrderErrorReport([{ ...views[1]!, partyName: "=cmd|' /C calc'!A0" }])).toContain(`"'=cmd|' /C calc'!A0"`);
  });

  it("the template is the catalogue's exact Tally names: every column maps itself, and its example is two valid orders", () => {
    expect(SO_TEMPLATE_HEADINGS).toEqual(SO_FIELDS.map((f) => f.tallyName));
    expect(SO_TEMPLATE_HEADINGS).toHaveLength(112); // every field of a new order: 91 + the 21 x fields offered
    expect(SO_TEMPLATE_HEADINGS.slice(0, 3)).toEqual(["Voucher Type Name", "Voucher Date", "Voucher Number"]);
    const [headings, ...data] = SO_TEMPLATE_EXAMPLE;
    const mapping = suggestMapping("sales-orders", headings!, data);
    expect(mapping).toEqual(M);
    expect(mappingIsUsable(checkMapping("sales-orders", mapping, headings!, data))).toBe(true);
    // A column must be in the file for every Y field with no condition and no default.
    const required = checkMapping("sales-orders", {}, headings!, data).missingRequired.map((f) => f.label);
    expect(required).toHaveLength(SO_FIELDS.filter((f) => f.requirement === "mandatory" && !f.mandatoryWhen && !f.defaultsFrom).length);
    expect(required).toEqual(expect.arrayContaining(["Voucher Type Name", "Voucher Date", "Voucher Number", "Ledger Name", "Ledger Amount", "Item Name", "Billed Quantity", "Item Rate", "Item Amount", "Item Allocations - Order Due on", "GST Rate Details", "Change Mode"]));
    expect(required).not.toContain("IGST Rate"); // only under "Specify Details Here"
    expect(required).not.toContain("Consignee (ship to)"); // blank = the buyer
    const p = planRows("sales-orders", data.map((c, i) => ({ rowNo: i + 2, cells: c })), mapping, { today });
    expect(p.rows.every((r) => r.state === "valid")).toBe(true);
    expect(p.records.map((r) => (r as DocumentRecord).lines.length)).toEqual([2, 1]);
  });

  it("the downloaded workbook is a real .xlsx whose data sheet holds the headings only, with the example and notes on their own sheets", () => {
    const sheets = salesOrderTemplateSheets();
    expect(sheets.map((s) => s.name)).toEqual(["Accounting Voucher", "Example (not imported)", "Read Me"]);
    expect(sheets[0]!.rows).toEqual([[...SO_TEMPLATE_HEADINGS]]);
    const bytes = writeWorkbook(sheets);
    const first = readTallyBytes("template.xlsx", bytes);
    expect(first).toMatchObject({ ok: true, sheet: "Accounting Voucher", sheets: ["Accounting Voucher", "Example (not imported)", "Read Me"] });
    if (first.ok) {
      expect(first.grid).toEqual([[...SO_TEMPLATE_HEADINGS]]);
      expect(findHeaderRow("sales-orders", first.grid)).toBe(0);
    }
    // Another worksheet can be chosen by name.
    const example = readTallyBytes("template.xlsx", bytes, "Example (not imported)");
    expect(example.ok && example.sheet).toBe("Example (not imported)");
    expect(example.ok && example.grid[1]![2]).toBe("SO/EXAMPLE/001");
  });
});
