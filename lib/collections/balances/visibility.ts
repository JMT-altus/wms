/**
 * Which companies the Collection Tracker lists, from the ACTIVE (latest
 * confirmed) balance snapshot. Pure — no database, safe anywhere.
 *
 * A company is hidden from the default Tracker list only when the active
 * snapshot has a line for it and that line's Debit and Credit are both zero.
 * Nothing is deleted or changed: the Collection Master record, its
 * coordinator, follow-ups, comments, commitments, confirmations and
 * escalations all stay exactly as they are, and the company is listed again
 * the moment a confirmed upload gives it a non-zero Debit or Credit.
 *
 *   - 0, 0.00 and -0.00 are zero; the comparison is in whole paise, so no
 *     binary floating-point noise can make a zero look non-zero.
 *   - A blank cell on one side of a line that is otherwise zero counts as zero
 *     on that side: the balance plan already sums a blank as 0, and a row with
 *     BOTH cells blank is rejected by the plan, so it never becomes a line.
 *   - A company with NO line in the active snapshot (not in the file, no upload
 *     yet, or the balances could not be read) is NOT hidden: missing data is
 *     never treated as a zero balance.
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
 * True when the company has a line in the active snapshot and both its Debit
 * and Credit are zero. `undefined` (no line) is never zero-balance.
 */
export function isZeroBalanceLine(line: BalanceLine | undefined): boolean {
  if (!line) return false;
  return isZeroAmount(line.debit) && isZeroAmount(line.credit);
}

/** Splits parties into the ones the Tracker lists and the ones it hides, by the loader's `zeroBalance` flag. */
export function splitZeroBalance<T extends { zeroBalance?: boolean }>(parties: T[]): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const p of parties) (p.zeroBalance ? hidden : visible).push(p);
  return { visible, hidden };
}

/** The Tracker's note when some companies are hidden (none when none are). */
export function hiddenZeroBalanceNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "company" : "companies"} with ₹0 Debit and ₹0 Credit in the latest upload ${count === 1 ? "isn't" : "aren't"} listed. ${count === 1 ? "It stays" : "They stay"} in the Collection Master and will be listed again when an upload gives ${count === 1 ? "it" : "them"} a balance.`;
}
