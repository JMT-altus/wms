import type { SettingValue } from "@/lib/incentives/rules-config/spec";
import { rupees } from "@/lib/incentives/rules-config/validate";
import * as R from "@/lib/incentives/category-a/rational";
import type { Q } from "@/lib/incentives/category-a/rational";

/**
 * Applying customer receipts to invoices — shared by the incentive engines (Category A and Category B). PURE. Every
 * choice is a setting of the published version (Partial Payment Rules and Refunds and Adjustments):
 *   * a bounced cheque, a reversed receipt and a receipt held by hand earn nothing (reversed may be held for review);
 *   * a refund takes its part off the receipt ("Refunds");
 *   * allocations by hand apply exactly as recorded (and are held when they don't fit the receipt);
 *   * a receipt naming an invoice applies to it, and what it pays beyond the invoice follows "Receipts that pay several
 *     invoices"; an on-account receipt follows "Receipts not linked to an invoice".
 * Receipts are taken in date order, so "oldest first" is exact. `invoiceDue` is what each invoice still asks for
 * (its total less the credit notes the caller counts) and is reduced as receipts are applied.
 */

export interface ReceiptDoc {
  id: string;
  no: string;
  date: string;
  customerId: string | null;
  invoiceId: string | null;
  amountPaise: number;
}
export interface InvoiceDoc {
  id: string;
  date: string;
  customerId: string | null;
}
export interface ReceiptEvent {
  id: string;
  kind: string;
  documentId: string;
  invoiceId: string | null;
  amountPaise: number | null;
  date: string;
}
export type PieceStatus = "credited" | "held" | "excluded" | "reversed" | "over-collected";
export interface Piece {
  receiptId: string;
  receiptNo: string;
  receiptDate: string;
  invoiceId: string | null;
  unitId: string | null;
  employeeId: string | null;
  amountPaise: number;
  referenceDate: string | null;
  delayDays: number | null;
  multiplierPpm: number | null;
  earnedExact: string;
  status: PieceStatus;
  note: string;
}
export interface HeldNote {
  documentId: string | null;
  documentNo: string | null;
  employeeId: string | null;
  message: string;
}
export interface Applied {
  receiptId: string;
  receiptNo: string;
  date: string;
  invoiceId: string;
  amount: Q;
  how: string;
}

export function applyReceipts<I extends InvoiceDoc>(args: {
  settings: Readonly<Record<string, SettingValue>>;
  /** In date order (docKey). */
  receipts: readonly ReceiptDoc[];
  /** In date order. */
  events: readonly ReceiptEvent[];
  /** In date order (docKey): the order "oldest open invoice first" walks. */
  invoices: readonly I[];
  invoiceById: ReadonlyMap<string, I>;
  /** What each invoice still asks for; reduced as receipts are applied. */
  invoiceDue: Map<string, Q>;
  /** The unit (order or invoice) a receipt part is counted under, for the report. */
  unitIdOfInvoice: (invoiceId: string) => string | null;
  held: HeldNote[];
}): { applied: Applied[]; pieces: Piece[] } {
  const { settings: s, receipts, events, invoices, invoiceById, invoiceDue, unitIdOfInvoice, held } = args;
  const refundRule = s["adjust.refund"] as string;
  const bounceRule = s["adjust.bouncedCheque"] as string;
  const reversedRule = s["adjust.reversedReceipt"] as string;
  const onAccount = s["collection.onAccountReceipts"] as string;
  const multi = s["collection.multiInvoiceReceipts"] as string;
  const oldestOpen = (customerId: string | null, day: string, except?: string) =>
    invoices.filter((i) => i.customerId === customerId && i.id !== except && i.date <= day && R.cmp(invoiceDue.get(i.id)!, R.ZERO) > 0);
  const applied: Applied[] = [];
  const pieces: Piece[] = [];
  const piece = (r: ReceiptDoc, amount: number | Q, status: PieceStatus, note: string, invoiceId: string | null = null) => {
    pieces.push({ receiptId: r.id, receiptNo: r.no, receiptDate: r.date, invoiceId, unitId: invoiceId ? unitIdOfInvoice(invoiceId) : null, employeeId: null, amountPaise: typeof amount === "number" ? amount : R.round(amount, "halfUp", "paise"), referenceDate: null, delayDays: null, multiplierPpm: null, earnedExact: "0", status, note });
  };
  const apply = (r: ReceiptDoc, inv: I, amount: Q, how: string) => {
    if (R.isZero(amount)) return;
    invoiceDue.set(inv.id, R.max(R.ZERO, R.sub(invoiceDue.get(inv.id)!, amount)));
    applied.push({ receiptId: r.id, receiptNo: r.no, date: r.date, invoiceId: inv.id, amount, how });
  };
  const fifo = (r: ReceiptDoc, amount: Q, how: string, except?: string): Q => {
    let left = amount;
    for (const inv of oldestOpen(r.customerId, r.date, except)) {
      if (R.isZero(left)) break;
      const take = R.min(left, invoiceDue.get(inv.id)!);
      apply(r, inv, take, how);
      left = R.sub(left, take);
    }
    return left;
  };
  for (const r of receipts) {
    const evs = events.filter((e) => e.documentId === r.id);
    if (evs.some((e) => e.kind === "bounced")) {
      piece(r, r.amountPaise, "reversed", bounceRule === "reverseAndRestartDelay" ? "Cheque bounced: it earns nothing, and the delay keeps running until a payment that clears." : "Cheque bounced: it earns nothing.");
      continue;
    }
    if (evs.some((e) => e.kind === "reversed")) {
      if (reversedRule === "holdForReview") {
        piece(r, r.amountPaise, "held", "Receipt reversed: held for review.");
        held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Receipt reversed: held for review." });
      } else piece(r, r.amountPaise, "reversed", "Receipt reversed: it earns nothing.");
      continue;
    }
    if (evs.some((e) => e.kind === "hold")) {
      piece(r, r.amountPaise, "held", "Held for review by hand: it earns nothing until the hold is released.");
      held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Held for review by hand." });
      continue;
    }
    let amount = R.q(r.amountPaise);
    if (refundRule === "reverseReceiptShare") {
      const refunded = evs.filter((e) => e.kind === "refund").reduce((a, e) => a + (e.amountPaise ?? 0), 0);
      if (refunded > 0) {
        const cut = Math.min(refunded, r.amountPaise);
        amount = R.q(r.amountPaise - cut);
        piece(r, cut, "reversed", `Refunded ${rupees(cut)}: that part earns nothing.`);
      }
    }
    const manual = evs.filter((e) => e.kind === "allocation");
    if (manual.length) {
      const total = manual.reduce((a, e) => a + (e.amountPaise ?? 0), 0);
      if (R.cmp(R.q(total), amount) > 0 || manual.some((e) => !e.invoiceId || !invoiceById.has(e.invoiceId))) {
        piece(r, amount, "held", "Its allocation by hand is more than the receipt, or names an unknown invoice: held.");
        held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Allocation by hand doesn't fit the receipt." });
        continue;
      }
      for (const e of manual) apply(r, invoiceById.get(e.invoiceId!)!, R.q(e.amountPaise ?? 0), "allocated by hand");
      const rest = R.sub(amount, R.q(total));
      if (!R.isZero(rest)) piece(r, rest, "held", "Part of the receipt isn't allocated by hand yet.");
      continue;
    }
    if (r.invoiceId && invoiceById.has(r.invoiceId)) {
      const inv = invoiceById.get(r.invoiceId)!;
      const due = invoiceDue.get(inv.id)!;
      if (R.cmp(amount, due) <= 0 || multi === "useImportedReference") {
        apply(r, inv, amount, "the invoice it names");
        continue;
      }
      apply(r, inv, due, "the invoice it names");
      const excess = R.sub(amount, due);
      if (multi === "oldestFirst") {
        const left = fifo(r, excess, "the customer's oldest open invoice", inv.id);
        if (!R.isZero(left)) piece(r, left, "excluded", "More than the customer's open invoices: the excess isn't applied.");
      } else {
        piece(r, excess, "held", "It pays more than the invoice it names: the excess waits to be split by hand.");
        held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Pays several invoices: split it by hand." });
      }
      continue;
    }
    if (r.invoiceId && !invoiceById.has(r.invoiceId)) {
      piece(r, amount, "excluded", "The invoice it names isn't in Forms.");
      continue;
    }
    // On account.
    if (onAccount === "allocateOldestInvoiceFirst") {
      const left = fifo(r, amount, "on account: the customer's oldest open invoice");
      if (!R.isZero(left)) piece(r, left, "excluded", "On account, and more than the customer's open invoices: the excess isn't applied.");
    } else if (onAccount === "manualAllocationRequired") {
      piece(r, amount, "held", "On account: held until it is allocated by hand.");
      held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "On-account receipt: allocate it by hand." });
    } else piece(r, amount, "excluded", "On account: ignored until it is allocated.");
  }
  return { applied, pieces };
}
