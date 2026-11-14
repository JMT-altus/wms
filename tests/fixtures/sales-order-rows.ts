import { SO_ORDER_FIELDS as SO_FIELDS } from "@/lib/tally/sales-order-catalogue";
import { SO_TEMPLATE_HEADINGS, soTemplateRow } from "@/lib/tally/sales-order-template";

/**
 * Sales Order rows for tests, in the import template's layout (every field of the catalogue, by its exact Tally
 * name). All data is invented. The helpers fill every field Tally's matrix marks Y with a valid value, so a test
 * changes only what it is about.
 */

/** The template's headings, and the mapping that reads them (every column maps itself). */
export const SO_HEADERS: string[] = [...SO_TEMPLATE_HEADINGS];
export const SO_MAPPING: Record<string, number> = Object.fromEntries(SO_FIELDS.map((f, i) => [f.key, i]));

export type SoCells = Record<string, string>;

/** The order-level Y fields: an unregistered buyer (so no GSTIN is needed unless given), the consignee = the buyer. */
export const soVoucher = (party: string): SoCells => ({
  voucherType: "Sales Order",
  narration: "Test order",
  costCentreClass: "Primary Cost Category",
  gstRegistration: "Test Registration",
  referenceNo: "PO-1",
  orderDate: "28-03-2025",
  paymentTerms: "30 days",
  otherReferences: "None",
  deliveryTerms: "Ex-works",
  dispatchedThrough: "Road",
  destination: "Pune",
  carrier: "Test Transport",
  buyerBillTo: party,
  buyerAddressType: "Primary",
  buyerMailingName: party,
  buyerAddress: "1 Test Road",
  buyerCountry: "India",
  buyerState: "Maharashtra",
  buyerRegType: "Unregistered/Consumer",
  buyerBillOfEntry: "No",
  buyerSec7: "No",
  placeOfSupply: "Maharashtra",
  buyerPincode: "411001",
  supplyType: "Goods",
  isOptional: "No",
  isPostDated: "No",
  isCancelled: "No",
  changeMode: "Item Invoice",
});

/** Every ledger entry's own Y fields. */
export const soEntry: SoCells = { ledgerRate: "0", ledgerNarration: "Narration", ledgerDescription: "Description" };

/** A product line's Y fields beyond item, quantity, rate and amount: GST and HSN/SAC from Tally's masters, one delivery. */
export const soLine = (amount: string, dueDate = "30-04-2027"): SoCells => ({
  ratePer: "Nos",
  itemDescription: "Standard",
  gstRateDetails: "As per Masters/Company",
  reverseCharge: "No",
  itcEligible: "No",
  taxableValue: amount,
  hsnDetails: "As per Masters/Company",
  dueDate,
});

export const soRow = (cells: SoCells): string[] => soTemplateRow(cells);

/**
 * A whole order on one row: the voucher, the customer's ledger entry (the total) and one product line of quantity 1
 * at that amount. `over` replaces any cell (an empty string clears it).
 */
export function soOrder(no: string, date: string, party: string, amount: string, over: SoCells = {}, item = "Gear Motor"): string[] {
  return soRow({ documentNo: no, documentDate: date, partyName: party, amount, drCr: "Dr", ...soVoucher(party), ...soEntry, itemName: item, quantity: "1", rate: amount, lineAmount: amount, ...soLine(amount), ...over });
}
