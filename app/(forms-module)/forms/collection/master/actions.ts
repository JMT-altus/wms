"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionMasterCompanies, collectionMasterImports } from "@/db/schema";
import { requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { nameKey } from "@/lib/collections/master/normalize";
import { buildMasterPlan, type MasterPlan, type PlannedRow, type PlanSummary } from "@/lib/collections/master/plan";
import { missingColumnConfirmations } from "@/lib/collections/master/workbook";
import { isMissingTable, listKnownCoordinatorLabels, loadClientMasterIndex, loadExistingByKeys } from "@/lib/queries/collection-master";

/**
 * Collection Master import. Needs collection.master.import (and, like all of
 * Forms, an admin) — checked here because a page guard does not protect a
 * server action.
 *
 * The browser reads the file and sends only the mapped cells. The server never
 * trusts that: it rebuilds the whole plan from the raw cells — cleaning,
 * duplicate and conflict detection, Client Master matching, comparison with
 * what is stored — both for the read-only preview and again, inside the write
 * transaction, at confirmation.
 *
 * Never deletes. Never overwrites an existing value unless the admin accepted
 * that row's change, and only if the stored values are still what the preview
 * showed. Never creates or edits a Client Master record.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_ROWS = 10_000;
const cell = z.string().max(1000);

const RowSchema = z.object({
  rowNo: z.number().int().min(1).max(1_000_000),
  company: cell,
  coordinator: cell,
  paymentTerms: cell,
});

const BaseSchema = z.object({
  fileName: z.string().max(200).optional(),
  sheetName: z.string().max(200).optional(),
  /** Which columns fed which field — for the audit row only. */
  mapping: z.object({
    company: z.string().min(1).max(120),
    coordinator: z.string().max(120).nullable(),
    paymentTerms: z.string().max(120).nullable(),
  }),
  /** Columns shown but not imported (e.g. an unnamed column) — for the audit row. */
  ignoredColumns: z
    .array(z.object({ column: z.string().max(10), header: z.string().max(120).nullable(), filled: z.number().int().min(0) }))
    .max(200)
    .default([]),
  rows: z.array(RowSchema).min(1, "The file has no rows to import.").max(MAX_ROWS, `Import at most ${MAX_ROWS} rows at a time.`),
  /**
   * The admin's explicit confirmation of column meanings: required for the Sales
   * Coordinator column whenever one is mapped, and for any column without a
   * header (see missingColumnConfirmations). Checked here, not only in the UI.
   */
  confirmedColumns: z
    .object({ company: z.literal(true).optional(), coordinator: z.literal(true).optional(), paymentTerms: z.literal(true).optional() })
    .strict()
    .default({}),
});

const FIELD_NAMES = { company: "company name", coordinator: "Sales Coordinator", paymentTerms: "payment terms" } as const;

/** Refuse a mapping whose meaning the admin hasn't confirmed. */
function confirmationError(data: z.output<typeof BaseSchema>): string | null {
  const missing = missingColumnConfirmations(data.mapping, data.confirmedColumns);
  if (missing.length === 0) return null;
  return `Confirm which column holds the ${missing.map((m) => FIELD_NAMES[m]).join(" and the ")} before previewing or importing.`;
}

/** One field change exactly as the preview showed it: the stored value it replaces and the new value. */
const AcceptedChangeSchema = z.object({
  field: z.enum(["coordinatorLabel", "paymentTerms"]),
  from: z.string().max(1000).nullable(),
  to: z.string().max(1000).nullable(),
});

const ImportSchema = BaseSchema.extend({
  /**
   * The "changed" rows the admin explicitly accepted, each with the exact
   * change the preview showed. A row number alone proves nothing: at
   * confirmation the stored values must still be what the preview compared
   * against, and the change must be the same, or nothing is imported.
   */
  acceptChanges: z
    .array(z.object({ rowNo: z.number().int().min(1), changes: z.array(AcceptedChangeSchema).min(1).max(2) }))
    .max(MAX_ROWS)
    .default([])
    .refine((a) => new Set(a.map((c) => c.rowNo)).size === a.length, "Each row can be accepted only once."),
  confirm: z.literal(true, { message: "Review the preview and confirm the import first." }),
});

/** Same fields, same stored ("from") and new ("to") values, in any order. */
const sameChanges = (a: readonly z.output<typeof AcceptedChangeSchema>[], b: readonly z.output<typeof AcceptedChangeSchema>[]) => {
  const key = (c: z.output<typeof AcceptedChangeSchema>) => JSON.stringify([c.field, c.from, c.to]);
  return a.length === b.length && JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
};

const STORAGE_NOT_READY =
  "Collection Master storage isn't set up yet (migration 0112 is pending), so nothing can be imported.";

/** Preview and import both need collection.master.import (checked before anything is read). */
async function guard() {
  const proof = await requireCollectionCapability("collection.master.import");
  const limited = rateLimitOrError(proof.employeeId, "write");
  return { me: { id: proof.employeeId }, limited };
}

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid import data.";

function planFor(
  data: z.output<typeof BaseSchema>,
  existing: Awaited<ReturnType<typeof loadExistingByKeys>>,
  clients: Map<string, string[]>,
  knownCoordinatorLabels: string[],
): MasterPlan {
  return buildMasterPlan(data.rows, existing, clients, {
    mapped: { coordinator: data.mapping.coordinator !== null, paymentTerms: data.mapping.paymentTerms !== null },
    knownCoordinatorLabels,
  });
}

export interface MasterPreview {
  storageReady: boolean;
  summary: PlanSummary;
  rows: PlannedRow[];
}

/** Read-only: what an import would do. Writes nothing. */
export async function previewCollectionMaster(raw: unknown): Promise<Result<{ preview: MasterPreview }>> {
  const { limited } = await guard();
  if (limited) return limited;
  const p = BaseSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const unconfirmed = confirmationError(p.data);
  if (unconfirmed) return { ok: false, error: unconfirmed };
  const keys = p.data.rows.map((r) => nameKey(r.company));
  let storageReady = true;
  let existing = new Map() as Awaited<ReturnType<typeof loadExistingByKeys>>;
  let known: string[] = [];
  try {
    existing = await loadExistingByKeys(db, keys);
    known = await listKnownCoordinatorLabels(db);
  } catch (err) {
    if (!isMissingTable(err)) {
      console.error("[collection-master] preview read failed", err);
      return { ok: false, error: "Could not check the file against the Collection Master. Please try again." };
    }
    storageReady = false;
  }
  try {
    const clients = await loadClientMasterIndex(db);
    const plan = planFor(p.data, existing, clients, known);
    return { ok: true, preview: { storageReady, summary: plan.summary, rows: plan.rows } };
  } catch (err) {
    console.error("[collection-master] preview failed", err);
    return { ok: false, error: "Could not check the file. Please try again." };
  }
}

export type RowOutcome = "inserted" | "updated" | "unchanged" | "kept-existing" | "skipped-duplicate" | "rejected" | "skipped-conflict";

export interface MasterImportResult {
  importId: string;
  totals: {
    inserted: number;
    updated: number;
    unchanged: number;
    /** Changed rows NOT accepted: the stored assignment was kept. */
    keptExisting: number;
    duplicates: number;
    rejected: number;
    /** Someone else changed or created the same company meanwhile: not written. */
    conflicts: number;
  };
  rows: { rowNo: number; companyName: string; outcome: RowOutcome; message: string | null }[];
}

class StaleError extends Error {}

/** Writes the confirmed import in one transaction, with an audit row. */
export async function importCollectionMaster(raw: unknown): Promise<Result<{ result: MasterImportResult }>> {
  const { me, limited } = await guard();
  if (limited) return limited;
  const p = ImportSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const unconfirmed = confirmationError(p.data);
  if (unconfirmed) return { ok: false, error: unconfirmed };
  const accepted = new Map(p.data.acceptChanges.map((a) => [a.rowNo, a.changes]));
  const keys = p.data.rows.map((r) => nameKey(r.company));

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the stored rows this file touches, then plan from scratch.
      await tx
        .select({ id: collectionMasterCompanies.id })
        .from(collectionMasterCompanies)
        .where(inArray(collectionMasterCompanies.nameKey, [...new Set(keys)].filter(Boolean).slice(0, MAX_ROWS)))
        .for("update");
      const existing = await loadExistingByKeys(tx as unknown as typeof db, keys);
      const clients = await loadClientMasterIndex(tx as unknown as typeof db);
      const known = await listKnownCoordinatorLabels(tx as unknown as typeof db);
      const plan = planFor(p.data, existing, clients, known);

      // Every accepted row must still be exactly the change the admin saw: a
      // "changed" row whose stored values (re-read under the lock above) and
      // new values match the preview. Anything else — edited meanwhile, no
      // longer a change, or not in this file — aborts before anything is written.
      const byRow = new Map(plan.rows.map((r) => [r.rowNo, r]));
      for (const [rowNo, expected] of accepted) {
        const now = byRow.get(rowNo);
        if (!now || now.status !== "changed" || !sameChanges(now.changes, expected)) throw new StaleError(now?.companyName ?? `row ${rowNo}`);
      }

      const [batch] = await tx
        .insert(collectionMasterImports)
        .values({
          fileName: p.data.fileName ?? null,
          sheetName: p.data.sheetName ?? null,
          // Which column fed which field, and which of those the admin confirmed.
          columnMapping: { ...p.data.mapping, confirmed: p.data.confirmedColumns },
          ignoredColumns: p.data.ignoredColumns,
          importedById: me.id,
        })
        .returning({ id: collectionMasterImports.id });
      const importId = batch!.id;

      const rows: MasterImportResult["rows"] = [];
      const changes: unknown[] = [];
      const totals = { inserted: 0, updated: 0, unchanged: 0, keptExisting: 0, duplicates: 0, rejected: 0, conflicts: 0 };
      const firstMsg = (r: PlannedRow, level: "error" | "info" | "warning") => r.messages.find((m) => m.level === level)?.text ?? null;

      for (const r of plan.rows) {
        if (r.status === "rejected") {
          totals.rejected++;
          rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "rejected", message: firstMsg(r, "error") });
        } else if (r.status === "duplicate") {
          totals.duplicates++;
          rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "skipped-duplicate", message: firstMsg(r, "info") });
        } else if (r.status === "unchanged") {
          totals.unchanged++;
          rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "unchanged", message: null });
        } else if (r.status === "new") {
          const ins = await tx
            .insert(collectionMasterCompanies)
            .values({
              companyName: r.companyName,
              nameKey: r.nameKey,
              coordinatorLabel: r.coordinatorLabel,
              paymentTerms: r.paymentTerms,
              customerMasterId: r.customerMasterId,
              clientMatch: r.clientMatch,
              createdImportId: importId,
              lastImportId: importId,
              createdById: me.id,
              updatedById: me.id,
            })
            .onConflictDoNothing({ target: collectionMasterCompanies.nameKey })
            .returning({ id: collectionMasterCompanies.id });
          if (ins.length === 0) {
            totals.conflicts++;
            rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "skipped-conflict", message: "Added by someone else meanwhile; not written. Preview again." });
          } else {
            totals.inserted++;
            changes.push({ companyId: ins[0]!.id, action: "inserted", rowNo: r.rowNo, after: { companyName: r.companyName, coordinatorLabel: r.coordinatorLabel, paymentTerms: r.paymentTerms, customerMasterId: r.customerMasterId, clientMatch: r.clientMatch } });
            rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "inserted", message: null });
          }
        } else if (r.status === "changed") {
          if (!accepted.has(r.rowNo)) {
            totals.keptExisting++;
            rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "kept-existing", message: "Not accepted; the stored values were kept." });
            continue;
          }
          const ex = existing.get(r.nameKey)!;
          const set: Partial<typeof collectionMasterCompanies.$inferInsert> = { lastImportId: importId, updatedById: me.id, updatedAt: new Date() };
          for (const c of r.changes) {
            if (c.field === "coordinatorLabel") set.coordinatorLabel = c.to;
            else set.paymentTerms = c.to;
          }
          // Only if the stored values are still exactly what this plan compared against.
          const coordSame =
            ex.coordinatorLabel === null
              ? isNull(collectionMasterCompanies.coordinatorLabel)
              : eq(collectionMasterCompanies.coordinatorLabel, ex.coordinatorLabel);
          const termsSame =
            ex.paymentTerms === null
              ? isNull(collectionMasterCompanies.paymentTerms)
              : eq(collectionMasterCompanies.paymentTerms, ex.paymentTerms);
          const upd = await tx
            .update(collectionMasterCompanies)
            .set(set)
            .where(and(eq(collectionMasterCompanies.id, ex.id), coordSame, termsSame))
            .returning({ id: collectionMasterCompanies.id });
          if (upd.length === 0) throw new StaleError(r.companyName);
          totals.updated++;
          changes.push({
            companyId: ex.id,
            action: "updated",
            rowNo: r.rowNo,
            before: { coordinatorLabel: ex.coordinatorLabel, paymentTerms: ex.paymentTerms },
            after: Object.fromEntries(r.changes.map((c) => [c.field, c.to])),
          });
          rows.push({ rowNo: r.rowNo, companyName: r.companyName, outcome: "updated", message: r.changes.map((c) => `${c.field === "coordinatorLabel" ? "Coordinator" : "Payment terms"}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join("; ") });
        }
      }

      await tx
        .update(collectionMasterImports)
        .set({ totals: { ...totals, rows: plan.rows.length }, changes })
        .where(eq(collectionMasterImports.id, importId));

      return { importId, totals, rows } satisfies MasterImportResult;
    });

    revalidatePath("/forms/collection/master");
    revalidatePath("/forms/collection/tracker");
    revalidatePath("/forms/collection/dashboard");
    return { ok: true, result };
  } catch (err) {
    if (err instanceof StaleError) {
      return {
        ok: false,
        error: `A company you accepted a change for (${err.message}) no longer matches the preview — someone edited it meanwhile. Nothing was imported — preview again.`,
      };
    }
    if (isMissingTable(err)) return { ok: false, error: STORAGE_NOT_READY };
    console.error("[collection-master] import failed", err);
    return { ok: false, error: "The import could not be completed, so nothing was saved. Please try again." };
  }
}
