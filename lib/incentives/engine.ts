// The engine orchestrator. `evaluate()` is a PURE function:
//   (input, scheme, ) → EvaluationResult
// No DB writes, no Date. Re-running it for a historical month reproduces the
// exact same numbers — that is what makes any payout defensible and lets the
// nightly job be idempotent. Decay is applied LAST, per accrual.

import type { CategoryCode, EvaluationInput, EvaluationResult, LineResult, SchemeConfig } from "./types";
import { collectAccruals } from "./rules";
import { applyCaps } from "./caps";
import { decayLabel } from "./collection";

const CATS: CategoryCode[] = ["A", "B", "C", "D", "E", "F", "G"];

export function evaluate(input: EvaluationInput, scheme: SchemeConfig): EvaluationResult {
  const accruals = collectAccruals(input, scheme);
  const capped = applyCaps(accruals, scheme);

  // 5 · collection decay — applied last, per accrual, to the post-cap amount.
  const lines: LineResult[] = capped.map((l) => {
    const finalPaise = Math.round(l.cappedPaise * l.decayMultiplier);
    const decayNote =
      l.decayMultiplier < 1 && l.cappedPaise > 0
        ? ` Decay ×${decayLabel(l.decayMultiplier)}${finalPaise === 0 ? " → NIL" : ""}.`
        : "";
    return {
      ...l,
      finalPaise,
      capNote: (l.capNote ?? "") + decayNote || undefined,
    };
  });

  const categoryTotals = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<CategoryCode, number>;
  let totalPrePaise = 0;
  let totalFinalPaise = 0;
  for (const l of lines) {
    categoryTotals[l.category] += l.finalPaise;
    totalPrePaise += l.prePaise;
    totalFinalPaise += l.finalPaise;
  }

  const schemeCapApplied = lines.some((l) => l.capNote?.includes("Scheme cap"));

  return {
    employeeId: input.employeeId,
    period: input.period,
    lines,
    categoryTotals,
    totalPrePaise,
    totalFinalPaise,
    schemeCapApplied,
  };
}
