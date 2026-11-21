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
/** The categories whose configuration is specified. The others can't have versions yet. */
export const CONFIGURABLE_CATEGORIES: readonly CategoryCode[] = ["A", "B", "C", "D", "E", "F", "G"];
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
  { key: "qualification", label: "Category B Qualification" },
  { key: "newCustomer", label: "New Customer Rules" },
  { key: "rewards", label: "Reward Amounts" },
  { key: "streak", label: "Consecutive Purchases" },
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

export type Source = "pdf" | "screenshot" | "option" | "decision";
export const SOURCE_LABEL: Record<Source, string> = { pdf: "From the PDF", screenshot: "From the April examples", option: "Business decision", decision: "Confirmed decision" };

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
 *   rate     — a percentage in parts per million (1% = 10,000), from 0% to 100%.
 */
export type SettingKind = "choice" | "multi" | "ordered" | "amount" | "cap" | "integer" | "rate";
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
  /** A "cap" setting's word for "none" (default "No limit"; a minimum reads "No minimum"). */
  noneLabel?: string;
  /** Required before a version can be submitted. A setting with `requiredWhen` is required only while it holds. */
  required: boolean;
  /** Required (and shown) only while another setting holds one of these values (or, for a multi/ordered setting, includes one). */
  requiredWhen?: { key: string; values: readonly string[] };
  source: Source;
  /**
   * The categories that use it (absent: Category A only). A shared setting has its own value in each category's
   * versions; CATEGORY_OVERRIDES may word or narrow it for one category.
   */
  categories?: readonly CategoryCode[];
}

const C = (value: string, label: string): Choice => ({ value, label });

/** Category A's 54 settings, exactly as Category A has always defined them. */
const CATEGORY_A_SETTINGS: readonly SettingDef[] = [
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
    choices: [C("allInMonth", "Every counted order of the month"), C("onlyOrdersAboveMin", "Only orders of at least a minimum value")] },
  { key: "allocation.minOrderAmount", section: "allocation", label: "Minimum order value to take a share", kind: "amount", required: true, requiredWhen: { key: "allocation.eligibleOrders", values: ["onlyOrdersAboveMin"] }, source: "option",
    help: "An order of exactly this value takes a share; orders below it take none." },

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
    choices: [C("reduceOriginalMonthSales", "Reduce the original month's sales (it may fall below the threshold)"), C("reduceInIssueMonth", "Reduce sales in the month it is issued"), C("reduceOrderCollectionOnly", "Reduce only what the order must collect"), C("ignore", "Ignore (sales and the amount to collect stay as they were: an order the customer pays less on then never becomes fully collected)")] },
  { key: "adjust.salesReturn", section: "adjustments", label: "Sales returns", kind: "choice", required: true, source: "option",
    help: "How a sales return changes sales and incentive.",
    choices: [C("reduceOriginalMonthSales", "Reduce the original month's sales"), C("reduceInIssueMonth", "Reduce sales in the month of the return"), C("reduceOrderCollectionOnly", "Reduce only what the order must collect"), C("ignore", "Ignore (sales and the amount to collect stay as they were: an order the customer pays less on then never becomes fully collected)")] },
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

/**
 * Category A's settings that Category B uses too, with the same meaning (its own value in each B version). Category B
 * reuses Category A's receipt, delay, adjustment, attribution, period, rounding, limit and payout rules.
 */
const SHARED_WITH_B = new Set([
  "basis.voucherFilter",
  "collection.delayFrom", "collection.stepBoundary", "collection.dueDateFallback", "collection.defaultDays", "collection.missingDueDate", "collection.recoveryAfterNil",
  "collection.earningBasis", "collection.unreceivedPortion", "collection.onAccountReceipts", "collection.multiInvoiceReceipts",
  "adjust.refund", "adjust.bouncedCheque", "adjust.reversedReceipt", "adjust.openMonths", "adjust.lockedOrPaidMonths", "adjust.negativeBalance", "adjust.carryForwardMonths", "adjust.windowDays",
  "attribution.source", "attribution.historical", "attribution.split", "eligibility.inactiveEmployees",
  "period.unit", "period.recalcUntil", "period.recalcDays", "period.lockMode", "period.autoLockDays", "period.lateReceipts",
  "rounding.method", "rounding.precision", "rounding.level",
  "caps.perOrder", "caps.perEmployeeCategoryMonth", "caps.perEmployeeAllCategoriesMonth",
  "payout.approvalSteps", "payout.release",
]);

/**
 * Which of Category A's settings Categories C–G use as well — only where the setting means something for them:
 *   C (new customers) and G (consecutive purchases) are worked out from Forms' documents, so they use the order filter,
 *   attribution and (C, whose first transactions must be paid) the receipt and due-date rules;
 *   D, E and F reward approved submissions (leads, meetings, testimonials) by the salesperson who made them, so they
 *   have no document, attribution or collection settings;
 *   every category has the period, adjustment, rounding, limit and payout settings.
 */
const ALL_CATEGORIES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const SHARED_WITH_C_G: Record<string, readonly CategoryCode[]> = Object.fromEntries([
  ...["basis.voucherFilter", "attribution.source", "attribution.historical", "attribution.split", "caps.perOrder"].map((k) => [k, ["C", "G"]]),
  ...["collection.delayFrom", "collection.stepBoundary", "collection.dueDateFallback", "collection.defaultDays", "collection.missingDueDate", "collection.onAccountReceipts", "collection.multiInvoiceReceipts", "adjust.refund", "adjust.bouncedCheque", "adjust.reversedReceipt"].map((k) => [k, ["C"]]),
  // Category C uses Category A's receipt-based earning and its credit-note / sales-return rules (confirmed decisions),
  // narrowed for C in CATEGORY_OVERRIDES to the choices those decisions allow (0136 lets the database accept them for C).
  ...["collection.earningBasis", "collection.payableWhen", "adjust.creditNote", "adjust.salesReturn"].map((k) => [k, ["C"]]),
  ...["eligibility.inactiveEmployees", "period.unit", "period.recalcUntil", "period.recalcDays", "period.lockMode", "period.autoLockDays", "period.lateReceipts", "adjust.openMonths", "adjust.lockedOrPaidMonths", "adjust.negativeBalance", "adjust.carryForwardMonths", "adjust.windowDays", "rounding.method", "rounding.precision", "caps.perEmployeeCategoryMonth", "caps.perEmployeeAllCategoriesMonth", "payout.approvalSteps", "payout.release"].map((k) => [k, ["C", "D", "E", "F", "G"]]),
]);
const categoriesOf = (key: string): readonly CategoryCode[] | undefined => {
  const base: CategoryCode[] = SHARED_WITH_B.has(key) ? ["A", "B"] : [];
  const more = SHARED_WITH_C_G[key] ?? [];
  return base.length || more.length ? [...(base.length ? base : ["A" as const]), ...more] : undefined;
};

/**
 * Settings added with Category B. Every value is configurable; none is a rule of the code. Where a confirmed business
 * decision gives the value (the 24-month look back, the ₹1,00,000 minimum) it is offered only as an editable starting
 * value of a new draft (CATEGORY_B_TEMPLATE); the rate and the per-order and monthly limits start EMPTY and must be
 * entered before a version can be submitted or published.
 */
const ADDED_SETTINGS: readonly SettingDef[] = [
  // ── Category B Qualification ──
  { key: "b.existingLookbackMonths", section: "qualification", label: "Existing customer: months looked back", kind: "integer", min: 1, max: 120, required: true, source: "decision", categories: ["B"],
    help: "A customer is an existing customer when it has at least one earlier eligible Sales Order (Orders left out never count) dated within this many months before the order. Confirmed decision: 24 months." },
  { key: "b.noveltyWindow", section: "qualification", label: "New product or brand: months looked back", kind: "choice", required: true, source: "decision", categories: ["B"],
    help: "A product or brand is new when none of the customer's earlier eligible Sales Orders in this window has it. A new product OR a new brand qualifies.",
    choices: [C("sameAsExisting", "The same months as the existing-customer look back"), C("own", "Its own number of months")] },
  { key: "b.noveltyLookbackMonths", section: "qualification", label: "New product or brand: its own months", kind: "integer", min: 1, max: 120, required: true, requiredWhen: { key: "b.noveltyWindow", values: ["own"] }, source: "option", categories: ["B"],
    help: "Used only when the novelty window has its own length." },
  { key: "b.minAmount", section: "qualification", label: "Minimum taxable value of one invoice", kind: "amount", required: true, source: "decision", categories: ["B"],
    help: "The FIRST individual invoice of the Sales Order whose whole taxable value (after credit notes) is at least this amount qualifies, once per Sales Order. Invoices are never added together. Confirmed decision: ₹1,00,000." },
  { key: "b.ratePpm", section: "qualification", label: "Incentive rate", kind: "rate", required: true, source: "option", categories: ["B"],
    help: "A percentage of the qualifying invoice's taxable value. No rate is assumed: enter the approved rate." },

  // ── Refunds and Adjustments (Category B) ──
  { key: "b.salesReturns", section: "adjustments", label: "Sales returns", kind: "choice", required: true, source: "decision", categories: ["B"],
    help: "A credit note marked as a sales return. Confirmed decision: treated like any credit note — before the order's Category B is paid out it reassesses the order; after payout the difference is recovered from later months.",
    choices: [C("asCreditNote", "Treated as a credit note (reassessed before payout, recovered after)"), C("ignore", "Ignored")] },
  { key: "b.recoveryExpiry", section: "adjustments", label: "When recovery after payout stops", kind: "choice", required: true, source: "decision", categories: ["B"],
    help: "A credit note or return after payout is recovered from later months. Confirmed decision: recovery doesn't lapse on its own; choose a number of days only if an expiry has been approved.",
    choices: [C("never", "Never: recovered whenever it arrives"), C("afterWindowDays", "After a number of days from payout")] },

  // ── Category A: Category B orders ──
  { key: "basis.categoryBOrders", section: "general", label: "Orders that earn Category B", kind: "choice", required: false, source: "decision", categories: ["A"],
    help: "Whether a Sales Order that earns Category B still counts toward Category A sales. Confirmed decision: it counts (not set = counts). Leaving them out applies from the month a version saying so is published; a locked or paid month never changes.",
    choices: [C("include", "Counted in Category A too"), C("exclude", "Left out of Category A")] },

  // ── Rounding and Limits: sharing the all-categories limit ──
  { key: "caps.allCategoriesPolicy", section: "rounding", label: "Sharing the all-categories limit between categories", kind: "choice", required: false, source: "decision", categories: ALL_CATEGORIES,
    help: "When a salesperson's categories together exceed the all-categories limit in a month. In proportion: each category keeps its share (rounded down to the paisa, so the total never exceeds the limit). In order: the categories are filled one after another in the order chosen. A locked, approved or paid category's figures are never changed; the limit left is shared by the others.",
    choices: [C("proportional", "In proportion to each category's amount"), C("categoryOrder", "One category after another, in a chosen order")] },
  { key: "caps.allCategoriesOrder", section: "rounding", label: "Order the categories are filled in", kind: "ordered", required: true, requiredWhen: { key: "caps.allCategoriesPolicy", values: ["categoryOrder"] }, source: "option", categories: ALL_CATEGORIES,
    help: "Only for \"One category after another\".",
    choices: ALL_CATEGORIES.map((c) => C(c, `Category ${c}`)) },
];

/**
 * Categories C–G. Each rule below is the one the OLD engine pays today (lib/incentives/config.ts and rules.ts, taken
 * from the PDF "Sales BH" sheet), made configurable — nothing new is invented. Their PDF values are offered only as an
 * editable starting template (CATEGORY_TEMPLATES) and every value is approved before it applies. Where the old engine
 * has no rule (G, and how C recognises a "new" customer in Forms), every setting starts EMPTY and must be decided.
 */
const C_TO_G_SETTINGS: readonly SettingDef[] = [
  // ── C · New customer acquisition (old engine C.1) ──
  { key: "c.newCustomerLookbackMonths", section: "newCustomer", label: "New customer: months with no earlier order", kind: "integer", min: 1, max: 120, required: true, source: "decision", categories: ["C"],
    help: "Rolling look-back (confirmed: 12 months). A customer is new at a Sales Order when it has no other eligible Sales Order dated within this many months before it — inclusive: an order on the same calendar day this many months earlier (or the month's last day, when that day doesn't exist) is within it. Earlier orders not yet invoiced still count; cancelled and fully returned orders don't. An unlinked earlier order whose Tally party matches holds the customer for review." },
  { key: "c.requiredTransactions", section: "newCustomer", label: "Transactions that complete the acquisition", kind: "integer", min: 1, max: 20, required: true, source: "pdf", categories: ["C"],
    help: "The incentive is earned on the new customer's first this-many qualifying Sales Orders (one Sales Order is one transaction, however many invoices it has; cancelled and fully returned orders don't count), in the month of the Sales Order that completes them (PDF: first 3 transactions)." },
  { key: "c.turnoverWindowMonths", section: "newCustomer", label: "Turnover window: months from the first qualifying order", kind: "integer", min: 1, max: 120, required: true, source: "option", categories: ["C"],
    help: "Recommended: 12. The new customer's net turnover and its transactions are counted from its FIRST QUALIFYING Sales Order (invoiced, net above ₹0) for this many months: 12 months from 10 Feb 2026 runs to 9 Feb 2027 inclusive; when the end day doesn't exist it is the month's last day, included (from 29 Feb 2028: to 28 Feb 2029; one month from 31 Jan: to 28 Feb). If that order is later cancelled or fully returned, the next qualifying order becomes the start. Orders after the window never count, so a later calculation date doesn't change who qualified." },
  { key: "c.minTurnover", section: "newCustomer", label: "Net turnover needed", kind: "amount", required: true, source: "pdf", categories: ["C"],
    help: "The new customer's net turnover in the turnover window — after credit notes and sales returns — must reach this amount (PDF: ₹2.5 L). A return that takes it below loses the incentive (recalculated before payout; recovered after payout)." },
  { key: "c.turnoverBasis", section: "newCustomer", label: "Net turnover counts", kind: "choice", required: true, source: "option", categories: ["C"],
    help: "Recommended: invoiced value. Invoiced: each Sales Order counts what has been invoiced against it, less its credit notes and returns (an order not yet invoiced counts nothing yet; a pre-closed, never-invoiced part never counts). Ordered: the Sales Order's value, less its credit notes and returns.",
    choices: [C("invoiced", "Invoiced value, less credit notes and returns"), C("ordered", "Sales Order value, less credit notes and returns")] },
  { key: "c.amountBasis", section: "newCustomer", label: "Amount counted", kind: "choice", required: true, source: "option", categories: ["C"],
    help: "Which amount counts — of orders, invoices, credit notes and returns alike — towards the turnover and the incentive.",
    choices: [C("taxable", "Taxable value, excluding GST"), C("total", "Total value, including GST")] },
  { key: "c.ratePpm", section: "newCustomer", label: "Incentive rate on the first transactions", kind: "rate", required: true, source: "pdf", categories: ["C"],
    help: "A percentage of the first transactions' net amount (initial draft: 1%). Payable only once their invoices are fully collected (net of credit notes and returns); each receipt earns at its own delay step, as Category A." },
  // ── Minimum payable (shared design; Category C uses it first) ──
  { key: "payout.minimumPayable", section: "payout", label: "Smallest amount paid in a month", kind: "cap", noneLabel: "No minimum", required: true, source: "decision", categories: ["C"],
    help: "Applied to each salesperson's TOTAL for the month — this month's amount after every limit, plus the balances carried forward and the adjustments carried into the month. Choose \"No minimum\" deliberately or enter the amount; nothing is assumed. This isn't an eligibility threshold." },
  { key: "payout.belowMinimum", section: "payout", label: "A month below the smallest amount", kind: "choice", required: true, source: "decision", categories: ["C"],
    help: "Confirmed: carry forward. Below the smallest amount, the month's total is held in the carry-forward ledger and added to the next months until it is reached; only then is it released, once. \"Not released\" holds and expires it at once (recorded, never silent).",
    choices: [C("carryForward", "Carry forward until the smallest amount is reached"), C("notReleased", "Not released (recorded as expired)")] },
  { key: "payout.carryForwardExpiry", section: "payout", label: "Carried-forward balances expire", kind: "choice", required: true, source: "decision", categories: ["C"],
    help: "Confirmed default: never. An expired balance is recorded in the ledger with the month it expired in; an authorised person can also write a balance off, with a reason.",
    requiredWhen: { key: "payout.belowMinimum", values: ["carryForward"] },
    choices: [C("never", "Never (no expiry)"), C("afterMonths", "After a number of months")] },
  { key: "payout.carryForwardExpiryMonths", section: "payout", label: "Months before a carried balance expires", kind: "integer", min: 1, max: 120, required: true, source: "option", categories: ["C"],
    help: "A balance held in a month expires when it is still unreleased this many months later.",
    requiredWhen: { key: "payout.carryForwardExpiry", values: ["afterMonths"] } },

  // ── D · Leads and enquiries (old engine D.1, D.2) ──
  { key: "d.leadsPerUnit", section: "rewards", label: "Profiled leads per reward", kind: "integer", min: 1, max: 1000, required: true, source: "pdf", categories: ["D"], help: "An approved batch earns one reward per this many leads (PDF: 10)." },
  { key: "d.leadUnitAmount", section: "rewards", label: "Reward per lead unit", kind: "amount", required: true, source: "pdf", categories: ["D"], help: "The reward for each full unit of profiled leads (PDF: ₹250 per 10 profiled leads)." },
  { key: "d.leadsMustBeProfiled", section: "rewards", label: "Leads must be profiled", kind: "choice", required: true, source: "pdf", categories: ["D"], help: "Whether only a batch marked as profiled earns (PDF: profiled leads).",
    choices: [C("yes", "Only profiled batches"), C("no", "Any approved batch")] },
  { key: "d.conversionsPerUnit", section: "rewards", label: "Leads turned into enquiries per reward", kind: "integer", min: 1, max: 1000, required: true, source: "pdf", categories: ["D"], help: "An approved conversion earns one reward per this many leads turned into enquiries (PDF: 5)." },
  { key: "d.conversionUnitAmount", section: "rewards", label: "Reward per enquiry unit", kind: "amount", required: true, source: "pdf", categories: ["D"], help: "The reward for each full unit of enquiries (PDF: ₹250 per 5 leads turned into enquiries)." },
  { key: "d.unitCounting", section: "rewards", label: "How units are counted", kind: "choice", required: true, source: "option", categories: ["D"], help: "The old engine counts each approved submission on its own (leftover leads of a batch don't carry over).",
    choices: [C("perSubmission", "Each submission on its own"), C("perMonth", "The month's submissions together")] },

  // ── E · High-value / high-potential client meetings (old engine E.1) ──
  { key: "e.minAward", section: "rewards", label: "Smallest award for a meeting", kind: "amount", required: true, source: "pdf", categories: ["E"], help: "An approved meeting's award is raised to at least this (PDF: ₹250)." },
  { key: "e.maxAward", section: "rewards", label: "Largest award for a meeting", kind: "amount", required: true, source: "pdf", categories: ["E"], help: "…and lowered to at most this (PDF: ₹1,000). The award itself is set by the admin who approves the meeting." },

  // ── F · Reviews and testimonials — the original scheme's F.1–F.4 (confirmed; 0137 + 0138) ──
  // A VERIFIED, unique testimonial earns its type's reward: F.1 a Google review, F.2 a testimonial on email, F.3 one on the
  // customer's letterhead; F.4 — appreciation of the credited salesperson or any team member categorically by name —
  // multiplies the applicable reward (the total is that multiple of it). Never split between salespeople.
  { key: "f.googleReviewAmount", section: "rewards", label: "F.1 Google review", kind: "amount", required: true, source: "decision", categories: ["F"],
    help: "The reward for a verified, unique, public Google review that meets the conditions below (the original scheme: ₹100)." },
  { key: "f.emailAmount", section: "rewards", label: "F.2 Testimonial on email", kind: "amount", required: true, source: "decision", categories: ["F"],
    help: "The reward for a verified email testimonial — verified as genuinely from the customer and as an email testimonial (the original scheme: ₹100)." },
  { key: "f.letterheadAmount", section: "rewards", label: "F.3 Testimonial on the customer's letterhead", kind: "amount", required: true, source: "decision", categories: ["F"],
    help: "The reward for a verified testimonial on the customer's letterhead — verified as the customer's letterhead and genuine (the original scheme: ₹150)." },
  { key: "f.namedMultiple", section: "rewards", label: "F.4 Appreciation by name: the reward is multiplied by", kind: "integer", min: 1, max: 10, required: true, source: "decision", categories: ["F"],
    help: "When a testimonial categorically appreciates the credited salesperson or any team member BY NAME, its F.1, F.2 or F.3 reward is multiplied by this (the original scheme: 2 — double; ₹100 becomes ₹200, ₹150 becomes ₹300, never more). Vague praise without a name doesn't count. 1 = no F.4." },
  { key: "f.minRating", section: "rewards", label: "Google review: lowest star rating that earns", kind: "integer", min: 1, max: 5, required: true, source: "decision", categories: ["F"],
    help: "A Google review rated below this earns nothing (confirmed default: 5 — five stars only). Email and letterhead testimonials have no rating. A change applies from the month its version is published; a calculated month keeps the settings it was calculated with." },
  { key: "f.googleMinWords", section: "rewards", label: "Google review: fewest words", kind: "integer", min: 0, max: 10000, required: true, source: "decision", categories: ["F"],
    help: "A verified Google review with fewer words earns nothing. 0 = no minimum (confirmed default)." },
  { key: "f.minQualifyingReviews", section: "rewards", label: "Qualifying testimonials needed in a month", kind: "integer", min: 0, max: 100, required: true, source: "decision", categories: ["F"],
    help: "Per salesperson per month, counting every verified testimonial type: with fewer, the month's Category F is nothing (and says why). 0 = no minimum (confirmed default)." },
  { key: "f.googleNeedsEvidence", section: "rewards", label: "Google review: screenshot needed", kind: "choice", required: true, source: "option", categories: ["F"],
    help: "The public review link is always required; this says whether a screenshot must be attached as well when it is submitted. (Email and letterhead testimonials always need their evidence link.)", choices: [C("yes", "A screenshot is needed"), C("no", "Not needed")] },
  { key: "f.recoveryExpiry", section: "adjustments", label: "When recovery after payout stops", kind: "choice", required: true, source: "decision", categories: ["F"],
    help: "A testimonial invalidated after payout is recovered from later months. Confirmed default: never lapses; choose a number of days only if an expiry has been approved.",
    choices: [C("never", "Never: recovered whenever it is invalidated"), C("afterWindowDays", "After a number of days from payout")] },
  // Historical: kept so earlier versions still read; Category F ignores them.
  { key: "f.googleFiveStarOnly", section: "rewards", label: "Historical: five stars only", kind: "choice", required: false, source: "pdf", categories: ["F"], help: "Replaced by the lowest star rating that earns; ignored.", choices: [C("yes", "Five stars only"), C("no", "Any rating")] },
  { key: "f.namedBonusAmount", section: "rewards", label: "Historical: amount added when the salesperson is named", kind: "amount", required: false, source: "decision", categories: ["F"], help: "Superseded by F.4 (the reward multiplied when the testimonial appreciates someone by name); ignored." },

  // ── G · Consecutive monthly customer purchases — NO rule exists yet (old engine: disabled) ──
  { key: "g.consecutiveMonths", section: "streak", label: "Consecutive months of purchases", kind: "integer", min: 2, max: 24, required: true, source: "option", categories: ["G"],
    help: "PROPOSED STRUCTURE, awaiting the business rule: a customer buying in this many consecutive months earns the reward. The PDF names the category but gives no rule, so every value here must be decided." },
  { key: "g.minMonthlyPurchase", section: "streak", label: "Smallest purchase that counts for a month", kind: "amount", required: true, source: "option", categories: ["G"], help: "A month counts when the customer's eligible Sales Orders reach this amount." },
  { key: "g.purchaseBasis", section: "streak", label: "Amount counted", kind: "choice", required: true, source: "option", categories: ["G"], help: "Which amount of each Sales Order counts.",
    choices: [C("taxable", "Taxable value, excluding GST"), C("total", "Total value, including GST")] },
  { key: "g.rewardAmount", section: "streak", label: "Reward for a completed run", kind: "amount", required: true, source: "option", categories: ["G"], help: "Paid to the customer's salesperson in the month the run completes." },
  { key: "g.afterReward", section: "streak", label: "After a reward", kind: "choice", required: true, source: "option", categories: ["G"], help: "Whether the count starts again after a reward, or every further consecutive month earns again.",
    choices: [C("restart", "The count starts again"), C("everyFurtherMonth", "Every further consecutive month earns")] },
];

/** How a shared setting reads, or is narrowed, for one category. */
const CATEGORY_OVERRIDES: Partial<Record<CategoryCode, Record<string, Partial<SettingDef>>>> = {
  A: {
    // "Reverse what it earned; the delay keeps running" behaves exactly like "Reverse what it earned": a bounced cheque
    // pays nothing, so its invoice stays unpaid and its delay keeps running until a payment clears. Restarting the delay
    // (from the bounce, or for the replacement payment) has no defined meaning, so it isn't offered for Category A; a
    // version that chose it can't be saved, submitted or published until "Reverse what it earned" is chosen.
    "adjust.bouncedCheque": { help: "A payment that bounced earns nothing; its invoice stays unpaid, so its delay keeps running until a payment that clears (that payment earns at its own delay). Restarting the delay isn't offered: it has no defined meaning.", choices: [C("reverseReceiptShare", "Reverse what it earned (the delay keeps running)")] },
  },
  B: {
    "basis.voucherFilter": { section: "qualification", label: "Orders left out", help: "Sales Orders whose Voucher Status says so are left out of Category B and of every customer's order history. Cancelled orders are always left out (confirmed decision), so Cancelled must be chosen.", source: "decision" },
    "collection.delayFrom": { help: "The qualifying invoice's receipts are measured from this date, each at its own delay (as Category A)." },
    "adjust.lockedOrPaidMonths": { label: "Changes affecting a locked or paid month", help: "Confirmed decision: a locked or paid month never changes; a difference (a credit note, return or reversal after payout) is recovered in the current month.", choices: [C("adjustInCurrentMonth", "Adjust the difference in the current month")], source: "decision" },
    "adjust.negativeBalance": { help: "Confirmed decision: recovery is made from later months' Category B payouts.", choices: [C("recoverFromNextPayout", "Recover it from the next payout"), C("carryForwardMonths", "Carry it forward for a number of months")], source: "decision" },
    "adjust.carryForwardMonths": { help: "After this many months the remaining balance is written off (an explicit, approved expiry)." },
    "adjust.windowDays": { label: "Days after payout that recovery is allowed", help: "Used only when recovery stops after a number of days.", requiredWhen: { key: "b.recoveryExpiry", values: ["afterWindowDays"] } },
    "period.unit": { help: "Category B is calculated per calendar month: the month of the qualifying invoice's date." },
    "rounding.level": { help: "Where Category B amounts are rounded.", choices: [C("employeeMonthTotal", "Once, on each salesperson's monthly total"), C("perOrder", "On each Sales Order"), C("perReceipt", "On each receipt")], source: "option" },
    "caps.perOrder": { label: "Most one Sales Order can earn from Category B", help: "Applied to the order's incentive BEFORE collection decay (confirmed decision). Choose \"No limit\" deliberately or enter the approved amount; nothing is assumed.", source: "decision" },
    "caps.perEmployeeCategoryMonth": { label: "Most a salesperson can earn from Category B in a month", help: "Required before publishing. Choose \"No limit\" deliberately or enter the approved amount; a missing value is never treated as no limit.", source: "decision" },
    "caps.perEmployeeAllCategoriesMonth": { help: "Across the categories the WMS calculates. Shared as \"Sharing the all-categories limit between categories\" says." },
    "caps.allCategoriesPolicy": { required: true },
  },
  ...Object.fromEntries(
    (["C", "D", "E", "F", "G"] as const).map((c) => [
      c,
      {
        "caps.perEmployeeCategoryMonth": { label: `Most a salesperson can earn from Category ${c} in a month`, help: c === "G" ? "No amount exists yet: choose \"No limit\" deliberately or enter the approved amount." : c === "F" ? "The PDF shows ₹750 for Category F. NOT YET CONFIRMED: whether it is per salesperson per month, and whether F.4 doubled rewards count inside it (as entered here they do: the limit applies to the month's Category F total). Required: publishing stays blocked until the approved value is entered — choose \"No limit\" only if that is the decision." : `PDF ceiling for Category ${c}: ${({ C: "₹5,000", D: "₹1,000", E: "₹1,000" } as Record<string, string>)[c]}. Choose "No limit" deliberately or enter the approved amount.` },
        "caps.allCategoriesPolicy": { required: true },
        "period.unit": { help: `Category ${c} is calculated per calendar month.` },
        ...(c === "C"
          ? {
              "caps.perOrder": { label: "Most one new customer can earn, per salesperson", help: "Initial draft: ₹5,000 per customer, per salesperson, per month (confirmed). Applied to each salesperson's share before the collection delay step. Choose \"No limit\" deliberately or enter the amount." },
              "collection.earningBasis": { help: "Confirmed: Category A's receipt-based rules. Each receipt: each payment earns its share at its own delay step. Whole order, latest payment: everything at the last payment's step. Weighted: the same as each receipt (Category C is paid only once fully collected).", source: "decision" },
              "collection.payableWhen": { help: "Confirmed: partial collections don't qualify — payable only once every invoice of the transactions is fully collected (net of credit notes and returns).", choices: [C("orderFullyCollected", "Only once fully collected")], source: "decision" },
              "adjust.creditNote": { help: "Confirmed: net sales — a credit note reduces its Sales Order's net amount in the original period (recalculated before payout; recovered after payout).", choices: [C("reduceOriginalMonthSales", "Reduce the original Sales Order's net amount")], source: "decision" },
              "adjust.salesReturn": { help: "Confirmed: a sales return reduces its Sales Order's net amount in the original period; a fully returned order isn't a transaction.", choices: [C("reduceOriginalMonthSales", "Reduce the original Sales Order's net amount")], source: "decision" },
            }
          : {}),
        ...(c === "G" ? { "caps.perOrder": { label: "Most one customer's run can earn", help: "No amount exists yet." } } : {}),
        // Category F: the recovery window applies only when recovery after payout stops after a number of days.
        ...(c === "F" ? { "adjust.windowDays": { label: "Days after payout that recovery is allowed", help: "Used only when recovery stops after a number of days.", requiredWhen: { key: "f.recoveryExpiry", values: ["afterWindowDays"] } } } : {}),
      },
    ]),
  ),
};

/** Every setting definition (all categories). A definition's own `categories` says which categories use it. */
export const SETTINGS: readonly SettingDef[] = [...CATEGORY_A_SETTINGS.map((d) => (categoriesOf(d.key) ? { ...d, categories: categoriesOf(d.key) } : d)), ...ADDED_SETTINGS, ...C_TO_G_SETTINGS];

export const SETTING: Readonly<Record<string, SettingDef>> = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));
export const SETTING_KEYS: readonly string[] = SETTINGS.map((s) => s.key);

const usedBy = (d: SettingDef, c: CategoryCode) => (d.categories ?? ["A"]).includes(c);
/** The settings one category's versions hold, worded for that category. */
export function settingsFor(category: CategoryCode): readonly SettingDef[] {
  const over = CATEGORY_OVERRIDES[category] ?? {};
  return SETTINGS.filter((d) => usedBy(d, category)).map((d) => (over[d.key] ? { ...d, ...over[d.key] } : d));
}
/** The sections a category's versions have (a section with no setting of the category isn't shown). */
export function sectionsFor(category: CategoryCode): readonly (typeof SECTIONS)[number][] {
  const defs = settingsFor(category);
  return SECTIONS.filter((s) => defs.some((d) => d.section === s.key) || (category === "A" && s.key === "slabs"));
}
/** Whether a category's versions have incentive slabs (Category B has none). */
export const hasSlabs = (category: CategoryCode) => category === "A";

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

/**
 * Category B's starting values for a new draft: ONLY what a confirmed decision or the existing Category A reference
 * gives (the 24-month look back, the ₹1,00,000 minimum, cancelled orders left out, credit-note treatment of returns,
 * recovery that doesn't lapse, adjustments in the current month, proportional sharing of the all-categories limit, and
 * Category A's receipt, delay and rounding references). The incentive rate, the per-order limit and the monthly limit
 * are NOT here: they start empty and block submission and publishing until the approved values are entered. Every
 * value is editable and approved like any other change. Not used by any calculation.
 */
export const CATEGORY_B_TEMPLATE: IncentiveConfig = {
  settings: {
    "b.existingLookbackMonths": 24,
    "b.noveltyWindow": "sameAsExisting",
    "b.minAmount": RS(1_00_000),
    "b.salesReturns": "asCreditNote",
    "b.recoveryExpiry": "never",
    "basis.voucherFilter": ["cancelled"],
    "adjust.lockedOrPaidMonths": "adjustInCurrentMonth",
    "collection.delayFrom": "invoiceDueDate",
    "collection.earningBasis": "perReceipt",
    "period.unit": "calendarMonth",
    "rounding.level": "employeeMonthTotal",
    "caps.perEmployeeAllCategoriesMonth": RS(18250),
    "caps.allCategoriesPolicy": "proportional",
  },
  slabs: [],
  delaySteps: REFERENCE_TEMPLATE.delaySteps,
  eligibility: [],
};

/**
 * Categories C–G: the values the OLD engine pays today (lib/incentives/config.ts — the PDF "Sales BH" sheet), as an
 * editable starting point. A decision the PDF doesn't settle (C's "new customer" look back and amount basis, D's unit
 * counting, F's evidence rule, every limit's final choice, approvals) stays empty. Category G has NO rule: its template
 * holds no value at all. The shared ₹18,250 all-categories limit and proportional sharing are as Category B's.
 */
const SHARED_TEMPLATE: IncentiveConfig["settings"] = { "period.unit": "calendarMonth", "caps.perEmployeeAllCategoriesMonth": RS(18250), "caps.allCategoriesPolicy": "proportional" };
export const CATEGORY_TEMPLATES: Partial<Record<CategoryCode, IncentiveConfig>> = {
  C: { settings: { ...SHARED_TEMPLATE, "c.requiredTransactions": 3, "c.minTurnover": RS(2_50_000), "c.ratePpm": 10_000, "caps.perOrder": RS(5_000), "caps.perEmployeeCategoryMonth": RS(5_000), "basis.voucherFilter": ["cancelled"], "collection.delayFrom": "invoiceDueDate",
    // Confirmed decisions and the recommended defaults (H1, H3, H4): editable starting values of a new draft only.
    "c.newCustomerLookbackMonths": 12, "c.turnoverWindowMonths": 12, "c.turnoverBasis": "invoiced",
    "collection.earningBasis": "perReceipt", "collection.payableWhen": "orderFullyCollected", "adjust.creditNote": "reduceOriginalMonthSales", "adjust.salesReturn": "reduceOriginalMonthSales",
    "payout.belowMinimum": "carryForward", "payout.carryForwardExpiry": "never" }, slabs: [], delaySteps: REFERENCE_TEMPLATE.delaySteps, eligibility: [] },
  D: { settings: { ...SHARED_TEMPLATE, "d.leadsPerUnit": 10, "d.leadUnitAmount": RS(250), "d.leadsMustBeProfiled": "yes", "d.conversionsPerUnit": 5, "d.conversionUnitAmount": RS(250), "caps.perEmployeeCategoryMonth": RS(1_000) }, slabs: [], delaySteps: [], eligibility: [] },
  E: { settings: { ...SHARED_TEMPLATE, "e.minAward": RS(250), "e.maxAward": RS(1_000), "caps.perEmployeeCategoryMonth": RS(1_000) }, slabs: [], delaySteps: [], eligibility: [] },
  // Category F (the original scheme, confirmed; 0138): F.1 ₹100, F.2 ₹100, F.3 ₹150, F.4 double; five stars, no word or
  // count minimum, recovery never lapses. The monthly limit is NOT here: the PDF shows ₹750 for Category F, but whether it
  // is per salesperson per month (and whether F.4 doubling counts inside it) isn't confirmed — it starts empty and blocks
  // submission and publishing until an approved value is entered. Editable starting values of a new draft only.
  F: { settings: { ...SHARED_TEMPLATE, "f.googleReviewAmount": RS(100), "f.emailAmount": RS(100), "f.letterheadAmount": RS(150), "f.namedMultiple": 2, "f.minRating": 5, "f.googleMinWords": 0, "f.minQualifyingReviews": 0, "f.googleNeedsEvidence": "yes", "f.recoveryExpiry": "never" }, slabs: [], delaySteps: [], eligibility: [] },
  G: { settings: {}, slabs: [], delaySteps: [], eligibility: [] },
};

/** A category's reference template (Category A's is REFERENCE_TEMPLATE, unchanged). */
export const referenceTemplateFor = (category: CategoryCode): IncentiveConfig => (category === "A" ? REFERENCE_TEMPLATE : category === "B" ? CATEGORY_B_TEMPLATE : (CATEGORY_TEMPLATES[category] ?? EMPTY_CONFIG));

/** Whether a category's versions have collection delay steps (C has; D, E, F and G don't — they aren't collected). */
export const hasDelaySteps = (category: CategoryCode) => category === "A" || category === "B" || category === "C";
