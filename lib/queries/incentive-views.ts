import "server-only";
import { and, eq, gte, lt, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salesOrders, invoices, receipts, customers,
  leadBatches, leadConversions, clientMeetings, testimonials,
  incentiveLedger, incentivePeriods,
} from "@/db/schema";
import { decayMultiplier } from "@/lib/incentives";
import { SALES_BH_SCHEME } from "@/lib/incentives";

const DAY = 86_400_000;
const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);

// ── My Sales (tracking table) ────────────────────────────────────────────────
export interface ReceiptRow { amountPaise: number; receivedAt: string }
export interface SaleRow {
  invoiceId: string;
  bookedAt: string;
  category: string;
  customer: string;
  invoiceNo: string | null;
  valuePaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  daysPastTerms: number;
  termsDays: number;
  dueDate: string;
  multiplier: number;
  status: "collected" | "partial" | "overdue" | "due";
  receipts: ReceiptRow[];
}

export async function getMySales(employeeId: string, asOf: Date = new Date()): Promise<SaleRow[]> {
  const rows = await db
    .select({
      invoiceId: invoices.id, invoiceNo: invoices.invoiceNo, valuePaise: invoices.invoiceValuePaise,
      invoiceDate: invoices.invoiceDate, terms: invoices.agreedTermsDays, dueDate: invoices.dueDate,
      bookedAt: salesOrders.bookedAt, category: salesOrders.categoryCode, customer: customers.name,
    })
    .from(invoices)
    .innerJoin(salesOrders, eq(invoices.orderId, salesOrders.id))
    .innerJoin(customers, eq(salesOrders.customerId, customers.id))
    .where(eq(salesOrders.ownerId, employeeId))
    .orderBy(desc(salesOrders.bookedAt));

  const invIds = rows.map((r) => r.invoiceId);
  const recs = invIds.length ? await db.select().from(receipts).where(inArray(receipts.invoiceId, invIds)) : [];
  const paidBy = new Map<string, number>();
  const recsBy = new Map<string, ReceiptRow[]>();
  for (const r of recs) {
    paidBy.set(r.invoiceId, (paidBy.get(r.invoiceId) ?? 0) + r.amountPaise);
    const arr = recsBy.get(r.invoiceId) ?? [];
    arr.push({ amountPaise: r.amountPaise, receivedAt: String(r.receivedAt) });
    recsBy.set(r.invoiceId, arr);
  }

  return rows.map((r) => {
    const collected = paidBy.get(r.invoiceId) ?? 0;
    const outstanding = r.valuePaise - collected;
    const due = r.dueDate ? new Date(r.dueDate) : new Date(new Date(r.invoiceDate).getTime() + r.terms * DAY);
    const daysPastTerms = Math.max(0, dayDiff(asOf, due));
    const multiplier = decayMultiplier(daysPastTerms, SALES_BH_SCHEME.decaySteps);
    const status: SaleRow["status"] =
      outstanding <= 0 ? "collected" : daysPastTerms > 45 ? "overdue" : collected > 0 ? "partial" : "due";
    return {
      invoiceId: r.invoiceId, bookedAt: String(r.invoiceDate), category: r.category, customer: r.customer,
      invoiceNo: r.invoiceNo, valuePaise: r.valuePaise, collectedPaise: collected,
      outstandingPaise: Math.max(0, outstanding), daysPastTerms, termsDays: r.terms,
      dueDate: r.dueDate ? String(r.dueDate) : due.toISOString().slice(0, 10),
      multiplier, status,
      receipts: (recsBy.get(r.invoiceId) ?? []).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
    };
  });
}

/** Total booked sales (paise) for an employee in a period — for the Go-Get nudge. */
export async function getMonthlySales(employeeId: string, period: string): Promise<number> {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${salesOrders.orderValuePaise}), 0)::bigint` })
    .from(salesOrders)
    .where(and(eq(salesOrders.ownerId, employeeId), gte(salesOrders.bookedAt, start), lt(salesOrders.bookedAt, end)));
  return Number(row?.total ?? 0);
}

// ── My Activity (submissions with status) ────────────────────────────────────
export interface ActivityRow {
  type: "Leads" | "Enquiries" | "Meeting" | "Review";
  summary: string;
  status: "pending" | "approved" | "rejected";
  period: string;
}

export async function getMyActivity(employeeId: string): Promise<ActivityRow[]> {
  const [lb, lc, mt, ts] = await Promise.all([
    db.select().from(leadBatches).where(eq(leadBatches.employeeId, employeeId)).orderBy(desc(leadBatches.createdAt)),
    db.select().from(leadConversions).where(eq(leadConversions.employeeId, employeeId)).orderBy(desc(leadConversions.createdAt)),
    db.select().from(clientMeetings).where(eq(clientMeetings.employeeId, employeeId)).orderBy(desc(clientMeetings.createdAt)),
    db.select().from(testimonials).where(eq(testimonials.employeeId, employeeId)).orderBy(desc(testimonials.createdAt)),
  ]);
  const items: ActivityRow[] = [
    ...lb.map((r) => ({ type: "Leads" as const, summary: `${r.leadCount} profiled leads`, status: r.reviewStatus, period: r.periodMonth })),
    ...lc.map((r) => ({ type: "Enquiries" as const, summary: `${r.convertedCount} converted to enquiry`, status: r.reviewStatus, period: r.periodMonth })),
    ...mt.map((r) => ({ type: "Meeting" as const, summary: `${r.potentialBand ?? "—"} potential · ${r.justification ?? ""}`.slice(0, 90), status: r.reviewStatus, period: r.periodMonth })),
    ...ts.map((r) => ({ type: "Review" as const, summary: `${r.kind} · ${r.wordCount} words`, status: r.reviewStatus, period: r.periodMonth })),
  ];
  return items;
}

// ── My History (earnings by month) ───────────────────────────────────────────
export interface HistoryRow { period: string; totalPaise: number; status: string; }

export async function getMyHistory(employeeId: string): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      period: incentivePeriods.month, status: incentivePeriods.status,
      total: sql<number>`sum(${incentiveLedger.amountPaise})::bigint`,
    })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .where(eq(incentiveLedger.employeeId, employeeId))
    .groupBy(incentivePeriods.month, incentivePeriods.status)
    .orderBy(desc(incentivePeriods.month));
  return rows.map((r) => ({ period: r.period, totalPaise: Number(r.total), status: r.status }));
}
