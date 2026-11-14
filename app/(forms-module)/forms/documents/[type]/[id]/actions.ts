"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesOrderPreCloser } from "@/lib/auth/sales-order-preclose";
import { rateLimitOrError } from "@/lib/rate-limit";
import { isMissingTable } from "@/lib/queries/collection-master";
import { PRECLOSE_NOT_READY, recordPreClosure, type PreCloseResult } from "@/lib/queries/sales-order-preclosures";
import { documentHref } from "@/lib/tally/sections";
import { todayYmd } from "@/lib/dates";

/**
 * Forms → Sales Orders → an order → "Pre-close" on one of its deliveries: the matrix's "Update" fields. Needs the
 * sensitive `sales-orders.preclose` permission (or a super-admin), checked from the signed session before anything is
 * read or written. What may be recorded is decided on the server against the order as stored now
 * (lib/tally/sales-order-preclose → checkPreClose); the browser's own checks are only for its messages.
 */

const Input = z
  .object({
    documentId: z.string().uuid(),
    /** Made once per opening of the form: the same submission sent twice is recorded once. */
    requestId: z.string().uuid(),
    lineNo: z.number().int().min(1).max(10000),
    allocationNo: z.number().int().min(1).max(10000),
    quantity: z.string().max(40),
    reason: z.string().max(2000),
    date: z.string().max(40),
    expectedCount: z.number().int().min(0).max(100000),
  })
  .strict();

export async function preCloseDelivery(raw: unknown): Promise<PreCloseResult> {
  const me = await requireSalesOrderPreCloser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = Input.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "That pre-closure couldn't be read." };
  const { documentId, requestId, ...input } = p.data;
  try {
    const result = await recordPreClosure({ id: me.id, name: me.name }, documentId, requestId, input, todayYmd());
    if (result.ok) revalidatePath(documentHref("sales-orders", documentId));
    return result;
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: PRECLOSE_NOT_READY };
    const e = err as { code?: string; cause?: { code?: string } } | null;
    const code = e?.code ?? e?.cause?.code;
    // The database's own checks (migration 0129) — reached only if something changed between the check and the insert.
    if (code === "23505") return { ok: false, error: "That submission was already recorded." };
    if (code === "23514") return { ok: false, error: "The order or its pre-closures changed meanwhile. Nothing was recorded: look at it again." };
    console.error("[sales-order-preclose] record failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "The pre-closure could not be recorded. Nothing was changed." };
  }
}
