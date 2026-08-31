"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, customerSalesLines, importBatches, products } from "@/db/schema";
import type { Employee } from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { rateLimitOrError } from "@/lib/rate-limit";
import { CUSTOMER_CATEGORY_LIST_KEY } from "@/db/enums";
import { listLookupOptions } from "@/lib/queries/master-data";
import {
  MasterCustomerSchema,
  MasterProductSchema,
} from "@/lib/validators/master-data";
import { splitUsableRows, type BulkTarget, type MappedRow } from "@/lib/masters/bulk-parse";
import {
  computeSalesLineAmounts,
  parseCustomerWorkbook,
  parseDateLoose,
  parseNonNegative,
  parseYesNoStrict,
  validateAccountRow,
  validateBasicRow,
  validateSalesRow,
  SHEET_NAMES,
  type SheetRow,
} from "@/lib/masters/customer-workbook";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const PATHS = ["/masters", "/masters/products", "/masters/customers"];
function revalidateMasters(): void {
  for (const p of PATHS) revalidatePath(p);
  // /master-setup edits the same two tables — leaving its cache warm would show
  // an admin stale rows there right after saving here.
  revalidatePath("/master-setup/products");
  revalidatePath("/master-setup/customers");
}

/**
 * Writes are gated on the MODULE grant, not on `isAdmin`.
 *
 * The grant is the permission: whoever an admin lets into Masters is the person
 * meant to maintain this data, and admins pass automatically (the resolver's
 * admin bypass). Gating on isAdmin instead would render a full editing screen
 * to a granted non-admin and then reject every save — a permission model the
 * UI contradicts.
 *
 * Returns a Result rather than redirecting, so a form can show the reason.
 */
type Denied = { ok: false; error: string };

async function guard(): Promise<{ me: Employee } | { error: Denied }> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return { error: { ok: false, error: "Please sign in again." } };
  if (!(await canAccessModule("masters"))) {
    return { error: { ok: false, error: "You don't have access to Masters." } };
  }
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { error: limited };
  return { me };
}

function zodError(err: unknown): string {
  const issues = (err as { issues?: { message: string }[] })?.issues;
  return issues?.[0]?.message ?? "Please check the values and try again.";
}

function dbError(err: unknown, label: string): string {
  const e = err as { code?: string; message?: string; cause?: { code?: string } };
  // drizzle-orm wraps the real postgres error in `.cause` — the pg error code
  // (e.g. 23505 unique_violation) lives there, not on the thrown error itself.
  if (e?.code === "23505" || e?.cause?.code === "23505") return `That ${label} is already in use.`;
  return `Could not save: ${e?.message ?? String(err)}`;
}

/* ── Product Master ──────────────────────────────────────────────────────── */

export async function saveMasterProduct(id: string | null, input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const parsed = MasterProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      // Only the four columns this screen owns — a product may also carry a
      // category, brand, HP and Tally name set from /master-setup, and this
      // form never renders them, so it must not write them.
      await db
        .update(products)
        .set({
          name: v.name,
          code: v.code,
          specification: v.specification,
          isActive: v.isActive,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(products)
      .values({ ...v, createdById: g.me.id })
      .returning({ id: products.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "product code") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteMasterProduct(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const g = await guard();
  if ("error" in g) return g.error;
  try {
    await db.delete(products).where(eq(products.id, id));
  } catch (err) {
    // A product referenced by a SKU or a customer mapping can't be removed —
    // say so instead of surfacing a raw FK violation.
    return { ok: false, error: dbError(err, "product") };
  }
  revalidateMasters();
  return { ok: true };
}

/* ── Customer Master ─────────────────────────────────────────────────────── */

/**
 * 0086 — Customer Code is system-generated on this screen: it draws from
 * `customer_masters_code_seq` (migration 0086) and is zero-padded to a
 * 3-digit "001, 002 …" format. One round trip regardless of `n` so a bulk
 * import doesn't pay N queries for N codes.
 *
 * Deliberately app-layer, not a DB default/trigger, so /master-setup/customers
 * (which still lets an admin type a code by hand) is completely unaffected —
 * see the migration comment.
 */
export async function nextCustomerCodes(n: number): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await db.execute<{ code: string }>(sql`
    select lpad(nextval('customer_masters_code_seq')::text, 3, '0') as code
    from generate_series(1, ${n})
  `);
  return (rows as unknown as { code: string }[]).map((r) => r.code);
}

export async function saveMasterCustomer(id: string | null, input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const parsed = MasterCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;
  const creditLimit = v.creditLimit === null ? null : String(v.creditLimit);

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      // Narrow write, same reasoning as saveMasterProduct: contact details,
      // GSTIN, volume class and notes belong to /master-setup's fuller form.
      // `code` is deliberately absent — it's system-generated and never
      // rewritten once assigned, for a new customer or an edit alike.
      await db
        .update(customerMasters)
        .set({
          name: v.name,
          customerCategory: v.customerCategory,
          creditLimit,
          creditPeriodDays: v.creditPeriodDays,
          focusedView: v.focusedView,
          purchasePattern: v.purchasePattern,
          sensitivity: v.sensitivity,
          salesRepId: v.salesRepId,
          isActive: v.isActive,
          updatedAt: new Date(),
        })
        .where(eq(customerMasters.id, id));
      return { ok: true, id };
    }
    const [code] = await nextCustomerCodes(1);
    const [row] = await db
      .insert(customerMasters)
      .values({ ...v, creditLimit, code, createdById: g.me.id })
      .returning({ id: customerMasters.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "customer code") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteMasterCustomer(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const g = await guard();
  if ("error" in g) return g.error;
  try {
    await db.delete(customerMasters).where(eq(customerMasters.id, id));
  } catch (err) {
    return { ok: false, error: dbError(err, "customer") };
  }
  revalidateMasters();
  return { ok: true };
}

/* ── Bulk upload ─────────────────────────────────────────────────────────── */

export interface BulkUploadResult {
  ok: true;
  imported: number;
  skippedMissing: number;
  skippedDuplicate: number;
  unmatchedReps: number;
}

const MAX_ROWS = 5000;
const CHUNK = 200;

/**
 * Import a mapped sheet of Products.
 *
 * (Customers used to share this function too; 0087 replaced the customers
 * path with `bulkUploadCustomerWorkbook` below, a proper 3-sheet workbook
 * import — this function is products-only now.)
 *
 * Rules, all deliberate:
 *  - only `name` is required; every classification a row omits imports blank,
 *    because the brief is that legacy Tally/Sheets rows must load rather than
 *    fail validation;
 *  - a row whose name or code already exists is SKIPPED, not updated. There is
 *    no unique index on either column, so an upsert would need a guess about
 *    which one identifies the row — and a bulk file silently rewriting live
 *    master data is a much worse outcome than a skipped row someone re-checks.
 */
export async function bulkUploadMasters(input: {
  target: BulkTarget;
  fileName?: string;
  rows: MappedRow[];
}): Promise<BulkUploadResult | { ok: false; error: string }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const target = input.target;
  if (target !== "products") {
    return { ok: false, error: "Unknown import target." };
  }
  const raw = Array.isArray(input.rows) ? input.rows.slice(0, MAX_ROWS) : [];
  if (raw.length === 0) return { ok: false, error: "That file has no rows to import." };

  const { usable, skipped: skippedMissing } = splitUsableRows(raw, target);
  if (usable.length === 0) {
    return { ok: false, error: "Every row is missing a Name. Check the column mapping." };
  }

  const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  let imported = 0;
  let skippedDuplicate = 0;
  const unmatchedReps = 0;

  try {
    const existing = await db
      .select({ name: products.name, code: products.code })
      .from(products);
    const names = new Set(existing.map((r) => key(r.name)));
    const codes = new Set(existing.map((r) => key(r.code)).filter(Boolean));

    const values: { name: string; code: string | null; specification: string | null; createdById: string }[] = [];
    for (const row of usable) {
      const name = row.name!.slice(0, 200);
      const code = row.code ? row.code.slice(0, 60) : null;
      if (names.has(key(name)) || (code && codes.has(key(code)))) {
        skippedDuplicate++;
        continue;
      }
      names.add(key(name));
      if (code) codes.add(key(code));
      values.push({
        name,
        code,
        specification: row.specification ? row.specification.slice(0, 2000) : null,
        createdById: g.me.id,
      });
    }
    for (let i = 0; i < values.length; i += CHUNK) {
      await db.insert(products).values(values.slice(i, i + CHUNK));
    }
    imported = values.length;

    await db.insert(importBatches).values({
      source: "csv",
      target,
      fileName: input.fileName?.slice(0, 200) ?? null,
      rowCount: raw.length,
      importedCount: imported,
      skippedCount: skippedMissing + skippedDuplicate,
      status: "applied",
      mapping: {},
      createdById: g.me.id,
    });
  } catch (err) {
    await db
      .insert(importBatches)
      .values({
        source: "csv",
        target,
        fileName: input.fileName?.slice(0, 200) ?? null,
        rowCount: raw.length,
        importedCount: imported,
        skippedCount: skippedMissing + skippedDuplicate,
        status: "failed",
        mapping: {},
        error: (err as Error).message?.slice(0, 500),
        createdById: g.me.id,
      })
      .catch(() => {});
    return { ok: false, error: `Import failed after ${imported} rows: ${(err as Error).message}` };
  }

  revalidateMasters();
  return { ok: true, imported, skippedMissing, skippedDuplicate, unmatchedReps };
}

/* ── Customer Master bulk upload (3-sheet workbook) ──────────────────────── */

export interface CustomerWorkbookResult {
  ok: true;
  customersCreated: number;
  customersUpdated: number;
  salesLinesImported: number;
  rowErrors: string[];
}

/**
 * Import the Basic Details / Account Details / Sales workbook (see
 * lib/masters/customer-workbook.ts for the sheet/column definitions).
 *
 * Every row across all three sheets is validated up front; a row with an
 * error is skipped (not the whole file) and reported in `rowErrors` —
 * matching the existing bulk-upload's skip-and-continue behaviour, just with
 * a message per skip instead of only an aggregate count.
 *
 * Customer Code is the only cross-sheet link (never Name). For a brand-new
 * customer: leave Code blank in Basic Details and the system generates one
 * (same `nextCustomerCodes` sequence the manual form and Products/legacy
 * customer bulk path used) — but then nothing else in the file can resolve
 * that customer, since no other sheet knows its code yet. To attach Account
 * Details/Sales rows to a new customer in the same file, the uploader must
 * type a Code themselves on that Basic Details row; it's validated unique
 * like any other insert (23505 → the existing friendly "already in use").
 */
export async function bulkUploadCustomerWorkbook(
  formData: FormData,
): Promise<CustomerWorkbookResult | { ok: false; error: string }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  let parsed: Awaited<ReturnType<typeof parseCustomerWorkbook>>;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = await parseCustomerWorkbook(buffer);
  } catch (err) {
    return { ok: false, error: `Could not read that workbook: ${(err as Error).message}` };
  }
  if (parsed.missingSheets.length > 0) {
    return {
      ok: false,
      error: `Missing sheet(s): ${parsed.missingSheets.join(", ")}. Use the downloaded template — don't rename or delete sheets.`,
    };
  }
  if (parsed.basic.length === 0 && parsed.account.length === 0 && parsed.sales.length === 0) {
    return { ok: false, error: "That workbook has no rows to import." };
  }

  const categoryOptions = await listLookupOptions(CUSTOMER_CATEGORY_LIST_KEY);
  const rowErrors: string[] = [];

  const basicRows = parsed.basic.map(({ row, rowNumber }) => ({
    row,
    rowNum: rowNumber,
    errors: validateBasicRow(row, rowNumber, categoryOptions),
  }));
  const accountRows = parsed.account.map(({ row, rowNumber }) => ({
    row,
    rowNum: rowNumber,
    errors: validateAccountRow(row, rowNumber),
  }));
  const salesRows = parsed.sales.map(({ row, rowNumber }) => ({
    row,
    rowNum: rowNumber,
    errors: validateSalesRow(row, rowNumber),
  }));
  for (const r of [...basicRows, ...accountRows, ...salesRows]) rowErrors.push(...r.errors);

  // Every code already in the DB, seeded up front; augmented in-place as
  // Basic Details creates new customers, so Account Details/Sales rows later
  // in the SAME file can resolve a customer that didn't exist a moment ago.
  const existingCodes = await db
    .select({ id: customerMasters.id, code: customerMasters.code })
    .from(customerMasters);
  const codeToId = new Map<string, string>();
  for (const r of existingCodes) if (r.code) codeToId.set(r.code.trim().toLowerCase(), r.id);

  let customersCreated = 0;
  let customersUpdated = 0;
  let salesLinesImported = 0;

  // Normalisers below all resolve to exactly the DB-write type (string /
  // number / boolean, or undefined for "leave this field alone") — numeric
  // columns need a string per drizzle's convention for `numeric(...)`, same
  // as saveMasterCustomer above; "invalid" (already reported as a row error)
  // and blank both become undefined so a bad or empty cell never overwrites
  // an existing value.
  const str = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  const moneyStr = (v: number | null | "invalid"): string | undefined =>
    typeof v === "number" ? String(v) : undefined;
  const num = (v: number | null | "invalid"): number | undefined =>
    typeof v === "number" ? v : undefined;
  const bool = (v: boolean | null | "invalid"): boolean | undefined =>
    typeof v === "boolean" ? v : undefined;

  const basicFields = (row: SheetRow) => ({
    name: str(row.customerName),
    customerCategory: str(row.customerCategory),
    notes: str(row.customerParticulars),
    focusedView: bool(parseYesNoStrict(row.focusedView)),
    billingAddress: str(row.billingAddress),
    deliveryAddress: str(row.deliveryAddress),
    invoiceMailingAddress: str(row.invoiceMailingAddress),
    purchaseDeptContact: str(row.purchaseDeptContact),
    accountsDeptContact: str(row.accountsDeptContact),
    otherContact: str(row.otherContact),
    referenceBy: str(row.referenceBy),
    contactPerson: str(row.contactName),
    phone: str(row.phoneNo),
    email: str(row.email),
    gstin: str(row.gstNo),
    tinNumber: str(row.tinNumber),
    panNo: str(row.panNo),
    iecNumber: str(row.iecNumber),
    website: str(row.website),
    paymentTerms: str(row.paymentTerms),
    salesCoordinator: str(row.salesCoordinator),
    tcsApplicable: bool(parseYesNoStrict(row.tcsApplicable)),
    creditLimit: moneyStr(parseNonNegative(row.creditLimit)),
    creditPeriodDays: num(parseNonNegative(row.creditPeriod)),
  });

  const accountFields = (row: SheetRow) => ({
    accountsContactName: str(row.accountsContactName),
    accountsContactPhone: str(row.accountsContactPhone),
    accountsContactEmail: str(row.accountsContactEmail),
    gstin: str(row.gstNo),
    panNo: str(row.panNo),
    tinNumber: str(row.tinNumber),
    iecNumber: str(row.iecNumber),
    paymentTerms: str(row.paymentTerms),
    creditLimit: moneyStr(parseNonNegative(row.creditLimit)),
    creditPeriodDays: num(parseNonNegative(row.creditPeriod)),
    tcsApplicable: bool(parseYesNoStrict(row.tcsApplicable)),
    salesCoordinator: str(row.salesCoordinator),
    website: str(row.website),
  });

  /** Only non-blank keys go into the write — never clobber an existing value with a blank cell. */
  function nonBlank<T extends Record<string, unknown>>(fields: T): Partial<T> {
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }

  try {
    // ── Step 1 — Basic Details: create/update the customer ──
    for (const { row, rowNum, errors } of basicRows) {
      if (errors.length > 0) continue; // already reported above
      const codeRaw = row.customerCode?.trim();
      const codeKey = codeRaw?.toLowerCase();
      const fields = nonBlank(basicFields(row));

      if (codeKey && codeToId.has(codeKey)) {
        await db.update(customerMasters).set({ ...fields, updatedAt: new Date() }).where(eq(customerMasters.id, codeToId.get(codeKey)!));
        customersUpdated++;
        continue;
      }

      try {
        if (codeRaw) {
          const [inserted] = await db
            .insert(customerMasters)
            .values({ ...fields, name: fields.name!, code: codeRaw, createdById: g.me.id })
            .returning({ id: customerMasters.id });
          codeToId.set(codeKey!, inserted!.id);
        } else {
          const [autoCode] = await nextCustomerCodes(1);
          const [inserted] = await db
            .insert(customerMasters)
            .values({ ...fields, name: fields.name!, code: autoCode, createdById: g.me.id })
            .returning({ id: customerMasters.id });
          codeToId.set(autoCode!.toLowerCase(), inserted!.id);
        }
        customersCreated++;
      } catch (err) {
        rowErrors.push(`${SHEET_NAMES.basic} — Row ${rowNum} — ${dbError(err, "customer code")}`);
      }
    }

    // ── Step 2 — Account Details: attach to the same customer via Code ──
    for (const { row, rowNum, errors } of accountRows) {
      if (errors.length > 0) continue;
      const codeKey = row.customerCode!.trim().toLowerCase();
      const customerId = codeToId.get(codeKey);
      if (!customerId) {
        rowErrors.push(`${SHEET_NAMES.account} — Row ${rowNum} — Customer Code ${row.customerCode} does not exist.`);
        continue;
      }
      const fields = nonBlank(accountFields(row));
      if (Object.keys(fields).length > 0) {
        await db.update(customerMasters).set({ ...fields, updatedAt: new Date() }).where(eq(customerMasters.id, customerId));
      }
    }

    // ── Step 3 — Sales: one or more lines per customer ──
    const salesValues: (typeof customerSalesLines.$inferInsert)[] = [];
    for (const { row, rowNum, errors } of salesRows) {
      if (errors.length > 0) continue;
      const codeKey = row.customerCode!.trim().toLowerCase();
      const customerId = codeToId.get(codeKey);
      if (!customerId) {
        rowErrors.push(`${SHEET_NAMES.sales} — Row ${rowNum} — Customer Code ${row.customerCode} does not exist.`);
        continue;
      }
      const amounts = computeSalesLineAmounts(row);
      const poDate = parseDateLoose(row.customerPoEmailDate);
      salesValues.push({
        customerMasterId: customerId,
        customerPoNo: row.customerPoNo?.trim() || null,
        customerPoEmailDate: poDate === "invalid" ? null : poDate,
        materialDescription: row.materialDescription?.trim() || null,
        qty: amounts.qty === null ? null : String(amounts.qty),
        rate: amounts.rate === null ? null : String(amounts.rate),
        total: amounts.total === null ? null : String(amounts.total),
        gstPercent: amounts.gstPercent === null ? null : String(amounts.gstPercent),
        gstAmount: amounts.gstAmount === null ? null : String(amounts.gstAmount),
        lineTotal: amounts.lineTotal === null ? null : String(amounts.lineTotal),
        freightCharges: amounts.freightCharges === null ? null : String(amounts.freightCharges),
        installationCharges: amounts.installationCharges === null ? null : String(amounts.installationCharges),
        salesTotal: amounts.salesTotal === null ? null : String(amounts.salesTotal),
        tcRequired: bool(parseYesNoStrict(row.tcRequired)) ?? false,
        specialInstruction: row.specialInstruction?.trim() || null,
        remarks: row.remarks?.trim() || null,
        filledBy: row.filledBy?.trim() || null,
        filledByName: row.filledByName?.trim() || null,
        filledBySign: row.filledBySign?.trim() || null,
        instructedBy: row.instructedBy?.trim() || null,
        enteredVerifiedBy: row.enteredVerifiedBy?.trim() || null,
        createdById: g.me.id,
      });
    }
    for (let i = 0; i < salesValues.length; i += CHUNK) {
      await db.insert(customerSalesLines).values(salesValues.slice(i, i + CHUNK));
    }
    salesLinesImported = salesValues.length;

    await db.insert(importBatches).values({
      source: "csv",
      target: "customers",
      fileName: (file as File).name?.slice(0, 200) ?? null,
      rowCount: parsed.basic.length + parsed.account.length + parsed.sales.length,
      importedCount: customersCreated + customersUpdated + salesLinesImported,
      skippedCount: rowErrors.length,
      status: "applied",
      mapping: {},
      createdById: g.me.id,
    });
  } catch (err) {
    return { ok: false, error: `Import failed: ${(err as Error).message}` };
  }

  revalidateMasters();
  return { ok: true, customersCreated, customersUpdated, salesLinesImported, rowErrors };
}
