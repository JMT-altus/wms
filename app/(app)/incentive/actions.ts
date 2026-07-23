"use server";

import { revalidatePath } from "next/cache";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth/current";
import { leadBatches, leadConversions, clientMeetings, testimonials, salesOrders, customers, invoices, receipts, incentivePeriods, payoutRuns } from "@/db/schema";
import { currentPeriodIST, getPeriodPayout } from "@/lib/queries/incentives";
import { P } from "@/lib/incentives";
import { computePeriodForEmployee, ensurePeriod } from "@/lib/incentives/load";

type OrderCat = "A" | "B" | "C" | "N" | "I" | "R" | "V";
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (isoDate: string, days: number) => new Date(new Date(isoDate).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export type ActionResult = { ok: true } | { ok: false; error: string };

const clampInt = (v: unknown, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// ── Employee submissions (enter pending review) ──────────────────────────────

export async function submitLeadBatch(input: { leadCount: number; profiled: boolean }): Promise<ActionResult> {
  const me = await requireUser();
  const leadCount = clampInt(input.leadCount, 0, 100000);
  if (leadCount < 1) return { ok: false, error: "Enter how many leads." };
  await db.insert(leadBatches).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), leadCount, profiled: !!input.profiled,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

export async function submitLeadConversion(input: { convertedCount: number }): Promise<ActionResult> {
  const me = await requireUser();
  const convertedCount = clampInt(input.convertedCount, 0, 100000);
  if (convertedCount < 1) return { ok: false, error: "Enter how many enquiries." };
  await db.insert(leadConversions).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), convertedCount,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

export async function submitMeeting(input: {
  potentialBand: "low" | "medium" | "high";
  justification: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const band = ["low", "medium", "high"].includes(input.potentialBand) ? input.potentialBand : "medium";
  const justification = String(input.justification ?? "").slice(0, 500);
  if (!justification.trim()) return { ok: false, error: "Add a short justification." };
  await db.insert(clientMeetings).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), potentialBand: band, justification,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

export async function submitTestimonial(input: {
  kind: "google_review" | "email" | "letterhead";
  wordCount: number;
  starRating?: number;
  namesTeamMember: boolean;
  evidenceUrl?: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const kind = ["google_review", "email", "letterhead"].includes(input.kind) ? input.kind : "email";
  const wordCount = clampInt(input.wordCount, 0, 100000);
  const starRating = input.starRating != null ? clampInt(input.starRating, 1, 5) : null;
  if (kind === "google_review" && starRating !== 5) return { ok: false, error: "Only 5★ reviews qualify." };
  await db.insert(testimonials).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), kind, wordCount,
    starRating, namesTeamMember: !!input.namesTeamMember, evidenceUrl: input.evidenceUrl?.slice(0, 500) ?? null,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

// ── Admin data ingestion (commercial spine) ─────────────────────────────────

/**
 * Record a sale: find-or-create customer, then order + invoice (+ optional
 * receipt). A salesperson logs their own deal (owner forced to self); an admin
 * may log on behalf of any employee via ownerEmployeeId.
 */
export async function recordSale(input: {
  customerName: string;
  ownerEmployeeId?: string;
  categoryCode: OrderCat;
  amountRupees: number;
  invoiceNo?: string;
  invoiceDate: string;
  termsDays: number;
  isNewCustomer?: boolean;
  paidAmountRupees?: number;
  paidDate?: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const owner = me.isAdmin && input.ownerEmployeeId ? input.ownerEmployeeId : me.id;
  const name = String(input.customerName ?? "").trim().slice(0, 160);
  if (!name) return { ok: false, error: "Customer name is required." };
  if (!/^[0-9a-f-]{36}$/i.test(owner)) return { ok: false, error: "Pick a sales owner." };
  const cat: OrderCat = (["A", "B", "C", "N", "I", "R", "V"] as const).includes(input.categoryCode) ? input.categoryCode : "A";
  const amountPaise = P(clampInt(input.amountRupees, 0, 1_00_00_00_00));
  if (amountPaise <= 0) return { ok: false, error: "Enter the order amount." };
  if (!isDate(input.invoiceDate)) return { ok: false, error: "Invoice date must be YYYY-MM-DD." };
  const termsDays = clampInt(input.termsDays, 0, 365);
  const dueDate = addDays(input.invoiceDate, termsDays);

  let [cust] = await db.select().from(customers).where(eq(customers.name, name)).limit(1);
  if (!cust) {
    [cust] = await db
      .insert(customers)
      .values({
        name,
        acquisitionEmployeeId: input.isNewCustomer ? owner : null,
        isNewCustomer: !!input.isNewCustomer,
        firstTransactionAt: new Date(input.invoiceDate),
      })
      .returning();
  }
  await db.update(customers)
    .set({ fyTurnoverPaise: (cust!.fyTurnoverPaise ?? 0) + amountPaise, updatedAt: new Date() })
    .where(eq(customers.id, cust!.id));

  const [order] = await db.insert(salesOrders).values({
    customerId: cust!.id, ownerId: owner, orderValuePaise: amountPaise,
    categoryCode: cat, bookedAt: new Date(input.invoiceDate),
  }).returning();
  const [inv] = await db.insert(invoices).values({
    orderId: order!.id, invoiceNo: input.invoiceNo?.slice(0, 60) || null,
    invoiceValuePaise: amountPaise, invoiceDate: input.invoiceDate, agreedTermsDays: termsDays, dueDate,
  }).returning();

  const paid = P(clampInt(input.paidAmountRupees ?? 0, 0, 1_00_00_00_00));
  if (paid > 0) {
    await db.insert(receipts).values({
      invoiceId: inv!.id, amountPaise: paid, receivedAt: isDate(input.paidDate) ? input.paidDate : input.invoiceDate,
    });
  }
  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true };
}

/** Record a collection against an existing invoice (by its number). */
export async function recordReceipt(input: { invoiceNo: string; amountRupees: number; receivedAt: string }): Promise<ActionResult> {
  await requireAdmin();
  const invNo = String(input.invoiceNo ?? "").trim();
  if (!invNo) return { ok: false, error: "Invoice number is required." };
  const [inv] = await db.select().from(invoices).where(eq(invoices.invoiceNo, invNo)).limit(1);
  if (!inv) return { ok: false, error: "No invoice found with that number." };
  const amt = P(clampInt(input.amountRupees, 0, 1_00_00_00_00));
  if (amt <= 0) return { ok: false, error: "Enter the amount received." };
  await db.insert(receipts).values({
    invoiceId: inv.id, amountPaise: amt, receivedAt: isDate(input.receivedAt) ? input.receivedAt : new Date().toISOString().slice(0, 10),
  });
  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true };
}

// ── Admin verification ───────────────────────────────────────────────────────

type Queue = "lead_batch" | "lead_conversion" | "meeting" | "testimonial";

export async function reviewSubmission(input: {
  queue: Queue;
  id: string;
  decision: "approved" | "rejected";
  awardedRupees?: number; // meetings only
  namesTeamMember?: boolean; // testimonials only
  note?: string;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, error: "Invalid id" };
  const decision = input.decision === "approved" ? "approved" : "rejected";
  const base = { reviewStatus: decision as "approved" | "rejected", reviewedById: me.id, reviewedAt: new Date(), note: input.note?.slice(0, 500) ?? null, updatedAt: new Date() };

  switch (input.queue) {
    case "lead_batch":
      await db.update(leadBatches).set(base).where(eq(leadBatches.id, input.id));
      break;
    case "lead_conversion":
      await db.update(leadConversions).set(base).where(eq(leadConversions.id, input.id));
      break;
    case "meeting": {
      const awarded = P(clampInt(input.awardedRupees, 0, 1000));
      await db.update(clientMeetings).set({ ...base, awardedPaise: awarded }).where(eq(clientMeetings.id, input.id));
      break;
    }
    case "testimonial":
      await db.update(testimonials).set({ ...base, namesTeamMember: !!input.namesTeamMember }).where(eq(testimonials.id, input.id));
      break;
    default:
      return { ok: false, error: "Unknown queue" };
  }
  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true };
}

/** Period lifecycle: open → review → locked → paid. Admin-driven. */
export async function setPeriodStatus(input: {
  period?: string;
  status: "open" | "review" | "locked" | "paid";
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const period = input.period ?? currentPeriodIST();
  const status = (["open", "review", "locked", "paid"] as const).includes(input.status) ? input.status : "review";
  const periodId = await ensurePeriod(period);

  await db.update(incentivePeriods)
    .set({ status, lockedById: status === "locked" || status === "paid" ? me.id : null, lockedAt: status === "locked" || status === "paid" ? new Date() : null, updatedAt: new Date() })
    .where(eq(incentivePeriods.id, periodId));

  if (status === "paid") {
    const payout = await getPeriodPayout(period);
    await db.insert(payoutRuns).values({ periodId, totalPaise: payout.grandTotalPaise, createdById: me.id, pushedToPayrollAt: new Date() });
  }
  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true };
}

/**
 * Recompute the ledger for a period across every employee with orders or
 * approved activity in it. This is the "COMPUTE" step: run the pure engine and
 * upsert accrual rows idempotently, so approvals and new sales become payable.
 */
export async function recomputePeriod(input?: { period?: string }): Promise<{ ok: true; employees: number } | { ok: false; error: string }> {
  await requireAdmin();
  const period = input?.period ?? currentPeriodIST();

  const ids = new Set<string>();
  const owners = await db.selectDistinct({ id: salesOrders.ownerId }).from(salesOrders).where(isNotNull(salesOrders.ownerId));
  for (const o of owners) if (o.id) ids.add(o.id);

  const [lb, lc, mt, ts] = await Promise.all([
    db.selectDistinct({ id: leadBatches.employeeId }).from(leadBatches).where(eq(leadBatches.periodMonth, period)),
    db.selectDistinct({ id: leadConversions.employeeId }).from(leadConversions).where(eq(leadConversions.periodMonth, period)),
    db.selectDistinct({ id: clientMeetings.employeeId }).from(clientMeetings).where(eq(clientMeetings.periodMonth, period)),
    db.selectDistinct({ id: testimonials.employeeId }).from(testimonials).where(eq(testimonials.periodMonth, period)),
  ]);
  for (const r of [...lb, ...lc, ...mt, ...ts]) ids.add(r.id);

  const asOf = new Date();
  for (const id of ids) await computePeriodForEmployee(id, period, asOf);

  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true, employees: ids.size };
}
