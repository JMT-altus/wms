"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIncentiveRuleRight } from "@/lib/auth/incentive-rules";
import { rateLimitOrError } from "@/lib/rate-limit";
import { CATEGORY_CODES } from "@/lib/incentives/rules-config/spec";
import { readConfig } from "@/lib/incentives/rules-config/validate";
import * as rules from "@/lib/queries/incentive-rules";

/**
 * Admin & Master Setup → Incentive Rules. Every action checks the signed-in admin's right first (super-admin, or the
 * sensitive `incentive.rules.*` permission — lib/auth/incentive-rules.ts), before anything is read or written. Whether
 * the change is allowed is decided on the server (lib/queries/incentive-rules.ts) and again by the database (migration
 * 0131's triggers); the screen's own checks are only for its messages. No action calculates an incentive or touches
 * the incentive ledger.
 */

type R<T = object> = rules.Result<T>;
const Id = z.string().regex(/^[0-9a-f-]{36}$/i);
const Rv = z.number().int().min(1);

function refresh(versionId?: string) {
  revalidatePath("/master-setup/incentive-rules");
  if (versionId) revalidatePath(`/master-setup/incentive-rules/${versionId}`);
}

/** Turns what went wrong into a message: the database's own refusals are shown as they are worded; anything else is generic. */
function failure(err: unknown, what: string): { ok: false; error: string } {
  if (rules.isIncentiveRulesMissing(err)) return { ok: false, error: rules.NOT_READY };
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const message = e?.cause?.message ?? e?.message ?? "";
  if (code && ["23001", "23514", "23P01", "23505"].includes(code)) return { ok: false, error: `The database refused this: ${message.replace(/^error:\s*/i, "")}` };
  if (err instanceof Error && err.message === "Forbidden") throw err;
  console.error(`[incentive-rules] ${what} failed`, err instanceof Error ? err.message : err);
  return { ok: false, error: "That couldn't be saved. Nothing was changed." };
}

async function run<T>(right: Parameters<typeof requireIncentiveRuleRight>[0], what: string, versionId: string | undefined, body: (actor: rules.Actor, rights: Awaited<ReturnType<typeof requireIncentiveRuleRight>>["rights"]) => Promise<R<T>>): Promise<R<T>> {
  const { me, rights } = await requireIncentiveRuleRight(right);
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  try {
    const res = await body({ id: me.id, name: me.name }, rights);
    if (res.ok) refresh(versionId);
    return res;
  } catch (err) {
    return failure(err, what);
  }
}

const ProgramInput = z.object({ code: z.string().max(32), name: z.string().max(120), description: z.string().max(1000).nullable() }).strict();
export async function createIncentiveProgram(raw: unknown): Promise<R<{ programId: string }>> {
  const p = ProgramInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That programme couldn't be read." };
  return run("edit", "create programme", undefined, (actor) => rules.createProgram(actor, p.data));
}

const DraftInput = z
  .object({ programId: Id, category: z.enum(CATEGORY_CODES), startFrom: z.union([z.literal("blank"), z.literal("reference"), z.object({ versionId: Id }).strict()]) })
  .strict();
export async function createIncentiveDraft(raw: unknown): Promise<R<{ versionId: string }>> {
  const p = DraftInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That draft couldn't be read." };
  return run("edit", "create draft", undefined, (actor) => rules.createDraft(actor, p.data));
}

const SaveInput = z.object({ versionId: Id, expectedRowVersion: Rv, config: z.unknown(), changeNote: z.string().max(1000).nullable() }).strict();
export async function saveIncentiveDraft(raw: unknown): Promise<R<{ rowVersion: number; missing: number }>> {
  const p = SaveInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That draft couldn't be read." };
  const c = readConfig(p.data.config);
  if (!c.ok) return { ok: false, error: c.error };
  return run("edit", "save draft", p.data.versionId, (actor) => rules.saveDraft(actor, p.data.versionId, p.data.expectedRowVersion, c.config, p.data.changeNote));
}

const StepInput = z.object({ versionId: Id, expectedRowVersion: Rv }).strict();
const step = (right: "submit" | "edit", what: string, fn: (actor: rules.Actor, id: string, rv: number) => Promise<R<{ rowVersion: number }>>) =>
  async (raw: unknown): Promise<R<{ rowVersion: number }>> => {
    const p = StepInput.safeParse(raw);
    if (!p.success) return { ok: false, error: "That request couldn't be read." };
    return run(right, what, p.data.versionId, (actor) => fn(actor, p.data.versionId, p.data.expectedRowVersion));
  };

export const submitIncentiveVersion = async (raw: unknown) => step("submit", "submit", rules.submit)(raw);
export const withdrawIncentiveVersion = async (raw: unknown) => step("submit", "withdraw", rules.withdraw)(raw);
export const returnIncentiveVersionToDraft = async (raw: unknown) => step("edit", "return to draft", rules.returnToDraft)(raw);
export const discardIncentiveVersion = async (raw: unknown) => step("edit", "discard", rules.discard)(raw);

const DecideInput = z.object({ versionId: Id, expectedRowVersion: Rv, note: z.string().max(1000).nullable() }).strict();
export async function approveIncentiveVersion(raw: unknown): Promise<R<{ rowVersion: number }>> {
  const p = DecideInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That request couldn't be read." };
  return run("approve", "approve", p.data.versionId, (actor) => rules.approve(actor, p.data.versionId, p.data.expectedRowVersion, p.data.note?.trim() || null));
}
export async function rejectIncentiveVersion(raw: unknown): Promise<R<{ rowVersion: number }>> {
  const p = DecideInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "That request couldn't be read." };
  return run("approve", "reject", p.data.versionId, (actor) => rules.reject(actor, p.data.versionId, p.data.expectedRowVersion, p.data.note ?? ""));
}

const PublishInput = z.object({ versionId: Id, expectedRowVersion: Rv, effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/) }).strict();
export async function publishIncentiveVersion(raw: unknown): Promise<R<{ rowVersion: number; superseded: string | null }>> {
  const p = PublishInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose the month it takes effect from." };
  return run("publish", "publish", p.data.versionId, (actor, rights) => rules.publish(actor, p.data.versionId, p.data.expectedRowVersion, p.data.effectiveFrom, { canBackdate: rights.backdate }));
}
