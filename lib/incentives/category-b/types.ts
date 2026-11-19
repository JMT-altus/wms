import type { IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import type { AllCategoriesIn } from "@/lib/incentives/shared/all-categories";
import type { AttributionIn, ConfigVersionRef, CreditNoteIn, CustomerIn, EmployeeIn, EventIn, InvoiceIn, Note, ReceiptIn, ReceiptPiece, RepAssignmentIn, UnitResult } from "@/lib/incentives/category-a/types";

/**
 * Category B ("Old Customer – New Product / New Brand") — the engine's input and output. Plain data the loader reads
 * from Forms (tally_documents: Sales Orders with their item lines, Sales Invoices, Customer Receipts, Credit Notes), the
 * Customer Master, the Product Master, the employees, the Category A input records it shares (attributions,
 * representative history, receipt events), the authorised manual qualification decisions, and the PUBLISHED Category B
 * configuration version in force for the month. The engine holds no business value of its own.
 *
 * Dates are yyyy-mm-dd. Amounts are integer paise; exact intermediate amounts are fractions written "n/d".
 */

export const ENGINE_VERSION_B = "category-b/1";

export interface OrderLineIn {
  /** The Product Master product the import matched the line to, or null (unmatched). */
  productId: string | null;
  item: string | null;
}

export interface OrderBIn {
  id: string;
  no: string;
  date: string;
  customerId: string | null;
  /** The party as written on the order, normalised (to spot earlier orders of the same party not linked to the Customer Master). */
  partyKey: string;
  paymentTerms: string | null;
  states: { cancelled: boolean; optional: boolean; postDated: boolean };
  lines: OrderLineIn[];
}

export interface ProductIn {
  id: string;
  name: string;
  brand: string | null;
}

/** An authorised admin's ACTIVE manual qualification decision on a Sales Order. */
export interface OverrideIn {
  id: string;
  orderId: string;
  decision: "qualify" | "exclude";
  reason: string;
  byId: string | null;
  byName: string;
}

/** A Sales Order whose Category B was already PAID OUT (in a paid month): its qualifying invoice is fixed from then on. */
export interface EarnedIn {
  orderId: string;
  invoiceId: string;
  month: string;
}

export interface CategoryBInput {
  month: string;
  asOf: string;
  configVersion: ConfigVersionRef | null;
  config: IncentiveConfig | null;
  roles: readonly string[];
  orders: OrderBIn[];
  invoices: InvoiceIn[];
  receipts: ReceiptIn[];
  creditNotes: CreditNoteIn[];
  events: EventIn[];
  customers: CustomerIn[];
  repHistory: RepAssignmentIn[];
  attributions: AttributionIn[];
  employees: EmployeeIn[];
  products: ProductIn[];
  overrides: OverrideIn[];
  earned: EarnedIn[];
  /** The other categories' amounts and the shared limit; absent when no other category is calculated for the month. */
  allCategories?: AllCategoriesIn;
}

export type Outcome = "qualified" | "not-qualified" | "needs-review";

export interface QualificationResult {
  orderId: string;
  orderNo: string;
  orderDate: string;
  customerId: string | null;
  customerName: string | null;
  /** What the rules alone give. */
  automatic: Outcome;
  /** After any manual decision. */
  outcome: Outcome;
  override: { id: string; decision: "qualify" | "exclude"; reason: string; byId: string | null; byName: string } | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  /** First day of the qualifying invoice's month (the month the order's Category B belongs to). */
  invoiceMonth: string | null;
  taxablePaise: number | null;
  /** Taxable value after the credit notes counted against it. */
  netTaxablePaise: number | null;
  /** The order's Category B before collection decay: rate × net taxable, within the per-order limit. */
  baseExact: string | null;
  /** Credited in the month calculated. */
  inMonth: boolean;
  /** Already paid out: the qualifying invoice stays fixed and later credit notes are recovered. */
  pinned: boolean;
  reasons: string[];
  evidence: {
    earlierOrders: { id: string; no: string; date: string }[];
    newProducts: string[];
    newBrands: string[];
    unmatchedLines: string[];
    unmatchedHistoryLines: string[];
    creditNotes: { id: string; no: string; date: string; taxablePaise: number | null; salesReturn: boolean }[];
    invoicesConsidered: { id: string; no: string; date: string; taxablePaise: number | null; netTaxablePaise: number | null }[];
  };
}

export interface EmployeeResultB {
  employeeId: string;
  name: string;
  /** Σ the net taxable value of the orders credited this month (this salesperson's share). */
  salesPaise: number;
  qualified: boolean;
  ordersCredited: number;
  baseExact: string;
  earnedExact: string;
  payableExact: string;
  earnedPaise: number;
  payablePaise: number;
  pendingPaise: number;
  projectedPaise: number;
  /** Earned before the all-categories limit (present only when another category shares the limit this month). */
  beforeAllCategoriesPaise?: number;
  limits: string[];
  explanation: string[];
}

export interface CategoryBResult {
  engineVersion: string;
  status: "computed" | "blocked";
  problems: string[];
  month: string;
  asOf: string;
  configVersionId: string | null;
  configVersionNo: number | null;
  employees: EmployeeResultB[];
  units: UnitResult[];
  pieces: ReceiptPiece[];
  held: Note[];
  excluded: Note[];
  qualifications: QualificationResult[];
  /** The month's invoices that name no Sales Order (or one not in Forms): never qualified automatically, never ignored. */
  reviewInvoices: { invoiceId: string; invoiceNo: string; invoiceDate: string; customerId: string | null; reason: string }[];
  settled: boolean;
  settingsUsed: Record<string, unknown>;
}
