import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { canonicalSalesOrder, describeDifferences, orderDifferences } from "@/lib/tally/sales-order-compare";
import { MatchCollector, NO_LINKS, buildSalesOrderMasters, resolveSalesOrder, type ExistingSalesOrder } from "@/lib/tally/sales-order-match";
import { SO_FIELD, isAlwaysMandatory, isEnforced } from "@/lib/tally/sales-order-catalogue";
import { requirementText } from "@/lib/tally/sales-order-template";
import { SalesOrderDetailsView } from "@/components/forms/tally/sales-order-details";
import { SO_MAPPING, soEntry, soLine, soRow, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

// Exact duplicates versus changed versions of one Sales Order, the separate consignee's optional GSTIN, and the
// order page showing every stored field. All data is invented.
const today = "2026-10-31";
const head = (over: SoCells = {}, no = "SO/1") => soRow({ documentDate: "01-04-2026", documentNo: no, partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over });
const item = (over: SoCells = {}) => soRow({ partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over });
const plan = (...r: string[][]) => planRows("sales-orders", r.map((cells, i): RawRow => ({ rowNo: i + 2, cells })), SO_MAPPING, { asOfDate: null, direction: null, today });
const doc = (...r: string[][]) => plan(...r).records[0] as DocumentRecord;
/** SO/1, another voucher, then SO/1 again: a repeat is the same number after other vouchers (adjacent rows continue one order). */
const repeat = (...again: string[][]) => plan(head(), item(), head({}, "SO/0"), item(), ...again);

describe("a voucher repeated inside one file", () => {
  it("an exact copy is a duplicate and adds nothing", () => {
    const p = repeat(head(), item());
    expect(p.rows.map((r) => r.state)).toEqual(["valid", "valid", "valid", "valid", "duplicate", "duplicate"]);
    expect(p.rows[4]!.messages).toEqual(["Repeats row 2 of this file."]);
    expect(p.records.map((r) => (r as DocumentRecord).documentNo)).toEqual(["SO/1", "SO/0"]);
  });

  it("a copy with a corrected buyer address is a changed version: refused, with the change named, never merged", () => {
    const p = repeat(head({ buyerAddress: "2 Other Road" }), item());
    expect(p.rows[4]!.state).toBe("invalid");
    expect(p.rows[4]!.messages[0]).toBe(`Same voucher number as row 2, but different order details, so it can't be the same order: Buyer/Supplier - Address ("1 Test Road" → "2 Other Road"). Keep one version of the order in the file.`);
    expect((p.records.find((r) => (r as DocumentRecord).documentNo === "SO/1") as DocumentRecord).details!.buyer.address).toBe("1 Test Road");
  });

  it("GST, delivery dates and allocations are part of the comparison", () => {
    const gst = repeat(head(), item({ gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9" }));
    expect(gst.rows[4]!.messages[0]).toMatch(/different product lines.*Item "Gear Motor" · GST Rate Details \("As per Masters\/Company" → "Specify Details Here"\).*IGST Rate \("blank" → "18"\)/);
    const due = repeat(head(), item({ dueDate: "15-05-2027" }));
    expect(due.rows[4]!.messages[0]).toMatch(/Item "Gear Motor" · allocations \("2027-04-30\/.*" → "2027-05-15\//);
  });
});

describe("against the order already stored", () => {
  const masters = buildSalesOrderMasters([{ id: "c1", name: "Alpha Traders", code: null, gstin: null }], [{ id: "p1", name: "Gear Motor", code: null, tallyName: null, isActive: true }], []);
  const stored = (rec: DocumentRecord): ExistingSalesOrder => {
    const res = resolveSalesOrder(rec, masters, NO_LINKS, undefined, new MatchCollector());
    return { id: "d1", batch: "b0", totalPaise: rec.totalPaise, documentDate: rec.documentDate, partyKey: rec.partyKey, lines: res.lines!, details: res.details! };
  };
  const against = (existing: ExistingSalesOrder, rec: DocumentRecord) => resolveSalesOrder(rec, masters, NO_LINKS, existing, new MatchCollector());

  it("the same order again is an exact duplicate: skipped, nothing written", () => {
    const original = doc(head(), item());
    expect(against(stored(original), doc(head(), item()))).toMatchObject({ existing: "same", invalid: null, note: "Already in Sales Orders; skipped." });
  });

  it("a corrected version is a conflict that names every change, and the stored order is never touched", () => {
    const existing = stored(doc(head(), item()));
    const corrected = against(existing, doc(head({ carrier: "New Transport", buyerPincode: "411002" }), item({ ledgerNarration: "Corrected" })));
    expect(corrected.existing).toBe("conflict");
    expect(corrected.invalid).toMatch(/^This voucher number is already in Sales Orders with different order details: /);
    for (const change of [`Carrier Name/Agent ("Test Transport" → "New Transport")`, `Buyer/Supplier - Pincode ("411001" → "411002")`, `Ledger "Sales" · Ledger Narration ("Narration" → "Corrected")`]) expect(corrected.invalid).toContain(change);
    expect(corrected.invalid).toMatch(/never overwritten/);
    expect(corrected.rowInvalid).toEqual({ 2: [corrected.invalid] });
  });

  it("an order stored before its details were kept (before 0127) is compared on what it kept: customer, date, total, lines", () => {
    const legacy: ExistingSalesOrder = { id: "d0", batch: "b0", totalPaise: 100000, documentDate: "2026-04-01", partyKey: "alphatraders", lines: [{ item: "Gear Motor", quantity: 1, ratePaise: null, amountPaise: 100000 }], details: {} };
    expect(against(legacy, doc(head(), item())).existing).toBe("same");
    expect(against({ ...legacy, totalPaise: 90000 }, doc(head(), item())).invalid).toMatch(/a different total \(₹900.00\)/);
  });

  it("an order-level field a future configuration adds is compared too, under its own name", () => {
    const base = doc(head(), item());
    const withCustom = { ...base, details: { ...base.details!, custom: { "Project Code": "P-1" } } } as unknown as DocumentRecord;
    const changed = { ...base, details: { ...base.details!, custom: { "Project Code": "P-2" } } } as unknown as DocumentRecord;
    expect(orderDifferences(withCustom, changed)).toEqual([{ label: "custom.Project Code", before: "P-1", after: "P-2" }]);
    expect(canonicalSalesOrder(base).get("Voucher Narration")).toBe("Test order");
    expect(describeDifferences(Array.from({ length: 7 }, (_, i) => ({ label: `F${i}`, before: "a", after: "b" })))).toMatch(/; and 2 more$/);
  });
});

describe("a separate consignee's GSTIN is optional, and checked when given", () => {
  const consignee: SoCells = { consignee: "Site Office", consigneeMailingName: "Site Office", consigneeAddressType: "Site", consigneeAddress: "3 Lane", consigneeState: "Karnataka", consigneeCountry: "India", consigneePincode: "560002" };

  it("without one the order is valid and stores none; an invalid one is refused", () => {
    const p = plan(head(consignee), item());
    expect(p.rows.map((r) => r.state)).toEqual(["valid", "valid"]);
    expect((p.records[0] as DocumentRecord).details!.consignee).toMatchObject({ sameAsBuyer: false, gstin: null });
    expect(plan(head({ ...consignee, consigneeGstin: "29XYZ" }), item()).rows[0]!.messages.join(" ")).toMatch(/“Consignee - GSTIN\/UIN” "29XYZ" isn't a valid 15-character GSTIN/);
    // The other consignee fields are still required once a consignee is given.
    expect(plan(head({ ...consignee, consigneePincode: "" }), item()).rows[0]!.messages.join(" ")).toMatch(/“Consignee - Pincode”/);
  });

  it("it stays a yellow field in the matrix, marked as an exception with its reason", () => {
    const f = SO_FIELD.consigneeGstin!;
    expect([f.requirement, isEnforced(f), isAlwaysMandatory(f)]).toEqual(["mandatory", false, false]);
    expect(requirementText(f)).toMatch(/^Optional — yellow in the matrix, not enforced: Tally's matrix gives a consignee no GST registration type/);
  });
});

describe("the order page shows every stored field", () => {
  it("allocation Disc% and Discount Amount, and each GST source field on its own", () => {
    const d = doc(head({}, "SO/9"), item({ gstSource: "Stock Item master", allocDiscPct: "0", allocDiscAmount: "0" }));
    const html = renderToStaticMarkup(createElement(SalesOrderDetailsView, { details: d.details!, lines: d.lines }));
    expect(html).toContain("Source of details: Stock Item master");
    expect(html).toContain("Disc% 0");
    expect(html).toMatch(/Discount <span[^>]*>₹0/);
    for (const label of ["Voucher Narration", "Order - Date", "Carrier Name/Agent", "Place of Supply", "Supplies under section 7 of IGST Act", "Change Mode", "Ledger Narration", "Description of Ledger"]) expect(html, label).toContain(label);
  });
});
