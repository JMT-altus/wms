// Incentive rule-engine types. Money is ALWAYS integer paise (1 rupee = 100
// paise); format only at the UI edge. Everything here is pure data — no DB,
// no Date — mirroring lib/salary/compute.ts.

export type Paise = number;

export type CategoryCode = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type LineCode =
  | "A.1" | "A.2" | "A.3"
  | "B.1"
  | "C.1"
  | "D.1" | "D.2"
  | "E.1"
  | "F.1" | "F.2" | "F.3"
  | "G.1" | "G.2";

export type TestimonialKind = "google_review" | "email" | "letterhead";

// ── Scheme configuration (the PDF "Sales BH" scheme, all values editable) ──

export interface SlabBand {
  fromPaise: Paise;
  toPaise: Paise;
  rate: number; // fraction, e.g. 0.001 for 0.10%
}

/** One decay step: payments this many days past agreed terms pay `multiplier`. */
export interface DecayStep {
  maxDaysPastTerms: number; // inclusive upper bound; use Infinity for the last
  multiplier: number;       // 1 | 0.5 | 0.25 | 0
}

export interface SchemeConfig {
  // A — marginal sales slabs
  entryThresholdPaise: Paise;      // eligible only above this monthly sales
  slabBands: SlabBand[];
  slabContinuesAboveTop: boolean;  // Q1: false = cap at the top band

  // B — cross-sell / up-sell
  crossSell: { rate: number; minInvoicePaise: Paise };

  // C — new-customer acquisition
  newCustomer: { rate: number; minTurnoverPaise: Paise; requiredTxns: number };

  // D — leads & conversions
  leads: { perUnit: number; unitPaise: Paise };
  conversions: { perUnit: number; unitPaise: Paise };

  // E — discretionary meeting award
  meeting: { minPaise: Paise; maxPaise: Paise };

  // F — reviews / testimonials
  testimonials: {
    googleReviewPaise: Paise;
    emailPaise: Paise;
    letterheadPaise: Paise;
    minWords: number;
    requireFiveStar: boolean;
    appreciationMultiplier: number; // F.4
  };

  // G — retention (undefined in the sheet → disabled by default)
  retentionEnabled: boolean;

  // Caps
  lineCaps: Partial<Record<LineCode, Paise>>;
  categoryCaps: Record<CategoryCode, Paise>;
  schemeMonthlyCapPaise: Paise;

  // Collection decay (applied last, per source)
  decaySteps: DecayStep[];
}

// ── Evaluation input: an employee's resolved facts for one period ──

export interface SalesSlabInput {
  monthlySalesPaise: Paise;
  /** A is "payable on collection of full amount"; a per-invoice blended decay
   *  multiplier for the slab (default 1 = fully collected on time). */
  decayMultiplier?: number;
}

export interface CrossSellInvoice {
  id: string;
  customer?: string;
  invoiceValuePaise: Paise;
  daysPastTerms?: number; // drives decay; undefined = on time
}

export interface NewCustomerCohort {
  id: string;
  customer?: string;
  first3TotalPaise: Paise;
  fyTurnoverPaise: Paise;
  transactionsDone: number;
  fullyPaid: boolean;
  daysPastTerms?: number;
}

export interface LeadBatchInput {
  id: string;
  leadCount: number;
  profiled: boolean;
  approved: boolean;
}

export interface LeadConversionInput {
  id: string;
  convertedCount: number;
  approved: boolean;
}

export interface MeetingInput {
  id: string;
  awardedPaise: Paise; // admin-set, clamped to [min,max]
  approved: boolean;
}

export interface TestimonialInput {
  id: string;
  kind: TestimonialKind;
  wordCount: number;
  starRating?: number;     // required 5 for google_review
  hasScreenshot?: boolean; // google_review evidence
  namesTeamMember: boolean; // triggers F.4 doubling
  approved: boolean;
}

export interface EvaluationInput {
  employeeId: string;
  period: string; // "YYYY-MM"
  sales?: SalesSlabInput;
  crossSellInvoices?: CrossSellInvoice[];
  newCustomerCohorts?: NewCustomerCohort[];
  leadBatches?: LeadBatchInput[];
  leadConversions?: LeadConversionInput[];
  meetings?: MeetingInput[];
  testimonials?: TestimonialInput[];
}

// ── Engine output ──

/** A raw earned amount from one rule, before the cap cascade. */
export interface Accrual {
  lineCode: LineCode;
  category: CategoryCode;
  sourceRef: string;      // deterministic key for idempotency
  basePaise: Paise;       // pre-cap, pre-decay
  decayMultiplier: number;
  explanation: string;    // human-readable audit string (pre-decay math)
}

export interface LineResult {
  lineCode: LineCode;
  category: CategoryCode;
  sourceRef: string;
  prePaise: Paise;        // pre-cap, pre-decay
  cappedPaise: Paise;     // after the cap cascade, still pre-decay
  decayMultiplier: number;
  finalPaise: Paise;      // after decay — the payable amount
  explanation: string;
  capNote?: string;       // set when a cap reduced this line
}

export interface EvaluationResult {
  employeeId: string;
  period: string;
  lines: LineResult[];
  categoryTotals: Record<CategoryCode, Paise>; // final (post-decay) per category
  totalPrePaise: Paise;
  totalFinalPaise: Paise;
  schemeCapApplied: boolean;
}
