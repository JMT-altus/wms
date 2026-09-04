"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerAddresses,
  customerBankAccounts,
  customerContacts,
  customerMasters,
  customerProductMap,
  departments,
  designations,
  documents,
  documentEvents,
  lookupItems,
} from "@/db/schema";
import type { Employee } from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { getSupabaseAdmin, DOCUMENTS_BUCKET } from "@/lib/supabase/admin";
import {
  ClientKycAddressSchema,
  ClientKycBankAccountSchema,
  ClientKycContactSchema,
  ClientKycSchema,
  ClientMasterEditSchema,
} from "@/lib/validators/client-kyc";
import { nextCustomerCodes } from "@/app/(masters-module)/masters/actions";
import { CLIENT_ADDRESS_TYPES, CLIENT_CONTACT_TYPES } from "@/db/enums";
import {
  listClientBulkOptions,
  type ClientBulkRosters,
} from "@/lib/queries/client-bulk-options";
import { missingKycFields } from "@/lib/masters/kyc-completeness";
import { setCustomerDormancy, type DormancyResult } from "@/lib/masters/dormancy-store";
import {
  COLUMN_BY_KEY,
  isBlankRow,
  validateCell,
  type SheetRow,
} from "@/lib/forms/client-bulk-columns";
import { rowToKycInput } from "@/lib/forms/client-bulk-row";
import { isPlausibleGstin } from "@/lib/masters/gstin";
import { lookupGstin, type GstinDetails } from "@/lib/gst";
import type { LookupListKey } from "@/db/enums";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/**
 * Thrown when a re-save names a record that is no longer a draft.
 *
 * A sentinel rather than a plain string result because it has to abort the
 * transaction — returning early would leave the children already deleted.
 */
class NotADraftError extends Error {}

/**
 * Admin-only, matching the Forms area this screen now lives in — the layout
 * at forms/client-kyc/layout.tsx enforces the same rule on the read path.
 * It used to be the `masters` module grant; server actions aren't covered by
 * a layout guard, so this check is what actually protects the write path.
 */
type Denied = { ok: false; error: string };
async function guard(): Promise<{ me: Employee } | { error: Denied }> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return { error: { ok: false, error: "Please sign in again." } };
  if (!me.isAdmin) {
    return { error: { ok: false, error: "Client KYC is restricted to admins." } };
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
  if (e?.code === "23505" || e?.cause?.code === "23505") return `That ${label} is already in use.`;
  return `Could not save: ${e?.message ?? String(err)}`;
}

function revalidateKyc(): void {
  revalidatePath("/forms/client-kyc/new");
  revalidatePath("/forms/client-kyc/drafts");
  revalidatePath("/forms/client-kyc/clients");
  revalidatePath("/forms/client-kyc/recycle-bin");
  revalidatePath("/masters/customers");
  revalidatePath("/master-setup/customers");
  revalidatePath("/master-setup/libraries");
}

/* ── Save the whole form ─────────────────────────────────────────────────── */

/** The parsed KYC payload, shared by the save and autosave paths. */
type KycValues = z.infer<typeof ClientKycSchema>;
/** The transaction handle `db.transaction` hands its callback. */
type KycTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every `customer_masters` column the form owns.
 *
 * `code` and `createdById` are deliberately absent: they are set once, when
 * the row is first created, and must survive every later write. Re-issuing a
 * code on update would renumber a client mid-onboarding, and rewriting the
 * creator would hand authorship to whoever happened to finish the draft.
 */
function kycColumnValues(v: KycValues, creditLimit: string | null) {
  // `customer_masters.city` is the denormalised one the Client Master and
  // Draft lists show. The KYC form has no City box of its own — cities belong
  // to addresses — so it was left null on every record the form created and
  // that column read as permanently empty. The billing address is the
  // client's own location, which is what the column has always meant.
  const billingCity =
    v.addresses.find((a) => a.addressType === "billing" && a.city)?.city ?? null;

  return {
        name: v.name,
        city: billingCity,
        salesRepId: v.salesRepId,
        // The form's "Grade" is this column under another name — see the
        // schema comment on ClientKycSchema.grade.
        volumeClass: v.grade,
        exportClient: v.exportClient,
        referenceBy: v.reference,
        // Both columns are NOT NULL booleans; the form sends the Yes/No
        // strings it shows. Only an explicit "Yes" is true - "No" and an
        // unanswered box are the same false, which is what NOT NULL forces
        // and what the bulk-upload workbook already assumes for TCS.
        testCertificateNeeded: v.testCertificateNeeded === "Yes",
        tcsApplicable: v.tcsApplicable === "Yes",
        customerTypes: v.customerTypes,
        industryTypes: v.industryTypes,
        tags: v.tags,
        gstin: v.gstin,
        state: v.state,
        website: v.website,
        gstRegistrationType: v.gstRegistrationType,
        panNo: v.panNo,
        tinNumber: v.tinNumber,
        msmeUdyamNo: v.msmeUdyamNo,
        iecNumber: v.iecNumber,
        currency: v.currency,
        country: v.country,
        creditLimit,
        creditPeriodDays: v.creditDays,
        paymentTerms: v.paymentTerms,
        freightCharges: v.freightCharges,
        transporter: v.transporter,
        quantityDeviation: v.quantityDeviation,
        otherReferences: v.otherReferences,
        notes: v.notes,
      };
}

/**
 * Replace a record's contacts, addresses, bank accounts and product links.
 *
 * Delete-then-insert rather than a diff: the form posts the complete set on
 * every write and its rows carry no stable identity, so a diff has nothing to
 * match on — and only a full replace can express "this contact was removed".
 * Safe to call on a brand-new row, where the deletes simply match nothing.
 */
async function replaceKycChildren(tx: KycTx, id: string, v: KycValues): Promise<void> {
  await tx.delete(customerContacts).where(eq(customerContacts.customerMasterId, id));
  await tx.delete(customerAddresses).where(eq(customerAddresses.customerMasterId, id));
  await tx.delete(customerBankAccounts).where(eq(customerBankAccounts.customerMasterId, id));
  await tx.delete(customerProductMap).where(eq(customerProductMap.customerId, id));

      if (v.contacts.length > 0) {
        // Store grouped the way the form shows them - Purchase, then
        // Accounts, then Other - regardless of the order the blocks were
        // added in. `sortOrder` is what every reader sorts by, so this is
        // what makes the primary below land on the first Purchase contact
        // rather than on whichever block the user happened to fill first.
        const ordered = v.contacts
          .map((c, i) => ({ c, i }))
          .sort(
            (a, b) =>
              CLIENT_CONTACT_TYPES.indexOf(a.c.contactType) -
                CLIENT_CONTACT_TYPES.indexOf(b.c.contactType) || a.i - b.i,
          )
          .map(({ c }) => c);

        await tx.insert(customerContacts).values(
          ordered.map((c, i) => ({
            customerMasterId: id,
            contactType: c.contactType,
            firstName: c.firstName,
            lastName: c.lastName,
            contactNo: c.contactNo,
            email: c.email,
            designationId: c.designationId,
            departmentId: c.departmentId,
            notes: c.notes,
            isPrimary: i === 0,
            sortOrder: i,
          })),
        );
      }

      if (v.addresses.length > 0) {
        // Same grouping rule as the contacts above: stored Billing, then
        // Delivery, then Invoice Mailing, whatever order the blocks were
        // added in. Readers sort on `sort_order`, so this is what makes
        // "the client's address" resolve to the billing one.
        const orderedAddresses = v.addresses
          .map((a, i) => ({ a, i }))
          .sort(
            (x, y) =>
              CLIENT_ADDRESS_TYPES.indexOf(x.a.addressType) -
                CLIENT_ADDRESS_TYPES.indexOf(y.a.addressType) || x.i - y.i,
          )
          .map(({ a }) => a);

        await tx.insert(customerAddresses).values(
          orderedAddresses.map((a, i) => ({
            customerMasterId: id,
            addressType: a.addressType,
            line1: a.line1,
            line2: a.line2,
            line3: a.line3,
            line4: a.line4,
            city: a.city,
            state: a.state,
            country: a.country,
            pinCode: a.pinCode,
            email: a.email,
            sortOrder: i,
          })),
        );
      }

      if (v.bankAccounts.length > 0) {
        // Only one row may carry isPrimary — if the client sent more than
        // one (shouldn't happen given the UI, but don't trust it), keep the
        // first marked one and drop the rest to plain.
        let primaryTaken = false;
        await tx.insert(customerBankAccounts).values(
          v.bankAccounts.map((b, i) => {
            const isPrimary = b.isPrimary && !primaryTaken;
            if (isPrimary) primaryTaken = true;
            return {
              customerMasterId: id,
              accountName: b.accountName,
              bankName: b.bankName,
              accountNo: b.accountNo,
              ifscSwift: b.ifscSwift,
              branch: b.branch,
              accountType: b.accountType,
              isPrimary,
              sortOrder: i,
            };
          }),
        );
      }

      if (v.productIds.length > 0) {
        await tx.insert(customerProductMap).values(
          v.productIds.map((productId) => ({ customerId: id, productId })),
        );
      }

}

export async function saveClientKyc(
  input: unknown,
): Promise<Result & { customerMasterId?: string; draft?: boolean; missing?: string[] }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const parsed = ClientKycSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;
  const creditLimit = v.creditLimit === null ? null : String(v.creditLimit);

  try {
    const customerMasterId = await db.transaction(async (tx) => {
      // Anything still missing a requirement is a draft, not a client. The
      // rule lives in one place (lib/masters/kyc-completeness.ts) so the
      // Draft page can list the very same gaps back to the user instead of
      // just saying "incomplete".
      const missing = missingKycFields({
        name: v.name,
        gstin: v.gstin,
        panNo: v.panNo,
        salesRepId: v.salesRepId,
        contacts: v.contacts,
        addresses: v.addresses,
      });
      const isDraft = missing.length > 0;

      const shared = kycColumnValues(v, creditLimit);

      let id: string;

      if (v.id) {
        // Re-saving a restored draft. Scoped to kyc_stage = 'draft' so this
        // can never overwrite a live Client Master record: if the row was
        // finished or recycled in another tab while this form sat open, the
        // update matches nothing and we say so rather than silently doing
        // the wrong thing.
        const [row] = await tx
          .update(customerMasters)
          .set({
            ...shared,
            kycStage: isDraft ? "draft" : "complete",
            // Still short of the bar, so the 7-day clock restarts — the
            // record is being actively worked on, which is exactly the case
            // migration 0096 kept this column separate from updated_at for.
            draftSince: isDraft ? new Date() : null,
            recycledAt: null,
            // Saving ends the checkout: the record goes back to the Draft
            // list, or on to the Client Master.
            editingSince: null,
            updatedAt: new Date(),
          })
          .where(and(eq(customerMasters.id, v.id), eq(customerMasters.kycStage, "draft")))
          .returning({ id: customerMasters.id });
        if (!row) throw new NotADraftError();
        id = row.id;

      } else {
        const [code] = await nextCustomerCodes(1);
        const [row] = await tx
          .insert(customerMasters)
          .values({
            ...shared,
            code,
            kycStage: isDraft ? "draft" : "complete",
            // Starts the 7-day clock. Only set for drafts, so a complete
            // record carries no stale expiry date if it is ever re-opened.
            draftSince: isDraft ? new Date() : null,
            createdById: g.me.id,
          })
          .returning({ id: customerMasters.id });
        id = row!.id;
      }

      await replaceKycChildren(tx, id, v);

      return { id, isDraft, missing };
    });

    revalidateKyc();
    return {
      ok: true,
      id: customerMasterId.id,
      customerMasterId: customerMasterId.id,
      draft: customerMasterId.isDraft,
      missing: customerMasterId.missing,
    };
  } catch (err) {
    if (err instanceof NotADraftError) {
      return {
        ok: false,
        error: "That draft was finished or removed elsewhere. Reload the Draft list to see where it went.",
      };
    }
    return { ok: false, error: dbError(err, "customer code") };
  }
}

/* ── Inline "+Add" for the form's dropdowns ──────────────────────────────── */

/**
 * Adds one option to a Client KYC lookup list, from inside the form itself.
 * Gated the same way every other Masters write is — module access, not
 * `requireAdmin()` — since this "+Add" is part of the onboarding flow, not
 * the separate /master-setup/libraries admin screen.
 */
export async function addKycLookupOption(listKey: LookupListKey, label: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = label.trim();
  if (!clean) return { ok: false, error: "Enter a value first." };
  if (clean.length > 200) return { ok: false, error: "That's too long." };

  const existing = await db
    .select({ id: lookupItems.id })
    .from(lookupItems)
    .where(and(eq(lookupItems.listKey, listKey), sql`lower(${lookupItems.label}) = lower(${clean})`))
    .limit(1);
  if (existing[0]) return { ok: true, id: existing[0].id };

  try {
    const [row] = await db
      .insert(lookupItems)
      .values({ listKey, label: clean, createdById: g.me.id })
      .returning({ id: lookupItems.id });
    revalidateKyc();
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "option") };
  }
}

async function addRosterOption(
  table: typeof designations | typeof departments,
  name: string,
): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = name.trim();
  if (!clean) return { ok: false, error: "Enter a name first." };
  if (clean.length > 120) return { ok: false, error: "That's too long." };

  const existing = await db
    .select({ id: table.id })
    .from(table)
    .where(sql`lower(${table.name}) = lower(${clean})`)
    .limit(1);
  if (existing[0]) return { ok: true, id: existing[0].id };

  try {
    const [row] = await db.insert(table).values({ name: clean }).returning({ id: table.id });
    revalidateKyc();
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err, "name") };
  }
}

export async function addKycDesignation(name: string): Promise<Result> {
  return addRosterOption(designations, name);
}

export async function addKycDepartment(name: string): Promise<Result> {
  return addRosterOption(departments, name);
}

/* ── Documents (post-save only — same rule the form's UI enforces) ──────── */

export type AttachResult = { ok: true; id?: string; url?: string } | { ok: false; error: string };

const MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TTL_SECONDS = 60 * 5;
const DISALLOWED_EXTENSIONS =
  /\.(exe|com|cmd|bat|msi|scr|pif|vbs|js|mjs|cjs|jar|sh|bash|app|dmg|ps1|psm1|reg|hta|cpl|gadget)$/i;
const DISALLOWED_MIME_TYPES = new Set<string>([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-mach-binary",
  "application/vnd.microsoft.portable-executable",
  "application/x-sh",
  "application/x-shellscript",
  "text/x-shellscript",
]);

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

async function logDocEvent(input: {
  documentId: string | null;
  documentTitle: string;
  actorId: string;
  eventType: "created" | "deleted";
  toValue?: unknown;
}): Promise<void> {
  try {
    await db.insert(documentEvents).values({
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      actorId: input.actorId,
      eventType: input.eventType,
      fromValue: null as never,
      toValue: (input.toValue ?? null) as never,
    });
  } catch (err) {
    console.warn("[client-kyc-attachments] audit write failed", err);
  }
}

export async function attachClientKycFile(form: FormData): Promise<AttachResult> {
  const customerMasterId = String(form.get("customerMasterId") ?? "");
  if (!isUuid(customerMasterId)) return { ok: false, error: "Save the client first." };
  const g = await guard();
  if ("error" in g) return g.error;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a file to attach." };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "File exceeds 25 MB." };
  if (DISALLOWED_EXTENSIONS.test(file.name) || (file.type && DISALLOWED_MIME_TYPES.has(file.type))) {
    return { ok: false, error: "This file type is not allowed." };
  }

  const title = String(form.get("title") ?? "").trim() || file.name;
  const path = `client-kyc/${customerMasterId}/${Date.now()}-${safeName(file.name)}`;

  const sb = getSupabaseAdmin();
  const { error: upErr } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  try {
    const [row] = await db
      .insert(documents)
      .values({
        title: title.slice(0, 200),
        storagePath: path,
        linkUrl: null,
        mimeType: file.type || null,
        sizeBytes: file.size,
        customerMasterId,
        uploadedById: g.me.id,
      })
      .returning({ id: documents.id });
    await logDocEvent({
      documentId: row!.id,
      documentTitle: title,
      actorId: g.me.id,
      eventType: "created",
      toValue: { customerMasterId, mimeType: file.type || null, sizeBytes: file.size },
    });
    revalidateKyc();
    return { ok: true, id: row!.id };
  } catch (err) {
    await sb.storage.from(DOCUMENTS_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
}

export async function getClientKycAttachmentUrl(documentId: string): Promise<AttachResult> {
  if (!isUuid(documentId)) return { ok: false, error: "Invalid id." };
  const g = await guard();
  if ("error" in g) return g.error;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
    columns: { id: true, storagePath: true, linkUrl: true, customerMasterId: true },
  });
  if (!doc) return { ok: false, error: "Attachment not found." };
  if (doc.linkUrl) return { ok: true, url: doc.linkUrl };
  if (!doc.storagePath) return { ok: false, error: "Attachment has no file." };

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storagePath, DOWNLOAD_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return { ok: false, error: error?.message ?? "Could not create a download link." };
  }
  return { ok: true, url: data.signedUrl };
}

export async function removeClientKycAttachment(documentId: string): Promise<AttachResult> {
  if (!isUuid(documentId)) return { ok: false, error: "Invalid id." };
  const g = await guard();
  if ("error" in g) return g.error;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
    columns: { id: true, title: true, storagePath: true, customerMasterId: true, uploadedById: true },
  });
  if (!doc) return { ok: true };
  if (!g.me.isAdmin && doc.uploadedById !== g.me.id) {
    return { ok: false, error: "Only the person who attached this can remove it." };
  }

  if (doc.storagePath) {
    await getSupabaseAdmin()
      .storage.from(DOCUMENTS_BUCKET)
      .remove([doc.storagePath])
      .catch(() => {});
  }
  await db.delete(documents).where(eq(documents.id, documentId));
  await logDocEvent({
    documentId: null,
    documentTitle: doc.title,
    actorId: g.me.id,
    eventType: "deleted",
  });
  revalidateKyc();
  return { ok: true };
}

/* ── Bulk delete from the directory sections ─────────────────────────────── */

const MAX_BULK_DELETE = 200;

/**
 * Delete contact / address / bank child rows by id.
 *
 * One helper for the three because they differ only in the table: the guard,
 * the id validation, the cap and the revalidation are identical, and three
 * copies would drift.
 *
 * These are child rows of a client, not the client itself — deleting every
 * contact leaves the client standing with no contacts, which is exactly what
 * the Draft section is there to flag. Deleting a CLIENT stays where it was,
 * behind Client Master's own row menu.
 */
async function deleteKycChildren(
  table: typeof customerContacts | typeof customerAddresses | typeof customerBankAccounts,
  ids: string[],
  label: string,
): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = [...new Set(ids)].filter(isUuid);
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  // A cap, not a page size: a request asking to delete thousands of rows is a
  // bug or a mistake, and either way is worth refusing rather than obeying.
  if (clean.length > MAX_BULK_DELETE) {
    return { ok: false, error: `Select ${MAX_BULK_DELETE} or fewer at a time.` };
  }

  try {
    await db.delete(table).where(inArray(table.id, clean));
  } catch (err) {
    return { ok: false, error: dbError(err, label) };
  }
  revalidateKyc();
  return { ok: true };
}

export async function deleteClientContacts(ids: string[]): Promise<Result> {
  return deleteKycChildren(customerContacts, ids, "contact");
}

export async function deleteClientAddresses(ids: string[]): Promise<Result> {
  return deleteKycChildren(customerAddresses, ids, "address");
}

export async function deleteClientBankAccounts(ids: string[]): Promise<Result> {
  return deleteKycChildren(customerBankAccounts, ids, "bank account");
}

/* ── Edit one record from the directory sections ─────────────────────────── */

/**
 * Update one contact / address / bank row.
 *
 * These write the same child tables the KYC form creates, and nothing more:
 * a directory edit fixes a typo in a phone number or moves a contact from
 * Purchase to Accounts. It cannot move a record to a different client —
 * `customer_master_id` is never in the payload, so a bad id cannot re-parent
 * someone's contact.
 */
export async function updateClientContact(
  id: string,
  values: unknown,
): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid contact id." };

  const parsed = ClientKycContactSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    const rows = await db
      .update(customerContacts)
      .set({
        contactType: v.contactType,
        firstName: v.firstName,
        lastName: v.lastName,
        contactNo: v.contactNo,
        email: v.email,
        designationId: v.designationId,
        departmentId: v.departmentId,
        notes: v.notes,
      })
      .where(eq(customerContacts.id, id))
      .returning({ id: customerContacts.id });
    if (rows.length === 0) return { ok: false, error: "That contact is no longer there." };
  } catch (err) {
    return { ok: false, error: dbError(err, "contact") };
  }
  revalidateKyc();
  return { ok: true };
}

export async function updateClientAddress(id: string, values: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid address id." };

  const parsed = ClientKycAddressSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    const rows = await db
      .update(customerAddresses)
      .set({
        addressType: v.addressType,
        line1: v.line1,
        line2: v.line2,
        line3: v.line3,
        line4: v.line4,
        city: v.city,
        state: v.state,
        country: v.country,
        pinCode: v.pinCode,
        email: v.email,
      })
      .where(eq(customerAddresses.id, id))
      .returning({ id: customerAddresses.id });
    if (rows.length === 0) return { ok: false, error: "That address is no longer there." };
  } catch (err) {
    return { ok: false, error: dbError(err, "address") };
  }
  revalidateKyc();
  return { ok: true };
}

export async function updateClientBankAccount(id: string, values: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid account id." };

  const parsed = ClientKycBankAccountSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    const [row] = await db
      .update(customerBankAccounts)
      .set({
        accountName: v.accountName,
        bankName: v.bankName,
        accountNo: v.accountNo,
        ifscSwift: v.ifscSwift,
        branch: v.branch,
        accountType: v.accountType,
        isPrimary: v.isPrimary,
      })
      .where(eq(customerBankAccounts.id, id))
      .returning({ id: customerBankAccounts.id, customerMasterId: customerBankAccounts.customerMasterId });
    if (!row) return { ok: false, error: "That account is no longer there." };

    // At most one primary per client — the same rule saveClientKyc enforces on
    // create. Promoting this one has to demote whichever held it before, or
    // the client ends up with two accounts both claiming to be the primary.
    if (v.isPrimary) {
      await db
        .update(customerBankAccounts)
        .set({ isPrimary: false })
        .where(
          and(
            eq(customerBankAccounts.customerMasterId, row.customerMasterId),
            sql`${customerBankAccounts.id} <> ${id}`,
          ),
        );
    }
  } catch (err) {
    return { ok: false, error: dbError(err, "account") };
  }
  revalidateKyc();
  return { ok: true };
}

/* ── Dormant ─────────────────────────────────────────────────────────────── */

/**
 * Park clients as dormant, or bring them back.
 *
 * Dormant is not deleted and not a draft: the record keeps its code, its
 * contacts, its addresses and its bank accounts, and it stops appearing in
 * the Client Master, the Customer Master and the three directories. The
 * Client Master's Status filter set to Dormant is where it can be found and
 * reactivated — see lib/masters/dormancy.ts and the schema comment on
 * `customer_masters.dormant_at`.
 *
 * No completeness or stage check either way. A client is parked because you
 * stopped trading with it, which has nothing to do with whether its KYC is
 * finished, and a dormant client reactivated later is exactly the record it
 * was before.
 */
export async function setClientsDormant(ids: string[]): Promise<DormancyResult> {
  const g = await guard();
  if ("error" in g) return g.error;
  const res = await setCustomerDormancy(ids, true);
  if (res.ok) revalidateKyc();
  return res;
}

export async function reactivateClients(ids: string[]): Promise<DormancyResult> {
  const g = await guard();
  if ("error" in g) return g.error;
  const res = await setCustomerDormancy(ids, false);
  if (res.ok) revalidateKyc();
  return res;
}

/* ── Draft / Recycle Bin, in bulk ────────────────────────────────────────── */

/**
 * Move several drafts to the Recycle Bin at once.
 *
 * Nothing is destroyed — every field survives and Restore brings the record
 * back. That is why this is separate from `deleteMasterCustomer` and why the
 * Draft screen offers it instead of a delete.
 */
export async function recycleClientDrafts(ids: string[]): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = [...new Set(ids)].filter(isUuid);
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  if (clean.length > MAX_BULK_DELETE) {
    return { ok: false, error: `Select ${MAX_BULK_DELETE} or fewer at a time.` };
  }

  try {
    const rows = await db
      .update(customerMasters)
      .set({ kycStage: "recycled", recycledAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(customerMasters.id, clean), eq(customerMasters.kycStage, "draft")))
      .returning({ id: customerMasters.id });
    if (rows.length === 0) return { ok: false, error: "Those drafts are no longer there." };
  } catch (err) {
    return { ok: false, error: dbError(err, "draft") };
  }
  revalidateKyc();
  return { ok: true };
}

/**
 * Pull several records back out of the Recycle Bin.
 *
 * Each returns to the stage it actually belongs in — still-incomplete records
 * go back to Draft with a FRESH clock, complete ones become clients. A single
 * blanket UPDATE would either send finished records back to Draft or promote
 * unfinished ones to the Client Master, so the set is split first and written
 * as at most two statements rather than one per row.
 */
export async function restoreClientsFromRecycleBin(ids: string[]): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = [...new Set(ids)].filter(isUuid);
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  if (clean.length > MAX_BULK_DELETE) {
    return { ok: false, error: `Select ${MAX_BULK_DELETE} or fewer at a time.` };
  }

  try {
    const rows = await db
      .select({
        id: customerMasters.id,
        name: customerMasters.name,
        gstin: customerMasters.gstin,
        panNo: customerMasters.panNo,
        salesRepId: customerMasters.salesRepId,
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
      .where(and(inArray(customerMasters.id, clean), eq(customerMasters.kycStage, "recycled")));

    if (rows.length === 0) return { ok: false, error: "Those records are no longer in the bin." };

    const toDraft: string[] = [];
    const toComplete: string[] = [];
    for (const r of rows) {
      const missing = missingKycFields({
        name: r.name,
        gstin: r.gstin,
        panNo: r.panNo,
        salesRepId: r.salesRepId,
        contacts: r.contactCount > 0 ? [{ firstName: "x", contactNo: "x" }] : [],
        addresses:
          r.billingCount > 0
            ? [{ addressType: "billing", line1: "x", city: "x", pinCode: "x" }]
            : [],
      });
      (missing.length > 0 ? toDraft : toComplete).push(r.id);
    }

    if (toDraft.length > 0) {
      await db
        .update(customerMasters)
        .set({
          kycStage: "draft",
          draftSince: new Date(),
          recycledAt: null,
          updatedAt: new Date(),
        })
        .where(inArray(customerMasters.id, toDraft));
    }
    if (toComplete.length > 0) {
      await db
        .update(customerMasters)
        .set({ kycStage: "complete", draftSince: null, recycledAt: null, updatedAt: new Date() })
        .where(inArray(customerMasters.id, toComplete));
    }
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }
  revalidateKyc();
  return { ok: true };
}

/** Permanently delete records from the Recycle Bin. Cascades to their children. */
export async function deleteClientsPermanently(ids: string[]): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = [...new Set(ids)].filter(isUuid);
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  if (clean.length > MAX_BULK_DELETE) {
    return { ok: false, error: `Select ${MAX_BULK_DELETE} or fewer at a time.` };
  }

  try {
    // Scoped to `recycled` on purpose: permanent deletion is reachable only
    // from the bin, so a live client can never be destroyed by a stale id.
    await db
      .delete(customerMasters)
      .where(and(inArray(customerMasters.id, clean), eq(customerMasters.kycStage, "recycled")));
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }
  revalidateKyc();
  return { ok: true };
}

/**
 * Onboard drafts — move finished records out of Draft and into the Client
 * Master, which is the section that owns them from then on.
 *
 * Completeness is recomputed here rather than trusted from the list the user
 * was looking at. That list is a snapshot; the record may have been edited in
 * another tab since, and "Onboard" is precisely the action that must not let
 * a half-filled client through. Same `missingKycFields` rule the save path
 * and the Draft list use, so all three agree on what "finished" means.
 *
 * Partial success is reported, not hidden: onboarding four of six selected
 * rows and saying "6 onboarded" would be a lie the user only discovers when
 * two of them are still sitting in Draft.
 */
export async function onboardClientDrafts(
  ids: string[],
): Promise<Result & { onboarded?: number; blocked?: { name: string; missing: string[] }[] }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = [...new Set(ids)].filter(isUuid);
  if (clean.length === 0) return { ok: false, error: "Nothing selected." };
  if (clean.length > MAX_BULK_DELETE) {
    return { ok: false, error: `Select ${MAX_BULK_DELETE} or fewer at a time.` };
  }

  try {
    const rows = await db
      .select({
        id: customerMasters.id,
        name: customerMasters.name,
        gstin: customerMasters.gstin,
        panNo: customerMasters.panNo,
        salesRepId: customerMasters.salesRepId,
        // The same two child questions listByStage asks, kept as counts so
        // this stays one round trip regardless of how many rows are selected.
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
      .where(and(inArray(customerMasters.id, clean), eq(customerMasters.kycStage, "draft")));

    if (rows.length === 0) return { ok: false, error: "Those records are no longer drafts." };

    const ready: string[] = [];
    const blocked: { name: string; missing: string[] }[] = [];
    for (const r of rows) {
      const missing = missingKycFields({
        name: r.name,
        gstin: r.gstin,
        panNo: r.panNo,
        salesRepId: r.salesRepId,
        contacts: r.contactCount > 0 ? [{ firstName: "x", contactNo: "x" }] : [],
        addresses:
          r.billingCount > 0
            ? [{ addressType: "billing", line1: "x", city: "x", pinCode: "x" }]
            : [],
      });
      if (missing.length === 0) ready.push(r.id);
      else blocked.push({ name: r.name, missing });
    }

    if (ready.length > 0) {
      await db
        .update(customerMasters)
        .set({
          kycStage: "complete",
          // The clock stops with the draft. Leaving `draftSince` set would
          // hand the nightly sweep a live client to reconsider.
          draftSince: null,
          recycledAt: null,
          updatedAt: new Date(),
        })
        .where(and(inArray(customerMasters.id, ready), eq(customerMasters.kycStage, "draft")));
    }

    revalidateKyc();
    return { ok: true, onboarded: ready.length, blocked };
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }
}

/**
 * Save to Draft — the explicit action, and the only thing that creates a draft.
 *
 * Nothing writes a draft on the user's behalf. Half-typed text lives in the
 * browser (lib/masters/client-kyc-draft.ts) until someone presses this
 * button; a Draft list that fills itself with records nobody chose to save is
 * worse than useless, because it stops being a list of things to finish.
 *
 * Three rules:
 *
 *   1. Company Name is the only requirement — the same single `*` the form
 *      shows. A draft is by definition unfinished, so demanding anything more
 *      would defeat the point. `ClientKycSchema` already enforces exactly
 *      this, and an empty form comes back as a quiet no-op rather than an
 *      error to read.
 *   2. The row is reused. A draft opened by Restore sends its id back, so
 *      saving it again updates that record instead of leaving a trail of
 *      near-identical copies.
 *   3. The stage is always `draft`, never `complete`. Even a record that
 *      satisfies every requirement waits for a deliberate Onboarding — this
 *      button must never onboard a client on the user's behalf.
 */
export async function saveClientKycDraft(
  input: unknown,
): Promise<Result & { draftId?: string; skipped?: boolean }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const parsed = ClientKycSchema.safeParse(input);
  // Nothing worth keeping yet (almost always: no Company Name). Reported as
  // success-with-skipped so a background autosave never surfaces a toast for
  // what is simply an empty form.
  if (!parsed.success) return { ok: true, skipped: true };
  const v = parsed.data;
  const creditLimit = v.creditLimit === null ? null : String(v.creditLimit);

  try {
    const draftId = await db.transaction(async (tx) => {
      const shared = kycColumnValues(v, creditLimit);
      let id: string;

      if (v.id) {
        const [row] = await tx
          .update(customerMasters)
          .set({
            ...shared,
            kycStage: "draft",
            // Saving restarts the 7-day clock: someone pressing this button is
            // the clearest evidence the record is still being worked on, which
            // is the distinction migration 0096 kept this column separate from
            // `updated_at` to express.
            draftSince: new Date(),
            recycledAt: null,
            // The form is handing the record back and clearing itself, so the
            // checkout ends here and the draft returns to the Draft list.
            editingSince: null,
            updatedAt: new Date(),
          })
          .where(and(eq(customerMasters.id, v.id), eq(customerMasters.kycStage, "draft")))
          .returning({ id: customerMasters.id });
        // The row was finished, recycled or deleted elsewhere while this form
        // sat open. Start a fresh draft rather than resurrecting it — the
        // user is still typing, and losing their work to a stale id would be
        // the exact failure this function exists to prevent.
        if (row) {
          id = row.id;
        } else {
          const [code] = await nextCustomerCodes(1);
          const [fresh] = await tx
            .insert(customerMasters)
            .values({ ...shared, code, kycStage: "draft", draftSince: new Date(), createdById: g.me.id })
            .returning({ id: customerMasters.id });
          id = fresh!.id;
        }
      } else {
        const [code] = await nextCustomerCodes(1);
        const [row] = await tx
          .insert(customerMasters)
          .values({ ...shared, code, kycStage: "draft", draftSince: new Date(), createdById: g.me.id })
          .returning({ id: customerMasters.id });
        id = row!.id;
      }

      await replaceKycChildren(tx, id, v);
      return id;
    });

    // Only the Draft list is revalidated. `revalidateKyc()` busts seven paths
    // including the form itself, which on a keystroke-driven autosave would
    // mean re-rendering the page the user is typing into.
    revalidatePath("/forms/client-kyc/drafts");
    return { ok: true, draftId };
  } catch (err) {
    return { ok: false, error: dbError(err, "customer code") };
  }
}

/**
 * Check one draft out of the Draft list and into the KYC form.
 *
 * What Restore calls before it opens the form. The row stays exactly where it
 * is — same stage, same code, same children — it is only marked as open on
 * someone's screen, which is what takes it out of the Draft list. Being in
 * the list and in the form at once made one record look like two, and invited
 * two people to finish it in parallel.
 *
 * Nothing here can lose the record: the mark is a timestamp, and
 * `releaseStaleCheckouts` puts back anything left open for more than
 * CHECKOUT_EXPIRY_MINUTES. Failing to check out is likewise not fatal — the
 * caller opens the form regardless, so the worst case is a draft that shows
 * in both places, never one that shows in neither.
 */
export async function checkOutClientDraft(id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Not a valid draft." };

  try {
    const [row] = await db
      .update(customerMasters)
      .set({ editingSince: new Date(), updatedAt: new Date() })
      .where(and(eq(customerMasters.id, id), eq(customerMasters.kycStage, "draft")))
      .returning({ id: customerMasters.id });
    if (!row) return { ok: false, error: "That record is no longer a draft." };
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }
  revalidatePath("/forms/client-kyc/drafts");
  return { ok: true };
}

/**
 * Put a checked-out draft back in the Draft list without going through a save.
 *
 * The escape hatch for "I opened this by mistake". A plain Save already
 * releases the checkout, so this exists only for leaving the form alone.
 */
export async function releaseClientDraft(id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Not a valid draft." };

  try {
    await db
      .update(customerMasters)
      .set({ editingSince: null, updatedAt: new Date() })
      .where(and(eq(customerMasters.id, id), eq(customerMasters.kycStage, "draft")));
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }
  revalidatePath("/forms/client-kyc/drafts");
  return { ok: true };
}

/**
 * Edit one onboarded client, in place, from the Client Master.
 *
 * The Client Master used to send Edit to /masters/customers, which is a
 * different screen over the same table showing a different subset of it — so
 * fixing a KYC field meant leaving the section you were in and finding a form
 * that did not have that field. Every other Client KYC directory edits its
 * own records where they sit; this makes the Client Master do the same.
 *
 * Scoped to kyc_stage = 'complete'. Drafts are edited by restoring them into
 * the KYC form, which is the screen that can complete them; letting this
 * dialog write to a draft would be a second, partial way to finish one.
 */
export async function updateClientMasterRecord(id: string, input: unknown): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };

  const parsed = ClientMasterEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
  const v = parsed.data;

  try {
    const [row] = await db
      .update(customerMasters)
      .set({
        name: v.name,
        gstin: v.gstin,
        referenceBy: v.reference,
        salesRepId: v.salesRepId,
        // The form's "Grade" is this column under another name — see the
        // schema comment on ClientKycSchema.grade.
        volumeClass: v.grade,
        customerTypes: v.customerTypes,
        industryTypes: v.industryTypes,
        tags: v.tags,
        panNo: v.panNo,
        msmeUdyamNo: v.msmeUdyamNo,
        gstRegistrationType: v.gstRegistrationType,
        state: v.state,
        tinNumber: v.tinNumber,
        testCertificateNeeded: v.testCertificateNeeded,
        website: v.website,
        tcsApplicable: v.tcsApplicable,
        city: v.city,
        paymentTerms: v.paymentTerms,
        freightCharges: v.freightCharges,
        creditPeriodDays: v.creditDays,
        creditLimit: v.creditLimit === null ? null : String(v.creditLimit),
        transporter: v.transporter,
        quantityDeviation: v.quantityDeviation,
        otherReferences: v.otherReferences,
        notes: v.notes,
        exportClient: v.exportClient,
        iecNumber: v.iecNumber,
        currency: v.currency,
        country: v.country,
        isActive: v.isActive,
        focusedView: v.focusedView,
        updatedAt: new Date(),
      })
      .where(and(eq(customerMasters.id, id), eq(customerMasters.kycStage, "complete")))
      .returning({ id: customerMasters.id });
    if (!row) return { ok: false, error: "That client is no longer in the Client Master." };
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }
  revalidateKyc();
  return { ok: true, id };
}

/**
 * Verify one GSTIN against the GST registry, for the KYC form's Verify button.
 *
 * The credentials live in the server environment and the lookup runs here, so
 * nothing about Sandbox — key, secret or token — is reachable from the
 * browser. Only the handful of fields the form actually fills come back; the
 * raw upstream response is not forwarded.
 *
 * Shape is checked before the network is touched, so a half-typed number costs
 * nothing and cannot burn quota.
 */
export async function verifyGstin(
  gstin: string,
): Promise<{ ok: true; data: GstinDetails } | { ok: false; error: string }> {
  const g = await guard();
  if ("error" in g) return g.error;

  const clean = typeof gstin === "string" ? gstin.trim().toUpperCase() : "";
  if (!isPlausibleGstin(clean)) return { ok: false, error: "Enter a valid GSTIN." };

  const res = await lookupGstin(clean);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data };
}

/* ── Bulk import from the Client Master sheet ────────────────────────────── */

/** One row the import could not take, by its number in the sheet. */
export interface BulkImportRowError {
  /** 1-based, matching the row number shown in the sheet. */
  row: number;
  message: string;
}

export type BulkImportClientsResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Rows that became a Client Master record. */
      created: number;
      rowErrors: BulkImportRowError[];
    };

/** The sheet sends at most this many rows in one go. */
const BULK_IMPORT_MAX_ROWS = 500;

const keyOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Create many clients from the Client Master bulk-import sheet.
 *
 * Rows land in the Client Master, not in Drafts.
 *
 * That is a deliberate departure from `saveClientKyc`, which sends anything
 * short of `missingKycFields` to Drafts. The sheet can now carry a contact
 * and a billing address, so the rule could be run — but it still is not, and
 * on purpose: a hundred-row list of companies with nothing but names and GST
 * numbers is a perfectly ordinary thing to import, and judging it would send
 * the lot to Drafts and leave the Client Master empty, which is the opposite
 * of what importing into it means. Fill the contact and address blocks and
 * the record is complete anyway; leave them blank and you get the client you
 * asked for. A client onboarded one at a time still goes through the form and
 * still gets judged by it.
 *
 * A row with a real problem (no name, a salesperson nobody is called, a
 * company already on record) is skipped and returned by row number. The good
 * rows still import: a hundred-row paste with two typos in it should cost two
 * corrections, not the whole paste.
 *
 * One transaction for the whole batch. A half-written import is worse than a
 * failed one — you cannot tell which half by looking.
 */
export async function bulkImportClients(input: unknown): Promise<BulkImportClientsResult> {
  const g = await guard();
  if ("error" in g) return g.error;

  const raw = (input as { rows?: unknown })?.rows;
  if (!Array.isArray(raw)) return { ok: false, error: "Nothing to import." };
  if (raw.length > BULK_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `That is ${raw.length} rows — import up to ${BULK_IMPORT_MAX_ROWS} at a time.`,
    };
  }

  // Keep each row's sheet number: every message below is only useful if it
  // names the row the user is looking at, not its position after filtering.
  const numbered = raw
    .map((r, i) => ({ row: i + 1, values: (r ?? {}) as SheetRow }))
    .filter((r) => typeof r.values === "object" && !isBlankRow(r.values));
  if (numbered.length === 0) return { ok: false, error: "Every row is blank." };

  const ctx = await listClientBulkOptions();
  const rowErrors: BulkImportRowError[] = [];

  /* Cell rules first — the same ones the sheet flags with, re-run here. */
  const cellChecked = numbered.filter(({ row, values }) => {
    for (const [key, value] of Object.entries(values)) {
      const column = COLUMN_BY_KEY.get(key);
      if (!column) continue;
      const problem = validateCell(column, value ?? "", ctx.options);
      if (problem) {
        rowErrors.push({ row, message: problem });
        return false;
      }
    }
    if (!(values.name ?? "").trim()) {
      rowErrors.push({ row, message: "Company is required." });
      return false;
    }
    return true;
  });

  /*
   * Duplicates — against the batch itself and against what is already saved.
   *
   * Every complete name, not a filtered `in (...)`: the match ignores case
   * AND punctuation (`keyOf`), which SQL cannot express against an index, so
   * a narrowed query would miss exactly the near-duplicates this is for —
   * "ABC Engineering Pvt. Ltd." against "ABC Engineering Pvt Ltd". One text
   * column across the master is a cheap read next to the import itself.
   */
  const existing = await db
    .select({ name: customerMasters.name })
    .from(customerMasters)
    .where(eq(customerMasters.kycStage, "complete"));
  const taken = new Set(existing.map((r) => keyOf(r.name)));
  const seen = new Set<string>();

  const parsed: { row: number; values: KycValues; flags: SheetRow }[] = [];
  for (const { row, values } of cellChecked) {
    const name = (values.name ?? "").trim();
    const k = keyOf(name);
    if (taken.has(k)) {
      rowErrors.push({ row, message: `${name} is already in the Client Master.` });
      continue;
    }
    if (seen.has(k)) {
      rowErrors.push({ row, message: `${name} appears more than once in this sheet.` });
      continue;
    }

    const result = ClientKycSchema.safeParse(rowToKycInput(values, ctx));
    if (!result.success) {
      rowErrors.push({ row, message: zodError(result.error) });
      continue;
    }
    seen.add(k);
    parsed.push({ row, values: result.data, flags: values });
  }

  if (parsed.length === 0) return { ok: true, created: 0, rowErrors };

  try {
    const codes = await nextCustomerCodes(parsed.length);
    await db.transaction(async (tx) => {
      for (let i = 0; i < parsed.length; i++) {
        const { values: v, flags } = parsed[i]!;

        const [inserted] = await tx
          .insert(customerMasters)
          .values({
            ...kycColumnValues(v, v.creditLimit === null ? null : String(v.creditLimit)),
            code: codes[i],
            kycStage: "complete",
            // The record's own two flags, which the form does not collect but
            // the Client Master shows and this sheet therefore offers. Both
            // columns are NOT NULL, so a blank cell has to mean something:
            // Focused View off, and Active — the state a brand-new client is
            // in unless the sheet explicitly says otherwise.
            focusedView: keyOf(flags.focusedView ?? "") === "yes",
            isActive: keyOf(flags.isActive ?? "") !== "inactive",
            createdById: g.me.id,
          })
          .returning({ id: customerMasters.id });

        await replaceKycChildren(tx, inserted!.id, v);
      }
    });
  } catch (err) {
    return { ok: false, error: dbError(err, "client") };
  }

  revalidateKyc();
  return { ok: true, created: parsed.length, rowErrors };
}

