import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { incentiveCalcAReviews, incentiveCalcRuns, incentiveAudit, tallyDocuments } from "@/db/schema";
import { HOLD_CODES, HOLD_LABEL, type CategoryAResult, type HoldCode, type Note } from "@/lib/incentives/category-a/types";
import type { AllCategoriesIn, OtherCategoryAmount, StoredShare } from "@/lib/incentives/shared/all-categories";
import { sharedShareOf } from "@/lib/incentives/shared/all-categories";
import type { IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import { allCategoriesFor, categoryBOrderIds } from "@/lib/queries/incentive-calc-b";

/**
 * Category A's own reading and recording side (engine category-a/2, migration 0142):
 *   · what the calculation HELD, and whether each hold is resolved — held items keep a Category A month from being
 *     submitted, approved or paid until they are resolved at their source (and the month recalculated) or acknowledged,
 *     with a reason, by an authorised person (0142's incentive_calc_a_reviews; never a change to a calculation);
 *   · the all-categories limit ("Most a salesperson can earn from all categories in a month") as ONE combined limit
 *     per salesperson across every category and every programme: the other programmes' new-engine months, and the old
 *     engine's amounts for the categories it still calculates that month (fixed: the new engine never changes them);
 *   · whether the Category B orders a version leaves out of Category A are still the ones it was calculated with.
 * Nothing here is used for Categories B–G.
 */

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const rowsOf = <T>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
interface Actor {
  id: string;
  name: string;
}

export const A_REVIEWS_NOT_READY = "Acknowledging a held Category A item needs database update 0142, so nothing was recorded. Until then, resolve it at its source (Forms, or the calculation's inputs) and recalculate.";

/** Whether 0142's tables exist (asked in a way that can't fail inside a transaction). */
export async function aSafeguardsReady(q: Db = db): Promise<boolean> {
  return rowsOf<{ ok: boolean }>(await q.execute(sql`select to_regclass('public.incentive_calc_a_reviews') is not null and to_regclass('public.incentive_calc_negative_decisions') is not null as ok`))[0]?.ok === true;
}

/* ── held items ─────────────────────────────────────────────────────────── */

export interface HeldItem extends Note {
  code: HoldCode;
  label: string;
  /** The active acknowledgment, if any. */
  acknowledged: { id: string; reason: string; byName: string; at: string } | null;
}

const keyOf = (h: { documentId: string | null; code?: string }) => `${h.documentId}|${h.code}`;

/** A run's held items with their acknowledgments (none before 0142). Reads only. */
export async function heldItems(q: Db, runId: string): Promise<HeldItem[]> {
  const [run] = await q.select({ result: incentiveCalcRuns.result }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const held = ((run?.result as CategoryAResult | undefined)?.held ?? []).map((h) => ({ ...h, code: (h.code ?? "receipt") as HoldCode }));
  const ids = [...new Set(held.map((h) => h.documentId).filter((x): x is string => !!x && UUID.test(x)))];
  const acks = ids.length && (await aSafeguardsReady(q)) ? await q.select().from(incentiveCalcAReviews).where(and(inArray(incentiveCalcAReviews.documentId, ids), isNull(incentiveCalcAReviews.retiredAt))) : [];
  const byKey = new Map(acks.map((a) => [`${a.documentId}|${a.holdCode}`, a]));
  return held.map((h) => {
    const a = byKey.get(keyOf(h));
    return { ...h, label: HOLD_LABEL[h.code] ?? h.code, acknowledged: a ? { id: a.id, reason: a.reason, byName: a.createdByName, at: a.createdAt.toISOString() } : null };
  });
}

/**
 * Why a Category A month can't go on to `step` because something its calculation held is neither resolved nor
 * acknowledged, or null. Fail-closed: before 0142 nothing can be acknowledged, so every hold blocks. Reads only.
 */
export async function aUnresolved(q: Db, runId: string, step: "submit" | "approve" | "pay"): Promise<string | null> {
  const open = (await heldItems(q, runId)).filter((h) => !h.acknowledged);
  if (!open.length) return null;
  const what = { submit: "submitted", approve: "approved", pay: "paid" }[step];
  const fix = step === "submit" ? "resolve each at its source and recalculate (the month must be reopened first if it is locked), or acknowledge it with a reason" : step === "approve" ? "reject the month, then resolve or acknowledge them" : "resolve or acknowledge them first";
  const list = open.slice(0, 3).map((h) => `${h.documentNo ?? "a document"} (${h.label.toLowerCase()})`).join(", ");
  const ready = await aSafeguardsReady(q);
  return `${open.length} item${open.length === 1 ? "" : "s"} of this month ${open.length === 1 ? "is" : "are"} held: ${list}${open.length > 3 ? ", …" : ""}. ${ready ? `To go on, ${fix}` : "Acknowledging a held item needs database update 0142; until then, resolve each at its source and recalculate"}. Nothing was ${what}.`;
}

/** Whether the person recorded or retired an acknowledgment of an item the run holds (they never approve that month). */
export async function acknowledgedHeld(q: Db, runId: string, actorId: string): Promise<boolean> {
  if (!(await aSafeguardsReady(q))) return false;
  const r = await q.execute(sql`
    select exists (
      select 1 from incentive_calc_runs run
      cross join lateral jsonb_array_elements(coalesce(run.result->'held', '[]'::jsonb)) h
      join incentive_calc_a_reviews v on v.document_id::text = h->>'documentId' and v.hold_code = h->>'code'
      where run.id = ${runId} and (v.created_by_id = ${actorId} or v.retired_by_id = ${actorId})
    ) as yes`);
  return rowsOf<{ yes: boolean }>(r)[0]?.yes === true;
}

/** The document must be held, with that code, in the adopted calculation of an open or locked Category A month. */
async function heldNow(q: Db, documentId: string, code: HoldCode): Promise<boolean> {
  const r = await q.execute(sql`
    select exists (
      select 1 from incentive_calc_periods p join incentive_calc_runs run on run.id = p.current_run_id
      cross join lateral jsonb_array_elements(coalesce(run.result->'held', '[]'::jsonb)) h
      where p.category_code = 'A' and p.status in ('open', 'locked') and h->>'documentId' = ${documentId} and coalesce(h->>'code', 'receipt') = ${code}
    ) as yes`);
  return rowsOf<{ yes: boolean }>(r)[0]?.yes === true;
}

/** Acknowledge a held item (it stays as calculated), with a reason. Recorded, never edited; retired to undo. */
export async function acknowledgeHeld(actor: Actor, input: { documentId: string; code: string; reason: string }): Promise<Result<{ id: string }>> {
  const reason = input.reason.trim();
  if (!UUID.test(input.documentId) || !(HOLD_CODES as readonly string[]).includes(input.code)) return { ok: false, error: "Choose a held item." };
  if (!reason || reason.length > 1000) return { ok: false, error: "Say why it is acknowledged (up to 1,000 characters)." };
  if (!(await aSafeguardsReady())) return { ok: false, error: A_REVIEWS_NOT_READY };
  const code = input.code as HoldCode;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_calc_a_reviews'), hashtext(${`${input.documentId}|${code}`}))`);
    const [doc] = await tx.select({ id: tallyDocuments.id, no: tallyDocuments.documentNo }).from(tallyDocuments).where(eq(tallyDocuments.id, input.documentId));
    if (!doc) return { ok: false as const, error: "That document isn't in Forms." };
    if (!(await heldNow(tx, doc.id, code))) return { ok: false as const, error: `${doc.no} isn't held that way in any open or locked Category A month's calculation. Recalculate the month first.` };
    const [cur] = await tx.select({ id: incentiveCalcAReviews.id }).from(incentiveCalcAReviews).where(and(eq(incentiveCalcAReviews.documentId, doc.id), eq(incentiveCalcAReviews.holdCode, code), isNull(incentiveCalcAReviews.retiredAt)));
    if (cur) return { ok: false as const, error: `${doc.no} is already acknowledged; retire that acknowledgment first to record another.` };
    const [row] = await tx.insert(incentiveCalcAReviews).values({ documentId: doc.id, holdCode: code, decision: "acknowledged", reason, createdById: actor.id, createdByName: actor.name }).returning({ id: incentiveCalcAReviews.id });
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "a-hold-acknowledged", entityType: "incentive-calc-a-review", entityId: row!.id, detail: { documentId: doc.id, documentNo: doc.no, code, reason } });
    return { ok: true as const, id: row!.id };
  });
}

/** Retire an acknowledgment (the item holds the month again), with a reason. */
export async function retireAcknowledgment(actor: Actor, id: string, reason: string): Promise<Result> {
  const why = reason.trim();
  if (!UUID.test(id)) return { ok: false, error: "That acknowledgment doesn't exist." };
  if (!why || why.length > 1000) return { ok: false, error: "Say why it is retired (up to 1,000 characters)." };
  if (!(await aSafeguardsReady())) return { ok: false, error: A_REVIEWS_NOT_READY };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(incentiveCalcAReviews).where(eq(incentiveCalcAReviews.id, id)).for("update");
    if (!row) return { ok: false as const, error: "That acknowledgment doesn't exist." };
    if (row.retiredAt) return { ok: false as const, error: "It was already retired." };
    await tx.update(incentiveCalcAReviews).set({ retiredAt: new Date(), retiredById: actor.id, retiredReason: why }).where(eq(incentiveCalcAReviews.id, id));
    await tx.insert(incentiveAudit).values({ actorId: actor.id, action: "a-hold-acknowledgment-retired", entityType: "incentive-calc-a-review", entityId: id, detail: { documentId: row.documentId, code: row.holdCode, reason: why } });
    return { ok: true as const };
  });
}

/* ── the all-categories limit: one combined limit, every programme, the old engine ── */

/**
 * The all-categories limit for a Category A calculation: the same programme's other categories (as before), PLUS every
 * other programme's adopted month of any category (Category A included) and the old engine's amounts for the month of
 * the categories it still calculates (not cut over to a new engine that month) — the limit is one per salesperson
 * across every category and every programme. Those other programmes' and the old engine's figures are "fixed" when
 * their month is no longer open (the old engine's always): they are never changed by this calculation. Undefined when
 * there is nothing else to share with (the calculation then applies its own limit alone). Reads only.
 */
export async function aAllCategoriesFor(q: Db, programId: string, month: string, config: IncentiveConfig | null): Promise<AllCategoriesIn | undefined> {
  if (!config) return undefined;
  const base = await allCategoriesFor(q, programId, month, "A", config);
  const others: Record<string, OtherCategoryAmount[]> = Object.fromEntries(Object.entries(base?.others ?? {}).map(([k, v]) => [k, [...v]]));
  let extra = 0;
  // Other programmes' adopted months (any category), by programme code.
  const rows = rowsOf<{ code: string; category: string; status: string; result: unknown }>(
    await q.execute(sql`
      select pr.code, p.category_code as category, p.status, run.result from incentive_calc_periods p
      join incentive_programs pr on pr.id = p.program_id
      join incentive_calc_runs run on run.id = p.current_run_id
      where p.program_id <> ${programId} and p.month = ${month}::date
      order by pr.code, p.category_code`),
  );
  for (const r of rows) {
    const emps = ((r.result as { employees?: ({ employeeId: string } & StoredShare)[] } | null)?.employees ?? []).slice().sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));
    for (const e of emps) {
      (others[e.employeeId] ??= []).push({ category: `${r.category} · ${r.code}`, ...sharedShareOf(e), fixed: r.status !== "open" });
      extra++;
    }
  }
  // The old engine's amounts for the categories it still calculates this month (never A itself: from a month a Category
  // A version covers, the old engine leaves Category A to the new one for the people it covers).
  const period = month.slice(0, 7);
  const oldReady = rowsOf<{ ok: boolean }>(await q.execute(sql`select to_regclass('public.incentive_ledger') is not null and to_regclass('public.incentive_periods') is not null as ok`))[0]?.ok === true;
  const cut = rowsOf<{ c: string }>(await q.execute(sql`select distinct v.category_code as c from incentive_config_versions v where v.status = 'published' and v.effective_from <= ${month}::date and (v.effective_to is null or v.effective_to >= ${month}::date)`)).map((x) => x.c);
  const old = !oldReady ? [] : rowsOf<{ employee_id: string; category: string; amount: string }>(
    await q.execute(sql`
      select l.employee_id::text, l.category, sum(l.amount_paise)::text as amount from incentive_ledger l
      join incentive_periods ip on ip.id = l.period_id
      where ip.month = ${period} and l.category <> 'A' ${cut.length ? sql`and l.category not in (${sql.join(cut.map((c) => sql`${c}`), sql`, `)})` : sql``}
      group by l.employee_id, l.category order by 1, 2`),
  );
  for (const o of old) {
    const amt = Math.max(0, Number(o.amount));
    if (!amt) continue;
    (others[o.employee_id] ??= []).push({ category: `${o.category} (old engine)`, prePaise: amt, finalPaise: amt, fixed: true });
    extra++;
  }
  if (!base && !extra) return undefined;
  if (base) return { ...base, others };
  const capSetting = config.settings["caps.perEmployeeAllCategoriesMonth"];
  const policy = ((config.settings["caps.allCategoriesPolicy"] as string | undefined) ?? "proportional") as AllCategoriesIn["policy"];
  return { capPaise: capSetting === "none" || capSetting === undefined ? null : (capSetting as number), policy, order: (config.settings["caps.allCategoriesOrder"] as string[] | undefined) ?? [], others };
}

/* ── Category B orders left out of Category A ───────────────────────────── */

/**
 * For a run whose version leaves Category B orders out of Category A: why the orders that earn Category B changed
 * since (for the run's own orders) — it is recalculated before it goes on — or null. Reads only.
 */
export async function staleCategoryBOrders(q: Db, programId: string, runId: string): Promise<string | null> {
  const [run] = await q.select({ inputs: incentiveCalcRuns.inputs }).from(incentiveCalcRuns).where(eq(incentiveCalcRuns.id, runId));
  const inputs = run?.inputs as { categoryBOrderIds?: string[]; orders?: { id: string }[] } | undefined;
  if (!inputs?.categoryBOrderIds) return null;
  const mine = new Set((inputs.orders ?? []).map((o) => o.id));
  const was = inputs.categoryBOrderIds.filter((id) => mine.has(id)).sort();
  const now = (await categoryBOrderIds(q, programId)).filter((id) => mine.has(id)).sort();
  if (was.join() === now.join()) return null;
  return "The Sales Orders that earn Category B changed since this month was calculated (its version leaves them out of Category A): reopen and recalculate it before it goes on.";
}

