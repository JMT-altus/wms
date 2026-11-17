"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIncentiveCalcRight } from "@/lib/auth/incentive-calc";
import { rateLimitOrError } from "@/lib/rate-limit";
import * as inputs from "@/lib/queries/incentive-inputs";
import { CALC_NOT_READY, type Result } from "@/lib/queries/incentive-calc";
import { isMissingTable } from "@/lib/queries/collection-master";

/**
 * Category A inputs: order salespeople, customer representative periods and receipt events. Every action needs the
 * sensitive `incentive.calc.inputs` permission (or a super-admin), checked before anything is read or written. Rows
 * are recorded or retired, never edited or deleted; the database refuses overlaps and over-allocation (0133).
 */

const Id = z.string().regex(/^[0-9a-f-]{36}$/i);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Note = z.string().max(1000).nullable();

function failure(err: unknown, what: string): { ok: false; error: string } {
  if (isMissingTable(err)) return { ok: false, error: CALC_NOT_READY };
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const message = (e?.cause?.message ?? e?.message ?? "").replace(/^error:\s*/i, "");
  if (code === "23505") return { ok: false, error: "That is already recorded." };
  if (code && ["23001", "23514", "23P01", "23503"].includes(code)) return { ok: false, error: `The database refused this: ${message}` };
  if (err instanceof Error && err.message === "Forbidden") throw err;
  console.error(`[incentive-inputs] ${what} failed`, err instanceof Error ? err.message : err);
  return { ok: false, error: "That couldn't be saved. Nothing was changed." };
}

async function act<T>(what: string, body: (actor: { id: string; name: string }) => Promise<Result<T>>): Promise<Result<T>> {
  const { me } = await requireIncentiveCalcRight("inputs");
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await body({ id: me.id, name: me.name });
    if (res.ok) revalidatePath("/master-setup/incentive-rules/calculation", "layout");
    return res;
  } catch (err) {
    return failure(err, what);
  }
}

const AttributionInput = z.object({ documentId: Id, employeeId: Id, sharePpm: z.number().int().min(1).max(1_000_000), note: Note }).strict();
export async function recordOrderSalesperson(raw: unknown) {
  const p = AttributionInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "Choose an order, a salesperson and a share." };
  return act("record attribution", (a) => inputs.recordAttribution(a, p.data));
}

const RetireInput = z.object({ entity: z.enum(["attribution", "rep-history", "receipt-event"]), id: Id, reason: z.string().max(1000) }).strict();
export async function retireIncentiveInput(raw: unknown) {
  const p = RetireInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "That request couldn't be read." };
  return act("retire", (a) => inputs.retireInput(a, p.data.entity, p.data.id, p.data.reason));
}

const RepInput = z.object({ customerId: Id, employeeId: Id, from: Day, to: Day.nullable(), note: Note }).strict();
export async function recordRepresentativePeriod(raw: unknown) {
  const p = RepInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "Choose a customer, a representative and the dates." };
  return act("record representative", (a) => inputs.recordRepPeriod(a, p.data));
}

const EventInput = z.object({ documentId: Id, kind: z.enum(inputs.EVENT_KINDS), invoiceId: Id.nullable(), amountPaise: z.number().int().positive().nullable(), eventDate: Day, note: Note }).strict();
export async function recordReceiptEvent(raw: unknown) {
  const p = EventInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "That event couldn't be read." };
  return act("record receipt event", (a) => inputs.recordReceiptEvent(a, p.data));
}

/** The customer's Forms invoices, for allocating a receipt (needs the inputs right too). */
export async function customerInvoices(customerId: string) {
  await requireIncentiveCalcRight("inputs");
  return inputs.invoicesOfCustomer(customerId);
}
