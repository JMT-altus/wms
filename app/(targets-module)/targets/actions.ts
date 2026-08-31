"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMasters,
  employees,
  forecastActuals,
  forecastEvents,
  forecastGrowthSplits,
  forecastLines,
  forecastTargets,
  importBatches,
  orgSettings,
} from "@/db/schema";
import type { Employee } from "@/db/schema";
import type { ForecastPeriodKind } from "@/db/enums";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { canEditField } from "@/lib/auth/field-access";
import { rateLimitOrError } from "@/lib/rate-limit";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { istYmd } from "@/lib/weekly-goals/week";
import {
  AllocateTargetSchema,
  CompanyTargetSchema,
  EstimateSchema,
  ForecastCadenceSchema,
  ForecastLineSchema,
  GrowthSplitSchema,
  PeriodTargetSchema,
  RedivideSchema,
} from "@/lib/validators/targets";
import {
  annualKey,
  childPeriods,
  findPeriod,
  isLocked,
  periodsOfKind,
  splitPaise,
  valueFromQtyRate,
  type PeriodRef,
} from "@/lib/targets/period";

export type Result = { ok: true; id?: string } | { ok: false; error: string };
type Denied = { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function revalidateTargets(): void {
  for (const p of [
    "/targets",
    "/targets/annual",
    "/targets/quarterly",
    "/targets/monthly",
    "/targets/weekly",
    "/targets/dashboard",
    "/targets/hygiene",
  ]) {
    revalidatePath(p);
  }
}

/**
 * Writes are gated on the MODULE grant, not `isAdmin` — the grant is the
 * permission, and admins pass via the resolver's bypass. Same reasoning as the
 * Masters module. Returns a Result rather than redirecting so forms can explain.
 */
async function guard(): Promise<{ me: Employee } | { error: Denied }> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return { error: { ok: false, error: "Please sign in again." } };
  if (!(await canAccessModule("targets"))) {
    return { error: { ok: false, error: "You don't have access to Targets & Forecasts." } };
  }
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { error: limited };
  return { me };
}

/** Setting and allocating the company number stays with admins. */
async function adminGuard(): Promise<{ me: Employee } | { error: Denied }> {
  const g = await guard();
  if ("error" in g) return g;
  if (!g.me.isAdmin) {
    return { error: { ok: false, error: "Only an admin can change targets." } };
  }
  return g;
}

function zodError(err: unknown): string {
  const issues = (err as { issues?: { message: string }[] })?.issues;
  return issues?.[0]?.message ?? "Please check the values and try again.";
}

async function audit(
  actorId: string,
  action: string,
  ref: { lineId?: string; targetId?: string },
  field?: string,
  from?: string | number | null,
  to?: string | number | null,
): Promise<void> {
  await db
    .insert(forecastEvents)
    .values({
      lineId: ref.lineId ?? null,
      targetId: ref.targetId ?? null,
      actorId,
      action,
      field: field ?? null,
      fromValue: from == null ? null : String(from),
      toValue: to == null ? null : String(to),
    })
    .catch(() => {
      // An audit failure must never lose the user's edit. The write already
      // happened; swallow rather than surfacing a confusing error.
    });
}

/**
 * A period a non-admin may still edit. Admins bypass the lock — somebody has to
 * be able to correct a closed period, and every such edit is audited.
 */
async function assertEditable(
  me: Employee,
  fyStartYear: number,
  kind: ForecastPeriodKind,
  key: string,
): Promise<Denied | null> {
  if (me.isAdmin) return null;
  const period = findPeriod(fyStartYear, kind, key);
  if (!period) return { ok: false, error: "Unknown period." };
  const s = await getOrgSettings();
  const locked = isLocked(
    period,
    {
      monthlyDay: s.forecastMonthlyDay,
      weeklyDow: s.forecastWeeklyDow,
      lockDays: s.forecastLockDays,
    },
    istYmd(new Date()),
  );
  return locked
    ? { ok: false, error: `${period.label} is closed. Ask an admin to reopen it.` }
    : null;
}

/* ── Targets ─────────────────────────────────────────────────────────────── */

async function upsertTarget(
  fyStartYear: number,
  kind: ForecastPeriodKind,
  key: string,
  employeeId: string | null,
  targetPaise: number,
  isDerived: boolean,
  actorId: string,
): Promise<string> {
  const match = and(
    eq(forecastTargets.fyStartYear, fyStartYear),
    eq(forecastTargets.periodKind, kind),
    eq(forecastTargets.periodKey, key),
    employeeId === null
      ? isNull(forecastTargets.employeeId)
      : eq(forecastTargets.employeeId, employeeId),
  );
  const [existing] = await db
    .select({ id: forecastTargets.id, targetPaise: forecastTargets.targetPaise })
    .from(forecastTargets)
    .where(match)
    .limit(1);

  if (existing) {
    await db
      .update(forecastTargets)
      .set({ targetPaise, isDerived, updatedById: actorId, updatedAt: new Date() })
      .where(eq(forecastTargets.id, existing.id));
    if (existing.targetPaise !== targetPaise) {
      await audit(actorId, "target_changed", { targetId: existing.id }, "target", existing.targetPaise, targetPaise);
    }
    return existing.id;
  }
  const [row] = await db
    .insert(forecastTargets)
    .values({
      fyStartYear,
      periodKind: kind,
      periodKey: key,
      employeeId,
      targetPaise,
      isDerived,
      createdById: actorId,
      updatedById: actorId,
    })
    .returning({ id: forecastTargets.id });
  await audit(actorId, "target_set", { targetId: row!.id }, "target", null, targetPaise);
  return row!.id;
}

/**
 * Seed quarters, months and weeks from an annual number.
 *
 * Rows a person has edited (`isDerived = false`) are left alone unless
 * `overwrite` says otherwise — re-dividing should not quietly discard the
 * seasonality somebody typed in.
 */
async function cascadeTargets(
  fyStartYear: number,
  employeeId: string | null,
  annualPaise: number,
  actorId: string,
  overwrite: boolean,
): Promise<void> {
  const edited = new Set(
    (
      await db
        .select({ periodKey: forecastTargets.periodKey })
        .from(forecastTargets)
        .where(
          and(
            eq(forecastTargets.fyStartYear, fyStartYear),
            eq(forecastTargets.isDerived, false),
            employeeId === null
              ? isNull(forecastTargets.employeeId)
              : eq(forecastTargets.employeeId, employeeId),
          ),
        )
    ).map((r) => r.periodKey),
  );

  const quarters = periodsOfKind(fyStartYear, "quarter");
  const qParts = splitPaise(annualPaise, quarters.length);

  for (const [qi, q] of quarters.entries()) {
    const qValue = qParts[qi]!;
    if (overwrite || !edited.has(q.key)) {
      await upsertTarget(fyStartYear, "quarter", q.key, employeeId, qValue, true, actorId);
    }
    const months = childPeriods(fyStartYear, q);
    const mParts = splitPaise(qValue, months.length);
    for (const [mi, m] of months.entries()) {
      const mValue = mParts[mi]!;
      if (overwrite || !edited.has(m.key)) {
        await upsertTarget(fyStartYear, "month", m.key, employeeId, mValue, true, actorId);
      }
      // The "divide by 4" from the brief — except a month has 4 OR 5 weeks, and
      // the real calendar wins over the round number.
      const weeks = childPeriods(fyStartYear, m);
      const wParts = splitPaise(mValue, weeks.length);
      for (const [wi, w] of weeks.entries()) {
        if (overwrite || !edited.has(w.key)) {
          await upsertTarget(fyStartYear, "week", w.key, employeeId, wParts[wi]!, true, actorId);
        }
      }
    }
  }
}

export async function setCompanyTarget(input: unknown): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  const parsed = CompanyTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const { fyStartYear, targetRupees } = parsed.data;

  const id = await upsertTarget(
    fyStartYear,
    "annual",
    annualKey(fyStartYear),
    null,
    targetRupees,
    false,
    g.me.id,
  );
  await cascadeTargets(fyStartYear, null, targetRupees, g.me.id, false);
  revalidateTargets();
  return { ok: true, id };
}

export async function allocateTarget(input: unknown): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  const parsed = AllocateTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const { fyStartYear, employeeId, targetRupees } = parsed.data;

  const id = await upsertTarget(
    fyStartYear,
    "annual",
    annualKey(fyStartYear),
    employeeId,
    targetRupees,
    false,
    g.me.id,
  );
  await cascadeTargets(fyStartYear, employeeId, targetRupees, g.me.id, false);
  revalidateTargets();
  return { ok: true, id };
}

/** Edit one derived cell — a quarter, month or week target. */
export async function setPeriodTarget(input: unknown): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  const parsed = PeriodTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const { fyStartYear, periodKind, periodKey, employeeId, targetRupees } = parsed.data;

  if (!findPeriod(fyStartYear, periodKind, periodKey)) {
    return { ok: false, error: "Unknown period." };
  }
  // isDerived false: this value is now somebody's decision, and a later
  // re-divide must not silently overwrite it.
  const id = await upsertTarget(
    fyStartYear,
    periodKind,
    periodKey,
    employeeId,
    targetRupees,
    false,
    g.me.id,
  );
  revalidateTargets();
  return { ok: true, id };
}

/** Re-seed the whole ladder from the annual number, discarding manual edits. */
export async function redivideTargets(input: {
  fyStartYear: number;
  employeeId: string | null;
}): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  const fy = Number(input.fyStartYear);
  if (!Number.isInteger(fy)) return { ok: false, error: "Invalid year." };
  const employeeId = input.employeeId === null ? null : String(input.employeeId);
  if (employeeId !== null && !isUuid(employeeId)) return { ok: false, error: "Invalid selection." };

  const [row] = await db
    .select({ targetPaise: forecastTargets.targetPaise })
    .from(forecastTargets)
    .where(
      and(
        eq(forecastTargets.fyStartYear, fy),
        eq(forecastTargets.periodKind, "annual"),
        employeeId === null
          ? isNull(forecastTargets.employeeId)
          : eq(forecastTargets.employeeId, employeeId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Set the annual target first." };

  await cascadeTargets(fy, employeeId, row.targetPaise, g.me.id, true);
  revalidateTargets();
  return { ok: true };
}

export async function setGrowthSplit(input: unknown): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  const parsed = GrowthSplitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const { fyStartYear, employeeId, existingPct } = parsed.data;

  const match = and(
    eq(forecastGrowthSplits.fyStartYear, fyStartYear),
    employeeId === null
      ? isNull(forecastGrowthSplits.employeeId)
      : eq(forecastGrowthSplits.employeeId, employeeId),
  );
  const [existing] = await db
    .select({ id: forecastGrowthSplits.id })
    .from(forecastGrowthSplits)
    .where(match)
    .limit(1);

  if (existing) {
    await db
      .update(forecastGrowthSplits)
      .set({ existingPct: String(existingPct), updatedById: g.me.id, updatedAt: new Date() })
      .where(eq(forecastGrowthSplits.id, existing.id));
  } else {
    await db.insert(forecastGrowthSplits).values({
      fyStartYear,
      employeeId,
      existingPct: String(existingPct),
      updatedById: g.me.id,
    });
  }
  revalidateTargets();
  return { ok: true };
}

/* ── Forecast lines ──────────────────────────────────────────────────────── */

export async function saveForecastLine(id: string | null, input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const parsed = ForecastLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  // A rep may only forecast their own book; admins may forecast for anyone.
  if (!g.me.isAdmin && v.employeeId !== g.me.id) {
    return { ok: false, error: "You can only edit your own forecast." };
  }
  const locked = await assertEditable(g.me, v.fyStartYear, v.periodKind, v.periodKey);
  if (locked) return locked;
  if (!findPeriod(v.fyStartYear, v.periodKind, v.periodKey)) {
    return { ok: false, error: "Unknown period." };
  }

  // Field-level rights. Hiding the input is a courtesy; this is the control.
  const [mayQty, mayRate] = await Promise.all([
    canEditField("forecast.quantity"),
    canEditField("forecast.avg_rate"),
  ]);

  let before:
    | { forecastPaise: number; employeeId: string; quantity: string | null; avgRatePaise: number | null }
    | undefined;
  if (id) {
    if (!isUuid(id)) return { ok: false, error: "Invalid id." };
    [before] = await db
      .select({
        forecastPaise: forecastLines.forecastPaise,
        employeeId: forecastLines.employeeId,
        quantity: forecastLines.quantity,
        avgRatePaise: forecastLines.avgRatePaise,
      })
      .from(forecastLines)
      .where(eq(forecastLines.id, id))
      .limit(1);
    if (!before) return { ok: false, error: "That row no longer exists." };
    if (!g.me.isAdmin && before.employeeId !== g.me.id) {
      return { ok: false, error: "You can only edit your own forecast." };
    }
  }

  // Lacking a field right must PRESERVE what is stored, not overwrite it with
  // null. Substituting null would turn "you may not edit this" into "you may
  // erase this", which is the opposite of what the permission means.
  const quantity = mayQty
    ? v.quantity
    : before?.quantity == null
      ? null
      : Number(before.quantity);
  const avgRatePaise = mayRate ? v.avgRateRupees : (before?.avgRatePaise ?? null);

  // Quantity × rate wins when both are present; otherwise the typed figure.
  const derived = valueFromQtyRate(quantity, avgRatePaise);
  const forecastPaise = derived ?? v.forecastRupees;

  try {
    if (id && before) {
      await db
        .update(forecastLines)
        .set({
          // Only what this form owns. Estimates and their notes belong to the
          // update screen and must survive a forecast edit.
          quantity: quantity === null ? null : String(quantity),
          avgRatePaise,
          forecastPaise,
          notes: v.notes,
          isDerived: false,
          updatedById: g.me.id,
          updatedAt: new Date(),
        })
        .where(eq(forecastLines.id, id));
      if (before.forecastPaise !== forecastPaise) {
        await audit(g.me.id, "forecast_changed", { lineId: id }, "forecast", before.forecastPaise, forecastPaise);
      }
      revalidateTargets();
      return { ok: true, id };
    }

    const [row] = await db
      .insert(forecastLines)
      .values({
        fyStartYear: v.fyStartYear,
        periodKind: v.periodKind,
        periodKey: v.periodKey,
        employeeId: v.employeeId,
        customerMasterId: v.customerMasterId,
        isNewBusiness: v.isNewBusiness,
        quantity: quantity === null ? null : String(quantity),
        avgRatePaise,
        forecastPaise,
        notes: v.notes,
        isDerived: false,
        createdById: g.me.id,
        updatedById: g.me.id,
      })
      .returning({ id: forecastLines.id });
    await audit(g.me.id, "forecast_added", { lineId: row!.id }, "forecast", null, forecastPaise);
    revalidateTargets();
    return { ok: true, id: row!.id };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === "23505") {
      return { ok: false, error: "That customer already has a row in this period." };
    }
    return { ok: false, error: `Could not save: ${e?.message ?? String(err)}` };
  }
}

export async function deleteForecastLine(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const g = await guard();
  if ("error" in g) return g.error;

  const [row] = await db
    .select({
      employeeId: forecastLines.employeeId,
      fyStartYear: forecastLines.fyStartYear,
      periodKind: forecastLines.periodKind,
      periodKey: forecastLines.periodKey,
    })
    .from(forecastLines)
    .where(eq(forecastLines.id, id))
    .limit(1);
  if (!row) return { ok: true };
  if (!g.me.isAdmin && row.employeeId !== g.me.id) {
    return { ok: false, error: "You can only edit your own forecast." };
  }
  const locked = await assertEditable(g.me, row.fyStartYear, row.periodKind, row.periodKey);
  if (locked) return locked;

  await db.delete(forecastLines).where(eq(forecastLines.id, id));
  revalidateTargets();
  return { ok: true };
}

/**
 * Push a period's customer rows down one level.
 *
 * Each customer's figure is split evenly across the child periods, using
 * `splitPaise` so the children always add back to the parent exactly. Rows
 * somebody has already edited are preserved unless `overwriteEdited` is set.
 */
export async function redivideForecast(input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const parsed = RedivideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const { fyStartYear, periodKind, periodKey, employeeId, overwriteEdited } = parsed.data;

  if (!g.me.isAdmin && employeeId !== g.me.id) {
    return { ok: false, error: "You can only edit your own forecast." };
  }
  const parent = findPeriod(fyStartYear, periodKind, periodKey);
  if (!parent) return { ok: false, error: "Unknown period." };
  const children = childPeriods(fyStartYear, parent);
  if (children.length === 0) {
    return { ok: false, error: "A week has nothing below it to divide into." };
  }

  const parentLines = await db
    .select({
      id: forecastLines.id,
      customerMasterId: forecastLines.customerMasterId,
      isNewBusiness: forecastLines.isNewBusiness,
      forecastPaise: forecastLines.forecastPaise,
    })
    .from(forecastLines)
    .where(
      and(
        eq(forecastLines.fyStartYear, fyStartYear),
        eq(forecastLines.periodKind, periodKind),
        eq(forecastLines.periodKey, periodKey),
        eq(forecastLines.employeeId, employeeId),
      ),
    );
  if (parentLines.length === 0) {
    return { ok: false, error: `Nothing to divide — ${parent.label} has no rows yet.` };
  }

  const childKindOf = children[0]!.kind;
  const existing = await db
    .select({
      id: forecastLines.id,
      periodKey: forecastLines.periodKey,
      customerMasterId: forecastLines.customerMasterId,
      isNewBusiness: forecastLines.isNewBusiness,
      isDerived: forecastLines.isDerived,
    })
    .from(forecastLines)
    .where(
      and(
        eq(forecastLines.fyStartYear, fyStartYear),
        eq(forecastLines.periodKind, childKindOf),
        eq(forecastLines.employeeId, employeeId),
        inArray(
          forecastLines.periodKey,
          children.map((c) => c.key),
        ),
      ),
    );
  const keyOf = (periodK: string, customerId: string | null, newBiz: boolean) =>
    `${periodK}|${customerId ?? (newBiz ? "__new__" : "")}`;
  const existingBy = new Map(
    existing.map((e) => [keyOf(e.periodKey, e.customerMasterId, e.isNewBusiness), e]),
  );

  let written = 0;
  for (const line of parentLines) {
    const parts = splitPaise(line.forecastPaise, children.length);
    for (const [i, child] of children.entries()) {
      const hit = existingBy.get(keyOf(child.key, line.customerMasterId, line.isNewBusiness));
      if (hit) {
        if (!hit.isDerived && !overwriteEdited) continue;
        await db
          .update(forecastLines)
          .set({ forecastPaise: parts[i]!, isDerived: true, updatedById: g.me.id, updatedAt: new Date() })
          .where(eq(forecastLines.id, hit.id));
      } else {
        await db.insert(forecastLines).values({
          fyStartYear,
          periodKind: childKindOf,
          periodKey: child.key,
          employeeId,
          customerMasterId: line.customerMasterId,
          isNewBusiness: line.isNewBusiness,
          forecastPaise: parts[i]!,
          seededFromId: line.id,
          isDerived: true,
          createdById: g.me.id,
          updatedById: g.me.id,
        });
      }
      written++;
    }
  }
  revalidateTargets();
  return { ok: true, id: String(written) };
}

/* ── Estimates (the 27th / Friday routine) ───────────────────────────────── */

export async function saveEstimate(input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const parsed = EstimateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const { lineId, estimatedRupees, estimatedNotes } = parsed.data;

  const [row] = await db
    .select({
      employeeId: forecastLines.employeeId,
      fyStartYear: forecastLines.fyStartYear,
      periodKind: forecastLines.periodKind,
      periodKey: forecastLines.periodKey,
      estimatedPaise: forecastLines.estimatedPaise,
    })
    .from(forecastLines)
    .where(eq(forecastLines.id, lineId))
    .limit(1);
  if (!row) return { ok: false, error: "That row no longer exists." };
  if (!g.me.isAdmin && row.employeeId !== g.me.id) {
    return { ok: false, error: "You can only update your own estimates." };
  }
  const locked = await assertEditable(g.me, row.fyStartYear, row.periodKind, row.periodKey);
  if (locked) return locked;

  await db
    .update(forecastLines)
    .set({
      estimatedPaise: estimatedRupees,
      estimatedNotes,
      estimatedAt: new Date(),
      estimatedById: g.me.id,
      updatedById: g.me.id,
      updatedAt: new Date(),
    })
    .where(eq(forecastLines.id, lineId));
  await audit(
    g.me.id,
    "estimate_saved",
    { lineId },
    "estimated",
    row.estimatedPaise,
    estimatedRupees,
  );
  revalidateTargets();
  return { ok: true, id: lineId };
}

/* ── Cadence ─────────────────────────────────────────────────────────────── */

export async function setForecastCadence(input: unknown): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  const parsed = ForecastCadenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };

  await db
    .update(orgSettings)
    .set({ ...parsed.data, updatedById: g.me.id, updatedAt: new Date() })
    .where(eq(orgSettings.id, 1));
  revalidateTargets();
  return { ok: true };
}

/* ── Actuals import ──────────────────────────────────────────────────────── */

export interface ActualsUploadResult {
  ok: true;
  imported: number;
  skipped: number;
  unmatchedCustomers: string[];
}

const MAX_ROWS = 10_000;
const CHUNK = 200;

/**
 * Import booked turnover from a Tally export.
 *
 * This writes to `forecast_actuals`, NEVER to `sales_orders`. `sales_orders` is
 * the incentive engine's input — importing there would double-count against
 * rep-logged sales and change real payouts. Nothing in this function can move
 * anybody's money.
 *
 * A row whose customer can't be resolved still imports, with the raw name kept
 * and the customer left blank, and is listed in `unmatchedCustomers` so somebody
 * can link it. Dropping those rows would quietly understate Actual.
 */
export async function uploadActuals(input: {
  fileName?: string;
  rows: { customer?: string; value?: string; date?: string; voucher?: string; product?: string }[];
}): Promise<ActualsUploadResult | { ok: false; error: string }> {
  const g = await adminGuard();
  if ("error" in g) return g.error;

  const raw = Array.isArray(input.rows) ? input.rows.slice(0, MAX_ROWS) : [];
  if (raw.length === 0) return { ok: false, error: "That file has no rows to import." };

  const masters = await db
    .select({
      id: customerMasters.id,
      name: customerMasters.name,
      code: customerMasters.code,
      salesRepId: customerMasters.salesRepId,
      linkedCustomerId: customerMasters.linkedCustomerId,
    })
    .from(customerMasters);

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map<string, (typeof masters)[number]>();
  const byCode = new Map<string, (typeof masters)[number]>();
  for (const m of masters) {
    const n = norm(m.name);
    // Ambiguous names resolve to nobody rather than to the first match.
    if (byName.has(n)) byName.set(n, null as never);
    else byName.set(n, m);
    if (m.code) byCode.set(norm(m.code), m);
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      source: "tally",
      target: "forecast_actuals",
      fileName: input.fileName?.slice(0, 200) ?? null,
      rowCount: raw.length,
      status: "draft",
      mapping: {},
      createdById: g.me.id,
    })
    .returning({ id: importBatches.id });

  const values: (typeof forecastActuals.$inferInsert)[] = [];
  const unmatched = new Set<string>();
  let skipped = 0;

  for (const r of raw) {
    const name = (r.customer ?? "").trim();
    const rupees = Number(String(r.value ?? "").replace(/[,\s₹]/g, ""));
    const date = (r.date ?? "").trim();
    if (!name || !Number.isFinite(rupees) || rupees === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped++;
      continue;
    }
    const hit = byCode.get(norm(name)) ?? byName.get(norm(name)) ?? null;
    if (!hit) unmatched.add(name);
    values.push({
      customerMasterId: hit?.id ?? null,
      customerId: hit?.linkedCustomerId ?? null,
      employeeId: hit?.salesRepId ?? null,
      customerNameRaw: name.slice(0, 200),
      valuePaise: Math.round(rupees * 100),
      bookedAt: date,
      voucherNo: r.voucher?.slice(0, 60) || null,
      productRef: r.product?.slice(0, 200) || null,
      source: "tally",
      importBatchId: batch!.id,
      createdById: g.me.id,
    });
  }

  try {
    for (let i = 0; i < values.length; i += CHUNK) {
      // Re-uploading the same export must not double the actuals — the partial
      // unique index on (voucher, date, value) absorbs the repeat.
      await db.insert(forecastActuals).values(values.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    await db
      .update(importBatches)
      .set({ status: "applied", importedCount: values.length, skippedCount: skipped })
      .where(eq(importBatches.id, batch!.id));
  } catch (err) {
    await db
      .update(importBatches)
      .set({ status: "failed", error: (err as Error).message?.slice(0, 500) })
      .where(eq(importBatches.id, batch!.id))
      .catch(() => {});
    return { ok: false, error: `Import failed: ${(err as Error).message}` };
  }

  revalidateTargets();
  return {
    ok: true,
    imported: values.length,
    skipped,
    unmatchedCustomers: [...unmatched].slice(0, 50),
  };
}

/** Link a customer master to its sales-spine row so actuals can match. */
export async function linkCustomer(customerMasterId: string, customerId: string | null): Promise<Result> {
  const g = await adminGuard();
  if ("error" in g) return g.error;
  if (!isUuid(customerMasterId)) return { ok: false, error: "Invalid selection." };
  if (customerId !== null && !isUuid(customerId)) return { ok: false, error: "Invalid selection." };

  await db
    .update(customerMasters)
    .set({ linkedCustomerId: customerId, updatedAt: new Date() })
    .where(eq(customerMasters.id, customerMasterId));
  revalidateTargets();
  return { ok: true };
}

/** Seed the roster of rows for a period from the rep's customer book. */
export async function seedPeriodFromBook(input: {
  fyStartYear: number;
  periodKind: ForecastPeriodKind;
  periodKey: string;
  employeeId: string;
}): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const { fyStartYear, periodKind, periodKey, employeeId } = input;
  if (!isUuid(employeeId)) return { ok: false, error: "Invalid selection." };
  if (!g.me.isAdmin && employeeId !== g.me.id) {
    return { ok: false, error: "You can only edit your own forecast." };
  }
  if (!findPeriod(fyStartYear, periodKind, periodKey)) {
    return { ok: false, error: "Unknown period." };
  }

  const [book, existing] = await Promise.all([
    db
      .select({ id: customerMasters.id })
      .from(customerMasters)
      .where(and(eq(customerMasters.isActive, true), eq(customerMasters.salesRepId, employeeId))),
    db
      .select({ customerMasterId: forecastLines.customerMasterId, isNewBusiness: forecastLines.isNewBusiness })
      .from(forecastLines)
      .where(
        and(
          eq(forecastLines.fyStartYear, fyStartYear),
          eq(forecastLines.periodKind, periodKind),
          eq(forecastLines.periodKey, periodKey),
          eq(forecastLines.employeeId, employeeId),
        ),
      ),
  ]);

  const have = new Set(existing.map((e) => e.customerMasterId).filter(Boolean) as string[]);
  const rows = book
    .filter((c) => !have.has(c.id))
    .map((c) => ({
      fyStartYear,
      periodKind,
      periodKey,
      employeeId,
      customerMasterId: c.id,
      isNewBusiness: false,
      forecastPaise: 0,
      isDerived: true,
      createdById: g.me.id,
      updatedById: g.me.id,
    }));

  // The new-business bucket is created once per period — it is where the
  // acquisition share of the target lives, so a period without it under-reports.
  if (!existing.some((e) => e.isNewBusiness)) {
    rows.push({
      fyStartYear,
      periodKind,
      periodKey,
      employeeId,
      customerMasterId: null as unknown as string,
      isNewBusiness: true,
      forecastPaise: 0,
      isDerived: true,
      createdById: g.me.id,
      updatedById: g.me.id,
    });
  }
  if (rows.length === 0) return { ok: false, error: "Every customer in your book is already here." };

  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(forecastLines).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  revalidateTargets();
  return { ok: true, id: String(rows.length) };
}
