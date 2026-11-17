"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesOrderFieldsManager } from "@/lib/auth/sales-order-fields";
import { rateLimitOrError } from "@/lib/rate-limit";
import { saveFieldSetting, saveSectionSetting, type SaveResult } from "@/lib/queries/sales-order-fields";
import { isMissingTable } from "@/lib/queries/collection-master";
import { CUSTOM_TYPES, FIELD_SCOPES, HELP_TEXT_MAX, isCondition } from "@/lib/tally/sales-order-config";

/**
 * Admin & Master Setup → Sales Order Fields. Every action needs an admin who is a super-admin or holds the sensitive
 * `sales-orders.fields.manage` permission (lib/auth/sales-order-fields.ts), checked from the signed session before
 * anything is read or written. What may be saved is decided on the server against the configuration as it is now
 * (lib/tally/sales-order-config → validateSetting / validateSection): the browser's own checks are only for its messages.
 */

const NOT_READY = "Sales Order field settings need database update 0128 first, so nothing was saved.";

const Text = (max: number) => z.string().max(max).nullable();
/** Left out = keep the stored help text; null or blank = clear it. */
const HelpText = z.string().max(HELP_TEXT_MAX).nullable().optional();
/** The row version the screen read (0 = it had no setting): a change made meanwhile is never overwritten. */
const ExpectedRowVersion = z.number().int().min(0);
const Input = z
  .object({
    fieldKey: z.string().regex(/^[a-z][A-Za-z0-9_]{1,62}$/).nullable(),
    isCustom: z.boolean(),
    scope: z.enum(FIELD_SCOPES as unknown as [string, ...string[]]),
    label: Text(120),
    section: Text(120),
    displayOrder: z.number().int().min(0).max(100000).nullable(),
    requirement: z.enum(["mandatory", "optional", "conditional"]).nullable(),
    // Only the fixed vocabulary is accepted; anything else is refused before it is looked at further.
    condition: z.unknown().nullable().refine((c) => c === null || isCondition(c), "That condition isn't one the configuration understands."),
    fieldType: z.enum(CUSTOM_TYPES as unknown as [string, ...string[]]).nullable(),
    options: z.array(z.string().max(200)).max(200).nullable(),
    inForm: z.boolean(),
    inImport: z.boolean(),
    onOrderPage: z.boolean(),
    status: z.enum(["active", "retired"]),
    helpText: HelpText,
    expectedRowVersion: ExpectedRowVersion,
  })
  .strict();

const SectionInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    isNew: z.boolean(),
    label: Text(120),
    displayOrder: z.number().int().min(0).max(100000).nullable(),
    status: z.enum(["active", "retired"]),
    helpText: HelpText,
    expectedRowVersion: ExpectedRowVersion,
  })
  .strict();

async function saved(what: "field" | "section", run: () => Promise<SaveResult>): Promise<SaveResult> {
  try {
    const result = await run();
    if (result.ok) {
      revalidatePath("/master-setup/sales-order-fields");
      revalidatePath("/forms/documents/sales-orders/import");
      revalidatePath("/forms/documents/sales-orders", "layout");
    }
    return result;
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_READY };
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if ((e?.code ?? e?.cause?.code) === "23505") return { ok: false, error: "Another custom field already has that label." };
    console.error(`[sales-order-fields] ${what} save failed`, err instanceof Error ? err.message : err);
    return { ok: false, error: "The setting could not be saved. Nothing was changed." };
  }
}

export async function saveSalesOrderField(raw: unknown): Promise<SaveResult> {
  const me = await requireSalesOrderFieldsManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = Input.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "That setting couldn't be read." };
  const { expectedRowVersion, ...input } = p.data;
  return saved("field", () => saveFieldSetting(me.id, input as Parameters<typeof saveFieldSetting>[1], expectedRowVersion));
}

/** A section's display label, order, enabled / disabled and help text; or a new custom section. */
export async function saveSalesOrderSection(raw: unknown): Promise<SaveResult> {
  const me = await requireSalesOrderFieldsManager();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const p = SectionInputSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "That section couldn't be read." };
  const { expectedRowVersion, ...input } = p.data;
  return saved("section", () => saveSectionSetting(me.id, input, expectedRowVersion));
}
