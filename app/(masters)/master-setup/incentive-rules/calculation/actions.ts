"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIncentiveCalcRight } from "@/lib/auth/incentive-calc";
import { rateLimitOrError } from "@/lib/rate-limit";
import * as calc from "@/lib/queries/incentive-calc";
import * as qualify from "@/lib/queries/incentive-b-qualify";
import * as cReview from "@/lib/queries/incentive-c-review";
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

/* ── below-minimum carry-forward: an authorised write-off (incentive.calc.pay) ── */

const WriteOffInput = z.object({ lotId: Id, reason: z.string().max(1000) }).strict();
export async function writeOffCategoryCarry(raw: unknown): Promise<calc.Result<{ amountPaise: number }>> {
  const p = WriteOffInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Give the reason for writing it off." };
  const { me } = await requireIncentiveCalcRight("pay");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.writeOffCarry({ id: me.id, name: me.name }, p.data.lotId, p.data.reason);
    if (res.ok) {
      revalidatePath("/master-setup/incentive-rules/calculation");
      revalidatePath("/incentive/category/c");
    }
    return res;
  } catch (err) {
    return failure(err, "write off a carried-forward balance");
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
