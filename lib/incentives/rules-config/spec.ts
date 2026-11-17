/**
 * Incentive Rules — the CATALOGUE of Category A configuration settings (Admin & Master Setup → Incentive Rules).
 *
 * This file holds no business rule. It is the fixed, safe VOCABULARY an administrator configures with: which settings
 * exist, their type, the choices each allows and how each is checked. Every value lives in the database
 * (incentive_config_* tables, migration 0131), versioned and approved. Nothing here calculates anything: the
 * calculation engine comes later and will read only the published configuration.
 *
 * Each setting is labelled with where its value came from in the business's own material:
 *   pdf        — stated in the Incentive Planning sheet;
 *   screenshot — needed to reproduce the two April calculation examples (₹1,083.33 and ₹925.00);
 *   option     — not settled by any source: it starts EMPTY and must be chosen and approved.
 * The pdf and screenshot values are offered only as a REFERENCE TEMPLATE a draft can start from (REFERENCE_TEMPLATE
 * below): editable like any other value and approved like any other change. A setting that is required and has no
 * value blocks submission and publishing, and the screen lists what is missing.
 *
 * Units: amounts in integer paise; rates and multipliers as integer parts per million (1% = 10,000; 100% =
 * 1,000,000), so no value is ever a floating-point fraction.
 */

export const CATEGORY_CODES = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];
/** The categories whose configuration is specified (Stage 2). The others can't have versions yet. */
export const CONFIGURABLE_CATEGORIES: readonly CategoryCode[] = ["A"];
export const CATEGORY_LABEL: Record<CategoryCode, string> = {
  A: "Sales Order Received",
  B: "Old Customer – New Product / New Brand",
  C: "New Customer Acquisition – N / I / R",
  D: "New Customer Acquisition – C",
  E: "High Value / High Potential Client Meetings",
  F: "Reviews / Testimonials",
  G: "Consecutive monthly customer purchases",
};

export const SECTIONS = [
  { key: "general", label: "General Eligibility" },
  { key: "threshold", label: "Monthly Sales Thresholds" },
  { key: "slabs", label: "Incentive Slabs" },
  { key: "allocation", label: "Incentive Allocation" },
  { key: "delay", label: "Collection and Payment Delay" },
  { key: "partial", label: "Partial Payment Rules" },
  { key: "adjustments", label: "Refunds and Adjustments" },
  { key: "people", label: "Salesperson Eligibility" },
  { key: "period", label: "Calculation Period" },
  { key: "rounding", label: "Rounding and Limits" },
  { key: "payout", label: "Approval and Payout Rules" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

export type Source = "pdf" | "screenshot" | "option";
export const SOURCE_LABEL: Record<Source, string> = { pdf: "From the PDF", screenshot: "From the April examples", option: "Business decision" };

/** A choice offered by a setting. */
export interface Choice {
  value: string;
  label: string;
}

/**
 * The kinds of value a setting can hold:
 *   choice   — one of its choices;
 *   multi    — any number of its choices (an empty list is a valid, confirmed answer);
 *   ordered  — its choices in an order, each at most once, at least one;
 *   amount   — paise, 0 or more;
 *   cap      — "none" (confirmed: no limit) or paise, 0 or more;
 *   integer  — a whole number within min…max;
 */
export type SettingKind = "choice" | "multi" | "ordered" | "amount" | "cap" | "integer";
export type SettingValue = string | string[] | number;

export interface SettingDef {
  key: string;
  section: SectionKey;
  label: string;
  help: string;
  kind: SettingKind;
  choices?: readonly Choice[];
  min?: number;
  max?: number;
  /** Required before a version can be submitted. A setting with `requiredWhen` is required only while it holds. */
  required: boolean;
  /** Required (and shown) only while another setting holds one of these values (or, for a multi/ordered setting, includes one). */
  requiredWhen?: { key: string; values: readonly string[] };
  source: Source;
}

const C = (value: string, label: string): Choice => ({ value, label });

export const SETTINGS: readonly SettingDef[] = [
  // ── General Eligibility ──
  { key: "basis.document", section: "general", label: "Sales are counted from", kind: "choice", required: true, source: "option",
    help: "Which document's value makes up a salesperson's monthly sales. The PDF's heading is \"Sales Order Received\", but it doesn't say which value is meant.",
    choices: [C("salesOrder", "Sales Orders"), C("invoice", "Sales Invoices")] },
  { key: "basis.amount", section: "general", label: "Amount counted", kind: "choice", required: true, source: "option",
    help: "Which amount of each document counts: with GST (the document total), before GST (taxable value) or the product lines only (no freight, tax or other ledgers).",
    choices: [C("total", "Total value, including GST"), C("taxable", "Taxable value, excluding GST"), C("itemsOnly", "Product lines only")] },
  { key: "basis.monthDate", section: "general", label: "Date that places a sale in a month", kind: "choice", required: true, source: "option",
    help: "Which date decides the month a sale counts in.",
    choices: [C("orderDate", "Sales Order voucher date"), C("customerOrderDate", "Customer's order date (Order - Date)"), C("invoiceDate", "Invoice date")] },
  { key: "basis.voucherFilter", section: "general", label: "Orders left out", kind: "multi", required: true, source: "option",
    help: "Orders whose Voucher Status says so are left out of sales. Choosing none is a valid answer, but it must be chosen.",
    choices: [C("cancelled", "Cancelled orders"), C("optional", "Optional orders"), C("postDated", "Post-dated orders")] },
  { key: "basis.preClosure", section: "general", label: "Pre-closed quantities", kind: "choice", required: true, source: "option",
    help: "How a delivery that was pre-closed (Forms → Sales Orders → Pre-close) affects the order's value.",
    choices: [C("ignore", "Count the full ordered value"), C("deductPreClosedValue", "Deduct the pre-closed value from the order's month"), C("deductInMonthOfPreClosure", "Deduct it in the month it was pre-closed")] },

  // ── Monthly Sales Thresholds ──
  { key: "eligibility.threshold", section: "threshold", label: "Monthly sales threshold", kind: "amount", required: true, source: "pdf",
    help: "A salesperson qualifies for Category A only once their monthly sales reach this amount (PDF: \"Eligible after 1 Cr. in month\")." },
  { key: "eligibility.thresholdComparison", section: "threshold", label: "Sales exactly at the threshold", kind: "choice", required: true, source: "option",
    help: "Whether sales exactly equal to the threshold qualify.",
    choices: [C("atLeast", "Qualify (sales ≥ threshold)"), C("above", "Don't qualify (sales > threshold)")] },

  // ── Incentive Slabs ──
  { key: "slabs.method", section: "slabs", label: "How slabs are applied", kind: "choice", required: true, source: "screenshot",
    help: "Marginal: each slab's rate applies only to the part of sales inside it (the April examples: 0.10% of the ₹20 L above ₹1 Cr). Flat: the rate of the slab reached applies to all sales. Flat above threshold: that rate applies to the sales above the threshold.",
    choices: [C("marginal", "Marginal (each slab on its own part)"), C("flat", "Flat (reached slab's rate on all sales)"), C("flatAboveThreshold", "Flat on sales above the threshold")] },
  { key: "slabs.boundaries", section: "slabs", label: "Slab edges", kind: "choice", required: true, source: "option",
    help: "Which slab an amount exactly on an edge belongs to (e.g. exactly ₹1.2 Cr).",
    choices: [C("lowerInclusive", "Belongs to the slab that starts there"), C("upperInclusive", "Belongs to the slab that ends there")] },
  { key: "slabs.aboveTop", section: "slabs", label: "Sales above the highest slab", kind: "choice", required: true, source: "option",
    help: "What sales above the top of the highest slab earn.",
    choices: [C("noFurtherIncentive", "Nothing more"), C("continueTopRate", "The highest slab's rate continues"), C("fixedAmount", "A fixed amount")] },
  { key: "slabs.aboveTopAmount", section: "slabs", label: "Fixed amount above the highest slab", kind: "amount", required: true, requiredWhen: { key: "slabs.aboveTop", values: ["fixedAmount"] }, source: "option",
    help: "Paid once when sales exceed the highest slab." },
  { key: "slabs.gaps", section: "slabs", label: "Gaps between slabs", kind: "choice", required: true, source: "option",
    help: "Whether slabs must follow on from each other with no gap.",
    choices: [C("refuse", "Slabs must be continuous"), C("allow", "Gaps are allowed (sales in a gap earn nothing)")] },

  // ── Incentive Allocation ──
  { key: "allocation.method", section: "allocation", label: "How the month's incentive is shared between orders", kind: "choice", required: true, source: "option",
    help: "The April examples share ₹2,000 as ₹166.67 per order; every order there is ₹10 L, so equal and proportional sharing give the same figures.",
    choices: [C("equalPerOrder", "Equally per order"), C("proportionalToValue", "In proportion to each order's value"), C("proportionalToCollected", "In proportion to the amount collected on each order")] },
  { key: "allocation.eligibleOrders", section: "allocation", label: "Orders that share the incentive", kind: "choice", required: true, source: "option",
    help: "Which of the month's orders take a share.",
    choices: [C("allInMonth", "Every counted order of the month"), C("onlyOrdersAboveMin", "Only orders above a minimum value")] },
  { key: "allocation.minOrderAmount", section: "allocation", label: "Minimum order value to take a share", kind: "amount", required: true, requiredWhen: { key: "allocation.eligibleOrders", values: ["onlyOrdersAboveMin"] }, source: "option",
    help: "Orders below this value take no share." },

  // ── Collection and Payment Delay ──
  { key: "collection.delayFrom", section: "delay", label: "Delay is counted from", kind: "choice", required: true, source: "pdf",
    help: "The PDF counts delay \"beyond … days of agreed terms\": from the invoice's due date.",
    choices: [C("invoiceDueDate", "Invoice due date (agreed terms)"), C("invoiceDate", "Invoice date"), C("orderDate", "Sales Order date")] },
  { key: "collection.stepBoundary", section: "delay", label: "A payment exactly on a step's last day", kind: "choice", required: true, source: "option",
    help: "Whether a payment exactly 45 days late keeps the full rate (\"beyond 45 days\" reads as day 46 onwards) or already drops.",
    choices: [C("upperInclusive", "Still in that step (45 days = full rate)"), C("upperExclusive", "Already in the next step (45 days = next rate)")] },
  { key: "collection.dueDateFallback", section: "delay", label: "Where a due date comes from", kind: "ordered", required: true, requiredWhen: { key: "collection.delayFrom", values: ["invoiceDueDate"] }, source: "option",
    help: "In order: the first source that gives a due date is used.",
    choices: [C("invoiceDueDate", "The invoice's own due date"), C("orderPaymentTerms", "The order's payment terms (when they state days)"), C("customerTerms", "The customer's payment terms"), C("defaultDays", "A default number of days after the invoice")] },
  { key: "collection.defaultDays", section: "delay", label: "Default days after the invoice", kind: "integer", min: 0, max: 365, required: true, requiredWhen: { key: "collection.dueDateFallback", values: ["defaultDays"] }, source: "option",
    help: "Used when no other source gives a due date." },
  { key: "collection.missingDueDate", section: "delay", label: "When no due date can be found", kind: "choice", required: true, source: "option",
    help: "What happens to a receipt whose delay can't be worked out.",
    choices: [C("treatAsOnTime", "Treat it as on time"), C("holdForReview", "Hold it for review"), C("excludeReceipt", "Leave it out")] },
  { key: "collection.recoveryAfterNil", section: "delay", label: "After an amount has dropped to nil", kind: "choice", required: true, source: "option",
    help: "Whether a later payment brings back incentive that had dropped to nil.",
    choices: [C("noRecovery", "It stays nil"), C("recoverToStepAtReceipt", "It earns at the step the payment falls in")] },

  // ── Partial Payment Rules ──
  { key: "collection.earningBasis", section: "partial", label: "How payments earn incentive", kind: "choice", required: true, source: "screenshot",
    help: "Per receipt: each payment earns its share of the order at its own delay (April example 2). Whole order, latest payment: the whole order at the delay of its last payment. Whole order, weighted: the same amounts as per receipt, but only once the order is complete.",
    choices: [C("perReceipt", "Each receipt at its own delay"), C("wholeOrderWorstReceipt", "Whole order at its latest payment's delay"), C("wholeOrderWeighted", "Whole order, weighted by its receipts")] },
  { key: "collection.payableWhen", section: "partial", label: "When earned incentive becomes payable", kind: "choice", required: true, source: "pdf",
    help: "The PDF says \"Payable on collection of full amount\".",
    choices: [C("asReceived", "As each payment is received"), C("orderFullyCollected", "Only once the order is fully collected")] },
  { key: "collection.unreceivedPortion", section: "partial", label: "Amounts not yet received", kind: "choice", required: true, source: "option",
    help: "How the unpaid part of an order is shown.",
    choices: [C("pendingUntilReceived", "Pending until it is received"), C("decayAsOfToday", "Shown at today's delay step")] },
  { key: "collection.onAccountReceipts", section: "partial", label: "Receipts not linked to an invoice (on account)", kind: "choice", required: true, source: "option",
    help: "How a receipt that names no invoice is treated.",
    choices: [C("ignoreUntilAllocated", "Ignored until someone allocates it"), C("allocateOldestInvoiceFirst", "Applied to the customer's oldest open invoice first"), C("manualAllocationRequired", "Held until allocated by hand")] },
  { key: "collection.multiInvoiceReceipts", section: "partial", label: "Receipts that pay several invoices", kind: "choice", required: true, source: "option",
    help: "Imported receipts name one invoice; how one that pays more is split.",
    choices: [C("useImportedReference", "Applied to the invoice it names"), C("manualAllocation", "Split by hand"), C("oldestFirst", "Oldest invoice first")] },

  // ── Refunds and Adjustments ──
  { key: "adjust.creditNote", section: "adjustments", label: "Credit notes", kind: "choice", required: true, source: "option",
    help: "How a credit note against an invoice changes sales and incentive.",
    choices: [C("reduceOriginalMonthSales", "Reduce the original month's sales (it may fall below the threshold)"), C("reduceInIssueMonth", "Reduce sales in the month it is issued"), C("reduceOrderCollectionOnly", "Reduce only what the order must collect"), C("ignore", "Ignore")] },
  { key: "adjust.salesReturn", section: "adjustments", label: "Sales returns", kind: "choice", required: true, source: "option",
    help: "How a sales return changes sales and incentive.",
    choices: [C("reduceOriginalMonthSales", "Reduce the original month's sales"), C("reduceInIssueMonth", "Reduce sales in the month of the return"), C("reduceOrderCollectionOnly", "Reduce only what the order must collect"), C("ignore", "Ignore")] },
  { key: "adjust.refund", section: "adjustments", label: "Refunds", kind: "choice", required: true, source: "option",
    help: "A refund paid back to the customer.",
    choices: [C("reverseReceiptShare", "Reverse the incentive the refunded payment earned"), C("ignore", "Ignore")] },
  { key: "adjust.bouncedCheque", section: "adjustments", label: "Bounced cheques", kind: "choice", required: true, source: "option",
    help: "A payment that bounced.",
    choices: [C("reverseReceiptShare", "Reverse what it earned"), C("reverseAndRestartDelay", "Reverse what it earned; the delay keeps running")] },
  { key: "adjust.reversedReceipt", section: "adjustments", label: "Reversed receipts", kind: "choice", required: true, source: "option",
    help: "A receipt reversed for any other reason.",
    choices: [C("reverseReceiptShare", "Reverse what it earned"), C("holdForReview", "Hold for review")] },
  { key: "adjust.openMonths", section: "adjustments", label: "Changes affecting a month still open", kind: "choice", required: true, source: "option",
    help: "Whether an open month is recalculated when its data changes.",
    choices: [C("recalculate", "Recalculate it"), C("freezeAtLastCompute", "Keep the last calculation")] },
  { key: "adjust.lockedOrPaidMonths", section: "adjustments", label: "Changes affecting a locked or paid month", kind: "choice", required: true, source: "option",
    help: "A locked or paid month never changes; the difference can be carried into the current month.",
    choices: [C("adjustInCurrentMonth", "Adjust the difference in the current month"), C("noAdjustment", "No adjustment")] },
  { key: "adjust.negativeBalance", section: "adjustments", label: "When adjustments make a month negative", kind: "choice", required: true, source: "option",
    help: "What happens to an amount owed back.",
    choices: [C("recoverFromNextPayout", "Recover it from the next payout"), C("carryForwardMonths", "Carry it forward for a number of months"), C("writeOff", "Write it off"), C("recoverFromSalary", "Recover it from salary")] },
  { key: "adjust.carryForwardMonths", section: "adjustments", label: "Months to carry a negative balance", kind: "integer", min: 1, max: 24, required: true, requiredWhen: { key: "adjust.negativeBalance", values: ["carryForwardMonths"] }, source: "option",
    help: "After this many months the remaining balance is written off." },
  { key: "adjust.windowDays", section: "adjustments", label: "Days after payout that adjustments are allowed", kind: "integer", min: 0, max: 730, required: true, source: "option",
    help: "0 = a payout is final." },

  // ── Salesperson Eligibility ──
  { key: "attribution.source", section: "people", label: "Whose sale it is", kind: "choice", required: true, source: "option",
    help: "Where the salesperson of an order comes from.",
    choices: [C("customerSalesRep", "The customer's sales representative (Customer Master)"), C("orderSalesperson", "A salesperson recorded on the order"), C("attributionRecord", "Assigned per order in Incentive Rules")] },
  { key: "attribution.historical", section: "people", label: "When a customer's representative changes", kind: "choice", required: true, source: "option",
    help: "Which representative earlier orders belong to.",
    choices: [C("repAtOrderDate", "The representative on the order's date"), C("currentRep", "The current representative")] },
  { key: "attribution.split", section: "people", label: "Shared credit", kind: "choice", required: true, source: "option",
    help: "Whether one order's credit can be split between salespeople.",
    choices: [C("single", "One salesperson per order"), C("splitByShares", "Split by shares that add up to 100%")] },
  { key: "eligibility.inactiveEmployees", section: "people", label: "Salespeople who leave", kind: "choice", required: true, source: "option",
    help: "Whether someone who leaves still earns.",
    choices: [C("excludeFromMonthLeft", "Nothing from the month they leave"), C("payUntilLastWorkingDay", "Earn until their last working day")] },

  // ── Calculation Period ──
  { key: "period.unit", section: "period", label: "Calculation period", kind: "choice", required: true, source: "pdf",
    help: "The PDF's Category A is monthly.",
    choices: [C("calendarMonth", "Calendar month")] },
  { key: "period.recalcUntil", section: "period", label: "A month is recalculated until", kind: "choice", required: true, source: "option",
    help: "When a month's figures stop changing on their own.",
    choices: [C("untilLocked", "It is locked"), C("fixedDaysAfterMonthEnd", "A number of days after the month ends"), C("untilOrdersSettled", "Every order is fully collected or past the last delay step")] },
  { key: "period.recalcDays", section: "period", label: "Days after the month ends", kind: "integer", min: 0, max: 365, required: true, requiredWhen: { key: "period.recalcUntil", values: ["fixedDaysAfterMonthEnd"] }, source: "option",
    help: "Recalculation stops this many days after the month ends." },
  { key: "period.lockMode", section: "period", label: "Locking a month", kind: "choice", required: true, source: "option",
    help: "How a month is locked.",
    choices: [C("manual", "By hand"), C("autoAfterDays", "Automatically, a number of days after the month ends")] },
  { key: "period.autoLockDays", section: "period", label: "Days after the month ends to lock", kind: "integer", min: 0, max: 365, required: true, requiredWhen: { key: "period.lockMode", values: ["autoAfterDays"] }, source: "option",
    help: "The month locks this many days after it ends." },
  { key: "period.lateReceipts", section: "period", label: "Payments that arrive after a month is locked", kind: "choice", required: true, source: "option",
    help: "How a payment for a locked month is handled.",
    choices: [C("adjustInCurrentOpenMonth", "Adjusted in the current open month"), C("reopenRequired", "The month must be reopened")] },

  // ── Rounding and Limits ──
  { key: "rounding.method", section: "rounding", label: "Rounding method", kind: "choice", required: true, source: "option",
    help: "How amounts are rounded.",
    choices: [C("halfUp", "Half up (0.5 rounds up)"), C("halfEven", "Half to even"), C("down", "Down"), C("up", "Up")] },
  { key: "rounding.precision", section: "rounding", label: "Rounded to", kind: "choice", required: true, source: "option",
    help: "The smallest unit an amount is rounded to.",
    choices: [C("paise", "Paise"), C("rupee", "Whole rupees"), C("tenRupees", "Tens of rupees")] },
  { key: "rounding.level", section: "rounding", label: "Where rounding happens", kind: "choice", required: true, source: "screenshot",
    help: "Only rounding each salesperson's monthly total reproduces both April examples (₹1,083.33 and ₹925.00); rounding each order or receipt gives ₹1,083.34 and ₹924.99.",
    choices: [C("employeeMonthTotal", "Once, on each salesperson's monthly total"), C("perOrder", "On each order"), C("perReceipt", "On each receipt")] },
  { key: "caps.perOrder", section: "rounding", label: "Most one order can earn", kind: "cap", required: true, source: "option",
    help: "Choose \"No limit\" or an amount." },
  { key: "caps.perEmployeeCategoryMonth", section: "rounding", label: "Most a salesperson can earn from Category A in a month", kind: "cap", required: true, source: "pdf",
    help: "PDF: upper limit ₹9,000." },
  { key: "caps.perEmployeeAllCategoriesMonth", section: "rounding", label: "Most a salesperson can earn from all categories in a month", kind: "cap", required: true, source: "pdf",
    help: "PDF: ₹18,250 across the categories." },

  // ── Approval and Payout Rules ──
  { key: "payout.approvalSteps", section: "payout", label: "Approvals before a payout", kind: "integer", min: 1, max: 3, required: true, source: "option",
    help: "How many people approve a month's payout, one after another; none of them may be the person who prepared it." },
  { key: "payout.release", section: "payout", label: "When an approved payout is released", kind: "choice", required: true, source: "option",
    help: "When approved incentive is paid.",
    choices: [C("afterApproval", "As soon as it is approved"), C("withPayrollMonth", "With the next payroll month")] },
];

export const SETTING: Readonly<Record<string, SettingDef>> = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));
export const SETTING_KEYS: readonly string[] = SETTINGS.map((s) => s.key);

/* ── the structured lists ─────────────────────────────────────────────── */

export const SLAB_VALUE_TYPES = ["percent", "fixed"] as const;
export type SlabValueType = (typeof SLAB_VALUE_TYPES)[number];
/** One incentive slab. `ratePpm` for a percentage (1% = 10,000), `fixedPaise` for a fixed amount. */
export interface Slab {
  lineCode: string;
  label: string;
  fromPaise: number;
  toPaise: number;
  valueType: SlabValueType;
  ratePpm: number | null;
  fixedPaise: number | null;
  /** Most this slab can pay; null = no limit of its own. */
  capPaise: number | null;
}

/** One collection-delay step: payments `fromDays`…`toDays` past the reference date earn `multiplierPpm` (100% = 1,000,000). The last is open-ended. */
export interface DelayStep {
  fromDays: number;
  toDays: number | null;
  multiplierPpm: number;
}

export const ELIGIBILITY_SUBJECTS = ["employee", "department", "role"] as const;
export type EligibilitySubject = (typeof ELIGIBILITY_SUBJECTS)[number];
/** Who the configuration covers: a person, a department or an employee role, included or excluded, between two dates. */
export interface EligibilityRow {
  subjectType: EligibilitySubject;
  /** An employee's or department's id; null for a role. */
  subjectId: string | null;
  /** A role's value; null otherwise. */
  role: string | null;
  /** The name as it read when chosen, so the history stays readable if the person or department is renamed or removed. */
  subjectLabel: string;
  mode: "include" | "exclude";
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** A complete configuration: what one version holds. */
export interface IncentiveConfig {
  settings: Record<string, SettingValue>;
  slabs: Slab[];
  delaySteps: DelayStep[];
  eligibility: EligibilityRow[];
}

export const EMPTY_CONFIG: IncentiveConfig = { settings: {}, slabs: [], delaySteps: [], eligibility: [] };

const CR = (crores: number) => Math.round(crores * 1_00_00_000 * 100);
const RS = (rupees: number) => Math.round(rupees * 100);
/**
 * The REFERENCE TEMPLATE: the values the PDF and the April examples establish, offered as a starting point for a new
 * draft. Every one is editable; the "option" settings stay empty and must be chosen. Not used by any calculation.
 */
export const REFERENCE_TEMPLATE: IncentiveConfig = {
  settings: {
    "eligibility.threshold": CR(1),
    "slabs.method": "marginal",
    "collection.delayFrom": "invoiceDueDate",
    "collection.earningBasis": "perReceipt",
    "collection.payableWhen": "orderFullyCollected",
    "period.unit": "calendarMonth",
    "rounding.level": "employeeMonthTotal",
    "caps.perEmployeeCategoryMonth": RS(9000),
    "caps.perEmployeeAllCategoriesMonth": RS(18250),
  },
  slabs: [
    { lineCode: "A.1", label: "₹1.0 Cr – ₹1.2 Cr", fromPaise: CR(1.0), toPaise: CR(1.2), valueType: "percent", ratePpm: 1_000, fixedPaise: null, capPaise: RS(2000) },
    { lineCode: "A.2", label: "₹1.2 Cr – ₹1.4 Cr", fromPaise: CR(1.2), toPaise: CR(1.4), valueType: "percent", ratePpm: 1_500, fixedPaise: null, capPaise: RS(3000) },
    { lineCode: "A.3", label: "₹1.4 Cr – ₹1.6 Cr", fromPaise: CR(1.4), toPaise: CR(1.6), valueType: "percent", ratePpm: 2_000, fixedPaise: null, capPaise: RS(4000) },
  ],
  delaySteps: [
    { fromDays: 0, toDays: 45, multiplierPpm: 1_000_000 },
    { fromDays: 45, toDays: 75, multiplierPpm: 500_000 },
    { fromDays: 75, toDays: 100, multiplierPpm: 250_000 },
    { fromDays: 100, toDays: null, multiplierPpm: 0 },
  ],
  eligibility: [],
};
