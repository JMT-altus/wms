"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIncentiveCalcRight } from "@/lib/auth/incentive-calc";
import { rateLimitOrError } from "@/lib/rate-limit";
import * as calc from "@/lib/queries/incentive-calc";
import { isMissingTable } from "@/lib/queries/collection-master";

/**
 * Admin & Master Setup → Incentive Rules → Calculation. Every action checks the signed-in admin's right first
 * (super-admin, or the sensitive `incentive.calc.*` permission — lib/auth/incentive-calc.ts) before anything is read or
 * written. Calculating and locking never approve or pay a month.
 */

const Id = z.string().regex(/^[0-9a-f-]{36}$/i);
const Month = z.string().regex(/^\d{4}-\d{2}-01$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

const CalcInput = z.object({ programId: Id, month: Month, asOf: Day.optional() }).strict();
export async function calculateCategoryAMonth(raw: unknown): Promise<calc.Result<calc.CalculateOutcome>> {
  const p = CalcInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose a programme and a month." };
  const { me } = await requireIncentiveCalcRight("run");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.calculate({ id: me.id, name: me.name }, p.data.programId, p.data.month, p.data.asOf);
    if (res.ok) revalidatePath("/master-setup/incentive-rules/calculation");
    return res;
  } catch (err) {
    return failure(err, "calculate");
  }
}

const LockInput = z.object({ programId: Id, month: Month, lock: z.boolean(), rowVersion: z.number().int().min(1) }).strict();
export async function setCategoryAMonthLocked(raw: unknown): Promise<calc.Result<{ rowVersion: number; notes: string[] }>> {
  const p = LockInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That request couldn't be read." };
  const { me } = await requireIncentiveCalcRight("lock");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await calc.setLocked({ id: me.id, name: me.name }, p.data.programId, p.data.month, p.data.lock, p.data.rowVersion);
    if (res.ok) revalidatePath("/master-setup/incentive-rules/calculation");
    return res;
  } catch (err) {
    return failure(err, p.data.lock ? "lock" : "reopen");
  }
}

/* ── approval and payout ── */

const PeriodInput = z.object({ programId: Id, month: Month, rowVersion: z.number().int().min(1) }).strict();
async function periodAction<T>(right: "submit" | "approve" | "pay", what: string, raw: unknown, extra: z.ZodRawShape, body: (actor: calc.Actor, d: Record<string, unknown> & { programId: string; month: string; rowVersion: number }) => Promise<calc.Result<T>>): Promise<calc.Result<T>> {
  const p = PeriodInput.extend(extra).strict().safeParse(raw);
  if (!p.success) return { ok: false, error: "That request couldn't be read." };
  const { me } = await requireIncentiveCalcRight(right);
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await body({ id: me.id, name: me.name }, p.data as never);
    if (res.ok) revalidatePath("/master-setup/incentive-rules/calculation");
    return res;
  } catch (err) {
    return failure(err, what);
  }
}

export async function submitCategoryAMonth(raw: unknown) {
  return periodAction("submit", "submit", raw, {}, (a, d) => calc.submitMonth(a, d.programId, d.month, d.rowVersion));
}
export async function withdrawCategoryAMonth(raw: unknown) {
  return periodAction("submit", "withdraw", raw, {}, (a, d) => calc.withdrawMonth(a, d.programId, d.month, d.rowVersion));
}
export async function decideCategoryAMonth(raw: unknown) {
  return periodAction("approve", "approve", raw, { decision: z.enum(["approve", "reject"]), reason: z.string().max(1000).nullable() }, (a, d) => calc.decideMonth(a, d.programId, d.month, d.rowVersion, d.decision as "approve" | "reject", d.reason as string | null));
}
export async function recordCategoryAPayout(raw: unknown) {
  return periodAction("pay", "record payout", raw, { reference: z.string().max(200), paidOn: Day, amountPaise: z.number().int().min(0), note: z.string().max(1000).nullable() }, (a, d) => calc.recordPayout(a, d.programId, d.month, d.rowVersion, { reference: d.reference as string, paidOn: d.paidOn as string, amountPaise: d.amountPaise as number, note: d.note as string | null }));
}
