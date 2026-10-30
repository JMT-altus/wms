"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionBalanceLines, collectionBalanceSnapshots, collectionMasterCompanies, collectionMasterImports } from "@/db/schema";
import { requireCollectionCapability } from "@/lib/auth/capability";
import { rateLimitOrError } from "@/lib/rate-limit";
import { nameKey } from "@/lib/collections/master/normalize";
import { buildMasterPlan, type ClientMatch } from "@/lib/collections/master/plan";
import { GRID_LIMITS, parseBalanceRows, type BalanceSheet } from "@/lib/collections/balances/parse";
import { buildBalancePlan, missingCompanies, type BalanceCompany, type BalancePlan, type BalanceSummary, type PlannedBalanceRow } from "@/lib/collections/balances/plan";
import { TRACKER_BALANCES_SOURCE, isMissingTable, loadClientMasterIndex, loadExistingByKeys } from "@/lib/queries/collection-master";
import { companyIdsInSnapshot, latestBalanceSnapshot } from "@/lib/queries/collection-balances";
import { completeWeeklyUploadAfterImport } from "@/lib/collections/weekly-upload/server";

/**
 * Tracker Bulk Upload — Tally customer summary (Debit / Credit per company).
 * Needs collection.balances.import (and, like all of Forms, an admin) — checked
 * here because a page guard does not protect a server action.
 *
 * What the server trusts: nothing the browser derived. The browser sends the
 * sheet's RAW CELLS (a grid of text) and two labels. The server runs the same
 * layout parser on that grid itself, so the rows, the company names, the
 * Debit / Credit text, the report title, the reporting period and the file's own
 * Grand Total all come from the grid, never from fields the client computed.
 * The server then checks that the rows add up to that Grand Total (within a
 * documented rounding tolerance) and refuses anything that doesn't — for the
 * read-only preview and again, inside the write transaction, at confirmation.
 * The content hash is also computed here, from the grid.
 *
 * What it cannot prove: that the grid is an unaltered Tally export. Only the
 * cells reach the server, never the file (and parsing uploaded workbooks on the
 * server would expose it to the known advisories in the installed `xlsx`
 * release). A person holding this permission could submit a grid they edited
 * so that it is self-consistent; the checks catch an inconsistent or incomplete
 * one, not a deliberately re-totalled one. `fileName` and `sheetName` are
 * labels typed by the client and are kept for audit only.
 *
 * Each applied upload is one dated snapshot; the Tracker shows the newest one
 * only. Nothing is summed across uploads. The upload itself never creates or
 * edits a Collection Master company, and never touches follow-ups, comments,
 * coordinators, commitments, confirmations or escalations.
 *
 * Companies the file names that are not in the Collection Master are skipped.
 * addMissingBalanceCompanies — a separate, explicitly confirmed step that also
 * needs collection.master.import — adds exactly those companies as Unassigned,
 * after which the preview is run again and the balances confirmed as usual.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const GridSchema = z
  .array(z.array(z.string().max(GRID_LIMITS.cellChars)).max(GRID_LIMITS.columns))
  .min(1, "The file has no rows to import.")
  .max(GRID_LIMITS.rows, `Upload at most ${GRID_LIMITS.rows} sheet rows at a time.`);

const BaseSchema = z.object({
  /** Client-typed labels, kept for audit only. */
  fileName: z.string().max(200).optional(),
  sheetName: z.string().max(200).optional(),
  grid: GridSchema,
});

const ImportSchema = BaseSchema.extend({
  /** The newest snapshot the preview saw (null = none). The write refuses if another upload landed since. */
  previousSnapshotId: z.string().uuid().nullable(),
  /** What the preview showed; the write refuses if the recomputed plan differs. A staleness guard only — the plan is always recomputed. */
  expected: z.object({ matched: z.number().int().min(0), debitPaise: z.number().int(), creditPaise: z.number().int() }),
  confirm: z.literal(true, { message: "Review the preview and confirm the upload first." }),
});

const STORAGE_NOT_READY = "Balance storage isn't set up yet (migration 0117 is pending), so nothing can be uploaded.";

async function guard() {
  const proof = await requireCollectionCapability("collection.balances.import");
  const limited = rateLimitOrError(proof.employeeId, "write");
  return { me: { id: proof.employeeId }, limited };
}

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid upload data.";

type Reader = Pick<typeof db, "select">;

async function companiesFor(q: Reader, keys: string[]): Promise<Map<string, BalanceCompany>> {
  const found = await loadExistingByKeys(q as unknown as typeof db, keys);
  return new Map([...found].map(([k, v]) => [k, { id: v.id, companyName: v.companyName }]));
}

/** SHA-256 of the cell contents, computed here. Only used to warn about re-uploading the same sheet. */
const contentHash = (grid: string[][]): string => createHash("sha256").update(JSON.stringify(grid)).digest("hex");

interface Derived {
  sheet: BalanceSheet;
  hash: string;
}

/** The sheet as the server reads it from the raw cells. */
function readGrid(grid: string[][], label: string | undefined): Result<{ derived: Derived }> {
  const parsed = parseBalanceRows(grid, label ?? "Sheet");
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, derived: { sheet: parsed.sheet, hash: contentHash(grid) } };
}

function planFor(d: Derived, companies: Map<string, BalanceCompany>): BalancePlan {
  return buildBalancePlan(d.sheet.rows, companies, d.sheet.sourceTotal);
}

export interface BalanceReplacement {
  /** The snapshot this upload would replace on the Tracker; null = first upload. */
  previous: { id: string; fileName: string | null; periodFrom: string | null; periodTo: string | null; uploadedAt: string; companies: number } | null;
  /** Companies that show a balance now but are missing from this file, so would go blank. */
  wouldGoBlank: number;
  /** The very same sheet contents were the last ones applied. */
  sameFileAsPrevious: boolean;
}

export interface BalancePreview {
  storageReady: boolean;
  summary: BalanceSummary;
  rows: PlannedBalanceRow[];
  replacement: BalanceReplacement;
  /** What the SERVER read from the grid. */
  report: { reportTitle: string | null; periodFrom: string | null; periodTo: string | null };
}

/** Read-only: what an upload would do. Writes nothing. */
export async function previewCollectionBalances(raw: unknown): Promise<Result<{ preview: BalancePreview }>> {
  const { limited } = await guard();
  if (limited) return limited;
  const p = BaseSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const read = readGrid(p.data.grid, p.data.sheetName);
  if (!read.ok) return read;
  const { derived } = read;

  let companies: Map<string, BalanceCompany>;
  try {
    companies = await companiesFor(db, derived.sheet.rows.map((r) => nameKey(r.name)).filter(Boolean));
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: "Collection Master storage isn't set up yet (migration 0112 is pending), so companies can't be matched." };
    console.error("[collection-balances] preview read failed", err);
    return { ok: false, error: "Could not check the file against the Collection Master. Please try again." };
  }

  const plan = planFor(derived, companies);
  const incoming = new Set(plan.toWrite.map((r) => r.companyId!));
  let storageReady = true;
  let replacement: BalanceReplacement = { previous: null, wouldGoBlank: 0, sameFileAsPrevious: false };
  try {
    const prev = await latestBalanceSnapshot(db);
    if (prev) {
      const had = await companyIdsInSnapshot(db, prev.id);
      replacement = {
        previous: {
          id: prev.id,
          fileName: prev.fileName,
          periodFrom: prev.periodFrom,
          periodTo: prev.periodTo,
          uploadedAt: prev.uploadedAt.toISOString(),
          companies: had.size,
        },
        wouldGoBlank: [...had].filter((id) => !incoming.has(id)).length,
        sameFileAsPrevious: prev.fileHash === derived.hash,
      };
    }
  } catch (err) {
    if (!isMissingTable(err)) {
      console.error("[collection-balances] preview read failed", err);
      return { ok: false, error: "Could not read the current balances. Please try again." };
    }
    storageReady = false;
  }

  return {
    ok: true,
    preview: {
      storageReady,
      summary: plan.summary,
      rows: plan.rows,
      replacement,
      report: { reportTitle: derived.sheet.reportTitle, periodFrom: derived.sheet.periodFrom, periodTo: derived.sheet.periodTo },
    },
  };
}

export interface BalanceImportResult {
  snapshotId: string;
  written: number;
  skipped: { unmatched: number; duplicates: number; conflicts: number; rejected: number };
  totals: { debit: number; credit: number };
}

class RefusedError extends Error {}

const toNumeric = (paise: number | null): string | null => (paise === null ? null : (paise / 100).toFixed(2));

/** Writes the confirmed upload as ONE new snapshot, in one transaction. */
export async function importCollectionBalances(raw: unknown): Promise<Result<{ result: BalanceImportResult }>> {
  const { me, limited } = await guard();
  if (limited) return limited;
  const p = ImportSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const data = p.data;
  const read = readGrid(data.grid, data.sheetName);
  if (!read.ok) return read;
  const { derived } = read;

  let uploadedAt = new Date();
  try {
    const result = await db.transaction(async (tx) => {
      // One upload at a time, so "the newest snapshot" is well defined while we check and write.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('collection_balance_snapshots'))`);

      const prev = await latestBalanceSnapshot(tx as unknown as typeof db);
      if ((prev?.id ?? null) !== data.previousSnapshotId) throw new RefusedError("Another balance upload was applied since your preview. Nothing was imported — preview again.");

      const companies = await companiesFor(tx as unknown as typeof db, derived.sheet.rows.map((r) => nameKey(r.name)).filter(Boolean));
      const plan = planFor(derived, companies);
      const s = plan.summary;
      // The rows must add up to the file's own Grand Total, or nothing is written.
      if (s.verification.status !== "ok") throw new RefusedError(s.verification.message ?? "The rows can't be verified against the file's Grand Total, so nothing was imported.");
      const fp = s.fingerprint;
      if (fp.matched !== data.expected.matched || fp.debitPaise !== data.expected.debitPaise || fp.creditPaise !== data.expected.creditPaise) {
        throw new RefusedError("The companies or figures changed since your preview. Nothing was imported — preview again.");
      }
      if (plan.toWrite.length === 0) throw new RefusedError("No row matches a Collection Master company, so there is nothing to import.");

      const [snap] = await tx
        .insert(collectionBalanceSnapshots)
        .values({
          fileName: data.fileName ?? null,
          sheetName: data.sheetName ?? derived.sheet.sheet,
          fileHash: derived.hash,
          reportTitle: derived.sheet.reportTitle,
          periodFrom: derived.sheet.periodFrom,
          periodTo: derived.sheet.periodTo,
          sourceTotalDebit: s.totals.source ? s.totals.source.debit.toFixed(2) : null,
          sourceTotalCredit: s.totals.source ? s.totals.source.credit.toFixed(2) : null,
          importedTotalDebit: (fp.debitPaise / 100).toFixed(2),
          importedTotalCredit: (fp.creditPaise / 100).toFixed(2),
          totals: {
            rows: s.rows,
            matched: s.matched,
            unmatched: s.unmatched,
            duplicates: s.duplicates,
            conflicts: s.conflicts,
            rejected: s.rejected,
            negatives: s.negatives,
            verification: { status: s.verification.status, tolerancePaise: s.verification.tolerancePaise, differencePaise: s.verification.differencePaise },
            replacedSnapshotId: prev?.id ?? null,
          },
          uploadedById: me.id,
        })
        .returning({ id: collectionBalanceSnapshots.id, uploadedAt: collectionBalanceSnapshots.uploadedAt });
      const snapshotId = snap!.id;
      uploadedAt = snap!.uploadedAt ?? uploadedAt;

      for (let i = 0; i < plan.toWrite.length; i += 500) {
        await tx.insert(collectionBalanceLines).values(
          plan.toWrite.slice(i, i + 500).map((r) => ({
            snapshotId,
            companyId: r.companyId!,
            sourceName: r.name,
            sourceRow: r.rowNo,
            debit: toNumeric(r.debitPaise),
            credit: toNumeric(r.creditPaise),
          })),
        );
      }
      return {
        snapshotId,
        written: plan.toWrite.length,
        skipped: { unmatched: s.unmatched, duplicates: s.duplicates, conflicts: s.conflicts, rejected: s.rejected },
        totals: s.totals.imported,
      } satisfies BalanceImportResult;
    });

    revalidatePath("/forms/collection/tracker");
    revalidatePath("/forms/collection/dashboard");
    // The snapshot is committed: this upload completes the week's compulsory
    // task (see lib/collections/weekly-upload). Only here — never after a
    // preview, a refusal or a failed transaction — and it can't fail the upload.
    await completeWeeklyUploadAfterImport({ id: result.snapshotId, periodTo: derived.sheet.periodTo, uploadedAt, uploadedById: me.id });
    return { ok: true, result };
  } catch (err) {
    if (err instanceof RefusedError) return { ok: false, error: err.message };
    if (isMissingTable(err)) return { ok: false, error: STORAGE_NOT_READY };
    console.error("[collection-balances] import failed", err);
    return { ok: false, error: "The upload could not be completed, so nothing was saved. Please try again." };
  }
}

const AddCompaniesSchema = BaseSchema.extend({
  /** What the preview showed as "Not in Master"; the write refuses if the recomputed list differs. */
  expected: z.object({ unmatched: z.number().int().min(1) }),
  confirm: z.literal(true, { message: "Review the companies to add and confirm first." }),
});

export type AddedCompanyOutcome = "created" | "already-existed" | "rejected";

export interface AddedCompaniesResult {
  /** The Collection Master change-log row this step wrote. */
  importId: string;
  created: number;
  /** Already in the Master by the time the write ran (added by someone else meanwhile, or this request repeated). */
  alreadyExisted: number;
  /** Refused by the Collection Master's own row rules (e.g. a name longer than it allows). */
  rejected: number;
  companies: { rowNo: number; name: string; outcome: AddedCompanyOutcome; clientMatch: ClientMatch | null; message: string | null }[];
}

/**
 * Adds the companies the file names that are not in the Collection Master —
 * exactly the preview's "Not in Master" rows, re-derived here from the raw
 * cells — as Unassigned (no Sales Coordinator, no payment terms). Needs
 * collection.master.import as well as collection.balances.import: creating a
 * Collection Master company is the Master import's power, and this step uses
 * the Master import's own row rules and Client Master linking.
 *
 * Writes nothing else: no balances (confirm those after previewing again), no
 * change to any existing company, coordinator, follow-up, comment, commitment,
 * confirmation or escalation. Safe to repeat: a company that exists by the time
 * the write runs — whoever added it — is left exactly as it is (`name_key` is
 * unique, and the insert does nothing on conflict), so the same request twice
 * creates nothing the second time.
 */
export async function addMissingBalanceCompanies(raw: unknown): Promise<Result<{ result: AddedCompaniesResult }>> {
  const { me, limited } = await guard();
  if (limited) return limited;
  await requireCollectionCapability("collection.master.import");
  const p = AddCompaniesSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const data = p.data;
  const read = readGrid(data.grid, data.sheetName);
  if (!read.ok) return read;
  const { derived } = read;

  try {
    const result = await db.transaction(async (tx) => {
      // One "add missing companies" at a time, so the list is decided against a settled Master.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('collection_master_companies'))`);
      const q = tx as unknown as typeof db;

      const companies = await companiesFor(q, derived.sheet.rows.map((r) => nameKey(r.name)).filter(Boolean));
      const missing = missingCompanies(planFor(derived, companies).rows);
      if (missing.length === 0) throw new RefusedError("Every company in the file is already in the Collection Master, so there is nothing to add.");
      if (missing.length !== data.expected.unmatched) {
        throw new RefusedError("The companies not in the Collection Master changed since your preview. Nothing was added — preview again.");
      }

      // The Collection Master import's own rules, with no coordinator or payment-terms column
      // mapped: each name becomes a "new" row, linked to the Client Master exactly as an import would.
      const existing = await loadExistingByKeys(q, missing.map((m) => m.nameKey));
      const clients = await loadClientMasterIndex(q);
      const master = buildMasterPlan(
        missing.map((m) => ({ rowNo: m.rowNo, company: m.name, coordinator: "", paymentTerms: "" })),
        existing,
        clients,
        { mapped: { coordinator: false, paymentTerms: false } },
      );

      const [batch] = await tx
        .insert(collectionMasterImports)
        .values({
          fileName: data.fileName ?? null,
          sheetName: data.sheetName ?? derived.sheet.sheet,
          columnMapping: { source: TRACKER_BALANCES_SOURCE, field: "companyName" },
          importedById: me.id,
        })
        .returning({ id: collectionMasterImports.id });
      const importId = batch!.id;

      const out: AddedCompaniesResult["companies"] = [];
      const changes: unknown[] = [];
      const totals = { inserted: 0, alreadyExisted: 0, rejected: 0 };
      for (const r of master.rows) {
        if (r.status === "rejected") {
          totals.rejected++;
          out.push({ rowNo: r.rowNo, name: r.companyName || "(blank)", outcome: "rejected", clientMatch: null, message: r.messages.find((m) => m.level === "error")?.text ?? null });
          continue;
        }
        if (r.status !== "new") {
          // In the Master after all (added between the check above and here): left exactly as it is.
          totals.alreadyExisted++;
          out.push({ rowNo: r.rowNo, name: r.companyName, outcome: "already-existed", clientMatch: null, message: null });
          continue;
        }
        const ins = await tx
          .insert(collectionMasterCompanies)
          .values({
            companyName: r.companyName,
            nameKey: r.nameKey,
            coordinatorLabel: null,
            paymentTerms: null,
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
          totals.alreadyExisted++;
          out.push({ rowNo: r.rowNo, name: r.companyName, outcome: "already-existed", clientMatch: null, message: null });
          continue;
        }
        totals.inserted++;
        changes.push({
          companyId: ins[0]!.id,
          action: "inserted",
          rowNo: r.rowNo,
          source: TRACKER_BALANCES_SOURCE,
          after: { companyName: r.companyName, coordinatorLabel: null, paymentTerms: null, customerMasterId: r.customerMasterId, clientMatch: r.clientMatch },
        });
        out.push({ rowNo: r.rowNo, name: r.companyName, outcome: "created", clientMatch: r.clientMatch, message: null });
      }

      await tx
        .update(collectionMasterImports)
        .set({ totals: { ...totals, rows: master.rows.length }, changes })
        .where(eq(collectionMasterImports.id, importId));

      return { importId, created: totals.inserted, alreadyExisted: totals.alreadyExisted, rejected: totals.rejected, companies: out } satisfies AddedCompaniesResult;
    });

    revalidatePath("/forms/collection/master");
    revalidatePath("/forms/collection/tracker");
    revalidatePath("/forms/collection/dashboard");
    return { ok: true, result };
  } catch (err) {
    if (err instanceof RefusedError) return { ok: false, error: err.message };
    if (isMissingTable(err)) return { ok: false, error: "Collection Master storage isn't set up yet (migration 0112 is pending), so no company can be added." };
    console.error("[collection-balances] add missing companies failed", err);
    return { ok: false, error: "The companies could not be added, so nothing was saved. Please try again." };
  }
}
