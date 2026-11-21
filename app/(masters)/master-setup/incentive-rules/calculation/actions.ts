"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIncentiveCalcRight } from "@/lib/auth/incentive-calc";
import { rateLimitOrError } from "@/lib/rate-limit";
import * as calc from "@/lib/queries/incentive-calc";
import * as aCalc from "@/lib/queries/incentive-calc-a";
import * as qualify from "@/lib/queries/incentive-b-qualify";
import * as cReview from "@/lib/queries/incentive-c-review";
import * as fReview from "@/lib/queries/incentive-f-review";
import { checkIncentiveFRight } from "@/lib/auth/incentive-f";
import { isMissingTable } from "@/lib/queries/collection-master";

/**
 * Admin & Master Setup → Incentive Rules → Calculation (Category A and Category B). Every action checks the signed-in
 * admin's right first (super-admin, or the sensitive `incentive.calc.*` permission — lib/auth/incentive-calc.ts) before
 * anything is read or written. Calculating and locking never approve or pay a month. `category` is optional: absent
 * means Category A, exactly as before.
 */

const Id = z.string().regex(/^[0-9a-f-]{36}$/i);
const Month = z.string().regex(/^\d{4}-\d{2}-01$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Category = z.enum(["A", "B", "C", "D", "E", "F", "G"]).optional();
type Cat = "A" | "B" | "C" | "D" | "E" | "F" | "G";

function failure(err: unknown, what: string): { ok: false; error: string } {
  if (isMissingTable(err)) return { ok: false, error: calc.CALC_NOT_READY };
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const message = e?.cause?.message ?? e?.message ?? "";
  if (code && ["23001", "23514", "23P01", "23505"].includes(code)) return { ok: false, error: `The database refused this: ${message.replace(/^error:\s*/i, "")}` };
  if (err instanceof Error && err.message === "Forbidden") throw err;
  console.error(`[incentive-calc] ${what} failed`, err instanceof Error ? err.message : err);
  return { ok: false, error: "That couldn't be done. Nothing was changed." };
}
const refresh = (category: Cat | undefined) => {
  revalidatePath("/master-setup/incentive-rules/calculation");
  if (category === "B") revalidatePath("/incentive/category-b");
  else if (category && category !== "A") revalidatePath(`/incentive/category/${category.toLowerCase()}`);
};

const CalcInput = z.object({ programId: Id, month: Month, asOf: Day.optional(), category: Category }).strict();
export async function calculateCategoryAMonth(raw: unknown): Promise<calc.Result<calc.CalculateOutcome>> {
  const p = CalcInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose a programme and a month." };
  const { me } = await requireIncentiveCalcRight("run");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.calculate({ id: me.id, name: me.name }, p.data.programId, p.data.month, p.data.asOf, p.data.category ?? "A");
    if (res.ok) refresh(p.data.category);
    return res;
  } catch (err) {
    return failure(err, "calculate");
  }
}

const LockInput = z.object({ programId: Id, month: Month, lock: z.boolean(), rowVersion: z.number().int().min(1), category: Category }).strict();
export async function setCategoryAMonthLocked(raw: unknown): Promise<calc.Result<{ rowVersion: number; notes: string[] }>> {
  const p = LockInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That request couldn't be read." };
  const { me } = await requireIncentiveCalcRight("lock");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.setLocked({ id: me.id, name: me.name }, p.data.programId, p.data.month, p.data.lock, p.data.rowVersion, p.data.category ?? "A");
    if (res.ok) refresh(p.data.category);
    return res;
  } catch (err) {
    return failure(err, p.data.lock ? "lock" : "reopen");
  }
}

/* ── approval and payout ── */

const PeriodInput = z.object({ programId: Id, month: Month, rowVersion: z.number().int().min(1), category: Category }).strict();
async function periodAction<T>(right: "submit" | "approve" | "pay" | "void", what: string, raw: unknown, extra: z.ZodRawShape, body: (actor: calc.Actor, d: Record<string, unknown> & { programId: string; month: string; rowVersion: number; category: Cat }) => Promise<calc.Result<T>>): Promise<calc.Result<T>> {
  const p = PeriodInput.extend(extra).strict().safeParse(raw);
  if (!p.success) return { ok: false, error: "That request couldn't be read." };
  const { me } = await requireIncentiveCalcRight(right);
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const category = (p.data.category as Cat | undefined) ?? "A";
    const res = await body({ id: me.id, name: me.name }, { ...(p.data as Record<string, unknown> & { programId: string; month: string; rowVersion: number }), category });
    if (res.ok) refresh(category);
    return res;
  } catch (err) {
    return failure(err, what);
  }
}

export async function submitCategoryAMonth(raw: unknown) {
  return periodAction("submit", "submit", raw, {}, (a, d) => calc.submitMonth(a, d.programId, d.month, d.rowVersion, d.category));
}
export async function withdrawCategoryAMonth(raw: unknown) {
  return periodAction("submit", "withdraw", raw, {}, (a, d) => calc.withdrawMonth(a, d.programId, d.month, d.rowVersion, d.category));
}
export async function decideCategoryAMonth(raw: unknown) {
  return periodAction("approve", "approve", raw, { decision: z.enum(["approve", "reject"]), reason: z.string().max(1000).nullable() }, (a, d) => calc.decideMonth(a, d.programId, d.month, d.rowVersion, d.decision as "approve" | "reject", d.reason as string | null, undefined, d.category));
}
export async function recordCategoryAPayout(raw: unknown) {
  return periodAction("pay", "record payout", raw, { reference: z.string().max(200), paidOn: Day, amountPaise: z.number().int().min(0), note: z.string().max(1000).nullable() }, (a, d) => calc.recordPayout(a, d.programId, d.month, d.rowVersion, { reference: d.reference as string, paidOn: d.paidOn as string, amountPaise: d.amountPaise as number, note: d.note as string | null }, undefined, d.category));
}

/** Void an abandoned, unpaid Category C month, with a reason (incentive.calc.void). */
export async function voidCategoryCMonth(raw: unknown) {
  return periodAction("void", "void the month", raw, { reason: z.string().max(1000) }, (a, d) => calc.voidMonth(a, d.programId, d.month, d.rowVersion, d.reason as string, d.category));
}

/* ── Category B: manual qualification decisions (incentive.calc.qualify) ── */

const DecideInput = z.object({ orderId: Id, decision: z.enum(["qualify", "exclude"]), reason: z.string().max(1000) }).strict();
export async function recordCategoryBDecision(raw: unknown): Promise<calc.Result<{ id: string }>> {
  const p = DecideInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose the order and the decision, and give the reason." };
  const { me } = await requireIncentiveCalcRight("qualify");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await qualify.recordOverride({ id: me.id, name: me.name }, p.data);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation/qualifications");
      revalidatePath("/incentive/category-b");
    }
    return res;
  } catch (err) {
    return failure(err, "record a Category B decision");
  }
}

/* ── Category C: decisions on unmatched records (incentive.calc.review) ── */

const CDecideInput = z.object({ documentId: Id, caseKind: z.enum(["order-customer", "invoice-order", "credit-note-invoice", "return-credit-note", "receipt-customer"]), decision: z.enum(["link", "exclude"]), targetId: Id.nullable(), reason: z.string().max(1000) }).strict();
export async function recordCategoryCDecision(raw: unknown): Promise<calc.Result<{ id: string }>> {
  const p = CDecideInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose the record and the decision, and give the reason." };
  const { me } = await requireIncentiveCalcRight("review");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await cReview.recordReviewC({ id: me.id, name: me.name }, p.data);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation/c-review");
      revalidatePath("/incentive/category/c");
    }
    return res;
  } catch (err) {
    return failure(err, "record a Category C review decision");
  }
}

const CRetireInput = z.object({ id: Id, reason: z.string().max(1000) }).strict();
export async function retireCategoryCDecision(raw: unknown): Promise<calc.Result> {
  const p = CRetireInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for retiring it." };
  const { me } = await requireIncentiveCalcRight("review");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await cReview.retireReviewC({ id: me.id, name: me.name }, p.data.id, p.data.reason);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation/c-review");
      revalidatePath("/incentive/category/c");
    }
    return res;
  } catch (err) {
    return failure(err, "retire a Category C review decision");
  }
}

/* ── Category B: a review of an invoice with no Sales Order (0140; incentive.calc.qualify) ── */

const BInvoiceInput = z.object({ invoiceId: Id, reason: z.string().max(1000) }).strict();
export async function recordCategoryBInvoiceReview(raw: unknown): Promise<calc.Result<{ id: string }>> {
  const p = BInvoiceInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose the invoice and give the reason." };
  const { me } = await requireIncentiveCalcRight("qualify");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await qualify.recordInvoiceReview({ id: me.id, name: me.name }, p.data);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation/qualifications");
      revalidatePath("/incentive/category-b");
    }
    return res;
  } catch (err) {
    return failure(err, "record a Category B invoice review");
  }
}

const BInvoiceRetireInput = z.object({ id: Id, reason: z.string().max(1000) }).strict();
export async function retireCategoryBInvoiceReview(raw: unknown): Promise<calc.Result> {
  const p = BInvoiceRetireInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for retiring it." };
  const { me } = await requireIncentiveCalcRight("qualify");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await qualify.retireInvoiceReview({ id: me.id, name: me.name }, p.data.id, p.data.reason);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation/qualifications");
      revalidatePath("/incentive/category-b");
    }
    return res;
  } catch (err) {
    return failure(err, "retire a Category B invoice review");
  }
}

/* ── below-minimum carry-forward: a TWO-PERSON write-off (0141; incentive.calc.pay for both people) ── */

const WriteOffInput = z.object({ lotId: Id, reason: z.string().max(1000) }).strict();
/** Ask for a carried-forward balance to be written off (a second person approves or refuses it). */
export async function writeOffCategoryCarry(raw: unknown): Promise<calc.Result<{ requestId: string; amountPaise: number }>> {
  const p = WriteOffInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for writing it off." };
  const { me } = await requireIncentiveCalcRight("pay");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.requestCarryWriteOff({ id: me.id, name: me.name }, p.data.lotId, p.data.reason);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation");
      revalidatePath("/incentive/category/c");
    }
    return res;
  } catch (err) {
    return failure(err, "request a carried-forward balance's write-off");
  }
}

const WriteOffDecisionInput = z.object({ requestId: Id, decision: z.enum(["approve", "refuse"]), reason: z.string().max(1000) }).strict();
/** A second person approves or refuses a write-off request, with the reason. */
export async function decideCategoryCarryWriteOff(raw: unknown): Promise<calc.Result<{ amountPaise: number }>> {
  const p = WriteOffDecisionInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Approve or refuse it, and give the reason." };
  const { me } = await requireIncentiveCalcRight("pay");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.decideCarryWriteOff({ id: me.id, name: me.name }, p.data.requestId, p.data.decision, p.data.reason);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation");
      revalidatePath("/incentive/category/c");
    }
    return res;
  } catch (err) {
    return failure(err, "decide a carried-forward balance's write-off");
  }
}

const RetireInput = z.object({ id: Id, reason: z.string().max(1000) }).strict();
export async function retireCategoryBDecision(raw: unknown): Promise<calc.Result> {
  const p = RetireInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for retiring it." };
  const { me } = await requireIncentiveCalcRight("qualify");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await qualify.retireOverride({ id: me.id, name: me.name }, p.data.id, p.data.reason);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation/qualifications");
      revalidatePath("/incentive/category-b");
    }
    return res;
  } catch (err) {
    return failure(err, "retire a Category B decision");
  }
}

/* ── Category F: Google reviews (0137) — incentive.f.verify / .invalidate / .writeOff, checked here first ── */

function refreshF() {
  revalidatePath("/master-setup/incentive-rules/calculation/f-review");
  revalidatePath("/incentive/category/f");
}
const Reason = z.string().max(1000);
const FDecisionInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("verify"), reviewId: Id, reason: Reason, testimonialKind: z.enum(["google_review", "email", "letterhead"]), rating: z.number().int().min(1).max(5).nullable(), publishedOn: Day, reviewText: z.string().max(10000).nullable(), googleReviewId: z.string().max(300).nullable(), namedEmployeeIds: z.array(Id).max(20), appreciatedEmployeeIds: z.array(Id).max(20), customerMasterId: Id.nullable(), evidence: z.object({ messageId: z.string().max(1000).nullable().optional(), sender: z.string().max(500).nullable().optional(), subject: z.string().max(1000).nullable().optional(), reference: z.string().max(500).nullable().optional() }).strict().nullable(), confirmedFromCustomer: z.boolean(), confirmedType: z.boolean(), confirmedGenuine: z.boolean() }).strict(),
  z.object({ kind: z.enum(["reject", "needs-review"]), reviewId: Id, reason: Reason }).strict(),
  z.object({ kind: z.literal("link"), submissionId: Id, reason: Reason, url: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal("attribute"), reviewId: Id, reason: Reason, creditedEmployeeId: Id, basis: z.enum(["named", "assigned", "claim"]) }).strict(),
]);
export async function recordCategoryFDecision(raw: unknown): Promise<calc.Result<{ id: string }>> {
  // The right first, read fresh on every call: a right removed after the page was opened is refused with a message.
  const allowed = await checkIncentiveFRight("verify");
  if (!allowed.ok) return allowed;
  const { me } = allowed;
  const p = FDecisionInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Fill in the decision and give the reason." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await fReview.recordFDecision({ id: me.id, name: me.name }, p.data);
    if (res.ok) refreshF();
    return res;
  } catch (err) {
    return failure(err, "record a Category F decision");
  }
}
const FRetireInput = z.object({ id: Id, reason: Reason }).strict();
export async function retireCategoryFDecision(raw: unknown): Promise<calc.Result> {
  // The right first, read fresh on every call: a right removed after the page was opened is refused with a message.
  const allowed = await checkIncentiveFRight("verify");
  if (!allowed.ok) return allowed;
  const { me } = allowed;
  const p = FRetireInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for retiring it." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await fReview.retireFDecision({ id: me.id, name: me.name }, p.data.id, p.data.reason);
    if (res.ok) refreshF();
    return res;
  } catch (err) {
    return failure(err, "retire a Category F decision");
  }
}
const FInvalidateInput = z.object({ reviewId: Id, reason: Reason, evidenceUrl: z.string().max(2000) }).strict();
export async function requestCategoryFInvalidation(raw: unknown): Promise<calc.Result<{ id: string }>> {
  // The right first, read fresh on every call: a right removed after the page was opened is refused with a message.
  const allowed = await checkIncentiveFRight("invalidate");
  if (!allowed.ok) return allowed;
  const { me } = allowed;
  const p = FInvalidateInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason and the evidence." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await fReview.requestFInvalidation({ id: me.id, name: me.name }, p.data);
    if (res.ok) refreshF();
    return res;
  } catch (err) {
    return failure(err, "request a Category F invalidation");
  }
}
const FSecondInput = z.object({ requestId: Id, decision: z.enum(["approve", "refuse"]), reason: Reason }).strict();
export async function decideCategoryFInvalidation(raw: unknown): Promise<calc.Result<{ id: string; reviewMonth: string | null }>> {
  // The right first, read fresh on every call: a right removed after the page was opened is refused with a message.
  const allowed = await checkIncentiveFRight("invalidate");
  if (!allowed.ok) return allowed;
  const { me } = allowed;
  const p = FSecondInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Approve or refuse it, with the reason." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await fReview.decideFInvalidation({ id: me.id, name: me.name }, p.data);
    if (res.ok) refreshF();
    return res;
  } catch (err) {
    return failure(err, "decide a Category F invalidation");
  }
}
const FWriteOffInput = z.object({ adjustmentId: Id, amountPaise: z.number().int().positive(), reason: Reason, evidenceUrl: z.string().max(2000).nullable() }).strict();
export async function requestCategoryFWriteOff(raw: unknown): Promise<calc.Result<{ id: string }>> {
  // The right first, read fresh on every call: a right removed after the page was opened is refused with a message.
  const allowed = await checkIncentiveFRight("writeOff");
  if (!allowed.ok) return allowed;
  const { me } = allowed;
  const p = FWriteOffInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the amount and the reason." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await fReview.requestFWriteOff({ id: me.id, name: me.name }, p.data);
    if (res.ok) refreshF();
    return res;
  } catch (err) {
    return failure(err, "request a Category F write-off");
  }
}
export async function decideCategoryFWriteOff(raw: unknown): Promise<calc.Result<{ id: string }>> {
  // The right first, read fresh on every call: a right removed after the page was opened is refused with a message.
  const allowed = await checkIncentiveFRight("writeOff");
  if (!allowed.ok) return allowed;
  const { me } = allowed;
  const p = FSecondInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Approve or refuse it, with the reason." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await fReview.decideFWriteOff({ id: me.id, name: me.name }, p.data);
    if (res.ok) refreshF();
    return res;
  } catch (err) {
    return failure(err, "decide a Category F write-off");
  }
}

/* ── Category A: held items acknowledged (0142; incentive.calc.review) ── */

const AHoldInput = z.object({ documentId: Id, code: z.string().max(40), reason: z.string().max(1000) }).strict();
/** Acknowledge an item a Category A calculation held (it stays as calculated), with the reason. */
export async function acknowledgeCategoryAHold(raw: unknown): Promise<calc.Result<{ id: string }>> {
  const p = AHoldInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose the held item and give the reason." };
  const { me } = await requireIncentiveCalcRight("review");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await aCalc.acknowledgeHeld({ id: me.id, name: me.name }, p.data);
    if (res.ok) refresh("A");
    return res;
  } catch (err) {
    return failure(err, "acknowledge a held Category A item");
  }
}

const AHoldRetireInput = z.object({ id: Id, reason: z.string().max(1000) }).strict();
/** Retire an acknowledgment (the item holds its month again), with the reason. */
export async function retireCategoryAHoldAcknowledgment(raw: unknown): Promise<calc.Result> {
  const p = AHoldRetireInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for retiring it." };
  const { me } = await requireIncentiveCalcRight("review");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await aCalc.retireAcknowledgment({ id: me.id, name: me.name }, p.data.id, p.data.reason);
    if (res.ok) refresh("A");
    return res;
  } catch (err) {
    return failure(err, "retire an acknowledgment");
  }
}

/* ── Category A: a TWO-PERSON negative-balance write-off or salary recovery (0142) ── */

const NegativeRequestInput = z.object({ programId: Id, month: Month, employeeId: Id, reason: z.string().max(1000) }).strict();
/** Ask a second person to approve what locking the month would write off or recover from salary (incentive.calc.lock). */
export async function requestCategoryANegativeDecision(raw: unknown): Promise<calc.Result<{ requestId: string; amountPaise: number }>> {
  const p = NegativeRequestInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose the salesperson and give the reason." };
  const { me } = await requireIncentiveCalcRight("lock");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.requestNegativeDecision({ id: me.id, name: me.name }, p.data);
    if (res.ok) refresh("A");
    return res;
  } catch (err) {
    return failure(err, "request a negative-balance decision");
  }
}

const NegativeDecideInput = z.object({ requestId: Id, decision: z.enum(["approve", "refuse"]), reason: z.string().max(1000) }).strict();
/** A second person approves or refuses it, with the reason (incentive.calc.approve). */
export async function decideCategoryANegativeDecision(raw: unknown): Promise<calc.Result<{ amountPaise: number }>> {
  const p = NegativeDecideInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason." };
  const { me } = await requireIncentiveCalcRight("approve");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.decideNegativeDecision({ id: me.id, name: me.name }, p.data.requestId, p.data.decision, p.data.reason);
    if (res.ok) refresh("A");
    return res;
  } catch (err) {
    return failure(err, "decide a negative-balance request");
  }
}
