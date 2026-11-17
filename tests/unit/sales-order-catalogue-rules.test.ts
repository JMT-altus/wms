import { describe, expect, it } from "vitest";
import { checkMapping, mappingIsUsable, suggestMapping } from "@/lib/tally/mapping";
import { planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { SO_FIELDS, SO_NOT_APPLICABLE, SO_UPDATE_ONLY, ignoredHeadingReason, soMatrixRows } from "@/lib/tally/sales-order-catalogue";
import { MatchCollector, NO_LINKS, buildSalesOrderMasters, resolveSalesOrder } from "@/lib/tally/sales-order-match";
import { allocationAmountPaise, emptySalesOrder, salesOrderFormLinks, salesOrderFormRows, singleDeliveryDiscountNote, type SoFormOrder } from "@/lib/tally/sales-order-form";
import { readTallyBytes } from "@/lib/tally/workbook";
import { SO_HEADERS, SO_MAPPING, soEntry, soLine, soRow, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

// The full Tally Sales Order field set (lib/tally/sales-order-catalogue.ts): what the business's matrix marks Y is
// required, ? and Provision are optional, x is ignored. All data is invented.
const today = "2026-10-31";
const head = (over: SoCells = {}, party = "Alpha Traders", total = "1000") => soRow({ documentDate: "01-04-2026", documentNo: "SO/1", partyName: party, amount: total, drCr: "Dr", ...soVoucher(party), ...soEntry, orderDate: "01-04-2026", ...over });
const item = (over: SoCells = {}, amount = "1000") => soRow({ partyName: "Sales", amount, drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: amount, lineAmount: amount, ...soLine(amount), ...over });
const rows = (...r: string[][]): RawRow[] => r.map((cells, i) => ({ rowNo: i + 2, cells }));
const plan = (...r: string[][]) => planRows("sales-orders", rows(...r), SO_MAPPING, { asOfDate: null, direction: null, today });
const all = (p: ReturnType<typeof plan>) => p.rows.flatMap((r) => r.messages).join(" | ");
const states = (p: ReturnType<typeof plan>) => p.rows.map((r) => r.state);
const doc = (p: ReturnType<typeof plan>) => p.records[0] as DocumentRecord;

describe("the catalogue is the business's matrix", () => {
  it("every one of the Read Me's 353 Sales Order fields: 91 applied (65 Y, 18 ?, 8 Provision), 3 Update, 259 x — 21 offered as optional fields, 238 provisions (off by default) with why", () => {
    const readMe = SO_FIELDS.filter((f) => !f.outsideMatrix && !f.workflow);
    const n = (r: string) => readMe.filter((f) => f.requirement === r).length;
    expect([readMe.length, n("mandatory"), n("conditional"), n("provision")]).toEqual([91, 65, 18, 8]);
    // The x fields the WMS offers: optional, never required by the matrix; all but HSN Description stored by key.
    const offered = SO_FIELDS.filter((f) => f.outsideMatrix && !f.defaultOff);
    expect(offered).toHaveLength(21);
    expect(offered.every((f) => f.requirement === "provision" && !f.mandatoryWhen && !f.workflow)).toBe(true);
    expect(offered.filter((f) => !f.keyed).map((f) => f.tallyName)).toEqual(["HSN Description"]);
    // The catalogue holds every field of the worksheet: the 115 on by default and the 238 provisions.
    expect(SO_FIELDS).toHaveLength(353);
    expect(SO_FIELDS.filter((f) => !f.defaultOff)).toHaveLength(115);
    expect(SO_UPDATE_ONLY).toEqual(["Item Allocations - Pre-Close Quantity", "Item Allocations - Reason for Pre-Close", "Item Allocations - Pre-Close Date"]);
    expect(SO_FIELDS.filter((f) => f.workflow === "preClose").map((f) => f.key)).toEqual(["preCloseQuantity", "preCloseReason", "preCloseDate"]);
    expect(Object.values(SO_NOT_APPLICABLE).flat()).toHaveLength(238);
    // The Read Me's own spelling, and the field the catalogue used to miss.
    expect(SO_NOT_APPLICABLE["Dispatch/Receipt/Party's Document Details"]).toContain("Dispatch Doc No. /Receipt Doc No./Challan Doc No.");
    expect(SO_NOT_APPLICABLE["Stat Payment (TCS) Details"]).toContain("Stat Payment (TCS) - Cheque Date");
    expect(ignoredHeadingReason("Dispatch Doc No./Receipt Doc No./Challan Doc No.")).toMatch(/after the order/);
    // The two fields the current Read Me applies to Sales Orders are fields, not x.
    expect(Object.values(SO_NOT_APPLICABLE).flat()).not.toEqual(expect.arrayContaining(["GST Classification"]));
    expect(Object.values(SO_NOT_APPLICABLE).flat()).not.toEqual(expect.arrayContaining(["Buyer/Supplier - Is Bill of Entry available"]));
    // Exact Tally names, each once; section headings are never fields.
    expect(new Set(SO_FIELDS.map((f) => f.tallyName)).size).toBe(353);
    expect(new Set(SO_FIELDS.map((f) => f.key)).size).toBe(353);
    for (const heading of ["General Details", "Ledger Details", "Item Details", "Order Details", "Voucher Status", "Export/Import Details"]) expect(SO_FIELDS.some((f) => f.tallyName === heading)).toBe(false);
    // The matrix report: every field once, with the Read Me's own marking.
    const m = soMatrixRows();
    expect(m).toHaveLength(353);
    expect(new Set(m.map((r) => r.tallyName)).size).toBe(353);
    const by = (k: string) => m.filter((r) => r.marking === k).length;
    expect([by("Y"), by("?"), by("Provision"), by("x"), by("Update")]).toEqual([65, 18, 8, 259, 3]);
    expect(m.find((r) => r.tallyName === "HSN Description")).toMatchObject({ marking: "x", key: "hsnDescription", xStatus: null });
    expect(m.find((r) => r.tallyName === "Port of Loading")).toMatchObject({ marking: "x", key: "portOfLoading", xStatus: null });
    expect(m.find((r) => r.tallyName === "Item Allocations - Pre-Close Date")).toMatchObject({ marking: "Update", key: "preCloseDate" });
    // Every x field not offered (a provision) carries the audit's verdict and why, and has a catalogue key.
    const apart = m.filter((r) => r.marking === "x" && r.xStatus !== null);
    expect(apart.every((r) => !!r.key)).toBe(true);
    expect(apart).toHaveLength(238);
    const status = (s: string) => apart.filter((r) => r.xStatus === s).map((r) => r.tallyName);
    expect(status("approval")).toEqual(["Discount Rate (Cash/Trade)", "Discount Amount (Cash/Trade)", "Item Allocations - Godown Name", "Item Allocations - Location Name"]);
    expect(status("external")).toHaveLength(5 + 12 + 47);
    expect(status("external")).toEqual(expect.arrayContaining(["Shipping Bill No.", "Bill of Entry Date", "e-Invoice - IRN", "e-Way Bill No."]));
    expect(status("notApplicable")).toHaveLength(238 - 4 - 64);
    expect(apart.every((r) => /^Not a Sales Order field: .+\. Off unless enabled in Admin & Master Setup → Sales Order Fields\./.test(r.rule))).toBe(true);
  });

  it("an x or Update column in a file is recognised and ignored, never mapped", () => {
    expect(ignoredHeadingReason("e-Way Bill No.")).toMatch(/not a Sales Order field/);
    expect(ignoredHeadingReason("item allocations - pre-close date")).toMatch(/changes an existing order/);
    expect(ignoredHeadingReason("Item Name")).toBeNull();
    const headers = [...SO_HEADERS, "e-Way Bill No.", "Motor Vehicle No."];
    const mapping = suggestMapping("sales-orders", headers, []);
    expect(Object.values(mapping)).not.toContain(SO_HEADERS.length);
    expect(Object.values(mapping)).not.toContain(SO_HEADERS.length + 1);
  });

  it("missing and duplicate columns are reported, and block validation", () => {
    const missing = checkMapping("sales-orders", { ...SO_MAPPING, carrier: undefined as unknown as number }, SO_HEADERS, []);
    expect(missing.missingRequired.map((f) => f.label)).toEqual(["Carrier Name/Agent"]);
    const twice = [...SO_HEADERS, "Item Name"];
    const dup = checkMapping("sales-orders", suggestMapping("sales-orders", twice, []), twice, []);
    expect(dup.duplicateHeadings).toEqual(["Item Name"]);
    expect(mappingIsUsable(dup)).toBe(false);
  });

  it("a sheet wider than the limit is refused, not cut short", () => {
    const wide = [Array.from({ length: 401 }, (_, i) => `C${i}`).join(","), Array.from({ length: 401 }, () => "x").join(",")].join("\n");
    expect(readTallyBytes("wide.csv", new TextEncoder().encode(wide))).toMatchObject({ ok: false, error: expect.stringMatching(/more than 400 columns/) });
  });
});

describe("1 · 2 · mandatory fields; optional ones may be blank", () => {
  it("a complete order with every ? and Provision field blank is valid, and every value is kept", () => {
    const p = plan(head(), item());
    expect(states(p)).toEqual(["valid", "valid"]);
    expect(doc(p).details).toMatchObject({ voucher: { seriesName: null, voucherClass: null, priceLevel: null }, originalSalesNature: null, additionalCosts: [], consignee: { sameAsBuyer: true } });
  });

  it("each voucher-level Y field left blank is named, and the order is held back whole", () => {
    const voucherKeys = SO_FIELDS.filter((f) => (f.level === "voucher" || f.level === "buyer") && f.requirement === "mandatory" && !f.mandatoryWhen && !["documentNo", "documentDate"].includes(f.key));
    expect(voucherKeys.length).toBeGreaterThan(25);
    for (const f of voucherKeys) {
      const p = plan(head({ [f.key]: "" }), item());
      expect(states(p), f.tallyName).toEqual(["invalid", "invalid"]);
      expect(all(p), f.tallyName).toContain(`“${f.tallyName}”`);
      expect(p.records).toEqual([]);
    }
  });

  it("each product-line Y field left blank is named on its row", () => {
    for (const key of ["itemDescription", "ratePer", "gstRateDetails", "reverseCharge", "itcEligible", "taxableValue", "hsnDetails", "dueDate"]) {
      const p = plan(head(), item({ [key]: "" }));
      expect(p.rows[1]!.state, key).toBe("invalid");
      expect(p.rows[1]!.messages.join(" "), key).toContain(`“${SO_FIELDS.find((f) => f.key === key)!.tallyName}”`);
      expect(p.rows[0]!.messages, key).toEqual(["Not imported: row 3 of this order has an error."]);
    }
  });

  it("7 · every ledger entry needs its Ledger Rate, Ledger Narration and Description of Ledger; Ledger Amount on every ledger", () => {
    expect(all(plan(head({ ledgerRate: "" }), item()))).toMatch(/“Ledger Rate” is required for ledger "Alpha Traders"/);
    expect(all(plan(head(), item({ ledgerNarration: "" })))).toMatch(/“Ledger Narration” is required for ledger "Sales"/);
    expect(all(plan(head(), item({ ledgerDescription: "" })))).toMatch(/“Description of Ledger” is required for ledger "Sales"/);
    expect(all(plan(head({}, "Alpha Traders", "1180"), item(), soRow({ partyName: "Output IGST 18%", drCr: "Cr", ...soEntry })))).toMatch(/“Ledger Amount” is required for ledger "Output IGST 18%"/);
    expect(all(plan(head({ ledgerRate: "nine" }), item()))).toMatch(/“Ledger Rate” "nine" isn't a number/);
    const p = plan(head({}, "Alpha Traders", "1180"), item(), soRow({ partyName: "Output IGST 18%", amount: "180", drCr: "Cr", ledgerRate: "18", ledgerNarration: "Tax", ledgerDescription: "IGST" }));
    expect(states(p)).toEqual(["valid", "valid", "valid"]);
    expect(doc(p).details!.ledgers.map((l) => [l.name, l.isParty, l.amountPaise, l.side, l.rate, l.narration, l.description])).toEqual([
      ["Alpha Traders", true, 118000, "dr", 0, "Narration", "Description"],
      ["Sales", false, 100000, "cr", 0, "Narration", "Description"],
      ["Output IGST 18%", false, 18000, "cr", 18, "Tax", "IGST"],
    ]);
  });
});

describe("3 · 9 · GST and HSN/SAC, conditionally", () => {
  it("“Specify Details Here” needs the three rates; “As per Masters/Company” doesn't", () => {
    const specify = plan(head(), item({ gstRateDetails: "Specify Details Here" }));
    expect(specify.rows[1]!.messages.join(" ")).toMatch(/“IGST Rate”, “CGST Rate”, “SGST\/UTGST Rate”/);
    const given = plan(head(), item({ gstRateDetails: "specify details here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9 %" }));
    expect(states(given)).toEqual(["valid", "valid"]);
    expect(doc(given).lines[0]!.gst).toMatchObject({ rateDetails: "Specify Details Here", taxability: "Taxable", igstRate: 18, cgstRate: 9, sgstRate: 9 });
    expect(states(plan(head(), item()))).toEqual(["valid", "valid"]); // As per Masters/Company: no rates needed
  });

  it("rates that don't add up, and a taxable value that differs from the amount, are warnings; a bad rate or choice is an error", () => {
    const off = plan(head(), item({ gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "6", sgstRate: "6" }));
    expect(off.rows[1]).toMatchObject({ state: "attention", messages: [expect.stringMatching(/“IGST Rate” 18% isn't “CGST Rate” \+ “SGST\/UTGST Rate” \(6% \+ 6%\)/)] });
    expect(plan(head(), item({ taxableValue: "900" })).rows[1]!.messages.join(" ")).toMatch(/“Taxable Value” ₹900.00 differs from the Item Amount ₹1,000.00/);
    expect(all(plan(head(), item({ gstRateDetails: "Specify Details Here", igstRate: "180", cgstRate: "9", sgstRate: "9" })))).toMatch(/“IGST Rate” "180" isn't a percentage from 0 to 100/);
    expect(all(plan(head(), item({ gstRateDetails: "Sometimes" })))).toMatch(/“GST Rate Details” "Sometimes" isn't one of: As per Masters\/Company, Specify Details Here, Use GST Classification/);
    expect(all(plan(head(), item({ reverseCharge: "Maybe" })))).toMatch(/“Applicable for Reverse Charge” must be Yes or No/);
  });

  it("HSN/SAC is required under “Specify Details Here” and must be 4, 6 or 8 digits; HSN Description (x in the Read Me) is optional and kept", () => {
    expect(all(plan(head(), item({ hsnDetails: "Specify Details Here" })))).toMatch(/blank on this product line: “HSN\/SAC”\./);
    const noDescription = plan(head(), item({ hsnDetails: "Specify Details Here", hsn: "85015210" }));
    expect(all(noDescription)).toBe("");
    expect(doc(noDescription).lines[0]!.hsn).toMatchObject({ code: "85015210", description: null });
    expect(all(plan(head(), item({ hsnDetails: "Specify Details Here", hsn: "85015", hsnDescription: "Motors" })))).toMatch(/“HSN\/SAC” "85015" isn't a 4, 6 or 8-digit/);
    const ok = plan(head(), item({ hsnDetails: "Specify Details Here", hsn: "85015210", hsnDescription: "Electric motors" }));
    expect(doc(ok).lines[0]!.hsn).toEqual({ details: "Specify Details Here", source: null, sourceType: null, classification: null, code: "85015210", description: "Electric motors" });
  });
});

describe("the fields the current Read Me adds or corrects", () => {
  it("GST Taxability Type is required under “Specify Details Here” (Y), not otherwise; the Read Me's spellings are accepted", () => {
    const rates = { gstRateDetails: "Specify Details Here", igstRate: "18", cgstRate: "9", sgstRate: "9" };
    expect(all(plan(head(), item(rates)))).toMatch(/blank on this product line: “GST Taxability Type”/);
    expect(all(plan(head(), item()))).toBe(""); // As per Masters/Company: not asked for
    const nill = plan(head(), item({ ...rates, gstTaxability: "Nill Rated", gstNature: "System Infered" }));
    expect(all(nill)).toBe("");
    expect(doc(nill).lines[0]!.gst).toMatchObject({ taxability: "Nil Rated", nature: "System Inferred" }); // stored as the listed value
    expect(doc(plan(head(), item({ ...rates, gstTaxability: "nil rated", gstNature: "System Inferred" }))).lines[0]!.gst).toMatchObject({ taxability: "Nil Rated", nature: "System Inferred" });
    expect(all(plan(head(), item({ ...rates, gstTaxability: "Nilled" })))).toMatch(/“GST Taxability Type” "Nilled" isn't one of/);
  });

  it("GST Classification is required with “Use GST Classification”, stored with the line's GST, and not asked for otherwise", () => {
    expect(all(plan(head(), item({ gstRateDetails: "Use GST Classification" })))).toMatch(/blank on this product line: “GST Classification”/);
    const given = plan(head(), item({ gstRateDetails: "Use GST Classification", gstClassification: "Motors 18%" }));
    expect(all(given)).toBe("");
    expect(doc(given).lines[0]!.gst).toMatchObject({ rateDetails: "Use GST Classification", classification: "Motors 18%" });
    expect(doc(plan(head(), item())).lines[0]!.gst).toMatchObject({ classification: null });
  });

  it("Is Bill of Entry available is required (Y) and stored with the buyer; no value is assumed", () => {
    expect(all(plan(head({ buyerBillOfEntry: "" }), item()))).toMatch(/Required field is blank: “Buyer\/Supplier - Is Bill of Entry available”/);
    expect(all(plan(head({ buyerBillOfEntry: "Perhaps" }), item()))).toMatch(/must be Yes or No/);
    expect(doc(plan(head({ buyerBillOfEntry: "Yes" }), item())).details!.buyer.billOfEntry).toBe(true);
    expect(doc(plan(head(), item())).details!.buyer.billOfEntry).toBe(false);
    expect(emptySalesOrder().voucher.buyerBillOfEntry).toBeUndefined(); // the form starts without a value
  });
});

describe("item allocation discounts: one delivery and several", () => {
  // A line of 2 × ₹1,000 with Disc% 10 and a ₹50 discount: Item Amount ₹1,750.
  const line = (over: SoCells = {}) => item({ quantity: "2", rate: "1000", discPct: "10", discAmount: "50", lineAmount: "1750", taxableValue: "1750", ...over }, "1750");

  it("one delivery with no discount of its own is the line: it carries the line's discount and amount", () => {
    const p = plan(head({}, "Alpha Traders", "1750"), line());
    expect(all(p)).toBe("");
    expect(doc(p).lines[0]!.allocations![0]).toMatchObject({ quantity: 2, ratePaise: 100000, amountPaise: 175000, discPct: 10, discountPaise: 5000 });
  });

  it("one delivery with the line's own discount works out its amount from it, with no amount typed", () => {
    const p = plan(head({}, "Alpha Traders", "1750"), line({ allocDiscPct: "10", allocDiscAmount: "50" }));
    expect(all(p)).toBe("");
    expect(doc(p).lines[0]!.allocations![0]).toMatchObject({ amountPaise: 175000, discPct: 10, discountPaise: 5000 });
  });

  it("one delivery with a different discount is explained, not shown as an unexplained amount mismatch", () => {
    const msg = all(plan(head({}, "Alpha Traders", "1750"), line({ allocDiscPct: "5", allocDiscAmount: "25" })));
    expect(msg).toMatch(/This delivery comes to ₹1,875\.00 with its own discount \(Disc% 5 and Discount ₹25\.00\), but the line comes to ₹1,750\.00 with the line's \(Disc% 10 and Discount ₹50\.00\)\. A single delivery is the whole line/);
    expect(msg).not.toMatch(/“Item Allocations - Amount” ₹1,750\.00 doesn't equal/); // the old, unexplained error
  });

  it("one delivery giving only one of its discount fields takes the line's value for the other (each field on its own)", () => {
    for (const own of [{ allocDiscAmount: "50" }, { allocDiscPct: "10" }] as SoCells[]) {
      const p = plan(head({}, "Alpha Traders", "1750"), line(own));
      expect(all(p)).toBe("");
      expect(doc(p).lines[0]!.allocations![0]).toMatchObject({ amountPaise: 175000, discPct: 10, discountPaise: 5000 });
    }
    expect(all(plan(head({}, "Alpha Traders", "1750"), line({ allocDiscAmount: "25" })))).toMatch(/own discount \(Disc% 10 and Discount ₹25\.00\), but the line comes to ₹1,750\.00 with the line's \(Disc% 10 and Discount ₹50\.00\)/);
  });

  it("a line without a discount: one delivery's own discount must be absent too, and says so", () => {
    expect(all(plan(head(), item({ allocDiscPct: "10" })))).toMatch(/with its own discount \(Disc% 10\), but the line comes to ₹1,000\.00 with the line's \(no discount\)/);
  });

  it("several deliveries each carry their own discount and add up to the discounted line", () => {
    const p = plan(
      head({}, "Alpha Traders", "1750"),
      line({ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocDiscAmount: "25", allocAmount: "875", dueDate: "15-04-2026" }),
      soRow({ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocDiscAmount: "25", allocAmount: "875", dueDate: "20-04-2026" }),
    );
    expect(all(p)).toBe("");
    expect(doc(p).lines[0]!.allocations!.map((a) => [a.amountPaise, a.discPct, a.discountPaise])).toEqual([[87500, 10, 2500], [87500, 10, 2500]]);
  });

  it("several deliveries before the line's discount are told to carry their share of it", () => {
    const msg = all(plan(
      head({}, "Alpha Traders", "1750"),
      line({ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocAmount: "1000", dueDate: "15-04-2026" }),
      soRow({ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocAmount: "1000", dueDate: "20-04-2026" }),
    ));
    expect(msg).toMatch(/add up to ₹2,000\.00, not its Item Amount ₹1,750\.00\. The line has a discount \(Disc% 10 and Discount ₹50\.00\) and its deliveries have none: give each delivery its share/);
  });

  it("the line's own discount calculation is unchanged", () => {
    expect(all(plan(head({}, "Alpha Traders", "1750"), line({ lineAmount: "1800", taxableValue: "1800" })))).toMatch(/Item amount ₹1,800\.00 doesn't equal quantity × rate less the discount \(₹1,750\.00\)/);
  });
});

describe("the form's allocations", () => {
  const base = () => {
    const o = emptySalesOrder();
    Object.assign(o.voucher, { ...soVoucher("Alpha Traders"), documentDate: "2026-04-01", documentNo: "SO/D1", orderDate: "2026-04-01" });
    o.customerId = "c1";
    o.customerName = "Alpha Traders";
    o.party = { rate: "0", narration: "Customer", description: "Customer ledger", costCentres: [] };
    o.sales = { name: "Sales", rate: "0", narration: "Sales", description: "Sales ledger", costCentres: [] };
    return o;
  };
  const lineValues = { itemDescription: "Motor", quantity: "2", rate: "1000", ratePer: "Nos", discPct: "10", discAmount: "50", gstRateDetails: "As per Masters/Company", reverseCharge: "No", itcEligible: "No", taxableValue: "1750.00", hsnDetails: "As per Masters/Company" };
  const check = (o: SoFormOrder) => planRows("sales-orders", salesOrderFormRows(o).rows, SO_MAPPING, { asOfDate: null, direction: null, today });

  it("split deliveries with a quantity and rate but no amount typed have their amount worked out, with their own discount", () => {
    const o = base();
    o.items = [{ productRef: "sku:s1", itemName: "Gear Motor", values: lineValues, allocations: [{ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocDiscAmount: "25", dueDate: "2026-04-15" }, { allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocDiscAmount: "25", dueDate: "2026-04-20" }] }];
    expect(allocationAmountPaise(o.items[0]!.allocations[0]!)).toBe(87500);
    const p = check(o);
    expect(p.rows.flatMap((r) => r.messages)).toEqual([]);
    expect((p.records[0] as DocumentRecord).lines[0]!.allocations!.map((a) => a.amountPaise)).toEqual([87500, 87500]);
  });

  it("a single delivery: the line's discount is used; a different one is flagged on the form before checking", () => {
    const o = base();
    o.items = [{ productRef: "sku:s1", itemName: "Gear Motor", values: lineValues, allocations: [{ dueDate: "2026-04-15" }] }];
    expect(check(o).rows.flatMap((r) => r.messages)).toEqual([]);
    expect(singleDeliveryDiscountNote(o.items[0]!)).toBeNull();
    o.items[0]!.allocations = [{ dueDate: "2026-04-15", allocDiscPct: "10", allocDiscAmount: "50" }];
    expect(singleDeliveryDiscountNote(o.items[0]!)).toBeNull(); // the same as the line's
    expect(check(o).rows.flatMap((r) => r.messages)).toEqual([]);
    o.items[0]!.allocations = [{ dueDate: "2026-04-15", allocDiscAmount: "50" }];
    expect(singleDeliveryDiscountNote(o.items[0]!)).toBeNull(); // its Disc% is the line's
    expect(check(o).rows.flatMap((r) => r.messages)).toEqual([]);
    o.items[0]!.allocations = [{ dueDate: "2026-04-15", allocDiscPct: "5" }];
    expect(singleDeliveryDiscountNote(o.items[0]!)).toMatch(/A single delivery is the whole line/);
    expect(check(o).rows.flatMap((r) => r.messages).join(" ")).toMatch(/This delivery comes to .* A single delivery is the whole line/);
  });
});

describe("4 · the buyer and a separate consignee", () => {
  it("a Regular buyer needs a valid GSTIN; an unregistered one needs none; a GSTIN from another state is a warning", () => {
    expect(all(plan(head({ buyerRegType: "Regular" }), item()))).toMatch(/“Buyer\/Supplier - GSTIN\/UIN”/);
    expect(all(plan(head({ buyerRegType: "Regular", gstin: "27ABC" }), item()))).toMatch(/isn't a valid 15-character GSTIN/);
    expect(states(plan(head({ buyerRegType: "Regular", gstin: "27ABCDE1234F1Z5" }), item()))).toEqual(["valid", "valid"]);
    expect(plan(head({ buyerRegType: "Regular", gstin: "29ABCDE1234F1Z5" }), item()).rows[0]!.messages.join(" ")).toMatch(/registered in Karnataka, but “Buyer\/Supplier - State” is Maharashtra/);
  });

  it("Indian states must be their official GST names and pincodes 6 digits; other countries are free text", () => {
    expect(all(plan(head({ buyerState: "Bombay" }), item()))).toMatch(/“Buyer\/Supplier - State” "Bombay" isn't the official GST name/);
    expect(all(plan(head({ buyerPincode: "4110" }), item()))).toMatch(/isn't a 6-digit Indian pincode/);
    expect(states(plan(head({ buyerCountry: "Kenya", buyerState: "Nairobi", placeOfSupply: "Other Territory", buyerPincode: "00100" }), item()))).toEqual(["valid", "valid"]);
  });

  it("no consignee columns = the buyer; any consignee column = all of them, stored separately", () => {
    const same = doc(plan(head(), item())).details!.consignee;
    expect(same).toMatchObject({ sameAsBuyer: true, billTo: "Alpha Traders", state: "Maharashtra", pincode: "411001" });
    expect(all(plan(head({ consignee: "Site Office" }), item()))).toMatch(/“Consignee - Mailing Name”.*“Consignee - Pincode”/);
    const separate = { consignee: "Site Office", consigneeMailingName: "Site Office", consigneeAddressType: "Site", consigneeAddress: "3 Lane", consigneeState: "Karnataka", consigneeCountry: "India", consigneeGstin: "29ABCDE1234F1Z5", consigneePincode: "560002" };
    const p = plan(head(separate), item());
    expect(states(p)).toEqual(["valid", "valid"]);
    expect(doc(p).details!.consignee).toEqual({ sameAsBuyer: false, billTo: "Site Office", mailingName: "Site Office", addressType: "Site", address: "3 Lane", state: "Karnataka", country: "India", gstin: "29ABCDE1234F1Z5", pincode: "560002" });
  });

  it("an order-level field given twice with different values in one voucher is refused", () => {
    const p = plan(head({ destination: "Pune" }), item({ destination: "Mumbai" }));
    expect(p.rows[1]!.messages.join(" ")).toMatch(/“Destination” "Mumbai" differs from row 2 \("Pune"\)/);
    expect(p.records).toEqual([]);
  });
});

describe("5 · 8 · several products, allocations and Order Due dates", () => {
  it("a line split over deliveries keeps each allocation; they must add up to the line", () => {
    const split = (q2: string, a2: string) =>
      plan(head({}, "Alpha Traders", "3000"), item({ quantity: "3", rate: "1000", lineAmount: "3000", taxableValue: "3000", allocQuantity: "2", allocRate: "1000", allocRatePer: "Nos", allocAmount: "2000", dueDate: "15-04-2026" }, "3000"), soRow({ allocQuantity: q2, allocRate: "1000", allocRatePer: "Nos", allocAmount: a2, dueDate: "20-04-2026", allocTrackingNo: "TRK-1" }));
    const ok = split("1", "1000");
    expect(states(ok)).toEqual(["valid", "valid", "valid"]);
    expect(doc(ok).lines[0]!.allocations!.map((a) => [a.quantity, a.amountPaise, a.dueDate, a.trackingNo])).toEqual([[2, 200000, "2026-04-15", null], [1, 100000, "2026-04-20", "TRK-1"]]);
    expect(doc(ok).dueDate).toBe("2026-04-15");
    expect(all(split("2", "2000"))).toMatch(/add up to a quantity of 4, not its Billed Quantity 3/);
    expect(all(split("1", "900"))).toMatch(/doesn't equal its quantity × rate \(₹1,000.00\)/);
  });

  it("with more than one allocation nothing defaults; every allocation needs its Order Due on", () => {
    const p = plan(head({}, "Alpha Traders", "2000"), item({ quantity: "2", rate: "1000", lineAmount: "2000", taxableValue: "2000", allocQuantity: "1", dueDate: "15-04-2026" }, "2000"), soRow({ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocAmount: "1000" }));
    expect(all(p)).toMatch(/blank on this allocation: “Item Allocations - Rate”, “Item Allocations - Rate per”, “Item Allocations - Amount”/);
    expect(all(p)).toMatch(/blank on this allocation: “Item Allocations - Order Due on”/);
    expect(all(plan(head(), soRow({ allocQuantity: "1", dueDate: "15-04-2026" })))).toMatch(/This allocation comes before any product line|no product line/);
  });

  it("discounts and MRP: the amount is quantity × rate less the discount", () => {
    expect(states(plan(head({}, "Alpha Traders", "900"), item({ quantity: "1", rate: "1000", lineAmount: "900", taxableValue: "900", discPct: "10", mrp: "1200" }, "900")))).toEqual(["valid", "valid"]);
    expect(all(plan(head({}, "Alpha Traders", "1000"), item({ discPct: "10" })))).toMatch(/doesn't equal quantity × rate less the discount \(₹900.00\)/);
  });
});

describe("10 · invalid dates and amounts", () => {
  it("an unreadable Order - Date or Order Due on, and an order date after the voucher", () => {
    expect(all(plan(head({ orderDate: "someday" }), item()))).toMatch(/“Order - Date” "someday" can't be read as a date/);
    expect(all(plan(head(), item({ dueDate: "32-04-2026" })))).toMatch(/“Item Allocations - Order Due on” "32-04-2026" can't be read as a date/);
    expect(plan(head({ orderDate: "05-04-2026" }), item()).rows[0]!.messages.join(" ")).toMatch(/“Order - Date” 2026-04-05 is after the Voucher Date 2026-04-01/);
  });
});

describe("cost centres and additional cost (?)", () => {
  it("cost-centre rows belong to the ledger above; an allocation short of the ledger is a warning", () => {
    const p = plan(head(), item({ categoryName: "Projects", costCentre: "Pune", costCentreAmount: "600" }), soRow({ costCentre: "Mumbai", costCentreAmount: "400" }));
    expect(states(p)).toEqual(["valid", "valid", "valid"]);
    expect(doc(p).details!.ledgers[1]!.costCentres.map((c) => [c.category, c.costCentre, c.amountPaise])).toEqual([["Projects", "Pune", 60000], [null, "Mumbai", 40000]]);
    expect(plan(head(), item({ costCentre: "Pune", costCentreAmount: "600" })).rows[1]!.messages.join(" ")).toMatch(/add up to ₹600.00, not its ₹1,000.00/);
    expect(all(plan(head(), item({ costCentre: "Pune" })))).toMatch(/“Cost Allocation for - Cost Centre” and “Cost Allocation for - Amount” go together/);
  });

  it("an additional cost needs its ledger and a percentage or an amount", () => {
    expect(doc(plan(head(), item(), soRow({ addlCostLedger: "Freight Inward", addlCostPct: "2" }))).details!.additionalCosts).toEqual([{ ledger: "Freight Inward", percent: 2, amountPaise: null, rowNo: 4 }]);
    expect(all(plan(head(), item(), soRow({ addlCostLedger: "Freight Inward" })))).toMatch(/needs “Additional Cost - Percentage” or “Additional Cost - Amount”/);
    expect(all(plan(head(), item(), soRow({ addlCostAmount: "50" })))).toMatch(/“Additional Cost - Ledger” is required/);
  });
});

describe("13 · ledgers against the Tally Ledgers list", () => {
  const masters = (ledgers: string[]) =>
    buildSalesOrderMasters([{ id: "c1", name: "Alpha Traders", code: null, gstin: null }], [{ id: "p1", name: "Gear Motor", code: null, tallyName: null, isActive: true }], [], ledgers);
  const rec = () => doc(plan(head({}, "Alpha Traders", "1180"), item(), soRow({ partyName: "Output IGST 18%", amount: "180", drCr: "Cr", ...soEntry })));

  it("an empty list checks nothing and says so; a listed list holds back a ledger it doesn't list, on its row", () => {
    const c1 = new MatchCollector();
    expect(resolveSalesOrder(rec(), masters([]), NO_LINKS, undefined, c1).invalid).toBeNull();
    expect(c1.result().ledgers.map((l) => [l.name, l.status])).toEqual([["Sales", "unchecked"], ["Output IGST 18%", "unchecked"]]);
    const c2 = new MatchCollector();
    const held = resolveSalesOrder(rec(), masters(["Sales"]), NO_LINKS, undefined, c2);
    expect(held.rowInvalid).toEqual({ 4: [expect.stringMatching(/Ledger "Output IGST 18%" isn't in the Sales Orders — Tally Ledgers list/)] });
    expect(c2.result().ledgers.map((l) => [l.name, l.status])).toEqual([["Sales", "matched"], ["Output IGST 18%", "unmatched"]]);
  });

  it("a person may match it to a listed ledger: recorded, and stored beside the file's name; a link to an unlisted name is no match", () => {
    const c = new MatchCollector();
    const res = resolveSalesOrder(rec(), masters(["Sales", "IGST Output @18"]), { ...NO_LINKS, ledgers: { outputigst18: "IGST Output @18" } }, undefined, c);
    expect(res.invalid).toBeNull();
    expect(res.manual).toContain(`Ledger "Output IGST 18%" was matched by hand to "IGST Output @18".`);
    expect(res.details!.ledgers.map((l) => [l.name, l.listedAs ?? null])).toEqual([["Alpha Traders", null], ["Sales", "Sales"], ["Output IGST 18%", "IGST Output @18"]]);
    expect(resolveSalesOrder(rec(), masters(["Sales"]), { ...NO_LINKS, ledgers: { outputigst18: "Made Up" } }, undefined, new MatchCollector()).invalid).toMatch(/isn't in the Sales Orders — Tally Ledgers list/);
  });
});

describe("the manual-entry form makes the same rows a file would", () => {
  const filled = (): SoFormOrder => {
    const o = emptySalesOrder();
    Object.assign(o.voucher, { ...soVoucher("Alpha Traders"), documentDate: "2026-04-01", documentNo: "SO/F1", orderDate: "2026-04-01" });
    o.customerId = "c1";
    o.customerName = "Alpha Traders";
    o.party = { rate: "0", narration: "Customer", description: "Customer ledger", costCentres: [] };
    o.sales = { name: "Sales", rate: "0", narration: "Sales", description: "Sales ledger", costCentres: [{ category: "", costCentre: "Pune", amount: "3000" }] };
    o.items = [
      { productRef: "sku:s1", itemName: "GM-1HP", values: { itemDescription: "Motor", quantity: "1", rate: "1000", ratePer: "Nos", gstRateDetails: "As per Masters/Company", reverseCharge: "No", itcEligible: "No", taxableValue: "1000.00", hsnDetails: "As per Masters/Company" }, allocations: [{ dueDate: "2026-04-15" }] },
      { productRef: "product:p2", itemName: "Gearbox", values: { itemDescription: "Box", quantity: "2", rate: "1000", ratePer: "Nos", gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9", reverseCharge: "No", itcEligible: "No", taxableValue: "2000.00", hsnDetails: "Specify Details Here", hsn: "8483", hsnDescription: "Gears" }, allocations: [{ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocAmount: "1000", dueDate: "2026-04-20" }, { allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocAmount: "1000", dueDate: "2026-04-30" }] },
    ];
    o.ledgers = [{ name: "Output IGST 18%", amount: "540", drCr: "Cr", rate: "18", narration: "Tax", description: "IGST", costCentres: [] }];
    return o;
  };

  it("a filled form is one valid order: totals worked out, every field where a file would put it", () => {
    const built = salesOrderFormRows(filled());
    expect(built.headers).toEqual(SO_HEADERS);
    expect(built.sources.map((s) => s.label)).toEqual(["Order and customer ledger", "Item 1", "Item 2", "Item 2 · allocation 2", "Ledger 1 (Output IGST 18%)"]);
    const p = planRows("sales-orders", built.rows, SO_MAPPING, { asOfDate: null, direction: null, today });
    expect(p.rows.map((r) => [r.state, r.messages])).toEqual(built.rows.map(() => ["valid", []]));
    const d = p.records[0] as DocumentRecord;
    expect([d.documentNo, d.totalPaise, d.lines.length]).toEqual(["SO/F1", 354000, 2]);
    expect(d.details!.ledgers.map((l) => [l.name, l.amountPaise])).toEqual([["Alpha Traders", 354000], ["Sales", 300000], ["Output IGST 18%", 54000]]);
    expect(d.details!.ledgers[1]!.costCentres).toEqual([expect.objectContaining({ costCentre: "Pune", amountPaise: 300000 })]);
    expect(d.lines[1]!.allocations!.map((a) => a.dueDate)).toEqual(["2026-04-20", "2026-04-30"]);
    expect(salesOrderFormLinks(filled())).toEqual({ customers: { alphatraders: "c1" }, products: { gm1hp: "sku:s1", gearbox: "product:p2" }, ledgers: {} });
  });

  it("a separate consignee is sent only when chosen; a gap in the form is reported like a gap in a file", () => {
    const o = filled();
    o.voucher.consignee = "Site Office";
    expect(salesOrderFormRows(o).rows[0]!.cells[SO_MAPPING.consignee!]).toBe("");
    o.separateConsignee = true;
    expect(salesOrderFormRows(o).rows[0]!.cells[SO_MAPPING.consignee!]).toBe("Site Office");
    const gap = filled();
    gap.voucher.carrier = "";
    const p = planRows("sales-orders", salesOrderFormRows(gap).rows, SO_MAPPING, { asOfDate: null, direction: null, today });
    expect(p.rows[0]!.messages.join(" ")).toMatch(/“Carrier Name\/Agent”/);
    expect(p.records).toEqual([]);
  });
});
