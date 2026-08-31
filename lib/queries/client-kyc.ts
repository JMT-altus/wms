import "server-only";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerAddresses,
  customerBankAccounts,
  customerContacts,
  customerMasters,
  departments,
  designations,
  employees,
  customerProductMap,
  lookupItems,
  products,
} from "@/db/schema";
import {
  CLIENT_ADDRESS_TYPE_LABELS,
  CLIENT_CONTACT_TYPE_LABELS,
  LOOKUP_LISTS,
  type ClientAddressType,
  type ClientContactType,
} from "@/db/enums";
import { missingKycFields } from "@/lib/masters/kyc-completeness";
import {
  KYC_LISTS,
  resolveKycList,
  type KycListKey,
  type ResolvedKycList,
} from "@/lib/masters/kyc-dropdowns";

/** The 11 Client KYC "+Add"-able dropdown keys, active options only. */
const KYC_LOOKUP_KEYS = [
  "customer_type",
  "industry_type",
  "gst_registration_type",
  "currency",
  "country",
  "credit_days",
  "kyc_payment_terms",
  "freight_charges",
  "transporter",
  "quantity_deviation",
  "bank_account_type",
  "bank_name",
] as const satisfies readonly (typeof LOOKUP_LISTS)[number]["key"][];
export type KycLookupKey = (typeof KYC_LOOKUP_KEYS)[number];

export type KycLookupOptions = Record<KycLookupKey, string[]>;

/** All 11 Client KYC lookup lists in one round trip. */
export async function listClientKycLookups(): Promise<KycLookupOptions> {
  const rows = await db
    .select({ listKey: lookupItems.listKey, label: lookupItems.label })
    .from(lookupItems)
    .where(and(eq(lookupItems.isActive, true)))
    .orderBy(asc(lookupItems.listKey), asc(lookupItems.sortOrder), asc(lookupItems.label));

  const out = Object.fromEntries(KYC_LOOKUP_KEYS.map((k) => [k, [] as string[]])) as KycLookupOptions;
  for (const r of rows) {
    if ((KYC_LOOKUP_KEYS as readonly string[]).includes(r.listKey)) {
      out[r.listKey as KycLookupKey].push(r.label);
    }
  }
  return out;
}

export interface RosterOption {
  id: string;
  name: string;
}

/** Active designations, for the Contact Person block's Designation picker. */
export async function listActiveDesignationOptions(): Promise<RosterOption[]> {
  return db
    .select({ id: designations.id, name: designations.name })
    .from(designations)
    .where(eq(designations.isActive, true))
    .orderBy(asc(designations.sortOrder), asc(designations.name));
}

/** Active departments, for the Contact Person block's Department picker. */
export async function listActiveDepartmentOptions(): Promise<RosterOption[]> {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(asc(departments.sortOrder), asc(departments.name));
}

/**
 * Cities already on record, for the address blocks' City suggestions.
 *
 * Deliberately NOT a new lookup list: cities are open-ended and an admin
 * curating every Indian town by hand would be busywork. The address field
 * stays free text with these as a datalist, so the common ones are one
 * keystroke away and a new one is never blocked.
 */
export async function listKnownCities(): Promise<string[]> {
  const [fromAddresses, fromMasters] = await Promise.all([
    db
      .selectDistinct({ city: customerAddresses.city })
      .from(customerAddresses)
      .where(isNotNull(customerAddresses.city)),
    db
      .selectDistinct({ city: customerMasters.city })
      .from(customerMasters)
      .where(isNotNull(customerMasters.city)),
  ]);

  const seen = new Set<string>();
  for (const r of [...fromAddresses, ...fromMasters]) {
    const c = r.city?.trim();
    if (c) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/* ── Client Master list ──────────────────────────────────────────────────── */

export interface ClientMasterRow {
  id: string;
  name: string;
  code: string | null;
  grade: string | null;
  customerTypes: string[];
  industryTypes: string[];
  tags: string[];
  products: string[];
  /** Needed by the edit dialog's Sales Co-ordinator picker, not shown as a column. */
  salesRepId: string | null;
  salesRepName: string | null;
  gstin: string | null;
  exportClient: string | null;
  creditLimit: string | null;
  isActive: boolean;
  /** 0086's Focused View flag — the shortlist this client is on, or not. */
  focusedView: boolean;
  createdAt: string;
  /* Registration & Tax */
  panNo: string | null;
  gstRegistrationType: string | null;
  msmeUdyamNo: string | null;
  tinNumber: string | null;
  website: string | null;
  testCertificateNeeded: boolean;
  tcsApplicable: boolean;
  /* Registration & Tax, continued */
  state: string | null;
  /* Commercial & Credit */
  creditDays: number | null;
  paymentTerms: string | null;
  freightCharges: string | null;
  transporter: string | null;
  quantityDeviation: string | null;
  /* Export Details */
  iecNumber: string | null;
  currency: string | null;
  country: string | null;
  /* Free text */
  reference: string | null;
  otherReferences: string | null;
  notes: string | null;
}

/**
 * Every client for the Client Master table — the same `customer_masters` rows
 * Create New Client KYC writes, never a second store.
 *
 * Carries every single-valued field the KYC form writes to this row, not just
 * the dozen worth a column by default: the rest arrive `defaultHidden`, so
 * they are searchable, tickable in the Columns menu, exported when ticked and
 * always shown in full in the row detail. A field the form collects and the
 * master then quietly drops is a field nobody can find again.
 *
 * Carries NO contact, address or bank data — not even a summary. Each of
 * those sections has a master of its own (Client Contact Master, Client
 * Address Book, Client Bank Master) and that is where it belongs; repeating a
 * primary here would be a second copy to keep in step and a second place to
 * correct it. City goes with them — it is part of an address, not of the
 * client — and dropping all of it takes seven correlated subqueries per row
 * with it.
 *
 * Product Types are the exception: a many-to-many with no master screen of
 * its own, reading as labels rather than records, like the Tags beside it.
 */
export async function listClientMasterRows(): Promise<ClientMasterRow[]> {
  const rows = await db
    .select({
      id: customerMasters.id,
      name: customerMasters.name,
      code: customerMasters.code,
      grade: customerMasters.volumeClass,
      customerTypes: customerMasters.customerTypes,
      industryTypes: customerMasters.industryTypes,
      tags: customerMasters.tags,
      salesRepId: customerMasters.salesRepId,
      salesRepName: employees.name,
      gstin: customerMasters.gstin,
      exportClient: customerMasters.exportClient,
      creditLimit: customerMasters.creditLimit,
      isActive: customerMasters.isActive,
      focusedView: customerMasters.focusedView,
      createdAt: customerMasters.createdAt,
      panNo: customerMasters.panNo,
      gstRegistrationType: customerMasters.gstRegistrationType,
      msmeUdyamNo: customerMasters.msmeUdyamNo,
      tinNumber: customerMasters.tinNumber,
      website: customerMasters.website,
      testCertificateNeeded: customerMasters.testCertificateNeeded,
      tcsApplicable: customerMasters.tcsApplicable,
      state: customerMasters.state,
      creditDays: customerMasters.creditPeriodDays,
      paymentTerms: customerMasters.paymentTerms,
      freightCharges: customerMasters.freightCharges,
      transporter: customerMasters.transporter,
      quantityDeviation: customerMasters.quantityDeviation,
      iecNumber: customerMasters.iecNumber,
      currency: customerMasters.currency,
      country: customerMasters.country,
      reference: customerMasters.referenceBy,
      otherReferences: customerMasters.otherReferences,
      notes: customerMasters.notes,
      // Product Types are a many-to-many, but they read like the Customer
      // Type and Tag chips beside them — a short list of labels, not a set of
      // records with their own screen. Aggregated in the query rather than
      // fetched per row, so this stays one round trip.
      products: sql<string[]>`coalesce((
        select array_agg(p.name order by p.name)
        from customer_product_map m
        join products p on p.id = m.product_id
        where m.customer_id = ${customerMasters.id}
      ), '{}')`,
    })
    .from(customerMasters)
    .leftJoin(employees, eq(employees.id, customerMasters.salesRepId))
    // 0096 — the Client Master is the list of real clients. Drafts have their
    // own section and recycled records their own bin; showing either here is
    // what made half-finished records look onboarded in the first place.
    .where(eq(customerMasters.kycStage, "complete"))
    .orderBy(asc(customerMasters.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    grade: r.grade ?? null,
    customerTypes: r.customerTypes ?? [],
    industryTypes: r.industryTypes ?? [],
    tags: r.tags ?? [],
    salesRepId: r.salesRepId,
    salesRepName: r.salesRepName ?? null,
    gstin: r.gstin,
    exportClient: r.exportClient,
    creditLimit: r.creditLimit,
    isActive: r.isActive,
    focusedView: r.focusedView,
    createdAt: r.createdAt.toISOString(),
    products: r.products ?? [],
    panNo: r.panNo,
    gstRegistrationType: r.gstRegistrationType,
    msmeUdyamNo: r.msmeUdyamNo,
    tinNumber: r.tinNumber,
    website: r.website,
    testCertificateNeeded: r.testCertificateNeeded,
    tcsApplicable: r.tcsApplicable,
    state: r.state,
    creditDays: r.creditDays,
    paymentTerms: r.paymentTerms,
    freightCharges: r.freightCharges,
    transporter: r.transporter,
    quantityDeviation: r.quantityDeviation,
    iecNumber: r.iecNumber,
    currency: r.currency,
    country: r.country,
    reference: r.reference,
    otherReferences: r.otherReferences,
    notes: r.notes,
  }));
}

/* ── Client Address Book ─────────────────────────────────────────────────── */

export interface ProductOption {
  id: string;
  name: string;
  categoryId: string | null;
}

/** Active products, for the Commercial & Credit "Product Types" pill grid. */
export async function listActiveProductOptions(): Promise<ProductOption[]> {
  return db
    .select({ id: products.id, name: products.name, categoryId: products.categoryId })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.name));
}

/* ── Client Master DD ────────────────────────────────────────────────── */

/**
 * Every editable Client KYC dropdown with its saved options.
 *
 * One query per store (`lookup_items` and `designations`), then the registry
 * resolves each list to its saved rows or, where none exist, its defaults.
 * The KYC form's option loaders go through the same resolver, which is what
 * makes Client Master DD and the form one source of truth.
 */
export async function listKycDropdowns(): Promise<ResolvedKycList[]> {
  const [lookupRows, designationRows] = await Promise.all([
    db
      .select({ id: lookupItems.id, listKey: lookupItems.listKey, label: lookupItems.label })
      .from(lookupItems)
      .where(eq(lookupItems.isActive, true))
      .orderBy(asc(lookupItems.sortOrder), asc(lookupItems.label)),
    db
      .select({ id: designations.id, label: designations.name })
      .from(designations)
      .where(eq(designations.isActive, true))
      .orderBy(asc(designations.sortOrder), asc(designations.name)),
  ]);

  const byKey = new Map<string, { id: string; label: string }[]>();
  for (const r of lookupRows) {
    const list = byKey.get(r.listKey) ?? [];
    list.push({ id: r.id, label: r.label });
    byKey.set(r.listKey, list);
  }

  return KYC_LISTS.map((def) =>
    resolveKycList(
      def,
      def.storage === "designations" ? designationRows : (byKey.get(def.lookupKey!) ?? []),
    ),
  );
}

/**
 * The same resolved lists keyed for the KYC form's pickers — labels only.
 * Replaces the form's direct `lookup_items` read so a list still renders its
 * defaults when nobody has configured it.
 */
export async function listKycDropdownOptions(): Promise<Record<KycListKey, string[]>> {
  const lists = await listKycDropdowns();
  return Object.fromEntries(
    lists.map((l) => [l.def.key, l.options.map((o) => o.label)]),
  ) as Record<KycListKey, string[]>;
}

/* ── Draft & Recycle Bin ─────────────────────────────────────────────────── */

export interface ClientKycStageRow {
  id: string;
  name: string;
  code: string | null;
  salesRepName: string | null;
  gstin: string | null;
  city: string | null;
  createdAt: string;
  /** Last time anyone changed the record — what the Draft list sorts "Updated" by. */
  updatedAt: string;
  /** When the 7-day clock started; null on recycled rows that never drafted. */
  draftSince: string | null;
  recycledAt: string | null;
  /** The requirements this record still fails, in form order. */
  missing: string[];
}

/**
 * Drafts and recycled records, sharing one query because they differ only by
 * stage and both need the same "what is still missing" answer.
 *
 * The gaps are recomputed on read rather than stored on the row. A stored
 * list would go stale the moment the completeness rule changes, and would
 * quietly disagree with the rule the save path actually applies — the whole
 * point of keeping that rule in one module.
 */
async function listByStage(stage: "draft" | "recycled"): Promise<ClientKycStageRow[]> {
  const rows = await db
    .select({
      id: customerMasters.id,
      name: customerMasters.name,
      code: customerMasters.code,
      gstin: customerMasters.gstin,
      panNo: customerMasters.panNo,
      salesRepId: customerMasters.salesRepId,
      salesRepName: employees.name,
      city: customerMasters.city,
      createdAt: customerMasters.createdAt,
      updatedAt: customerMasters.updatedAt,
      draftSince: customerMasters.draftSince,
      recycledAt: customerMasters.recycledAt,
      contactCount: sql<number>`(
        select count(*)::int from customer_contacts c
        where c.customer_master_id = ${customerMasters.id}
          and coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), '') <> ''
          and (coalesce(c.contact_no, '') <> '' or coalesce(c.email, '') <> '')
      )`,
      billingCount: sql<number>`(
        select count(*)::int from customer_addresses a
        where a.customer_master_id = ${customerMasters.id}
          and a.address_type = 'billing'
          and coalesce(a.line1, '') <> '' and coalesce(a.city, '') <> ''
          and coalesce(a.pin_code, '') <> ''
      )`,
    })
    .from(customerMasters)
    .leftJoin(employees, eq(employees.id, customerMasters.salesRepId))
    .where(
      stage === "draft"
        ? // Checked out into the KYC form, so it is already on someone's
          // screen. Listing it here too would show the same record in two
          // places and invite two people to finish it in parallel.
          and(eq(customerMasters.kycStage, "draft"), isNull(customerMasters.editingSince))
        : eq(customerMasters.kycStage, stage),
    )
    // Oldest first: the draft closest to being recycled is the one that
    // actually needs attention, so it should not be buried at the bottom.
    .orderBy(asc(customerMasters.draftSince), asc(customerMasters.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    salesRepName: r.salesRepName ?? null,
    gstin: r.gstin,
    city: r.city,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    draftSince: r.draftSince ? r.draftSince.toISOString() : null,
    recycledAt: r.recycledAt ? r.recycledAt.toISOString() : null,
    // The counts above answer the two child-row requirements; the rest read
    // straight off the master, so the shared rule judges the same facts the
    // save path did.
    missing: missingKycFields({
      name: r.name,
      gstin: r.gstin,
      panNo: r.panNo,
      salesRepId: r.salesRepId,
      contacts: r.contactCount > 0 ? [{ firstName: "x", contactNo: "x" }] : [],
      addresses:
        r.billingCount > 0
          ? [{ addressType: "billing", line1: "x", city: "x", pinCode: "x" }]
          : [],
    }),
  }));
}

export async function listClientDrafts(): Promise<ClientKycStageRow[]> {
  return listByStage("draft");
}

export async function listRecycledClients(): Promise<ClientKycStageRow[]> {
  return listByStage("recycled");
}

/* ── Client Contact Master ───────────────────────────────────────────────── */

export interface ClientContactRow {
  id: string;
  company: string;
  code: string | null;
  /** "Purchase Contact" / "Accounts Contact" / "Other Contact". */
  typeLabel: string;
  contactType: ClientContactType;
  /** Kept apart rather than joined: the table gives each its own column. */
  firstName: string | null;
  lastName: string | null;
  designation: string | null;
  department: string | null;
  /** The roster ids behind those names — what the edit form actually sets. */
  designationId: string | null;
  departmentId: string | null;
  contactNo: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
}

/**
 * Every contact person on record, one row per PERSON.
 *
 * This is the section that owns contact data. Client Master deliberately no
 * longer carries a Contact Person column: one client has several contacts
 * (purchase, accounts, other), and a single column could only ever show one
 * of them, which quietly implied the others did not exist.
 *
 * Clients with no contact at all are NOT listed here — an empty row would say
 * nothing, and the gap is already visible where it matters, in Draft (a
 * contact is one of the completeness requirements).
 */
export async function listClientContactMaster(): Promise<ClientContactRow[]> {
  const rows = await db
    .select({
      id: customerContacts.id,
      company: customerMasters.name,
      code: customerMasters.code,
      contactType: customerContacts.contactType,
      firstName: customerContacts.firstName,
      lastName: customerContacts.lastName,
      designation: designations.name,
      department: departments.name,
      designationId: customerContacts.designationId,
      departmentId: customerContacts.departmentId,
      contactNo: customerContacts.contactNo,
      email: customerContacts.email,
      isPrimary: customerContacts.isPrimary,
      notes: customerContacts.notes,
    })
    .from(customerContacts)
    .innerJoin(customerMasters, eq(customerMasters.id, customerContacts.customerMasterId))
    .leftJoin(designations, eq(designations.id, customerContacts.designationId))
    .leftJoin(departments, eq(departments.id, customerContacts.departmentId))
    // Onboarded clients only, matching listClientMasterRows above. A draft's
    // rows used to show up here the moment it was saved, which put unfinished
    // work into the three directories before anyone had onboarded it — and
    // made "Onboarding moves this into its master section" untrue, since it
    // was already there. Drafts belong to the Draft screen until promoted.
    .where(eq(customerMasters.kycStage, "complete"))
    .orderBy(asc(customerMasters.name), asc(customerContacts.sortOrder));

  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    code: r.code,
    contactType: (r.contactType ?? "other") as ClientContactType,
    typeLabel: CLIENT_CONTACT_TYPE_LABELS[(r.contactType ?? "other") as ClientContactType],
    firstName: r.firstName?.trim() || null,
    lastName: r.lastName?.trim() || null,
    designation: r.designation ?? null,
    department: r.department ?? null,
    designationId: r.designationId ?? null,
    departmentId: r.departmentId ?? null,
    contactNo: r.contactNo,
    email: r.email,
    isPrimary: r.isPrimary,
    notes: r.notes,
  }));
}

/* ── Client Address Book (addresses only) ────────────────────────────────── */

export interface ClientAddressRow {
  id: string;
  company: string;
  code: string | null;
  /** "Billing Address" / "Delivery Address" / "Invoice Mailing Address". */
  typeLabel: string;
  addressType: ClientAddressType;
  /** The four lines joined for the table's single Street Address cell. */
  street: string | null;
  /** ...and kept apart, because the edit form sets them individually. */
  line1: string | null;
  line2: string | null;
  line3: string | null;
  line4: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pinCode: string | null;
  /** Only the Invoice Mailing block collects this. */
  email: string | null;
}

/**
 * Every address on record, one row per ADDRESS.
 *
 * The Address Book used to be a contact directory that happened to show a
 * city — contact name, designation, phone and email, with the address itself
 * reduced to "City / State". Contacts now have their own section, so this one
 * is what its name always claimed: addresses, and nothing else.
 */
export async function listClientAddressBook(): Promise<ClientAddressRow[]> {
  const rows = await db
    .select({
      id: customerAddresses.id,
      company: customerMasters.name,
      code: customerMasters.code,
      addressType: customerAddresses.addressType,
      line1: customerAddresses.line1,
      line2: customerAddresses.line2,
      line3: customerAddresses.line3,
      line4: customerAddresses.line4,
      city: customerAddresses.city,
      state: customerAddresses.state,
      country: customerAddresses.country,
      pinCode: customerAddresses.pinCode,
      email: customerAddresses.email,
    })
    .from(customerAddresses)
    .innerJoin(customerMasters, eq(customerMasters.id, customerAddresses.customerMasterId))
    // Onboarded clients only, matching listClientMasterRows above. A draft's
    // rows used to show up here the moment it was saved, which put unfinished
    // work into the three directories before anyone had onboarded it — and
    // made "Onboarding moves this into its master section" untrue, since it
    // was already there. Drafts belong to the Draft screen until promoted.
    .where(eq(customerMasters.kycStage, "complete"))
    .orderBy(asc(customerMasters.name), asc(customerAddresses.sortOrder));

  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    code: r.code,
    addressType: r.addressType,
    typeLabel: CLIENT_ADDRESS_TYPE_LABELS[r.addressType],
    // The four lines are one address, not four facts. Joined here so the
    // table shows the whole street address in one cell instead of four
    // mostly-empty columns.
    street: [r.line1, r.line2, r.line3, r.line4].filter(Boolean).join(", ") || null,
    line1: r.line1,
    line2: r.line2,
    line3: r.line3,
    line4: r.line4,
    city: r.city,
    state: r.state,
    country: r.country,
    pinCode: r.pinCode,
    email: r.email,
  }));
}

/* ── Client Bank Master ──────────────────────────────────────────────────── */

export interface ClientBankRow {
  id: string;
  company: string;
  code: string | null;
  accountName: string | null;
  bankName: string | null;
  accountNo: string | null;
  ifscSwift: string | null;
  branch: string | null;
  accountType: string | null;
  isPrimary: boolean;
}

/** Every bank account on record, one row per ACCOUNT. */
export async function listClientBankMaster(): Promise<ClientBankRow[]> {
  const rows = await db
    .select({
      id: customerBankAccounts.id,
      company: customerMasters.name,
      code: customerMasters.code,
      accountName: customerBankAccounts.accountName,
      bankName: customerBankAccounts.bankName,
      accountNo: customerBankAccounts.accountNo,
      ifscSwift: customerBankAccounts.ifscSwift,
      branch: customerBankAccounts.branch,
      accountType: customerBankAccounts.accountType,
      isPrimary: customerBankAccounts.isPrimary,
    })
    .from(customerBankAccounts)
    .innerJoin(customerMasters, eq(customerMasters.id, customerBankAccounts.customerMasterId))
    // Onboarded clients only, matching listClientMasterRows above. A draft's
    // rows used to show up here the moment it was saved, which put unfinished
    // work into the three directories before anyone had onboarded it — and
    // made "Onboarding moves this into its master section" untrue, since it
    // was already there. Drafts belong to the Draft screen until promoted.
    .where(eq(customerMasters.kycStage, "complete"))
    .orderBy(asc(customerMasters.name), asc(customerBankAccounts.sortOrder));

  return rows;
}

/* ── Restoring a draft into the form ─────────────────────────────────────── */

/**
 * One draft, shaped the way the Create New Client KYC form holds it.
 *
 * Deliberately mirrors the form's own `FormState` rather than the table
 * columns: the form is the only consumer, and handing it something it has to
 * re-map is how the two drift apart. `volumeClass` comes back as `grade` and
 * the two boolean columns come back as the "Yes"/"No" strings the selects
 * show, which is exactly the mapping `saveClientKyc` does in reverse.
 */
export interface ClientKycDraftValues {
  id: string;
  code: string | null;
  name: string;
  gstin: string;
  salesRepId: string;
  exportClient: string;
  reference: string;
  grade: string;
  tags: string[];
  customerTypes: string[];
  industryTypes: string[];
  productIds: string[];
  panNo: string;
  msmeUdyamNo: string;
  gstRegistrationType: string;
  currency: string;
  country: string;
  state: string;
  tinNumber: string;
  iecNumber: string;
  website: string;
  testCertificateNeeded: string;
  tcsApplicable: string;
  contacts: {
    contactType: ClientContactType;
    firstName: string;
    lastName: string;
    contactNo: string;
    email: string;
    designationId: string;
    departmentId: string;
    notes: string;
  }[];
  addresses: {
    addressType: ClientAddressType;
    line1: string;
    line2: string;
    line3: string;
    line4: string;
    city: string;
    state: string;
    country: string;
    pinCode: string;
    email: string;
  }[];
  bankAccounts: {
    accountName: string;
    bankName: string;
    accountNo: string;
    ifscSwift: string;
    branch: string;
    accountType: string;
    isPrimary: boolean;
  }[];
  paymentTerms: string;
  freightCharges: string;
  creditDays: string;
  creditLimit: string;
  transporter: string;
  quantityDeviation: string;
  otherReferences: string;
  notes: string;
}

/** Every nullable text column reaches the form as "" — selects and inputs are controlled. */
const s = (v: string | null | undefined): string => v ?? "";

/**
 * Load one draft for editing, or null if it is not a draft.
 *
 * Restricted to `kyc_stage = 'draft'` on purpose. This powers Restore, and
 * Restore must not become a back door into editing a live Client Master
 * record — that is the Client Master's own job, under its own permissions.
 * A recycled row is likewise off limits until it is restored to Draft first.
 */
export async function getClientKycDraft(id: string): Promise<ClientKycDraftValues | null> {
  const [row] = await db
    .select()
    .from(customerMasters)
    .where(and(eq(customerMasters.id, id), eq(customerMasters.kycStage, "draft")))
    .limit(1);
  if (!row) return null;

  // Three child reads plus the product map. Sorted by `sortOrder` because
  // that is the order the save path wrote them in, and it is what makes the
  // restored form look like the form that was saved.
  const [contacts, addresses, banks, productRows] = await Promise.all([
    db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerMasterId, id))
      .orderBy(asc(customerContacts.sortOrder)),
    db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerMasterId, id))
      .orderBy(asc(customerAddresses.sortOrder)),
    db
      .select()
      .from(customerBankAccounts)
      .where(eq(customerBankAccounts.customerMasterId, id))
      .orderBy(asc(customerBankAccounts.sortOrder)),
    db
      .select({ productId: customerProductMap.productId })
      .from(customerProductMap)
      .where(eq(customerProductMap.customerId, id)),
  ]);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    gstin: s(row.gstin),
    salesRepId: s(row.salesRepId),
    exportClient: s(row.exportClient),
    reference: s(row.referenceBy),
    grade: s(row.volumeClass),
    tags: row.tags ?? [],
    customerTypes: row.customerTypes ?? [],
    industryTypes: row.industryTypes ?? [],
    // The map's product_id is nullable (ON DELETE SET NULL), so a product
    // deleted since the draft was saved leaves a tombstone row here. Dropped
    // rather than carried: the form checks pills by id, and a null matches
    // nothing anyway.
    productIds: productRows.map((p) => p.productId).filter((id): id is string => id !== null),
    panNo: s(row.panNo),
    msmeUdyamNo: s(row.msmeUdyamNo),
    gstRegistrationType: s(row.gstRegistrationType),
    currency: s(row.currency),
    country: s(row.country),
    state: s(row.state),
    tinNumber: s(row.tinNumber),
    iecNumber: s(row.iecNumber),
    website: s(row.website),
    // Booleans on the way out, "Yes"/"No" on the way back in. A false here is
    // genuinely "No" rather than unanswered: the columns are NOT NULL, so the
    // distinction was already lost at save time and pretending otherwise
    // would blank a box the user had actually answered.
    testCertificateNeeded: row.testCertificateNeeded ? "Yes" : "No",
    tcsApplicable: row.tcsApplicable ? "Yes" : "No",
    contacts: contacts.map((c) => ({
      contactType: c.contactType as ClientContactType,
      firstName: s(c.firstName),
      lastName: s(c.lastName),
      contactNo: s(c.contactNo),
      email: s(c.email),
      designationId: s(c.designationId),
      departmentId: s(c.departmentId),
      notes: s(c.notes),
    })),
    addresses: addresses.map((a) => ({
      addressType: a.addressType as ClientAddressType,
      line1: s(a.line1),
      line2: s(a.line2),
      line3: s(a.line3),
      line4: s(a.line4),
      city: s(a.city),
      state: s(a.state),
      country: s(a.country),
      pinCode: s(a.pinCode),
      email: s(a.email),
    })),
    bankAccounts: banks.map((b) => ({
      accountName: s(b.accountName),
      bankName: s(b.bankName),
      accountNo: s(b.accountNo),
      ifscSwift: s(b.ifscSwift),
      branch: s(b.branch),
      accountType: s(b.accountType),
      isPrimary: b.isPrimary,
    })),
    paymentTerms: s(row.paymentTerms),
    freightCharges: s(row.freightCharges),
    creditDays: row.creditPeriodDays === null ? "" : String(row.creditPeriodDays),
    creditLimit: row.creditLimit === null ? "" : String(row.creditLimit),
    transporter: s(row.transporter),
    quantityDeviation: s(row.quantityDeviation),
    otherReferences: s(row.otherReferences),
    notes: s(row.notes),
  };
}
