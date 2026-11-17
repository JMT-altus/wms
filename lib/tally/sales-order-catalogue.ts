import { GST_STATES } from "@/lib/masters/gstin";
import { SO_PROVISION_FIELDS } from "./sales-order-provisions";

/**
 * The Sales Order field catalogue — TallyPrime's voucher field matrix, Sales
 * Order column, as the business supplied it (the 12 screenshots of the
 * "List of Fields" sheet). Pure data: the import template, the column
 * mapping, the planner's validation, the manual-entry form and the stored
 * order all read their fields from here, so they can't drift apart.
 *
 * THE MARKINGS (Sales Order column), as the business defined them:
 *   Y          → "mandatory"     every order must carry it
 *   ?          → "conditional"   offered, used when it applies; never required
 *   Provision  → "provision"     offered, optional
 *   x          → not a Sales Order field in the matrix. Every one of them is in the
 *                catalogue all the same, so each can be configured. Those that
 *                describe the order itself and need no master, integration or other
 *                workflow are offered as OPTIONAL WMS fields (`outsideMatrix`,
 *                stored by key — `keyed`), never required. The rest are PROVISIONS
 *                (./sales-order-provisions): off until an administrator enables one
 *                (`defaultOff`), each with why the matrix marks it x (`xVerdict`)
 *                and what the WMS doesn't do for it (`dependency`). While one is off,
 *                a file that carries its column is told it is ignored and why
 *   Update     → (red, not in the business's legend) changing an existing
 *                order, not creating one: the pre-close fields (`workflow:
 *                "preClose"`), entered on the order's page, never imported with a
 *                new order
 * Section headings are categories, never fields.
 *
 * Tally field names are kept EXACTLY as the matrix prints them, including its
 * punctuation ("Order - Date", "Item Allocations - Order Due on"). `key` is the
 * WMS's own name for the field; the keys the importer already used are kept,
 * so a mapping saved before this catalogue still applies.
 *
 * Where a "Y" field is required only in some cases, the case comes from the
 * matrix itself — its own Applicable Values (GST rates are specified only
 * under "Specify Details Here"; there is no GSTIN to give for an
 * "Unregistered/Consumer" buyer) — or from the business's stated rule (the
 * consignee is the buyer unless a separate consignee is given). Each such field
 * carries `mandatoryWhen` / `defaultsFrom`, and the rule text says it plainly.
 * Nothing else about a requirement is inferred.
 */

/** Every section of the Read Me worksheet, in its own order (38). */
export const SO_SECTIONS = [
  "General Details",
  "Ledger Details",
  "Item Details",
  "Order Details",
  "Dispatch/Receipt/Party's Document Details",
  "Export/Import Details",
  "Additional Details",
  "Item Allocations Details",
  "Bill Allocations",
  "Category Allocations",
  "Cost Centre Allocations",
  "Original Invoice Details",
  "e-Invoice Details",
  "e-Way Bill Details",
  "GST Rate & Related Details",
  "HSN/SAC & Related Details",
  "Party Details (Buyer/Supplier)",
  "Party Details (Consignee)",
  "Stat Adjustment (GST)",
  "Type of Supply Details",
  "Voucher Status",
  "Additional Cost",
  "Bank Allocations Details",
  "Point of Sale Details",
  "Advance Payment/Receipt/Refund Details",
  "Tax Type Allocations",
  "GST Advance Adjustment Details",
  "TDS Nature of Payment Details",
  "TDS Party Details",
  "TDS Bill Allocations",
  "TCS Nature of Goods Details",
  "TCS Party Details",
  "TCS Bill Allocations",
  "Stat Adjustment (GST) Details",
  "Stat Adjustment (TDS) Details",
  "Stat Adjustment (TCS) Details",
  "Stat Payment (TDS) Details",
  "Stat Payment (TCS) Details",
] as const;
export type SoSection = (typeof SO_SECTIONS)[number];

/** Sections of the matrix whose every field is marked x for Sales Orders: nothing in them is on unless an administrator enables it. */
export const SO_EMPTY_SECTIONS = [
  "Additional Details",
  "Bill Allocations",
  "e-Invoice Details",
  "e-Way Bill Details",
  "Stat Adjustment (GST)",
  "Bank Allocations Details",
  "Point of Sale Details",
  "Advance Payment/Receipt/Refund Details",
  "Tax Type Allocations",
  "GST Advance Adjustment Details",
  "TDS Nature of Payment Details",
  "TDS Party Details",
  "TDS Bill Allocations",
  "TCS Nature of Goods Details",
  "TCS Party Details",
  "TCS Bill Allocations",
  "Stat Adjustment (GST) Details",
  "Stat Adjustment (TDS) Details",
  "Stat Adjustment (TCS) Details",
  "Stat Payment (TDS) Details",
  "Stat Payment (TCS) Details",
] as const;

export type SoRequirement = "mandatory" | "conditional" | "provision";
/** Where a field lives in an order: once per order (voucher / buyer / consignee), per ledger entry, per product line, per allocation of a product line, per cost-centre allocation of a ledger, or per additional cost. */
export type SoLevel = "voucher" | "buyer" | "consignee" | "ledger" | "item" | "allocation" | "costCentre" | "additionalCost";
export type SoFieldType = "text" | "date" | "amount" | "number" | "percent" | "yesno" | "choice" | "gstin" | "state" | "pincode" | "hsn";

/**
 * Why the matrix marks a field x for a Sales Order — the audit of every one of them:
 *   notApplicable — it belongs to another voucher or a later step (dispatch, invoice, receipt, payment, journal);
 *   external      — it comes from an outside system (the GST e-Invoice or e-Way Bill portal, customs);
 *   approval      — it could apply to an order but changes pricing or needs a master and a workflow the WMS doesn't
 *                   have: a business decision first.
 */
export type SoXStatus = "notApplicable" | "external" | "approval";
/**
 * What stands between a field and working as it does in Tally:
 *   recordOnly — it can be enabled; the WMS stores, imports and shows the value and does nothing else with it;
 *   needsWork  — it can't be enabled until the named technical work is done.
 */
export interface SoDependency {
  kind: "recordOnly" | "needsWork";
  text: string;
}

/**
 * A REPEATING GROUP of Tally's voucher: rows of related fields under one parent — several bill references, bank
 * instruments, tax types or TDS/TCS bills under one ledger entry, or several advance lines under the order. In a file,
 * each row of a group is one row of the voucher carrying that group's cells; it belongs to the ledger entry on its
 * own row, or else to the one above it (as a cost-centre allocation does). Stored as `groups.<key>` rows on the
 * ledger entry or the order. The group's structure is Tally's; which of its fields are on, required or how they are
 * labelled is the configuration's.
 */
export type SoGroupKey = "billAllocations" | "bankAllocations" | "taxTypeAllocations" | "tdsBillAllocations" | "tcsBillAllocations" | "advancePayments";
export interface SoGroup {
  key: SoGroupKey;
  /** The Read Me's own section of the group's fields. */
  section: SoSection;
  /** What one row is, for the screens ("bill allocation"). */
  rowLabel: string;
  /** Rows belong to a ledger entry, or to the order. */
  parent: "ledger" | "voucher";
  /** Tally's own rule: the rows' amounts add up to their ledger entry's amount (a difference is flagged for review). */
  totalField?: string;
}
export const SO_GROUPS: readonly SoGroup[] = [
  { key: "billAllocations", section: "Bill Allocations", rowLabel: "bill allocation", parent: "ledger", totalField: "billAmount" },
  { key: "bankAllocations", section: "Bank Allocations Details", rowLabel: "bank allocation", parent: "ledger", totalField: "bankAmount" },
  { key: "taxTypeAllocations", section: "Tax Type Allocations", rowLabel: "tax type allocation", parent: "ledger", totalField: "taxTypeAmount" },
  { key: "tdsBillAllocations", section: "TDS Bill Allocations", rowLabel: "TDS bill allocation", parent: "ledger" },
  { key: "tcsBillAllocations", section: "TCS Bill Allocations", rowLabel: "TCS bill allocation", parent: "ledger" },
  { key: "advancePayments", section: "Advance Payment/Receipt/Refund Details", rowLabel: "advance line", parent: "voucher" },
];
export const SO_GROUP: Readonly<Record<SoGroupKey, SoGroup>> = Object.fromEntries(SO_GROUPS.map((g) => [g.key, g])) as Record<SoGroupKey, SoGroup>;

/** One stored row of a repeating group: its values by field key (as stored text, like a keyed field's), and its file row. */
export interface SoGroupRow {
  rowNo: number;
  values: Record<string, string>;
}
export type SoGroupRows = Partial<Record<SoGroupKey, SoGroupRow[]>>;

export interface SoField {
  key: string;
  /** A field of a repeating group (stored in its rows, not once per ledger entry or order). */
  group?: SoGroupKey;
  /** Exactly as the matrix prints it. Also the template heading. */
  tallyName: string;
  /** For the form and the screens. */
  label: string;
  section: SoSection;
  requirement: SoRequirement;
  level: SoLevel;
  type: SoFieldType;
  /** The matrix's "Applicable Values", where it lists any. */
  options?: readonly string[];
  /** A mandatory field that applies only when another field holds one of these values. */
  mandatoryWhen?: { field: string; values: readonly string[] };
  /** A mandatory field that takes another field's value when it is left blank (consignee = buyer; a single allocation = its line). */
  defaultsFrom?: string;
  /**
   * A field the matrix highlights as mandatory that the business has decided NOT to enforce, and why. It stays a
   * yellow field in the matrix report (an exception, not a reclassification); a value given is still validated.
   */
  notEnforced?: string;
  /** A conditional field the form shows only when another field holds one of these values. */
  shownWhen?: { field: string; values: readonly string[] };
  /**
   * Other spellings of a listed value that are accepted and stored as the listed value, by their lower-case form
   * (the Read Me worksheet's own spellings, e.g. "Nill Rated" for "Nil Rated").
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * A field the current Read Me worksheet marks x for Sales Orders that the WMS keeps, optional, and why: values
   * already stored stay readable and a column that carries it is still read. Not counted among the Read Me's fields.
   */
  outsideMatrix?: string;
  /**
   * No fixed place in the stored order: the value is kept by its key in the `custom` map of its scope (the order,
   * a product line, an allocation …), exactly like a custom field's, as stored text (dates yyyy-mm-dd, Yes/No).
   */
  keyed?: true;
  /**
   * Not a field of a new order but of a change to an existing one (the matrix marks it "Update"): entered through
   * that workflow on the order's page, never on the entry form or in an import.
   */
  workflow?: "preClose";
  /** A provision: off until an administrator enables it in Admin & Master Setup → Sales Order Fields. */
  defaultOff?: true;
  /** A provision: why the matrix marks it x for a Sales Order. */
  xVerdict?: { status: SoXStatus; why: string };
  /** What the WMS doesn't do for this field, or what must be built before it can be enabled. Absent = nothing. */
  dependency?: SoDependency;
  /** The validation rule, in words, for the template's Read Me, the matrix report and the screens. */
  rule: string;
  /** The row of the field in the business's matrix. */
  matrixRow: number;
  /** Other headings the field is commonly exported under (the mapping's suggestions). The Tally name is always the first. */
  synonyms?: readonly string[];
}

export const YES_NO = ["Yes", "No"] as const;
const SOURCE_TYPES = ["Group", "Ledger", "Stock Group", "Stock Item", "Company"] as const;
export const GST_DETAIL_CHOICES = ["As per Masters/Company", "Specify Details Here", "Use GST Classification"] as const;
const SPECIFY = ["Specify Details Here"] as const;
const AS_PER_MASTERS = ["As per Masters/Company"] as const;
const USE_CLASSIFICATION = ["Use GST Classification"] as const;
/** GST registration types for which a GSTIN exists to be given. */
export const REGISTERED_TYPES = ["Composition", "Regular"] as const;
export const CHANGE_MODES = ["As Voucher", "Item Invoice", "Accounting Invoice", "Use for Stock Journal", "Use for Manufacturing Journal", "Use for Inter-Godown/Location Transfers", "Payslip"] as const;

type Def = Omit<SoField, "section"> & { section?: SoSection };
/** Why an x field is offered at all. */
const OUTSIDE = "Marked x for Sales Orders in the Read Me: offered as an optional WMS field (it describes the order itself and needs no master, integration or other workflow). Never required.";
const in_ = (section: SoSection, defs: Def[]): SoField[] => defs.map((d) => ({ ...d, section }));

/**
 * The fields the WMS has on by default, in the matrix's own order:
 *   · the 91 the "Accounting Voucher (Read Me)" worksheet applies to Sales Orders (65 Y, 18 ?, 8 Provision);
 *   · 21 it marks x that the WMS offers as optional fields (`outsideMatrix`): HSN Description and the 20 audited
 *     as describing the order itself (`keyed`);
 *   · the 3 it marks Update — pre-closing a delivery of an existing order (`workflow: "preClose"`).
 */
const OFFERED_FIELDS: readonly SoField[] = [
  ...in_("General Details", [
    { key: "voucherType", tallyName: "Voucher Type Name", label: "Voucher Type Name", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 3, rule: "A Sales Order voucher type (its name contains “Sales Order”). The same on every row of the order.", synonyms: ["voucher type", "vch type", "type of voucher"] },
    { key: "documentDate", tallyName: "Voucher Date", label: "Voucher Date", requirement: "mandatory", level: "voucher", type: "date", matrixRow: 4, rule: "A real date (dd-mm-yyyy, 1-Apr-26 or yyyy-mm-dd), not before 2000. Sets the financial year.", synonyms: ["date", "vch date", "document date", "sales order date", "so date"] },
    { key: "documentNo", tallyName: "Voucher Number", label: "Voucher Number", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 5, rule: "Unique within its financial year. Rows below the first may leave it blank or repeat it.", synonyms: ["voucher no", "voucher no.", "vch no", "vch no.", "sales order no", "sales order no.", "sales order number", "so no", "so no.", "so number", "document no", "doc no"] },
    { key: "seriesName", tallyName: "Voucher Number Series Name", label: "Voucher Number Series Name", requirement: "conditional", level: "voucher", type: "text", matrixRow: 6, rule: "When the voucher type numbers its vouchers in more than one series." },
    { key: "voucherRefNo", tallyName: "Reference No.", label: "Reference No.", requirement: "provision", level: "voucher", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 7, rule: "Optional: the voucher's own reference number (the customer's order number is Order No(s))." },
    { key: "voucherRefDate", tallyName: "Reference Date", label: "Reference Date", requirement: "provision", level: "voucher", type: "date", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 8, rule: "Optional. A real date." },
    { key: "narration", tallyName: "Voucher Narration", label: "Voucher Narration", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 9, rule: "Required.", synonyms: ["narration", "remarks"] },
    { key: "costCentreClass", tallyName: "Cost Centre/Classes", label: "Cost Centre/Classes", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 10, rule: "The cost centre class the voucher uses, as named in Tally. Required." },
    { key: "voucherClass", tallyName: "Voucher Class", label: "Voucher Class", requirement: "provision", level: "voucher", type: "text", matrixRow: 11, rule: "Optional." },
    { key: "effectiveDate", tallyName: "Voucher Effective Date", label: "Voucher Effective Date", requirement: "provision", level: "voucher", type: "date", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 12, rule: "Optional: the date the voucher takes effect in Tally when it differs from the Voucher Date." },
    { key: "applicableUpto", tallyName: "Voucher Applicable Upto", label: "Voucher Applicable Upto", requirement: "provision", level: "voucher", type: "date", keyed: true, outsideMatrix: OUTSIDE, shownWhen: { field: "isOptional", values: ["Yes"] }, matrixRow: 13, rule: "Optional, for an optional voucher (Optional = Yes): the date up to which it applies. Not before the Voucher Date." },
    { key: "priceLevel", tallyName: "Price Level", label: "Price Level", requirement: "provision", level: "voucher", type: "text", matrixRow: 14, rule: "Optional." },
    { key: "gstRegistration", tallyName: "GST Registration", label: "GST Registration", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 16, rule: "The company's own GST registration the order is made under, as named in Tally. Required." },
  ]),
  ...in_("Ledger Details", [
    { key: "partyName", tallyName: "Ledger Name", label: "Ledger Name", requirement: "mandatory", level: "ledger", type: "text", matrixRow: 18, rule: "Every ledger entry names its ledger. On the order's first row it is the customer, exactly as in the Customer Master; on the other rows the sales, tax and other ledgers.", synonyms: ["party name", "party", "particulars", "ledger", "party's name", "party a/c name", "customer", "customer name", "buyer", "buyer name", "name of party"] },
    { key: "amount", tallyName: "Ledger Amount", label: "Ledger Amount", requirement: "mandatory", level: "ledger", type: "amount", matrixRow: 19, rule: "Every ledger entry's amount. On the customer's entry it is the order total, which must equal the product lines plus the other ledgers.", synonyms: ["amount", "total", "total amount", "order value", "order amount", "voucher amount", "gross total", "gross amount", "net amount", "grand total", "value"] },
    { key: "ledgerRate", tallyName: "Ledger Rate", label: "Ledger Rate", requirement: "mandatory", level: "ledger", type: "number", matrixRow: 20, rule: "Every ledger entry's rate (a number, 0 or more; 0 where the ledger has none)." },
    { key: "drCr", tallyName: "Ledger Amount Dr/Cr", label: "Ledger Amount Dr/Cr", requirement: "conditional", level: "ledger", type: "choice", options: ["Dr", "Cr"], matrixRow: 21, rule: "Dr or Cr, when the amount doesn't say it: the customer is Dr, sales and tax ledgers Cr.", synonyms: ["dr/cr", "dr / cr", "dr cr", "debit/credit"] },
    { key: "ledgerNarration", tallyName: "Ledger Narration", label: "Ledger Narration", requirement: "mandatory", level: "ledger", type: "text", matrixRow: 22, rule: "Every ledger entry's narration. Required." },
    { key: "ledgerDescription", tallyName: "Description of Ledger", label: "Description of Ledger", requirement: "mandatory", level: "ledger", type: "text", matrixRow: 23, rule: "Every ledger entry's description. Required." },
  ]),
  ...in_("Item Details", [
    { key: "itemName", tallyName: "Item Name", label: "Item Name", requirement: "mandatory", level: "item", type: "text", matrixRow: 26, rule: "Must match one item in the Product Master (its Tally item name, SKU code, product name or code), or be matched to one by hand.", synonyms: ["item", "stock item", "stock item name", "name of item", "product", "product name", "description of goods"] },
    { key: "itemDescription", tallyName: "Item Description", label: "Item Description", requirement: "mandatory", level: "item", type: "text", matrixRow: 27, rule: "Required on every product line.", synonyms: ["description of item", "item narration"] },
    { key: "actualQuantity", tallyName: "Actual Quantity", label: "Actual Quantity", requirement: "provision", level: "item", type: "number", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 28, rule: "Optional: the quantity actually supplied when it differs from the Billed Quantity (free units, for example). 0 or more; the amount is still worked out from the Billed Quantity." },
    { key: "quantity", tallyName: "Billed Quantity", label: "Billed Quantity", requirement: "mandatory", level: "item", type: "number", matrixRow: 29, rule: "More than zero.", synonyms: ["billed qty", "quantity", "qty", "qty.", "order quantity"] },
    { key: "quantityUom", tallyName: "Quantity UOM", label: "Quantity UOM", requirement: "provision", level: "item", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 30, rule: "Optional: the unit of the quantity when it differs from Item Rate per (an alternate unit)." },
    { key: "rate", tallyName: "Item Rate", label: "Item Rate", requirement: "mandatory", level: "item", type: "amount", matrixRow: 31, rule: "0 or more. Billed Quantity × Item Rate, less the discount, must equal the Item Amount.", synonyms: ["rate", "unit rate", "price"] },
    { key: "ratePer", tallyName: "Item Rate per", label: "Item Rate per", requirement: "mandatory", level: "item", type: "text", matrixRow: 32, rule: "The unit (Nos, Kg…). A unit different from the Product Master's is flagged for review.", synonyms: ["rate per", "per", "unit", "uom", "units"] },
    { key: "discPct", tallyName: "Disc%", label: "Disc%", requirement: "provision", level: "item", type: "percent", matrixRow: 33, rule: "Optional. 0 to 100.", synonyms: ["discount %", "discount%", "disc %"] },
    { key: "discAmount", tallyName: "Discount Amount", label: "Discount Amount", requirement: "provision", level: "item", type: "amount", matrixRow: 34, rule: "Optional. 0 or more, and not more than the line before discount." },
    { key: "lineAmount", tallyName: "Item Amount", label: "Item Amount", requirement: "mandatory", level: "item", type: "amount", matrixRow: 35, rule: "The line value after discount.", synonyms: ["line amount", "item value", "line value"] },
    { key: "mrp", tallyName: "MRP/Marginal", label: "MRP/Marginal", requirement: "provision", level: "item", type: "amount", matrixRow: 36, rule: "Optional. 0 or more.", synonyms: ["mrp"] },
    { key: "marks", tallyName: "Marks", label: "Marks", requirement: "provision", level: "item", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 39, rule: "Optional: the packing marks." },
    { key: "packages", tallyName: "No. of Packages", label: "No. of Packages", requirement: "provision", level: "item", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 40, rule: "Optional: the number of packages as Tally prints it (\"10 boxes\")." },
  ]),
  ...in_("Order Details", [
    { key: "referenceNo", tallyName: "Order No(s)", label: "Order No(s)", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 42, rule: "The customer's own order / PO number(s). Required.", synonyms: ["order no(s).", "customer order no", "customer order no.", "customer po no", "po no", "po no.", "po number", "purchase order no", "buyer's order no"] },
    { key: "orderDate", tallyName: "Order - Date", label: "Order - Date", requirement: "mandatory", level: "voucher", type: "date", matrixRow: 43, rule: "The date of the customer's order. A date after the Voucher Date is flagged for review.", synonyms: ["order date", "po date", "customer order date"] },
    { key: "paymentTerms", tallyName: "Mode/Terms of Payment", label: "Mode/Terms of Payment", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 44, rule: "Required.", synonyms: ["terms of payment", "payment terms", "mode of payment"] },
    { key: "otherReferences", tallyName: "Other References", label: "Other References", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 45, rule: "Required." },
    { key: "deliveryTerms", tallyName: "Terms of Delivery", label: "Terms of Delivery", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 46, rule: "Required.", synonyms: ["delivery terms"] },
  ]),
  ...in_("Dispatch/Receipt/Party's Document Details", [
    { key: "dispatchedThrough", tallyName: "Dispatched through", label: "Dispatched through", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 51, rule: "Required." },
    { key: "destination", tallyName: "Destination", label: "Destination", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 52, rule: "Required." },
    { key: "carrier", tallyName: "Carrier Name/Agent", label: "Carrier Name/Agent", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 53, rule: "Required.", synonyms: ["carrier name", "carrier", "transporter"] },
  ]),
  ...in_("Export/Import Details", [
    { key: "shipperReceiptPlace", tallyName: "Place of Receipt by Shipper", label: "Place of Receipt by Shipper", requirement: "provision", level: "voucher", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 58, rule: "Optional, for an export order: where the shipper receives the goods." },
    { key: "vesselFlightNo", tallyName: "Vessel/Flight No.", label: "Vessel/Flight No.", requirement: "provision", level: "voucher", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 59, rule: "Optional, for an export order, when known." },
    { key: "portOfLoading", tallyName: "Port of Loading", label: "Port of Loading", requirement: "provision", level: "voucher", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 60, rule: "Optional, for an export order." },
    { key: "portOfDischarge", tallyName: "Port of Discharge", label: "Port of Discharge", requirement: "provision", level: "voucher", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 61, rule: "Optional, for an export order." },
    { key: "countryTo", tallyName: "Country to", label: "Country to", requirement: "provision", level: "voucher", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 62, rule: "Optional, for an export order: the country of destination." },
  ]),
  ...in_("Item Allocations Details", [
    { key: "allocTrackingNo", tallyName: "Item Allocations - Tracking No.", label: "Tracking No.", requirement: "conditional", level: "allocation", type: "text", matrixRow: 75, rule: "When the allocation is tracked to a delivery or receipt note." },
    { key: "allocOrderNo", tallyName: "Item Allocations - Order No.", label: "Order No.", requirement: "conditional", level: "allocation", type: "text", matrixRow: 76, rule: "When the allocation belongs to a particular order number." },
    { key: "allocActualQuantity", tallyName: "Item Allocations - Actual Quantity", label: "Actual Quantity", requirement: "provision", level: "allocation", type: "number", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 78, rule: "Optional: the quantity actually supplied on this delivery when it differs from its Billed Quantity. 0 or more." },
    { key: "allocQuantity", tallyName: "Item Allocations - Billed Quantity", label: "Billed Quantity", requirement: "mandatory", level: "allocation", type: "number", defaultsFrom: "quantity", matrixRow: 79, rule: "More than zero. The allocations of a line add up to its Billed Quantity. Left blank on a line with one allocation, it is the line's own." },
    { key: "allocUom", tallyName: "Item Allocations - UOM", label: "UOM", requirement: "provision", level: "allocation", type: "text", keyed: true, outsideMatrix: OUTSIDE, matrixRow: 80, rule: "Optional: the unit of this delivery's quantity when it differs from its Rate per." },
    { key: "allocRate", tallyName: "Item Allocations - Rate", label: "Rate", requirement: "mandatory", level: "allocation", type: "amount", defaultsFrom: "rate", matrixRow: 81, rule: "0 or more. Left blank on a line with one allocation, it is the line's own." },
    { key: "allocRatePer", tallyName: "Item Allocations - Rate per", label: "Rate per", requirement: "mandatory", level: "allocation", type: "text", defaultsFrom: "ratePer", matrixRow: 82, rule: "The unit. Left blank on a line with one allocation, it is the line's own." },
    { key: "allocAmount", tallyName: "Item Allocations - Amount", label: "Amount", requirement: "mandatory", level: "allocation", type: "amount", defaultsFrom: "lineAmount", matrixRow: 83, rule: "Quantity × rate, less the discount. The allocations of a line add up to its Item Amount. Left blank on a line with one allocation, it is the line's own." },
    { key: "dueDate", tallyName: "Item Allocations - Order Due on", label: "Order Due on", requirement: "mandatory", level: "allocation", type: "date", matrixRow: 86, rule: "Required on every allocation. A date before the Voucher Date is flagged for review. The earliest becomes the order's due date.", synonyms: ["order due on", "due on", "due date", "delivery date", "expected delivery date"] },
    { key: "preCloseQuantity", tallyName: "Item Allocations - Pre-Close Quantity", label: "Pre-Close Quantity", requirement: "mandatory", level: "allocation", type: "number", workflow: "preClose", matrixRow: 87, rule: "More than zero, and not more than the delivery's open quantity: its Billed Quantity less what is already pre-closed." },
    { key: "preCloseReason", tallyName: "Item Allocations - Reason for Pre-Close", label: "Reason for Pre-Close", requirement: "mandatory", level: "allocation", type: "text", workflow: "preClose", matrixRow: 88, rule: "Why the rest of the delivery won't be supplied. Up to 500 characters." },
    { key: "preCloseDate", tallyName: "Item Allocations - Pre-Close Date", label: "Pre-Close Date", requirement: "mandatory", level: "allocation", type: "date", workflow: "preClose", matrixRow: 89, rule: "A real date, not before the Voucher Date and not after today." },
    { key: "allocDiscPct", tallyName: "Item Allocations - Disc%", label: "Disc%", requirement: "provision", level: "allocation", type: "percent", matrixRow: 90, rule: "Optional. 0 to 100." },
    { key: "allocDiscAmount", tallyName: "Item Allocations - Discount Amount", label: "Discount Amount", requirement: "provision", level: "allocation", type: "amount", matrixRow: 91, rule: "Optional. 0 or more." },
    { key: "allocCostTracking", tallyName: "Item Allocations - Cost Tracking To", label: "Cost Tracking To", requirement: "conditional", level: "allocation", type: "text", matrixRow: 92, rule: "When the company tracks costs to a tracking number." },
  ]),
  ...in_("Category Allocations", [
    { key: "categoryName", tallyName: "Category Name", label: "Category Name", requirement: "provision", level: "costCentre", type: "text", matrixRow: 111, rule: "Optional: the cost category of the cost-centre allocation on the same row." },
  ]),
  ...in_("Cost Centre Allocations", [
    { key: "costCentre", tallyName: "Cost Allocation for - Cost Centre", label: "Cost Centre", requirement: "conditional", level: "costCentre", type: "text", matrixRow: 113, rule: "When the ledger is allocated to cost centres: given with its amount. It belongs to the ledger entry on its row (or the one above it)." },
    { key: "costCentreAmount", tallyName: "Cost Allocation for - Amount", label: "Cost Centre Amount", requirement: "conditional", level: "costCentre", type: "amount", matrixRow: 114, rule: "With a cost centre. A ledger's allocations that don't add up to its amount are flagged for review." },
  ]),
  ...in_("Original Invoice Details", [
    { key: "originalSalesNature", tallyName: "Nature of Original Sales", label: "Nature of Original Sales", requirement: "conditional", level: "voucher", type: "choice", options: ["Not Applicable", "B2C (Small)", "B2C (Large)"], matrixRow: 118, rule: "When applicable: one of the listed values." },
  ]),
  ...in_("GST Rate & Related Details", [
    { key: "gstRateDetails", tallyName: "GST Rate Details", label: "GST Rate Details", requirement: "mandatory", level: "item", type: "choice", options: GST_DETAIL_CHOICES, matrixRow: 181, rule: "One of the listed values, on every product line." },
    { key: "gstSource", tallyName: "GST Source of Details", label: "GST Source of Details", requirement: "conditional", level: "item", type: "text", shownWhen: { field: "gstRateDetails", values: AS_PER_MASTERS }, matrixRow: 182, rule: "When the rates come “As per Masters/Company”." },
    { key: "gstSourceType", tallyName: "GST Source Type of Master", label: "GST Source Type of Master", requirement: "conditional", level: "item", type: "choice", options: SOURCE_TYPES, shownWhen: { field: "gstRateDetails", values: AS_PER_MASTERS }, matrixRow: 183, rule: "When the rates come “As per Masters/Company”: one of the listed values." },
    { key: "gstTaxability", tallyName: "GST Taxability Type", label: "GST Taxability Type", requirement: "mandatory", level: "item", type: "choice", options: ["Exempt", "Nil Rated", "Non-GST", "Taxable"], aliases: { "nill rated": "Nil Rated" }, shownWhen: { field: "gstRateDetails", values: SPECIFY }, mandatoryWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 184, rule: "Required when GST Rate Details is “Specify Details Here”: one of the listed values (“Nill Rated”, the Read Me's spelling, is read as Nil Rated)." },
    { key: "gstNature", tallyName: "GST Nature of Transaction", label: "GST Nature of Transaction", requirement: "conditional", level: "item", type: "choice", options: ["System Inferred", "Local Sales - Taxable", "Interstate Sales - Taxable", "Interstate Deemed Exports - Taxable", "Exports - Taxable", "Sales to SEZ - Taxable"], aliases: { "system infered": "System Inferred" }, shownWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 185, rule: "When the rates are specified here: one of the listed values (“System Infered”, the Read Me's spelling, is read as System Inferred)." },
    { key: "gstClassification", tallyName: "GST Classification", label: "GST Classification", requirement: "conditional", level: "item", type: "text", shownWhen: { field: "gstRateDetails", values: USE_CLASSIFICATION }, mandatoryWhen: { field: "gstRateDetails", values: USE_CLASSIFICATION }, matrixRow: 186, rule: "Required when GST Rate Details is “Use GST Classification”: the classification's name in Tally." },
    { key: "igstRate", tallyName: "IGST Rate", label: "IGST Rate", requirement: "mandatory", level: "item", type: "percent", mandatoryWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 187, rule: "Required when GST Rate Details is “Specify Details Here” (otherwise the rate comes from Tally's masters). 0 to 100. IGST = CGST + SGST/UTGST, or the line is flagged." },
    { key: "cgstRate", tallyName: "CGST Rate", label: "CGST Rate", requirement: "mandatory", level: "item", type: "percent", mandatoryWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 188, rule: "Required when GST Rate Details is “Specify Details Here”. 0 to 100." },
    { key: "sgstRate", tallyName: "SGST/UTGST Rate", label: "SGST/UTGST Rate", requirement: "mandatory", level: "item", type: "percent", mandatoryWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 189, rule: "Required when GST Rate Details is “Specify Details Here”. 0 to 100." },
    { key: "cessRate", tallyName: "Cess Rate", label: "Cess Rate", requirement: "provision", level: "item", type: "percent", keyed: true, outsideMatrix: OUTSIDE, shownWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 190, rule: "Optional, with “Specify Details Here”: the cess rate. 0 to 100." },
    { key: "cessPerUnit", tallyName: "Cess Rate Per Unit", label: "Cess Rate Per Unit", requirement: "provision", level: "item", type: "amount", keyed: true, outsideMatrix: OUTSIDE, shownWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 191, rule: "Optional, with “Specify Details Here”: cess as an amount per unit. 0 or more." },
    { key: "stateCessRate", tallyName: "State Cess Rate", label: "State Cess Rate", requirement: "provision", level: "item", type: "percent", keyed: true, outsideMatrix: OUTSIDE, shownWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 192, rule: "Optional, with “Specify Details Here”: the state cess rate. 0 to 100." },
    { key: "reverseCharge", tallyName: "Applicable for Reverse Charge", label: "Applicable for Reverse Charge", requirement: "mandatory", level: "item", type: "yesno", options: YES_NO, matrixRow: 193, rule: "Yes or No, on every product line." },
    { key: "gstOnMrp", tallyName: "Calculate GST on MRP (Incl. Tax)", label: "Calculate GST on MRP (Incl. Tax)", requirement: "provision", level: "item", type: "yesno", options: YES_NO, keyed: true, outsideMatrix: OUTSIDE, shownWhen: { field: "gstRateDetails", values: SPECIFY }, matrixRow: 194, rule: "Optional, with “Specify Details Here”: Yes or No." },
    { key: "itcEligible", tallyName: "Eligible for Input Tax Credit", label: "Eligible for Input Tax Credit", requirement: "mandatory", level: "item", type: "yesno", options: YES_NO, matrixRow: 195, rule: "Yes or No, on every product line." },
    { key: "taxableValue", tallyName: "Taxable Value", label: "Taxable Value", requirement: "mandatory", level: "item", type: "amount", matrixRow: 196, rule: "0 or more, on every product line. One that differs from the Item Amount is flagged for review." },
  ]),
  ...in_("HSN/SAC & Related Details", [
    { key: "hsnDetails", tallyName: "HSN/SAC Details", label: "HSN/SAC Details", requirement: "mandatory", level: "item", type: "choice", options: GST_DETAIL_CHOICES, matrixRow: 198, rule: "One of the listed values, on every product line." },
    { key: "hsnSource", tallyName: "HSN/SAC Source of Details", label: "HSN/SAC Source of Details", requirement: "conditional", level: "item", type: "text", shownWhen: { field: "hsnDetails", values: AS_PER_MASTERS }, matrixRow: 199, rule: "When the HSN/SAC comes “As per Masters/Company”." },
    { key: "hsnSourceType", tallyName: "HSN/SAC Source Type of Master", label: "HSN/SAC Source Type of Master", requirement: "conditional", level: "item", type: "choice", options: SOURCE_TYPES, shownWhen: { field: "hsnDetails", values: AS_PER_MASTERS }, matrixRow: 200, rule: "When the HSN/SAC comes “As per Masters/Company”: one of the listed values." },
    { key: "hsnClassification", tallyName: "HSN/SAC Classification", label: "HSN/SAC Classification", requirement: "conditional", level: "item", type: "text", shownWhen: { field: "hsnDetails", values: ["Use GST Classification"] }, matrixRow: 201, rule: "When HSN/SAC Details is “Use GST Classification”: the classification's name in Tally." },
    { key: "hsn", tallyName: "HSN/SAC", label: "HSN/SAC", requirement: "mandatory", level: "item", type: "hsn", mandatoryWhen: { field: "hsnDetails", values: SPECIFY }, matrixRow: 202, rule: "Required when HSN/SAC Details is “Specify Details Here”. 4, 6 or 8 digits.", synonyms: ["hsn", "hsn code", "sac", "hsn/sac code"] },
    { key: "hsnDescription", tallyName: "HSN Description", label: "HSN Description", requirement: "provision", level: "item", type: "text", shownWhen: { field: "hsnDetails", values: SPECIFY }, outsideMatrix: "The current Read Me marks it x for Sales Orders. Kept optional so descriptions already stored stay on their orders and a column that carries one is still read.", matrixRow: 203, rule: "Optional, with HSN/SAC Details “Specify Details Here” (marked x in the current Read Me; kept so stored descriptions remain)." },
  ]),
  ...in_("Party Details (Buyer/Supplier)", [
    { key: "buyerBillTo", tallyName: "Buyer/Supplier - Bill to/from", label: "Bill to", requirement: "mandatory", level: "buyer", type: "text", matrixRow: 205, rule: "Required." },
    { key: "buyerAddressType", tallyName: "Buyer/Supplier - Address Type", label: "Address Type", requirement: "mandatory", level: "buyer", type: "text", matrixRow: 206, rule: "Required: the address type's name in Tally." },
    { key: "buyerMailingName", tallyName: "Buyer/Supplier - Mailing Name", label: "Mailing Name", requirement: "mandatory", level: "buyer", type: "text", matrixRow: 207, rule: "Required." },
    { key: "buyerAddress", tallyName: "Buyer/Supplier - Address", label: "Address", requirement: "mandatory", level: "buyer", type: "text", matrixRow: 208, rule: "Required." },
    { key: "buyerCountry", tallyName: "Buyer/Supplier - Country", label: "Country", requirement: "mandatory", level: "buyer", type: "text", matrixRow: 209, rule: "Required." },
    { key: "buyerState", tallyName: "Buyer/Supplier - State", label: "State", requirement: "mandatory", level: "buyer", type: "state", matrixRow: 210, rule: "Required. In India, the state's official GST name." },
    { key: "buyerRegType", tallyName: "Buyer/Supplier - GST Registration Type", label: "GST Registration Type", requirement: "mandatory", level: "buyer", type: "choice", options: ["Unknown", "Composition", "Regular", "Unregistered/Consumer"], matrixRow: 211, rule: "One of the listed values." },
    { key: "buyerOtherTerritory", tallyName: "Buyer/Supplier - Assessee of Other Territory", label: "Assessee of Other Territory", requirement: "provision", level: "buyer", type: "yesno", options: YES_NO, keyed: true, outsideMatrix: OUTSIDE, matrixRow: 212, rule: "Optional: Yes or No." },
    { key: "gstin", tallyName: "Buyer/Supplier - GSTIN/UIN", label: "GSTIN/UIN", requirement: "mandatory", level: "buyer", type: "gstin", mandatoryWhen: { field: "buyerRegType", values: REGISTERED_TYPES }, matrixRow: 213, rule: "Required for a Regular or Composition buyer (an unregistered buyer has none). A valid 15-character GSTIN; it identifies the customer ahead of the name. Its state code differing from the State is flagged.", synonyms: ["gstin/uin", "gstin", "gst no", "gst no.", "gst number", "party gstin", "party gstin/uin"] },
    { key: "buyerBillOfEntry", tallyName: "Buyer/Supplier - Is Bill of Entry available", label: "Is Bill of Entry available", requirement: "mandatory", level: "buyer", type: "yesno", options: YES_NO, matrixRow: 214, rule: "Yes or No. Required; no value is assumed." },
    { key: "buyerSec7", tallyName: "Buyer/Supplier - Supplies under section 7 of IGST Act", label: "Supplies under section 7 of IGST Act", requirement: "mandatory", level: "buyer", type: "yesno", options: YES_NO, matrixRow: 215, rule: "Yes or No." },
    { key: "placeOfSupply", tallyName: "Buyer/Supplier - Place of Supply", label: "Place of Supply", requirement: "mandatory", level: "buyer", type: "state", matrixRow: 216, rule: "Required. In India, the state's official GST name." },
    { key: "buyerPincode", tallyName: "Buyer/Supplier - Pincode", label: "Pincode", requirement: "mandatory", level: "buyer", type: "pincode", matrixRow: 217, rule: "Required. In India, 6 digits. (The matrix lists India, Botswana, Philippines, Ghana, Kenya and UK against it: the countries Tally asks it for.)" },
  ]),
  ...in_("Party Details (Consignee)", [
    { key: "consignee", tallyName: "Consignee (ship to)", label: "Consignee (ship to)", requirement: "mandatory", level: "consignee", type: "text", defaultsFrom: "buyerBillTo", matrixRow: 219, rule: "Required. Leave every consignee column blank when the goods go to the buyer: the buyer's details are used. Once any consignee column is filled, all of them are required." },
    { key: "consigneeMailingName", tallyName: "Consignee - Mailing Name", label: "Mailing Name", requirement: "mandatory", level: "consignee", type: "text", defaultsFrom: "buyerMailingName", matrixRow: 220, rule: "As Consignee (ship to)." },
    { key: "consigneeAddressType", tallyName: "Consignee - Address Type", label: "Address Type", requirement: "mandatory", level: "consignee", type: "text", defaultsFrom: "buyerAddressType", matrixRow: 221, rule: "As Consignee (ship to)." },
    { key: "consigneeAddress", tallyName: "Consignee - Address", label: "Address", requirement: "mandatory", level: "consignee", type: "text", defaultsFrom: "buyerAddress", matrixRow: 222, rule: "As Consignee (ship to)." },
    { key: "consigneeState", tallyName: "Consignee - State", label: "State", requirement: "mandatory", level: "consignee", type: "state", defaultsFrom: "buyerState", matrixRow: 223, rule: "As Consignee (ship to). In India, the state's official GST name." },
    { key: "consigneeCountry", tallyName: "Consignee - Country", label: "Country", requirement: "mandatory", level: "consignee", type: "text", defaultsFrom: "buyerCountry", matrixRow: 224, rule: "As Consignee (ship to)." },
    { key: "consigneeGstin", tallyName: "Consignee - GSTIN/UIN", label: "GSTIN/UIN", requirement: "mandatory", level: "consignee", type: "gstin", defaultsFrom: "gstin", notEnforced: "Tally's matrix gives a consignee no GST registration type, so an unregistered consignee would otherwise be impossible (business decision, 13 Nov 2026).", matrixRow: 225, rule: "Optional for a separate consignee; when given, a valid 15-character GSTIN. The buyer's when no separate consignee is given." },
    { key: "consigneePincode", tallyName: "Consignee - Pincode", label: "Pincode", requirement: "mandatory", level: "consignee", type: "pincode", defaultsFrom: "buyerPincode", matrixRow: 226, rule: "As Consignee (ship to). In India, 6 digits." },
  ]),
  ...in_("Type of Supply Details", [{ key: "supplyType", tallyName: "Type of Supply", label: "Type of Supply", requirement: "mandatory", level: "voucher", type: "text", matrixRow: 238, rule: "Required. (The matrix lists no values for it.)" }]),
  ...in_("Voucher Status", [
    { key: "isOptional", tallyName: "Optional", label: "Optional", requirement: "mandatory", level: "voucher", type: "yesno", options: YES_NO, matrixRow: 240, rule: "Yes or No." },
    { key: "isPostDated", tallyName: "Post-Dated", label: "Post-Dated", requirement: "mandatory", level: "voucher", type: "yesno", options: YES_NO, matrixRow: 241, rule: "Yes or No." },
    { key: "isCancelled", tallyName: "Cancelled", label: "Cancelled", requirement: "mandatory", level: "voucher", type: "yesno", options: YES_NO, matrixRow: 242, rule: "Yes or No." },
    { key: "changeMode", tallyName: "Change Mode", label: "Change Mode", requirement: "mandatory", level: "voucher", type: "choice", options: CHANGE_MODES, matrixRow: 243, rule: "One of the listed values." },
  ]),
  ...in_("Additional Cost", [
    { key: "addlCostLedger", tallyName: "Additional Cost - Ledger", label: "Additional Cost Ledger", requirement: "conditional", level: "additionalCost", type: "text", matrixRow: 245, rule: "When the order carries an additional cost: its ledger, with a percentage or an amount." },
    { key: "addlCostPct", tallyName: "Additional Cost - Percentage", label: "Percentage", requirement: "conditional", level: "additionalCost", type: "percent", matrixRow: 246, rule: "With an additional cost ledger. 0 to 100." },
    { key: "addlCostAmount", tallyName: "Additional Cost - Amount", label: "Amount", requirement: "conditional", level: "additionalCost", type: "amount", matrixRow: 247, rule: "With an additional cost ledger. 0 or more." },
  ]),
];

/**
 * EVERY field of the Read Me worksheet's Sales Order column (353), in the matrix's own order — the ONE list every
 * screen, the template, the mapping, the planner, the comparison, the order page, the pre-close workflow and Admin &
 * Master Setup read: the 115 above and the 238 provisions (marked x, off until an administrator enables one).
 */
export const SO_FIELDS: readonly SoField[] = [...OFFERED_FIELDS, ...SO_PROVISION_FIELDS].sort((a, b) => a.matrixRow - b.matrixRow);

export const SO_FIELD: Readonly<Record<string, SoField>> = Object.fromEntries(SO_FIELDS.map((f) => [f.key, f]));
export const soField = (key: string): SoField => {
  const f = SO_FIELD[key];
  if (!f) throw new Error(`Unknown Sales Order field ${key}`);
  return f;
};

/** A field of a NEW order (not of the pre-close workflow): what the form, the template, the mapping and the planner use. */
export const isOrderField = (f: Pick<SoField, "workflow">) => !f.workflow;
/** A new order's fields as the matrix alone has them: on by default (a provision is one only once it is enabled). */
export const SO_ORDER_FIELDS: readonly SoField[] = SO_FIELDS.filter((f) => isOrderField(f) && !f.defaultOff);
/** The provisions: marked x, off until an administrator enables one. */
export const SO_PROVISIONS: readonly SoField[] = SO_FIELDS.filter((f) => f.defaultOff);
/** The pre-close workflow's fields (marked "Update"), in the matrix's order. */
export const SO_PRECLOSE_FIELDS: readonly SoField[] = SO_FIELDS.filter((f) => f.workflow === "preClose");

/** Mandatory with no condition and no default: the column must be in every file. */
export const isAlwaysMandatory = (f: SoField) => f.requirement === "mandatory" && !f.mandatoryWhen && !f.defaultsFrom && !f.notEnforced;
/** Whether a blank value can hold an order back at all (before any condition or default is applied). */
export const isEnforced = (f: SoField) => f.requirement === "mandatory" && !f.notEnforced;

/** The provisions by section, exactly as the matrix prints them: marked x and not on by default. While one is off, a column with its heading is recognised and ignored. */
export const SO_NOT_APPLICABLE: Readonly<Record<string, readonly string[]>> = SO_PROVISIONS.reduce<Record<string, string[]>>((by, f) => {
  (by[f.section] ??= []).push(f.tallyName);
  return by;
}, {});

/** The audit's verdict on one provision: why the matrix marks it x for a Sales Order. */
export const xReason = (section: string, tallyName: string): { status: SoXStatus; why: string } => {
  const f = SO_PROVISIONS.find((p) => p.section === section && p.tallyName === tallyName);
  if (!f?.xVerdict) throw new Error(`No x verdict for ${section} / ${tallyName}`);
  return f.xVerdict;
};

/** Marked "Update" (red) — not in the business's legend. They change an existing order (pre-closing a delivery), so creating one never imports them. */
export const SO_UPDATE_ONLY: readonly string[] = SO_PRECLOSE_FIELDS.map((f) => f.tallyName);

// Spaces around "/" don't make a different heading ("Dispatch Doc No. /Receipt Doc No." is the Read Me's own spelling).
export const headingKey = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ").replace(/ ?\/ ?/g, "/");
/** Why a provision that is off isn't imported, and what would bring it in. */
export const provisionOffReason = (f: SoField): string =>
  `not a Sales Order field (${f.section}): ${f.xVerdict!.why} ${f.dependency?.kind === "needsWork" ? f.dependency.text : "An administrator can enable it in Admin & Master Setup → Sales Order Fields."}`;
export const UPDATE_ONLY_REASON = "changes an existing order (marked “Update”): pre-close a delivery on the order's own page";
const IGNORED = new Map<string, string>([
  ...SO_PROVISIONS.map((f) => [headingKey(f.tallyName), provisionOffReason(f)] as [string, string]),
  ...SO_UPDATE_ONLY.map((n) => [headingKey(n), UPDATE_ONLY_REASON] as [string, string]),
]);
/**
 * Why a heading in the file is deliberately not imported under the matrix alone (every provision off), or null when
 * it isn't one of the matrix's excluded fields. Under a configuration, ask ./sales-order-config → ignoredHeading.
 */
export const ignoredHeadingReason = (heading: string): string | null => IGNORED.get(headingKey(heading)) ?? null;

/* ── reading a field's value: the same rules for a file, the form and the server ── */

const YES = new Set(["yes", "y", "true"]);
const NO = new Set(["no", "n", "false"]);
/** true / false, or null when the text is neither. */
export const parseYesNo = (raw: string): boolean | null => {
  const s = raw.trim().toLowerCase();
  return YES.has(s) ? true : NO.has(s) ? false : null;
};

/** A percentage 0–100 with up to three decimals ("18", "2.5 %", "0.25"), or null. */
export function parsePercent(raw: string): number | null {
  const s = raw.trim().replace(/\s*%$/, "");
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

/** The value as the field's list spells it ("specify details here" → "Specify Details Here"), or null when it isn't on the list. */
export const pickOption = (f: SoField, raw: string): string | null => {
  const s = raw.trim().toLowerCase();
  const listed = f.options?.find((o) => o.toLowerCase() === s);
  if (listed) return listed;
  const alias = f.aliases?.[s];
  return alias ? (f.options?.find((o) => o === alias) ?? null) : null;
};

export const isIndia = (country: string | null | undefined) => (country ?? "").trim().toLowerCase() === "india";
/** The official GST state name for India ("maharashtra" → "Maharashtra"), or null. */
export const officialState = (raw: string): string | null => GST_STATES.find((s) => s.toLowerCase() === raw.trim().toLowerCase()) ?? null;
/** 6 digits, not starting with 0, for India; elsewhere 3–10 letters, digits, spaces or hyphens. */
export const validPincode = (raw: string, country: string | null | undefined): boolean => (isIndia(country) ? /^[1-9]\d{5}$/.test(raw.trim()) : /^[A-Za-z0-9 -]{3,10}$/.test(raw.trim()));
/** HSN (4, 6 or 8 digits) or SAC (6 digits). */
export const validHsn = (raw: string): boolean => /^\d{4}(\d{2}){0,2}$/.test(raw.trim());

/* ── the order as it is stored (tally_documents.details, migration 0127, and the extended `lines`) ── */

export interface SoAllocation {
  trackingNo: string | null;
  orderNo: string | null;
  quantity: number;
  ratePaise: number;
  ratePer: string;
  amountPaise: number;
  /** Null only when the configuration has made Order Due on optional and none was given. */
  dueDate: string | null;
  discPct: number | null;
  discountPaise: number | null;
  costTracking: string | null;
  rowNo: number;
  /** Custom allocation fields (Admin & Master Setup → Sales Order Fields), by key. */
  custom?: Record<string, string>;
}

export interface SoGst {
  rateDetails: string;
  source: string | null;
  sourceType: string | null;
  taxability: string | null;
  nature: string | null;
  /** With "Use GST Classification": the classification's name. Absent on orders stored before it existed. */
  classification?: string | null;
  igstRate: number | null;
  cgstRate: number | null;
  sgstRate: number | null;
  reverseCharge: boolean;
  itcEligible: boolean;
  taxablePaise: number;
}

export interface SoHsn {
  details: string;
  source: string | null;
  sourceType: string | null;
  classification: string | null;
  code: string | null;
  description: string | null;
}

/** The product-line fields beyond the ones every Tally document line has. Stored in `lines`. */
export interface SoLineExtras {
  discPct: number | null;
  discountPaise: number | null;
  mrpPaise: number | null;
  allocations: SoAllocation[];
  gst: SoGst;
  hsn: SoHsn;
  /** Custom product-line fields, by key. */
  custom?: Record<string, string>;
}

export interface SoCostCentre {
  category: string | null;
  costCentre: string;
  amountPaise: number;
  rowNo: number;
}

export interface SoLedgerEntry {
  name: string;
  /** The customer's own entry (the order total). */
  isParty: boolean;
  amountPaise: number;
  side: "dr" | "cr" | null;
  rate: number;
  narration: string;
  description: string;
  costCentres: SoCostCentre[];
  rowNo: number;
  /** The Tally Ledgers list entry it was matched to (set by the server; null = the list was empty). */
  listedAs?: string | null;
  /** Custom ledger-entry fields, by key. */
  custom?: Record<string, string>;
  /** Its repeating groups' rows (bill, bank, tax type, TDS and TCS bill allocations), when any were given. */
  groups?: SoGroupRows;
}

export interface SoParty {
  billTo: string;
  addressType: string;
  mailingName: string;
  address: string;
  country: string;
  state: string;
  gstin: string | null;
  pincode: string;
}

export interface SoAdditionalCost {
  ledger: string;
  percent: number | null;
  amountPaise: number | null;
  rowNo: number;
  listedAs?: string | null;
  /** Custom additional-cost fields, by key. */
  custom?: Record<string, string>;
}

/** Everything about an order that isn't one of tally_documents' own columns or a product line. */
export interface SalesOrderDetails {
  version: 1;
  voucher: {
    typeName: string;
    seriesName: string | null;
    narration: string;
    costCentreClass: string;
    voucherClass: string | null;
    priceLevel: string | null;
    gstRegistration: string;
  };
  order: { orderNos: string; orderDate: string; paymentTerms: string; otherReferences: string; deliveryTerms: string };
  dispatch: { dispatchedThrough: string; destination: string; carrier: string };
  /** `billOfEntry`: absent on orders stored before the field existed. */
  buyer: SoParty & { registrationType: string; billOfEntry?: boolean | null; section7: boolean; placeOfSupply: string };
  consignee: SoParty & { sameAsBuyer: boolean };
  supplyType: string;
  originalSalesNature: string | null;
  states: { optional: boolean; postDated: boolean; cancelled: boolean; changeMode: string };
  ledgers: SoLedgerEntry[];
  additionalCosts: SoAdditionalCost[];
  /** Custom order-level fields, by key. A retired field's value stays here. */
  custom?: Record<string, string>;
  /** The order's own repeating groups' rows (advance lines), when any were given. */
  groups?: SoGroupRows;
}

/** The Read Me worksheet's own marking in its Sales Order column. */
export type SoMarking = "Y" | "?" | "Provision" | "x" | "Update";
export const SO_MARKINGS: readonly SoMarking[] = ["Y", "?", "Provision", "x", "Update"];
export const soMarking = (f: Pick<SoField, "workflow" | "outsideMatrix" | "requirement">): SoMarking =>
  f.workflow ? "Update" : f.outsideMatrix ? "x" : f.requirement === "mandatory" ? "Y" : f.requirement === "conditional" ? "?" : "Provision";

/** For the field matrix report: every field the matrix lists for Sales Orders, with its marking. */
export function soMatrixRows(): { section: string; tallyName: string; marking: SoMarking; key: string; level: string; type: string; rule: string; xStatus: SoXStatus | null }[] {
  return [
    // A field marked x in the Read Me is reported as x: one the WMS offers with why it keeps it, a provision with
    // why the matrix excludes it; a pre-close field as Update.
    ...SO_FIELDS.map((f) => ({
      section: f.section,
      tallyName: f.tallyName,
      marking: soMarking(f),
      key: f.key,
      level: f.level,
      type: f.type,
      rule: f.defaultOff
        ? `Not a Sales Order field: ${f.xVerdict!.why} Off unless enabled in Admin & Master Setup → Sales Order Fields.${f.dependency ? ` ${f.dependency.text}` : ""}`
        : f.outsideMatrix
          ? `${f.rule} ${f.outsideMatrix}`
          : f.workflow
            ? `${f.rule} Entered when pre-closing a delivery of an existing order; never imported with a new one.`
            : f.rule,
      xStatus: f.xVerdict?.status ?? null,
    })),
  ];
}
