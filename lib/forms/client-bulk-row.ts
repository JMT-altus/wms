/**
 * One sheet row → the payload `ClientKycSchema` already validates.
 *
 * Its own module rather than a private function inside the server action for
 * one reason: this is where the sheet's flat grid becomes a client with three
 * directories hanging off it, and that is the part of the import worth
 * pinning down in a test. The action it was lifted out of is `"use server"`
 * and pulls in the database, Supabase and Firebase; nothing in here does, so
 * a test can ask "what does this row actually create" directly.
 *
 * Building the KYC form's own payload, rather than a shape of this file's
 * own, is what lets the import reuse `kycColumnValues` and
 * `replaceKycChildren` instead of growing a second, drifting write path into
 * `customer_masters` and its three child tables. It is also what makes the
 * Contact, Address and Bank Details columns work at all: each block on the
 * row becomes one entry in the array the form would have posted, so a
 * bulk-imported contact is written by the same code, in the same order, with
 * the same primary rule as one typed into the form.
 */

import { VOLUME_CLASSES } from "@/db/enums";
import type { ClientBulkRosters } from "@/lib/queries/client-bulk-options";
import {
  ADDRESS_BLOCK,
  BANK_BLOCK,
  COLUMN_BY_KEY,
  CONTACT_BLOCK,
  blockValues,
  matchOption,
  resolveAddressType,
  resolveContactType,
  splitMulti,
  type SheetRow,
} from "./client-bulk-columns";

/** Normalised the same way `matchOption` compares — case and punctuation blind. */
const keyOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function rowToKycInput(row: SheetRow, ctx: ClientBulkRosters): Record<string, unknown> {
  const cell = (k: string): string => (row[k] ?? "").trim();
  const orNull = (k: string): string | null => cell(k) || null;

  const multi = (k: string): string[] => {
    const column = COLUMN_BY_KEY.get(k);
    const parts = splitMulti(cell(k));
    if (!column?.optionKey) return parts;
    const list = ctx.options[column.optionKey] ?? [];
    // Store the master's own spelling, not the typist's — see `matchOption`.
    return parts.map((p) => matchOption(p, list) ?? p);
  };

  /** A free-text cell backed by a suggestion list, in the list's spelling. */
  const suggested = (value: string, list: readonly string[]): string | null =>
    matchOption(value, list) ?? value ?? null;

  const productIds = splitMulti(cell("products"))
    .map((p) => ctx.productsByName.get(keyOf(p)))
    .filter((id): id is string => Boolean(id));

  /*
   * The three directories, one block each.
   *
   * An empty block contributes nothing — `blockValues` returns null — so a
   * client with only a contact gets one contact row and no address, and a
   * sheet that never showed the block's columns creates nothing at all. That
   * is what lets the same code import a bare list of company names and a
   * fully filled workbook.
   */
  const contact = blockValues(row, CONTACT_BLOCK);
  const address = blockValues(row, ADDRESS_BLOCK);
  const bank = blockValues(row, BANK_BLOCK);

  return {
    name: cell("name"),
    salesRepId: ctx.salesByName.get(keyOf(cell("salesRep"))) ?? null,
    customerTypes: multi("customerTypes"),
    industryTypes: multi("industryTypes"),
    tags: multi("tags"),
    gstin: orNull("gstin"),
    state: orNull("state"),
    website: orNull("website"),
    // `matchOption`, not a hardcoded A/B/C: it is the same case- and
    // punctuation-blind match the sheet flagged the cell with, and it hands
    // back the enum's own spelling rather than the typist's.
    grade: matchOption(cell("grade"), VOLUME_CLASSES),
    exportClient: orNull("exportClient"),
    reference: orNull("reference"),

    gstRegistrationType: orNull("gstRegistrationType"),
    panNo: orNull("panNo"),
    tinNumber: orNull("tinNumber"),
    msmeUdyamNo: orNull("msmeUdyamNo"),
    iecNumber: orNull("iecNumber"),
    currency: orNull("currency"),
    country: orNull("country"),
    testCertificateNeeded: orNull("testCertificateNeeded"),
    tcsApplicable: orNull("tcsApplicable"),

    contacts: contact
      ? [
          {
            // Blank reads as `other` — see `resolveContactType`.
            contactType: resolveContactType(contact.contactType ?? ""),
            firstName: contact.firstName || null,
            lastName: contact.lastName || null,
            contactNo: contact.contactNo || null,
            email: contact.email || null,
            // These two arrive as names and have to resolve to a row. An
            // unmatched name was already flagged as a cell error upstream, so
            // the null here is only reached when the cell was left blank.
            designationId: ctx.designationsByName.get(keyOf(contact.designationId ?? "")) ?? null,
            departmentId: ctx.departmentsByName.get(keyOf(contact.departmentId ?? "")) ?? null,
            notes: contact.notes || null,
          },
        ]
      : [],

    addresses: address
      ? [
          {
            // Blank reads as `billing` — the column is NOT NULL, and billing
            // is what an unqualified address means. See `resolveAddressType`.
            addressType: resolveAddressType(address.addressType ?? ""),
            // The sheet's one Street Address column. line2–line4 stay null;
            // the Address Book's own drawer is where a four-line address gets
            // split out, and nobody fills "Address Line 3" in a spreadsheet.
            line1: address.line1 || null,
            line2: null,
            line3: null,
            line4: null,
            city: address.city || null,
            state: suggested(address.state ?? "", ctx.options.states),
            country: suggested(address.country ?? "", ctx.options.countries),
            pinCode: address.pinCode || null,
            email: address.email || null,
          },
        ]
      : [],

    bankAccounts: bank
      ? [
          {
            accountName: bank.accountName || null,
            bankName: bank.bankName || null,
            accountNo: bank.accountNo || null,
            ifscSwift: bank.ifscSwift || null,
            branch: bank.branch || null,
            accountType: bank.accountType || null,
            // The sheet carries one account, so it is the one you pay against.
            isPrimary: true,
          },
        ]
      : [],

    creditLimit: cell("creditLimit").replace(/,/g, ""),
    creditDays: cell("creditDays").replace(/,/g, ""),
    paymentTerms: orNull("paymentTerms"),
    freightCharges: orNull("freightCharges"),
    transporter: orNull("transporter"),
    quantityDeviation: orNull("quantityDeviation"),
    productIds,

    otherReferences: orNull("otherReferences"),
    notes: orNull("notes"),
  };
}
