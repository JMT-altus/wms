// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { checkMapping, mappingIsUsable, suggestMapping } from "@/lib/tally/mapping";
import { planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { SO_FIELDS, ignoredHeadingReason } from "@/lib/tally/sales-order-catalogue";
import { orderDifferences } from "@/lib/tally/sales-order-compare";
import { buildCatalogue } from "@/lib/tally/sales-order-config";
import { SalesOrderDetailsView } from "@/components/forms/tally/sales-order-details";
import { SO_HEADERS, SO_MAPPING, soEntry, soLine, soRow, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

// The fields the Read Me marks x for Sales Orders that the WMS now offers (optional, stored by key): import,
// validation, storage, comparison and the order page; and the x fields it doesn't offer, ignored with why.
// All data is invented.
const today = "2026-10-31";
const head = (over: SoCells = {}) => soRow({ documentDate: "01-04-2026", documentNo: "SO/X/1", partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over });
const item = (over: SoCells = {}) => soRow({ partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over });
const rows = (...r: string[][]): RawRow[] => r.map((cells, i) => ({ rowNo: i + 2, cells }));
const plan = (...r: string[][]) => planRows("sales-orders", rows(...r), SO_MAPPING, { asOfDate: null, direction: null, today });
const all = (p: ReturnType<typeof plan>) => p.rows.flatMap((r) => r.messages).join(" | ");
const doc = (p: ReturnType<typeof plan>) => p.records[0] as DocumentRecord;

const VOUCHER_X: SoCells = {
  voucherRefNo: "REF-1", voucherRefDate: "05-04-2026", effectiveDate: "02-04-2026", isOptional: "Yes", applicableUpto: "30-04-2026",
  shipperReceiptPlace: "Pune ICD", vesselFlightNo: "MV Example", portOfLoading: "Nhava Sheva", portOfDischarge: "Jebel Ali", countryTo: "UAE", buyerOtherTerritory: "yes",
};
const SPECIFY: SoCells = { gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9" };
const ITEM_X: SoCells = { actualQuantity: "1", quantityUom: "Box", marks: "AT/1", packages: "2 boxes", cessRate: "1", cessPerUnit: "2.5", stateCessRate: "0.5", gstOnMrp: "no", allocActualQuantity: "1", allocUom: "Box" };

describe("the x fields the WMS offers", () => {
  it("are 20 optional fields stored by key, each with the Read Me's own name; none of them is required", () => {
    const keyed = SO_FIELDS.filter((f) => f.keyed && !f.defaultOff);
    expect(keyed.map((f) => f.tallyName)).toEqual([
      "Reference No.", "Reference Date", "Voucher Effective Date", "Voucher Applicable Upto",
      "Actual Quantity", "Quantity UOM", "Marks", "No. of Packages",
      "Place of Receipt by Shipper", "Vessel/Flight No.", "Port of Loading", "Port of Discharge", "Country to",
      "Item Allocations - Actual Quantity", "Item Allocations - UOM",
      "Cess Rate", "Cess Rate Per Unit", "State Cess Rate", "Calculate GST on MRP (Incl. Tax)",
      "Buyer/Supplier - Assessee of Other Territory",
    ]);
    expect(keyed.every((f) => f.requirement === "provision" && f.outsideMatrix && !f.mandatoryWhen)).toBe(true);
    // Their headings are mapped by themselves, never ignored.
    for (const f of keyed) expect(ignoredHeadingReason(f.tallyName)).toBeNull();
    expect(suggestMapping("sales-orders", SO_HEADERS, []).portOfLoading).toBe(SO_HEADERS.indexOf("Port of Loading"));
  });

  it("an order carrying every one is valid and keeps each value with its order, line and delivery", () => {
    const p = plan(head(VOUCHER_X), item({ ...SPECIFY, ...ITEM_X }));
    expect(all(p)).toBe("");
    const d = doc(p);
    expect(d.details!.custom).toEqual({
      voucherRefNo: "REF-1", voucherRefDate: "2026-04-05", effectiveDate: "2026-04-02", applicableUpto: "2026-04-30",
      shipperReceiptPlace: "Pune ICD", vesselFlightNo: "MV Example", portOfLoading: "Nhava Sheva", portOfDischarge: "Jebel Ali", countryTo: "UAE", buyerOtherTerritory: "Yes",
    });
    expect(d.lines[0]!.custom).toEqual({ actualQuantity: "1", quantityUom: "Box", marks: "AT/1", packages: "2 boxes", cessRate: "1", cessPerUnit: "2.50", stateCessRate: "0.5", gstOnMrp: "No" });
    expect(d.lines[0]!.allocations![0]!.custom).toEqual({ allocActualQuantity: "1", allocUom: "Box" });
    // They describe the order; they never change its amounts.
    expect(d.lines[0]!.amountPaise).toBe(100000);
    expect(d.totalPaise).toBe(100000);
  });

  it("a value that isn't valid for its type is refused, named by its Tally name", () => {
    const e = (h: SoCells, i: SoCells = {}) => all(plan(head(h), item({ ...SPECIFY, ...i })));
    expect(e({ voucherRefDate: "31-02-2026" })).toMatch(/“Reference Date” "31-02-2026" can't be read as a date/);
    expect(e({ buyerOtherTerritory: "maybe" })).toMatch(/“Buyer\/Supplier - Assessee of Other Territory” must be Yes or No/);
    expect(e({}, { cessRate: "120" })).toMatch(/“Cess Rate” "120" isn't a percentage from 0 to 100/);
    expect(e({}, { actualQuantity: "-1" })).toMatch(/“Actual Quantity” "-1" isn't a number of 0 or more/);
    expect(e({}, { cessPerUnit: "abc" })).toMatch(/“Cess Rate Per Unit” "abc" isn't a valid amount/);
    expect(e({}, { allocActualQuantity: "x" })).toMatch(/“Item Allocations - Actual Quantity” "x" isn't a number/);
  });

  it("made mandatory in Admin & Master Setup → Sales Order Fields, a blank one holds the order back", () => {
    const c = buildCatalogue([{ fieldKey: "portOfLoading", isCustom: false, scope: "voucher", label: null, section: null, displayOrder: null, requirement: "mandatory", condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", rowVersion: 1 }]);
    const p = planRows("sales-orders", rows(head(), item()), SO_MAPPING, { asOfDate: null, direction: null, today, soCatalogue: c });
    expect(all(p)).toMatch(/Required field is blank: “Port of Loading”/);
    expect(all(planRows("sales-orders", rows(head({ portOfLoading: "Mundra" }), item()), SO_MAPPING, { asOfDate: null, direction: null, today, soCatalogue: c }))).toBe("");
  });

  it("an optional voucher can't apply up to a date before its own", () => {
    expect(all(plan(head({ isOptional: "Yes", applicableUpto: "31-03-2026" }), item()))).toMatch(/“Voucher Applicable Upto” 2026-03-31 is before the Voucher Date 2026-04-01/);
    expect(all(plan(head({ isOptional: "Yes", applicableUpto: "01-04-2026" }), item()))).toBe("");
  });

  it("a file made from the previous template — without these columns — still maps and imports", () => {
    const added = new Set(SO_FIELDS.filter((f) => f.keyed && !f.defaultOff).map((f) => f.tallyName));
    const old = SO_HEADERS.filter((h) => !added.has(h));
    expect(old).toHaveLength(92);
    const project = (cells: string[]) => old.map((h) => cells[SO_HEADERS.indexOf(h)]!);
    const data = [head(), item()].map(project);
    const mapping = suggestMapping("sales-orders", old, data);
    const check = checkMapping("sales-orders", mapping, old, data);
    expect(check.missingRequired).toEqual([]);
    expect(mappingIsUsable(check)).toBe(true);
    const p = planRows("sales-orders", rows(...data), mapping, { asOfDate: null, direction: null, today });
    expect(p.rows.map((r) => r.state)).toEqual(["valid", "valid"]);
    expect(doc(p).details!.custom).toBeUndefined();
  });

  it("are part of the duplicate comparison, under their Tally names, at every level", () => {
    const base = doc(plan(head(VOUCHER_X), item({ ...SPECIFY, ...ITEM_X })));
    expect(orderDifferences(base, doc(plan(head(VOUCHER_X), item({ ...SPECIFY, ...ITEM_X }))))).toEqual([]);
    const labels = (h: SoCells, i: SoCells) => orderDifferences(base, doc(plan(head({ ...VOUCHER_X, ...h }), item({ ...SPECIFY, ...ITEM_X, ...i })))).map((x) => x.label);
    expect(labels({ portOfLoading: "Mundra" }, {})).toEqual(["Port of Loading"]);
    expect(labels({}, { marks: "AT/2" })).toEqual(['Item "Gear Motor" · Marks']);
    expect(labels({}, { allocUom: "Nos" })).toEqual(['Item "Gear Motor" · allocations']);
    // Absent and blank are the same: an order stored before these fields existed isn't "changed" by them.
    const plain = doc(plan(head(), item()));
    expect(orderDifferences(plain, doc(plan(head(), item())))).toEqual([]);
  });

  it("are shown on the order page: the order's under “Other Tally fields”, the line's and delivery's with them", () => {
    const d = doc(plan(head(VOUCHER_X), item({ ...SPECIFY, ...ITEM_X })));
    render(<SalesOrderDetailsView details={d.details!} lines={d.lines} />);
    const other = screen.getByText("Other Tally fields").closest("section, div")!;
    expect(within(other as HTMLElement).getByText("Port of Loading")).toBeTruthy();
    expect(within(other as HTMLElement).getByText("Nhava Sheva")).toBeTruthy();
    expect(within(other as HTMLElement).getByText("Voucher Applicable Upto")).toBeTruthy();
    expect(screen.queryByText("Custom fields")).toBeNull();
    const table = screen.getByRole("table", { name: "Allocations, GST and HSN/SAC" });
    expect(within(table).getByText(/Marks: AT\/1/)).toBeTruthy();
    expect(within(table).getByText(/Cess Rate: 1/)).toBeTruthy();
    expect(within(table).getByText(/Item Allocations - UOM: Box/)).toBeTruthy();
  });
});

describe("the x fields the WMS doesn't offer", () => {
  it("are recognised in a file and ignored, each with the audit's reason", () => {
    expect(ignoredHeadingReason("e-Way Bill No.")).toMatch(/e-Way Bill portal/);
    expect(ignoredHeadingReason("e-Invoice - IRN")).toMatch(/e-Invoice portal/);
    expect(ignoredHeadingReason("Shipping Bill No.")).toMatch(/Customs documents/);
    expect(ignoredHeadingReason("Item Allocations - Godown Name")).toMatch(/business decision/);
    expect(ignoredHeadingReason("Discount Rate (Cash/Trade)")).toMatch(/pricing rule/);
    expect(ignoredHeadingReason("Item Allocations - Batch/Lot No.")).toMatch(/Delivery Note/);
    expect(ignoredHeadingReason("Bank Allocations - IFS Code")).toMatch(/banking/);
    expect(ignoredHeadingReason("Stat Payment (TCS) - Cheque Date")).toMatch(/Statutory/);
    expect(ignoredHeadingReason("Item Allocations - Pre-Close Quantity")).toMatch(/pre-close a delivery on the order's own page/);
  });
});
