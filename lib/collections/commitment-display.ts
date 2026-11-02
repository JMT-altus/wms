import { formatInrExact } from "@/lib/collections/money";
import { fmtDate } from "@/lib/dates";

/**
 * How a commitment reads wherever it is shown — the Collection Amount
 * Confirmation column and the company popup: "₹1,00,000 – 04/11/26".
 *
 * The amount is the exact stored text (never a float) in Indian grouping; the
 * date is the WMS standard dd/mm/yy. Pure and client-safe. Null when either
 * part is missing or unreadable, so nothing misleading is ever shown: the
 * caller decides what "nothing" looks like.
 */
export const COMMITMENT_SEPARATOR = " – ";

export function commitmentLabel(c: { amount: string | null | undefined; committedDate: string | null | undefined } | null | undefined): string | null {
  if (!c || !c.amount || !c.committedDate) return null;
  const date = fmtDate(c.committedDate);
  if (!date) return null;
  let amount: string;
  try {
    amount = formatInrExact(c.amount);
  } catch {
    return null;
  }
  return `${amount}${COMMITMENT_SEPARATOR}${date}`;
}
