"use client";

/**
 * The *current* Create New Client KYC form — the work in progress.
 *
 * Deliberately one of two separate things, and the distinction matters:
 *
 *   current form   what is on screen right now, saved or not. Lives here, in
 *                  the browser, so a refresh or a wander into another section
 *                  cannot lose it. Never a Draft — nobody has asked for it to
 *                  be one, and turning half-typed text into a listed record
 *                  would fill the Draft section with things the user never
 *                  saved.
 *   saved drafts   rows in `customer_masters` with kyc_stage = 'draft',
 *                  created only when Save to Draft is pressed. They belong to
 *                  the database, show in the Draft list, and outlive the
 *                  browser entirely.
 *
 * `draftId` is what links the two: when the current form came from Restore,
 * it remembers which draft it is editing, so pressing Save to Draft updates
 * that record rather than making a second one.
 *
 * The key name predates this split and is kept as-is on purpose — changing it
 * would orphan whatever unsaved work is sitting in people's browsers right
 * now, which is exactly the loss this module exists to prevent.
 */
const CURRENT_FORM_KEY = "jmt-client-kyc-draft-v1";

export interface ClientKycCurrentForm<T> {
  savedAt: string;
  values: T;
  /**
   * The saved draft this form is editing, when it came from Restore.
   *
   * Also what makes the stored copy safe to read back while finishing a
   * restored draft: without it there is no way to tell "the unsaved tail of
   * the draft I am editing" from "a different, half-typed new client", and
   * reading it back would paste one over the other.
   */
  draftId?: string | null;
}

export function saveCurrentForm<T>(values: T, draftId?: string | null): void {
  try {
    const payload: ClientKycCurrentForm<T> = {
      savedAt: new Date().toISOString(),
      values,
      draftId: draftId ?? null,
    };
    window.localStorage.setItem(CURRENT_FORM_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable (private mode, quota) — recovery is a
    // convenience, never a requirement to keep using the form.
  }
}

export function readCurrentForm<T>(): ClientKycCurrentForm<T> | null {
  try {
    const raw = window.localStorage.getItem(CURRENT_FORM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientKycCurrentForm<T>;
    if (!parsed || typeof parsed.savedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Forget the in-progress form.
 *
 * Only ever the current form. Saved drafts are database rows and are not
 * touched here — "Start fresh instead" clears the screen, it does not throw
 * away anything the user deliberately saved.
 */
export function clearCurrentForm(): void {
  try {
    window.localStorage.removeItem(CURRENT_FORM_KEY);
  } catch {
    // Nothing to do — worst case the stale copy resurfaces once more.
  }
}
