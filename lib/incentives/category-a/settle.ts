import type { SettingValue } from "@/lib/incentives/rules-config/spec";

/**
 * What happens to a new calculation of a month — PURE, from the period's state and the configuration's settings:
 *   * adopted (it becomes the month's figures) only while the month is open, and only within the configured
 *     recalculation window ("A month is recalculated until", "Changes affecting a month still open");
 *   * a LOCKED, APPROVED or PAID month is never changed: the new run is kept for the record, and the difference per
 *     salesperson is carried — into the calculation date's month, or the month after the recalculated one when that is
 *     later; the caller takes the first of those that is OPEN (never dropped) — or not, as "Changes affecting a locked or paid month",
 *     "Payments that arrive after a month is locked" and "Days after payout that adjustments are allowed" say;
 *   * a month past its automatic lock date is locked first ("Locking a month").
 * And what happens to a negative balance when a month is locked ("When adjustments make a month negative").
 */

export type PeriodStatus = "open" | "locked" | "submitted" | "approved" | "paid";

export interface PeriodState {
  month: string;
  status: PeriodStatus;
  hasCurrentRun: boolean;
  currentRunSettled: boolean;
  paidAt: string | null;
}

export interface Payables {
  /** Payable paise per salesperson in the adopted run (absent = 0). */
  adopted: Record<string, number>;
  /** Payable paise per salesperson in the new run. */
  fresh: Record<string, number>;
  /** Differences already carried out of this month, per salesperson. */
  carried: Record<string, number>;
}

export interface Decision {
  lockFirst: boolean;
  adopt: boolean;
  outcome: string;
  carries: { employeeId: string; amountPaise: number; toMonth: string }[];
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const monthEnd = (monthStart: string) => {
  const [y, m] = monthStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const nextMonth = (monthStart: string) => {
  const [y, m] = monthStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
export const monthStartOf = (day: string) => `${day.slice(0, 7)}-01`;

/**
 * Why a calculation date can't be used, or null. A month is calculated AS OF a day (stored with the run's inputs and in
 * its inputs hash): never before the month's first day, and never in the future — a future day would lock months, carry
 * differences and expire balances by a date that hasn't come (`today` is the calculation's own today, in India).
 */
export function calculationDateProblem(month: string, asOf: string, today: string): string | null {
  // A real calendar day, strictly (the same round trip as rules-config/validate.ts isDay): 2026-02-30 or 2026-13-01 is
  // refused, never rolled over to another day.
  const realDay = /^\d{4}-\d{2}-\d{2}$/.test(asOf) && !Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)) && new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) === asOf;
  if (!realDay || asOf < month) return "The calculation date must be on or after the month's first day.";
  if (asOf > today) return `The calculation date (${asOf}) can't be in the future: a month is calculated as of today (${today}) or an earlier day. Nothing was calculated.`;
  return null;
}

/**
 * Where a locked, approved or paid month's difference is carried: the month of the calculation date, but never the
 * recalculated month itself (nor one before it) — then the month after it. A difference found in the month it belongs to
 * (a locked month recalculated before its month ends) therefore waits for no one: it goes to the next month.
 */
export const carryCandidate = (month: string, asOf: string) => {
  const current = monthStartOf(asOf);
  const after = nextMonth(month);
  return current > after ? current : after;
};

/**
 * The first month, from `from`, that can take a carried difference (`open` says whether a month is open and not voided;
 * a month with no period yet is open), looking at most `limit` months ahead; null when none is. PURE.
 */
export function firstOpenMonth(from: string, open: (month: string) => boolean, limit = 12): string | null {
  let m = from;
  for (let i = 0; i < limit; i++, m = nextMonth(m)) if (open(m)) return m;
  return null;
}

export function decide(settings: Readonly<Record<string, SettingValue>>, period: PeriodState, asOf: string, computed: boolean, pay: Payables): Decision {
  const s = settings;
  const end = monthEnd(period.month);
  let status = period.status;
  let lockFirst = false;
  if (status === "open" && s["period.lockMode"] === "autoAfterDays" && period.hasCurrentRun && asOf > addDays(end, s["period.autoLockDays"] as number)) {
    status = "locked";
    lockFirst = true;
  }
  if (!computed) return { lockFirst: false, adopt: false, outcome: "Blocked: nothing was calculated (see the reasons).", carries: [] };

  if (status === "open") {
    if (!period.hasCurrentRun) return { lockFirst, adopt: true, outcome: "Adopted: the month's first calculation.", carries: [] };
    if (s["adjust.openMonths"] === "freezeAtLastCompute") return { lockFirst, adopt: false, outcome: "Kept for the record, not adopted: the month keeps its last calculation (Changes affecting a month still open).", carries: [] };
    const until = s["period.recalcUntil"];
    if (until === "fixedDaysAfterMonthEnd" && asOf > addDays(end, s["period.recalcDays"] as number))
      return { lockFirst, adopt: false, outcome: `Kept for the record, not adopted: recalculation ended ${s["period.recalcDays"]} days after the month (${addDays(end, s["period.recalcDays"] as number)}).`, carries: [] };
    if (until === "untilOrdersSettled" && period.currentRunSettled) return { lockFirst, adopt: false, outcome: "Kept for the record, not adopted: every order of the month had already settled.", carries: [] };
    return { lockFirst, adopt: true, outcome: "Adopted: replaces the month's previous calculation.", carries: [] };
  }

  // Locked, approved or paid: never changed. Carry the difference, or not — into the calculation date's month, or the
  // month after the recalculated one when that is later (the caller then takes the first of those that is open).
  const word = status === "locked" ? "locked" : status;
  const target = carryCandidate(period.month, asOf);
  const diffs = Object.keys({ ...pay.adopted, ...pay.fresh, ...pay.carried })
    .sort()
    .map((e) => ({ employeeId: e, amountPaise: (pay.fresh[e] ?? 0) - (pay.adopted[e] ?? 0) - (pay.carried[e] ?? 0) }))
    .filter((d) => d.amountPaise !== 0);
  const kept = `Kept for the record, not adopted: the month is ${word}${lockFirst ? " (locked automatically now)" : ""}.`;
  if (!diffs.length) return { lockFirst, adopt: false, outcome: `${kept} No difference to carry.`, carries: [] };
  if ((status === "locked" || status === "submitted") && s["period.lateReceipts"] === "reopenRequired") return { lockFirst, adopt: false, outcome: `${kept} It differs; reopen the month to take the difference (Payments that arrive after a month is locked).`, carries: [] };
  if (s["adjust.lockedOrPaidMonths"] === "noAdjustment") return { lockFirst, adopt: false, outcome: `${kept} It differs; no adjustment is made (configured).`, carries: [] };
  // A payout becomes final after the configured days. Category B sets the days only when an expiry was chosen ("When
  // recovery after payout stops"); without them recovery never lapses on its own. Category A always has them.
  // Category F's own choice works the same way (f.recoveryExpiry exists only in Category F versions, so every other
  // category reads exactly as before).
  if (status === "paid" && period.paidAt && typeof s["adjust.windowDays"] === "number" && s["b.recoveryExpiry"] !== "never" && s["f.recoveryExpiry"] !== "never") {
    const windowEnd = addDays(period.paidAt.slice(0, 10), s["adjust.windowDays"] as number);
    if (asOf > windowEnd) return { lockFirst, adopt: false, outcome: `${kept} It differs, but the payout became final on ${windowEnd} (Days after payout that adjustments are allowed).`, carries: [] };
  }
  return { lockFirst, adopt: false, outcome: `${kept} The difference is carried into ${target.slice(0, 7)}.`, carries: diffs.map((d) => ({ ...d, toMonth: target })) };
}

/** When a month is locked: what to do with a salesperson's negative total (payable + carried in). */
export function negativeBalance(
  settings: Readonly<Record<string, SettingValue>>,
  month: string,
  net: number,
  monthsLeftIn: number | null,
): { kind: "negative-carry" | "write-off" | "salary-recovery"; amountPaise: number; toMonth: string | null; monthsLeft: number | null; note: string } | null {
  if (net >= 0) return null;
  const rule = settings["adjust.negativeBalance"];
  if (rule === "writeOff") return { kind: "write-off", amountPaise: -net, toMonth: null, monthsLeft: null, note: "Negative balance written off (configured)." };
  if (rule === "recoverFromSalary") return { kind: "salary-recovery", amountPaise: -net, toMonth: null, monthsLeft: null, note: "Negative balance to be recovered from salary (configured)." };
  if (rule === "carryForwardMonths") {
    const left = monthsLeftIn ?? (settings["adjust.carryForwardMonths"] as number);
    if (left <= 0) return { kind: "write-off", amountPaise: -net, toMonth: null, monthsLeft: null, note: "Negative balance written off: it was carried for the configured number of months." };
    return { kind: "negative-carry", amountPaise: net, toMonth: nextMonth(month), monthsLeft: left - 1, note: `Negative balance carried into ${nextMonth(month).slice(0, 7)} (${left - 1} more month(s) after that).` };
  }
  return { kind: "negative-carry", amountPaise: net, toMonth: nextMonth(month), monthsLeft: null, note: `Negative balance recovered from the next payout (${nextMonth(month).slice(0, 7)}).` };
}
