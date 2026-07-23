// Collection-decay rule — the multiplier applied LAST, per source invoice,
// keyed to how far past the agreed payment terms a receipt landed.
//
//   ≤ 45 days → 1.00 · 46–75 → 0.50 · 76–100 → 0.25 · > 100 → 0.00
//
// This is what makes an incentive "a time-varying function of an invoice's
// collection state" — an amount earned in April can legitimately halve in June.

import type { DecayStep } from "./types";

/**
 * Decay multiplier for a payment `daysPastTerms` beyond agreed terms.
 * `undefined`/negative days = on time = 1.0. Steps are evaluated in order; the
 * first step whose `maxDaysPastTerms` bound is not exceeded wins.
 */
export function decayMultiplier(
  daysPastTerms: number | undefined,
  steps: DecayStep[],
): number {
  if (daysPastTerms == null || daysPastTerms <= 0) return 1;
  for (const step of steps) {
    if (daysPastTerms <= step.maxDaysPastTerms) return step.multiplier;
  }
  return 0;
}

/** Human label for a decay multiplier, e.g. "1.00", "0.50". */
export function decayLabel(m: number): string {
  return m.toFixed(2);
}
