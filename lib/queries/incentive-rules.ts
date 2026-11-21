import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  departments,
  employees,
  incentiveConfigDelaySteps,
  incentiveConfigEligibility,
  incentiveConfigHistory,
  incentiveConfigSettings,
  incentiveConfigSlabs,
  incentiveConfigVersions,
  incentivePrograms,
} from "@/db/schema";
import { EMPLOYEE_ROLES } from "@/db/enums";
import { isMissingTable } from "@/lib/queries/collection-master";
import { createHash } from "node:crypto";
import { CONFIGURABLE_CATEGORIES, EMPTY_CONFIG, referenceTemplateFor, type CategoryCode, type IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import { canonical } from "@/lib/incentives/category-a/hash";
import { checkConfig, dayBefore, isMonthStart, type CheckContext } from "@/lib/incentives/rules-config/validate";

/**
 * Admin & Master Setup → Incentive Rules: the stored programmes and configuration versions (migration 0131) and the
 * workflow over them — draft, save, submit, withdraw, approve, reject, return to draft, discard, publish. Nothing here
 * authorizes: the server actions hold the rights (lib/auth/incentive-rules.ts) and pass who is acting.
 *
 * Every change is one transaction, serialised per programme (an advisory lock), names the row version the screen read
 * (a change made meanwhile is never overwritten) and appends its before and after to the history. The database refuses
 * what the workflow must never do, whatever calls it: see the migration's triggers. Nothing here calculates an
 * incentive or writes to the incentive ledger.
 */

type Q = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Status = "draft" | "submitted" | "approved" | "rejected" | "published" | "discarded";
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const CHECK_CONTEXT: CheckContext = { roles: EMPLOYEE_ROLES };
/** The checking context for a version of a category. */
export const checkContextFor = (category: string): CheckContext => ({ ...CHECK_CONTEXT, category: category as CategoryCode });
/** A configuration's fingerprint: sha256 of its canonical JSON, recorded in the history when a version is published. */
export const configHash = (c: IncentiveConfig) => createHash("sha256").update(canonical(c)).digest("hex");
const STALE = "This version was changed by someone else meanwhile. Nothing was saved; reload to see it as it is now.";
export const NOT_READY = "Incentive Rules need database update 0131 first, so nothing was saved.";

/** Whether migration 0131's tables exist — asked in a way that can't fail inside a transaction. */
export async function incentiveRulesReady(q: Q = db): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.incentive_config_versions') is not null and to_regclass('public.incentive_config_history') is not null as ok`);
  const rows = (Array.isArray(r) ? r : ((r as unknown as { rows?: unknown[] }).rows ?? [])) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** The first day of the current month in India (yyyy-mm-dd). */
export function currentMonthStartIST(now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `${ymd.slice(0, 7)}-01`;
}

/* ── reading ─────────────────────────────────────────────────────────── */

export type VersionRow = typeof incentiveConfigVersions.$inferSelect;
export type ProgramRow = typeof incentivePrograms.$inferSelect;

export interface VersionSummary extends VersionRow {
  createdByName: string | null;
  approvedByName: string | null;
  publishedByName: string | null;
}

async function nameOf(q: Q, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [r] = await q.select({ name: employees.name }).from(employees).where(eq(employees.id, id)).limit(1);
  return r?.name ?? null;
}

/** Every programme with its versions (newest first), for the list screen. */
export async function listProgramsWithVersions(q: Q = db): Promise<{ ready: boolean; programs: (ProgramRow & { versions: VersionSummary[] })[] }> {
  if (!(await incentiveRulesReady(q))) return { ready: false, programs: [] };
  const programs = await q.select().from(incentivePrograms).orderBy(asc(incentivePrograms.code));
  const versions = await q.select().from(incentiveConfigVersions).orderBy(desc(incentiveConfigVersions.versionNo));
  const ids = [...new Set(versions.flatMap((v) => [v.createdById, v.approvedById, v.publishedById]).filter((x): x is string => !!x))];
  const names = new Map(ids.length ? (await q.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids))).map((e) => [e.id, e.name]) : []);
  return {
    ready: true,
    programs: programs.map((p) => ({
      ...p,
      versions: versions
        .filter((v) => v.programId === p.id)
        .map((v) => ({ ...v, createdByName: names.get(v.createdById ?? "") ?? null, approvedByName: names.get(v.approvedById ?? "") ?? null, publishedByName: names.get(v.publishedById ?? "") ?? null })),
    })),
  };
}

/** A version's configuration, assembled from its rows. */
export async function loadConfig(q: Q, versionId: string): Promise<IncentiveConfig> {
  const [settings, slabs, steps, rows] = await Promise.all([
    q.select().from(incentiveConfigSettings).where(eq(incentiveConfigSettings.versionId, versionId)),
    q.select().from(incentiveConfigSlabs).where(eq(incentiveConfigSlabs.versionId, versionId)).orderBy(asc(incentiveConfigSlabs.position)),
    q.select().from(incentiveConfigDelaySteps).where(eq(incentiveConfigDelaySteps.versionId, versionId)).orderBy(asc(incentiveConfigDelaySteps.position)),
    q.select().from(incentiveConfigEligibility).where(eq(incentiveConfigEligibility.versionId, versionId)).orderBy(asc(incentiveConfigEligibility.position)),
  ]);
  return {
    settings: Object.fromEntries(settings.map((s) => [s.settingKey, s.value])),
    slabs: slabs.map((s) => ({ lineCode: s.lineCode, label: s.label, fromPaise: Number(s.fromPaise), toPaise: Number(s.toPaise), valueType: s.valueType, ratePpm: s.ratePpm, fixedPaise: s.fixedPaise === null ? null : Number(s.fixedPaise), capPaise: s.capPaise === null ? null : Number(s.capPaise) })),
    delaySteps: steps.map((s) => ({ fromDays: s.fromDays, toDays: s.toDays, multiplierPpm: s.multiplierPpm })),
    eligibility: rows.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, role: r.role, subjectLabel: r.subjectLabel, mode: r.mode, effectiveFrom: String(r.effectiveFrom), effectiveTo: r.effectiveTo === null ? null : String(r.effectiveTo) })),
  };
}

export interface HistoryEntry {
  eventNo: number;
  versionId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  note: string | null;
  actorId: string | null;
  actorName: string | null;
  at: Date;
}

export async function versionHistory(q: Q, versionId: string): Promise<HistoryEntry[]> {
  const rows = await q.select().from(incentiveConfigHistory).where(eq(incentiveConfigHistory.versionId, versionId)).orderBy(asc(incentiveConfigHistory.eventNo));
  return rows.map((r) => ({ ...r, eventNo: Number(r.eventNo) }));
}

export async function programHistory(q: Q, programId: string, limit = 200): Promise<HistoryEntry[]> {
  const rows = await q.select().from(incentiveConfigHistory).where(eq(incentiveConfigHistory.programId, programId)).orderBy(desc(incentiveConfigHistory.eventNo)).limit(limit);
  return rows.map((r) => ({ ...r, eventNo: Number(r.eventNo) }));
}

/** Everyone who wrote a version: its author, its submitter and every editor in its history. None of them may approve it. */
async function writersOf(q: Q, v: VersionRow): Promise<Set<string>> {
  const rows = await q
    .select({ actorId: incentiveConfigHistory.actorId })
    .from(incentiveConfigHistory)
    .where(and(eq(incentiveConfigHistory.versionId, v.id), inArray(incentiveConfigHistory.action, ["create", "edit", "submit"])));
  return new Set([v.createdById, v.submittedById, ...rows.map((r) => r.actorId)].filter((x): x is string => !!x));
}

export interface VersionDetail {
  version: VersionSummary;
  program: ProgramRow;
  config: IncentiveConfig;
  writers: string[];
  /** The published version of the same programme and category in force on the first day of `month` (yyyy-mm-dd). */
  inForce: VersionRow | null;
}

export async function getVersion(versionId: string, q: Q = db): Promise<VersionDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const [v] = await q.select().from(incentiveConfigVersions).where(eq(incentiveConfigVersions.id, versionId)).limit(1);
  if (!v) return null;
  const [program] = await q.select().from(incentivePrograms).where(eq(incentivePrograms.id, v.programId)).limit(1);
  const [config, writers, createdByName, approvedByName, publishedByName] = await Promise.all([loadConfig(q, v.id), writersOf(q, v), nameOf(q, v.createdById), nameOf(q, v.approvedById), nameOf(q, v.publishedById)]);
  return { version: { ...v, createdByName, approvedByName, publishedByName }, program: program!, config, writers: [...writers], inForce: await versionInForce(q, v.programId, v.categoryCode, currentMonthStartIST()) };
}

/** The published version of a programme's category in force on `day`, or null. */
export async function versionInForce(q: Q, programId: string, category: string, day: string): Promise<VersionRow | null> {
  const [v] = await q
    .select()
    .from(incentiveConfigVersions)
    .where(and(eq(incentiveConfigVersions.programId, programId), eq(incentiveConfigVersions.categoryCode, category), eq(incentiveConfigVersions.status, "published"), sql`${incentiveConfigVersions.effectiveFrom} <= ${day}::date and (${incentiveConfigVersions.effectiveTo} is null or ${incentiveConfigVersions.effectiveTo} >= ${day}::date)`))
    .limit(1);
  return v ?? null;
}

/* ── writing ─────────────────────────────────────────────────────────── */

export interface Actor {
  id: string;
  name: string;
}

const lock = (tx: Tx, programId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_rules'), hashtext(${programId}))`);

async function history(tx: Tx, actor: Actor, programId: string, versionId: string | null, action: string, before: unknown, after: unknown, note: string | null = null) {
  await tx.insert(incentiveConfigHistory).values({ programId, versionId, action, before: before ?? null, after: after ?? null, note, actorId: actor.id, actorName: actor.name });
}

const versionState = (v: VersionRow) => ({ status: v.status, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, rowVersion: v.rowVersion });

export async function createProgram(actor: Actor, input: { code: string; name: string; description: string | null }): Promise<Result<{ programId: string }>> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) return { ok: false, error: "The code must be 2–32 capital letters, digits, dashes or underscores." };
  if (!name || name.length > 120) return { ok: false, error: "Give the programme a name of up to 120 characters." };
  if ((input.description ?? "").length > 1000) return { ok: false, error: "The description is longer than 1,000 characters." };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_rules_programs'))`);
    const [dupe] = await tx.select({ id: incentivePrograms.id }).from(incentivePrograms).where(eq(incentivePrograms.code, code)).limit(1);
    if (dupe) return { ok: false as const, error: `There is already a programme with code ${code}.` };
    const [p] = await tx.insert(incentivePrograms).values({ code, name, description: input.description?.trim() || null, createdById: actor.id, updatedById: actor.id }).returning();
    await history(tx, actor, p!.id, null, "create_program", null, { code, name, description: p!.description });
    return { ok: true as const, programId: p!.id };
  });
}

/** A new draft of a programme's category: empty, from the reference template, or a copy of another version. */
export async function createDraft(actor: Actor, input: { programId: string; category: CategoryCode; startFrom: "blank" | "reference" | { versionId: string } }): Promise<Result<{ versionId: string }>> {
  if (!CONFIGURABLE_CATEGORIES.includes(input.category)) return { ok: false, error: `Category ${input.category} has no specification yet, so it can't be configured.` };
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    await lock(tx, input.programId);
    const [p] = await tx.select().from(incentivePrograms).where(eq(incentivePrograms.id, input.programId)).limit(1);
    if (!p) return { ok: false as const, error: "That programme doesn't exist." };
    if (!p.isActive) return { ok: false as const, error: "That programme is inactive." };
    let config: IncentiveConfig = EMPTY_CONFIG;
    if (input.startFrom === "reference") config = referenceTemplateFor(input.category);
    else if (typeof input.startFrom === "object") {
      const [src] = await tx.select().from(incentiveConfigVersions).where(eq(incentiveConfigVersions.id, input.startFrom.versionId)).limit(1);
      if (!src || src.programId !== p.id || src.categoryCode !== input.category) return { ok: false as const, error: "Copy a version of the same programme and category." };
      config = await loadConfig(q, src.id);
    }
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${incentiveConfigVersions.versionNo}), 0)` })
      .from(incentiveConfigVersions)
      .where(and(eq(incentiveConfigVersions.programId, p.id), eq(incentiveConfigVersions.categoryCode, input.category)));
    const [v] = await tx.insert(incentiveConfigVersions).values({ programId: p.id, categoryCode: input.category, versionNo: Number(last?.n ?? 0) + 1, createdById: actor.id, updatedById: actor.id }).returning();
    await writeContents(tx, v!.id, config);
    await history(tx, actor, p.id, v!.id, "create", null, { ...versionState(v!), versionNo: v!.versionNo, startFrom: typeof input.startFrom === "object" ? `copy of ${input.startFrom.versionId}` : input.startFrom, config });
    return { ok: true as const, versionId: v!.id };
  });
}

async function writeContents(tx: Tx, versionId: string, c: IncentiveConfig) {
  await tx.delete(incentiveConfigSettings).where(eq(incentiveConfigSettings.versionId, versionId));
  await tx.delete(incentiveConfigSlabs).where(eq(incentiveConfigSlabs.versionId, versionId));
  await tx.delete(incentiveConfigDelaySteps).where(eq(incentiveConfigDelaySteps.versionId, versionId));
  await tx.delete(incentiveConfigEligibility).where(eq(incentiveConfigEligibility.versionId, versionId));
  const settings = Object.entries(c.settings);
  if (settings.length) await tx.insert(incentiveConfigSettings).values(settings.map(([settingKey, value]) => ({ versionId, settingKey, value })));
  if (c.slabs.length) await tx.insert(incentiveConfigSlabs).values(c.slabs.map((s, i) => ({ versionId, position: i + 1, ...s })));
  if (c.delaySteps.length) await tx.insert(incentiveConfigDelaySteps).values(c.delaySteps.map((s, i) => ({ versionId, position: i + 1, ...s })));
  if (c.eligibility.length) await tx.insert(incentiveConfigEligibility).values(c.eligibility.map((r, i) => ({ versionId, position: i + 1, ...r })));
}

/** Every employee and department an eligibility row names must exist when it is saved. */
async function missingSubjects(q: Q, c: IncentiveConfig): Promise<string[]> {
  const empIds = c.eligibility.filter((r) => r.subjectType === "employee").map((r) => r.subjectId!);
  const depIds = c.eligibility.filter((r) => r.subjectType === "department").map((r) => r.subjectId!);
  const emps = new Set(empIds.length ? (await q.select({ id: employees.id }).from(employees).where(inArray(employees.id, empIds))).map((e) => e.id) : []);
  const deps = new Set(depIds.length ? (await q.select({ id: departments.id }).from(departments).where(inArray(departments.id, depIds))).map((d) => d.id) : []);
  return c.eligibility.filter((r) => (r.subjectType === "employee" && !emps.has(r.subjectId!)) || (r.subjectType === "department" && !deps.has(r.subjectId!))).map((r) => r.subjectLabel);
}

/** Loads the version for a change, checking its row version, under the programme's lock. */
async function forChange(tx: Tx, versionId: string, expectedRowVersion: number): Promise<VersionRow | string> {
  const [peek] = await tx.select({ programId: incentiveConfigVersions.programId }).from(incentiveConfigVersions).where(eq(incentiveConfigVersions.id, versionId)).limit(1);
  if (!peek) return "That version doesn't exist.";
  await lock(tx, peek.programId);
  const [v] = await tx.select().from(incentiveConfigVersions).where(eq(incentiveConfigVersions.id, versionId)).limit(1);
  if (!v) return "That version doesn't exist.";
  if (v.rowVersion !== expectedRowVersion) return STALE;
  return v;
}

/** Saves a draft's (or a rejected version's) configuration. It may be incomplete; it may not be wrong. A rejected version becomes a draft again. */
export async function saveDraft(actor: Actor, versionId: string, expectedRowVersion: number, config: IncentiveConfig, changeNote: string | null): Promise<Result<{ rowVersion: number; missing: number }>> {
  if ((changeNote ?? "").length > 1000) return { ok: false, error: "The change note is longer than 1,000 characters." };
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    const v = await forChange(tx, versionId, expectedRowVersion);
    if (typeof v === "string") return { ok: false as const, error: v };
    // Checked against the version's own category's settings.
    const { problems, missing } = checkConfig(config, checkContextFor(v.categoryCode));
    if (problems.length) return { ok: false as const, error: problems.map((p) => p.message).join(" ") };
    if (v.status !== "draft" && v.status !== "rejected") return { ok: false as const, error: `A ${v.status} version can't be edited. Create a new draft instead.` };
    const gone = await missingSubjects(q, config);
    if (gone.length) return { ok: false as const, error: `No longer exists: ${gone.join(", ")}.` };
    const before = await loadConfig(q, v.id);
    // A rejected version goes back to draft before its contents change (only drafts' and rejected versions' contents can).
    const [u] = await tx
      .update(incentiveConfigVersions)
      .set({ status: "draft", changeNote: changeNote?.trim() || null, rowVersion: v.rowVersion + 1, updatedById: actor.id, updatedAt: new Date() })
      .where(eq(incentiveConfigVersions.id, v.id))
      .returning();
    await writeContents(tx, v.id, config);
    await history(tx, actor, v.programId, v.id, "edit", { ...versionState(v), config: before }, { ...versionState(u!), config }, changeNote?.trim() || null);
    return { ok: true as const, rowVersion: u!.rowVersion, missing: missing.length };
  });
}

async function transition(
  actor: Actor,
  versionId: string,
  expectedRowVersion: number,
  action: string,
  check: (v: VersionRow, q: Q) => Promise<string | null>,
  set: (v: VersionRow) => Partial<typeof incentiveConfigVersions.$inferInsert>,
  note: string | null = null,
): Promise<Result<{ rowVersion: number }>> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    const v = await forChange(tx, versionId, expectedRowVersion);
    if (typeof v === "string") return { ok: false as const, error: v };
    const refused = await check(v, q);
    if (refused) return { ok: false as const, error: refused };
    const [u] = await tx.update(incentiveConfigVersions).set({ ...set(v), rowVersion: v.rowVersion + 1, updatedById: actor.id, updatedAt: new Date() }).where(eq(incentiveConfigVersions.id, v.id)).returning();
    await history(tx, actor, v.programId, v.id, action, versionState(v), versionState(u!), note);
    return { ok: true as const, rowVersion: u!.rowVersion };
  });
}

/** Whether a version is complete and right; the reason it isn't, or null. */
async function incomplete(q: Q, v: VersionRow): Promise<string | null> {
  const config = await loadConfig(q, v.id);
  const { problems, missing } = checkConfig(config, checkContextFor(v.categoryCode));
  if (problems.length) return `It has problems: ${problems.map((p) => p.message).join(" ")}`;
  if (missing.length) return `It isn't complete: ${missing.map((m) => m.message).join(" ")}`;
  const gone = await missingSubjects(q, config);
  if (gone.length) return `No longer exists: ${gone.join(", ")}.`;
  return null;
}

export const submit = (actor: Actor, id: string, rv: number) =>
  transition(actor, id, rv, "submit", async (v, q) => (v.status !== "draft" && v.status !== "rejected" ? `A ${v.status} version can't be submitted.` : incomplete(q, v)), () => ({ status: "submitted", submittedById: actor.id, submittedAt: new Date(), rejectedById: null, rejectedAt: null, rejectionReason: null }));

export const withdraw = (actor: Actor, id: string, rv: number) =>
  // Category A: only the person who submitted a version withdraws it (anyone else decides on it: approve or reject).
  transition(actor, id, rv, "withdraw", async (v) => (v.status !== "submitted" ? "Only a submitted version can be withdrawn." : v.categoryCode === "A" && v.submittedById !== actor.id ? "Only the person who submitted it can withdraw it; anyone else approves or rejects it." : null), () => ({ status: "draft", submittedById: null, submittedAt: null }));

export const approve = (actor: Actor, id: string, rv: number, note: string | null) =>
  transition(
    actor,
    id,
    rv,
    "approve",
    async (v, q) => {
      if (v.status !== "submitted") return "Only a submitted version can be approved.";
      if ((await writersOf(q, v)).has(actor.id)) return "You can't approve a version you created, edited or submitted. Another authorised person must approve it.";
      return incomplete(q, v);
    },
    () => ({ status: "approved", approvedById: actor.id, approvedAt: new Date() }),
    note,
  );

export const reject = (actor: Actor, id: string, rv: number, reason: string) =>
  transition(
    actor,
    id,
    rv,
    "reject",
    async (v, q) => {
      if (v.status !== "submitted") return "Only a submitted version can be rejected.";
      if (!reason.trim() || reason.length > 1000) return "Give the reason for rejecting it (up to 1,000 characters).";
      if ((await writersOf(q, v)).has(actor.id)) return "You can't decide on a version you created, edited or submitted.";
      return null;
    },
    () => ({ status: "rejected", rejectedById: actor.id, rejectedAt: new Date(), rejectionReason: reason.trim() }),
    reason.trim(),
  );

/** An approved (not yet published) version back to draft: its approval is cleared, and it must be approved again. */
export const returnToDraft = (actor: Actor, id: string, rv: number) =>
  transition(actor, id, rv, "return_to_draft", async (v) => (v.status !== "approved" ? "Only an approved version can be returned to draft." : null), () => ({ status: "draft", approvedById: null, approvedAt: null, submittedById: null, submittedAt: null }));

export const discard = (actor: Actor, id: string, rv: number) =>
  transition(actor, id, rv, "discard", async (v) => (v.status !== "draft" && v.status !== "rejected" ? "Only a draft or rejected version can be discarded." : null), () => ({ status: "discarded" }));

/**
 * Publishes an approved version from `effectiveFrom` (the first day of a month) onwards. The published version in
 * force on that day ends the day before; a published version starting on or after it means the dates would overlap,
 * so publishing is refused. A month before the current one needs the back-dating right.
 */
export async function publish(actor: Actor, versionId: string, expectedRowVersion: number, effectiveFrom: string, opts: { canBackdate: boolean; today?: Date }): Promise<Result<{ rowVersion: number; superseded: string | null }>> {
  if (!isMonthStart(effectiveFrom)) return { ok: false, error: "A version takes effect from the first day of a month." };
  if (effectiveFrom < currentMonthStartIST(opts.today) && !opts.canBackdate) return { ok: false, error: "Publishing from an earlier month needs the “Incentive Rules — Publish from an earlier month” permission." };
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    const v = await forChange(tx, versionId, expectedRowVersion);
    if (typeof v === "string") return { ok: false as const, error: v };
    if (v.status !== "approved") return { ok: false as const, error: "Only an approved version can be published." };
    const why = await incomplete(q, v);
    if (why) return { ok: false as const, error: why };
    {
      const c = v.categoryCode;
      const overlap = await oldEngineCategoryFinal(q, c, effectiveFrom);
      if (overlap.length) return { ok: false as const, error: `The old engine's Category ${c} is already ${overlap.map((o) => `${o.status} for ${o.month}`).join(", ")}. Publishing Category ${c} from ${effectiveFrom.slice(0, 7)} would pay Category ${c} twice for ${overlap.length === 1 ? "that month" : "those months"}: publish from a later month. Nothing was changed.` };
    }
    const later = await tx
      .select({ versionNo: incentiveConfigVersions.versionNo, from: incentiveConfigVersions.effectiveFrom })
      .from(incentiveConfigVersions)
      .where(and(eq(incentiveConfigVersions.programId, v.programId), eq(incentiveConfigVersions.categoryCode, v.categoryCode), eq(incentiveConfigVersions.status, "published"), sql`${incentiveConfigVersions.effectiveFrom} >= ${effectiveFrom}::date`))
      .limit(1);
    if (later[0]) return { ok: false as const, error: `Version ${later[0].versionNo} is already published from ${later[0].from}; a version can only be published from a later month than every published one.` };
    const current = await versionInForce(q, v.programId, v.categoryCode, effectiveFrom);
    let superseded: string | null = null;
    if (current) {
      const end = dayBefore(effectiveFrom);
      const [s] = await tx.update(incentiveConfigVersions).set({ effectiveTo: end, rowVersion: current.rowVersion + 1, updatedById: actor.id, updatedAt: new Date() }).where(eq(incentiveConfigVersions.id, current.id)).returning();
      await history(tx, actor, v.programId, current.id, "supersede", versionState(current), versionState(s!), `Ends ${end}: version ${v.versionNo} applies from ${effectiveFrom}.`);
      superseded = current.id;
    }
    const [u] = await tx
      .update(incentiveConfigVersions)
      .set({ status: "published", effectiveFrom, effectiveTo: null, publishedById: actor.id, publishedAt: new Date(), rowVersion: v.rowVersion + 1, updatedById: actor.id, updatedAt: new Date() })
      .where(eq(incentiveConfigVersions.id, v.id))
      .returning();
    // The published configuration's fingerprint is recorded with the publication (the version itself never changes).
    await history(tx, actor, v.programId, v.id, "publish", versionState(v), { ...versionState(u!), configHash: configHash(await loadConfig(q, v.id)) }, effectiveFrom < currentMonthStartIST(opts.today) ? `Back-dated to ${effectiveFrom}.` : null);
    return { ok: true as const, rowVersion: u!.rowVersion, superseded };
  });
}

/**
 * The cut-over safeguard for every category (A–G): the OLD engine's months, from `effectiveFrom` on, that are locked or paid
 * and hold amounts of that category. Publishing the category's version over one of them would pay it twice, so it is
 * refused. No reconciliation of an old-engine month with the new engine exists, so there is no exception. Reads only.
 */
export async function oldEngineCategoryFinal(q: Q, category: string, effectiveFrom: string): Promise<{ month: string; status: string }[]> {
  const r = await q.execute(sql`
    select case when to_regclass('public.incentive_periods') is null or to_regclass('public.incentive_ledger') is null then null else 1 end as ok`);
  const ok = ((Array.isArray(r) ? r : ((r as unknown as { rows?: unknown[] }).rows ?? [])) as { ok: number | null }[])[0]?.ok;
  if (!ok) return [];
  const rows = await q.execute(sql`
    select p.month, p.status from incentive_periods p
    where p.status in ('locked', 'paid') and p.month >= ${effectiveFrom.slice(0, 7)}
      and exists (select 1 from incentive_ledger l where l.period_id = p.id and l.category = ${category} and l.amount_paise <> 0)
    order by p.month`);
  return (Array.isArray(rows) ? rows : ((rows as unknown as { rows?: unknown[] }).rows ?? [])) as { month: string; status: string }[];
}

/** Whether a database error means 0131 isn't applied (so the screens can say so). */
export const isIncentiveRulesMissing = (err: unknown) => isMissingTable(err);

/** The people and departments the eligibility editor offers. */
export async function eligibilityChoices(q: Q = db): Promise<{ employees: { id: string; label: string }[]; departments: { id: string; label: string }[]; roles: readonly string[] }> {
  const [emps, deps] = await Promise.all([
    q.select({ id: employees.id, label: employees.name }).from(employees).where(eq(employees.isActive, true)).orderBy(asc(employees.name)),
    q.select({ id: departments.id, label: departments.name }).from(departments).orderBy(asc(departments.name)),
  ]);
  return { employees: emps, departments: deps, roles: EMPLOYEE_ROLES };
}
