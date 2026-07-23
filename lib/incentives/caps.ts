// The deterministic cap cascade. Applied in a fixed order, recording where
// value was lost so the employee sees "you earned ₹1,900 but the D-category cap
// held it at ₹1,000":
//
//   1. per-occurrence cap  → handled inside each rule (B.1 ₹1,500, C.1 ₹5,000…)
//   2. per-line cap        → config.lineCaps[code]
//   3. category cap        → config.categoryCaps[category]
//   4. scheme-wide monthly → config.schemeMonthlyCapPaise
//   5. collection decay    → applied LAST, per accrual (see engine.ts)
//
// Caps 2–4 use stable-order truncation (not proportional scaling) so every
// figure stays an exact integer paise and the *earlier* occurrences are kept.

import type { Accrual, CategoryCode, LineCode, LineResult, SchemeConfig } from "./types";
import { formatInrPaise } from "@/lib/format";

/** Stable sort key so truncation is deterministic across runs (idempotency). */
function orderKey(a: Accrual): string {
  return `${a.category}|${a.lineCode}|${a.sourceRef}`;
}

/**
 * Truncate a set of amounts to `cap`, in stable order. Returns the capped
 * amount per input index and whether the cap bound at all.
 */
function truncate(values: number[], cap: number): { capped: number[]; bound: boolean } {
  let remaining = cap;
  let bound = false;
  const capped = values.map((v) => {
    const take = Math.max(0, Math.min(v, remaining));
    if (take < v) bound = true;
    remaining -= take;
    return take;
  });
  return { capped, bound };
}

/**
 * Apply per-line, per-category and scheme-wide caps to `accruals` (all pre-decay).
 * Returns LineResults with `prePaise`, `cappedPaise` (post-cap, pre-decay) and a
 * `capNote` where value was lost. Decay is applied later, in the engine.
 */
export function applyCaps(accruals: Accrual[], config: SchemeConfig): LineResult[] {
  const ordered = [...accruals].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

  // Working post-cap value per accrual, seeded from the pre-cap base.
  const capped = ordered.map((a) => a.basePaise);
  const notes = ordered.map<string | undefined>(() => undefined);

  const addNote = (i: number, text: string) => {
    notes[i] = notes[i] ? `${notes[i]} ${text}` : text;
  };

  // 2 · per-line caps
  const byLine = new Map<LineCode, number[]>();
  ordered.forEach((a, i) => {
    const arr = byLine.get(a.lineCode) ?? [];
    arr.push(i);
    byLine.set(a.lineCode, arr);
  });
  for (const [line, idxs] of byLine) {
    const cap = config.lineCaps[line];
    if (cap == null) continue;
    const { capped: c, bound } = truncate(idxs.map((i) => capped[i]!), cap);
    idxs.forEach((i, k) => (capped[i] = c[k]!));
    if (bound) idxs.forEach((i) => addNote(i, `Line ${line} cap ${formatInrPaise(cap)}.`));
  }

  // 3 · category caps
  const byCat = new Map<CategoryCode, number[]>();
  ordered.forEach((a, i) => {
    const arr = byCat.get(a.category) ?? [];
    arr.push(i);
    byCat.set(a.category, arr);
  });
  for (const [cat, idxs] of byCat) {
    const cap = config.categoryCaps[cat];
    if (cap == null) continue;
    const { capped: c, bound } = truncate(idxs.map((i) => capped[i]!), cap);
    idxs.forEach((i, k) => (capped[i] = c[k]!));
    if (bound) idxs.forEach((i) => addNote(i, `Category ${cat} cap ${formatInrPaise(cap)}.`));
  }

  // 4 · scheme-wide monthly cap
  {
    const idxs = ordered.map((_, i) => i);
    const { capped: c, bound } = truncate(
      idxs.map((i) => capped[i]!),
      config.schemeMonthlyCapPaise,
    );
    idxs.forEach((i, k) => (capped[i] = c[k]!));
    if (bound)
      idxs.forEach((i) =>
        addNote(i, `Scheme cap ${formatInrPaise(config.schemeMonthlyCapPaise)}.`),
      );
  }

  return ordered.map((a, i) => ({
    lineCode: a.lineCode,
    category: a.category,
    sourceRef: a.sourceRef,
    prePaise: a.basePaise,
    cappedPaise: capped[i]!,
    decayMultiplier: a.decayMultiplier,
    finalPaise: 0, // filled by the engine after decay
    explanation: a.explanation,
    capNote: notes[i],
  }));
}
