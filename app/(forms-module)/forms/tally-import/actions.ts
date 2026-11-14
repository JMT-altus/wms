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
import { FieldConfigChanged, batchProblems, checkRows, countBatchDocuments, finishBatch, getBatch, importChunk, recordChunkFailure, salesOrderCustomerDetails, salesOrderDetailsReady, savedMapping, startBatch, type StartResult } from "@/lib/queries/tally-import";
import { loadSalesOrderCatalogue, recordBatchFieldVersion } from "@/lib/queries/sales-order-fields";
import { salesOrderMappingFields } from "@/lib/tally/categories";
import { db } from "@/lib/db";
import { NO_LINKS } from "@/lib/tally/sales-order-match";

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
 *
 * Sales Orders add one thing a person may decide: which Customer Master or
 * Product Master record an unrecognised name means ("links"). They are accepted
 * only from someone holding the import permission, are looked up in the masters
 * on every call, and are used only for names the masters could not settle.
 */

const today = () => localDateString("Asia/Kolkata");
const NOT_READY = "Tally import isn't set up on this database yet (database update 0122 is needed), so nothing was changed.";
/** tally_documents without its `details` column (0127): a document can't be written without dropping a Sales Order's fields. */
const DETAILS_NOT_READY = "Importing Tally documents needs database update 0127 (Sales Order details) first, so nothing was changed.";

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
  .array(z.object({ rowNo: z.number().int().min(1), cells: z.array(z.string().max(TALLY_LIMITS.cellChars)).max(TALLY_LIMITS.columns), breakBefore: z.boolean().optional() }).strict())
  .max(TALLY_LIMITS.chunkRows * 4);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MAX_LINKS = 2000;
const linkMap = (value: RegExp) => z.record(z.string().min(1).max(TALLY_LIMITS.cellChars), z.string().regex(value)).refine((o) => Object.keys(o).length <= MAX_LINKS, "Too many matches.");
/** Sales Orders only: a person's own matches, by normalized name. */
const Links = z.object({ customers: linkMap(new RegExp(`^${UUID}$`, "i")), products: linkMap(new RegExp(`^(sku|product):${UUID}$`, "i")), ledgers: linkMap(/^.{1,500}$/).optional() }).strict();
const Mapping = z.record(z.string(), z.number().int().min(0).max(TALLY_LIMITS.columns));
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const Direction = z.enum(["receivable", "payable"]).nullable();
/** The fields a category's mapping may use: Sales Orders' come from the stored field configuration. */
async function categoryFields(category: TallyCategoryKey) {
  return category === "sales-orders" ? salesOrderMappingFields((await loadSalesOrderCatalogue()).catalogue) : TALLY_CATEGORIES[category].fields;
}
const fieldsAreKnown = (fields: readonly { key: string }[], mapping: TallyMapping) => Object.keys(mapping).every((k) => fields.some((f) => f.key === k));
const FIELDS_CHANGED = "The Sales Order fields were changed in Admin & Master Setup after this was validated. Nothing was imported: validate again.";
/** Sales Orders: the field configuration version the browser validated against (null for other categories). */
const ConfigVersion = z.number().int().min(0).nullable().optional();

export async function getSavedTallyMapping(category: unknown): Promise<Record<string, string> | null> {
  await viewer();
  return savedMapping(Category.parse(category));
}

const CheckInput = z.object({ category: Category, mapping: Mapping, rows: Rows, asOfDate: Day, direction: Direction, links: Links.optional(), fieldConfigVersion: ConfigVersion }).strict();

/** Validation. Reads the database, writes nothing. */
export async function checkTallyChunk(raw: unknown) {
  await guard();
  const p = CheckInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: "That data couldn't be read." };
  const { category, mapping, rows, asOfDate, direction } = p.data;
  try {
    if (!fieldsAreKnown(await categoryFields(category), mapping)) return { ok: false as const, error: "The column mapping isn't valid for this category." };
    const checked = await checkRows(category, rows, mapping, { asOfDate, direction, today: today() }, category === "sales-orders" ? (p.data.links ?? NO_LINKS) : NO_LINKS);
    // The browser's own copy of the configuration is stale: its plan (and its form) may not be the server's.
    if (category === "sales-orders" && p.data.fieldConfigVersion != null && checked.fieldConfigVersion !== p.data.fieldConfigVersion) return { ok: false as const, error: "The Sales Order fields were changed in Admin & Master Setup. Reload the page to use the current fields." };
    return { ok: true as const, rows: checked.rows, matches: checked.matches, fieldConfigVersion: checked.fieldConfigVersion };
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
    fieldConfigVersion: ConfigVersion,
  })
  .strict();

export async function startTallyImport(raw: unknown): Promise<StartResult> {
  const proof = await guard();
  const limited = rateLimitOrError(proof.employeeId, "write");
  if (limited) return limited;
  const p = StartInputSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "That import request couldn't be read." };
  const v = p.data;
  const fields = await categoryFields(v.category);
  if (!fieldsAreKnown(fields, v.mapping) || !mappingIsUsable(checkMapping(v.category, v.mapping, v.headers, v.sample.map((r) => r.cells), fields))) {
    return { ok: false, error: "The column mapping isn't complete. Fix it and validate again." };
  }
  if (v.category === "sales-orders") {
    const current = (await loadSalesOrderCatalogue()).catalogue.version;
    if (v.fieldConfigVersion == null || v.fieldConfigVersion !== current) return { ok: false, error: FIELDS_CHANGED };
  }
  if (TALLY_CATEGORIES[v.category].kind === "outstanding" && (!v.asOfDate || !v.direction)) return { ok: false, error: "Choose the as-of date and whether these are receivable or payable." };
  try {
    // Every document type writes tally_documents, whose insert names every column: refuse before anything starts.
    if (TALLY_CATEGORIES[v.category].kind === "document" && !(await salesOrderDetailsReady())) return { ok: false, error: DETAILS_NOT_READY };
    const started = await startBatch({ ...v, mappingHeadings: mappingToHeadings(v.mapping, v.headers) }, proof.employeeId);
    if (started.ok && v.category === "sales-orders" && v.fieldConfigVersion != null) await recordBatchFieldVersion(db, started.batchId, v.fieldConfigVersion);
    return started;
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, error: NOT_READY };
    console.error("[tally-import] start failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "The import could not start. Nothing was changed." };
  }
}

const ChunkInput = z.object({ batchId: z.string().uuid(), rows: Rows, links: Links.optional(), fieldConfigVersion: ConfigVersion }).strict();

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
    const links = own.batch.category === "sales-orders" ? (p.data.links ?? NO_LINKS) : NO_LINKS;
    const version = own.batch.category === "sales-orders" ? (p.data.fieldConfigVersion ?? null) : null;
    if (own.batch.category === "sales-orders" && version === null) return { ok: false as const, error: FIELDS_CHANGED };
    return { ok: true as const, counts: await importChunk(own.batch, p.data.rows, proof.employeeId, today(), links, version) };
  } catch (err) {
    // Not a failure to retry: nothing of this part was written, and the person must validate again.
    if (err instanceof FieldConfigChanged) return { ok: false as const, error: FIELDS_CHANGED };
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
  // One document per voucher, however many rows it had: counted from the ledger, not from the rows.
  const documents = await countBatchDocuments(batchId);
  // Every Forms section reads what an import writes (the ledgers, the masters,
  // the overview counts, the history), and the Masters module's Customer Master
  // shows the same register.
  revalidatePath("/forms", "layout");
  revalidatePath("/masters/customers");
  return { ok: true as const, batch, documents };
}

/**
 * The manual Sales Order form: a chosen customer's details from the Customer Master, to start the buyer's details
 * from. The same gate as validating (the import permission); read-only.
 */
export async function getSalesOrderCustomer(raw: unknown) {
  await guard();
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) return null;
  try {
    return await salesOrderCustomerDetails(id.data);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Why a batch's rows didn't import. For anyone who can open this page. */
export async function getTallyBatchProblems(raw: unknown) {
  await viewer();
  return batchProblems(z.string().uuid().parse(raw));
}
