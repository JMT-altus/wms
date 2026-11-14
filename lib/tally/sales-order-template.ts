import { SO_EMPTY_SECTIONS, SO_ORDER_FIELDS, SO_UPDATE_ONLY, soField, type SoField } from "./sales-order-catalogue";
import { BASE_CATALOGUE, describeRule, importFields, type SoCatalogue } from "./sales-order-config";

/**
 * The Sales Order import template: every field of the Sales Order field
 * catalogue that a new order carries (Tally's matrix, Sales Order column: Y, ?
 * and Provision, and the x fields the WMS offers as optional ones), headed
 * with its exact Tally name, in the matrix's order. Pure data — the workbook
 * itself is written in the browser (lib/tally/workbook.ts), the only place
 * `xlsx` is loaded.
 *
 * The data sheet holds headings only, exactly like Tally's sample: a worked
 * example and the notes live on their own sheets, so nothing in the template
 * can be imported by accident.
 */

export const SO_TEMPLATE_FILE = "Sales Order import template.xlsx";
export const SO_TEMPLATE_SHEET = "Accounting Voucher";

/** The catalogue's Tally names. Every heading here maps itself on upload. */
export const SO_TEMPLATE_HEADINGS: readonly string[] = SO_ORDER_FIELDS.map((f) => f.tallyName);

/** One template row from cells keyed by field key. */
export const soTemplateRow = (cells: Readonly<Record<string, string>>): string[] => SO_ORDER_FIELDS.map((f) => cells[f.key] ?? "");

const GOODS_GST = { gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", gstNature: "Local Sales - Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9", reverseCharge: "No", itcEligible: "No", hsnDetails: "Specify Details Here", hsn: "85015210", hsnDescription: "Electric motors" };

/** Two invented orders, every Y field filled. The first: two products (the second split over two delivery dates), a sales and a tax ledger. The second: a separate consignee, GST and HSN/SAC as per Tally's masters. */
const EXAMPLE_CELLS: Record<string, string>[] = [
  ({
    documentDate: "01-04-2026", voucherType: "Sales Order", documentNo: "SO/EXAMPLE/001", narration: "Example only", costCentreClass: "Example Class", gstRegistration: "Example Registration",
    referenceNo: "PO-EXAMPLE-77", orderDate: "28-03-2026", paymentTerms: "30 days", otherReferences: "Example reference", deliveryTerms: "Ex-works",
    dispatchedThrough: "Road", destination: "Example City", carrier: "Example Transport",
    buyerBillTo: "Example Customer Pvt Ltd", buyerAddressType: "Primary", buyerMailingName: "Example Customer Pvt Ltd", buyerAddress: "1 Example Road", buyerCountry: "India", buyerState: "Maharashtra", buyerRegType: "Regular", gstin: "27ABCDE1234F1Z5", buyerBillOfEntry: "No", buyerSec7: "No", placeOfSupply: "Maharashtra", buyerPincode: "400001",
    supplyType: "Goods", isOptional: "No", isPostDated: "No", isCancelled: "No", changeMode: "Item Invoice",
    partyName: "Example Customer Pvt Ltd", amount: "11800.00", drCr: "Dr", ledgerRate: "0", ledgerNarration: "Customer", ledgerDescription: "Customer ledger",
  }),
  ({
    partyName: "Sales", amount: "10000.00", drCr: "Cr", ledgerRate: "0", ledgerNarration: "Sales", ledgerDescription: "Sales ledger",
    itemName: "Example Item A", itemDescription: "Example description A", quantity: "10", rate: "400.00", ratePer: "Nos", lineAmount: "4000.00", taxableValue: "4000.00", ...GOODS_GST,
    dueDate: "15-04-2026",
  }),
  ({
    itemName: "Example Item B", itemDescription: "With mounting kit", quantity: "3", rate: "2000.00", ratePer: "Nos", lineAmount: "6000.00", taxableValue: "6000.00", ...GOODS_GST,
    allocQuantity: "2", allocRate: "2000.00", allocRatePer: "Nos", allocAmount: "4000.00", dueDate: "20-04-2026",
  }),
  ({ allocQuantity: "1", allocRate: "2000.00", allocRatePer: "Nos", allocAmount: "2000.00", dueDate: "30-04-2026" }),
  ({ partyName: "Output IGST 18%", amount: "1800.00", drCr: "Cr", ledgerRate: "18", ledgerNarration: "Tax", ledgerDescription: "IGST output" }),
  ({
    documentDate: "02-04-2026", voucherType: "Sales Order", documentNo: "SO/EXAMPLE/002", narration: "Example only", costCentreClass: "Example Class", gstRegistration: "Example Registration",
    referenceNo: "PO-EXAMPLE-78", orderDate: "01-04-2026", paymentTerms: "Advance", otherReferences: "Example reference", deliveryTerms: "Door delivery",
    dispatchedThrough: "Road", destination: "Example Town", carrier: "Example Transport",
    buyerBillTo: "Another Example Customer", buyerAddressType: "Primary", buyerMailingName: "Another Example Customer", buyerAddress: "2 Example Street", buyerCountry: "India", buyerState: "Karnataka", buyerRegType: "Unregistered/Consumer", buyerBillOfEntry: "No", buyerSec7: "No", placeOfSupply: "Karnataka", buyerPincode: "560001",
    consignee: "Example Site Office", consigneeMailingName: "Example Site Office", consigneeAddressType: "Site", consigneeAddress: "3 Example Lane", consigneeState: "Karnataka", consigneeCountry: "India", consigneeGstin: "29ABCDE1234F1Z5", consigneePincode: "560002",
    supplyType: "Goods", isOptional: "No", isPostDated: "No", isCancelled: "No", changeMode: "Item Invoice",
    partyName: "Another Example Customer", amount: "2500.00", drCr: "Dr", ledgerRate: "0", ledgerNarration: "Customer", ledgerDescription: "Customer ledger",
  }),
  ({
    partyName: "Sales", amount: "2500.00", drCr: "Cr", ledgerRate: "0", ledgerNarration: "Sales", ledgerDescription: "Sales ledger",
    itemName: "Example Item A", itemDescription: "Example description A", quantity: "5", rate: "500.00", ratePer: "Nos", lineAmount: "2500.00",
    gstRateDetails: "As per Masters/Company", gstSourceType: "Stock Item", reverseCharge: "No", itcEligible: "No", taxableValue: "2500.00", hsnDetails: "As per Masters/Company", hsnSourceType: "Stock Item",
    dueDate: "10-04-2026",
  }),
];
export const SO_TEMPLATE_EXAMPLE: string[][] = [[...SO_TEMPLATE_HEADINGS], ...EXAMPLE_CELLS.map(soTemplateRow)];

/** "Yes", "Yes, when …", "When it applies" or "Optional": the Required column of the Read Me and the matrix report. */
export function requirementText(f: SoField): string {
  if (f.outsideMatrix) return "Optional — marked x in the Read Me, kept by the WMS";
  if (f.requirement === "provision") return "Optional (Provision)";
  if (f.requirement === "conditional" && f.mandatoryWhen) return `When it applies (?) — required when ${soField(f.mandatoryWhen.field).tallyName} is ${f.mandatoryWhen.values.map((v) => `“${v}”`).join(" or ")}`;
  if (f.requirement === "conditional") return "When it applies (?)";
  if (f.mandatoryWhen) return `Yes, when ${soField(f.mandatoryWhen.field).tallyName} is ${f.mandatoryWhen.values.map((v) => `“${v}”`).join(" or ")}`;
  if (f.notEnforced) return `Optional — yellow in the matrix, not enforced: ${f.notEnforced}`;
  if (f.defaultsFrom) return `Yes — blank means ${soField(f.defaultsFrom).tallyName}`;
  return "Yes";
}

export const SO_TEMPLATE_README: string[][] = [
  ["Sales Order import — how the WMS reads this file"],
  [""],
  ["Fill the \"Accounting Voucher\" sheet. Keep the headings as they are; the order of the columns doesn't matter."],
  ["The headings are TallyPrime's own field names, so a Sales Order file prepared for Tally can be uploaded as it is. Other Tally columns are recognised and ignored."],
  [""],
  ["ONE SALES ORDER, MANY ROWS"],
  ["The first row of an order carries the Voucher Date, Voucher Type Name, Voucher Number and the customer's ledger entry. The customer's Ledger Amount (Dr) is the order total."],
  ["The rows below it belong to the same order: leave their Voucher Number blank, or repeat it."],
  ["Each product is one row: Item Name, Item Description, Billed Quantity, Item Rate, Item Rate per, Item Amount and its GST and HSN/SAC details."],
  ["A product delivered in parts has more allocations: put each further allocation on its own row under the product (Item Allocations - … only)."],
  ["Tax, freight, discount and round-off ledgers go on their own rows, with no item. Every ledger entry needs its Ledger Rate (0 where it has none), Ledger Narration and Description of Ledger."],
  ["Order, dispatch, buyer, consignee and voucher-state columns may be on any row of the order, but only once per order (or the same value repeated)."],
  ["Leave every Consignee column blank when the goods go to the buyer. All rows of one order must be together."],
  [""],
  ["Column", "Section", "Required", "What the WMS checks"],
  ...SO_ORDER_FIELDS.map((f) => [f.tallyName, f.section, requirementText(f), f.rule + (f.options ? ` Values: ${f.options.join(", ")}.` : "")]),
  [""],
  ["NOT IMPORTED"],
  [`Fields Tally's matrix marks x for Sales Orders that aren't columns above (whole sections: ${SO_EMPTY_SECTIONS.join(", ")}; and single fields elsewhere) are ignored when present; the upload says why for each one.`],
  [`${SO_UPDATE_ONLY.join(", ")}: marked “Update” — they change an existing order, so they aren't imported with a new one. Pre-close a delivery on the order's own page in the WMS.`],
  [""],
  ["WHAT IS NEVER DONE"],
  ["No customer, product or ledger is created or changed by an import. A name the masters don't know is shown for you to match or to add first."],
  ["An order already in the WMS is never overwritten. The same voucher number with different details is refused for review."],
  ["An order with an error on any row is not imported at all — never half of it."],
];

/** The template's headings under a field configuration: every active field available to imports (a custom field by its label). */
export const templateHeadings = (c: SoCatalogue): string[] => importFields(c).map((f) => f.tallyName);
/** One template row under a field configuration, from cells keyed by field key. */
export const templateRow = (c: SoCatalogue, cells: Readonly<Record<string, string>>): string[] => importFields(c).map((f) => cells[f.key] ?? "");

/** "Required" for the Read Me under a configuration: a setting's rule in words, else the matrix's own wording. */
const requiredText = (c: SoCatalogue, key: string): string => {
  const f = c.byKey.get(key)!;
  return f.isCustom || f.setting?.requirement ? describeRule(f.requirementRule, c) : requirementText(f);
};

/**
 * The downloadable template for a field configuration (the Tally matrix by default): its headings, the worked example
 * laid out in them, and a Read Me listing every field with the rule the import will apply.
 */
export const salesOrderTemplateSheets = (c: SoCatalogue = BASE_CATALOGUE): { name: string; rows: string[][] }[] => {
  if (c === BASE_CATALOGUE) return [
    { name: SO_TEMPLATE_SHEET, rows: [[...SO_TEMPLATE_HEADINGS]] },
    { name: "Example (not imported)", rows: SO_TEMPLATE_EXAMPLE },
    { name: "Read Me", rows: SO_TEMPLATE_README },
  ];
  const fields = importFields(c);
  const table = SO_TEMPLATE_README.findIndex((r) => r[0] === "Column" && r[1] === "Section");
  const readMe = [
    ...SO_TEMPLATE_README.slice(0, table + 1),
    ...fields.map((f) => [f.tallyName, f.section, requiredText(c, f.key), (f.label !== f.tallyName ? `Shown as “${f.label}”. ` : "") + f.rule + (f.options ? ` Values: ${f.options.join(", ")}.` : "")]),
    ...SO_TEMPLATE_README.slice(table + 1 + SO_ORDER_FIELDS.length),
  ];
  return [
    { name: SO_TEMPLATE_SHEET, rows: [templateHeadings(c)] },
    { name: "Example (not imported)", rows: [templateHeadings(c), ...EXAMPLE_CELLS.map((cells) => templateRow(c, cells))] },
    { name: "Read Me", rows: readMe },
  ];
};
