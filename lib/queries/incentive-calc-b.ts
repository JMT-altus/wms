import "server-only";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { db as Db0 } from "@/lib/db";
import {
  customerMasters,
  employees,
  incentiveCalcAttributions,
  incentiveCalcBOverrides,
  incentiveCalcPeriods,
  incentiveCalcReceiptEvents,
  incentiveCalcRepHistory,
  incentiveCalcRuns,
  products,
  tallyDocuments,
} from "@/db/schema";
import { EMPLOYEE_ROLES } from "@/db/enums";
import { normalizeInputB } from "@/lib/incentives/category-b/hash";
import type { CategoryBInput, OrderBIn } from "@/lib/incentives/category-b/types";
import type { AllCategoriesIn, OtherCategoryAmount } from "@/lib/incentives/shared/all-categories";
import { monthsBefore } from "@/lib/incentives/shared/dates";
import { monthEnd } from "@/lib/incentives/category-a/settle";
import type { IncentiveConfig, SettingValue } from "@/lib/incentives/rules-config/spec";
import { isDay } from "@/lib/incentives/rules-config/validate";
import { loadConfig, versionInForce } from "@/lib/queries/incentive-rules";

/**
 * Category B's reading side (migration 0134): the engine's input from Forms (tally_documents), the Customer and
 * Product Masters, the shared Category A input records, the active manual decisions and the orders already paid out;
 * and what Category A and Category B share — the all-categories limit and, when a Category A version leaves them out,
 * the orders that earn Category B. Reads only; changes nothing. Nothing here is used unless 0134 is applied.
 */

type Db = typeof Db0 | Parameters<Parameters<typeof Db0.transaction>[0]>[0];
type Q = typeof Db0;
type Doc = typeof tallyDocuments.$inferSelect;
const D = (x: unknown) => String(x).slice(0, 10);
const rowsOf = <T>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
const itemsOf = (d: Doc): number | null => {
  const amounts = (d.lines ?? []).map((l) => l.amountPaise).filter((x): x is number => typeof x === "number");
  return amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
};

export const CALC_B_NOT_READY = "Category B needs database update 0134 first, so nothing was done.";

/** Whether 0134 is applied (Category B's tables exist) — asked in a way that can't fail inside a transaction. */
export async function incentiveCalcBReady(q: Db): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.incentive_calc_b_qualifications') is not null and to_regclass('public.incentive_calc_b_overrides') is not null and to_regclass('public.incentive_calc_approvals') is not null as ok`);
  return rowsOf<{ ok: boolean }>(r)[0]?.ok === true;
}

/* ── what Category A and Category B share ─────────────────────────────── */

const capOf = (c: IncentiveConfig) => (c.settings["caps.perEmployeeAllCategoriesMonth"] === "none" ? null : ((c.settings["caps.perEmployeeAllCategoriesMonth"] as number | undefined) ?? null));

/**
 * The shared all-categories limit for `own`'s calculation of a month, or undefined when no other category has a
 * published version in force for the month (then the category applies its own limit alone, as before). The limit is the
 * lower of the categories' limits; the policy is the one the versions state (a Category A version may leave it unset —
 * then the others' applies); versions that state different policies block the calculation with the reason. Every other
 * category's adopted calculation of the month counts (a locked, submitted, approved or paid one with its final figure).
 */
export async function allCategoriesFor(q: Db, programId: string, month: string, own: string, ownConfig: IncentiveConfig | null): Promise<AllCategoriesIn | undefined> {
  if (!ownConfig || !(await incentiveCalcBReady(q))) return undefined;
  const otherCodes = ["A", "B", "C", "D", "E", "F", "G"].filter((c) => c !== own);
  const otherVersions: { code: string; config: IncentiveConfig }[] = [];
  for (const code of otherCodes) {
    const v = await versionInForce(q as Q, programId, code, month);
    if (v) otherVersions.push({ code, config: await loadConfig(q as Q, v.id) });
  }
  if (!otherVersions.length) return undefined;
  const configs = [ownConfig, ...otherVersions.map((o) => o.config)];
  const caps = configs.map(capOf).filter((x): x is number => x !== null);
  const capPaise = caps.length ? Math.min(...caps) : null;
  const pol = (c: IncentiveConfig) => (c.settings["caps.allCategoriesPolicy"] as string | undefined) ?? null;
  const ord = (c: IncentiveConfig) => ((c.settings["caps.allCategoriesOrder"] as string[] | undefined) ?? []).join(",");
  const set = configs.filter((c) => pol(c) !== null);
  const policies = set.map((c) => pol(c)!);
  let problem: string | undefined;
  if (new Set(policies).size > 1 || (policies[0] === "categoryOrder" && new Set(set.map(ord)).size > 1))
    problem = `The versions in force for ${month.slice(0, 7)} (Categories ${[own, ...otherVersions.map((o) => o.code)].sort().join(", ")}) share the all-categories limit differently ("Sharing the all-categories limit between categories"): publish versions that agree.`;
  const policy = (policies[0] ?? "proportional") as AllCategoriesIn["policy"];
  const order = (set[0]?.settings["caps.allCategoriesOrder"] as string[] | undefined) ?? [];
  // Each other category's adopted calculation of the month, if any.
  const others: Record<string, OtherCategoryAmount[]> = {};
  for (const { code } of otherVersions) {
    const [p] = await q.select().from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, code), eq(incentiveCalcPeriods.month, month)));
    if (!p?.currentRunId) continue;
    const [run] = await q.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, p.currentRunId));
    const emps = (run?.result as { employees?: { employeeId: string; earnedPaise: number; beforeAllCategoriesPaise?: number; capConsumedPaise?: number }[] } | undefined)?.employees ?? [];
    // Only what a category RELEASES uses the shared limit: a minimum-payable month held below its minimum
    // (capConsumedPaise 0) takes nothing from the others; every other result counts as before.
    for (const e of [...emps].sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1))) {
      const held = e.capConsumedPaise === 0;
      (others[e.employeeId] ??= []).push({ category: code, prePaise: held ? 0 : (e.beforeAllCategoriesPaise ?? e.earnedPaise), finalPaise: e.capConsumedPaise ?? e.earnedPaise, fixed: p.status !== "open" });
    }
  }
  return { capPaise, policy, order, others, ...(problem ? { problem } : {}) };
}

/**
 * The Sales Orders that earn Category B, for a Category A version that leaves them out of Category A: the orders
 * QUALIFIED in the adopted calculation of any Category B month of the programme, as they stand when Category A is
 * calculated. An order that qualifies for Category B later leaves Category A only when Category A's month is
 * recalculated; a locked, approved or paid Category A month never changes (its difference is carried as configured).
 */
export async function categoryBOrderIds(q: Db, programId: string): Promise<string[]> {
  if (!(await incentiveCalcBReady(q))) return [];
  const r = await q.execute(sql`
    select distinct qq.order_document_id::text as id from incentive_calc_b_qualifications qq
    join incentive_calc_periods p on p.current_run_id = qq.run_id
    where p.category_code = 'B' and p.program_id = ${programId} and qq.outcome = 'qualified' and qq.in_month and qq.order_document_id is not null
    order by 1`);
  return rowsOf<{ id: string }>(r).map((x) => x.id);
}

/* ── Category B's input ──────────────────────────────────────────────── */

const states = (d: Doc) => {
  const det = (d.details ?? {}) as { states?: { cancelled?: boolean; optional?: boolean; postDated?: boolean }; order?: { paymentTerms?: string } };
  return { cancelled: !!det.states?.cancelled, optional: !!det.states?.optional, postDated: !!det.states?.postDated, paymentTerms: det.order?.paymentTerms || null };
};
const toOrder = (d: Doc): OrderBIn => {
  const st = states(d);
  return { id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, partyKey: d.partyKey, paymentTerms: st.paymentTerms, states: { cancelled: st.cancelled, optional: st.optional, postDated: st.postDated }, lines: (d.lines ?? []).map((l) => ({ productId: l.productId ?? null, item: l.item ?? l.productLabel ?? null })) };
};

/** Everything the Category B engine needs for one programme and month, as of a day. Reads only. */
export async function loadInputB(q: Db, programId: string, month: string, asOf: string): Promise<CategoryBInput> {
  const end = monthEnd(month);
  const version = await versionInForce(q as Q, programId, "B", month);
  const config = version ? await loadConfig(q as Q, version.id) : null;
  const s = (config?.settings ?? {}) as Record<string, SettingValue>;
  const lookback = Math.max(Number(s["b.existingLookbackMonths"] ?? 0), s["b.noveltyWindow"] === "own" ? Number(s["b.noveltyLookbackMonths"] ?? 0) : 0);

  // Orders already paid out (their qualifying invoice is fixed from then on).
  const earnedRows = rowsOf<{ order_id: string; invoice_id: string; month: string }>(
    await q.execute(sql`
      select qq.order_document_id::text as order_id, qq.invoice_document_id::text as invoice_id, p.month::text as month
      from incentive_calc_b_qualifications qq join incentive_calc_periods p on p.current_run_id = qq.run_id
      where p.category_code = 'B' and p.program_id = ${programId} and p.status = 'paid' and qq.outcome = 'qualified' and qq.in_month
        and qq.order_document_id is not null and qq.invoice_document_id is not null
      order by 1`),
  );

  // The month's invoices, and the orders they belong to (plus orders paid out with an invoice of this month).
  const monthInvoices = await q.select().from(tallyDocuments).where(and(eq(tallyDocuments.documentType, "sales-invoices"), sql`${tallyDocuments.documentDate} between ${month}::date and ${end}::date`, lte(tallyDocuments.documentDate, asOf)));
  const orderIds = new Set<string>([...monthInvoices.map((i) => i.refDocumentId).filter((x): x is string => !!x), ...earnedRows.filter((e) => e.month === month).map((e) => e.order_id)]);
  const candidates = orderIds.size ? await q.select().from(tallyDocuments).where(and(eq(tallyDocuments.documentType, "sales-orders"), inArray(tallyDocuments.id, [...orderIds]))) : [];
  const docs = new Map<string, Doc>();
  for (const d of [...monthInvoices, ...candidates]) docs.set(d.id, d);

  // The customers' documents up to the as-of day (receipts on account and "oldest first" need them all), and the
  // orders' own invoices, credit notes and receipts wherever they are linked.
  const customers = new Set([...docs.values()].map((d) => d.customerMasterId).filter((x): x is string => !!x));
  const TYPES = ["sales-invoices", "customer-receipts", "credit-notes"];
  if (customers.size) for (const d of await q.select().from(tallyDocuments).where(and(inArray(tallyDocuments.documentType, TYPES), inArray(tallyDocuments.customerMasterId, [...customers]), lte(tallyDocuments.documentDate, asOf)))) docs.set(d.id, d);
  for (let round = 0; round < 3; round++) {
    const ids = [...docs.keys()];
    const refs = [...docs.values()].map((d) => d.refDocumentId).filter((x): x is string => !!x && !docs.has(x));
    const linked = await q.select().from(tallyDocuments).where(and(inArray(tallyDocuments.documentType, [...TYPES, "sales-orders"]), lte(tallyDocuments.documentDate, asOf), or(inArray(tallyDocuments.refDocumentId, ids), refs.length ? inArray(tallyDocuments.id, refs) : sql`false`)));
    const before = docs.size;
    for (const d of linked) docs.set(d.id, d);
    if (docs.size === before) break;
  }

  // History: the customers' earlier orders within the look back, and earlier orders of the same parties not linked to
  // the Customer Master (so an unlinked history is reviewed, never taken as "new customer").
  const candidateOrders = [...docs.values()].filter((d) => d.documentType === "sales-orders");
  const earliest = candidateOrders.length && lookback > 0 ? monthsBefore(candidateOrders.map((d) => D(d.documentDate)).sort()[0]!, lookback) : null;
  if (earliest) {
    const custIds = [...new Set(candidateOrders.map((d) => d.customerMasterId).filter((x): x is string => !!x))];
    const parties = [...new Set(candidateOrders.map((d) => d.partyKey))];
    const hist = await q
      .select()
      .from(tallyDocuments)
      .where(and(eq(tallyDocuments.documentType, "sales-orders"), sql`${tallyDocuments.documentDate} >= ${earliest}::date`, lte(tallyDocuments.documentDate, asOf), or(custIds.length ? inArray(tallyDocuments.customerMasterId, custIds) : sql`false`, and(isNull(tallyDocuments.customerMasterId), inArray(tallyDocuments.partyKey, parties)))));
    for (const d of hist) docs.set(d.id, d);
  }

  const all = [...docs.values()].filter((d) => D(d.documentDate) <= asOf);
  const of = (t: string) => all.filter((d) => d.documentType === t);
  const orders = of("sales-orders").map(toOrder);
  const productIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)).filter((x): x is string => !!x))];
  const docIds = all.map((d) => d.id);
  const custIds = [...new Set(all.map((d) => d.customerMasterId).filter((x): x is string => !!x))];
  const orderDocIds = orders.map((o) => o.id);
  const [prods, events, custRows, reps, attrs, emps, overrides] = await Promise.all([
    productIds.length ? q.select({ id: products.id, name: products.name, brand: products.brand }).from(products).where(inArray(products.id, productIds)) : [],
    docIds.length ? q.select().from(incentiveCalcReceiptEvents).where(and(inArray(incentiveCalcReceiptEvents.documentId, docIds), lte(incentiveCalcReceiptEvents.eventDate, asOf), isNull(incentiveCalcReceiptEvents.retiredAt))) : [],
    custIds.length ? q.select({ id: customerMasters.id, name: customerMasters.name, salesRepId: customerMasters.salesRepId, creditPeriodDays: customerMasters.creditPeriodDays }).from(customerMasters).where(inArray(customerMasters.id, custIds)) : [],
    custIds.length ? q.select().from(incentiveCalcRepHistory).where(and(inArray(incentiveCalcRepHistory.customerMasterId, custIds), isNull(incentiveCalcRepHistory.retiredAt))) : [],
    orderDocIds.length ? q.select().from(incentiveCalcAttributions).where(and(inArray(incentiveCalcAttributions.documentId, orderDocIds), isNull(incentiveCalcAttributions.retiredAt))) : [],
    q.select({ id: employees.id, name: employees.name, role: employees.role, departmentId: employees.departmentId, isActive: employees.isActive }).from(employees),
    orderDocIds.length ? q.select().from(incentiveCalcBOverrides).where(and(inArray(incentiveCalcBOverrides.orderDocumentId, orderDocIds), isNull(incentiveCalcBOverrides.retiredAt))) : [],
  ]);

  return normalizeInputB({
    month,
    asOf,
    configVersion: version ? { id: version.id, programId: version.programId, versionNo: version.versionNo, status: version.status, effectiveFrom: version.effectiveFrom ? D(version.effectiveFrom) : null, effectiveTo: version.effectiveTo ? D(version.effectiveTo) : null } : null,
    config,
    roles: [...EMPLOYEE_ROLES],
    orders,
    invoices: of("sales-invoices").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, orderId: d.refDocumentId, totalPaise: Number(d.totalPaise), taxablePaise: d.taxablePaise === null ? null : Number(d.taxablePaise), itemsPaise: itemsOf(d), dueDate: d.dueDate && isDay(D(d.dueDate)) ? D(d.dueDate) : null })),
    receipts: of("customer-receipts").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, invoiceId: d.refDocumentId, amountPaise: Number(d.totalPaise) })),
    creditNotes: of("credit-notes").map((d) => ({ id: d.id, no: d.documentNo, date: D(d.documentDate), customerId: d.customerMasterId, invoiceId: d.refDocumentId, totalPaise: Number(d.totalPaise), taxablePaise: d.taxablePaise === null ? null : Number(d.taxablePaise), itemsPaise: itemsOf(d) })),
    events: events.map((e) => ({ id: e.id, kind: e.kind, documentId: e.documentId, invoiceId: e.invoiceDocumentId, amountPaise: e.amountPaise, date: D(e.eventDate) })),
    customers: custRows,
    repHistory: reps.map((r) => ({ customerId: r.customerMasterId, employeeId: r.employeeId, from: D(r.effectiveFrom), to: r.effectiveTo ? D(r.effectiveTo) : null })),
    attributions: attrs.map((a) => ({ documentId: a.documentId, employeeId: a.employeeId, sharePpm: a.sharePpm })),
    employees: emps,
    products: prods.map((p) => ({ id: p.id, name: p.name, brand: p.brand })),
    overrides: overrides.map((o) => ({ id: o.id, orderId: o.orderDocumentId, decision: o.decision, reason: o.reason, byId: o.createdById, byName: o.createdByName })),
    earned: earnedRows.filter((e) => orderDocIds.includes(e.order_id)).map((e) => ({ orderId: e.order_id, invoiceId: e.invoice_id, month: e.month })),
    ...(await allCategoriesFor(q, programId, month, "B", config).then((a) => (a ? { allCategories: a } : {}))),
  });
}
