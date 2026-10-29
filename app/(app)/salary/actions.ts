"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salaryRuns } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { computeSalary } from "@/lib/salary/compute";
import { assembleMonthInputs } from "@/lib/salary/generate";
import { PolicyReadError } from "@/lib/attendance/policy-read";
import { getRun, getRunForEmployeeMonth } from "@/lib/queries/salary";
import { GenerateSalarySchema, RecalculateRunSchema, RunEditSchema } from "@/lib/validators/salary";
import type { MonthInputRow } from "@/lib/salary/generate";

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const PATH = "/salary";
const MY_PATH = "/my-salary";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Generate (or regenerate) the salary runs for a month.
 *
 * For each employee that has a salary profile (annualCtc > 0) we recompute the
 * breakdown from the current attendance summary + profile (via
 * `assembleMonthInputs` → `computeSalary`) and upsert a `salary_runs` row keyed
 * on (employee_id, month).
 *
 * Carry-forward contract: we persist `pending_balance_in = input.pendingBalanceIn`
 * and `net_payable = breakdown.net` (which already INCLUDES + pendingBalanceIn).
 * This keeps `lastDisbursedRemainder` recursion correct.
 *
 * Regenerate semantics (idempotent re-run): on conflict we RECOMPUTE the
 * computed columns (payable/late/gross/pt/tds/advances/pending/net) from the
 * current attendance + profile — see upsertComputedRun for the invariant that
 * keeps a recorded disbursement intact. A run already marked DISBURSED keeps
 * its figures too, unless `includeDisbursed` is passed explicitly: a routine
 * re-run must not rewrite a month that has been paid. Note: because `advances`
 * and `pending_balance_in` are re-derived from the assembler (sumAdvances /
 * lastDisbursedRemainder — both the source of truth), any manual `editRun`
 * tweak to those two fields IS overwritten by a later regenerate. That is
 * acceptable and intentional.
 *
 * Employees without a profile (annualCtc 0) are SKIPPED (no ₹0 run created).
 */
export async function generateSalary(
  input: unknown,
): Promise<ActionResult<{ generated: number; skippedDisbursed: number; skippedNoProfile: number }>> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = GenerateSalarySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { month, includeDisbursed = false } = parsed.data;

  let generated = 0;
  let skippedDisbursed = 0;
  let skippedNoProfile = 0;
  try {
    const rows = await assembleMonthInputs(month);
    for (const row of rows) {
      if (!row.hasProfile) {
        skippedNoProfile += 1; // no CTC → skip (don't materialize a ₹0 run)
        continue;
      }
      if (await upsertComputedRun(row, me.id, includeDisbursed)) generated += 1;
      else skippedDisbursed += 1;
    }
  } catch (err: unknown) {
    // A policy-read failure happens while assembling inputs, before any run is
    // written. Say what happened rather than labelling it a database error.
    if (err instanceof PolicyReadError) return { ok: false, error: err.message };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }

  revalidatePath(PATH);
  revalidatePath(MY_PATH);
  return { ok: true, generated, skippedDisbursed, skippedNoProfile };
}

/**
 * Recompute ONE employee's run for a month from today's attendance and
 * profile — the "Recalculate my salary" action. Same assembler, same formula
 * and same disbursement protection as Generate Salary, for one row. Admin-only,
 * like every salary write: generation is HR's act, so an employee's page offers
 * this only to administrators.
 */
export async function recalculateEmployeeRun(input: unknown): Promise<ActionResult<{ netPayable: number }>> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = RecalculateRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { month, employeeId } = parsed.data;

  try {
    const existing = await getRunForEmployeeMonth(employeeId, month);
    if (existing?.disbursed) {
      return { ok: false, error: "This month's salary is already marked disbursed, so it isn't recalculated. Undo the disbursement on the Salary page first." };
    }
    const row = (await assembleMonthInputs(month)).find((r) => r.employeeId === employeeId);
    if (!row) return { ok: false, error: "No active employee with that id." };
    if (!row.hasProfile) return { ok: false, error: "No salary profile (CTC) is set for this employee, so there is nothing to calculate." };
    if (!(await upsertComputedRun(row, me.id, false))) {
      return { ok: false, error: "This month's salary was marked disbursed meanwhile and was left unchanged." };
    }
    const net = computeSalary(row.input).net;
    revalidatePath(PATH);
    revalidatePath(MY_PATH);
    return { ok: true, netPayable: net };
  } catch (err: unknown) {
    if (err instanceof PolicyReadError) return { ok: false, error: err.message };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }
}

/**
 * Adjust a single run's `advances` and/or `pending_balance_in` and recompute
 * its `net_payable` from the already-stored gross / pt / tds (money read via
 * Number(), written as `.toFixed(2)`). Admin-only.
 *
 * net = gross - pt - tds - advances + pendingBalanceIn
 */
export async function editRun(input: unknown): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = RunEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const run = await getRun(data.runId);
  if (!run) return { ok: false, error: "Run not found." };
  if (run.disbursed) {
    return {
      ok: false,
      error: "This run is already disbursed — un-disburse it first to edit advances or pending balance.",
    };
  }

  const advances = data.advances ?? run.advances;
  const pendingBalanceIn = data.pendingBalanceIn ?? run.pendingBalanceIn;
  const net = run.gross - run.pt - run.tds - advances + pendingBalanceIn;

  try {
    await db
      .update(salaryRuns)
      .set({
        advances: advances.toFixed(2),
        pendingBalanceIn: pendingBalanceIn.toFixed(2),
        netPayable: net.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(salaryRuns.id, data.runId));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Toggle a run's disbursed flag. When disbursing, `disbursed_amount` defaults
 * to the run's net_payable (the full pay) unless an explicit amount is given —
 * a smaller amount becomes the carry-forward source (next month's
 * `lastDisbursedRemainder` reads `net_payable - disbursed_amount`). When
 * un-disbursing, `disbursed_amount` is cleared. `approved_by_id` is stamped on
 * disburse. Admin-only.
 */
export async function setDisbursed(
  runId: string,
  disbursed: boolean,
  disbursedAmount?: number,
): Promise<ActionResult> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  if (!UUID_RE.test(runId)) return { ok: false, error: "Invalid id" };
  if (disbursedAmount !== undefined && (!Number.isFinite(disbursedAmount) || disbursedAmount < 0)) {
    return { ok: false, error: "Invalid disbursed amount" };
  }

  const run = await getRun(runId);
  if (!run) return { ok: false, error: "Run not found." };

  const amount = disbursed
    ? (disbursedAmount ?? run.netPayable).toFixed(2)
    : null;

  try {
    await db
      .update(salaryRuns)
      .set({
        disbursed,
        disbursedAmount: amount,
        approvedById: disbursed ? me.id : null,
        updatedAt: new Date(),
      })
      .where(eq(salaryRuns.id, runId));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DB: ${msg}` };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Write (insert or recompute) one employee's run from an assembled input row.
 * Returns true when a row was written, false when the existing run was left
 * alone because it is disbursed and `includeDisbursed` is off.
 *
 * INVARIANT (shared by Generate and Recalculate): the ON CONFLICT set-clause
 * updates ONLY recomputed columns. It MUST NOT include `disbursed`,
 * `disbursedAmount` or `approvedById` — regenerating must never wipe a
 * disbursement. setDisbursed touches only those columns, so the two writers
 * are column-disjoint. On top of that, a disbursed run's FIGURES are only
 * rewritten when the caller explicitly asks (`includeDisbursed`), enforced in
 * the statement itself (`WHERE disbursed = false`), not by a read-then-write.
 *
 * Declared after its callers on purpose: inputs are always assembled
 * (assembleMonthInputs) before this, the only write, runs.
 */
async function upsertComputedRun(row: MonthInputRow, generatedById: string, includeDisbursed: boolean): Promise<boolean> {
  const b = computeSalary(row.input);
  const computed = {
    month: row.month,
    fy: row.fy,
    annualCtc: row.annualCtc.toFixed(2),
    daysInMonth: row.daysInMonth,
    payableDays: b.payableDays.toFixed(2),
    lateMarks: row.input.lateMarksInMonth,
    lateDeductionDays: b.lateDeductionDays.toFixed(2),
    gross: b.gross.toFixed(2),
    pt: b.pt.toFixed(2),
    tds: b.tds.toFixed(2),
    advances: b.advances.toFixed(2),
    pendingBalanceIn: b.pendingBalanceIn.toFixed(2),
    netPayable: b.net.toFixed(2),
  };
  const written = await db
    .insert(salaryRuns)
    .values({ employeeId: row.employeeId, ...computed, source: "generated", generatedById })
    .onConflictDoUpdate({
      target: [salaryRuns.employeeId, salaryRuns.month],
      set: { ...computed, updatedAt: new Date() },
      setWhere: includeDisbursed ? undefined : eq(salaryRuns.disbursed, false),
    })
    .returning({ id: salaryRuns.id });
  return written.length > 0;
}
