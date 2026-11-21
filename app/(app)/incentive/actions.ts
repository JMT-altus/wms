"use server";

import { revalidatePath } from "next/cache";
import { eq, isNotNull, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth/current";
import { getFieldAccessFor } from "@/lib/auth/field-access";
import type { Employee } from "@/db/schema";
import { leadBatches, leadConversions, clientMeetings, testimonials, salesOrders, customers, invoices, receipts, incentivePeriods, payoutRuns, incentiveSchemes, ruleVersions, incentiveAudit } from "@/db/schema";
import { currentPeriodIST, getPeriodPayout } from "@/lib/queries/incentives";
import { P, CR, SALES_BH_SCHEME } from "@/lib/incentives";
import { authoritativeCategories, computePeriodForEmployee, ensurePeriod } from "@/lib/incentives/load";
import { wordsIn } from "@/lib/incentives/categories/f-url";
import { incentiveCalcFReady } from "@/lib/queries/incentive-calc-x";
import { checkClaim, registerTestimonial, screenshotRequired } from "@/lib/queries/incentive-f-review";

type OrderCat = "A" | "B" | "C" | "N" | "I" | "R" | "V";
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (isoDate: string, days: number) => new Date(new Date(isoDate).getTime() + days * 86_400_000).toISOString().slice(0, 10);

function revalidateIncentive() {
  for (const p of ["/incentive", "/incentive/sales", "/incentive/activity", "/incentive/history", "/incentive/admin"]) {
    revalidatePath(p);
  }
}

/** A locked/paid period is finalized — edits and deletions are rejected. */
async function isPeriodClosed(period: string): Promise<boolean> {
  const [p] = await db.select({ status: incentivePeriods.status }).from(incentivePeriods).where(eq(incentivePeriods.month, period)).limit(1);
  return p?.status === "locked" || p?.status === "paid";
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

/** The Field Permission that lets someone log their own activity for an earlier month (never a future one). */
const ACTIVITY_ANY_MONTH = "incentive.activity.anyMonth";

/** Whether a published Category F version (any programme) is in force for the month: the new engine settles it. Reads only. */
async function fPublishedFor(month: string): Promise<boolean> {
  const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  const r = await db.execute(sql`select exists (select 1 from incentive_config_versions v where v.category_code = 'F' and v.status = 'published' and v.effective_from <= ${month}::date and (v.effective_to is null or v.effective_to >= ${month}::date)) as yes`);
  return rowsOf<{ yes: boolean }>(r)[0]?.yes === true;
}

/** Whether the new engine's calculation of `category` for `month` has moved past "open" in any programme. Reads only. */
async function newEngineMonthClosed(category: "D" | "E" | "F", month: string): Promise<boolean> {
  const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  // Two statements: Postgres plans a whole statement first, so a missing table can't be guarded inside it.
  if (!rowsOf<{ ok: boolean }>(await db.execute(sql`select to_regclass('public.incentive_calc_periods') is not null as ok`))[0]?.ok) return false;
  const r = await db.execute(sql`select exists (select 1 from incentive_calc_periods where category_code = ${category} and month = ${`${month}-01`}::date and status <> 'open') as closed`);
  return rowsOf<{ closed: boolean }>(r)[0]?.closed === true;
}

/**
 * The month a submission belongs to: the current month, or — with the "Log activity for an earlier month" permission —
 * an earlier one. Never a future month, never a month the tracker has locked or paid, and never one whose category's
 * calculation is already locked, submitted, approved or paid (that would change a finalised month).
 */
async function activityMonth(me: Employee, requested: unknown, category: "D" | "E" | "F", opts: { newEngineSettles?: boolean } = {}): Promise<{ ok: true; month: string } | { ok: false; error: string }> {
  const current = currentPeriodIST();
  const month = requested === undefined || requested === null || requested === "" ? current : String(requested);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Choose the month (YYYY-MM)." };
  if (month > current) return { ok: false, error: "Activity can't be logged for a future month." };
  if (month !== current && (await getFieldAccessFor(me))[ACTIVITY_ANY_MONTH]?.allowed !== true)
    return { ok: false, error: "Logging activity for an earlier month needs the “Incentive Tracker — Log activity for an earlier month” permission." };
  // A Google review whose month the NEW Category F already settles (a published version in force) is credited to its
  // original month even when that month is closed: a locked month is reopened by the authorised workflow, an approved
  // or paid one never changes and the difference is carried into a later month (0137, confirmed rule F10).
  if (opts.newEngineSettles) return { ok: true, month };
  if (await isPeriodClosed(month)) return { ok: false, error: `${month} is locked or paid in the Incentive Tracker: nothing can be added to it.` };
  if (await newEngineMonthClosed(category, month)) return { ok: false, error: `Category ${category} for ${month} is already locked, submitted, approved or paid: nothing can be added to it.` };
  return { ok: true, month };
}

// ── Employee submissions (enter pending review) ──────────────────────────────

export async function submitLeadBatch(input: { leadCount: number; profiled: boolean; periodMonth?: string }): Promise<ActionResult> {
  const me = await requireUser();
  const leadCount = clampInt(input.leadCount, 0, 100000);
  if (leadCount < 1) return { ok: false, error: "Enter how many leads." };
  const m = await activityMonth(me, input.periodMonth, "D");
  if (!m.ok) return m;
  await db.insert(leadBatches).values({
    employeeId: me.id, periodMonth: m.month, leadCount, profiled: !!input.profiled,
  });
  revalidateIncentive();
  return { ok: true };
}

export async function submitLeadConversion(input: { convertedCount: number; periodMonth?: string }): Promise<ActionResult> {
  const me = await requireUser();
  const convertedCount = clampInt(input.convertedCount, 0, 100000);
  if (convertedCount < 1) return { ok: false, error: "Enter how many enquiries." };
  const m = await activityMonth(me, input.periodMonth, "D");
  if (!m.ok) return m;
  await db.insert(leadConversions).values({
    employeeId: me.id, periodMonth: m.month, convertedCount,
  });
  revalidateIncentive();
  return { ok: true };
}

export async function submitMeeting(input: {
  potentialBand: "low" | "medium" | "high";
  justification: string;
  periodMonth?: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const band = ["low", "medium", "high"].includes(input.potentialBand) ? input.potentialBand : "medium";
  const justification = String(input.justification ?? "").slice(0, 500);
  if (!justification.trim()) return { ok: false, error: "Add a short justification." };
  const m = await activityMonth(me, input.periodMonth, "E");
  if (!m.ok) return m;
  await db.insert(clientMeetings).values({
    employeeId: me.id, periodMonth: m.month, potentialBand: band, justification,
  });
  revalidateIncentive();
  return { ok: true };
}

/**
 * A review or testimonial is recorded as it is; whether it earns is decided when the month is calculated.
 *
 * A GOOGLE REVIEW (0137) needs its public review link and the date Google shows it was published; its month — in the
 * old engine's record too (D1) — is that claimed publication month, under the same rules as any activity: never a
 * future month, an earlier month only with the "earlier month" permission, never a locked or paid one. The claim alone
 * earns nothing: the old engine still pays only an APPROVED testimonial, and the new Category F only a review an
 * authorised verifier VERIFIED (whose verified date then decides its month). The review is registered once (a second
 * submission of the same review is a duplicate; a short link waits for a verifier). A screenshot is required when a
 * published Category F version in force for the month asks for one.
 * An EMAIL or LETTERHEAD testimonial (F.2, F.3) is recorded in the old engine exactly as before (its month as chosen).
 * Once 0138 is applied it is also registered for the new Category F: it then needs the link to its evidence (the email, or
 * the scanned letter) and its own date, and it too earns only once a verifier has checked that it is genuinely the
 * customer's and of its type (a document alone never earns); the same testimonial is registered once across employees
 * and types.
 */
export async function submitTestimonial(input: {
  kind: "google_review" | "email" | "letterhead";
  wordCount: number;
  starRating?: number;
  namesTeamMember: boolean;
  evidenceUrl?: string;
  periodMonth?: string;
  /** Google review (0137): the public link (required), the date published (required), a screenshot link, the text. */
  reviewUrl?: string;
  screenshotUrl?: string;
  publishedOn?: string;
  reviewText?: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const kind = ["google_review", "email", "letterhead"].includes(input.kind) ? input.kind : "email";
  if (kind === "google_review") {
    const claim = { kind, url: input.reviewUrl ?? "", screenshotUrl: input.screenshotUrl?.trim() || null, publishedOn: input.publishedOn ?? "", rating: Number(input.starRating), text: input.reviewText?.trim() || null };
    const bad = checkClaim(claim);
    if (bad) return { ok: false, error: bad };
    const fReady = await incentiveCalcFReady(db);
    const m = await activityMonth(me, claim.publishedOn.slice(0, 7), "F", { newEngineSettles: fReady && (await fPublishedFor(`${claim.publishedOn.slice(0, 7)}-01`)) });
    if (!m.ok) return m;
    if (fReady && !claim.screenshotUrl && (await screenshotRequired(db, `${m.month}-01`))) return { ok: false, error: "Attach the review's screenshot as well: the Category F configuration in force asks for one." };
    const wordCount = claim.text ? wordsIn(claim.text) : clampInt(input.wordCount, 0, 100000);
    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(testimonials)
        .values({ employeeId: me.id, employeeName: me.name, periodMonth: m.month, kind, wordCount, starRating: claim.rating, namesTeamMember: !!input.namesTeamMember, evidenceUrl: (claim.screenshotUrl ?? claim.url.trim()).slice(0, 500) })
        .returning({ id: testimonials.id });
      if (fReady) await registerTestimonial(tx, { id: me.id, name: me.name }, t!.id, claim);
    });
    revalidateIncentive();
    return { ok: true };
  }
  const wordCount = clampInt(input.wordCount, 0, 100000);
  const starRating = input.starRating != null && Number.isFinite(Number(input.starRating)) ? clampInt(input.starRating, 1, 5) : null;
  // F.2 / F.3 for the new Category F (0138): the evidence link and the email's or letter's own date are required.
  const fReady = await incentiveCalcFReady(db);
  const claim = { kind, url: input.evidenceUrl ?? "", screenshotUrl: null, publishedOn: input.publishedOn ?? "", rating: null, text: input.reviewText?.trim() || null };
  if (fReady) {
    const bad = checkClaim(claim);
    if (bad) return { ok: false, error: bad };
  }
  const m = await activityMonth(me, input.periodMonth, "F");
  if (!m.ok) return m;
  await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(testimonials)
      .values({ employeeId: me.id, employeeName: me.name, periodMonth: m.month, kind, wordCount, starRating, namesTeamMember: !!input.namesTeamMember, evidenceUrl: input.evidenceUrl?.slice(0, 500) ?? null })
      .returning({ id: testimonials.id });
    if (fReady) await registerTestimonial(tx, { id: me.id, name: me.name }, t!.id, claim);
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

  // Case-insensitive match so "Acme"/"acme" don't fragment into duplicate
  // customer records (which would break C's per-customer eligibility + history).
  let [cust] = await db.select().from(customers).where(sql`lower(${customers.name}) = ${name.toLowerCase()}`).limit(1);
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
    confirmed: me.isAdmin, confirmedById: me.isAdmin ? me.id : null, confirmedAt: me.isAdmin ? new Date() : null,
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
  if (await isPeriodClosed(inv.invoiceDate.slice(0, 7))) return { ok: false, error: "That month is locked. Ask an admin to reopen it before editing." };

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
  if (await isPeriodClosed(period)) return { ok: false, error: "That month is locked. Ask an admin to reopen it before deleting." };
  await db.delete(salesOrders).where(eq(salesOrders.id, ord.id)); // cascades invoices + receipts
  await audit(me.id, "deleted_sale", "invoice", input.invoiceId, ord.ownerId, { invoiceNo: inv.invoiceNo });
  if (ord.ownerId) await computePeriodForEmployee(ord.ownerId, period, new Date());
  revalidateIncentive();
  return { ok: true };
}

/** Admin confirms a rep-logged sale so it counts toward incentive. */
export async function confirmSale(input: { orderId: string }): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(input.orderId)) return { ok: false, error: "Invalid id" };
  const [ord] = await db.select().from(salesOrders).where(eq(salesOrders.id, input.orderId)).limit(1);
  if (!ord) return { ok: false, error: "Sale not found." };
  await db.update(salesOrders).set({ confirmed: true, confirmedById: me.id, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(salesOrders.id, ord.id));
  await audit(me.id, "confirmed_sale", "order", ord.id, ord.ownerId, { amountPaise: ord.orderValuePaise, category: ord.categoryCode });
  if (ord.ownerId) await computePeriodForEmployee(ord.ownerId, ord.bookedAt.toISOString().slice(0, 7), new Date());
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

  // Independent review: whoever logged a submission never approves or rejects it — another admin does.
  const TABLE = { lead_batch: leadBatches, lead_conversion: leadConversions, meeting: clientMeetings, testimonial: testimonials } as const;
  const table = TABLE[input.queue as keyof typeof TABLE];
  if (!table) return { ok: false, error: "Unknown queue" };
  const [owner] = await db.select({ employeeId: table.employeeId, periodMonth: table.periodMonth }).from(table).where(eq(table.id, input.id)).limit(1);
  if (!owner) return { ok: false, error: "That submission no longer exists." };
  if (owner.employeeId === me.id) return { ok: false, error: "You can't review your own submission: another admin must approve or reject it." };
  // A month the OLD engine has locked or paid is final there: its ledger is never recomputed, so a decision made or
  // changed now would be silently ignored, or no longer match what was paid. (A category the new engine settles for the
  // month is recalculated by its own workflow instead, where a later change is carried into an open month.)
  const QUEUE_CATEGORY = { lead_batch: "D", lead_conversion: "D", meeting: "E", testimonial: "F" } as const;
  if ((await isPeriodClosed(owner.periodMonth)) && !(await authoritativeCategories(owner.periodMonth)).has(QUEUE_CATEGORY[input.queue as keyof typeof QUEUE_CATEGORY]))
    return { ok: false, error: `${owner.periodMonth} is locked or paid in the Incentive Tracker: a decision on its submissions can't be made or changed now (it would no longer match what was settled).` };

  let affected: { employeeId: string | null; periodMonth: string } | undefined;
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
      // The admin's award as given: the configuration in force (Category E's smallest and largest award, or the old
      // engine's scheme) keeps it within its range when the month is calculated, so no amount is fixed here. An approval
      // states its award explicitly: NO award (a blank box) is refused — it used to be stored as ₹0 and then paid as the
      // smallest award — and so is ₹0, which the current scheme would also raise to its smallest award. To pay nothing,
      // the meeting is rejected.
      const given = input.awardedRupees;
      if (decision === "approved" && (given === undefined || given === null)) return { ok: false, error: "Enter the award before approving: no award was given. To pay nothing, reject the meeting." };
      const rupees = Number(given ?? 0);
      if (decision === "approved" && (!Number.isFinite(rupees) || rupees < 0 || !Number.isSafeInteger(Math.round(rupees * 100)))) return { ok: false, error: "Enter the award in rupees (more than 0)." };
      if (decision === "approved" && Math.round(rupees * 100) === 0) return { ok: false, error: "₹0 isn't an award: the smallest award configured would be paid instead. Enter the award to pay, or reject the meeting to pay nothing." };
      const awarded = decision === "approved" ? Math.round(rupees * 100) : 0;
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
    // A testimonial whose employee was deleted (0137) is history: nothing to recompute.
    if (affected.employeeId) await computePeriodForEmployee(affected.employeeId, affected.periodMonth, new Date());
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
  await db.insert(ruleVersions).values({ schemeId: scheme!.id, version: (last?.v ?? 0) + 1, config, effectiveFrom: `${currentPeriodIST()}-01`, publishedById: me.id, publishedAt: new Date() });
  await audit(me.id, "published_scheme", "scheme", scheme!.id, null, { version: (last?.v ?? 0) + 1, effectiveFrom: `${currentPeriodIST()}-01` });
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
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { ok: false, error: "Choose a month." };
  const status = (["open", "review", "locked", "paid"] as const).includes(input.status) ? input.status : "review";
  const periodId = await ensurePeriod(period);

  // Serialised per month (the row is locked): a PAID month is final — it never moves back to open, review or locked, and
  // is never marked paid twice (one payout run per month). A month is marked paid only once it is locked, so the payout
  // run records figures nobody can still change (a locked month's ledger is never recomputed). The status and its payout
  // run are written together, or neither is.
  const payout = status === "paid" ? await getPeriodPayout(period) : null;
  const result = await db.transaction(async (tx) => {
    const [cur] = await tx.select({ status: incentivePeriods.status }).from(incentivePeriods).where(eq(incentivePeriods.id, periodId)).for("update");
    if (cur?.status === "paid") return { ok: false as const, error: status === "paid" ? "This month is already paid: its payout was recorded once and isn't recorded again." : "A paid month is final: it can't be reopened, unlocked or moved back to review." };
    if (status === "paid" && cur?.status !== "locked") return { ok: false as const, error: "Lock the month before marking it paid." };
    if (status === "paid") {
      const [run] = await tx.select({ id: payoutRuns.id }).from(payoutRuns).where(eq(payoutRuns.periodId, periodId)).limit(1);
      if (run) return { ok: false as const, error: "This month's payout run is already recorded; it isn't recorded twice." };
    }
    await tx.update(incentivePeriods)
      .set({ status, lockedById: status === "locked" || status === "paid" ? me.id : null, lockedAt: status === "locked" || status === "paid" ? new Date() : null, updatedAt: new Date() })
      .where(eq(incentivePeriods.id, periodId));
    if (payout) await tx.insert(payoutRuns).values({ periodId, totalPaise: payout.grandTotalPaise, createdById: me.id, pushedToPayrollAt: new Date() });
    return { ok: true as const };
  });
  if (!result.ok) return result;
  await audit(me.id, status === "paid" ? "paid" : status === "locked" ? "locked" : status === "open" ? "reopened" : "moved-to-review", "period", periodId, null, { period, status });
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
  // A testimonial whose employee was deleted (0137: kept, employee_id null) is history: nobody to recompute.
  for (const r of [...lb, ...lc, ...mt, ...ts]) if (r.id) ids.add(r.id);

  const asOf = new Date();
  for (const id of ids) await computePeriodForEmployee(id, period, asOf);

  revalidateIncentive();
  return { ok: true, employees: ids.size };
}
