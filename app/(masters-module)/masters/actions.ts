"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, employees, importBatches, products } from "@/db/schema";
import type { Employee } from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { rateLimitOrError } from "@/lib/rate-limit";
import {
  MasterCustomerSchema,
  MasterProductSchema,
} from "@/lib/validators/master-data";
import {
  matchSalesRep,
  normalisePurchasePattern,
  normaliseSensitivity,
  splitUsableRows,
  type BulkTarget,
  type MappedRow,
} from "@/lib/masters/bulk-parse";

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
  const e = err as { code?: string; message?: string };
  if (e?.code === "23505") return `That ${label} is already in use.`;
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

export async function saveMasterCustomer(id: string | null, input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const parsed = MasterCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid id." };
      // Narrow write, same reasoning as saveMasterProduct: contact details,
      // GSTIN, volume class and notes belong to /master-setup's fuller form.
      await db
        .update(customerMasters)
        .set({
          name: v.name,
          code: v.code,
          customerCategory: v.customerCategory,
          purchasePattern: v.purchasePattern,
          sensitivity: v.sensitivity,
          salesRepId: v.salesRepId,
          isActive: v.isActive,
          updatedAt: new Date(),
        })
        .where(eq(customerMasters.id, id));
      return { ok: true, id };
    }
    const [row] = await db
      .insert(customerMasters)
      .values({ ...v, createdById: g.me.id })
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
 * Import a mapped sheet into one master.
 *
 * Rules, all deliberate:
 *  - only `name` is required; every classification a row omits imports blank,
 *    because the brief is that legacy Tally/Sheets rows must load rather than
 *    fail validation;
 *  - a row whose name or code already exists is SKIPPED, not updated. There is
 *    no unique index on either column, so an upsert would need a guess about
 *    which one identifies the row — and a bulk file silently rewriting live
 *    master data is a much worse outcome than a skipped row someone re-checks;
 *  - an unrecognised salesperson leaves the allocation blank and is counted, so
 *    the result says so instead of quietly picking the wrong rep.
 */
export async function bulkUploadMasters(input: {
  target: BulkTarget;
  fileName?: string;
  rows: MappedRow[];
}): Promise<BulkUploadResult | { ok: false; error: string }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const target = input.target;
  if (target !== "products" && target !== "customers") {
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
  let unmatchedReps = 0;

  try {
    if (target === "products") {
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
    } else {
      const [existing, roster] = await Promise.all([
        db.select({ name: customerMasters.name, code: customerMasters.code }).from(customerMasters),
        db
          .select({ id: employees.id, name: employees.name, email: employees.email })
          .from(employees)
          .where(eq(employees.isActive, true))
          .orderBy(asc(employees.name)),
      ]);
      const names = new Set(existing.map((r) => key(r.name)));
      const codes = new Set(existing.map((r) => key(r.code)).filter(Boolean));

      const values: {
        name: string;
        code: string | null;
        customerCategory: string | null;
        purchasePattern: ReturnType<typeof normalisePurchasePattern>;
        sensitivity: ReturnType<typeof normaliseSensitivity>;
        salesRepId: string | null;
        createdById: string;
      }[] = [];
      for (const row of usable) {
        const name = row.name!.slice(0, 200);
        const code = row.code ? row.code.slice(0, 60) : null;
        if (names.has(key(name)) || (code && codes.has(key(code)))) {
          skippedDuplicate++;
          continue;
        }
        names.add(key(name));
        if (code) codes.add(key(code));
        const salesRepId = matchSalesRep(row.salesRep, roster);
        if (row.salesRep && !salesRepId) unmatchedReps++;
        values.push({
          name,
          code,
          customerCategory: row.customerCategory ? row.customerCategory.slice(0, 120) : null,
          purchasePattern: normalisePurchasePattern(row.purchasePattern),
          sensitivity: normaliseSensitivity(row.sensitivity),
          salesRepId,
          createdById: g.me.id,
        });
      }
      for (let i = 0; i < values.length; i += CHUNK) {
        await db.insert(customerMasters).values(values.slice(i, i + CHUNK));
      }
      imported = values.length;
    }

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
