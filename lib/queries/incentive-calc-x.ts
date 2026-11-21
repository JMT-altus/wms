import "server-only";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { db as Db0 } from "@/lib/db";
import { clientMeetings, customerMasters, employees, incentiveCalcAdjustments, incentiveCalcAttributions, incentiveCalcCReviews, incentiveCalcReceiptEvents, incentiveCalcRepHistory, leadBatches, leadConversions, tallyDocuments } from "@/db/schema";
import { EMPLOYEE_ROLES } from "@/db/enums";
import { normalizeInputX } from "@/lib/incentives/categories/hash";
import type { CarryIn, CarryRules, CategoryXInput, ExtraCategory, FReviewIn, OrderXIn } from "@/lib/incentives/categories/types";
import { wordsIn } from "@/lib/incentives/categories/f-url";
import { monthsBefore } from "@/lib/incentives/shared/dates";
import { monthEnd } from "@/lib/incentives/category-a/settle";
import { isDay } from "@/lib/incentives/rules-config/validate";
import { loadConfig, versionInForce } from "@/lib/queries/incentive-rules";
import { allCategoriesFor } from "@/lib/queries/incentive-calc-b";

/**
 * Categories C–G's reading side (migration 0135): each engine's input for one programme and month, as of a day.
 *   C, G — Forms' Sales Orders of the customers with an order in the month (and, for C, their invoices, receipts and
 *          credit notes; for G, enough earlier months to see a run of purchases), the Customer Master and the shared
 *          attribution records;
 *   D, E, F — the tracker's submissions of the month (approved or not: the engine says why one doesn't count).
 * Reads only; changes nothing. Nothing here is used unless 0135 is applied.
 */

type Db = typeof Db0 | Parameters<Parameters<typeof Db0.transaction>[0]>[0];
type Q = typeof Db0;
type Doc = typeof tallyDocuments.$inferSelect;
const D = (x: unknown) => String(x).slice(0, 10);
const rowsOf = <T>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
const itemsOf = (d: Doc): number | null => {
  const a = (d.lines ?? []).map((l) => l.amountPaise).filter((x): x is number => typeof x === "number");
  return a.length ? a.reduce((x, y) => x + y, 0) : null;
};
const toOrder = (d: Doc): OrderXIn => {
  const det = (d.details ?? {}) as { states?: { cancelled?: boolean; optional?: boolean; postDated?: boolean }; order?: { paymentTerms?: string } };
  return { id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, partyKey: d.partyKey, paymentTerms: det.order?.paymentTerms || null, states: { cancelled: !!det.states?.cancelled, optional: !!det.states?.optional, postDated: !!det.states?.postDated }, lines: (d.lines ?? []).map((l) => ({ productId: l.productId ?? null, item: l.item ?? l.productLabel ?? null })), totalPaise: Number(d.totalPaise), taxablePaise: d.taxablePaise === null ? null : Number(d.taxablePaise) };
};

export const CALC_X_NOT_READY = "Categories C–G need database update 0135 first, so nothing was done.";
export const CALC_F_NOT_READY = "Category F needs database updates 0137, 0138 and 0139 first (its testimonial registry, decisions, the email / letterhead / appreciation fields and their identities), so nothing was done.";
/**
 * Whether 0137 (Category F's registry), 0138 (email and letterhead testimonials, F.4 appreciation) AND 0139 (the
 * email / letterhead identity, write-off history) are applied. Every read or write of the Category F tables waits for all
 * three: the code names 0138's and 0139's columns.
 */
export async function incentiveCalcFReady(q: Db): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.incentive_f_decisions') is not null and to_regclass('public.incentive_f_writeoffs') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'incentive_f_decisions' and column_name = 'appreciated_employee_ids')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'incentive_f_decisions' and column_name = 'evidence_fingerprint')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'incentive_f_submissions' and column_name = 'claimed_kind') as ok`);
  return rowsOf<{ ok: boolean }>(r)[0]?.ok === true;
}

/**
 * Category F's month (0137): every review whose ACTIVE verification puts its original publication in the month, with
 * the verified facts, its active attribution (if any), whether a second person approved its invalidation, and the
 * customer's assigned salesperson on the publication date (the Customer Master's representative history; a customer
 * with no history at all: its current representative). Reads only.
 */
export async function loadFReviews(q: Db, month: string): Promise<FReviewIn[]> {
  const rows = rowsOf<{ review_id: string; kind: string | null; published_on: string; rating: number | null; review_text: string | null; named: string[] | string | null; appreciated: string[] | string | null; customer_master_id: string | null; credited: string | null; basis: "named" | "assigned" | "claim" | null; has_attribution: boolean; invalidated: boolean }>(
    await q.execute(sql`
      select r.id as review_id, v.testimonial_kind as kind, v.published_on::text as published_on, v.rating::int as rating, v.review_text, v.named_employee_ids::text[] as named,
        v.appreciated_employee_ids::text[] as appreciated, v.customer_master_id,
        a.credited_employee_id as credited, a.basis, (a.id is not null) as has_attribution,
        exists (select 1 from incentive_f_decisions x where x.review_id = r.id and x.kind = 'invalidate-approve') as invalidated
      from incentive_f_reviews r
      join incentive_f_decisions v on v.review_id = r.id and v.kind = 'verify' and v.retired_at is null
      left join incentive_f_decisions a on a.review_id = r.id and a.kind = 'attribute' and a.retired_at is null
      where v.review_month = ${month}::date
      order by r.id`),
  );
  const named = (x: string[] | string | null) => (Array.isArray(x) ? x : typeof x === "string" ? x.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : []);
  const custIds = [...new Set(rows.map((r) => r.customer_master_id).filter((x): x is string => !!x))];
  const reps = custIds.length ? await q.select().from(incentiveCalcRepHistory).where(and(inArray(incentiveCalcRepHistory.customerMasterId, custIds), isNull(incentiveCalcRepHistory.retiredAt))) : [];
  const current = custIds.length ? await q.select({ id: customerMasters.id, rep: customerMasters.salesRepId }).from(customerMasters).where(inArray(customerMasters.id, custIds)) : [];
  const assignedOn = (cid: string | null, day: string): string | null => {
    if (!cid) return null;
    const mine = reps.filter((r) => r.customerMasterId === cid);
    if (!mine.length) return current.find((c) => c.id === cid)?.rep ?? null;
    const hit = mine.filter((r) => D(r.effectiveFrom) <= day && (!r.effectiveTo || D(r.effectiveTo) >= day)).sort((a, b) => (D(a.effectiveFrom) < D(b.effectiveFrom) ? 1 : -1))[0];
    return hit?.employeeId ?? null;
  };
  return rows.map((r) => ({
    reviewId: r.review_id,
    label: `#${r.review_id.slice(0, 8)}`,
    // 0138: the verified type (0137's verifications are Google reviews).
    kind: r.kind === "email" || r.kind === "letterhead" ? r.kind : "google_review",
    publishedOn: D(r.published_on),
    rating: r.rating === null ? null : Number(r.rating),
    wordCount: wordsIn(r.review_text),
    namedEmployeeIds: named(r.named).sort(),
    appreciatedEmployeeIds: named(r.appreciated).sort(),
    assignedEmployeeId: assignedOn(r.customer_master_id, D(r.published_on)),
    attribution: r.has_attribution && r.basis ? { employeeId: r.credited, basis: r.basis } : null,
    invalidated: r.invalidated === true,
  }));
}

export const CALC_C_NOT_READY = "Category C needs database update 0136 first (its Admin Review of unmatched records), so nothing was done.";

/**
 * The carry-forward in force for a month (0136): per salesperson, the lots held in EARLIER months that still have an
 * amount left (held less every release / offset / expiry / write-off), and the adjustments carried into this month.
 * Reads only. The same function checks, at submission and payout, that nothing changed since the calculation.
 */
export async function loadCarry(q: Db, programId: string, category: string, month: string): Promise<CarryIn[]> {
  // Each balance with the rules it was HELD under: the settings of the run that held it (append-only, so they never
  // change), never the settings of the month that now counts it.
  const lots = rowsOf<{ id: string; employee_id: string | null; employee_name: string; month: string; remaining: string; below: string | null; expiry: string | null; months: string | null }>(
    await q.execute(sql`
      select h.id, h.employee_id, h.employee_name, h.month::text as month, (h.amount_paise + coalesce((select sum(c.amount_paise) from incentive_calc_carry c where c.lot_id = h.id), 0))::text as remaining,
        r.result->'settingsUsed'->>'payout.belowMinimum' as below, r.result->'settingsUsed'->>'payout.carryForwardExpiry' as expiry, r.result->'settingsUsed'->>'payout.carryForwardExpiryMonths' as months
      from incentive_calc_carry h
      join incentive_calc_runs r on r.id = h.run_id
      where h.kind = 'held' and h.program_id = ${programId} and h.category_code = ${category} and h.month < ${month}::date
      order by h.month, h.id`),
  ).filter((l) => Number(l.remaining) > 0 && l.employee_id);
  const adj = await q.select({ e: incentiveCalcAdjustments.employeeId, n: incentiveCalcAdjustments.employeeName, a: incentiveCalcAdjustments.amountPaise }).from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.programId, programId), eq(incentiveCalcAdjustments.categoryCode, category), eq(incentiveCalcAdjustments.toMonth, month)));
  const out = new Map<string, CarryIn>();
  const of = (e: string, name: string) => out.get(e) ?? out.set(e, { employeeId: e, name, lots: [], adjustmentsPaise: 0 }).get(e)!;
  for (const l of lots) of(l.employee_id!, l.employee_name).lots.push({ id: l.id, month: String(l.month).slice(0, 10), remainingPaise: Number(l.remaining), rules: carryRulesOf(l) });
  for (const a of adj) if (a.e) of(a.e, a.n).adjustmentsPaise += Number(a.a);
  return [...out.values()].filter((c) => c.lots.length || c.adjustmentsPaise).sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));
}

/**
 * A held balance's own rules, from its holding run's stored settings. A value the run doesn't state is read the way
 * that never forfeits anything: carried forward, never expiring (the configuration's defaults).
 */
function carryRulesOf(l: { below: string | null; expiry: string | null; months: string | null }): CarryRules {
  const months = l.months === null ? null : Number(l.months);
  const afterMonths = l.expiry === "afterMonths" && months !== null && Number.isInteger(months) && months > 0;
  // The number of months is part of the rule only when the balance expires after months.
  return { belowMinimum: l.below === "notReleased" ? "notReleased" : "carryForward", expiry: afterMonths ? "afterMonths" : "never", expiryMonths: afterMonths ? months : null };
}

/** Whether 0136 (Category C's review decisions) is applied. */
export async function incentiveCalcCReady(q: Db): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.incentive_calc_c_reviews') is not null as ok`);
  return rowsOf<{ ok: boolean }>(r)[0]?.ok === true;
}

/** Whether 0135 is applied — asked in a way that can't fail inside a transaction. */
export async function incentiveCalcXReady(q: Db): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.incentive_calc_items') is not null and to_regclass('public.incentive_calc_b_qualifications') is not null as ok`);
  return rowsOf<{ ok: boolean }>(r)[0]?.ok === true;
}

/**
 * How many rounds of Forms references (order → invoice → credit note / receipt, and admins' link decisions) Category C
 * follows. A chain longer than this is never silently cut: the calculation holds the customers it touches (fail-closed).
 */
export const C_REFERENCE_ROUNDS = 50;

export async function loadInputX(q: Db, category: ExtraCategory, programId: string, month: string, asOf: string, opts: { referenceRounds?: number } = {}): Promise<CategoryXInput> {
  const end = monthEnd(month);
  const version = await versionInForce(q as Q, programId, category, month);
  const config = version ? await loadConfig(q as Q, version.id) : null;
  const s = config?.settings ?? {};
  const emps = await q.select({ id: employees.id, name: employees.name, role: employees.role, departmentId: employees.departmentId, isActive: employees.isActive }).from(employees);
  const base: CategoryXInput = {
    category,
    month,
    asOf,
    configVersion: version ? { id: version.id, programId: version.programId, versionNo: version.versionNo, status: version.status, effectiveFrom: version.effectiveFrom ? D(version.effectiveFrom) : null, effectiveTo: version.effectiveTo ? D(version.effectiveTo) : null } : null,
    config,
    roles: [...EMPLOYEE_ROLES],
    employees: emps,
  };
  const ym = month.slice(0, 7);
  if (category === "D") {
    const [b, c] = await Promise.all([q.select().from(leadBatches).where(eq(leadBatches.periodMonth, ym)), q.select().from(leadConversions).where(eq(leadConversions.periodMonth, ym))]);
    base.leadBatches = b.map((x) => ({ id: x.id, employeeId: x.employeeId, periodMonth: x.periodMonth, leadCount: x.leadCount, profiled: x.profiled, approved: x.reviewStatus === "approved" }));
    base.leadConversions = c.map((x) => ({ id: x.id, employeeId: x.employeeId, periodMonth: x.periodMonth, convertedCount: x.convertedCount, approved: x.reviewStatus === "approved" }));
  } else if (category === "E") {
    const m = await q.select().from(clientMeetings).where(eq(clientMeetings.periodMonth, ym));
    base.meetings = m.map((x) => ({ id: x.id, employeeId: x.employeeId, periodMonth: x.periodMonth, awardedPaise: Number(x.awardedPaise), approved: x.reviewStatus === "approved", label: `Meeting (${x.potentialBand ?? "—"} potential)` }));
  } else if (category === "F") {
    // Category F/2 reads only the Google review registry's verified reviews (0137); the old engine's testimonials
    // (email, letterhead, unverified submissions) earn nothing here.
    base.fReviews = (await incentiveCalcFReady(q)) ? await loadFReviews(q, month) : [];
  } else {
    // C, G: the customers with a Sales Order in the month, and their orders back far enough for the rule.
    const inMonth = await q.select({ id: tallyDocuments.id, c: tallyDocuments.customerMasterId }).from(tallyDocuments).where(and(eq(tallyDocuments.documentType, "sales-orders"), sql`${tallyDocuments.documentDate} between ${month}::date and ${end}::date`, lte(tallyDocuments.documentDate, asOf)));
    const custIds = [...new Set(inMonth.map((x) => x.c).filter((x): x is string => !!x))];
    const docs = new Map<string, Doc>();
    // C: the month's Sales Orders with no Customer Master link are held for review (never dropped), and a review
    // decision linking one to its customer brings that customer's history in (0136).
    const unlinked = category === "C" ? inMonth.filter((x) => !x.c).map((x) => x.id) : [];
    const cReady = category === "C" && (await incentiveCalcCReady(q));
    if (unlinked.length) {
      for (const d of await q.select().from(tallyDocuments).where(inArray(tallyDocuments.id, unlinked))) docs.set(d.id, d);
      if (cReady) for (const r of await q.select().from(incentiveCalcCReviews).where(and(inArray(incentiveCalcCReviews.documentId, unlinked), eq(incentiveCalcCReviews.caseKind, "order-customer"), eq(incentiveCalcCReviews.decision, "link"), isNull(incentiveCalcCReviews.retiredAt)))) if (r.targetId && !custIds.includes(r.targetId)) custIds.push(r.targetId);
    }
    let incomplete: { documentIds: string[]; customerIds: string[] } | null = null;
    // C: the look-back before an acquisition's first order plus its turnover window, back from the month (a month's
    // margin for day boundaries) — no financial-year boundary. G: far enough for any run of months.
    const back = category === "C" ? monthsBefore(month, Number(s["c.turnoverWindowMonths"] ?? 0) + Number(s["c.newCustomerLookbackMonths"] ?? 0) + 1) : monthsBefore(month, 240);
    const partyKeysOf: Record<string, string[]> = {};
    if (custIds.length) {
      for (const d of await q.select().from(tallyDocuments).where(and(eq(tallyDocuments.documentType, "sales-orders"), inArray(tallyDocuments.customerMasterId, custIds), sql`${tallyDocuments.documentDate} >= ${back}::date`, lte(tallyDocuments.documentDate, asOf)))) docs.set(d.id, d);
      if (category === "C") {
        const TYPES = ["sales-invoices", "customer-receipts", "credit-notes"];
        for (const d of await q.select().from(tallyDocuments).where(and(inArray(tallyDocuments.documentType, TYPES), inArray(tallyDocuments.customerMasterId, custIds), lte(tallyDocuments.documentDate, asOf)))) docs.set(d.id, d);
        // Each in-scope customer's own Tally party keys, and every UNLINKED document (no customer) in the whole range
        // whose party key matches one: PROPOSED for review — the engine never links a record by its party alone.
        const keys = await q.selectDistinct({ c: tallyDocuments.customerMasterId, k: tallyDocuments.partyKey }).from(tallyDocuments).where(and(inArray(tallyDocuments.customerMasterId, custIds), isNotNull(tallyDocuments.partyKey)));
        for (const r of keys) if (r.c && r.k) (partyKeysOf[r.c] ??= []).push(r.k);
        const allKeys = [...new Set(keys.map((r) => r.k).filter((x): x is string => !!x))];
        if (allKeys.length)
          for (const d of await q.select().from(tallyDocuments).where(and(isNull(tallyDocuments.customerMasterId), inArray(tallyDocuments.partyKey, allKeys), inArray(tallyDocuments.documentType, ["sales-orders", ...TYPES]), sql`${tallyDocuments.documentDate} >= ${back}::date`, lte(tallyDocuments.documentDate, asOf)))) docs.set(d.id, d);
        // Records an admin LINKED to one of these customers (any unattributed Sales Order in the range, or receipt).
        if (cReady) {
          const linked = await q.select({ id: incentiveCalcCReviews.documentId }).from(incentiveCalcCReviews).where(and(inArray(incentiveCalcCReviews.caseKind, ["order-customer", "receipt-customer"]), eq(incentiveCalcCReviews.decision, "link"), inArray(incentiveCalcCReviews.targetId, custIds), isNull(incentiveCalcCReviews.retiredAt)));
          const ids = linked.map((r) => r.id).filter((id) => !docs.has(id));
          if (ids.length) for (const d of await q.select().from(tallyDocuments).where(and(inArray(tallyDocuments.id, ids), lte(tallyDocuments.documentDate, asOf), or(sql`${tallyDocuments.documentType} <> 'sales-orders'`, sql`${tallyDocuments.documentDate} >= ${back}::date`)))) docs.set(d.id, d);
        }
        // Follow the references both ways — and every admin's link decision to a loaded record — until nothing new is
        // found (order → invoice → credit note / receipt chains, whatever their customer link), so no linked record is
        // left behind. FAIL-CLOSED: a chain longer than the limit is never cut silently; the customers it touches are held.
        const next = async () => {
          const keys = [...docs.keys()];
          const refs = [...docs.values()].map((d) => d.refDocumentId).filter((x): x is string => !!x && !docs.has(x));
          const decided = cReady ? (await q.select({ id: incentiveCalcCReviews.documentId }).from(incentiveCalcCReviews).where(and(inArray(incentiveCalcCReviews.caseKind, ["invoice-order", "credit-note-invoice", "return-credit-note"]), eq(incentiveCalcCReviews.decision, "link"), inArray(incentiveCalcCReviews.targetId, keys), isNull(incentiveCalcCReviews.retiredAt)))).map((r) => r.id).filter((id) => !docs.has(id)) : [];
          const byId = [...new Set([...refs, ...decided])];
          const more = await q.select().from(tallyDocuments).where(and(lte(tallyDocuments.documentDate, asOf), or(inArray(tallyDocuments.refDocumentId, keys), byId.length ? inArray(tallyDocuments.id, byId) : sql`false`)));
          return more.filter((d) => !docs.has(d.id));
        };
        const rounds = opts.referenceRounds ?? C_REFERENCE_ROUNDS;
        let fresh = await next();
        for (let round = 0; fresh.length && round < rounds; round++) {
          for (const d of fresh) docs.set(d.id, d);
          fresh = await next();
        }
        if (fresh.length) {
          // Not followed: these records, and the customers they (or the records next to them) belong to — every
          // customer when one of them can't be placed.
          const cust = new Set<string>();
          let unplaced = false;
          for (const d of fresh) {
            const near = [d.customerMasterId, d.refDocumentId ? docs.get(d.refDocumentId)?.customerMasterId : null, ...[...docs.values()].filter((x) => x.refDocumentId === d.id).map((x) => x.customerMasterId)].filter((x): x is string => !!x);
            if (!near.length) unplaced = true;
            for (const c of near) cust.add(c);
          }
          incomplete = { documentIds: fresh.map((d) => d.id).sort(), customerIds: unplaced ? [] : [...cust].sort() };
        }
      }
    }
    const all = [...docs.values()];
    const of = (t: string) => all.filter((d) => d.documentType === t);
    const orders = of("sales-orders").map(toOrder);
    const ids = all.map((d) => d.id);
    const cust = [...new Set([...all.map((d) => d.customerMasterId).filter((x): x is string => !!x), ...custIds])];
    const [custRows, reps, attrs, events] = await Promise.all([
      cust.length ? q.select({ id: customerMasters.id, name: customerMasters.name, salesRepId: customerMasters.salesRepId, creditPeriodDays: customerMasters.creditPeriodDays }).from(customerMasters).where(inArray(customerMasters.id, cust)) : [],
      cust.length ? q.select().from(incentiveCalcRepHistory).where(and(inArray(incentiveCalcRepHistory.customerMasterId, cust), isNull(incentiveCalcRepHistory.retiredAt))) : [],
      orders.length ? q.select().from(incentiveCalcAttributions).where(and(inArray(incentiveCalcAttributions.documentId, orders.map((o) => o.id)), isNull(incentiveCalcAttributions.retiredAt))) : [],
      category === "C" && ids.length ? q.select().from(incentiveCalcReceiptEvents).where(and(inArray(incentiveCalcReceiptEvents.documentId, ids), lte(incentiveCalcReceiptEvents.eventDate, asOf), isNull(incentiveCalcReceiptEvents.retiredAt))) : [],
    ]);
    base.orders = orders;
    base.customers = custRows;
    base.repHistory = reps.map((r) => ({ customerId: r.customerMasterId, employeeId: r.employeeId, from: D(r.effectiveFrom), to: r.effectiveTo ? D(r.effectiveTo) : null }));
    base.attributions = attrs.map((a) => ({ documentId: a.documentId, employeeId: a.employeeId, sharePpm: a.sharePpm }));
    if (category === "C") {
      base.invoices = of("sales-invoices").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, orderId: d.refDocumentId, totalPaise: Number(d.totalPaise), taxablePaise: d.taxablePaise === null ? null : Number(d.taxablePaise), itemsPaise: itemsOf(d), dueDate: d.dueDate && isDay(D(d.dueDate)) ? D(d.dueDate) : null }));
      base.receipts = of("customer-receipts").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, invoiceId: d.refDocumentId, amountPaise: Number(d.totalPaise) }));
      base.creditNotes = of("credit-notes").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, invoiceId: d.refDocumentId, totalPaise: Number(d.totalPaise), taxablePaise: d.taxablePaise === null ? null : Number(d.taxablePaise), itemsPaise: itemsOf(d) }));
      base.events = events.map((e) => ({ id: e.id, kind: e.kind, documentId: e.documentId, invoiceId: e.invoiceDocumentId, amountPaise: e.amountPaise, date: D(e.eventDate) }));
      // The admins' review decisions in force on these records (0136).
      const reviewed = cReady && ids.length ? await q.select().from(incentiveCalcCReviews).where(and(inArray(incentiveCalcCReviews.documentId, [...ids, ...events.map((e) => e.documentId)]), isNull(incentiveCalcCReviews.retiredAt))) : [];
      base.cReviews = reviewed.map((r) => ({ id: r.id, documentId: r.documentId, caseKind: r.caseKind, decision: r.decision, targetId: r.targetId }));
      base.customerPartyKeys = partyKeysOf;
      base.partyKeys = Object.fromEntries(all.filter((d) => !d.customerMasterId && d.partyKey).map((d) => [d.id, d.partyKey!]));
      if (incomplete) base.incompleteReferences = incomplete;
      // The below-minimum carry-forward in force for the month (a version with a smallest amount paid; 0136).
      if (cReady && s["payout.minimumPayable"] !== undefined) base.carry = await loadCarry(q, programId, category, month);
    }
  }
  const shared = await allCategoriesFor(q, programId, month, category, config);
  return normalizeInputX({ ...base, ...(shared ? { allCategories: shared } : {}) });
}
