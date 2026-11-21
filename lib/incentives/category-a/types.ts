import type { IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import type { AllCategoriesIn } from "@/lib/incentives/shared/all-categories";

/**
 * Category A calculation — the engine's input and output. The input is plain data the loader reads from Forms
 * (tally_documents: Sales Orders, Sales Invoices, Customer Receipts, Credit Notes), the Customer Master, the
 * employees and the Stage 4 records (attributions, representative history, receipt events), together with the
 * PUBLISHED configuration version in force for the month. The engine never reads anything else, and holds no rule of
 * its own: every choice it makes is a setting of that version.
 *
 * Dates are yyyy-mm-dd. Amounts are integer paise; exact intermediate amounts are fractions written "n/d".
 */

/**
 * category-a/2 (from category-a/1): nothing that can't be worked out is passed over silently any more — a credit note
 * with no invoice link or no amount, a pre-closure that can't be valued, an order nobody is credited with, a document
 * whose links go further than the calculation follows, an on-account receipt with no customer: each is HELD (with a
 * code) and holds the month until it is resolved or acknowledged. Invoices take their Sales Order's salesperson; the
 * representative "on the order's date" is looked up on the order's date; flat slabs above the highest slab keep the
 * highest slab's figure; "settled" counts every order of the month.
 */
export const ENGINE_VERSION = "category-a/2";

export interface OrderIn {
  id: string;
  no: string;
  date: string;
  customerId: string | null;
  totalPaise: number;
  taxablePaise: number | null;
  /** Σ of the item lines' amounts, or null when no line has an amount. */
  itemsPaise: number | null;
  /** Order - Date (the customer's order date), when given. */
  customerOrderDate: string | null;
  /** Mode/Terms of Payment, as written. */
  paymentTerms: string | null;
  states: { cancelled: boolean; optional: boolean; postDated: boolean };
}

export interface InvoiceIn {
  id: string;
  no: string;
  date: string;
  customerId: string | null;
  orderId: string | null;
  totalPaise: number;
  taxablePaise: number | null;
  itemsPaise: number | null;
  dueDate: string | null;
}

export interface ReceiptIn {
  id: string;
  no: string;
  date: string;
  customerId: string | null;
  /** The invoice the receipt names (Forms' reference), or null for an on-account receipt. */
  invoiceId: string | null;
  amountPaise: number;
}

export interface CreditNoteIn {
  id: string;
  no: string;
  date: string;
  customerId: string | null;
  invoiceId: string | null;
  totalPaise: number;
  taxablePaise: number | null;
  itemsPaise: number | null;
}

/** A pre-closure of part of an order's delivery: the item value it removes (quantity × the line's amount ÷ its quantity). */
export interface PreclosureIn {
  orderId: string;
  date: string;
  itemsValuePaise: number;
}

/**
 * What Tally's import can't say about a receipt or a credit note, recorded in the WMS:
 *   refund     — part of a receipt paid back (amountPaise);
 *   bounced    — the receipt's cheque bounced;
 *   reversed   — the receipt was reversed for another reason;
 *   allocation — part of a receipt applied to an invoice by hand (invoiceId, amountPaise);
 *   salesReturn — the credit note is a sales return.
 */
export interface EventIn {
  id: string;
  kind: "refund" | "bounced" | "reversed" | "allocation" | "salesReturn" | "hold";
  documentId: string;
  invoiceId: string | null;
  amountPaise: number | null;
  date: string;
}

export interface CustomerIn {
  id: string;
  name: string;
  salesRepId: string | null;
  creditPeriodDays: number | null;
}

export interface RepAssignmentIn {
  customerId: string;
  employeeId: string;
  from: string;
  to: string | null;
}

/** A per-order assignment of credit (attribution.source = attributionRecord). */
export interface AttributionIn {
  documentId: string;
  employeeId: string;
  sharePpm: number;
}

export interface EmployeeIn {
  id: string;
  name: string;
  role: string;
  departmentId: string | null;
  isActive: boolean;
}

export interface ConfigVersionRef {
  id: string;
  programId: string;
  versionNo: number;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface CategoryAInput {
  /** First day of the month calculated. */
  month: string;
  /** The day the calculation looks from: receipts, events and pre-closures after it are not seen. */
  asOf: string;
  configVersion: ConfigVersionRef | null;
  config: IncentiveConfig | null;
  roles: readonly string[];
  orders: OrderIn[];
  invoices: InvoiceIn[];
  receipts: ReceiptIn[];
  creditNotes: CreditNoteIn[];
  preclosures: PreclosureIn[];
  events: EventIn[];
  customers: CustomerIn[];
  repHistory: RepAssignmentIn[];
  attributions: AttributionIn[];
  employees: EmployeeIn[];
  /** Other categories' amounts this month, per employee (for the all-categories limit). Categories B–G don't exist yet. */
  otherCategoriesPaise?: Record<string, number>;
  /**
   * Sales Orders that earn Category B, given ONLY when the version says "Orders that earn Category B: left out of
   * Category A" (basis.categoryBOrders = exclude). Absent otherwise, so every earlier input and hash is unchanged.
   */
  categoryBOrderIds?: string[];
  /**
   * The all-categories limit shared with the other categories calculated this month (Category B), given ONLY when one
   * is configured for the month. Absent otherwise: Category A applies its own all-categories limit exactly as before.
   */
  allCategories?: AllCategoriesIn;
  /**
   * Pre-closures recorded in the WMS whose value can't be worked out (the order line they name is missing, or has no
   * quantity or amount), as the loader found them. Absent when there are none.
   */
  preclosureProblems?: { orderId: string; orderNo: string; date: string; reason: string }[];
  /** Documents whose references go further than the loader follows (it may be missing linked documents). Absent when none. */
  referencesIncomplete?: { documentId: string; documentNo: string }[];
}

/**
 * Why something is held (category-a/2). Every hold keeps the month from being submitted, approved or paid until it is
 * resolved at its source (and the month recalculated) or acknowledged, with a reason, by an authorised person.
 */
export type HoldCode = "receipt" | "unassigned" | "credit-note-unlinked" | "credit-note-no-amount" | "preclosure-incomplete" | "reference-chain";
export const HOLD_CODES: readonly HoldCode[] = ["receipt", "unassigned", "credit-note-unlinked", "credit-note-no-amount", "preclosure-incomplete", "reference-chain"];
export const HOLD_LABEL: Record<HoldCode, string> = {
  receipt: "Receipt held",
  unassigned: "Order credited to nobody",
  "credit-note-unlinked": "Credit note not linked to an invoice",
  "credit-note-no-amount": "Credit note with no amount",
  "preclosure-incomplete": "Pre-closure that can't be valued",
  "reference-chain": "Links not fully followed",
};

export interface SlabLine {
  lineCode: string;
  label: string;
  /** The exact amount the line gives, before the slab's own limit. */
  amount: string;
  /** After the slab's own limit. */
  limited: string;
  note: string;
}

export interface EmployeeResult {
  employeeId: string;
  name: string;
  salesPaise: number;
  qualified: boolean;
  slabLines: SlabLine[];
  pool: string;
  ordersSharing: number;
  earnedExact: string;
  payableExact: string;
  earnedPaise: number;
  payablePaise: number;
  /** Earned but not yet payable (an order not fully collected). */
  pendingPaise: number;
  /** What the unreceived amounts would earn (configured: pending at full rate, or at today's step). Never payable. */
  projectedPaise: number;
  /** Earned before the shared all-categories limit; present only when `allCategories` was given. */
  beforeAllCategoriesPaise?: number;
  limits: string[];
  explanation: string[];
}

export interface UnitResult {
  unitId: string;
  unitNo: string;
  unitType: "sales-orders" | "sales-invoices";
  employeeId: string;
  sharePpm: number;
  valuePaise: number;
  collectiblePaise: number;
  collectedPaise: number;
  fullyCollected: boolean;
  takesShare: boolean;
  allocated: string;
  earnedExact: string;
  payableExact: string;
  explanation: string[];
}

export type PieceStatus = "credited" | "held" | "excluded" | "reversed" | "over-collected";

export interface ReceiptPiece {
  receiptId: string;
  receiptNo: string;
  receiptDate: string;
  invoiceId: string | null;
  unitId: string | null;
  employeeId: string | null;
  amountPaise: number;
  referenceDate: string | null;
  delayDays: number | null;
  multiplierPpm: number | null;
  earnedExact: string;
  status: PieceStatus;
  note: string;
}

export interface Note {
  documentId: string | null;
  documentNo: string | null;
  employeeId: string | null;
  message: string;
  /** A hold's kind (category-a/2; held notes only). */
  code?: HoldCode;
}

export interface CategoryAResult {
  engineVersion: string;
  status: "computed" | "blocked";
  /** Why the calculation was blocked: nothing below is filled when it is. */
  problems: string[];
  month: string;
  asOf: string;
  configVersionId: string | null;
  configVersionNo: number | null;
  employees: EmployeeResult[];
  units: UnitResult[];
  pieces: ReceiptPiece[];
  held: Note[];
  excluded: Note[];
  /**
   * Every order of the month — credited to a salesperson or not — is fully collected or past the last delay step, and
   * nothing is held (for "recalculated until orders settle").
   */
  settled: boolean;
  /** The settings the calculation read, by key (for the audit). */
  settingsUsed: Record<string, unknown>;
}
