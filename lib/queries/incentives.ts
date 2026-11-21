import "server-only";
import { and, eq, ne, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authoritativeCategories, newCategoryACovered, newEngineAuthoritative } from "@/lib/incentives/load";
import { incentiveLedger, incentivePeriods, payoutRuns, leadBatches, leadConversions, clientMeetings, testimonials, employees, salesOrders, customers, invoices } from "@/db/schema";
import { SALES_BH_SCHEME } from "@/lib/incentives";
import { fmtMonth } from "@/lib/dates";

export interface PendingSale { orderId: string; invoiceId: string | null; customer: string; owner: string; category: string; valuePaise: number; bookedAt: string; }

/** Rep-logged sales awaiting admin confirmation before they count. */
export async function getPendingSales(): Promise<PendingSale[]> {
  const rows = await db
    .select({ orderId: salesOrders.id, invoiceId: invoices.id, customer: customers.name, owner: employees.name, category: salesOrders.categoryCode, valuePaise: salesOrders.orderValuePaise, bookedAt: salesOrders.bookedAt })
    .from(salesOrders)
    .innerJoin(customers, eq(salesOrders.customerId, customers.id))
    .leftJoin(employees, eq(salesOrders.ownerId, employees.id))
    .leftJoin(invoices, eq(invoices.orderId, salesOrders.id))
    .where(eq(salesOrders.confirmed, false))
    .orderBy(desc(salesOrders.bookedAt));
  return rows.map((r) => ({ orderId: r.orderId, invoiceId: r.invoiceId, customer: r.customer, owner: r.owner ?? "—", category: r.category, valuePaise: r.valuePaise, bookedAt: String(r.bookedAt).slice(0, 10) }));
}

export interface IncentiveLine {
  lineCode: string;
  category: string;
  amountPaise: number;
  explanation: string | null;
  entryType: string;
}

export interface CategoryMeta {
  code: string;
  label: string;
  earnedPaise: number;
  capPaise: number;
}

export interface IncentiveSummary {
  period: string;
  status: string;
  totalPaise: number;
  schemeCapPaise: number;
  categories: CategoryMeta[];
  lines: IncentiveLine[];
}

const CATEGORY_LABELS: Record<string, string> = {
  // Category A from THIS (old) engine is historical: the new Category A engine is authoritative (Incentive Tracker →
  // Category A; a salesperson's approved amounts appear on My Incentives).
  A: "Sales Slabs — historical (old engine)",
  B: "Cross-sell",
  C: "New Customer",
  D: "Leads & Enquiries",
  E: "Client Meetings",
  F: "Reviews & Testimonials",
};

/** Current period ("YYYY-MM") in IST — the team's local month. */
export function currentPeriodIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .slice(0, 7);
}

/** "2026-07" → "JUL 2026". */
export function periodLabel(period: string): string {
  return fmtMonth(period).toUpperCase();
}

export interface PayoutRow { employeeId: string; employeeName: string; totalPaise: number; }
export interface PeriodPayout {
  period: string;
  status: string;
  grandTotalPaise: number;
  rows: PayoutRow[];
  /**
   * For a PAID month: what its payout run(s) recorded, and what its ledger holds (every category, as recorded). When
   * they differ the month is shown as a historical old-engine record with that difference; nothing is recalculated,
   * repaired or changed (e.g. the seeded July 2026 month).
   */
  recordedPayoutPaise: number | null;
  ledgerRecordedPaise: number | null;
}

/** Per-employee payout totals for a period (for review / lock / payout). */
export async function getPeriodPayout(period: string): Promise<PeriodPayout> {
  // Where the new Category A engine is authoritative for the month, Category A is paid through it (Incentive
  // Tracker → Category A Approvals), never here: this old payout then covers Categories B–G only — nothing twice.
  // …for the people a published Category A version covers that month (everyone else's Category A is still paid here).
  const coveredA = [...((await newCategoryACovered(period)) ?? [])];
  // The same for Category B from its published configuration's cut-over month (Incentive Tracker → Category B).
  const newB = await newEngineAuthoritative("B", period);
  const newer = [...(await authoritativeCategories(period))].filter((c) => ["C", "D", "E", "F"].includes(c));
  const [prow] = await db.select({ status: incentivePeriods.status }).from(incentivePeriods).where(eq(incentivePeriods.month, period)).limit(1);
  const rows = await db
    .select({
      employeeId: incentiveLedger.employeeId,
      employeeName: employees.name,
      totalPaise: sql<number>`sum(${incentiveLedger.amountPaise})::bigint`,
    })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .innerJoin(employees, eq(incentiveLedger.employeeId, employees.id))
    .where(and(eq(incentivePeriods.month, period), ...(coveredA.length ? [sql`not (${incentiveLedger.category} = 'A' and ${incentiveLedger.employeeId} in (${sql.join(coveredA.map((id) => sql`${id}`), sql`, `)}))`] : []), ...(newB ? [ne(incentiveLedger.category, "B")] : []), ...newer.map((c) => ne(incentiveLedger.category, c))))
    .groupBy(incentiveLedger.employeeId, employees.name);

  const mapped = rows
    .map((r) => ({ employeeId: r.employeeId, employeeName: r.employeeName, totalPaise: Number(r.totalPaise) }))
    .filter((r) => r.totalPaise > 0)
    .sort((a, b) => b.totalPaise - a.totalPaise);
  let recordedPayoutPaise: number | null = null;
  let ledgerRecordedPaise: number | null = null;
  if (prow?.status === "paid") {
    const [run] = await db.select({ t: sql<number>`coalesce(sum(${payoutRuns.totalPaise}), 0)::bigint` }).from(payoutRuns).innerJoin(incentivePeriods, eq(payoutRuns.periodId, incentivePeriods.id)).where(eq(incentivePeriods.month, period));
    const all = await db
      .select({ t: sql<number>`sum(${incentiveLedger.amountPaise})::bigint` })
      .from(incentiveLedger)
      .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
      .where(eq(incentivePeriods.month, period))
      .groupBy(incentiveLedger.employeeId);
    recordedPayoutPaise = Number(run?.t ?? 0);
    ledgerRecordedPaise = all.map((r) => Number(r.t)).filter((t) => t > 0).reduce((s, t) => s + t, 0);
  }
  return {
    period,
    status: prow?.status ?? "open",
    grandTotalPaise: mapped.reduce((s, r) => s + r.totalPaise, 0),
    rows: mapped,
    recordedPayoutPaise,
    ledgerRecordedPaise,
  };
}

export type PendingQueue = "lead_batch" | "lead_conversion" | "meeting" | "testimonial";
export interface PendingItem {
  queue: PendingQueue;
  id: string;
  employeeName: string;
  period: string;
  summary: string;
  needsAward?: boolean;   // meetings
  namesTeamMember?: boolean; // testimonials
}

/** Everything awaiting admin verification, newest first. */
export async function getPendingSubmissions(): Promise<PendingItem[]> {
  const [lb, lc, mt, ts] = await Promise.all([
    db.select({ id: leadBatches.id, name: employees.name, period: leadBatches.periodMonth, count: leadBatches.leadCount, profiled: leadBatches.profiled, at: leadBatches.createdAt })
      .from(leadBatches).innerJoin(employees, eq(leadBatches.employeeId, employees.id))
      .where(eq(leadBatches.reviewStatus, "pending")).orderBy(desc(leadBatches.createdAt)),
    db.select({ id: leadConversions.id, name: employees.name, period: leadConversions.periodMonth, count: leadConversions.convertedCount, at: leadConversions.createdAt })
      .from(leadConversions).innerJoin(employees, eq(leadConversions.employeeId, employees.id))
      .where(eq(leadConversions.reviewStatus, "pending")).orderBy(desc(leadConversions.createdAt)),
    db.select({ id: clientMeetings.id, name: employees.name, period: clientMeetings.periodMonth, band: clientMeetings.potentialBand, note: clientMeetings.justification, at: clientMeetings.createdAt })
      .from(clientMeetings).innerJoin(employees, eq(clientMeetings.employeeId, employees.id))
      .where(eq(clientMeetings.reviewStatus, "pending")).orderBy(desc(clientMeetings.createdAt)),
    db.select({ id: testimonials.id, name: sql<string>`coalesce(${employees.name}, ${testimonials.employeeName}, 'Former employee')`, period: testimonials.periodMonth, kind: testimonials.kind, words: testimonials.wordCount, names: testimonials.namesTeamMember, url: testimonials.evidenceUrl, at: testimonials.createdAt })
      .from(testimonials).leftJoin(employees, eq(testimonials.employeeId, employees.id))
      .where(eq(testimonials.reviewStatus, "pending")).orderBy(desc(testimonials.createdAt)),
  ]);

  const items: PendingItem[] = [
    ...lb.map((r) => ({ queue: "lead_batch" as const, id: r.id, employeeName: r.name, period: r.period, summary: `${r.count} leads${r.profiled ? " · profiled" : " · NOT profiled"}` })),
    ...lc.map((r) => ({ queue: "lead_conversion" as const, id: r.id, employeeName: r.name, period: r.period, summary: `${r.count} leads → enquiry` })),
    ...mt.map((r) => ({ queue: "meeting" as const, id: r.id, employeeName: r.name, period: r.period, summary: `${r.band ?? "—"} potential · ${r.note ?? ""}`, needsAward: true })),
    ...ts.map((r) => ({ queue: "testimonial" as const, id: r.id, employeeName: r.name, period: r.period, summary: `${r.kind} · ${r.words} words${r.url ? " · evidence ✓" : " · NO evidence"}`, namesTeamMember: r.names })),
  ];
  return items;
}

/** An employee's incentive summary for a period, read from the ledger. */
export async function getIncentiveSummary(employeeId: string, period: string): Promise<IncentiveSummary> {
  const rows = await db
    .select({
      lineCode: incentiveLedger.ruleLineCode,
      category: incentiveLedger.category,
      amountPaise: incentiveLedger.amountPaise,
      explanation: incentiveLedger.explanation,
      entryType: incentiveLedger.entryType,
      status: incentivePeriods.status,
    })
    .from(incentiveLedger)
    .innerJoin(incentivePeriods, eq(incentiveLedger.periodId, incentivePeriods.id))
    .where(and(eq(incentiveLedger.employeeId, employeeId), eq(incentivePeriods.month, period)))
    .orderBy(incentiveLedger.ruleLineCode);

  const byCategory: Record<string, number> = {};
  let totalPaise = 0;
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amountPaise;
    totalPaise += r.amountPaise;
  }

  // From Category B's cut-over month its old-engine lines are historical too (the new Category B is shown on its own).
  const newer = await authoritativeCategories(period);
  const categories: CategoryMeta[] = (["A", "B", "C", "D", "E", "F"] as const).map((code) => ({
    code,
    label: code !== "A" && newer.has(code) ? `${CATEGORY_LABELS[code]} — historical (old engine)` : CATEGORY_LABELS[code]!,
    earnedPaise: byCategory[code] ?? 0,
    capPaise: SALES_BH_SCHEME.categoryCaps[code],
  }));

  return {
    period,
    status: rows[0]?.status ?? "open",
    totalPaise,
    schemeCapPaise: SALES_BH_SCHEME.schemeMonthlyCapPaise,
    categories,
    lines: rows.map((r) => ({
      lineCode: r.lineCode,
      category: r.category,
      amountPaise: r.amountPaise,
      explanation: r.explanation,
      entryType: r.entryType,
    })),
  };
}
