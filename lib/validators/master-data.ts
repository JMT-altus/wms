import { z } from "zod";
import {
  CUSTOMER_SENSITIVITIES,
  FLANGE_TYPES,
  PURCHASE_PATTERNS,
  VOLUME_CLASSES,
  TALLY_MAPS_TO,
} from "@/db/enums";

/**
 * Schemas for Phase 1 master data.
 *
 * The recurring pattern here is `emptyToNull`: an untouched form field arrives
 * as "", and storing "" would make `code IS NULL` checks and the unique
 * partial indexes behave differently from a genuinely blank value. Every
 * optional text field normalises "" → null so blank means blank everywhere.
 */
const emptyToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const uuidOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional()
  .refine(
    (v) => v == null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "Not a valid selection",
  )
  .transform((v) => v ?? null);

/* ── Products ────────────────────────────────────────────────────────────── */

export const CategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  code: emptyToNull(40),
  parentId: uuidOrNull,
  description: emptyToNull(1000),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof CategorySchema>;

export const ProductSchema = z.object({
  categoryId: uuidOrNull,
  name: z.string().trim().min(1, "Name is required").max(200),
  code: emptyToNull(60),
  brand: emptyToNull(120),
  description: emptyToNull(2000),
  specification: emptyToNull(2000),
  // Blank stays blank — a motor with no recorded HP is not a 0 HP motor.
  hp: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || `${v}`.trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  powerRating: emptyToNull(80),
  flangeType: z
    .enum(FLANGE_TYPES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  kvh: emptyToNull(80),
  tallyName: emptyToNull(200),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.input<typeof ProductSchema>;

export const SkuSchema = z.object({
  productId: z.string().uuid("Pick a product"),
  skuCode: z.string().trim().min(1, "SKU code is required").max(80),
  variantLabel: emptyToNull(160),
  uom: z.string().trim().min(1).max(20).default("Nos"),
  listRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || `${v}`.trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }),
  tallyItemName: emptyToNull(200),
  isActive: z.boolean().default(true),
});
export type SkuInput = z.input<typeof SkuSchema>;

/* ── Customers ───────────────────────────────────────────────────────────── */

export const CustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: emptyToNull(60),
  // Mandatory here even though the column is nullable: the form can explain
  // why, a NOT NULL constraint can only fail.
  salesRepId: z.string().uuid("Assign a salesperson"),
  // Free text validated against the lookup list at the UI, not here — a hard
  // enum would reject any category an admin adds later.
  customerCategory: emptyToNull(120),
  volumeClass: z
    .enum(VOLUME_CLASSES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  purchasePattern: z
    .enum(PURCHASE_PATTERNS)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  sensitivity: z
    .enum(CUSTOMER_SENSITIVITIES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  contactPerson: emptyToNull(160),
  phone: emptyToNull(40),
  email: emptyToNull(200),
  city: emptyToNull(120),
  state: emptyToNull(120),
  gstin: emptyToNull(20),
  tallyGroup: emptyToNull(160),
  notes: emptyToNull(2000),
  isActive: z.boolean().default(true),
});
export type CustomerInput = z.input<typeof CustomerSchema>;

/* ── Masters module (/masters) ───────────────────────────────────────────── */

/**
 * The Masters screens edit a SUBSET of the same rows /master-setup edits, so
 * they get their own narrow schemas and their save actions write only these
 * columns.
 *
 * Reusing ProductSchema/CustomerSchema here would look tidier and be wrong: a
 * form that never renders `brand` still submits it as undefined, the schema
 * normalises that to null, and saving a product from /masters would silently
 * blank the brand somebody set in /master-setup. Narrow schema, narrow write.
 */
export const MasterProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: emptyToNull(60),
  specification: emptyToNull(2000),
  isActive: z.boolean().default(true),
});
export type MasterProductInput = z.input<typeof MasterProductSchema>;

export const MasterCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: emptyToNull(60),
  // Free text against the editable `customer_category` list, not an enum —
  // see migration 0082 for why.
  customerCategory: emptyToNull(120),
  purchasePattern: z
    .enum(PURCHASE_PATTERNS)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  sensitivity: z
    .enum(CUSTOMER_SENSITIVITIES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  // Required by the form, nullable in the column: allocation is the point of
  // the screen, but a legacy row imported without a rep must still exist.
  salesRepId: z.string().uuid("Assign a salesperson"),
  isActive: z.boolean().default(true),
});
export type MasterCustomerInput = z.input<typeof MasterCustomerSchema>;

/* ── Libraries ───────────────────────────────────────────────────────────── */

export const LookupItemSchema = z.object({
  listKey: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1, "Label is required").max(200),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
});
export type LookupItemInput = z.input<typeof LookupItemSchema>;

export const IncentiveSlabSchema = z
  .object({
    label: emptyToNull(120),
    overdueFromDays: z.coerce.number().int().min(0).max(3650),
    // Blank = open-ended top slab ("60+ days"), which is why this is nullable
    // rather than defaulting to a big number.
    overdueToDays: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null || `${v}`.trim() === "") return null;
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? n : null;
      }),
    graceDays: z.coerce.number().int().min(0).max(365).default(0),
    payoutPct: z.coerce.number().min(0).max(100),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
    isActive: z.boolean().default(true),
  })
  .refine(
    (v) => v.overdueToDays === null || v.overdueToDays >= v.overdueFromDays,
    { message: "'To' days must be greater than or equal to 'From' days", path: ["overdueToDays"] },
  );
export type IncentiveSlabInput = z.input<typeof IncentiveSlabSchema>;

/* ── Tally mapping ───────────────────────────────────────────────────────── */

export const TallyMappingSchema = z.object({
  tallyGroup: z.string().trim().min(1, "Tally group is required").max(160),
  mapsTo: z.enum(TALLY_MAPS_TO),
  targetCategoryId: uuidOrNull,
  note: emptyToNull(500),
  isActive: z.boolean().default(true),
});
export type TallyMappingInput = z.input<typeof TallyMappingSchema>;
