import type { Route } from "next";
import { TALLY_CATEGORIES, type TallyCategoryKey, type TallyDocumentType } from "./categories";

/**
 * The Forms sections that show what Tally Data Import writes — one per
 * destination, so every imported record has a screen. Pure data, shared by the
 * Forms rail, the overview, the batch page (which links each row to its record)
 * and the pages themselves. No database access.
 *
 * Document types are the category keys themselves: `tally_documents.document_type`
 * stores the import category (see lib/tally/plan.ts, which copies the category
 * into the record), so a ledger filters on exactly that value and a sales order
 * can never surface as a sales invoice.
 */

export const TALLY_DOCUMENT_TYPES = ["sales-orders", "sales-invoices", "purchase-invoices", "credit-notes", "debit-notes", "customer-receipts", "vendor-payments"] as const satisfies readonly TallyDocumentType[];

export const isDocumentType = (v: unknown): v is TallyDocumentType => typeof v === "string" && (TALLY_DOCUMENT_TYPES as readonly string[]).includes(v);

export interface DocumentSectionDef {
  type: TallyDocumentType;
  /** The rail label — short; the category label from TALLY_CATEGORIES is the long form. */
  label: string;
  hint: string;
  href: Route;
  party: "customer" | "vendor";
  /** What the money column means on this ledger. */
  amountLabel: string;
  /** Whether the ledger shows a document it refers to (invoice → order, note → invoice, receipt → invoice). */
  refLabel: string | null;
  /** Receipts and payments carry a mode and a reference instead of item lines. */
  settlement: boolean;
}

const doc = (type: TallyDocumentType, label: string, hint: string, amountLabel: string, refLabel: string | null, settlement = false): DocumentSectionDef => ({
  type,
  label,
  hint,
  href: `/forms/documents/${type}` as Route,
  party: TALLY_CATEGORIES[type].party === "vendor" ? "vendor" : "customer",
  amountLabel,
  refLabel,
  settlement,
});

export const DOCUMENT_SECTIONS: Readonly<Record<TallyDocumentType, DocumentSectionDef>> = {
  "sales-orders": doc("sales-orders", "Sales Orders", "Orders received, from Tally", "Order value", null),
  "sales-invoices": doc("sales-invoices", "Sales Invoices", "Tax invoices raised, from Tally", "Invoice value", "Sales order"),
  "purchase-invoices": doc("purchase-invoices", "Purchase Invoices", "Supplier bills, from Tally", "Bill value", null),
  "credit-notes": doc("credit-notes", "Credit Notes", "Issued to customers, from Tally", "Credit", "Original invoice"),
  "debit-notes": doc("debit-notes", "Debit Notes", "Raised on vendors, from Tally", "Debit", "Original invoice"),
  "customer-receipts": doc("customer-receipts", "Customer Receipts", "Money received, from Tally", "Received", "Against invoice", true),
  "vendor-payments": doc("vendor-payments", "Vendor Payments", "Money paid out, from Tally", "Paid", "Against invoice", true),
};

/** Outstanding Balances: two views over `tally_outstanding_lines`, by the stored `direction`. */
export const OUTSTANDING_VIEWS = {
  receivables: { direction: "receivable", label: "Receivables", party: "customer", hint: "What customers owe, as of the latest snapshot" },
  payables: { direction: "payable", label: "Payables", party: "vendor", hint: "What is owed to vendors, as of the latest snapshot" },
} as const;
export type OutstandingView = keyof typeof OUTSTANDING_VIEWS;
export type OutstandingDirection = (typeof OUTSTANDING_VIEWS)[OutstandingView]["direction"];
export const isOutstandingView = (v: unknown): v is OutstandingView => v === "receivables" || v === "payables";
export const outstandingHref = (view: OutstandingView): Route => `/forms/outstanding/${view}` as Route;
export const viewForDirection = (direction: OutstandingDirection): OutstandingView => (direction === "payable" ? "payables" : "receivables");

export const FORMS_ROUTES = {
  overview: "/forms" as Route,
  customerMaster: "/forms/customer-master" as Route,
  vendorMaster: "/forms/vendor-master" as Route,
  tallyImport: "/forms/tally-import" as Route,
  outstanding: outstandingHref("receivables"),
} as const;

export const vendorHref = (id: string): Route => `/forms/vendor-master/${id}` as Route;
export const documentHref = (type: TallyDocumentType, id: string): Route => `/forms/documents/${type}/${id}` as Route;
export const outstandingLineHref = (view: OutstandingView, id: string): Route => `/forms/outstanding/${view}/${id}` as Route;
export const batchHref = (id: string): Route => `/forms/tally-import/batches/${id}` as Route;

/** Where an import category's records are viewed. The outstanding section depends on the batch's direction. */
export function sectionForCategory(category: TallyCategoryKey, direction: OutstandingDirection | null): { label: string; href: Route } {
  if (category === "customer-master") return { label: "Customer Master", href: FORMS_ROUTES.customerMaster };
  if (category === "vendor-master") return { label: "Vendor Master", href: FORMS_ROUTES.vendorMaster };
  if (category === "outstanding-balances") {
    const view = viewForDirection(direction ?? "receivable");
    return { label: `Outstanding Balances · ${OUTSTANDING_VIEWS[view].label}`, href: outstandingHref(view) };
  }
  return { label: DOCUMENT_SECTIONS[category].label, href: DOCUMENT_SECTIONS[category].href };
}

/**
 * The Forms page that shows one imported record, from what the import row
 * recorded (`target_table` + `target_id`) and its batch. A customer has no
 * per-record page (the Customer Master is one table), so its link opens that
 * table. Null when the row produced no record.
 */
export function recordHref(targetTable: string | null, targetId: string | null, batch: { category: string; direction: OutstandingDirection | null }): Route | null {
  if (!targetId) return null;
  switch (targetTable) {
    case "customer_masters":
      return FORMS_ROUTES.customerMaster;
    case "vendor_masters":
      return vendorHref(targetId);
    case "tally_documents":
      return isDocumentType(batch.category) ? documentHref(batch.category, targetId) : null;
    case "tally_outstanding_lines":
      return outstandingLineHref(viewForDirection(batch.direction ?? "receivable"), targetId);
    default:
      return null;
  }
}
