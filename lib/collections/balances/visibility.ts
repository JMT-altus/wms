/**
 * How the Collection Tracker treats empty-balance companies, from the confirmed
 * balance uploads (Bulk Upload snapshots). Pure — no database, safe anywhere.
 *
 * A company is "empty-balance" when the confirmed uploads give it NO amount on
 * either side: its MOST RECENT confirmed line — the latest snapshot's where it
 * has one, else the newest earlier snapshot's — has Debit and Credit both zero,
 * OR it has no line in any confirmed upload at all (a Tally customer summary
 * leaves out ledgers with nothing outstanding, so "never in a file" is the
 * common case; the Tracker shows it as — / —). Such a company is NOT removed
 * from the Tracker: it stays in the list, after every other company (within
 * whatever sort is chosen), with a muted row, so it is still searchable,
 * openable and editable. A company a later file leaves out keeps the state its
 * last confirmed line gave it; only an upload that includes the company can
 * change it. Nothing is deleted or changed: the Collection Master record, its
 * coordinator, follow-ups, comments, commitments, confirmations and
 * escalations all stay exactly as they are, and the row returns to the normal
 * list the moment a confirmed upload gives it a Debit or a Credit — automatically.
 *
 * The one thing that is never read as "empty": an UNAVAILABLE source. While no
 * upload has been confirmed, or the balance tables can't be read, every
 * company has — / — for a different reason, and none is muted.
 *
 *   - 0, 0.00 and -0.00 are zero; the comparison is in whole paise, so no
 *     binary floating-point noise can make a zero look non-zero.
 *   - A blank cell on one side of a line that is otherwise zero counts as zero
 *     on that side: the balance plan already sums a blank as 0, and a row with
 *     BOTH cells blank is rejected by the plan, so it never becomes a line.
 *   - With a confirmed upload in place, a company with NO line in any snapshot
 *     has no amount on either side and is empty-balance, like a ₹0 / ₹0 line.
 *   - With NO confirmed upload at all, or balances that could not be read,
 *     nobody is empty-balance: an unavailable source is not a zero.
 *   - Previews, refused uploads and failed transactions write no snapshot, so
 *     they can't change anyone's state.
 */

/** One company's line in the active snapshot, as the loader holds it. null = blank in the file. */
export interface BalanceLine {
  debit: number | null;
  credit: number | null;
}

/** Zero at paise precision: 0, 0.00, -0.00 and anything that rounds to ₹0.00. A blank (null) is zero on that side. */
export function isZeroAmount(amount: number | null): boolean {
  if (amount === null) return true;
  if (!Number.isFinite(amount)) return false;
  return Math.round(Math.abs(amount) * 100) === 0;
}

/**
 * True when the company has a confirmed line (its most recent) and both its
 * Debit and Credit are zero. `undefined` (no line) is never zero-balance.
 */
export function isZeroBalanceLine(line: BalanceLine | undefined): boolean {
  if (!line) return false;
  return isZeroAmount(line.debit) && isZeroAmount(line.credit);
}

/**
 * Whether the confirmed uploads leave a company with no amount on either side.
 * `sourceReady` is "a confirmed upload exists and its balances were read": while
 * it is false, nothing is empty-balance. With it true, no line at all counts the
 * same as a ₹0 / ₹0 line; any non-zero amount on either side (negative included)
 * is a real balance.
 */
export function isEmptyBalance(line: BalanceLine | undefined, sourceReady: boolean): boolean {
  if (!sourceReady) return false;
  if (!line) return true;
  return isZeroAmount(line.debit) && isZeroAmount(line.credit);
}

/**
 * The Tracker's order: every company with a balance first, then the
 * empty-balance ones — each group in the order given (so a chosen sort still
 * applies within the group). Stable; nothing is dropped. Applied AFTER
 * filtering and sorting and BEFORE paging, so a page never shows an
 * empty-balance company above a normal one.
 */
export function orderZeroBalanceLast<T extends { zeroBalance?: boolean }>(rows: readonly T[]): T[] {
  const normal: T[] = [];
  const zero: T[] = [];
  for (const r of rows) (r.zeroBalance ? zero : normal).push(r);
  return [...normal, ...zero];
}

/** The Tracker's note when some companies are empty-balance (none when none are). */
export function zeroBalanceNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "company" : "companies"} with no Debit or Credit in the confirmed uploads ${count === 1 ? "is" : "are"} shown last, muted. ${count === 1 ? "It stays" : "They stay"} in the Collection Master with everything recorded, and ${count === 1 ? "returns" : "return"} to the list when an upload gives ${count === 1 ? "it" : "them"} a balance.`;
}
