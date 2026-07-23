import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, invoices, receipts } from "@/db/schema";
import { SALES_BH_SCHEME } from "@/lib/incentives";
import type { DecayStep } from "@/lib/incentives";

const DAY = 86_400_000;
const dayDiff = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / DAY);

export interface AtRiskInvoice {
  invoiceId: string;
  invoiceNo: string | null;
  customer: string | null;
  categoryCode: string;
  outstandingPaise: number;
  daysPastTerms: number;
  currentMultiplier: number;
  nextMultiplier: number | null;
  daysToNextStep: number | null;
  /** Approximate incentive on this invoice that the next decay step would erase. */
  atRiskPaise: number;
}

/** Current multiplier + days until the next (worse) decay step. */
function riskInfo(daysPastTerms: number, steps: DecayStep[]) {
  let idx = steps.findIndex((s) => daysPastTerms <= s.maxDaysPastTerms);
  if (idx === -1) idx = steps.length - 1;
  const current = steps[idx]!;
  const next = steps[idx + 1];
  if (!next) return { currentMultiplier: current.multiplier, nextMultiplier: null, daysToNextStep: null };
  return {
    currentMultiplier: current.multiplier,
    nextMultiplier: next.multiplier,
    daysToNextStep: Math.max(0, current.maxDaysPastTerms + 1 - daysPastTerms),
  };
}

/** Rough incentive attributable to one invoice (for the "at risk" figure). */
function invoiceIncentivePaise(categoryCode: string, valuePaise: number): number {
  if (categoryCode === "A") return Math.round(valuePaise * 0.002); // top marginal slab rate
  if (categoryCode === "B" || categoryCode === "C") return Math.round(valuePaise * 0.01);
  return 0;
}

/**
 * The employee's outstanding invoices whose incentive is threatened by
 * collection timing — most-urgent first (soonest to the next decay step).
 */
export async function getAtRiskInvoices(employeeId: string, asOf: Date = new Date()): Promise<AtRiskInvoice[]> {
  const orders = await db.select().from(salesOrders).where(eq(salesOrders.ownerId, employeeId));
  if (!orders.length) return [];
  const orderIds = orders.map((o) => o.id);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const custIds = [...new Set(orders.map((o) => o.customerId))];

  const [invs, custRows] = await Promise.all([
    db.select().from(invoices).where(inArray(invoices.orderId, orderIds)),
    custIds.length
      ? db.query.customers.findMany({ where: (c, { inArray: ia }) => ia(c.id, custIds), columns: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const custName = new Map(custRows.map((c) => [c.id, c.name]));

  const invIds = invs.map((i) => i.id);
  const recs = invIds.length ? await db.select().from(receipts).where(inArray(receipts.invoiceId, invIds)) : [];
  const paidByInv = new Map<string, number>();
  for (const r of recs) paidByInv.set(r.invoiceId, (paidByInv.get(r.invoiceId) ?? 0) + r.amountPaise);

  const out: AtRiskInvoice[] = [];
  for (const inv of invs) {
    const outstanding = inv.invoiceValuePaise - (paidByInv.get(inv.id) ?? 0);
    if (outstanding <= 0) continue; // fully collected — settled, not at risk
    const due = inv.dueDate ? new Date(inv.dueDate) : new Date(new Date(inv.invoiceDate).getTime() + inv.agreedTermsDays * DAY);
    const daysPastTerms = Math.max(0, dayDiff(asOf, due));
    const info = riskInfo(daysPastTerms, SALES_BH_SCHEME.decaySteps);
    const order = orderById.get(inv.orderId)!;
    const incentive = invoiceIncentivePaise(order.categoryCode, inv.invoiceValuePaise);
    const drop = info.nextMultiplier != null ? info.currentMultiplier - info.nextMultiplier : 0;
    out.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      customer: custName.get(order.customerId) ?? null,
      categoryCode: order.categoryCode,
      outstandingPaise: outstanding,
      daysPastTerms,
      currentMultiplier: info.currentMultiplier,
      nextMultiplier: info.nextMultiplier,
      daysToNextStep: info.daysToNextStep,
      atRiskPaise: Math.round(incentive * drop),
    });
  }

  // Most urgent first: soonest next-step, then most past terms.
  out.sort((a, b) => (a.daysToNextStep ?? 9999) - (b.daysToNextStep ?? 9999) || b.daysPastTerms - a.daysPastTerms);
  return out.slice(0, 12);
}
