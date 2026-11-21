import type { IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import type { AllCategoriesIn } from "@/lib/incentives/shared/all-categories";
import type { AttributionIn, ConfigVersionRef, CreditNoteIn, CustomerIn, EmployeeIn, EventIn, InvoiceIn, Note, ReceiptIn, RepAssignmentIn } from "@/lib/incentives/category-a/types";
import type { OrderBIn } from "@/lib/incentives/category-b/types";

/**
 * Categories C–G — the engines' input and output. Each category reads only what its rule needs:
 *   C (new customer acquisition) and G (consecutive monthly purchases): Forms' Sales Orders (with invoices, receipts and
 *     credit notes for C), the Customer Master and the shared attribution records;
 *   D (leads and enquiries), E (client meetings) and F (reviews and testimonials): the tracker's APPROVED submissions
 *     of the month, credited to the salesperson who made them.
 * Every value the engines use is a setting of the PUBLISHED version in force for the month.
 */

export type ExtraCategory = "C" | "D" | "E" | "F" | "G";
/**
 * C is at /3: net turnover, the rolling window anchored at the first QUALIFYING order with a clamp-safe end, per-receipt
 * collection, review cases (incl. historical and unlinked documents, held acquisitions), the per-salesperson cap and the
 * minimum payable with its carry-forward ledger (0136).
 */
export const ENGINE_VERSIONS: Record<ExtraCategory, string> = { C: "category-c/4", D: "category-d/1", E: "category-e/2", F: "category-f/3", G: "category-g/2" };

/** C: what an unmatched record is missing (or what conflicts). */
export type CReviewKind = "order-customer" | "invoice-order" | "credit-note-invoice" | "return-credit-note" | "receipt-customer" | "customer-salesperson";

/**
 * Below-minimum carry-forward (0136): per salesperson, the open lots (amounts held in earlier months, not yet released,
 * offset, expired or written off) and the adjustments carried INTO this month. Read when the month is calculated; frozen
 * in the run once the month is no longer open.
 */
export interface CarryLotIn {
  id: string;
  /** The month the amount was held in (yyyy-mm-01). */
  month: string;
  remainingPaise: number;
  /**
   * The rules the balance was HELD under — from the settings of the run that held it (the ledger row's run) — and
   * which it keeps for life, whatever later versions say: whether a below-minimum month's balance is carried or not
   * released, and whether / after how many months it expires. Absent only in inputs recorded before balances carried
   * their rules (those are reproduced exactly as they were calculated, with the month's own settings).
   */
  rules?: CarryRules;
}
export interface CarryRules {
  belowMinimum: "carryForward" | "notReleased";
  expiry: "never" | "afterMonths";
  expiryMonths: number | null;
}
export interface CarryIn {
  employeeId: string;
  name: string;
  lots: CarryLotIn[];
  /** The adjustments carried into this month (recalculation differences, negative carries), summed. */
  adjustmentsPaise: number;
}
/** What the month does with each lot and with its own amount. Written to the ledger when the month's payout is recorded. */
export interface CarryOutcome {
  lots: { lotId: string; month: string; amountPaise: number; outcome: "released" | "offset" | "expired" | "carried" }[];
  /** A new lot held in this month (the month's own amount and adjustments, when the total is below the minimum). */
  heldPaise: number;
  /** "Not released": the new lot is recorded as expired at once. */
  heldExpires?: boolean;
}
/** C: an admin's decision in force on an unmatched record (0136) — link it or exclude it; it never qualifies anything. */
export interface CReviewIn {
  id: string;
  documentId: string;
  caseKind: Exclude<CReviewKind, "customer-salesperson">;
  decision: "link" | "exclude";
  /** order-customer, receipt-customer: a Customer Master record; invoice-order: a Sales Order; credit-note-invoice: an invoice; return-credit-note: a credit note. */
  targetId: string | null;
}
/** C: a record held for an admin's review: never qualified automatically. */
export interface CReviewCase {
  caseKind: CReviewKind;
  documentId: string;
  documentNo: string;
  customerId: string | null;
  message: string;
}

/** A Forms Sales Order with its amounts (C and G count them). */
export type OrderXIn = OrderBIn & { totalPaise: number; taxablePaise: number | null };

export interface LeadBatchIn {
  id: string;
  employeeId: string;
  periodMonth: string;
  leadCount: number;
  profiled: boolean;
  approved: boolean;
}
export interface LeadConversionIn {
  id: string;
  employeeId: string;
  periodMonth: string;
  convertedCount: number;
  approved: boolean;
}
export interface MeetingIn {
  id: string;
  employeeId: string;
  periodMonth: string;
  awardedPaise: number | null;
  approved: boolean;
  label: string;
}
export interface TestimonialIn {
  id: string;
  employeeId: string;
  periodMonth: string;
  kind: "google_review" | "email" | "letterhead";
  wordCount: number;
  starRating: number | null;
  hasEvidence: boolean;
  namesTeamMember: boolean;
  approved: boolean;
}

/**
 * F (0137): one verified Google review of the month — as its ACTIVE verification records it (rating, original
 * publication date, text, who is named), with its attribution (an active decision, else derived by the priority:
 * the one named salesperson, else the customer's assigned salesperson on the publication date) and whether a second
 * person approved its invalidation. Unverified, rejected and unresolved reviews never reach the engine.
 */
export interface FReviewIn {
  reviewId: string;
  label: string;
  /** The VERIFIED testimonial type (0138): F.1 Google review, F.2 email, F.3 the customer's letterhead. */
  kind: "google_review" | "email" | "letterhead";
  /** The testimonial's original date — a Google review's publication date, an email's or a letter's own date. */
  publishedOn: string;
  /** A Google review's verified star rating (null for email and letterhead). */
  rating: number | null;
  wordCount: number;
  /** The SALESPEOPLE the testimonial clearly names (attribution's first priority). */
  namedEmployeeIds: string[];
  /** F.4: the people it appreciates categorically BY NAME — the credited salesperson or any team member (vague praise: none). */
  appreciatedEmployeeIds: string[];
  /** The customer's assigned salesperson on the publication date (WMS Customer Master and its representative history). */
  assignedEmployeeId: string | null;
  /** An active attribution decision (a choice among several named, a claim, or a correction). */
  attribution: { employeeId: string | null; basis: "named" | "assigned" | "claim" } | null;
  invalidated: boolean;
}

export interface CategoryXInput {
  category: ExtraCategory;
  month: string;
  asOf: string;
  configVersion: ConfigVersionRef | null;
  config: IncentiveConfig | null;
  roles: readonly string[];
  employees: EmployeeIn[];
  /** C, G */
  orders?: OrderXIn[];
  customers?: CustomerIn[];
  repHistory?: RepAssignmentIn[];
  attributions?: AttributionIn[];
  /** C */
  invoices?: InvoiceIn[];
  receipts?: ReceiptIn[];
  creditNotes?: CreditNoteIn[];
  events?: EventIn[];
  /** C: review decisions in force (0136). */
  cReviews?: CReviewIn[];
  /** C: each in-scope customer's own Tally party keys (to PROPOSE review cases for unlinked documents; never to link). */
  customerPartyKeys?: Record<string, string[]>;
  /** C: party keys of unlinked documents (by document id). */
  partyKeys?: Record<string, string>;
  /**
   * C: Forms references the loader could NOT follow to the end (more linked records than its limit). Fail-closed: every
   * acquisition of these customers — of EVERY customer when none can be named — is held, never credited.
   */
  incompleteReferences?: { documentIds: string[]; customerIds: string[] };
  /** C: the below-minimum carry-forward in force for the month (0136). */
  carry?: CarryIn[];
  /** D, E, F */
  leadBatches?: LeadBatchIn[];
  leadConversions?: LeadConversionIn[];
  meetings?: MeetingIn[];
  testimonials?: TestimonialIn[];
  /** F (0137): the month's verified Google reviews (by original publication month). */
  fReviews?: FReviewIn[];
  allCategories?: AllCategoriesIn;
}

/** One credited (or explained) item: a customer (C, G) or a submission (D, E, F). */
export interface ItemResult {
  employeeId: string;
  lineCode: string;
  sourceType: "customer" | "lead-batch" | "lead-conversion" | "meeting" | "testimonial" | "month";
  sourceId: string;
  label: string;
  sharePpm: number;
  /** Before the collection delay step (C) — the reward itself otherwise. */
  baseExact: string;
  earnedExact: string;
  payableExact: string;
  multiplierPpm: number | null;
  status: "credited" | "pending";
  explanation: string[];
}

export interface EmployeeResultX {
  employeeId: string;
  name: string;
  salesPaise: number;
  qualified: boolean;
  items: number;
  baseExact: string;
  earnedExact: string;
  payableExact: string;
  earnedPaise: number;
  payablePaise: number;
  pendingPaise: number;
  projectedPaise: number;
  beforeAllCategoriesPaise?: number;
  /** The month's total when it is below the smallest amount paid (held and carried forward; not released). */
  belowMinimumPaise?: number;
  /** Minimum-payable categories: this month's own payable after every limit (before the minimum), exact and rounded. */
  ownPayableExact?: string;
  ownPayablePaise?: number;
  ownEarnedPaise?: number;
  ownEarnedExact?: string;
  /** …the carried balances and adjustments in the month's total, the total, and what the ledger records. */
  carriedInPaise?: number;
  netPaise?: number;
  carry?: CarryOutcome;
  /**
   * What the month uses of the shared all-categories limit: only a RELEASED month uses it (0 when held). Since category-c/4
   * that is the month's own EARNED amount after its limits (as before) AND the balances carried forward that it releases
   * (they used no limit in the month they were held); adjustments carried in are not counted (a positive one was kept
   * within its own month's limit; a recovery lowers what is paid, not what the month earned).
   */
  capConsumedPaise?: number;
  /** category-c/4: the amount this month puts against the shared limit before it (own before the limit + released balances; 0 when held). */
  sharedPrePaise?: number;
  limits: string[];
  explanation: string[];
}

export interface CategoryXResult {
  engineVersion: string;
  category: ExtraCategory;
  status: "computed" | "blocked";
  problems: string[];
  month: string;
  asOf: string;
  configVersionId: string | null;
  configVersionNo: number | null;
  employees: EmployeeResultX[];
  items: ItemResult[];
  held: Note[];
  excluded: Note[];
  /** C: records held for an admin's review (Review & decisions). */
  reviewCases?: CReviewCase[];
  /** A minimum-payable configuration: payable already includes carried balances and adjustments (the ledger model). */
  carryModel?: boolean;
  settled: boolean;
  settingsUsed: Record<string, unknown>;
}
