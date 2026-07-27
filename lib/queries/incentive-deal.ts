import "server-only";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, invoices, receipts, customers, employees, incentiveLedger, incentivePeriods, incentiveAudit } from "@/db/schema";
import { decayMultiplier } from "@/lib/incentives";
import { SALES_BH_SCHEME } from "@/lib/incentives";

const DAY = 86_400_000;
const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);

export interface DealDetail {
  invoiceId: string;
  invoiceNo: string | null;
  category: string;
  customerId: string | null;
  customer: string;
  ownerId: string | null;
  owner: string;
  bookedAt: string;
  invoiceDate: string;
  dueDate: string;
  termsDays: number;
  period: string;
  valuePaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  daysPastTerms: number;
  multiplier: number;
  status: "collected" | "partial" | "overdue" | "due";
  confirmed: boolean;
  receipts: { amountPaise: number; receivedAt: string }[];
  drivesLines: { lineCode: string; category: string; amountPaise: number; explanation: string | null }[];
  drivesPaise: number;
  audit: { actor: string | null; action: string; detail: Record<string, unknown>; at: Date }[];
}

export async function getDealDetail(invoiceId: string): Promise<DealDetail | null> {
  const [row] = await db
    .select({
      invoiceNo: invoices.invoiceNo, valuePaise: invoices.invoiceValuePaise, invoiceDate: invoices.invoiceDate,
      terms: invoices.agreedTermsDays, dueDate: invoices.dueDate,
      category: salesOrders.categoryCode, ownerId: salesOrders.ownerId, bookedAt: salesOrders.bookedAt, confirmed: salesOrders.confirmed,
      customerId: customers.id, customer: customers.name, owner: employees.name,
    })
    .from(invoices)
    .innerJoin(salesOrders, eq(invoices.orderId, salesOrders.id))
    .innerJoin(customers, eq(salesOrders.customerId, customers.id))
    .leftJoin(employees, eq(salesOrders.ownerId, employees.id))
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!row) return null;

  const recs = (await db.select().from(receipts).where(eq(receipts.invoiceId, invoiceId)))
    .map((r) => ({ amountPaise: r.amountPaise, receivedAt: String(r.receivedAt) }))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const collected = recs.reduce((s, r) => s + r.amountPaise, 0);
  const outstanding = row.valuePaise - collected;
  const due = row.dueDate ? new Date(row.dueDate) : new Date(new Date(row.invoiceDate).getTime() + row.terms * DAY);
  const asOf = new Date();
  const daysPastTerms = Math.max(0, dayDiff(asOf, due));
  const multiplier = decayMultiplier(daysPastTerms, SALES_BH_SCHEME.decaySteps);
  const status: DealDetail["status"] = outstanding <= 0 ? "collected" : daysPastTerms > 45 ? "overdue" : collected > 0 ? "partial" : "due";
  const period = String(row.invoiceDate).slice(0, 7);

  // Which ledger lines this deal drives (B → its own line; C → its cohort; A/others → the month's slab).
  let drivesLines: DealDetail["drivesLines"] = [];
  if (row.ownerId) {
    const lines = await db
      .select({ lineCode: incentiveLedger.ruleLineCode, category: incentiveLedger.category, amountPaise: incentiveLedger.amountPaise, explanation: incentiveLedger.explanation, sourceRef: incentiveLedger.sourceRef })
      .from(incentiveLedger)
      .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
      .where(and(eq(incentiveLedger.employeeId, row.ownerId), eq(incentivePeriods.month, period)));
    const wants = (sr: string | null): boolean => {
      if (row.category === "B") return sr === `crosssell:${invoiceId}`;
      if (row.category === "C") return sr === `newcust:${row.customerId}`;
      return (sr ?? "").startsWith("slab:"); // A / N / I / R / V contribute to the monthly slab
    };
    drivesLines = lines.filter((l) => wants(l.sourceRef)).map(({ sourceRef: _s, ...l }) => l);
  }
  const drivesPaise = drivesLines.reduce((s, l) => s + l.amountPaise, 0);

  const auditRows = await db
    .select({ actor: employees.name, action: incentiveAudit.action, detail: incentiveAudit.detail, at: incentiveAudit.createdAt })
    .from(incentiveAudit)
    .leftJoin(employees, eq(incentiveAudit.actorId, employees.id))
    .where(and(eq(incentiveAudit.entityType, "invoice"), eq(incentiveAudit.entityId, invoiceId)))
    .orderBy(desc(incentiveAudit.createdAt));

  return {
    invoiceId, invoiceNo: row.invoiceNo, category: row.category, customerId: row.customerId, customer: row.customer,
    ownerId: row.ownerId, owner: row.owner ?? "—", bookedAt: String(row.bookedAt).slice(0, 10), invoiceDate: String(row.invoiceDate),
    dueDate: row.dueDate ? String(row.dueDate) : due.toISOString().slice(0, 10), termsDays: row.terms, period,
    valuePaise: row.valuePaise, collectedPaise: collected, outstandingPaise: Math.max(0, outstanding), daysPastTerms, multiplier, status, confirmed: row.confirmed,
    receipts: recs, drivesLines, drivesPaise,
    audit: auditRows.map((a) => ({ actor: a.actor, action: a.action, detail: (a.detail ?? {}) as Record<string, unknown>, at: a.at })),
  };
}
