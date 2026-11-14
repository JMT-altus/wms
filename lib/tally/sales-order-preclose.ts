import { parseTallyDateValue, parseTallyNumber } from "./values";
import { BASE_CATALOGUE, isRequired, preCloseFields, type ConfiguredField, type SoCatalogue } from "./sales-order-config";
import type { SoAllocation } from "./sales-order-catalogue";

/**
 * Pre-closing a delivery of a stored Sales Order — the matrix's "Update" fields (Item Allocations - Pre-Close
 * Quantity, Reason for Pre-Close, Pre-Close Date). Pure: the server checks a submission with this before it records
 * anything (lib/queries/sales-order-preclosures.ts), and the order page uses the same figures. The order itself is
 * never changed: each pre-closure is a record of its own (migration 0129), and what is still open on a delivery is
 * its Billed Quantity less everything pre-closed on it.
 */

/** Quantities are kept to 6 decimals (numeric(20, 6)); sums are compared in millionths so 0.1 + 0.2 is 0.3. */
const MICRO = 1_000_000;
const micro = (n: number) => Math.round(n * MICRO);
export const fromMicro = (m: number) => m / MICRO;

/** One delivery (item allocation) of an order, numbered from 1 as the order page shows it. */
export interface SoDelivery {
  lineNo: number;
  allocationNo: number;
  item: string;
  dueDate: string | null;
  quantity: number;
  ratePer: string;
}

/** A stored pre-closure. */
export interface PreClosure {
  id: string;
  lineNo: number;
  allocationNo: number;
  quantity: number;
  reason: string | null;
  precloseDate: string;
  recordedBy: string;
  recordedAt: string;
}

type StoredLine = { item: string | null; allocations?: readonly Pick<SoAllocation, "quantity" | "ratePer" | "dueDate">[] | null };

/** Every delivery of an order, in line then allocation order. An order stored before deliveries were kept has none. */
export function deliveriesOf(lines: readonly StoredLine[]): SoDelivery[] {
  return lines.flatMap((l, i) =>
    (l.allocations ?? []).map((a, j) => ({ lineNo: i + 1, allocationNo: j + 1, item: l.item ?? "", dueDate: a.dueDate ?? null, quantity: a.quantity, ratePer: a.ratePer })),
  );
}

const sameDelivery = (p: Pick<PreClosure, "lineNo" | "allocationNo">, d: Pick<SoDelivery, "lineNo" | "allocationNo">) => p.lineNo === d.lineNo && p.allocationNo === d.allocationNo;
export const preClosuresOf = (records: readonly PreClosure[], d: Pick<SoDelivery, "lineNo" | "allocationNo">) => records.filter((p) => sameDelivery(p, d));

/** How much of a delivery is pre-closed and how much is still open. */
export function deliveryState(d: SoDelivery, records: readonly PreClosure[]): { preClosed: number; open: number } {
  const closedMicro = preClosuresOf(records, d).reduce((n, p) => n + micro(p.quantity), 0);
  return { preClosed: fromMicro(closedMicro), open: fromMicro(Math.max(0, micro(d.quantity) - closedMicro)) };
}

/** What the screen sends. */
export interface PreCloseInput {
  lineNo: number;
  allocationNo: number;
  quantity: string;
  reason: string;
  date: string;
  /** How many pre-closures the delivery had when the screen showed it: if it has more now, someone else got there first. */
  expectedCount: number;
}

export interface PreCloseOrder {
  documentDate: string;
  cancelled: boolean;
  lines: readonly StoredLine[];
}

export type PreCloseCheck = { ok: true; delivery: SoDelivery; quantity: number; reason: string | null; date: string } | { ok: false; errors: string[] };

const REASON_MAX = 500;

/**
 * Every reason a pre-closure can't be recorded; the checked values when it can. The configured labels and the
 * reason's configured requirement (Admin & Master Setup → Sales Order Fields) are used.
 */
export function checkPreClose(order: PreCloseOrder, records: readonly PreClosure[], input: PreCloseInput, today: string, c: SoCatalogue = BASE_CATALOGUE): PreCloseCheck {
  const fields = new Map(preCloseFields(c).map((f) => [f.key, f]));
  const label = (key: string) => fields.get(key)?.label ?? key;
  const delivery = deliveriesOf(order.lines).find((d) => d.lineNo === input.lineNo && d.allocationNo === input.allocationNo);
  if (!delivery) return { ok: false, errors: ["That delivery isn't in this order."] };
  if (order.cancelled) return { ok: false, errors: ["This order is marked Cancelled: there is nothing to pre-close."] };
  const mine = preClosuresOf(records, delivery);
  if (mine.length !== input.expectedCount) return { ok: false, errors: ["This delivery was pre-closed by someone else meanwhile. Nothing was recorded: look at it again before pre-closing more."] };
  const { open } = deliveryState(delivery, records);
  if (micro(open) <= 0) return { ok: false, errors: ["This delivery is already fully pre-closed."] };

  const errors: string[] = [];
  const raw = input.quantity.trim();
  const q = raw ? parseTallyNumber(raw) : null;
  if (!raw) errors.push(`${label("preCloseQuantity")} is required.`);
  else if (q === null || !/^\d{1,13}(\.\d{1,6})?$/.test(raw.replace(/,/g, ""))) errors.push(`${label("preCloseQuantity")} "${raw}" isn't a number (up to 6 decimals).`);
  else if (micro(q) <= 0) errors.push(`${label("preCloseQuantity")} must be more than zero.`);
  else if (micro(q) > micro(open)) errors.push(`${label("preCloseQuantity")} ${q} is more than the delivery's open quantity, ${open} ${delivery.ratePer}.`);

  const reason = input.reason.trim().replace(/\s+/g, " ");
  const reasonField = fields.get("preCloseReason") as ConfiguredField | undefined;
  if (!reason && reasonField && isRequired(reasonField, () => null)) errors.push(`${label("preCloseReason")} is required.`);
  if (reason.length > REASON_MAX) errors.push(`${label("preCloseReason")} is longer than ${REASON_MAX} characters.`);

  const date = input.date.trim() ? parseTallyDateValue(input.date.trim()) : null;
  if (!input.date.trim()) errors.push(`${label("preCloseDate")} is required.`);
  else if (!date) errors.push(`${label("preCloseDate")} "${input.date}" can't be read as a date.`);
  else if (date < order.documentDate) errors.push(`${label("preCloseDate")} ${date} is before the order's Voucher Date ${order.documentDate}.`);
  else if (date > today) errors.push(`${label("preCloseDate")} ${date} is after today (${today}).`);

  if (errors.length) return { ok: false, errors };
  return { ok: true, delivery, quantity: q!, reason: reason || null, date: date! };
}
