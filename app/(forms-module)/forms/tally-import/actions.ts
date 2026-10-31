"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current";
import { requireCapability } from "@/lib/auth/capability";
import { canAccessModule } from "@/lib/auth/module-access";
import { rateLimitOrError } from "@/lib/rate-limit";
import { localDateString } from "@/lib/format";
import { TALLY_CATEGORIES, TALLY_LIMITS, TALLY_CATEGORY_KEYS, type TallyCategoryKey } from "@/lib/tally/categories";
import { checkMapping, mappingIsUsable, mappingToHeadings, type TallyMapping } from "@/lib/tally/mapping";
import { isMissingTable } from "@/lib/queries/collection-master";
import { batchProblems, checkRows, finishBatch, getBatch, importChunk, recordChunkFailure, savedMapping, startBatch, type StartResult } from "@/lib/queries/tally-import";

/**
 * Tally Data Import, a section of the Forms module. Opening it needs the Forms
 * module (Admin → Access) and admin; validating and importing also need the
 * sensitive `tally.import` permission. All three are checked here from the
 * signed session on every call, because a hidden button protects nothing — and
 * a Forms grant on its own never implies the import permission.
 *
 * The browser sends raw cells only. The server plans them itself and, for an
 * import, uses the mapping stored on the batch, so nothing the browser concluded
 * decides what is written. Only the batch's creator can write into it.
 */

const today = () => localDateString("Asia/Kolkata");
const NOT_READY = "Tally import isn't set up on this database yet (database update 0122 is needed), so nothing was changed.";

/** Admin, inside the Forms module. The gate for reading the history and the saved mappings. */
async function viewer() {
  const me = await requireAdmin();
  if (!(await canAccessModule("forms"))) throw new Error("Forbidden");
  return me;
}

/** Everything `viewer` needs, plus the sensitive import permission. */
async function guard() {
  await viewer();
  return requireCapability("tally.import");
}

const Category = z.enum(TALLY_CATEGORY_KEYS);
const Rows = z
  .array(z.object({ rowNo: z.number().int().min(1), cells: z.array(z.string().max(TALLY_LIMITS.cellChars)).max(TALLY_LIMITS.columns) }).strict())
  .max(TALLY_LIMITS.chunkRows * 4);
const Mapping = z.record(z.string(), z.number().int().min(0).max(TALLY_LIMITS.columns));
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const Direction = z.enum(["receivable", "payable"]).nullable();
const fieldsAreKnown = (category: TallyCategoryKey, mapping: TallyMapping) => Object.keys(mapping).every((k) => TALLY_CATEGORIES[category].fields.some((f) => f.key === k));

export async function getSavedTallyMapping(category: unknown): Promise<Record<string, string> | null> {
  await viewer();
  return savedMapping(Category.parse(category));
}

const CheckInput = z.object({ category: Category, mapping: Mapping, rows: Rows, asOfDate: Day, direction: Direction }).strict();

/** Validation. Reads the database, writes nothing. */
export async function checkTallyChunk(raw: unknown) {
  await guard();
  const p = CheckInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "That data couldn't be read." };
  const { category, mapping, rows, asOfDate, direction } = p.data;
  if (!fieldsAreKnown(category, mapping)) return { ok: false as const, error: "The column mapping isn't valid for this category." };
  try {
    return { ok: true as const, rows: await checkRows(category, rows, mapping, { asOfDate, direction, today: today() }) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false as const, error: NOT_READY };
    console.error("[tally-import] validation failed", err instanceof Error ? err.message : err);
    return { ok: false as const, error: "Validation could not finish. Nothing was changed. Please try again." };
  }
}

const StartInputSchema = z
  .object({
    category: Category,
    fileName: z.string().min(1).max(200),
    fileHash: z.string().regex(/^[0-9a-f]{64}$/),
    sheetName: z.string().max(200).nullable(),
    headers: z.array(z.string().max(TALLY_LIMITS.cellChars)).max(TALLY_LIMITS.columns),
    sample: Rows,
    mapping: Mapping,
    totalRows: z.number().int().min(1).max(TALLY_LIMITS.rows),
    asOfDate: Day,
    direction: Direction,
    includeAttention: z.boolean(),
    confirm: z.literal(true, { message: "Confirm the import first." }),
  })
  .strict();

export async function startTallyImport(raw: unknown): Promise<StartResult> {
  const proof = await guard();
  const limited = rateLimitOrError(proof.employeeId, "write");
  if (limited) return limited;
  const p = StartInputSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "That import request couldn't be read." };
  const v = p.data;
  if (!fieldsAreKnown(v.category, v.mapping) || !mappingIsUsable(checkMapping(v.category, v.mapping, v.headers, v.sample.map((r) => r.cells)))) {
    return { ok: false, error: "The column mapping isn't complete. Fix it and validate again." };
  }
  if (TALLY_CATEGORIES[v.category].kind === "outstanding" && (!v.asOfDate || !v.direction)) return { ok: false, error: "Choose the as-of date and whether these are receivable or payable." };
  try {
    return await startBatch({ ...v, mappingHeadings: mappingToHeadings(v.mapping, v.headers) }, proof.employeeId);
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_READY };
    console.error("[tally-import] start failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "The import could not start. Nothing was changed." };
  }
}

const ChunkInput = z.object({ batchId: z.string().uuid(), rows: Rows }).strict();

async function ownBatch(batchId: string, employeeId: string) {
  const batch = await getBatch(batchId);
  if (!batch || batch.createdById !== employeeId) return { error: "That import wasn't found." } as const;
  return { batch } as const;
}

/** One chunk. Failures are recorded on the batch so a retry can pick up exactly those rows. */
export async function importTallyChunk(raw: unknown) {
  const proof = await guard();
  const p = ChunkInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "That data couldn't be read." };
  const own = await ownBatch(p.data.batchId, proof.employeeId);
  if ("error" in own) return { ok: false as const, error: own.error! };
  if (own.batch.status !== "running") return { ok: false as const, error: "This import has already finished." };
  try {
    return { ok: true as const, counts: await importChunk(own.batch, p.data.rows, proof.employeeId, today()) };
  } catch (err) {
    console.error("[tally-import] chunk failed", err instanceof Error ? err.message : err);
    await recordChunkFailure(own.batch, p.data.rows, "This part of the file couldn't be saved. Upload the same file again to retry it.");
    return { ok: false as const, error: "Part of the file couldn't be saved." };
  }
}

export async function finishTallyImport(raw: unknown) {
  const proof = await guard();
  const batchId = z.string().uuid().parse(raw);
  const own = await ownBatch(batchId, proof.employeeId);
  if ("error" in own) return { ok: false as const, error: own.error! };
  const batch = await finishBatch(batchId, today());
  // Every Forms section reads what an import writes (the ledgers, the masters,
  // the overview counts, the history), and the Masters module's Customer Master
  // shows the same register.
  revalidatePath("/forms", "layout");
  revalidatePath("/masters/customers");
  return { ok: true as const, batch };
}

/** Why a batch's rows didn't import. For anyone who can open this page. */
export async function getTallyBatchProblems(raw: unknown) {
  await viewer();
  return batchProblems(z.string().uuid().parse(raw));
}
