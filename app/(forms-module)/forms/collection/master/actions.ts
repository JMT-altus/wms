"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionMasterCompanies, collectionMasterImports } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { nameKey } from "@/lib/collections/master/normalize";
import { buildMasterPlan, type MasterPlan, type PlannedRow, type PlanSummary } from "@/lib/collections/master/plan";
import { isMissingTable, loadClientMasterIndex, loadExistingByKeys } from "@/lib/queries/collection-master";

/**
 * Collection Master import. Admin-only (the Forms area is, and the check is
 * repeated here because a page guard does not protect a server action).
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
});

const ImportSchema = BaseSchema.extend({
  /** Row numbers of "changed" rows the admin explicitly accepted. */
  acceptChanges: z.array(z.number().int().min(1)).max(MAX_ROWS).default([]),
  confirm: z.literal(true, { message: "Review the preview and confirm the import first." }),
});

const STORAGE_NOT_READY =
  "Collection Master storage isn't set up yet (migration 0112 is pending), so nothing can be imported.";

async function guard() {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  return { me, limited };
}

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid import data.";

function planFor(data: z.output<typeof BaseSchema>, existing: Awaited<ReturnType<typeof loadExistingByKeys>>, clients: Map<string, string[]>): MasterPlan {
  return buildMasterPlan(data.rows, existing, clients, {
    mapped: { coordinator: data.mapping.coordinator !== null, paymentTerms: data.mapping.paymentTerms !== null },
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
  const keys = p.data.rows.map((r) => nameKey(r.company));
  let storageReady = true;
  let existing = new Map() as Awaited<ReturnType<typeof loadExistingByKeys>>;
  try {
    existing = await loadExistingByKeys(db, keys);
  } catch (err) {
    if (!isMissingTable(err)) {
      console.error("[collection-master] preview read failed", err);
      return { ok: false, error: "Could not check the file against the Collection Master. Please try again." };
    }
    storageReady = false;
  }
  try {
    const clients = await loadClientMasterIndex(db);
    const plan = planFor(p.data, existing, clients);
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
  const accepted = new Set(p.data.acceptChanges);
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
      const plan = planFor(p.data, existing, clients);

      const [batch] = await tx
        .insert(collectionMasterImports)
        .values({
          fileName: p.data.fileName ?? null,
          sheetName: p.data.sheetName ?? null,
          columnMapping: p.data.mapping,
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
          if (upd.length === 0) throw new StaleError("stale");
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
      return { ok: false, error: "A company you accepted a change for was edited by someone else meanwhile. Nothing was imported — preview again." };
    }
    if (isMissingTable(err)) return { ok: false, error: STORAGE_NOT_READY };
    console.error("[collection-master] import failed", err);
    return { ok: false, error: "The import could not be completed, so nothing was saved. Please try again." };
  }
}
