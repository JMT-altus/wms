import { COLLECTION_RULES, type CollectionRules } from "../config";

/**
 * How Collection Master values are cleaned and compared. Pure.
 *
 *   displayName   what is stored and shown: trimmed, inner spaces collapsed,
 *                 spelling and case otherwise kept exactly as the file has it.
 *   nameKey       the company's identity: lower-case letters and digits only.
 *                 "ABC Engg. Pvt Ltd" and "abc engg pvt ltd" are one company.
 *                 Unique in the table, so two spellings can never become two
 *                 companies.
 *   exactNameKey  the stricter key used to link to the Client Master: case and
 *                 spacing ignored, punctuation kept. Only an exact match on this
 *                 key, with exactly one Client Master record, creates a link.
 */

const MAX_TEXT = 200;

export const cleanText = (v: unknown): string => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

export const displayName = (v: unknown): string => cleanText(v);

export const nameKey = (v: unknown): string => cleanText(v).toLowerCase().replace(/[^a-z0-9]/g, "");

export const exactNameKey = (v: unknown): string => cleanText(v).toLowerCase();

/** True when the cell means "nobody assigned": empty, or one of the configured placeholders. */
export function isUnassignedCoordinator(v: unknown, rules: CollectionRules = COLLECTION_RULES): boolean {
  const s = cleanText(v).toLowerCase();
  return s === "" || rules.unassignedCoordinatorValues.some((p) => p.trim().toLowerCase() === s);
}

/** The coordinator label to store: as written (cleaned), or null when unassigned. Never mapped to an employee. */
export function coordinatorLabel(v: unknown, rules: CollectionRules = COLLECTION_RULES): string | null {
  return isUnassignedCoordinator(v, rules) ? null : cleanText(v);
}

/** Payment terms as written (cleaned), or null for a blank cell — never inferred. */
export function paymentTermsText(v: unknown): string | null {
  const s = cleanText(v);
  return s === "" ? null : s;
}

/** Same value for change detection: case and spacing ignored; null equals null only. */
export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a == null ? null : cleanText(a).toLowerCase();
  const y = b == null ? null : cleanText(b).toLowerCase();
  return x === y;
}

export const TEXT_LIMIT = MAX_TEXT;
