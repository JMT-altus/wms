/**
 * What makes a Client KYC record "filled in".
 *
 * The form itself only hard-requires Company Name, so almost anything can be
 * submitted. That is deliberate — an onboarding form that refuses to save
 * until every box is answered just gets abandoned. The cost of that leniency
 * is half-finished clients sitting in the Client Master looking complete, and
 * the Draft section is what fixes it: a record that misses anything below is
 * a draft, not a client, until someone finishes it.
 *
 * The list is here, in one dependency-free module, precisely so it is easy to
 * find and change. Server and client both read it: the save path uses it to
 * decide where a record lands, and the Draft page uses it to tell the user
 * exactly which boxes are still empty rather than saying "incomplete".
 *
 * Chosen as the set a client record is genuinely unusable without — you
 * cannot raise an invoice, ship anything, or call anyone without them:
 *
 *   Company Name          who they are (already required by the form)
 *   GSTIN or PAN          tax identity; either satisfies this, since an
 *                         unregistered client legitimately has no GSTIN
 *   Sales Co-ordinator    who owns the relationship
 *   A contact person      someone to actually reach, with a name and at
 *                         least one of phone or email
 *   A billing address     where the invoice goes: street, city and pin
 *
 * Everything else on the form - grade, tags, bank details, credit terms,
 * industry - is genuinely optional, and demanding it would push ordinary
 * clients into Draft for no reason.
 */

/** The subset of a KYC record this rule looks at. Structural, not Zod. */
export interface KycCompletenessInput {
  name?: string | null;
  gstin?: string | null;
  panNo?: string | null;
  salesRepId?: string | null;
  contacts?: ReadonlyArray<{
    firstName?: string | null;
    lastName?: string | null;
    contactNo?: string | null;
    email?: string | null;
  }>;
  addresses?: ReadonlyArray<{
    addressType?: string | null;
    line1?: string | null;
    city?: string | null;
    pinCode?: string | null;
  }>;
}

const has = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";

/**
 * Every requirement this record fails, as the labels the form uses.
 *
 * An empty array means the record is complete. The order matches the form's
 * own top-to-bottom order so the Draft page's "still needs" list reads as a
 * route through the form rather than an unordered pile.
 */
export function missingKycFields(input: KycCompletenessInput): string[] {
  const missing: string[] = [];

  if (!has(input.name)) missing.push("Company Name");

  // Either identifier satisfies this. A client that is not GST-registered has
  // no GSTIN to give, and holding their record in Draft forever over a number
  // that does not exist would be a bug, not a standard.
  if (!has(input.gstin) && !has(input.panNo)) missing.push("GSTIN or PAN");

  if (!has(input.salesRepId)) missing.push("Sales Co-ordinator");

  const contact = (input.contacts ?? []).find(
    (c) => (has(c.firstName) || has(c.lastName)) && (has(c.contactNo) || has(c.email)),
  );
  if (!contact) missing.push("A contact person with a phone or email");

  const billing = (input.addresses ?? []).find(
    (a) => a.addressType === "billing" && has(a.line1) && has(a.city) && has(a.pinCode),
  );
  if (!billing) missing.push("A billing address with street, city and pin code");

  return missing;
}

/**
 * How far through the requirements a record is, 0-100.
 *
 * Deliberately measured against the five things in `missingKycFields` rather
 * than against every box on the form. The form has well over a hundred
 * fields, almost all optional, so a percentage of those would read as 8% for
 * a record that is ready to onboard — useless for deciding what to pick up
 * next, which is the only reason the Draft list shows a number at all.
 */
export const KYC_REQUIREMENT_COUNT = 5;

export function kycCompletionPercent(missing: readonly string[]): number {
  const met = Math.max(0, KYC_REQUIREMENT_COUNT - missing.length);
  return Math.round((met / KYC_REQUIREMENT_COUNT) * 100);
}

export function isKycComplete(input: KycCompletenessInput): boolean {
  return missingKycFields(input).length === 0;
}

/** How long a draft sits before it is swept into the Recycle Bin. */
export const DRAFT_EXPIRY_DAYS = 7;

/**
 * How long a draft may stay checked out into the KYC form before the sweep
 * puts it back in the Draft list.
 *
 * Restore hides the row from Draft so it is not in two places at once, which
 * means an abandoned checkout — the browser closed with the form open — would
 * be invisible until this expires. An hour is long enough to fill in a KYC
 * without the row reappearing underneath you, and short enough that nobody
 * is left wondering where their draft went.
 *
 * Nothing is deleted either way: this only ever moves a row back into a list.
 */
export const CHECKOUT_EXPIRY_MINUTES = 60;

/**
 * Whole days left before this draft is recycled, floored at 0.
 *
 * Floors rather than rounds so "1 day left" never shows on something that is
 * hours from being swept.
 */
export function draftDaysLeft(draftSince: Date | string, now: Date = new Date()): number {
  const since = typeof draftSince === "string" ? new Date(draftSince) : draftSince;
  const elapsedMs = now.getTime() - since.getTime();
  const leftMs = DRAFT_EXPIRY_DAYS * 24 * 60 * 60 * 1000 - elapsedMs;
  return Math.max(0, Math.floor(leftMs / (24 * 60 * 60 * 1000)));
}
