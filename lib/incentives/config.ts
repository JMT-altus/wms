// The PDF "Sales BH" scheme as engine config, in integer paise. Every value is
// data (never hard-coded in a rule) so a future admin Scheme Builder can edit
// it and mint a new rule_version. The §7 defaults from docs/incentive-tracker/
// PLAN.md are applied here and flagged inline.

import type { SchemeConfig } from "./types";

/** Rupees → paise. */
export const P = (rupees: number): number => Math.round(rupees * 100);
/** Lakhs → paise (1 L = ₹1,00,000). */
export const L = (lakhs: number): number => Math.round(lakhs * 1_00_000 * 100);
/** Crores → paise (1 Cr = ₹1,00,00,000). */
export const CR = (crores: number): number => Math.round(crores * 1_00_00_000 * 100);

export const SALES_BH_SCHEME: SchemeConfig = {
  // A — marginal slabs, eligible only above ₹1 Cr/month. Rates: 0.10 / 0.15 /
  // 0.20 %. Bands map to lines A.1 / A.2 / A.3 in order.
  entryThresholdPaise: CR(1.0),
  slabBands: [
    { fromPaise: CR(1.0), toPaise: CR(1.2), rate: 0.001 },  // A.1  0.10%
    { fromPaise: CR(1.2), toPaise: CR(1.4), rate: 0.0015 }, // A.2  0.15%
    { fromPaise: CR(1.4), toPaise: CR(1.6), rate: 0.002 },  // A.3  0.20%
  ],
  slabContinuesAboveTop: false, // Q1 default: cap at ₹9,000 above ₹1.6 Cr

  // B — cross-sell / up-sell: flat 1% of the first invoice above ₹1 L.
  crossSell: { rate: 0.01, minInvoicePaise: L(1) },

  // C — new customer: flat 1% on first 3 transactions, ≥ ₹2.5 L FY turnover,
  // 3 transactions done, fully paid.
  newCustomer: { rate: 0.01, minTurnoverPaise: L(2.5), requiredTxns: 3 },

  // D — ₹250 per 10 profiled leads (D.1); ₹250 per 5 lead→enquiry (D.2).
  leads: { perUnit: 10, unitPaise: P(250) },
  conversions: { perUnit: 5, unitPaise: P(250) },

  // E — discretionary ₹250–₹1,000 per high-value meeting.
  meeting: { minPaise: P(250), maxPaise: P(1000) },

  // F — Google review ₹100 (5★, ≥50 words), email ₹100, letterhead ₹150.
  // F.4 doubles any of these when the text names the employee / a teammate.
  testimonials: {
    googleReviewPaise: P(100),
    emailPaise: P(100),
    letterheadPaise: P(150),
    minWords: 50,
    requireFiveStar: true,
    appreciationMultiplier: 2,
  },

  retentionEnabled: false, // Q4 default: G stays off until amounts are defined

  // Per-line caps beyond the per-occurrence caps handled in the rules.
  lineCaps: {},

  // Category ceilings (reconcile to the ₹18,250 grand total).
  categoryCaps: {
    A: P(9000),
    B: P(1500),
    C: P(5000),
    D: P(1000),
    E: P(1000),
    F: P(750),
    G: P(0),
  },
  schemeMonthlyCapPaise: P(18250),

  // Collection decay by days past agreed terms (Q5 per-invoice, Q6 any delay).
  decaySteps: [
    { maxDaysPastTerms: 45, multiplier: 1 },
    { maxDaysPastTerms: 75, multiplier: 0.5 },
    { maxDaysPastTerms: 100, multiplier: 0.25 },
    { maxDaysPastTerms: Infinity, multiplier: 0 },
  ],
};
