import "server-only";
import { and, eq, gte, lt, sql, desc, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, invoices, receipts, customers, employees, incentiveLedger, incentivePeriods, incentiveAudit } from "@/db/schema";

function monthBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  return {
    startDate: `${period}-01`,
    endDate: new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10),
    start: new Date(Date.UTC(y!, m! - 1, 1)),
    end: new Date(Date.UTC(y!, m!, 1)),
  };
}

// ── Leaderboard — ranked on QUALIFYING ACTIVITY (collections, new customers),
//    not raw pay (per the brief's caution about publishing colleagues' pay). ──
export interface LeaderRow {
  employeeId: string;
  name: string;
  collectedPaise: number;
  newCustomers: number;
  incentivePaise: number;
}

export async function getLeaderboard(period: string): Promise<LeaderRow[]> {
  const { startDate, endDate, start, end } = monthBounds(period);

  const collected = await db
    .select({ owner: salesOrders.ownerId, total: sql<number>`coalesce(sum(${receipts.amountPaise}),0)::bigint` })
    .from(receipts)
    .innerJoin(invoices, eq(receipts.invoiceId, invoices.id))
    .innerJoin(salesOrders, eq(invoices.orderId, salesOrders.id))
    .where(and(gte(receipts.receivedAt, startDate), lt(receipts.receivedAt, endDate)))
    .groupBy(salesOrders.ownerId);

  const newCust = await db
    .select({ owner: customers.acquisitionEmployeeId, n: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(gte(customers.firstTransactionAt, start), lt(customers.firstTransactionAt, end)))
    .groupBy(customers.acquisitionEmployeeId);

  const incentive = await db
    .select({ emp: incentiveLedger.employeeId, total: sql<number>`coalesce(sum(${incentiveLedger.amountPaise}),0)::bigint` })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .where(eq(incentivePeriods.month, period))
    .groupBy(incentiveLedger.employeeId);

  const ids = new Set<string>();
  const colBy = new Map<string, number>();
  for (const r of collected) if (r.owner) { colBy.set(r.owner, Number(r.total)); ids.add(r.owner); }
  const ncBy = new Map<string, number>();
  for (const r of newCust) if (r.owner) { ncBy.set(r.owner, r.n); ids.add(r.owner); }
  const incBy = new Map<string, number>();
  for (const r of incentive) { incBy.set(r.emp, Number(r.total)); ids.add(r.emp); }

  if (ids.size === 0) return [];
  const names = await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, [...ids]));
  const nameBy = new Map(names.map((n) => [n.id, n.name]));

  return [...ids]
    .map((id) => ({ employeeId: id, name: nameBy.get(id) ?? "—", collectedPaise: colBy.get(id) ?? 0, newCustomers: ncBy.get(id) ?? 0, incentivePaise: incBy.get(id) ?? 0 }))
    .sort((a, b) => b.collectedPaise - a.collectedPaise || b.newCustomers - a.newCustomers);
}

// ── Analytics ────────────────────────────────────────────────────────────────
export interface AdminAnalytics {
  byMonth: { period: string; totalPaise: number }[];
  byCategory: { category: string; totalPaise: number }[];
  totalIncentivePaise: number;
  totalCollectedPaise: number;
  costPct: number; // incentive as % of collected sales
}

const CAT_ORDER = ["A", "B", "C", "D", "E", "F"];

export async function getAdminAnalytics(period: string): Promise<AdminAnalytics> {
  const { startDate, endDate } = monthBounds(period);

  const byMonthRows = await db
    .select({ period: incentivePeriods.month, total: sql<number>`coalesce(sum(${incentiveLedger.amountPaise}),0)::bigint` })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .groupBy(incentivePeriods.month)
    .orderBy(desc(incentivePeriods.month))
    .limit(6);

  const byCatRows = await db
    .select({ category: incentiveLedger.category, total: sql<number>`coalesce(sum(${incentiveLedger.amountPaise}),0)::bigint` })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .where(eq(incentivePeriods.month, period))
    .groupBy(incentiveLedger.category);

  const [collectedRow] = await db
    .select({ total: sql<number>`coalesce(sum(${receipts.amountPaise}),0)::bigint` })
    .from(receipts)
    .where(and(gte(receipts.receivedAt, startDate), lt(receipts.receivedAt, endDate)));

  const totalIncentivePaise = byCatRows.reduce((s, r) => s + Number(r.total), 0);
  const totalCollectedPaise = Number(collectedRow?.total ?? 0);
  const catBy = new Map(byCatRows.map((r) => [r.category, Number(r.total)]));

  return {
    byMonth: byMonthRows.map((r) => ({ period: r.period, totalPaise: Number(r.total) })).reverse(),
    byCategory: CAT_ORDER.map((category) => ({ category, totalPaise: catBy.get(category) ?? 0 })),
    totalIncentivePaise,
    totalCollectedPaise,
    costPct: totalCollectedPaise > 0 ? (totalIncentivePaise / totalCollectedPaise) * 100 : 0,
  };
}

// ── Rep profile ──────────────────────────────────────────────────────────────
export interface RepCustomer { id: string; name: string; deals: number; }
export async function getRepCustomers(employeeId: string): Promise<RepCustomer[]> {
  const rows = await db
    .select({ id: customers.id, name: customers.name, deals: sql<number>`count(${salesOrders.id})::int` })
    .from(customers)
    .leftJoin(salesOrders, eq(salesOrders.customerId, customers.id))
    .where(eq(customers.acquisitionEmployeeId, employeeId))
    .groupBy(customers.id, customers.name)
    .orderBy(desc(sql`count(${salesOrders.id})`));
  return rows.map((r) => ({ id: r.id, name: r.name, deals: r.deals }));
}

export interface RepAuditRow { actor: string | null; action: string; entityType: string; detail: Record<string, unknown>; at: Date; }
export async function getRepAudit(employeeId: string, limit = 20): Promise<RepAuditRow[]> {
  const rows = await db
    .select({ actor: employees.name, action: incentiveAudit.action, entityType: incentiveAudit.entityType, detail: incentiveAudit.detail, at: incentiveAudit.createdAt })
    .from(incentiveAudit)
    .leftJoin(employees, eq(incentiveAudit.actorId, employees.id))
    .where(or(eq(incentiveAudit.employeeId, employeeId), eq(incentiveAudit.actorId, employeeId)))
    .orderBy(desc(incentiveAudit.createdAt))
    .limit(limit);
  return rows.map((r) => ({ actor: r.actor, action: r.action, entityType: r.entityType, detail: (r.detail ?? {}) as Record<string, unknown>, at: r.at }));
}

// ── Per-employee ledger lines for the admin drill-down drawer ────────────────
export interface EmpLedgerLine { lineCode: string; category: string; amountPaise: number; explanation: string | null }

export async function getPeriodLedgerByEmployee(period: string): Promise<Record<string, EmpLedgerLine[]>> {
  const rows = await db
    .select({ emp: incentiveLedger.employeeId, lineCode: incentiveLedger.ruleLineCode, category: incentiveLedger.category, amountPaise: incentiveLedger.amountPaise, explanation: incentiveLedger.explanation })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .where(eq(incentivePeriods.month, period))
    .orderBy(incentiveLedger.ruleLineCode);
  const out: Record<string, EmpLedgerLine[]> = {};
  for (const r of rows) {
    (out[r.emp] ??= []).push({ lineCode: r.lineCode, category: r.category, amountPaise: r.amountPaise, explanation: r.explanation });
  }
  return out;
}
