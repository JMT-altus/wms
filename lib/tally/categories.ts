/**
 * The ten Tally import categories and the WMS fields each one understands.
 * Pure data: shared by the browser preview and the server's re-check.
 *
 * Tally exports have no fixed column names, so each field lists the headings it
 * is commonly exported under. Those are only SUGGESTIONS (see ./mapping): the
 * person importing confirms or corrects every mapping before validation.
 */

export const TALLY_CATEGORY_KEYS = [
  "customer-master",
  "vendor-master",
  "sales-orders",
  "sales-invoices",
  "purchase-invoices",
  "credit-notes",
  "debit-notes",
  "customer-receipts",
  "vendor-payments",
  "outstanding-balances",
] as const;
export type TallyCategoryKey = (typeof TALLY_CATEGORY_KEYS)[number];

export type TallyDocumentType = Exclude<TallyCategoryKey, "customer-master" | "vendor-master" | "outstanding-balances">;
export type TallyFieldType = "text" | "date" | "amount" | "number";

export interface TallyField {
  key: string;
  label: string;
  type: TallyFieldType;
  required?: boolean;
  /** Lower-case headings this field is commonly exported under. */
  synonyms: readonly string[];
}

export interface TallyCategoryDef {
  key: TallyCategoryKey;
  label: string;
  kind: "party" | "document" | "outstanding";
  /** Whose ledger the party column refers to. Outstanding depends on the chosen direction. */
  party: "customer" | "vendor" | "either";
  /** The category whose documents `refDocumentNo` points at, if any. */
  refersTo?: TallyDocumentType;
  /** Where the rows land, for the screen and the report. */
  destination: string;
  fields: readonly TallyField[];
}

const f = (key: string, label: string, type: TallyFieldType, synonyms: readonly string[], required = false): TallyField => ({ key, label, type, synonyms, required });

const PARTY = (required = true) => f("partyName", "Party name", "text", ["party name", "party", "particulars", "ledger", "ledger name", "party's name", "customer", "customer name", "buyer", "buyer name", "supplier", "supplier name", "vendor", "vendor name", "name of party"], required);
const DOC_NO = f("documentNo", "Document number", "text", ["voucher no", "voucher no.", "vch no", "vch no.", "voucher number", "invoice no", "invoice no.", "invoice number", "bill no", "bill no.", "document no", "doc no", "order no", "order no.", "note no", "supplier invoice no", "supplier invoice no.", "ref no", "ref. no."], true);
const DOC_DATE = f("documentDate", "Date", "date", ["date", "voucher date", "vch date", "invoice date", "bill date", "document date", "order date"], true);
const TOTAL = f("amount", "Total amount", "amount", ["amount", "total", "total amount", "gross total", "gross amount", "invoice value", "invoice amount", "value", "voucher amount", "net amount", "grand total", "credit", "debit"], true);
const TAXABLE = f("taxableValue", "Taxable value", "amount", ["taxable value", "taxable amount", "taxable", "assessable value", "basic value", "sales value"]);
const TAX = f("taxAmount", "Tax amount", "amount", ["tax", "tax amount", "total tax", "gst", "gst amount", "igst+cgst+sgst"]);
const GSTIN = f("gstin", "GSTIN", "text", ["gstin", "gstin/uin", "gst no", "gst no.", "gst number", "party gstin", "party gstin/uin"]);
const ITEM = f("itemName", "Item", "text", ["item", "item name", "stock item", "name of item", "product", "description", "description of goods"]);
const QTY = f("quantity", "Quantity", "number", ["qty", "qty.", "quantity", "billed qty", "billed quantity", "actual qty"]);
const RATE = f("rate", "Rate", "amount", ["rate", "unit rate", "item rate"]);
const LINE_AMOUNT = f("lineAmount", "Line amount", "amount", ["line amount", "item amount", "item value", "line value"]);
const NARRATION = f("narration", "Narration", "text", ["narration", "remarks", "note", "notes"]);
const DUE = f("dueDate", "Due date", "date", ["due date", "due on", "payment due date"]);
const REF_DOC = (label: string) => f("refDocumentNo", label, "text", ["against", "against invoice", "against ref", "against bill", "agst ref", "agst. ref", "original invoice no", "original invoice no.", "original bill no", "reference invoice", "order ref", "order reference", "bill ref", "bill ref."]);
const MODE = f("paymentMode", "Payment mode", "text", ["mode", "payment mode", "transaction type", "instrument type", "cash/bank", "bank", "bank ledger", "cash/bank ledger", "account"]);
const REFERENCE = f("referenceNo", "Reference details", "text", ["reference", "cheque no", "cheque no.", "chq no", "instrument no", "instrument no.", "utr", "utr no", "transaction id", "bank ref"]);

const PARTY_MASTER: readonly TallyField[] = [
  f("name", "Name", "text", ["name", "ledger", "ledger name", "party name", "particulars", "name of ledger", "customer name", "vendor name", "supplier name"], true),
  f("code", "Tally alias / code", "text", ["alias", "code", "ledger code", "party code"]),
  GSTIN,
  f("pan", "PAN", "text", ["pan", "pan no", "pan no.", "income tax no", "it pan"]),
  f("tallyGroup", "Tally group", "text", ["group", "under", "parent", "parent group", "ledger group"]),
  f("phone", "Phone", "text", ["phone", "phone no", "phone no.", "mobile", "mobile no", "mobile no.", "contact no", "telephone"]),
  f("email", "Email", "text", ["email", "e-mail", "email id", "e-mail id"]),
  f("address", "Address", "text", ["address", "billing address", "mailing address"]),
  f("state", "State", "text", ["state", "state name", "place of supply"]),
  f("creditDays", "Credit period (days)", "number", ["credit period", "credit days", "default credit period", "bill credit period"]),
];

const voucherFields = (extra: readonly TallyField[]): readonly TallyField[] => [DOC_NO, DOC_DATE, PARTY(), TOTAL, GSTIN, TAXABLE, TAX, ...extra, NARRATION];

export const TALLY_CATEGORIES: Readonly<Record<TallyCategoryKey, TallyCategoryDef>> = {
  "customer-master": { key: "customer-master", label: "Customer Master", kind: "party", party: "customer", destination: "Customer Master (new customers only; existing ones are never changed)", fields: PARTY_MASTER },
  "vendor-master": { key: "vendor-master", label: "Vendor Master", kind: "party", party: "vendor", destination: "Vendor Master", fields: PARTY_MASTER },
  "sales-orders": { key: "sales-orders", label: "Sales Orders", kind: "document", party: "customer", destination: "Tally ledger (Sales Orders)", fields: voucherFields([ITEM, QTY, RATE, LINE_AMOUNT, DUE]) },
  "sales-invoices": { key: "sales-invoices", label: "Sales Invoices / Tax Invoices", kind: "document", party: "customer", refersTo: "sales-orders", destination: "Tally ledger (Sales Invoices)", fields: voucherFields([ITEM, QTY, RATE, LINE_AMOUNT, DUE, REF_DOC("Sales order reference")]) },
  "purchase-invoices": { key: "purchase-invoices", label: "Purchase Invoices", kind: "document", party: "vendor", destination: "Tally ledger (Purchase Invoices)", fields: voucherFields([ITEM, QTY, RATE, LINE_AMOUNT, DUE]) },
  "credit-notes": { key: "credit-notes", label: "Credit Notes", kind: "document", party: "customer", refersTo: "sales-invoices", destination: "Tally ledger (Credit Notes)", fields: voucherFields([ITEM, QTY, RATE, LINE_AMOUNT, REF_DOC("Original invoice number"), f("adjustmentType", "Adjustment type", "text", ["voucher type", "vch type", "adjustment type", "reason", "type"])]) },
  "debit-notes": { key: "debit-notes", label: "Debit Notes", kind: "document", party: "vendor", refersTo: "purchase-invoices", destination: "Tally ledger (Debit Notes)", fields: voucherFields([ITEM, QTY, RATE, LINE_AMOUNT, REF_DOC("Original invoice number"), f("adjustmentType", "Adjustment type", "text", ["voucher type", "vch type", "adjustment type", "reason", "type"])]) },
  "customer-receipts": { key: "customer-receipts", label: "Customer Receipts (Cash/Bank)", kind: "document", party: "customer", refersTo: "sales-invoices", destination: "Tally ledger (Customer Receipts)", fields: [DOC_NO, DOC_DATE, PARTY(), TOTAL, MODE, REFERENCE, REF_DOC("Invoice reference"), NARRATION] },
  "vendor-payments": { key: "vendor-payments", label: "Vendor Payments (Cash/Bank)", kind: "document", party: "vendor", refersTo: "purchase-invoices", destination: "Tally ledger (Vendor Payments)", fields: [DOC_NO, DOC_DATE, PARTY(), TOTAL, MODE, REFERENCE, REF_DOC("Invoice reference"), NARRATION] },
  "outstanding-balances": {
    key: "outstanding-balances",
    label: "Outstanding Balances",
    kind: "outstanding",
    party: "either",
    destination: "Outstanding snapshot (kept apart from invoices and payments)",
    fields: [
      PARTY(),
      f("billRef", "Bill reference", "text", ["ref. no.", "ref no", "ref no.", "bill no", "bill no.", "bill ref", "bill ref.", "invoice no", "reference", "voucher no"]),
      f("billDate", "Bill date", "date", ["date", "bill date", "invoice date"]),
      DUE,
      f("originalAmount", "Original amount", "amount", ["opening amount", "original amount", "bill amount", "invoice amount"]),
      f("pendingAmount", "Pending amount", "amount", ["pending amount", "pending", "outstanding", "outstanding amount", "balance", "closing balance", "amount due"], true),
      NARRATION,
    ],
  },
};

export const isTallyCategory = (v: unknown): v is TallyCategoryKey => typeof v === "string" && (TALLY_CATEGORY_KEYS as readonly string[]).includes(v);
export const requiredFields = (c: TallyCategoryKey): TallyField[] => TALLY_CATEGORIES[c].fields.filter((x) => x.required);

/** Hard limits. The browser checks them for a good message; the server checks again. */
export const TALLY_LIMITS = {
  fileBytes: 15 * 1024 * 1024,
  rows: 100_000,
  columns: 80,
  cellChars: 500,
  /** Rows per server call: a Server Action body is limited to 1 MB. */
  chunkRows: 300,
  chunkBytes: 800_000,
} as const;
