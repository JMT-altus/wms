"use server";

import { revalidatePath } from "next/cache";
import { eq, isNotNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth/current";
import { leadBatches, leadConversions, clientMeetings, testimonials, salesOrders, customers, invoices, receipts, incentivePeriods, payoutRuns, incentiveSchemes, ruleVersions, incentiveAudit } from "@/db/schema";
import { currentPeriodIST, getPeriodPayout } from "@/lib/queries/incentives";
import { P, CR, SALES_BH_SCHEME } from "@/lib/incentives";
import { computePeriodForEmployee, ensurePeriod } from "@/lib/incentives/load";

type OrderCat = "A" | "B" | "C" | "N" | "I" | "R" | "V";
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (isoDate: string, days: number) => new Date(new Date(isoDate).getTime() + days * 86_400_000).toISOString().slice(0, 10);

function revalidateIncentive() {
  for (const p of ["/incentive", "/incentive/sales", "/incentive/activity", "/incentive/history", "/incentive/admin"]) {
    revalidatePath(p);
  }
}

/** Append one audit event (who did what, to which entity, for whom). */
async function audit(actorId: string, action: string, entityType: string, entityId: string | null, employeeId: string | null, detail: Record<string, unknown> = {}) {
  try {
    await db.insert(incentiveAudit).values({ actorId, action, entityType, entityId, employeeId, detail });
  } catch { /* audit is best-effort; never block the primary action */ }
}

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
  revalidateIncentive();
  return { ok: true };
}

export async function submitLeadConversion(input: { convertedCount: number }): Promise<ActionResult> {
  const me = await requireUser();
  const convertedCount = clampInt(input.convertedCount, 0, 100000);
  if (convertedCount < 1) return { ok: false, error: "Enter how many enquiries." };
  await db.insert(leadConversions).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), convertedCount,
  });
  revalidateIncentive();
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
  revalidateIncentive();
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
  revalidateIncentive();
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
  await audit(me.id, "logged_sale", "invoice", inv!.id, owner, { customer: name, amountPaise, category: cat });
  await computePeriodForEmployee(owner, input.invoiceDate.slice(0, 7), new Date());
  revalidateIncentive();
  return { ok: true };
}

/**
 * Record a collection against an invoice (by id or number). A rep may record
 * on their own invoice; an admin on any. Auto-recomputes the owner's period.
 */
export async function recordReceipt(input: { invoiceId?: string; invoiceNo?: string; amountRupees: number; receivedAt: string }): Promise<ActionResult> {
  const me = await requireUser();
  let inv;
  if (input.invoiceId && /^[0-9a-f-]{36}$/i.test(input.invoiceId)) {
    [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  } else {
    const invNo = String(input.invoiceNo ?? "").trim();
    if (!invNo) return { ok: false, error: "Invoice id or number is required." };
    [inv] = await db.select().from(invoices).where(eq(invoices.invoiceNo, invNo)).limit(1);
  }
  if (!inv) return { ok: false, error: "No invoice found." };
  const [ord] = await db.select({ ownerId: salesOrders.ownerId, bookedAt: salesOrders.bookedAt }).from(salesOrders).where(eq(salesOrders.id, inv.orderId)).limit(1);
  if (!me.isAdmin && ord?.ownerId !== me.id) return { ok: false, error: "That invoice isn't yours." };
  const amt = P(clampInt(input.amountRupees, 0, 1_00_00_00_00));
  if (amt <= 0) return { ok: false, error: "Enter the amount received." };
  const receivedAt = isDate(input.receivedAt) ? input.receivedAt : new Date().toISOString().slice(0, 10);
  await db.insert(receipts).values({ invoiceId: inv.id, amountPaise: amt, receivedAt });
  await audit(me.id, "recorded_payment", "invoice", inv.id, ord?.ownerId ?? null, { amountPaise: amt, receivedAt });
  if (ord?.ownerId) await computePeriodForEmployee(ord.ownerId, ord.bookedAt.toISOString().slice(0, 7), new Date());
  revalidateIncentive();
  return { ok: true };
}

/** Edit a logged sale (rep: own; admin: any). Recomputes the owner's period. */
export async function editSale(input: {
  invoiceId: string; customerName?: string; categoryCode?: OrderCat; amountRupees?: number; invoiceDate?: string; termsDays?: number;
}): Promise<ActionResult> {
  const me = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(input.invoiceId)) return { ok: false, error: "Invalid id" };
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Sale not found." };
  const [ord] = await db.select().from(salesOrders).where(eq(salesOrders.id, inv.orderId)).limit(1);
  if (!ord) return { ok: false, error: "Order not found." };
  if (!me.isAdmin && ord.ownerId !== me.id) return { ok: false, error: "That sale isn't yours." };

  const amountPaise = input.amountRupees != null ? P(clampInt(input.amountRupees, 0, 1_00_00_00_00)) : ord.orderValuePaise;
  const cat = input.categoryCode && (["A", "B", "C", "N", "I", "R", "V"] as const).includes(input.categoryCode) ? input.categoryCode : ord.categoryCode;
  const invoiceDate = isDate(input.invoiceDate) ? input.invoiceDate : inv.invoiceDate;
  const terms = input.termsDays != null ? clampInt(input.termsDays, 0, 365) : inv.agreedTermsDays;
  const dueDate = addDays(invoiceDate, terms);

  await db.update(salesOrders).set({ orderValuePaise: amountPaise, categoryCode: cat, bookedAt: new Date(invoiceDate), updatedAt: new Date() }).where(eq(salesOrders.id, ord.id));
  await db.update(invoices).set({ invoiceValuePaise: amountPaise, invoiceDate, agreedTermsDays: terms, dueDate, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  if (input.customerName?.trim() && ord.customerId) {
    await db.update(customers).set({ name: input.customerName.trim().slice(0, 160), updatedAt: new Date() }).where(eq(customers.id, ord.customerId));
  }
  await audit(me.id, "edited_sale", "invoice", inv.id, ord.ownerId, { amountPaise, category: cat, invoiceDate });
  if (ord.ownerId) await computePeriodForEmployee(ord.ownerId, invoiceDate.slice(0, 7), new Date());
  revalidateIncentive();
  return { ok: true };
}

/** Delete a logged sale (rep: own; admin: any). Removes order + invoices + receipts. */
export async function deleteSale(input: { invoiceId: string }): Promise<ActionResult> {
  const me = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(input.invoiceId)) return { ok: false, error: "Invalid id" };
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Sale not found." };
  const [ord] = await db.select().from(salesOrders).where(eq(salesOrders.id, inv.orderId)).limit(1);
  if (!ord) return { ok: false, error: "Order not found." };
  if (!me.isAdmin && ord.ownerId !== me.id) return { ok: false, error: "That sale isn't yours." };
  const period = inv.invoiceDate.slice(0, 7);
  await db.delete(salesOrders).where(eq(salesOrders.id, ord.id)); // cascades invoices + receipts
  await audit(me.id, "deleted_sale", "invoice", input.invoiceId, ord.ownerId, { invoiceNo: inv.invoiceNo });
  if (ord.ownerId) await computePeriodForEmployee(ord.ownerId, period, new Date());
  revalidateIncentive();
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

  let affected: { employeeId: string; periodMonth: string } | undefined;
  switch (input.queue) {
    case "lead_batch":
      await db.update(leadBatches).set(base).where(eq(leadBatches.id, input.id));
      [affected] = await db.select({ employeeId: leadBatches.employeeId, periodMonth: leadBatches.periodMonth }).from(leadBatches).where(eq(leadBatches.id, input.id)).limit(1);
      break;
    case "lead_conversion":
      await db.update(leadConversions).set(base).where(eq(leadConversions.id, input.id));
      [affected] = await db.select({ employeeId: leadConversions.employeeId, periodMonth: leadConversions.periodMonth }).from(leadConversions).where(eq(leadConversions.id, input.id)).limit(1);
      break;
    case "meeting": {
      const awarded = P(clampInt(input.awardedRupees, 0, 1000));
      await db.update(clientMeetings).set({ ...base, awardedPaise: awarded }).where(eq(clientMeetings.id, input.id));
      [affected] = await db.select({ employeeId: clientMeetings.employeeId, periodMonth: clientMeetings.periodMonth }).from(clientMeetings).where(eq(clientMeetings.id, input.id)).limit(1);
      break;
    }
    case "testimonial":
      await db.update(testimonials).set({ ...base, namesTeamMember: !!input.namesTeamMember }).where(eq(testimonials.id, input.id));
      [affected] = await db.select({ employeeId: testimonials.employeeId, periodMonth: testimonials.periodMonth }).from(testimonials).where(eq(testimonials.id, input.id)).limit(1);
      break;
    default:
      return { ok: false, error: "Unknown queue" };
  }
  if (affected) {
    await audit(me.id, decision === "approved" ? "approved" : "rejected", "submission", input.id, affected.employeeId, { queue: input.queue });
    await computePeriodForEmployee(affected.employeeId, affected.periodMonth, new Date());
  }
  revalidateIncentive();
  return { ok: true };
}

/**
 * Publish an edited scheme as a new immutable rule_version. Future recomputes
 * pick it up (getActiveSchemeConfig reads the latest). Values are in rupees /
 * percent at the edge; stored as paise / fractions.
 */
export async function publishScheme(input: {
  categoryCaps: { A: number; B: number; C: number; D: number; E: number; F: number };
  schemeMonthlyCap: number;
  slabRates: { a1: number; a2: number; a3: number }; // percent, e.g. 0.10
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const caps = input.categoryCaps;
  const config = {
    ...SALES_BH_SCHEME,
    slabBands: [
      { fromPaise: CR(1.0), toPaise: CR(1.2), rate: Math.max(0, input.slabRates.a1) / 100 },
      { fromPaise: CR(1.2), toPaise: CR(1.4), rate: Math.max(0, input.slabRates.a2) / 100 },
      { fromPaise: CR(1.4), toPaise: CR(1.6), rate: Math.max(0, input.slabRates.a3) / 100 },
    ],
    categoryCaps: {
      A: P(clampInt(caps.A, 0, 1_00_00_000)), B: P(clampInt(caps.B, 0, 1_00_00_000)),
      C: P(clampInt(caps.C, 0, 1_00_00_000)), D: P(clampInt(caps.D, 0, 1_00_00_000)),
      E: P(clampInt(caps.E, 0, 1_00_00_000)), F: P(clampInt(caps.F, 0, 1_00_00_000)), G: 0,
    },
    schemeMonthlyCapPaise: P(clampInt(input.schemeMonthlyCap, 0, 10_00_00_000)),
  };

  let [scheme] = await db.select().from(incentiveSchemes).limit(1);
  if (!scheme) [scheme] = await db.insert(incentiveSchemes).values({ name: "Sales BH", scopeRole: "sales_bh" }).returning();
  const [last] = await db.select({ v: ruleVersions.version }).from(ruleVersions).where(eq(ruleVersions.schemeId, scheme!.id)).orderBy(desc(ruleVersions.version)).limit(1);
  await db.insert(ruleVersions).values({ schemeId: scheme!.id, version: (last?.v ?? 0) + 1, config, publishedById: me.id, publishedAt: new Date() });
  revalidateIncentive();
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
  revalidateIncentive();
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

  revalidateIncentive();
  return { ok: true, employees: ids.size };
}
