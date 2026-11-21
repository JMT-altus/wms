import { CATEGORY_LABEL, type IncentiveConfig, type SettingValue } from "@/lib/incentives/rules-config/spec";
import { checkConfig, isDay, isMonthStart, pct, rupees } from "@/lib/incentives/rules-config/validate";
import * as R from "@/lib/incentives/category-a/rational";
import type { Q } from "@/lib/incentives/category-a/rational";
import type { EmployeeIn, Note, ReceiptIn } from "@/lib/incentives/category-a/types";
import { addDays, byKey, docKey, monthEnd, monthOf, monthsBefore, natural } from "@/lib/incentives/shared/dates";
import { makeReferenceDate } from "@/lib/incentives/shared/delay";
import { applyReceipts } from "@/lib/incentives/shared/receipts";
import { collectUnit } from "@/lib/incentives/shared/collection";
import { makePeople } from "@/lib/incentives/shared/people";
import { allCategoriesAllowance } from "@/lib/incentives/shared/all-categories";
import { ENGINE_VERSIONS, type CarryIn, type CarryLotIn, type CarryOutcome, type FReviewIn, type CReviewCase, type CReviewKind, type OrderXIn as OrderBIn, type CategoryXInput, type CategoryXResult, type EmployeeResultX, type ExtraCategory, type ItemResult } from "./types";

/**
 * Categories C–G — the calculations. PURE and deterministic. One skeleton for all five (the published version, its
 * checks, who may earn, the month's totals, rounding and limits); each category's rule is its own function below,
 * because the rules differ:
 *   C — a new customer's first transactions of the financial year (old engine C.1);
 *   D — approved lead batches and lead-to-enquiry conversions, per unit (old engine D.1, D.2);
 *   E — approved high-value client meetings, the admin's award kept between a smallest and a largest amount (E.1);
 *   F — approved reviews and testimonials, multiplied when they name the salesperson or a teammate (F.1–F.4);
 *   G — consecutive monthly purchases by a customer: a PROPOSED structure whose every value must be decided.
 * Every amount, rate, threshold and limit is a setting of the published version; nothing is assumed.
 */

type S = Record<string, SettingValue>;
const str = (s: S, k: string) => s[k] as string;
const num = (s: S, k: string) => s[k] as number;
const list = (s: S, k: string) => (s[k] as string[] | undefined) ?? [];
const cap = (s: S, k: string): number | null => (s[k] === "none" ? null : (s[k] as number));

/** Why the configuration can't be used for this month, or nothing. */
export function configProblemsX(input: CategoryXInput): string[] {
  const out: string[] = [];
  const c = input.category;
  if (!isMonthStart(input.month)) out.push(`${input.month} isn't the first day of a month.`);
  if (!isDay(input.asOf)) out.push(`${input.asOf} isn't a date.`);
  const v = input.configVersion;
  if (!v || !input.config) {
    out.push(`No published Category ${c} (${CATEGORY_LABEL[c]}) configuration is in force for ${input.month.slice(0, 7)}. Publish one in Admin & Master Setup → Incentive Rules.`);
    return out;
  }
  if (v.status !== "published") out.push(`Configuration version ${v.versionNo} is ${v.status}, not published: only a published version can be used.`);
  if (!v.effectiveFrom || v.effectiveFrom > input.month || (v.effectiveTo !== null && v.effectiveTo < monthEnd(input.month)))
    out.push(`Configuration version ${v.versionNo} isn't in force for the whole of ${input.month.slice(0, 7)} (${v.effectiveFrom ?? "no start"} – ${v.effectiveTo ?? "open"}).`);
  const { problems, missing } = checkConfig(input.config, { roles: input.roles, category: c });
  for (const p of problems) out.push(`Configuration problem: ${p.message}`);
  for (const m of missing) out.push(`Configuration incomplete: ${m.message}`);
  if (!problems.length && input.config.settings["period.unit"] !== "calendarMonth") out.push("Only a calendar-month calculation period is supported.");
  if (input.allCategories?.problem) out.push(input.allCategories.problem);
  return out;
}

function blocked(input: CategoryXInput, problems: string[]): CategoryXResult {
  return { engineVersion: ENGINE_VERSIONS[input.category], category: input.category, status: "blocked", problems, month: input.month, asOf: input.asOf, configVersionId: input.configVersion?.id ?? null, configVersionNo: input.configVersion?.versionNo ?? null, employees: [], items: [], held: [], excluded: [], settled: false, settingsUsed: input.config?.settings ?? {} };
}

interface Ctx {
  input: CategoryXInput;
  s: S;
  cfg: IncentiveConfig;
  month: string;
  people: ReturnType<typeof makePeople<EmployeeIn>>;
  excluded: Note[];
  held: Note[];
  items: ItemResult[];
  settled: boolean;
  /** C: records held for an admin's review. */
  reviewCases?: CReviewCase[];
}

export function calculateCategoryX(input: CategoryXInput): CategoryXResult {
  const problems = configProblemsX(input);
  if (problems.length) return blocked(input, problems);
  const cfg = input.config as IncentiveConfig;
  const s = cfg.settings;
  const ctx: Ctx = {
    input,
    s,
    cfg,
    month: input.month.slice(0, 7),
    people: makePeople({ settings: s, eligibility: cfg.eligibility, employees: input.employees, customers: input.customers ?? [], repHistory: input.repHistory ?? [], attributions: input.attributions ?? [] }),
    excluded: [],
    held: [],
    items: [],
    settled: true,
  };
  ({ C: ruleC, D: ruleD, E: ruleE, F: ruleF, G: ruleG })[input.category](ctx);

  // The month's totals per salesperson: rounding, the category's monthly limit, the all-categories limit — and, for a
  // version with a smallest amount paid in a month (the carry model, 0136), that amount on the month's TOTAL: this
  // month's own amount after every limit, plus the balances carried forward and the adjustments carried into the month.
  const method = str(s, "rounding.method") as R.RoundingMethod;
  const precision = str(s, "rounding.precision") as R.RoundingPrecision;
  const capMonth = cap(s, "caps.perEmployeeCategoryMonth");
  const capAll = cap(s, "caps.perEmployeeAllCategoriesMonth");
  const carryModel = s["payout.minimumPayable"] !== undefined;
  const carryOf = new Map((input.carry ?? []).map((c) => [c.employeeId, c]));
  const ids = new Set(ctx.items.map((i) => i.employeeId));
  if (carryModel) for (const c of input.carry ?? []) if (c.lots.length || c.adjustmentsPaise) ids.add(c.employeeId);
  const employees: EmployeeResultX[] = [];
  const overLimit: string[] = [];
  for (const eid of [...ids].sort()) {
    const mine = ctx.items.filter((i) => i.employeeId === eid);
    const name = ctx.people.employeeById.get(eid)?.name ?? carryOf.get(eid)?.name ?? "Former employee";
    const sum = (k: "baseExact" | "earnedExact" | "payableExact") => R.sum(mine.map((i) => R.fromText(i[k])));
    let earned = R.q(R.round(sum("earnedExact"), method, precision));
    let payable = R.q(R.round(sum("payableExact"), method, precision));
    const limits: string[] = [];
    const applyCap = (c: number | null, label: string) => {
      if (c === null) return;
      if (R.cmp(earned, R.q(c)) > 0 || R.cmp(payable, R.q(c)) > 0) limits.push(`${label}: ${rupees(c)}.`);
      earned = R.min(earned, R.q(c));
      payable = R.min(payable, R.q(c));
    };
    applyCap(capMonth, `Limited to the most a salesperson can earn from Category ${input.category} in a month`);
    let before: number | undefined;
    if (input.allCategories) {
      before = R.round(earned, method, precision);
      const a = allCategoriesAllowance({ capPaise: input.allCategories.capPaise, policy: input.allCategories.policy, order: input.allCategories.order, own: input.category, ownPrePaise: before, others: input.allCategories.others[eid] ?? [] });
      if (a.allowedPaise < before) {
        earned = R.min(earned, R.q(a.allowedPaise));
        payable = R.min(payable, R.q(a.allowedPaise));
        if (a.note) limits.push(a.note);
      }
    } else applyCap(capAll, "Limited by the most a salesperson can earn from all categories in a month");
    const earnedPaise = R.round(earned, method, precision);
    const payablePaise = R.round(payable, method, precision);
    const credited = mine.filter((i) => i.status === "credited").length;
    const row: EmployeeResultX = {
      employeeId: eid,
      name,
      salesPaise: R.round(sum("baseExact"), "halfUp", "paise"),
      qualified: credited > 0,
      items: mine.length,
      baseExact: R.text(sum("baseExact")),
      earnedExact: R.text(sum("earnedExact")),
      payableExact: R.text(sum("payableExact")),
      earnedPaise,
      payablePaise,
      pendingPaise: earnedPaise - payablePaise,
      projectedPaise: 0,
      ...(before !== undefined ? { beforeAllCategoriesPaise: before } : {}),
      limits,
      explanation: [`${mine.length} item${mine.length === 1 ? "" : "s"} for Category ${input.category} in ${ctx.month}: ${rupees(R.round(sum("baseExact"), "halfUp", "paise"))} before limits.`],
    };
    if (carryModel) {
      const c = applyCarry(s, ctx.month, payablePaise, carryOf.get(eid), limits);
      // payable = what is RELEASED this month (own + carried + adjustments, or nothing when below the minimum);
      // the exact value is that same whole-paise amount, so exact and rounded never disagree. The own amount stays
      // beside it (exact and rounded), and only a released own amount uses the shared all-categories limit.
      // Stored as the month's figures: earned = what the month has available (its own earned plus what is carried in,
      // never below zero), payable = what is released, pending = the rest — so the stored row always satisfies
      // payable ≤ earned and pending = earned − payable; the month's own figures stay beside them.
      const available = Math.max(0, earnedPaise + c.carriedIn);
      // The shared all-categories limit (category-c/4): only a RELEASED month uses it (a held one uses none). It uses
      // this month's own EARNED amount after its limits (as category-c/3 did, and as the other categories count theirs;
      // in Category C earned and payable are the same — nothing until every invoice is fully collected) and the
      // balances carried forward that it releases (they used none of the limit in the month they were held, so they are
      // counted once, here). Adjustments carried in are not counted, either way: a positive one was kept within its own
      // month's limit by that month's recalculation, and a recovery corrects an earlier month — it lowers what is paid,
      // not what this month earned, so the month never reserves less than it earned (the cautious direction).
      const lotsReleased = c.released > 0 ? c.outcome.lots.filter((l) => l.outcome === "released").reduce((a, l) => a + l.amountPaise, 0) : 0;
      const sharedPre = c.released > 0 ? (before ?? earnedPaise) + lotsReleased : 0;
      const consumed = c.released > 0 ? Math.max(0, earnedPaise + lotsReleased) : 0;
      if (lotsReleased > 0) {
        // Released balances may not take the month above the shared limit. Whether such a balance is paid anyway, waits for
        // room, or is cut is NOT DECIDED — so the calculation stops (nothing is released or lost) until it is.
        const room = input.allCategories ? allCategoriesAllowance({ capPaise: input.allCategories.capPaise, policy: input.allCategories.policy, order: input.allCategories.order, own: input.category, ownPrePaise: sharedPre, others: input.allCategories.others[eid] ?? [] }).allowedPaise : capAll;
        if (room !== null && earnedPaise + lotsReleased > room)
          overLimit.push(
            `${name}: this month's ${rupees(earnedPaise)} and the ${rupees(lotsReleased)} carried forward it would release come to ${rupees(earnedPaise + lotsReleased)}, above the ${rupees(room)} the all-categories limit leaves for Category ${input.category} in ${ctx.month}. Whether a released balance may exceed the limit, waits for room, or is cut is not decided yet, so nothing was calculated (nothing is released or lost).`,
          );
      }
      Object.assign(row, {
        earnedPaise: available,
        earnedExact: R.text(R.q(available)),
        ownEarnedExact: R.text(earned),
        payablePaise: c.released,
        pendingPaise: available - c.released,
        payableExact: R.text(R.q(c.released)),
        ownEarnedPaise: earnedPaise,
        ownPayableExact: R.text(payable),
        ownPayablePaise: payablePaise,
        carriedInPaise: c.carriedIn,
        netPaise: c.net,
        carry: c.outcome,
        capConsumedPaise: consumed,
        sharedPrePaise: sharedPre,
        ...(c.belowMinimum !== undefined ? { belowMinimumPaise: c.belowMinimum } : {}),
      });
    }
    employees.push(row);
  }
  if (overLimit.length) return blocked(input, overLimit);
  return {
    engineVersion: ENGINE_VERSIONS[input.category],
    category: input.category,
    status: "computed",
    problems: [],
    month: input.month,
    asOf: input.asOf,
    configVersionId: input.configVersion!.id,
    configVersionNo: input.configVersion!.versionNo,
    employees,
    items: byKey(ctx.items, (i) => `${i.employeeId}|${i.lineCode}|${natural(i.label)}|${i.sourceId}`),
    held: byKey(ctx.held, (h) => `${h.documentNo}|${h.documentId}|${h.message}`),
    excluded: byKey(ctx.excluded, (h) => `${h.documentNo}|${h.documentId}|${h.employeeId}|${h.message}`),
    ...(input.category === "C" ? { reviewCases: byKey(ctx.reviewCases ?? [], (c) => `${c.caseKind}|${c.documentNo}|${c.documentId}`) } : {}),
    ...(carryModel ? { carryModel: true } : {}),
    settled: ctx.settled,
    settingsUsed: Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]])),
  };
}

/* ── the smallest amount paid in a month, and the carry-forward (0136) ── */

const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/**
 * One salesperson's month under a smallest amount paid (pure, whole paise): the month's TOTAL is its own amount after
 * every limit, plus the adjustments carried into the month, plus the balances carried forward that haven't expired.
 *   · total ≤ 0 — nothing is released; the balances are OFFSET against the recovery; a negative remainder is carried at
 *     lock as configured (Refunds and Adjustments), exactly as before.
 *   · total ≥ the smallest amount (or "No minimum") — everything is RELEASED once: the balances are consumed.
 *   · otherwise — nothing is released. "Carry forward": the month's own amount and adjustments are HELD as a new balance
 *     (a recovery is first offset against the oldest balances) and the earlier balances stay carried. "Not released":
 *     the same, but the new balance and the earlier ones are recorded as expired at once — never silently dropped.
 *   · a balance older than the configured expiry is EXPIRED (recorded), never counted.
 * Nothing is written here: the payout of the month writes the outcome to the ledger, once.
 */
function applyCarry(s: S, month: string, ownPaise: number, carry: CarryIn | undefined, limits: string[]): { released: number; carriedIn: number; net: number; belowMinimum?: number; outcome: CarryOutcome } {
  const minimum = s["payout.minimumPayable"];
  // The month's OWN rules: for its new balance (new earnings follow the settings of their own calculation) and for any
  // balance recorded before balances carried their rules (reproduced exactly as it was calculated).
  const notReleased = s["payout.belowMinimum"] === "notReleased";
  const expires = !notReleased && s["payout.carryForwardExpiry"] === "afterMonths";
  const expiryMonths = num(s, "payout.carryForwardExpiryMonths");
  // Each earlier balance keeps the rules it was HELD under, whatever this month's version says.
  const rulesOf = (lot: CarryLotIn) =>
    lot.rules
      ? { notReleased: lot.rules.belowMinimum === "notReleased", expires: lot.rules.belowMinimum !== "notReleased" && lot.rules.expiry === "afterMonths" && lot.rules.expiryMonths !== null, months: lot.rules.expiryMonths ?? 0, held: true }
      : { notReleased, expires, months: expiryMonths, held: false };
  const monthStart = `${month}-01`;
  const outcome: CarryOutcome = { lots: [], heldPaise: 0 };
  const live: { lotId: string; month: string; amountPaise: number; notReleased: boolean }[] = [];
  for (const lot of [...(carry?.lots ?? [])].filter((l) => l.remainingPaise > 0).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.id < b.id ? -1 : 1))) {
    const r = rulesOf(lot);
    if (r.expires && monthsBetween(lot.month, monthStart) >= r.months) {
      outcome.lots.push({ lotId: lot.id, month: lot.month, amountPaise: lot.remainingPaise, outcome: "expired" });
      limits.push(`Carried forward from ${lot.month.slice(0, 7)}: ${rupees(lot.remainingPaise)} expired — still unreleased after ${r.months} month${r.months === 1 ? "" : "s"}${r.held ? " (the rule it was held under)" : ""} (recorded).`);
      continue;
    }
    live.push({ lotId: lot.id, month: lot.month, amountPaise: lot.remainingPaise, notReleased: r.notReleased });
  }
  const adjustments = carry?.adjustmentsPaise ?? 0;
  const lotsTotal = live.reduce((a, l) => a + l.amountPaise, 0);
  const base = ownPaise + adjustments;
  const total = base + lotsTotal;
  const carriedIn = adjustments + lotsTotal;
  if (lotsTotal) limits.push(`Carried forward into ${month}: ${live.map((l) => `${rupees(l.amountPaise)} from ${l.month.slice(0, 7)}`).join(", ")}.`);
  if (adjustments) limits.push(`Adjustments carried into ${month}: ${rupees(adjustments)}.`);
  if (total <= 0) {
    for (const l of live) outcome.lots.push({ lotId: l.lotId, month: l.month, amountPaise: l.amountPaise, outcome: "offset" });
    if (live.length) limits.push(`The carried-forward balances (${rupees(lotsTotal)}) are offset against the recovery.`);
    return { released: 0, carriedIn, net: total, outcome };
  }
  if (minimum === "none" || typeof minimum !== "number" || total >= minimum) {
    for (const l of live) outcome.lots.push({ lotId: l.lotId, month: l.month, amountPaise: l.amountPaise, outcome: "released" });
    if (carriedIn) limits.push(`Released this month: ${rupees(total)} (this month's ${rupees(ownPaise)}${carriedIn ? ` and ${rupees(carriedIn)} carried in` : ""}).`);
    return { released: total, carriedIn, net: total, outcome };
  }
  // Below the smallest amount: nothing is released this month.
  let need = base < 0 ? -base : 0;
  for (const l of live) {
    const take = Math.min(need, l.amountPaise);
    if (take > 0) outcome.lots.push({ lotId: l.lotId, month: l.month, amountPaise: take, outcome: "offset" });
    need -= take;
    const left = l.amountPaise - take;
    // An earlier balance stays carried unless IT was held under "Not released" (this month's choice is its own).
    if (left > 0) outcome.lots.push({ lotId: l.lotId, month: l.month, amountPaise: left, outcome: l.notReleased ? "expired" : "carried" });
  }
  outcome.heldPaise = Math.max(0, base);
  if (notReleased) outcome.heldExpires = true;
  limits.push(
    notReleased
      ? `The month's total ${rupees(total)} is below the smallest amount paid in a month (${rupees(minimum)}): not released (recorded as expired).`
      : `The month's total ${rupees(total)} is below the smallest amount paid in a month (${rupees(minimum)}): nothing is released; it is carried forward until the smallest amount is reached.`,
  );
  return { released: 0, carriedIn, net: total, belowMinimum: total, outcome };
}

/* ── who may earn: a submitter (D, E, F) ─────────────────────────────── */

/** Whether the person who made a submission may earn for it this month (eligibility rows, people who left), or why not. */
function submitterOk(ctx: Ctx, employeeId: string, no: string, id: string): EmployeeIn | null {
  const e = ctx.people.employeeById.get(employeeId);
  const day = monthEnd(ctx.input.month);
  if (!e) {
    ctx.excluded.push({ documentId: id, documentNo: no, employeeId, message: "Its salesperson is no longer an employee." });
    return null;
  }
  // Covered by the eligibility rows on the month's first or last day (a submission carries its month, not a day).
  const atEnd = ctx.people.eligibleOn(e, day);
  if (atEnd && ctx.people.eligibleOn(e, ctx.input.month)) {
    ctx.excluded.push({ documentId: id, documentNo: no, employeeId, message: atEnd });
    return null;
  }
  const d = ctx.people.departed.get(e.id);
  if (d) {
    if (!d.lastDay) {
      ctx.excluded.push({ documentId: id, documentNo: no, employeeId, message: `${e.name} has left and no last working day is recorded (end their inclusion in Salesperson Eligibility).` });
      return null;
    }
    if (str(ctx.s, "eligibility.inactiveEmployees") === "excludeFromMonthLeft" ? ctx.month >= monthOf(d.lastDay) : ctx.input.month > d.lastDay) {
      ctx.excluded.push({ documentId: id, documentNo: no, employeeId, message: `${e.name} left (${d.lastDay}): nothing for ${ctx.month}.` });
      return null;
    }
  }
  return e;
}

const flat = (ctx: Ctx, employeeId: string, lineCode: string, sourceType: ItemResult["sourceType"], sourceId: string, label: string, amount: Q, explanation: string[]) => {
  const x = R.text(amount);
  ctx.items.push({ employeeId, lineCode, sourceType, sourceId, label, sharePpm: 1_000_000, baseExact: x, earnedExact: x, payableExact: x, multiplierPpm: null, status: "credited", explanation });
};

/* ── D · leads and enquiries ─────────────────────────────────────────── */

function ruleD(ctx: Ctx) {
  const s = ctx.s;
  const profiledOnly = str(s, "d.leadsMustBeProfiled") === "yes";
  const perMonth = str(s, "d.unitCounting") === "perMonth";
  const kinds = [
    { code: "D.1", type: "lead-batch" as const, what: "profiled leads", rows: (ctx.input.leadBatches ?? []).map((b) => ({ id: b.id, employeeId: b.employeeId, periodMonth: b.periodMonth, count: b.leadCount, ok: b.approved && (!profiledOnly || b.profiled), why: !b.approved ? "not approved" : "not marked as profiled" })), per: num(s, "d.leadsPerUnit"), amount: num(s, "d.leadUnitAmount") },
    { code: "D.2", type: "lead-conversion" as const, what: "leads turned into enquiries", rows: (ctx.input.leadConversions ?? []).map((c) => ({ id: c.id, employeeId: c.employeeId, periodMonth: c.periodMonth, count: c.convertedCount, ok: c.approved, why: "not approved" })), per: num(s, "d.conversionsPerUnit"), amount: num(s, "d.conversionUnitAmount") },
  ];
  for (const k of kinds) {
    const rows = byKey(k.rows.filter((r) => r.periodMonth === ctx.month), (r) => `${r.employeeId}|${r.id}`);
    const counted: Record<string, { rows: typeof rows; e: EmployeeIn }> = {};
    for (const r of rows) {
      const no = `${k.code} ${r.count}`;
      if (!r.ok) {
        ctx.excluded.push({ documentId: r.id, documentNo: no, employeeId: r.employeeId, message: `Left out: ${r.why}.` });
        continue;
      }
      const e = submitterOk(ctx, r.employeeId, no, r.id);
      if (!e) continue;
      if (perMonth) (counted[e.id] ??= { rows: [], e }).rows.push(r);
      else {
        const units = Math.floor(r.count / k.per);
        if (units <= 0) {
          ctx.excluded.push({ documentId: r.id, documentNo: no, employeeId: e.id, message: `${r.count} ${k.what}: fewer than ${k.per}, so no reward (each submission counts on its own).` });
          continue;
        }
        flat(ctx, e.id, k.code, k.type, r.id, `${r.count} ${k.what}`, R.q(units * k.amount), [`${units} × ${k.per} ${k.what} (${r.count}) × ${rupees(k.amount)} = ${rupees(units * k.amount)}.`]);
      }
    }
    for (const [eid, g] of Object.entries(counted)) {
      const total = g.rows.reduce((a, r) => a + r.count, 0);
      const units = Math.floor(total / k.per);
      if (units > 0) flat(ctx, eid, k.code, "month", `${k.code}|${eid}|${ctx.month}`, `${total} ${k.what} in ${ctx.month}`, R.q(units * k.amount), [`${units} × ${k.per} of the month's ${total} ${k.what} × ${rupees(k.amount)} = ${rupees(units * k.amount)}.`]);
    }
  }
}

/* ── E · high-value client meetings ──────────────────────────────────── */

function ruleE(ctx: Ctx) {
  const lo = num(ctx.s, "e.minAward");
  const hi = num(ctx.s, "e.maxAward");
  for (const m of byKey((ctx.input.meetings ?? []).filter((x) => x.periodMonth === ctx.month), (x) => `${x.employeeId}|${x.id}`)) {
    if (!m.approved) {
      ctx.excluded.push({ documentId: m.id, documentNo: m.label, employeeId: m.employeeId, message: "Left out: not approved." });
      continue;
    }
    if (m.awardedPaise === null) {
      ctx.excluded.push({ documentId: m.id, documentNo: m.label, employeeId: m.employeeId, message: "Left out: no award was set when it was approved." });
      continue;
    }
    // category-e/2: an award of ₹0 (or below) is never raised to the smallest award — before awards had to be entered,
    // an approval with a blank award was stored as ₹0, so ₹0 can't be told apart from "no award": nothing is paid.
    if (m.awardedPaise <= 0) {
      ctx.excluded.push({ documentId: m.id, documentNo: m.label, employeeId: m.employeeId, message: "Left out: approved with an award of ₹0 (or none) — it is never raised to the smallest award." });
      continue;
    }
    const e = submitterOk(ctx, m.employeeId, m.label, m.id);
    if (!e) continue;
    const amount = Math.max(lo, Math.min(hi, m.awardedPaise));
    flat(ctx, e.id, "E.1", "meeting", m.id, m.label, R.q(amount), [`Award ${rupees(m.awardedPaise)}${amount !== m.awardedPaise ? `, kept within ${rupees(lo)}–${rupees(hi)}: ${rupees(amount)}` : ""}.`]);
  }
}

/* ── F · reviews and testimonials ────────────────────────────────────── */

/**
 * F · Reviews and testimonials (category-f/3; 0137 + 0138) — the original scheme's four parts, every amount a setting:
 *   F.1 a Google review (f.googleReviewAmount), F.2 a testimonial on email (f.emailAmount), F.3 a testimonial on the
 *   customer's letterhead (f.letterheadAmount); F.4 appreciation — when the testimonial appreciates the credited
 *   salesperson or ANY team member categorically BY NAME, the applicable reward is multiplied (f.namedMultiple: 2 =
 *   double): the TOTAL is that multiple of the base, never a bonus on top of a doubled amount, never split.
 * Only VERIFIED, unique testimonials reach the engine (a screenshot or document alone never does), each in the month of
 * its ORIGINAL date (a Google review's publication, an email's or a letter's own date), never the month it was
 * submitted. Who is credited, in order: the one salesperson it clearly names; else the customer's assigned salesperson on
 * that date; else an authorised, confirmed claim (an attribution decision also settles one naming several). An
 * invalidated testimonial earns nothing; a Google review rated below the lowest rating, or with fewer words than
 * configured, earns nothing (email and letterhead have no rating; the word minimum is the Google review's); nobody
 * identified, or several named and not yet decided, is held for Admin Review. With a monthly minimum, a salesperson below
 * it earns no Category F that month. The category's monthly limit applies to the TOTAL, F.4 included.
 */
const F_KIND: Record<FReviewIn["kind"], { code: string; what: string; key: string }> = {
  google_review: { code: "F.1", what: "Google review", key: "f.googleReviewAmount" },
  email: { code: "F.2", what: "Email testimonial", key: "f.emailAmount" },
  letterhead: { code: "F.3", what: "Letterhead testimonial", key: "f.letterheadAmount" },
};
function ruleF(ctx: Ctx) {
  const s = ctx.s;
  const multiple = num(s, "f.namedMultiple");
  const minRating = num(s, "f.minRating");
  const minWords = num(s, "f.googleMinWords");
  const minCount = num(s, "f.minQualifyingReviews");
  const mine: { employeeId: string; review: FReviewIn; basis: string }[] = [];
  const labelOf = (r: FReviewIn) => `${F_KIND[r.kind].what} ${r.label}`;
  for (const r of byKey((ctx.input.fReviews ?? []).filter((x) => monthOf(x.publishedOn) === ctx.month), (x) => `${x.publishedOn}|${x.reviewId}`)) {
    const label = labelOf(r);
    const left = (message: string, employeeId: string | null = null) => ctx.excluded.push({ documentId: r.reviewId, documentNo: label, employeeId, message: `Left out: ${message}.` });
    if (r.invalidated) {
      left("invalidated (deleted or invalid; approved by a second person)");
      continue;
    }
    if (r.kind === "google_review") {
      if (r.rating === null || r.rating < minRating) {
        left(`${r.rating ?? "no"}★, below the lowest rating that earns (${minRating}★)`);
        continue;
      }
      if (r.wordCount < minWords) {
        left(`${r.wordCount} words, fewer than ${minWords}`);
        continue;
      }
    }
    let credited: string | null = null;
    let basis = "";
    if (r.attribution) {
      credited = r.attribution.employeeId;
      basis = r.attribution.basis;
      if (!credited) {
        left("its credited salesperson is no longer an employee");
        continue;
      }
    } else if (r.namedEmployeeIds.length === 1) {
      credited = r.namedEmployeeIds[0]!;
      basis = "named";
    } else if (r.namedEmployeeIds.length > 1) {
      ctx.settled = false;
      ctx.held.push({ documentId: r.reviewId, documentNo: label, employeeId: null, message: `${label} names ${r.namedEmployeeIds.length} salespeople: held for Admin Review (an authorised person attributes it to one of them; it is never split).` });
      continue;
    } else if (r.assignedEmployeeId) {
      credited = r.assignedEmployeeId;
      basis = "assigned";
    } else {
      ctx.settled = false;
      ctx.held.push({ documentId: r.reviewId, documentNo: label, employeeId: null, message: `${label} names nobody and its customer has no assigned salesperson: held for Admin Review (an authorised, confirmed claim).` });
      continue;
    }
    mine.push({ employeeId: credited, review: r, basis });
  }
  const counts = new Map<string, number>();
  for (const m of mine) counts.set(m.employeeId, (counts.get(m.employeeId) ?? 0) + 1);
  for (const m of mine) {
    const r = m.review;
    const label = labelOf(r);
    const n = counts.get(m.employeeId)!;
    if (minCount > 0 && n < minCount) {
      ctx.excluded.push({ documentId: r.reviewId, documentNo: label, employeeId: m.employeeId, message: `Left out: ${n} qualifying testimonial${n === 1 ? "" : "s"} this month, fewer than the ${minCount} needed — no Category F for the month.` });
      continue;
    }
    const e = submitterOk(ctx, m.employeeId, label, r.reviewId);
    if (!e) continue;
    const kind = F_KIND[r.kind];
    const base = num(s, kind.key);
    // F.4: appreciation of the credited salesperson or any team member, categorically by name (recorded by the verifier).
    const appreciated = r.appreciatedEmployeeIds.length > 0;
    const amount = R.q(appreciated ? base * multiple : base);
    const how = m.basis === "named" ? "named in it" : m.basis === "assigned" ? "the customer's assigned salesperson" : "an authorised, confirmed claim";
    const facts = r.kind === "google_review" ? `${r.rating}★, published ${r.publishedOn}` : `dated ${r.publishedOn}`;
    flat(ctx, e.id, kind.code, "testimonial", r.reviewId, label, amount, [
      `${label} (${facts}), credited to ${e.name} — ${how}: ${kind.code} ${rupees(base)}${appreciated ? `; F.4 — it appreciates ${r.appreciatedEmployeeIds.length === 1 ? "a person" : `${r.appreciatedEmployeeIds.length} people`} by name: × ${multiple} = ${rupees(base * multiple)}` : ""}.`,
    ]);
  }
}

/* ── C and G: customers from Forms' Sales Orders ─────────────────────── */

function customerOrders(ctx: Ctx) {
  const asOf = ctx.input.asOf;
  const leftFlags = new Set([...list(ctx.s, "basis.voucherFilter"), "cancelled"]);
  const eligible = (o: OrderBIn) => !(["cancelled", "optional", "postDated"] as const).some((k) => o.states[k] && leftFlags.has(k));
  const orders = byKey((ctx.input.orders ?? []).filter((o) => o.date <= asOf && eligible(o) && o.customerId), docKey);
  const byCustomer = new Map<string, OrderBIn[]>();
  for (const o of orders) byCustomer.set(o.customerId!, [...(byCustomer.get(o.customerId!) ?? []), o]);
  return byCustomer;
}
const amountOf = (o: OrderBIn, basis: string): number | null => (basis === "total" ? o.totalPaise : o.taxablePaise);

/** Credits an amount for a customer to its salesperson(s), as the attribution settings say. */
function creditCustomer(ctx: Ctx, lineCode: string, unit: { id: string; no: string; customerId: string; repDay: string; day: string }, label: string, base: Q, earned: Q, payable: Q, multiplierPpm: number | null, status: ItemResult["status"], explanation: string[]) {
  const shares = ctx.people.resolve(unit, true, ctx.month, ctx.excluded);
  if (!shares) return;
  for (const sh of shares) {
    const f = R.ppm(sh.sharePpm);
    ctx.items.push({ employeeId: sh.employee.id, lineCode, sourceType: "customer", sourceId: unit.customerId, label, sharePpm: sh.sharePpm, baseExact: R.text(R.mul(base, f)), earnedExact: R.text(R.mul(earned, f)), payableExact: R.text(R.mul(payable, f)), multiplierPpm, status, explanation: sh.sharePpm === 1_000_000 ? explanation : [...explanation, `${sh.employee.name}'s share: ${sh.sharePpm / 10_000}%.`] });
  }
}

/* ── C · new customer acquisition ────────────────────────────────────── */

/**
 * The last day of a window of `months` months from `start`, INCLUSIVE and clamp-safe: 12 months from 10 Feb 2026 end on
 * 9 Feb 2027; when the same day doesn't exist in the end month, that month's last day is the end and is included
 * (29 Feb 2028 + 12 months → 28 Feb 2029; 31 Jan + 1 month → 28 Feb).
 */
export function windowEndInclusive(start: string, months: number): string {
  const same = monthsBefore(start, -months);
  return Number(same.slice(8, 10)) < Number(start.slice(8, 10)) ? same : addDays(same, -1);
}

/**
 * Category C (category-c/4: c/3 + released carried balances use the shared limit), as the confirmed decisions say —
 * every value a setting of the published version:
 *   · A Sales Order is ONE transaction however many invoices it has. Cancelled orders (and the configured "Orders left
 *     out") never count; a fully returned / fully credited order (net ≤ 0) is never a transaction.
 *   · NET amounts: each order counts its invoiced value ("Net turnover counts": invoiced) or its order value (ordered),
 *     LESS the credit notes and sales returns against its invoices — the same taxable/total basis throughout, each credit
 *     note once (by its id; a sales return is a credit note marked as such, never a second deduction).
 *   · ROLLING look-back, INCLUSIVE: a customer is new at an order when no other eligible order — invoiced or not yet —
 *     is dated within the look-back months before it (the same calendar day that many months earlier, or the month's
 *     last day when that day doesn't exist, is within). The acquisition starts at the FIRST QUALIFYING order (invoiced,
 *     net above ₹0) that is new; its window runs for "Turnover window" months, the end clamp-safe and inclusive. When
 *     that order is later cancelled or fully returned, the next qualifying one becomes the start (every calculation
 *     decides it again). Acquisitions never overlap: an order inside one acquisition's window never starts another.
 *   · Earned on the first N qualifying orders of the window, in the month of the order that completes them, at the
 *     rate on their net amount; capped per customer, PER SALESPERSON, before collection; payable only once every invoice
 *     of those orders is fully collected (net), each receipt at its own delay step (Category A's rule, shared).
 *   · Anything unmatched is HELD for an admin's review and never counted automatically — a Sales Order, invoice, credit
 *     note or receipt without a customer (proposed for review when its Tally party matches a customer: NEVER linked by
 *     that alone), an invoice without a Sales Order, a credit note without an invoice, an invoice or credit note or
 *     receipt whose customer conflicts with what it references, a sales return not on a credit note, a customer nobody
 *     can be credited for. Every acquisition whose look-back or window holds such a record is held too, until an
 *     admin's decision (0136) links the record or excludes it, with a reason.
 */
function ruleC(ctx: Ctx) {
  const { input, s } = ctx;
  const asOf = input.asOf;
  const lookback = num(s, "c.newCustomerLookbackMonths");
  const windowMonths = num(s, "c.turnoverWindowMonths");
  const needed = num(s, "c.requiredTransactions");
  const minTurnover = num(s, "c.minTurnover");
  const rate = num(s, "c.ratePpm");
  const basis = str(s, "c.amountBasis");
  const invoiced = str(s, "c.turnoverBasis") === "invoiced";
  const perCustomer = cap(s, "caps.perOrder");
  const steps = ctx.cfg.delaySteps;
  const boundary = str(s, "collection.stepBoundary");
  const missingDue = str(s, "collection.missingDueDate");
  const earning = str(s, "collection.earningBasis");
  const amountOf = (d: { totalPaise: number; taxablePaise: number | null }): number | null => (basis === "total" ? d.totalPaise : d.taxablePaise);
  const word = basis === "total" ? "total" : "taxable";
  const cases: CReviewCase[] = [];
  const caseKeys = new Set<string>();
  /** Unresolved records per customer they may belong to: an acquisition whose dates cover one is held. */
  const pending = new Map<string, { date: string; no: string }[]>();
  const pend = (cids: readonly (string | null | undefined)[], doc: { date: string; no: string }) => {
    for (const cid of new Set(cids)) if (cid) pending.set(cid, [...(pending.get(cid) ?? []), { date: doc.date, no: doc.no }]);
  };
  const review = (caseKind: CReviewKind, doc: { id: string; no: string; date: string }, customers: readonly (string | null | undefined)[], message: string) => {
    pend(customers, doc);
    if (caseKeys.has(`${caseKind}|${doc.id}`)) return;
    caseKeys.add(`${caseKind}|${doc.id}`);
    cases.push({ caseKind, documentId: doc.id, documentNo: doc.no, customerId: customers.find((c) => !!c) ?? null, message });
    ctx.held.push({ documentId: doc.id, documentNo: doc.no, employeeId: null, message });
  };
  const decisions = new Map((input.cReviews ?? []).map((r) => [`${r.caseKind}|${r.documentId}`, r]));
  const decided = (kind: CReviewKind, id: string) => decisions.get(`${kind}|${id}`);
  const byReview = (doc: { id: string; no: string; date: string }, what: string) => {
    if (monthOf(doc.date) === ctx.month) ctx.excluded.push({ documentId: doc.id, documentNo: doc.no, employeeId: null, message: `${what} is excluded by an admin's review decision.` });
  };
  // Tally party keys PROPOSE whose an unlinked record may be — for review only, never to link.
  const byParty = new Map<string, string[]>();
  for (const [cid, keys] of Object.entries(input.customerPartyKeys ?? {})) for (const k of keys) byParty.set(k, [...(byParty.get(k) ?? []), cid]);
  const proposed = (id: string, key?: string | null) => byParty.get(key ?? input.partyKeys?.[id] ?? "") ?? [];
  const nameOf = (cid: string) => (input.customers ?? []).find((c) => c.id === cid)?.name ?? "the customer";
  const hint = (cids: readonly string[]) => (cids.length ? ` Its Tally party matches ${cids.map(nameOf).join(", ")}.` : "");
  // Every document once (by its id), dated on or before the calculation date, in date order.
  const uniq = <T extends { id: string; no: string; date: string }>(xs: readonly T[] | undefined) => byKey([...new Map((xs ?? []).filter((x) => x.date <= asOf).map((x) => [x.id, x])).values()], docKey);
  const customers = new Map((input.customers ?? []).map((c) => [c.id, c]));

  // 1. Sales Orders, each with its customer (or held for review).
  const leftFlags = new Set([...list(s, "basis.voucherFilter"), "cancelled"]);
  const orders: (OrderBIn & { customerId: string })[] = [];
  /** Sales Orders in Forms that are left out (cancelled, by a voucher filter, or excluded by review) or held for review. */
  const leftOutOrders = new Set<string>();
  const heldOrders = new Map<string, readonly string[]>();
  for (const o of uniq(input.orders)) {
    const out = (["cancelled", "optional", "postDated"] as const).filter((k) => o.states[k] && leftFlags.has(k));
    if (out.length) {
      leftOutOrders.add(o.id);
      if (monthOf(o.date) === ctx.month) ctx.excluded.push({ documentId: o.id, documentNo: o.no, employeeId: null, message: `Left out: the order is ${out.join(", ")} (Orders left out).` });
      continue;
    }
    let cid = o.customerId;
    if (!cid) {
      const d = decided("order-customer", o.id);
      if (d?.decision === "exclude") {
        leftOutOrders.add(o.id);
        byReview(o, `Sales Order ${o.no}`);
        continue;
      }
      if (d?.decision === "link" && d.targetId) cid = d.targetId;
      else {
        const cands = proposed(o.id, o.partyKey);
        heldOrders.set(o.id, cands);
        review("order-customer", o, cands, `Sales Order ${o.no} (${o.date}) isn't linked to a Customer Master record: held for review (link it to its customer, or exclude it).${hint(cands)}`);
        continue;
      }
    }
    orders.push({ ...o, customerId: cid });
  }
  const orderById = new Map(orders.map((o) => [o.id, o]));

  // 2. Invoices, each with its Sales Order (or held: no order, no customer, or a customer that conflicts).
  const invoices = uniq(input.invoices);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const invoiceOrder = new Map<string, string>();
  for (const inv of invoices) {
    const d = decided("invoice-order", inv.id);
    if (d?.decision === "exclude") {
      byReview(inv, `Invoice ${inv.no}`);
      continue;
    }
    let oid = d?.decision === "link" && d.targetId ? d.targetId : inv.orderId;
    if (!d) {
      const order = oid ? orderById.get(oid) : undefined;
      if (!oid) {
        const cands = inv.customerId ? [inv.customerId] : proposed(inv.id);
        review("invoice-order", inv, cands, `Invoice ${inv.no} (${inv.date}) names no Sales Order${inv.customerId ? "" : " and no customer"}: held for review (link it to its Sales Order, or exclude it).${inv.customerId ? "" : hint(cands)}`);
        continue;
      }
      // A Sales Order Forms doesn't have (never a cancelled or left-out one): held — the invoice can't be placed.
      if (!order && !leftOutOrders.has(oid) && !heldOrders.has(oid)) {
        const cands = inv.customerId ? [inv.customerId] : proposed(inv.id);
        review("invoice-order", inv, cands, `Invoice ${inv.no} (${inv.date}) names a Sales Order that isn't in Forms: held for review (link it to its Sales Order, or exclude it).${inv.customerId ? "" : hint(cands)}`);
        continue;
      }
      // Its Sales Order is itself held for review: the invoice waits with it.
      if (!order && heldOrders.has(oid)) pend([inv.customerId, ...heldOrders.get(oid)!], inv);
      if (order && inv.customerId && inv.customerId !== order.customerId) {
        review("invoice-order", inv, [inv.customerId, order.customerId], `Invoice ${inv.no} is for ${nameOf(inv.customerId)} but names ${nameOf(order.customerId)}'s Sales Order ${order.no}: held for review (link it to the right Sales Order, or exclude it).`);
        continue;
      }
    }
    if (oid) invoiceOrder.set(inv.id, oid);
  }
  /** An invoice's customer: its Sales Order's. */
  const customerOfInvoice = (id: string) => {
    const oid = invoiceOrder.get(id);
    return oid ? (orderById.get(oid)?.customerId ?? invoiceById.get(id)?.customerId ?? null) : null;
  };

  // 3. Credit notes and sales returns, each with its invoice (or held), each deducted ONCE.
  const creditNotes = uniq(input.creditNotes);
  const cnIds = new Set(creditNotes.map((c) => c.id));
  const docOf = (id: string): { id: string; no: string; date: string; customerId: string | null } | undefined => orderById.get(id) ?? invoiceById.get(id) ?? (input.receipts ?? []).find((r) => r.id === id) ?? creditNotes.find((c) => c.id === id);
  const returnIds = new Set<string>();
  for (const e of (input.events ?? []).filter((x) => x.kind === "salesReturn" && x.date <= asOf)) {
    if (cnIds.has(e.documentId)) {
      returnIds.add(e.documentId);
      continue;
    }
    const d = decided("return-credit-note", e.documentId);
    if (d?.decision === "exclude") continue;
    if (d?.decision === "link" && d.targetId && cnIds.has(d.targetId)) {
      returnIds.add(d.targetId);
      continue;
    }
    const doc = docOf(e.documentId) ?? { id: e.documentId, no: e.documentId.slice(0, 8), date: e.date, customerId: null };
    review("return-credit-note", doc, [doc.customerId, invoiceOrder.has(doc.id) ? customerOfInvoice(doc.id) : null], `A sales return is recorded on ${doc.no}, which isn't a credit note: held for review (link it to its credit note, or exclude it).`);
  }
  const cnWord = (id: string) => (returnIds.has(id) ? "Sales return" : "Credit note");
  /** What each invoice still asks the customer to pay (its total less its credit notes) — the collection's measure. */
  const invoiceDue = new Map(invoices.map((i) => [i.id, R.q(i.totalPaise)]));
  const deductions = new Map<string, { id: string; no: string; amount: number | null; isReturn: boolean }[]>();
  for (const cn of creditNotes) {
    const d = decided("credit-note-invoice", cn.id);
    if (d?.decision === "exclude") {
      byReview(cn, `${cnWord(cn.id)} ${cn.no}`);
      continue;
    }
    let iid = d?.decision === "link" && d.targetId && invoiceById.has(d.targetId) ? d.targetId : cn.invoiceId && invoiceById.has(cn.invoiceId) ? cn.invoiceId : null;
    if (!d) {
      if (!iid) {
        const cands = cn.customerId ? [cn.customerId] : proposed(cn.id);
        review("credit-note-invoice", cn, cands, `${cnWord(cn.id)} ${cn.no} (${cn.date}) ${cn.invoiceId ? "names an invoice that isn't in Forms" : "names no invoice"}${cn.customerId ? "" : " and no customer"}: held for review (link it to its invoice, or exclude it).${cn.customerId ? "" : hint(cands)}`);
        continue;
      }
      const invCustomer = customerOfInvoice(iid) ?? invoiceById.get(iid)?.customerId ?? null;
      if (cn.customerId && invCustomer && cn.customerId !== invCustomer) {
        review("credit-note-invoice", cn, [cn.customerId, invCustomer], `${cnWord(cn.id)} ${cn.no} is for ${nameOf(cn.customerId)} but names ${nameOf(invCustomer)}'s invoice ${invoiceById.get(iid)!.no}: held for review (link it to the right invoice, or exclude it).`);
        continue;
      }
    }
    if (!iid) continue;
    invoiceDue.set(iid, R.max(R.ZERO, R.sub(invoiceDue.get(iid)!, R.q(cn.totalPaise))));
    const oid = invoiceOrder.get(iid);
    if (oid) deductions.set(oid, [...(deductions.get(oid) ?? []), { id: cn.id, no: cn.no, amount: amountOf(cn), isReturn: returnIds.has(cn.id) }]);
  }

  // 4. Receipts: a receipt without a customer and invoice, or whose customer conflicts with its invoice's, is held;
  //    a customer's receipt naming no invoice keeps the configured on-account handling.
  const receipts: ReceiptIn[] = [];
  for (const r of uniq(input.receipts)) {
    const d = decided("receipt-customer", r.id);
    if (d?.decision === "exclude") {
      byReview(r, `Receipt ${r.no}`);
      continue;
    }
    if (d?.decision === "link" && d.targetId) {
      const invCustomer = r.invoiceId ? customerOfInvoice(r.invoiceId) : null;
      receipts.push({ ...r, customerId: d.targetId, invoiceId: invCustomer && invCustomer !== d.targetId ? null : r.invoiceId });
      continue;
    }
    // A receipt on an invoice that is itself held waits with it (no case of its own).
    if (r.invoiceId && invoiceById.has(r.invoiceId) && !invoiceOrder.has(r.invoiceId)) {
      pend([r.customerId, invoiceById.get(r.invoiceId)!.customerId], r);
      continue;
    }
    const invCustomer = r.invoiceId && invoiceById.has(r.invoiceId) ? customerOfInvoice(r.invoiceId) : null;
    if (!r.customerId && !r.invoiceId) {
      const cands = proposed(r.id);
      review("receipt-customer", r, cands, `Receipt ${r.no} (${r.date}) names no customer and no invoice: held for review (link it to its customer, or exclude it).${hint(cands)}`);
      continue;
    }
    if (r.customerId && invCustomer && r.customerId !== invCustomer) {
      review("receipt-customer", r, [r.customerId, invCustomer], `Receipt ${r.no} is from ${nameOf(r.customerId)} but names ${nameOf(invCustomer)}'s invoice: held for review (link it to its customer, or exclude it).`);
      continue;
    }
    if (r.invoiceId && !invoiceById.has(r.invoiceId)) pend([r.customerId], r);
    receipts.push(r.customerId ? r : { ...r, customerId: invCustomer });
  }

  // 5. Each order's net amount.
  interface NetOrder { o: OrderBIn & { customerId: string }; invoiceIds: string[]; net: number; fullyReturned: boolean; missing: boolean; why: string }
  const nets = new Map<string, NetOrder>();
  for (const o of orders) {
    const invs = invoices.filter((i) => invoiceOrder.get(i.id) === o.id);
    const dd = deductions.get(o.id) ?? [];
    const ordered = amountOf(o);
    const invAmounts = invs.map((i) => amountOf(i));
    const missing = (!invoiced && ordered === null) || invAmounts.some((x) => x === null) || dd.some((x) => x.amount === null);
    const gross = invoiced ? invAmounts.reduce<number>((a, x) => a + (x ?? 0), 0) : (ordered ?? 0);
    const deducted = dd.reduce<number>((a, x) => a + (x.amount ?? 0), 0);
    const net = gross - deducted;
    const fullyReturned = deducted > 0 && net <= 0;
    const why = `${o.no} (${o.date}): ${invoiced ? (invs.length ? `invoiced ${rupees(gross)}` : "not invoiced yet") : `ordered ${rupees(gross)}`}${dd.length ? `, less ${dd.map((x) => `${x.isReturn ? "sales return" : "credit note"} ${x.no} ${x.amount === null ? "(no amount)" : rupees(x.amount)}`).join(", ")}` : ""} = net ${rupees(Math.max(0, net))} (${word}).`;
    nets.set(o.id, { o, invoiceIds: invs.map((i) => i.id), net, fullyReturned, missing, why });
  }

  // 6. Receipts applied to every invoice involved, in date order (the shared rules), once.
  const { applied } = applyReceipts({ settings: s, receipts, events: byKey((input.events ?? []).filter((e) => e.date <= asOf), (e) => `${e.date}|${e.id}`), invoices: invoices.filter((i) => invoiceOrder.has(i.id)), invoiceById, invoiceDue: new Map(invoiceDue), unitIdOfInvoice: (id) => invoiceOrder.get(id) ?? null, held: ctx.held });
  const referenceDate = makeReferenceDate(s, (id) => orderById.get(id), (id) => customers.get(id));
  const refOfInvoice = (id: string) => referenceDate(invoiceById.get(id)!);

  // 7. Each customer with an order this month: its acquisitions.
  const byCustomer = new Map<string, (OrderBIn & { customerId: string })[]>();
  for (const o of orders) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
  for (const [cid, list0] of byCustomer) {
    const mine = byKey(list0, docKey);
    if (!mine.some((o) => monthOf(o.date) === ctx.month)) continue;
    const name = customers.get(cid)?.name ?? "The customer";
    for (const o of mine) if (monthOf(o.date) === ctx.month && nets.get(o.id)!.fullyReturned) ctx.excluded.push({ documentId: o.id, documentNo: o.no, employeeId: null, message: `Sales Order ${o.no} is fully returned or credited (net ₹0): not a transaction.` });
    const eligible = mine.filter((o) => !nets.get(o.id)!.fullyReturned);
    const qualifies = (o: OrderBIn) => {
      const n = nets.get(o.id)!;
      return !n.missing && n.net > 0;
    };
    // New at a qualifying order: no other eligible order (invoiced or not) within the look-back before it.
    const isNew = (x: OrderBIn) => !eligible.some((e) => e.id !== x.id && docKey(e) < docKey(x) && e.date >= monthsBefore(x.date, lookback));
    // Acquisitions in date order; an order inside an earlier acquisition's window never starts another.
    const acquisitions: { anchor: OrderBIn & { customerId: string }; end: string }[] = [];
    for (const o of eligible) {
      if (!qualifies(o) || !isNew(o)) continue;
      const prev = acquisitions.at(-1);
      if (prev && o.date <= prev.end) continue;
      acquisitions.push({ anchor: o, end: windowEndInclusive(o.date, windowMonths) });
    }
    // A month's order outside every acquisition's window: the customer isn't new (said once).
    const firstInMonth = eligible.find((o) => monthOf(o.date) === ctx.month);
    if (firstInMonth && !acquisitions.some((a) => docKey(a.anchor) <= docKey(firstInMonth) && firstInMonth.date <= a.end)) {
      // The earliest earlier order within the look-back: the one that makes the customer an existing one.
      const earlier = eligible.find((e) => docKey(e) < docKey(firstInMonth) && e.date >= monthsBefore(firstInMonth.date, lookback));
      const a = acquisitions.filter((x) => docKey(x.anchor) <= docKey(firstInMonth)).at(-1);
      ctx.excluded.push({ documentId: firstInMonth.id, documentNo: firstInMonth.no, employeeId: null, message: earlier ? `Not a new customer: ${name} has earlier order ${earlier.no} (${earlier.date}) within ${lookback} months.` : a ? `Not a new customer: ${name}'s acquisition began with ${a.anchor.no} (${a.anchor.date}) and its window ended on ${a.end}.` : `${name}: no qualifying first order yet (an order must be invoiced, net above ₹0).` });
    }
    for (const { anchor, end } of acquisitions) {
      const inWindow = eligible.filter((o) => docKey(o) >= docKey(anchor) && o.date <= end);
      const firstN = inWindow.filter(qualifies).slice(0, needed);
      if (firstN.length < needed) continue;
      const nth = firstN[needed - 1]!;
      if (monthOf(nth.date) !== ctx.month) continue;
      // Fail-closed: Forms' references for this customer couldn't all be followed — held, never credited.
      const inc = input.incompleteReferences;
      if (inc?.documentIds.length && (!inc.customerIds.length || inc.customerIds.includes(cid))) {
        ctx.settled = false;
        ctx.held.push({ documentId: nth.id, documentNo: nth.no, employeeId: null, message: `New customer ${name}: held — Forms' linked records (${inc.documentIds.length} not followed) go further than the calculation follows, so its turnover and collection can't be complete. Nothing is credited until they are (resolve the chain, or raise the limit).` });
        continue;
      }
      // Held while an unresolved record could belong to this acquisition's look-back or window.
      const from = monthsBefore(anchor.date, lookback);
      const open = (pending.get(cid) ?? []).filter((p) => p.date >= from && p.date <= end);
      if (open.length) {
        ctx.settled = false;
        ctx.held.push({ documentId: nth.id, documentNo: nth.no, employeeId: null, message: `New customer ${name}: held for review — ${open.map((p) => `${p.no} (${p.date})`).join(", ")} isn't resolved yet (Review & decisions).` });
        continue;
      }
      const missing = inWindow.find((o) => nets.get(o.id)!.missing);
      if (missing) {
        ctx.held.push({ documentId: missing.id, documentNo: missing.no, employeeId: null, message: `${name}: an order, invoice or credit note in the turnover window has no ${word} value — held for review.` });
        continue;
      }
      const why: string[] = [`New customer ${name}: no other order within ${lookback} months before ${anchor.no} (${anchor.date}), its first qualifying order; turnover window ${anchor.date} – ${end} (inclusive).`];
      const turnover = inWindow.reduce((a, o) => a + Math.max(0, nets.get(o.id)!.net), 0);
      for (const o of inWindow) why.push(nets.get(o.id)!.why);
      if (turnover < minTurnover) {
        const stillOpen = asOf < end;
        if (stillOpen) ctx.settled = false;
        ctx.excluded.push({ documentId: nth.id, documentNo: nth.no, employeeId: null, message: `${name}: net turnover ${rupees(turnover)} in the window is below ${rupees(minTurnover)}${stillOpen ? ` so far (the window is open until ${end}; the month is recalculated as it changes)` : ""}.` });
        continue;
      }
      const netN = firstN.map((o) => R.q(nets.get(o.id)!.net));
      const netTotal = R.sum(netN);
      const base = R.mul(netTotal, R.ppm(rate));
      why.push(`First ${needed} transactions (${firstN.map((o) => o.no).join(", ")}): net ${rupees(R.round(netTotal, "halfUp", "paise"))}; net turnover ${rupees(turnover)} (at least ${rupees(minTurnover)}). ${pct(rate)} = ${rupees(R.round(base, "halfUp", "paise"))}.`);
      // Whose acquisition: the first transaction's salesperson(s), as the attribution settings say.
      const unit = { id: firstN[0]!.id, no: firstN[0]!.no, customerId: cid, repDay: firstN[0]!.date, day: nth.date };
      const att = ctx.people.sharesOf(unit);
      if ("why" in att) {
        review("customer-salesperson", { id: unit.id, no: unit.no, date: unit.repDay }, [cid], `New customer ${name}: nobody can be credited — ${att.why} Record the salesperson in the Incentive Calculation inputs (Order salespeople or Representatives), then recalculate.`);
        continue;
      }
      const shares = ctx.people.resolve(unit, true, ctx.month, ctx.excluded);
      if (!shares?.length) continue;
      // Collection: each transaction's invoices, net; payable only once ALL are fully collected.
      const coll = firstN.map((o) => {
        const ids = nets.get(o.id)!.invoiceIds;
        const collectible = R.sum(ids.map((i) => invoiceDue.get(i)!));
        return { o, ...collectUnit({ applied, invoiceIds: new Set(ids), collectible, referenceDate: refOfInvoice, invoiceNo: (i) => invoiceById.get(i)?.no ?? i, steps, boundary, missingDue, earning, held: ctx.held }), collectible };
      });
      const fully = coll.every((c) => c.full);
      // The earning factor of the whole acquisition: each transaction's factor weighted by its net amount.
      const factor = R.isZero(netTotal) ? R.ZERO : R.div(R.sum(coll.map((c, i) => R.mul(netN[i]!, c.factor))), netTotal);
      for (const c of coll) {
        const credited = c.parts.filter((p) => p.status !== "over-collected");
        why.push(`${c.o.no}: ${c.full ? "fully collected" : `collected ${rupees(R.round(c.collected, "halfUp", "paise"))} of ${rupees(R.round(c.collectible, "halfUp", "paise"))}`}${credited.length ? ` — ${credited.map((p) => `${p.receiptNo} ${rupees(R.round(p.amount, "halfUp", "paise"))}: ${p.note}`).join(" ")}` : ""}`);
      }
      if (!fully) {
        ctx.settled = false;
        why.push("Payable once every invoice of these transactions is fully collected (net of credit notes and returns).");
      }
      for (const sh of shares) {
        let shareBase = R.mul(base, R.ppm(sh.sharePpm));
        const mineWhy = [...why];
        if (sh.sharePpm !== 1_000_000) mineWhy.push(`${sh.employee.name}'s share: ${sh.sharePpm / 10_000}%.`);
        if (perCustomer !== null && R.cmp(shareBase, R.q(perCustomer)) > 0) {
          shareBase = R.q(perCustomer);
          mineWhy.push(`Limited to ${rupees(perCustomer)} (most one new customer can earn, per salesperson), before collection.`);
        }
        const earned = fully ? R.mul(shareBase, factor) : R.ZERO;
        if (fully) mineWhy.push(`Each receipt at its own delay step: ${rupees(R.round(earned, "halfUp", "paise"))}.`);
        ctx.items.push({ employeeId: sh.employee.id, lineCode: "C.1", sourceType: "customer", sourceId: cid, label: name, sharePpm: sh.sharePpm, baseExact: R.text(shareBase), earnedExact: R.text(earned), payableExact: R.text(earned), multiplierPpm: fully ? Number((factor.n * 1_000_000n) / factor.d) : null, status: fully ? "credited" : "pending", explanation: mineWhy });
      }
    }
  }
  ctx.reviewCases = cases;
}

/* ── G · consecutive monthly purchases (PROPOSED structure) ──────────── */

function ruleG(ctx: Ctx) {
  const s = ctx.s;
  const n = num(s, "g.consecutiveMonths");
  const min = num(s, "g.minMonthlyPurchase");
  const basis = str(s, "g.purchaseBasis");
  const reward = num(s, "g.rewardAmount");
  const restart = str(s, "g.afterReward") === "restart";
  const perCustomer = cap(s, "caps.perOrder");
  const customers = new Map((ctx.input.customers ?? []).map((c) => [c.id, c]));
  const prevMonth = (mm: string) => monthsBefore(`${mm}-01`, 1).slice(0, 7);
  // category-g/2: nothing of the month is left out silently. An order with no Customer Master link can't be followed
  // into its customer's consecutive months, and an order whose amount (on the configured basis) isn't known counts as
  // nothing towards its month — each is listed with the reason.
  const leftFlags = new Set([...list(s, "basis.voucherFilter"), "cancelled"]);
  for (const o of byKey((ctx.input.orders ?? []).filter((x) => monthOf(x.date) === ctx.month && x.date <= ctx.input.asOf && !(["cancelled", "optional", "postDated"] as const).some((k) => x.states[k] && leftFlags.has(k))), docKey)) {
    if (!o.customerId) ctx.excluded.push({ documentId: o.id, documentNo: o.no, employeeId: null, message: "Left out: it has no Customer Master link, so its customer's consecutive months can't be counted." });
    else if (amountOf(o, basis) === null) ctx.excluded.push({ documentId: o.id, documentNo: o.no, employeeId: null, message: `Counted as nothing towards ${ctx.month}: its ${basis === "total" ? "total" : "taxable"} amount isn't known.` });
  }
  for (const [cid, orders] of customerOrders(ctx)) {
    const inMonth = orders.filter((o) => monthOf(o.date) === ctx.month);
    if (!inMonth.length) continue;
    const byMonth = new Map<string, number>();
    for (const o of orders) byMonth.set(monthOf(o.date), (byMonth.get(monthOf(o.date)) ?? 0) + (amountOf(o, basis) ?? 0));
    let run = 0;
    for (let mm = ctx.month; (byMonth.get(mm) ?? 0) >= min && run < 240; mm = prevMonth(mm)) run++;
    const earns = run >= n && (restart ? run % n === 0 : true);
    if (!earns) continue;
    let amount = R.q(reward);
    const why = [`${customers.get(cid)?.name ?? cid} bought at least ${rupees(min)} in each of ${run} consecutive months up to ${ctx.month} (${n} needed${restart ? "; the count starts again after each reward" : "; every further month earns"}).`];
    if (perCustomer !== null && R.cmp(amount, R.q(perCustomer)) > 0) {
      amount = R.q(perCustomer);
      why.push(`Limited to ${rupees(perCustomer)}.`);
    }
    const last = inMonth[inMonth.length - 1]!;
    creditCustomer(ctx, "G.1", { id: last.id, no: last.no, customerId: cid, repDay: last.date, day: last.date }, customers.get(cid)?.name ?? cid, amount, amount, amount, null, "credited", why);
  }
}
