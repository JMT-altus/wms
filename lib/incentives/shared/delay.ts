import type { DelayStep, SettingValue } from "@/lib/incentives/rules-config/spec";
import { addDays } from "./dates";

/**
 * Collection delay, shared by the incentive engines: which configured step a delay falls in, and the date a receipt's
 * delay is counted from (Collection and Payment Delay). Pure; every choice is a setting of the published version.
 */

export function stepFor(steps: readonly DelayStep[], days: number, boundary: string): DelayStep {
  for (const s of steps) {
    if (s.toDays === null) return s;
    if (boundary === "upperInclusive" ? days <= s.toDays : days < s.toDays) return s;
  }
  return steps[steps.length - 1]!;
}

export interface RefInvoice {
  date: string;
  orderId: string | null;
  customerId: string | null;
  dueDate: string | null;
}

/** "Within 30 days", "30 Days" … → 30; anything else → null. */
export const termsDays = (t: string | null) => {
  const m = t ? /(\d{1,3})\s*days?\b/i.exec(t) : null;
  return m ? Number(m[1]) : null;
};

/**
 * The date an invoice's receipts are measured from, and where it came from, as the settings say
 * ("Delay is counted from", "Where a due date comes from", "Default days after the invoice"); null when none can be
 * found (then "When no due date can be found" decides).
 */
export function makeReferenceDate(
  s: Readonly<Record<string, SettingValue>>,
  orderOf: (id: string) => { date: string; paymentTerms: string | null } | undefined,
  customerOf: (id: string) => { name: string; creditPeriodDays: number | null } | undefined,
) {
  const delayFrom = s["collection.delayFrom"] as string;
  const fallback = (s["collection.dueDateFallback"] as string[] | undefined) ?? [];
  return (inv: RefInvoice): { date: string; from: string } | null => {
    if (delayFrom === "invoiceDate") return { date: inv.date, from: "the invoice date" };
    if (delayFrom === "orderDate") {
      const o = inv.orderId ? orderOf(inv.orderId) : undefined;
      return o ? { date: o.date, from: "the order date" } : null;
    }
    for (const src of fallback) {
      if (src === "invoiceDueDate" && inv.dueDate) return { date: inv.dueDate, from: "the invoice's due date" };
      if (src === "orderPaymentTerms") {
        const o = inv.orderId ? orderOf(inv.orderId) : undefined;
        const n = termsDays(o?.paymentTerms ?? null);
        if (n !== null) return { date: addDays(inv.date, n), from: `the order's payment terms (${n} days)` };
      }
      if (src === "customerTerms") {
        const c = inv.customerId ? customerOf(inv.customerId) : undefined;
        if (c?.creditPeriodDays != null) return { date: addDays(inv.date, c.creditPeriodDays), from: `${c.name}'s credit period (${c.creditPeriodDays} days)` };
      }
      if (src === "defaultDays") return { date: addDays(inv.date, s["collection.defaultDays"] as number), from: `the default ${s["collection.defaultDays"] as number} days` };
    }
    return null;
  };
}
