import type { DelayStep } from "@/lib/incentives/rules-config/spec";
import * as R from "@/lib/incentives/category-a/rational";
import type { Q } from "@/lib/incentives/category-a/rational";
import { daysBetween } from "./dates";
import { stepFor } from "./delay";
import type { Applied, HeldNote } from "./receipts";

/**
 * Category A's receipt-based collection rule for one unit (a Sales Order and its invoices), shared so another category
 * doesn't make its own: the receipts applied to the unit's invoices (lib/incentives/shared/receipts.ts, in date order)
 * are credited up to what the unit still owes (net of credit notes); each credited part earns at the delay step of ITS
 * OWN receipt, measured from its invoice's reference date ("Each receipt at its own delay"); "Whole order at its latest
 * payment's delay" puts every credited part at the latest receipt's step; "Weighted" earns as each receipt. A receipt
 * whose invoice has no reference date follows "When no due date can be found". The result is the unit's earning
 * factor: Σ(credited × step) ÷ what it owes — exact (rational), never rounded here. Same semantics as Category A's
 * engine (lib/incentives/category-a/engine.ts, §6–7), which keeps its own inline copy unchanged. Pure.
 */

export interface CollectedPart {
  receiptId: string;
  receiptNo: string;
  date: string;
  invoiceId: string;
  amount: Q;
  referenceDate: string | null;
  delayDays: number | null;
  multiplier: Q | null;
  status: "credited" | "held" | "excluded" | "over-collected";
  note: string;
}

export function collectUnit(args: {
  applied: readonly Applied[];
  invoiceIds: ReadonlySet<string>;
  /** What the unit owes: its invoices' totals less their credit notes and returns. */
  collectible: Q;
  referenceDate: (invoiceId: string) => { date: string; from: string } | null;
  invoiceNo: (invoiceId: string) => string;
  steps: readonly DelayStep[];
  boundary: string;
  missingDue: string;
  earning: string;
  held: HeldNote[];
  employeeId?: string | null;
}): { parts: CollectedPart[]; collected: Q; full: boolean; factor: Q } {
  const { applied, invoiceIds, collectible, referenceDate, steps, boundary, missingDue, earning, held } = args;
  const parts: CollectedPart[] = [];
  let collected = R.ZERO;
  for (const a of applied.filter((x) => invoiceIds.has(x.invoiceId))) {
    const room = R.max(R.ZERO, R.sub(collectible, collected));
    const c = R.min(a.amount, room);
    const over = R.sub(a.amount, c);
    if (!R.isZero(over)) parts.push({ receiptId: a.receiptId, receiptNo: a.receiptNo, date: a.date, invoiceId: a.invoiceId, amount: over, referenceDate: null, delayDays: null, multiplier: null, status: "over-collected", note: "More than still owed: earns nothing." });
    if (R.isZero(c)) continue;
    collected = R.add(collected, c);
    const ref = referenceDate(a.invoiceId);
    if (!ref) {
      if (missingDue === "treatAsOnTime") {
        parts.push({ receiptId: a.receiptId, receiptNo: a.receiptNo, date: a.date, invoiceId: a.invoiceId, amount: c, referenceDate: null, delayDays: 0, multiplier: R.ppm(stepFor(steps, 0, boundary).multiplierPpm), status: "credited", note: "No due date could be found: treated as on time." });
      } else if (missingDue === "holdForReview") {
        parts.push({ receiptId: a.receiptId, receiptNo: a.receiptNo, date: a.date, invoiceId: a.invoiceId, amount: c, referenceDate: null, delayDays: null, multiplier: null, status: "held", note: "No due date could be found: held for review." });
        held.push({ documentId: a.receiptId, documentNo: a.receiptNo, employeeId: args.employeeId ?? null, message: `No due date for invoice ${args.invoiceNo(a.invoiceId)}: held for review.` });
      } else {
        parts.push({ receiptId: a.receiptId, receiptNo: a.receiptNo, date: a.date, invoiceId: a.invoiceId, amount: c, referenceDate: null, delayDays: null, multiplier: null, status: "excluded", note: "No due date could be found: left out." });
      }
      continue;
    }
    const delay = Math.max(0, daysBetween(ref.date, a.date));
    const st = stepFor(steps, delay, boundary);
    parts.push({ receiptId: a.receiptId, receiptNo: a.receiptNo, date: a.date, invoiceId: a.invoiceId, amount: c, referenceDate: ref.date, delayDays: delay, multiplier: R.ppm(st.multiplierPpm), status: "credited", note: `${delay} days after ${ref.from} (${ref.date}): ${st.multiplierPpm / 10_000}%.` });
  }
  const full = R.cmp(collectible, R.ZERO) > 0 && R.cmp(collected, collectible) >= 0;
  const counted = parts.filter((p) => p.status === "credited" && p.multiplier);
  const last = counted.length ? counted.reduce((a, b) => (b.date > a.date || (b.date === a.date && R.cmp(b.multiplier!, a.multiplier!) < 0) ? b : a)) : null;
  const earnedWeight = R.sum(counted.map((p) => R.mul(p.amount, earning === "wholeOrderWorstReceipt" ? last!.multiplier! : p.multiplier!)));
  const factor = R.cmp(collectible, R.ZERO) > 0 ? R.div(earnedWeight, collectible) : R.ZERO;
  return { parts, collected, full, factor };
}
