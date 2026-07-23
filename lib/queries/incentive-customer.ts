import "server-only";
import { eq, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, invoices, receipts, customers, employees, incentiveLedger, incentivePeriods } from "@/db/schema";
import { decayMultiplier, SALES_BH_SCHEME } from "@/lib/incentives";

const DAY = 86_400_000;
const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);

export interface CustomerDeal {
  invoiceId: string; invoiceNo: string | null; category: string; valuePaise: number;
  outstandingPaise: number; daysPastTerms: number; multiplier: number; bookedAt: string;
  status: "collected" | "partial" | "overdue" | "due";
}
export interface CustomerDetail {
  customerId: string; name: string; code: string | null; ownerId: string | null; owner: string | null;
  isNewCustomer: boolean; firstTransactionAt: string | null; fyTurnoverPaise: number;
  lifetimePaise: number; dealCount: number; collectedPaise: number; outstandingPaise: number;
  avgDaysLate: number | null; incentiveGeneratedPaise: number; deals: CustomerDeal[];
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail | null> {
  const [cust] = await db
    .select({ id: customers.id, name: customers.name, code: customers.code, isNew: customers.isNewCustomer, firstTx: customers.firstTransactionAt, fy: customers.fyTurnoverPaise, ownerId: customers.acquisitionEmployeeId, owner: employees.name })
    .from(customers)
    .leftJoin(employees, eq(customers.acquisitionEmployeeId, employees.id))
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!cust) return null;

  const rows = await db
    .select({ invoiceId: invoices.id, invoiceNo: invoices.invoiceNo, valuePaise: invoices.invoiceValuePaise, invoiceDate: invoices.invoiceDate, terms: invoices.agreedTermsDays, dueDate: invoices.dueDate, category: salesOrders.categoryCode, bookedAt: salesOrders.bookedAt, ownerId: salesOrders.ownerId })
    .from(invoices)
    .innerJoin(salesOrders, eq(invoices.orderId, salesOrders.id))
    .where(eq(salesOrders.customerId, customerId))
    .orderBy(desc(salesOrders.bookedAt));

  const invIds = rows.map((r) => r.invoiceId);
  const recs = invIds.length ? await db.select().from(receipts).where(inArray(receipts.invoiceId, invIds)) : [];
  const paidBy = new Map<string, number>();
  const lastRecBy = new Map<string, string>();
  for (const r of recs) {
    paidBy.set(r.invoiceId, (paidBy.get(r.invoiceId) ?? 0) + r.amountPaise);
    const cur = lastRecBy.get(r.invoiceId);
    if (!cur || String(r.receivedAt) > cur) lastRecBy.set(r.invoiceId, String(r.receivedAt));
  }

  const asOf = new Date();
  let lifetime = 0, collected = 0, outstandingTotal = 0, ownerId: string | null = cust.ownerId;
  const lateDays: number[] = [];
  const deals: CustomerDeal[] = rows.map((r) => {
    lifetime += r.valuePaise;
    const paid = paidBy.get(r.invoiceId) ?? 0;
    collected += paid;
    const outstanding = r.valuePaise - paid;
    outstandingTotal += Math.max(0, outstanding);
    const due = r.dueDate ? new Date(r.dueDate) : new Date(new Date(r.invoiceDate).getTime() + r.terms * DAY);
    const daysPastTerms = Math.max(0, dayDiff(asOf, due));
    if (outstanding <= 0 && lastRecBy.has(r.invoiceId)) lateDays.push(Math.max(0, dayDiff(new Date(lastRecBy.get(r.invoiceId)!), due)));
    if (r.ownerId) ownerId = ownerId ?? r.ownerId;
    return {
      invoiceId: r.invoiceId, invoiceNo: r.invoiceNo, category: r.category, valuePaise: r.valuePaise,
      outstandingPaise: Math.max(0, outstanding), daysPastTerms,
      multiplier: decayMultiplier(daysPastTerms, SALES_BH_SCHEME.decaySteps), bookedAt: String(r.bookedAt).slice(0, 10),
      status: outstanding <= 0 ? "collected" : daysPastTerms > 45 ? "overdue" : paid > 0 ? "partial" : "due",
    };
  });

  // Incentive directly attributable to this customer (B on their invoices, C on their cohort).
  let incentiveGeneratedPaise = 0;
  if (ownerId) {
    const wantRefs = new Set<string>([`newcust:${customerId}`, ...invIds.map((id) => `crosssell:${id}`)]);
    const led = await db.select({ amountPaise: incentiveLedger.amountPaise, sourceRef: incentiveLedger.sourceRef }).from(incentiveLedger).where(eq(incentiveLedger.employeeId, ownerId));
    for (const l of led) if (l.sourceRef && wantRefs.has(l.sourceRef)) incentiveGeneratedPaise += l.amountPaise;
  }

  return {
    customerId, name: cust.name, code: cust.code, ownerId: cust.ownerId, owner: cust.owner,
    isNewCustomer: cust.isNew, firstTransactionAt: cust.firstTx ? String(cust.firstTx).slice(0, 10) : null, fyTurnoverPaise: cust.fy,
    lifetimePaise: lifetime, dealCount: rows.length, collectedPaise: collected, outstandingPaise: outstandingTotal,
    avgDaysLate: lateDays.length ? Math.round(lateDays.reduce((s, d) => s + d, 0) / lateDays.length) : null,
    incentiveGeneratedPaise, deals,
  };
}
