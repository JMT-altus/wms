/**
 * Collection Tracker ⇄ Collection Logs — which companies a confirmed balance
 * upload moves. Pure: no database, no clock, so it is tested on its own and
 * the write transaction (lib/queries/collection-closures-write.ts) only
 * executes what it decides.
 *
 * The rule, from the lines a confirmed upload WROTE (one per matched company):
 *   - Debit and Credit both zero → the company goes to Collection Logs: an open
 *     closure episode is recorded (unless it already has one).
 *   - Debit or Credit not zero (either side, negative included) → the company
 *     belongs in the Tracker: an open closure, if any, is marked reopened.
 *   - Neither figure known → nothing moves. (The balance plan already rejects a
 *     row with both cells blank, so such a line is never written; this is the
 *     guard in depth.)
 *
 * Zero follows the importer's own rules: amounts are whole paise, so 0, 0.00
 * and -0.00 are zero; a lone dash is read as 0 by the importer; a blank cell
 * beside a zero on the other side is zero on that side, exactly as the plan
 * sums it.
 *
 * Only companies in the upload are looked at. A company the file leaves out
 * keeps whatever state it had, and a company in no upload at all is never
 * moved: absence is not a balance.
 */

export interface UploadedLine {
  companyId: string;
  /** Whole paise; null = blank in the file. */
  debitPaise: number | null;
  creditPaise: number | null;
}

export type LineBalance = "zero" | "non-zero" | "unknown";

export function lineBalance(l: Pick<UploadedLine, "debitPaise" | "creditPaise">): LineBalance {
  const { debitPaise: d, creditPaise: c } = l;
  if (d === null && c === null) return "unknown";
  if ((d !== null && !Number.isInteger(d)) || (c !== null && !Number.isInteger(c))) return "unknown";
  return (d ?? 0) === 0 && (c ?? 0) === 0 ? "zero" : "non-zero";
}

export interface ClosurePlan {
  /** Companies to move to Collection Logs (no open closure yet). */
  close: UploadedLine[];
  /** Companies to return to the Tracker (they have an open closure). */
  reopen: UploadedLine[];
  /** Already where they belong: logged and still zero, or in the Tracker and not zero. */
  unchanged: number;
  /** Lines whose balance can't be determined; never moved. */
  unknown: number;
}

/**
 * What the upload's lines change. `openCompanyIds` = companies currently in
 * Collection Logs (an open closure). A company id appearing more than once is
 * decided once, by its first line — the plan never writes two lines for one
 * company, so this is only a guard.
 */
export function planClosures(lines: readonly UploadedLine[], openCompanyIds: ReadonlySet<string>): ClosurePlan {
  const plan: ClosurePlan = { close: [], reopen: [], unchanged: 0, unknown: 0 };
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.companyId)) continue;
    seen.add(l.companyId);
    const b = lineBalance(l);
    const open = openCompanyIds.has(l.companyId);
    if (b === "unknown") plan.unknown++;
    else if (b === "zero" && !open) plan.close.push(l);
    else if (b === "non-zero" && open) plan.reopen.push(l);
    else plan.unchanged++;
  }
  return plan;
}

/** Exact numeric(16,2) text from paise, for the closure's final figures. */
export function paiseText(p: number | null): string | null {
  if (p === null) return null;
  const neg = p < 0;
  const a = Math.abs(p);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
