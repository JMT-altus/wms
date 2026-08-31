import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  customerMasters,
  employees,
  fieldPermissionGrants,
  importBatches,
  incentiveSlabs,
  lookupItems,
  productCategories,
  productSkus,
  products,
  tallyGroupMappings,
} from "@/db/schema";
import type {
  CustomerSensitivity,
  FlangeType,
  PurchasePattern,
  TallyMapsTo,
  VolumeClass,
} from "@/db/enums";

/* ── Products ────────────────────────────────────────────────────────────── */

export interface CategoryRow {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  parentName: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export async function listCategories(): Promise<CategoryRow[]> {
  const parent = alias(productCategories, "parent_cat");
  const rows = await db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      code: productCategories.code,
      parentId: productCategories.parentId,
      parentName: parent.name,
      description: productCategories.description,
      sortOrder: productCategories.sortOrder,
      isActive: productCategories.isActive,
      productCount: sql<number>`(
        select count(*)::int from products p where p.category_id = ${productCategories.id}
      )`,
    })
    .from(productCategories)
    .leftJoin(parent, eq(parent.id, productCategories.parentId))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
  return rows.map((r) => ({ ...r, parentName: r.parentName ?? null }));
}

/** Categories as a depth-annotated tree, flattened for a picker/tree view. */
export interface CategoryTreeNode extends CategoryRow {
  depth: number;
}

export function buildCategoryTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const r of rows) {
    const key = r.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(r);
    byParent.set(key, list);
  }
  const out: CategoryTreeNode[] = [];
  // Depth is capped so a cycle introduced by a bad parent edit renders as a
  // truncated branch instead of hanging the request in an infinite walk.
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 10) return;
    for (const node of byParent.get(parentId) ?? []) {
      out.push({ ...node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface ProductRow {
  id: string;
  name: string;
  code: string | null;
  /** 0083 — the technical spec string the /masters screen owns. */
  specification: string | null;
  brand: string | null;
  categoryId: string | null;
  categoryName: string | null;
  hp: string | null;
  powerRating: string | null;
  flangeType: FlangeType | null;
  kvh: string | null;
  tallyName: string | null;
  isActive: boolean;
  skuCount: number;
  /** Serialised for the client — the Masters table sorts newest-first on it. */
  createdAt: string;
}

export async function listProducts(): Promise<ProductRow[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      code: products.code,
      specification: products.specification,
      brand: products.brand,
      categoryId: products.categoryId,
      categoryName: productCategories.name,
      hp: products.hp,
      powerRating: products.powerRating,
      flangeType: products.flangeType,
      kvh: products.kvh,
      tallyName: products.tallyName,
      isActive: products.isActive,
      createdAt: products.createdAt,
      skuCount: sql<number>`(
        select count(*)::int from product_skus s where s.product_id = ${products.id}
      )`,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .orderBy(asc(products.name));
  return rows.map((r) => ({
    ...r,
    categoryName: r.categoryName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface SkuRow {
  id: string;
  skuCode: string;
  variantLabel: string | null;
  uom: string;
  listRate: string | null;
  tallyItemName: string | null;
  isActive: boolean;
  productId: string;
  productName: string | null;
  categoryName: string | null;
}

export async function listSkus(): Promise<SkuRow[]> {
  const rows = await db
    .select({
      id: productSkus.id,
      skuCode: productSkus.skuCode,
      variantLabel: productSkus.variantLabel,
      uom: productSkus.uom,
      listRate: productSkus.listRate,
      tallyItemName: productSkus.tallyItemName,
      isActive: productSkus.isActive,
      productId: productSkus.productId,
      productName: products.name,
      categoryName: productCategories.name,
    })
    .from(productSkus)
    .leftJoin(products, eq(products.id, productSkus.productId))
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .orderBy(asc(productSkus.skuCode));
  return rows.map((r) => ({
    ...r,
    productName: r.productName ?? null,
    categoryName: r.categoryName ?? null,
  }));
}

/* ── Customers ───────────────────────────────────────────────────────────── */

export interface CustomerRow {
  id: string;
  name: string;
  code: string | null;
  salesRepId: string | null;
  salesRepName: string | null;
  customerCategory: string | null;
  volumeClass: VolumeClass | null;
  purchasePattern: PurchasePattern | null;
  sensitivity: CustomerSensitivity | null;
  /** 0086 — numeric columns come back as strings from postgres-js. */
  creditLimit: string | null;
  creditPeriodDays: number | null;
  focusedView: boolean;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  tallyGroup: string | null;
  isActive: boolean;
  mappedSkuCount: number;
  /** Serialised for the client — the Masters table sorts newest-first on it. */
  createdAt: string;
  /* Written by Create New Client KYC into this same row — see listCustomers. */
  customerTypes: string[];
  industryTypes: string[];
  tags: string[];
  panNo: string | null;
  gstRegistrationType: string | null;
  msmeUdyamNo: string | null;
  tinNumber: string | null;
  website: string | null;
  testCertificateNeeded: boolean;
  tcsApplicable: boolean;
  paymentTerms: string | null;
  freightCharges: string | null;
  transporter: string | null;
  quantityDeviation: string | null;
  exportClient: string | null;
  iecNumber: string | null;
  currency: string | null;
  country: string | null;
  reference: string | null;
  otherReferences: string | null;
  notes: string | null;
}

export async function listCustomers(): Promise<CustomerRow[]> {
  const rows = await db
    .select({
      id: customerMasters.id,
      name: customerMasters.name,
      code: customerMasters.code,
      salesRepId: customerMasters.salesRepId,
      salesRepName: employees.name,
      customerCategory: customerMasters.customerCategory,
      volumeClass: customerMasters.volumeClass,
      purchasePattern: customerMasters.purchasePattern,
      sensitivity: customerMasters.sensitivity,
      creditLimit: customerMasters.creditLimit,
      creditPeriodDays: customerMasters.creditPeriodDays,
      focusedView: customerMasters.focusedView,
      contactPerson: customerMasters.contactPerson,
      phone: customerMasters.phone,
      email: customerMasters.email,
      city: customerMasters.city,
      state: customerMasters.state,
      gstin: customerMasters.gstin,
      tallyGroup: customerMasters.tallyGroup,
      isActive: customerMasters.isActive,
      createdAt: customerMasters.createdAt,
      // Everything Create New Client KYC writes to this same row. The two
      // screens are two views of `customer_masters`, so a field the KYC form
      // fills in and this one cannot show is a field that looks lost.
      customerTypes: customerMasters.customerTypes,
      industryTypes: customerMasters.industryTypes,
      tags: customerMasters.tags,
      panNo: customerMasters.panNo,
      gstRegistrationType: customerMasters.gstRegistrationType,
      msmeUdyamNo: customerMasters.msmeUdyamNo,
      tinNumber: customerMasters.tinNumber,
      website: customerMasters.website,
      testCertificateNeeded: customerMasters.testCertificateNeeded,
      tcsApplicable: customerMasters.tcsApplicable,
      paymentTerms: customerMasters.paymentTerms,
      freightCharges: customerMasters.freightCharges,
      transporter: customerMasters.transporter,
      quantityDeviation: customerMasters.quantityDeviation,
      exportClient: customerMasters.exportClient,
      iecNumber: customerMasters.iecNumber,
      currency: customerMasters.currency,
      country: customerMasters.country,
      reference: customerMasters.referenceBy,
      otherReferences: customerMasters.otherReferences,
      notes: customerMasters.notes,
      mappedSkuCount: sql<number>`(
        select count(*)::int from customer_product_map m where m.customer_id = ${customerMasters.id}
      )`,
    })
    .from(customerMasters)
    .leftJoin(employees, eq(employees.id, customerMasters.salesRepId))
    .orderBy(asc(customerMasters.name));
  return rows.map((r) => ({
    ...r,
    salesRepName: r.salesRepName ?? null,
    createdAt: r.createdAt.toISOString(),
    customerTypes: r.customerTypes ?? [],
    industryTypes: r.industryTypes ?? [],
    tags: r.tags ?? [],
  }));
}

/* ── Libraries ───────────────────────────────────────────────────────────── */

export interface LookupRow {
  id: string;
  listKey: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export async function listLookupItems(): Promise<LookupRow[]> {
  return db
    .select({
      id: lookupItems.id,
      listKey: lookupItems.listKey,
      label: lookupItems.label,
      sortOrder: lookupItems.sortOrder,
      isActive: lookupItems.isActive,
    })
    .from(lookupItems)
    .orderBy(asc(lookupItems.listKey), asc(lookupItems.sortOrder), asc(lookupItems.label));
}

export interface SlabRow {
  id: string;
  label: string | null;
  overdueFromDays: number;
  overdueToDays: number | null;
  graceDays: number;
  payoutPct: string;
  sortOrder: number;
  isActive: boolean;
}

export async function listIncentiveSlabs(): Promise<SlabRow[]> {
  return db
    .select({
      id: incentiveSlabs.id,
      label: incentiveSlabs.label,
      overdueFromDays: incentiveSlabs.overdueFromDays,
      overdueToDays: incentiveSlabs.overdueToDays,
      graceDays: incentiveSlabs.graceDays,
      payoutPct: incentiveSlabs.payoutPct,
      sortOrder: incentiveSlabs.sortOrder,
      isActive: incentiveSlabs.isActive,
    })
    .from(incentiveSlabs)
    .orderBy(asc(incentiveSlabs.sortOrder), asc(incentiveSlabs.overdueFromDays));
}

/**
 * Slabs that overlap each other, so the UI can warn. Two slabs covering day 20
 * means the payout for a 20-day-overdue invoice depends on row order, which is
 * a silent money bug — worth surfacing at configuration time.
 */
export function findOverlappingSlabs(slabs: SlabRow[]): [SlabRow, SlabRow][] {
  const active = slabs.filter((s) => s.isActive);
  const out: [SlabRow, SlabRow][] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const aTo = a.overdueToDays ?? Number.MAX_SAFE_INTEGER;
      const bTo = b.overdueToDays ?? Number.MAX_SAFE_INTEGER;
      if (a.overdueFromDays <= bTo && b.overdueFromDays <= aTo) out.push([a, b]);
    }
  }
  return out;
}

/* ── Field permissions ───────────────────────────────────────────────────── */

export interface FieldMatrix {
  people: { id: string; name: string; email: string; isAdmin: boolean }[];
  departments: { id: string; name: string }[];
  grants: { fieldKey: string; subjectType: string; subjectId: string | null; allowed: boolean }[];
}

export async function getFieldMatrix(): Promise<FieldMatrix> {
  const [people, departmentRows, grants] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        email: employees.email,
        isAdmin: employees.isAdmin,
      })
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(asc(employees.name)),
    db.execute<{ id: string; name: string }>(
      sql`select id, name from departments where is_active = true order by sort_order, name`,
    ),
    db
      .select({
        fieldKey: fieldPermissionGrants.fieldKey,
        subjectType: fieldPermissionGrants.subjectType,
        subjectId: fieldPermissionGrants.subjectId,
        allowed: fieldPermissionGrants.allowed,
      })
      .from(fieldPermissionGrants),
  ]);

  return {
    people,
    departments: (departmentRows as unknown as { id: string; name: string }[]).map((d) => ({
      id: d.id,
      name: d.name,
    })),
    grants,
  };
}

/* ── Data ingestion ──────────────────────────────────────────────────────── */

export interface ImportBatchRow {
  id: string;
  source: string;
  target: string;
  fileName: string | null;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  status: string;
  error: string | null;
  createdAt: Date;
  createdByName: string | null;
}

export async function listImportBatches(limit = 25): Promise<ImportBatchRow[]> {
  const rows = await db
    .select({
      id: importBatches.id,
      source: importBatches.source,
      target: importBatches.target,
      fileName: importBatches.fileName,
      rowCount: importBatches.rowCount,
      importedCount: importBatches.importedCount,
      skippedCount: importBatches.skippedCount,
      status: importBatches.status,
      error: importBatches.error,
      createdAt: importBatches.createdAt,
      createdByName: employees.name,
    })
    .from(importBatches)
    .leftJoin(employees, eq(employees.id, importBatches.createdById))
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdByName: r.createdByName ?? null }));
}

export interface TallyMappingRow {
  id: string;
  tallyGroup: string;
  mapsTo: TallyMapsTo;
  targetCategoryId: string | null;
  targetCategoryName: string | null;
  note: string | null;
  isActive: boolean;
}

export async function listTallyMappings(): Promise<TallyMappingRow[]> {
  const rows = await db
    .select({
      id: tallyGroupMappings.id,
      tallyGroup: tallyGroupMappings.tallyGroup,
      mapsTo: tallyGroupMappings.mapsTo,
      targetCategoryId: tallyGroupMappings.targetCategoryId,
      targetCategoryName: productCategories.name,
      note: tallyGroupMappings.note,
      isActive: tallyGroupMappings.isActive,
    })
    .from(tallyGroupMappings)
    .leftJoin(productCategories, eq(productCategories.id, tallyGroupMappings.targetCategoryId))
    .orderBy(asc(tallyGroupMappings.tallyGroup));
  return rows.map((r) => ({ ...r, targetCategoryName: r.targetCategoryName ?? null }));
}

/** Counts for the Master Data landing tiles. */
export async function getMasterDataCounts(): Promise<Record<string, number>> {
  const [row] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from product_categories where is_active) as categories,
      (select count(*)::int from products         where is_active) as products,
      (select count(*)::int from product_skus     where is_active) as skus,
      (select count(*)::int from customer_masters where is_active) as customers,
      (select count(*)::int from lookup_items     where is_active) as lookups,
      (select count(*)::int from incentive_slabs  where is_active) as slabs,
      (select count(*)::int from field_permission_grants)          as field_grants,
      (select count(*)::int from import_batches)                   as imports
  `);
  return (row as unknown as Record<string, number>) ?? {};
}

/** Active options for one editable list, for dropdowns outside /libraries. */
export async function listLookupOptions(listKey: string): Promise<string[]> {
  const rows = await db
    .select({ label: lookupItems.label })
    .from(lookupItems)
    .where(and(eq(lookupItems.listKey, listKey), eq(lookupItems.isActive, true)))
    .orderBy(asc(lookupItems.sortOrder), asc(lookupItems.label));
  return rows.map((r) => r.label);
}
