"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMasters,
  fieldPermissionGrants,
  importBatches,
  incentiveSlabs,
  lookupItems,
  productCategories,
  productSkus,
  products,
  tallyGroupMappings,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import {
  CategorySchema,
  CustomerSchema,
  IncentiveSlabSchema,
  LookupItemSchema,
  ProductSchema,
  SkuSchema,
  TallyMappingSchema,
} from "@/lib/validators/master-data";
import type { ImportSource, ImportTarget } from "@/db/enums";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const PATHS = [
  "/master-setup",
  "/master-setup/products",
  "/master-setup/customers",
  "/master-setup/libraries",
  "/master-setup/access-control",
  "/master-setup/data-import",
];
function revalidateMasters(): void {
  for (const p of PATHS) revalidatePath(p);
}

/**
 * Every write below is admin-only. `requireAdmin` throws "Forbidden" (rendered
 * by the admin error boundary) for a direct page hit; these actions return a
 * Result instead so a form can show the message inline.
 */
async function guard() {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  return { me, limited };
}

/** Turn a Zod failure into the first human-readable message. */
function zodError(err: unknown): string {
  const issues = (err as { issues?: { message: string }[] })?.issues;
  return issues?.[0]?.message ?? "Please check the values and try again.";
}

/** Postgres unique-violation → a message naming the field, not the index. */
function dbError(err: unknown, label: string): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "23505") return `That ${label} is already in use.`;
  return `Could not save: ${e?.message ?? String(err)}`;
}

/* ── Categories ──────────────────────────────────────────────────────────── */

export async function saveCategory(id: string | null, input: unknown): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const parsed = CategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  // A category cannot be its own parent. Deeper cycles are still possible in
  // principle; the tree builder caps depth so they degrade rather than hang.
  if (id && v.parentId === id) {
    return { ok: false, error: "A category can't be its own parent." };
  }

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(productCategories)
        .set({ ...v, updatedAt: new Date() })
        .where(eq(productCategories.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(productCategories)
      .values({ ...v, createdById: me.id })
      .returning({ id: productCategories.id });
    revalidateMasters();
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "category code") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteCategory(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  // Children and products both fall back to NULL rather than cascading — a
  // mis-click must not take a product catalogue with it.
  await db.delete(productCategories).where(eq(productCategories.id, id));
  revalidateMasters();
  return { ok: true };
}

/* ── Products ────────────────────────────────────────────────────────────── */

export async function saveProduct(id: string | null, input: unknown): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const parsed = ProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;
  const values = { ...v, hp: v.hp === null ? null : String(v.hp) };

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(products)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(products.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(products)
      .values({ ...values, createdById: me.id })
      .returning({ id: products.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "product code") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteProduct(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  await db.delete(products).where(eq(products.id, id));
  revalidateMasters();
  return { ok: true };
}

/* ── SKUs ────────────────────────────────────────────────────────────────── */

export async function saveSku(id: string | null, input: unknown): Promise<Result> {
  const { limited } = await guard();
  if (limited) return limited;

  const parsed = SkuSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;
  const values = { ...v, listRate: v.listRate === null ? null : String(v.listRate) };

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(productSkus)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(productSkus.id, id));
      return { ok: true, id };
    }
    const [row] = await db.insert(productSkus).values(values).returning({ id: productSkus.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "SKU code") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteSku(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  await db.delete(productSkus).where(eq(productSkus.id, id));
  revalidateMasters();
  return { ok: true };
}

/* ── Customers ───────────────────────────────────────────────────────────── */

export async function saveCustomer(id: string | null, input: unknown): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const parsed = CustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(customerMasters)
        .set({ ...v, updatedAt: new Date() })
        .where(eq(customerMasters.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(customerMasters)
      .values({ ...v, createdById: me.id })
      .returning({ id: customerMasters.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "customer code") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteCustomer(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  await db.delete(customerMasters).where(eq(customerMasters.id, id));
  revalidateMasters();
  return { ok: true };
}

/* ── Libraries ───────────────────────────────────────────────────────────── */

export async function saveLookupItem(id: string | null, input: unknown): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const parsed = LookupItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(lookupItems)
        .set({ label: v.label, sortOrder: v.sortOrder, isActive: v.isActive, updatedAt: new Date() })
        .where(eq(lookupItems.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(lookupItems)
      .values({ ...v, createdById: me.id })
      .returning({ id: lookupItems.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "option") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteLookupItem(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  await db.delete(lookupItems).where(eq(lookupItems.id, id));
  revalidateMasters();
  return { ok: true };
}

export async function saveIncentiveSlab(id: string | null, input: unknown): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const parsed = IncentiveSlabSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;
  const values = { ...v, payoutPct: String(v.payoutPct) };

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(incentiveSlabs)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(incentiveSlabs.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(incentiveSlabs)
      .values({ ...values, createdById: me.id })
      .returning({ id: incentiveSlabs.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "slab") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteIncentiveSlab(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  await db.delete(incentiveSlabs).where(eq(incentiveSlabs.id, id));
  revalidateMasters();
  return { ok: true };
}

/* ── Field permissions ───────────────────────────────────────────────────── */

/**
 * Set one cell of the matrix. `allowed = null` clears the row, which is how a
 * cell returns to "inherit" — absence of a row IS the inherit state, so there
 * is no third value to store.
 */
export async function setFieldPermission(
  fieldKey: string,
  subjectType: "everyone" | "department" | "employee",
  subjectId: string | null,
  allowed: boolean | null,
): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  if (typeof fieldKey !== "string" || fieldKey.length === 0 || fieldKey.length > 80) {
    return { ok: false, error: "Invalid field." };
  }
  if (subjectType !== "everyone" && !isUuid(subjectId)) {
    return { ok: false, error: "Invalid subject." };
  }

  const where =
    subjectType === "everyone"
      ? and(
          eq(fieldPermissionGrants.fieldKey, fieldKey),
          eq(fieldPermissionGrants.subjectType, "everyone"),
          isNull(fieldPermissionGrants.subjectId),
        )
      : and(
          eq(fieldPermissionGrants.fieldKey, fieldKey),
          eq(fieldPermissionGrants.subjectType, subjectType),
          eq(fieldPermissionGrants.subjectId, subjectId!),
        );

  try {
    await db.delete(fieldPermissionGrants).where(where);
    if (allowed !== null) {
      await db.insert(fieldPermissionGrants).values({
        fieldKey,
        subjectType,
        subjectId: subjectType === "everyone" ? null : subjectId,
        allowed,
        updatedBy: me.id,
      });
    }
  } catch (err) {
    return { ok: false, error: dbError(err, "permission") };
  }
  revalidateMasters();
  return { ok: true };
}

/** Drop every override for one person or department — back to inherited. */
export async function clearFieldSubject(
  subjectType: "department" | "employee",
  subjectId: string,
): Promise<Result> {
  if (!isUuid(subjectId)) return { ok: false, error: "Invalid subject." };
  const { limited } = await guard();
  if (limited) return limited;
  await db
    .delete(fieldPermissionGrants)
    .where(
      and(
        eq(fieldPermissionGrants.subjectType, subjectType),
        eq(fieldPermissionGrants.subjectId, subjectId),
      ),
    );
  revalidateMasters();
  return { ok: true };
}

/* ── Tally mapping ───────────────────────────────────────────────────────── */

export async function saveTallyMapping(id: string | null, input: unknown): Promise<Result> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const parsed = TallyMappingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      await db
        .update(tallyGroupMappings)
        .set({ ...v, updatedAt: new Date() })
        .where(eq(tallyGroupMappings.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(tallyGroupMappings)
      .values({ ...v, createdById: me.id })
      .returning({ id: tallyGroupMappings.id });
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "Tally group") };
  } finally {
    revalidateMasters();
  }
}

export async function deleteTallyMapping(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { limited } = await guard();
  if (limited) return limited;
  await db.delete(tallyGroupMappings).where(eq(tallyGroupMappings.id, id));
  revalidateMasters();
  return { ok: true };
}

/* ── Data ingestion ──────────────────────────────────────────────────────── */

export interface ImportRunInput {
  source: ImportSource;
  target: ImportTarget;
  fileName: string | null;
  /** Header → field name, as confirmed in the mapper. */
  mapping: Record<string, string>;
  rows: Record<string, string>[];
}

/**
 * Apply a mapped import.
 *
 * The null-handling rule from the brief is the point: a row missing a
 * sub-classification imports with that column blank rather than failing. Only
 * the identifying field (name) is required; everything else is best-effort, and
 * rows without a name are counted as skipped rather than aborting the batch.
 */
export async function runImport(input: ImportRunInput): Promise<
  { ok: true; imported: number; skipped: number } | { ok: false; error: string }
> {
  const { me, limited } = await guard();
  if (limited) return limited;

  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 5000) : [];
  if (rows.length === 0) return { ok: false, error: "Nothing to import." };

  const pick = (row: Record<string, string>, field: string): string | null => {
    const header = Object.entries(input.mapping).find(([, f]) => f === field)?.[0];
    if (!header) return null;
    const raw = row[header];
    const v = typeof raw === "string" ? raw.trim() : "";
    return v.length > 0 ? v : null;
  };

  let imported = 0;
  let skipped = 0;

  try {
    for (const row of rows) {
      const name = pick(row, "name");
      if (!name) {
        skipped++;
        continue;
      }
      if (input.target === "customers") {
        await db
          .insert(customerMasters)
          .values({
            name,
            code: pick(row, "code"),
            customerCategory: pick(row, "customerCategory"),
            contactPerson: pick(row, "contactPerson"),
            phone: pick(row, "phone"),
            email: pick(row, "email"),
            city: pick(row, "city"),
            state: pick(row, "state"),
            gstin: pick(row, "gstin"),
            tallyGroup: pick(row, "tallyGroup"),
            createdById: me.id,
          })
          .onConflictDoNothing();
      } else if (input.target === "categories") {
        await db
          .insert(productCategories)
          .values({ name, code: pick(row, "code"), createdById: me.id })
          .onConflictDoNothing();
      } else if (input.target === "products") {
        await db
          .insert(products)
          .values({
            name,
            code: pick(row, "code"),
            brand: pick(row, "brand"),
            powerRating: pick(row, "powerRating"),
            kvh: pick(row, "kvh"),
            tallyName: pick(row, "tallyName"),
            createdById: me.id,
          })
          .onConflictDoNothing();
      } else {
        // SKUs need a parent product, which a flat sheet rarely carries — so
        // this target is recorded but not auto-inserted. Surfaced honestly
        // rather than silently importing nothing.
        skipped++;
        continue;
      }
      imported++;
    }

    await db.insert(importBatches).values({
      source: input.source,
      target: input.target,
      fileName: input.fileName,
      rowCount: rows.length,
      importedCount: imported,
      skippedCount: skipped,
      status: "applied",
      mapping: input.mapping,
      createdById: me.id,
    });
  } catch (err) {
    await db
      .insert(importBatches)
      .values({
        source: input.source,
        target: input.target,
        fileName: input.fileName,
        rowCount: rows.length,
        importedCount: imported,
        skippedCount: skipped,
        status: "failed",
        mapping: input.mapping,
        error: (err as Error).message?.slice(0, 500),
        createdById: me.id,
      })
      .catch(() => {});
    return { ok: false, error: `Import failed after ${imported} rows: ${(err as Error).message}` };
  }

  revalidateMasters();
  return { ok: true, imported, skipped };
}
