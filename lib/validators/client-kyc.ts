import { z } from "zod";
import { CLIENT_ADDRESS_TYPES, CLIENT_CONTACT_TYPES, VOLUME_CLASSES } from "@/db/enums";

/**
 * Create New Client KYC — one large schema mirroring every section of the
 * form. Same `emptyToNull`/`nonNegativeNumberOrNull`/`uuidOrNull` shapes
 * `lib/validators/master-data.ts` already uses, kept local here rather than
 * imported since neither file exports them.
 *
 * Company Name is the only hard-required field, matching the reference
 * design's single `*` marker — everything else (multiple contacts,
 * addresses, bank accounts included) is optional so a partially-filled
 * client can still be onboarded and completed later.
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

const nonNegativeNumberOrNull = (message: string, round = false) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === null || `${v}`.trim() === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), { message })
    .transform((v) => (v === null ? null : round ? Math.round(v) : v));

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

export const ClientKycContactSchema = z.object({
  /**
   * 0093 — which Contact Person group the row came from. Defaulted rather
   * than required so an older payload (or a caller that predates the three
   * groups) still validates, landing in the same `other` bucket the
   * migration backfilled existing rows to.
   */
  contactType: z.enum(CLIENT_CONTACT_TYPES).default("other"),
  firstName: emptyToNull(80),
  lastName: emptyToNull(80),
  contactNo: emptyToNull(40),
  email: emptyToNull(200),
  designationId: uuidOrNull,
  departmentId: uuidOrNull,
  notes: emptyToNull(1000),
});
export type ClientKycContactInput = z.input<typeof ClientKycContactSchema>;

export const ClientKycAddressSchema = z.object({
  addressType: z.enum(CLIENT_ADDRESS_TYPES),
  line1: emptyToNull(200),
  line2: emptyToNull(200),
  line3: emptyToNull(200),
  line4: emptyToNull(200),
  city: emptyToNull(120),
  state: emptyToNull(120),
  country: emptyToNull(120),
  pinCode: emptyToNull(20),
  /** 0094 — collected on the Invoice Mailing block only; see the schema note. */
  email: emptyToNull(200),
});
export type ClientKycAddressInput = z.input<typeof ClientKycAddressSchema>;

export const ClientKycBankAccountSchema = z.object({
  accountName: emptyToNull(160),
  bankName: emptyToNull(160),
  accountNo: emptyToNull(60),
  ifscSwift: emptyToNull(30),
  branch: emptyToNull(160),
  accountType: emptyToNull(40),
  isPrimary: z.boolean().default(false),
});
export type ClientKycBankAccountInput = z.input<typeof ClientKycBankAccountSchema>;

export const ClientKycSchema = z.object({
  /**
   * The draft this submission is re-saving, when the form was opened from
   * the Draft list's Restore. Absent on a fresh form, which is what makes
   * `saveClientKyc` insert instead of update — so Restore finishing a draft
   * updates that record rather than minting a second client code for the
   * same company.
   */
  id: uuidOrNull,

  /* Identity */
  name: z.string().trim().min(1, "Company name is required").max(200),
  salesRepId: uuidOrNull,
  customerTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  industryTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  gstin: emptyToNull(20),
  state: emptyToNull(120),
  website: emptyToNull(200),
  /**
   * The reference design's "Grade" — the same A/B/C scale `customerMasters`
   * already stores as `volumeClass`, renamed on the form only. Kept as a
   * distinct key here so the form reads the way the design does, and mapped
   * back to the existing column in `saveClientKyc`.
   */
  grade: z
    .enum(VOLUME_CLASSES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** 0089 — Identity's Export Yes/No. Free text; see the schema comment. */
  exportClient: emptyToNull(20),
  /**
   * Identity's Reference box - who or what brought this client in. Stored in
   * the existing `reference_by` column (0087), which the bulk-upload workbook
   * already fills, so the form and the workbook write the same fact rather
   * than two columns meaning the same thing.
   */
  reference: emptyToNull(200),

  /* Registration & Tax */
  gstRegistrationType: emptyToNull(60),
  panNo: emptyToNull(20),
  tinNumber: emptyToNull(40),
  msmeUdyamNo: emptyToNull(40),
  iecNumber: emptyToNull(40),
  currency: emptyToNull(20),
  country: emptyToNull(80),
  /**
   * Registration & Tax's two Yes/No boxes. Carried as the form's "Yes" / "No"
   * / "" strings and mapped to their boolean columns in `saveClientKyc` -
   * both columns are NOT NULL, so an unanswered box means false.
   */
  testCertificateNeeded: emptyToNull(10),
  tcsApplicable: emptyToNull(10),

  /* Contact Person */
  contacts: z.array(ClientKycContactSchema).max(20).default([]),

  /* Addresses */
  addresses: z.array(ClientKycAddressSchema).max(20).default([]),

  /* Commercial & Credit */
  creditLimit: nonNegativeNumberOrNull("Credit limit must be a number, 0 or more."),
  creditDays: nonNegativeNumberOrNull("Credit days must be a whole number of days, 0 or more.", true),
  paymentTerms: emptyToNull(120),
  freightCharges: emptyToNull(120),
  transporter: emptyToNull(120),
  quantityDeviation: emptyToNull(40),
  productIds: z.array(z.string().uuid()).max(500).default([]),

  /* Bank Details */
  bankAccounts: z.array(ClientKycBankAccountSchema).max(10).default([]),

  /* Notes */
  otherReferences: emptyToNull(2000),
  notes: emptyToNull(2000),
});
export type ClientKycInput = z.input<typeof ClientKycSchema>;

/**
 * Editing one onboarded client in place, from the Client Master.
 *
 * Deliberately a different shape from `ClientKycSchema`: that one describes a
 * whole onboarding, children included, and reusing it here would mean an edit
 * dialog had to resend every contact, address and bank account just to fix a
 * spelling — with anything it failed to send read as a deletion. This carries
 * only the fields that live on the client row itself. The directories own the
 * rest, one screen each.
 *
 * `code` is absent on purpose. It is system-generated and never rewritten
 * once assigned, the same rule `saveMasterCustomer` follows.
 */
export const ClientMasterEditSchema = z.object({
  /* Identity */
  name: z.string().trim().min(1, "Company name is required").max(200),
  gstin: emptyToNull(20),
  reference: emptyToNull(200),
  salesRepId: uuidOrNull,
  grade: z
    .enum(VOLUME_CLASSES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  customerTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  industryTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),

  /* Registration & Tax */
  panNo: emptyToNull(20),
  msmeUdyamNo: emptyToNull(40),
  gstRegistrationType: emptyToNull(60),
  state: emptyToNull(120),
  tinNumber: emptyToNull(40),
  testCertificateNeeded: z.boolean().default(false),
  website: emptyToNull(200),
  tcsApplicable: z.boolean().default(false),

  /* Where they are — the denormalised billing city */
  city: emptyToNull(120),

  /* Commercial & Credit */
  paymentTerms: emptyToNull(120),
  freightCharges: emptyToNull(120),
  creditDays: nonNegativeNumberOrNull("Credit days must be a whole number of days, 0 or more.", true),
  creditLimit: nonNegativeNumberOrNull("Credit limit must be a number, 0 or more."),
  transporter: emptyToNull(160),
  quantityDeviation: emptyToNull(60),
  otherReferences: emptyToNull(400),
  notes: emptyToNull(2000),

  /* Export Details */
  exportClient: emptyToNull(20),
  iecNumber: emptyToNull(40),
  currency: emptyToNull(20),
  country: emptyToNull(80),

  /* The record's own two flags, not KYC fields */
  isActive: z.boolean().default(true),
  focusedView: z.boolean().default(false),
});
