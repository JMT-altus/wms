import { SO_ORDER_FIELDS as SO_FIELDS, parsePercent } from "./sales-order-catalogue";
import { templateHeadings, templateRow } from "./sales-order-template";
import { BASE_CATALOGUE, type SoCatalogue } from "./sales-order-config";
import { parseTallyAmount, parseTallyNumber, partyKey } from "./values";
import type { RawRow } from "./plan";
import type { SalesOrderLinks } from "./sales-order-match";

/**
 * The manual Sales Order entry form's model, and how it becomes an import.
 * Pure: the form turns what a person typed into exactly the rows a Tally file
 * in the template's layout would hold (one row for the voucher and the
 * customer's ledger, one per product line and allocation, one per other ledger
 * and cost centre), with the template's own headings. Those rows then go
 * through the same validation, matching and import as an uploaded file — there
 * is one importer, not two.
 */

/** Every voucher-level field (General, Order, Dispatch, Buyer, Consignee, Type of Supply, Voucher States, Original Invoice), by key. */
export const SO_FORM_VOUCHER_KEYS = SO_FIELDS.filter((f) => f.level === "voucher" || f.level === "buyer" || f.level === "consignee").map((f) => f.key);
export const SO_FORM_ITEM_KEYS = SO_FIELDS.filter((f) => f.level === "item" && f.key !== "itemName" && f.key !== "lineAmount").map((f) => f.key);
export const SO_FORM_ALLOC_KEYS = SO_FIELDS.filter((f) => f.level === "allocation").map((f) => f.key);

export interface SoFormCostCentre {
  category: string;
  costCentre: string;
  amount: string;
}

export interface SoFormLedger {
  name: string;
  /** Other ledgers only: the sales ledger and the customer's amounts are worked out. */
  amount: string;
  drCr: "Dr" | "Cr";
  rate: string;
  narration: string;
  description: string;
  costCentres: SoFormCostCentre[];
  /** Custom ledger-entry fields (Admin & Master Setup → Sales Order Fields), by key. */
  custom?: Record<string, string>;
}

export interface SoFormItem {
  /** The Product Master record chosen: "sku:<id>" or "product:<id>". */
  productRef: string;
  /** The name the import reads, from that record. */
  itemName: string;
  /** Item Description, Billed Quantity, Item Rate, Item Rate per, discounts, MRP, GST and HSN/SAC — by field key. */
  values: Record<string, string>;
  /** At least one. A single allocation may leave its quantity, rate, unit and amount blank: they are the line's. */
  allocations: Record<string, string>[];
}

export interface SoFormOrder {
  /** Voucher-level fields by key, including Voucher Date, Type and Number. Consignee keys are used only with `separateConsignee`. */
  voucher: Record<string, string>;
  separateConsignee: boolean;
  /** The Customer Master record chosen, and its name (the customer's Ledger Name). */
  customerId: string;
  customerName: string;
  /** The customer's ledger entry: its amount is the order total, worked out. */
  party: Omit<SoFormLedger, "name" | "amount" | "drCr">;
  /** The sales ledger the product lines sit under: its amount is the lines' total, worked out. */
  sales: Omit<SoFormLedger, "amount" | "drCr">;
  items: SoFormItem[];
  ledgers: SoFormLedger[];
  /** `custom`: custom additional-cost fields, by key. */
  additionalCosts: { ledger: string; percent: string; amount: string; custom?: Record<string, string> }[];
}

export const emptyAllocation = (): Record<string, string> => ({});
export const emptyItem = (): SoFormItem => ({ productRef: "", itemName: "", values: {}, allocations: [emptyAllocation()] });
export const emptyLedger = (): SoFormLedger => ({ name: "", amount: "", drCr: "Cr", rate: "", narration: "", description: "", costCentres: [] });

/** A blank order. Voucher Type Name, the voucher states and Change Mode start on Tally's own defaults for a Sales Order; everything else is empty. */
export function emptySalesOrder(): SoFormOrder {
  return {
    voucher: { voucherType: "Sales Order", isOptional: "No", isPostDated: "No", isCancelled: "No", changeMode: "Item Invoice", buyerCountry: "India", buyerSec7: "No" },
    separateConsignee: false,
    customerId: "",
    customerName: "",
    party: { rate: "0", narration: "", description: "", costCentres: [] },
    sales: { name: "", rate: "0", narration: "", description: "", costCentres: [] },
    items: [emptyItem()],
    ledgers: [],
    additionalCosts: [],
  };
}

const money = (paise: number) => (paise / 100).toFixed(2);

/** quantity × rate less the line's discount, in paise; null until the quantity and rate can be read. */
export function itemAmountPaise(values: Record<string, string>): number | null {
  const qty = values.quantity ? parseTallyNumber(values.quantity) : null;
  const rate = values.rate ? parseTallyAmount(values.rate) : null;
  if (qty === null || !rate || qty <= 0 || rate.paise < 0) return null;
  let v = Math.round(qty * rate.paise);
  const pct = values.discPct ? parsePercent(values.discPct) : null;
  if (pct) v = Math.round(v * (1 - pct / 100));
  const disc = values.discAmount ? parseTallyAmount(values.discAmount) : null;
  if (disc && disc.paise > 0) v -= disc.paise;
  return v;
}

/**
 * An allocation's amount as Tally works it out: its quantity × rate less ITS OWN Disc% and then Discount Amount;
 * null until its quantity and rate can be read. (A single delivery with no discount of its own is the line itself.)
 */
export function allocationAmountPaise(a: Record<string, string>): number | null {
  const qty = a.allocQuantity ? parseTallyNumber(a.allocQuantity) : null;
  const rate = a.allocRate ? parseTallyAmount(a.allocRate) : null;
  if (qty === null || !rate || qty <= 0 || rate.paise < 0) return null;
  let v = Math.round(qty * rate.paise);
  const pct = a.allocDiscPct ? parsePercent(a.allocDiscPct) : null;
  if (pct) v = Math.round(v * (1 - pct / 100));
  const disc = a.allocDiscAmount ? parseTallyAmount(a.allocDiscAmount) : null;
  if (disc && disc.paise > 0) v -= disc.paise;
  return v;
}

/**
 * A single delivery IS the whole line, so a discount of its own must be the line's. When the person gave the
 * delivery a different Disc% or Discount Amount, the reason the order will be held back, before checking it.
 */
export function singleDeliveryDiscountNote(item: SoFormItem): string | null {
  if (item.allocations.length !== 1) return null;
  const a = item.allocations[0]!;
  const v = item.values;
  // Each discount field the delivery leaves blank is the line's; only one it gives differently can conflict.
  const given = (x: string | undefined) => !!(x ?? "").trim();
  const pct = (x: string | undefined) => (given(x) ? parsePercent(x!) : null) ?? 0;
  const amt = (x: string | undefined) => (given(x) ? parseTallyAmount(x!)?.paise : null) ?? 0;
  const pctDiffers = given(a.allocDiscPct) && pct(a.allocDiscPct) !== pct(v.discPct);
  const amtDiffers = given(a.allocDiscAmount) && amt(a.allocDiscAmount) !== amt(v.discAmount);
  if (!pctDiffers && !amtDiffers) return null;
  return "A single delivery is the whole line: its Disc% and Discount Amount must be the line's (Item Details → Discount). Make them the same, or leave the delivery's blank to use the line's.";
}

/** What an other ledger adds to the total: a credit (tax, freight) adds, a debit (a discount) takes away. */
const signed = (l: SoFormLedger) => {
  const a = parseTallyAmount(l.amount);
  return a ? (l.drCr === "Dr" ? -Math.abs(a.paise) : Math.abs(a.paise)) : 0;
};

export function orderTotals(o: SoFormOrder): { itemsPaise: number; othersPaise: number; totalPaise: number; complete: boolean } {
  const amounts = o.items.map((i) => itemAmountPaise(i.values));
  const itemsPaise = amounts.reduce<number>((n, a) => n + (a ?? 0), 0);
  const othersPaise = o.ledgers.reduce((n, l) => n + signed(l), 0);
  return { itemsPaise, othersPaise, totalPaise: itemsPaise + othersPaise, complete: amounts.every((a) => a !== null) };
}

/** Where each generated row came from, so a message on a row can be shown against the right part of the form. */
export interface SoFormRowSource {
  rowNo: number;
  label: string;
}

/**
 * The template rows for this order, numbered from 2 (row 1 is the headings), with what each row is.
 * Cells are exactly as typed; the worked-out amounts (line amounts, the sales ledger, the order total) are written
 * in rupees with two decimals, as the template would hold them.
 */
export function salesOrderFormRows(o: SoFormOrder, c: SoCatalogue = BASE_CATALOGUE): { headers: string[]; rows: RawRow[]; sources: SoFormRowSource[] } {
  // Custom fields of each scope ride in the same records as the matrix's (voucher, item values, allocations) or in `custom`.
  // (The matrix's keyed fields — the x fields the WMS offers — are already in SO_FORM_*_KEYS.)
  const customKeys = (scope: string) => c.fields.filter((f) => f.isCustom && f.scope === scope).map((f) => f.key);
  const voucherKeys = [...SO_FORM_VOUCHER_KEYS, ...customKeys("voucher")];
  const itemKeys = [...SO_FORM_ITEM_KEYS, ...customKeys("item")];
  const allocKeys = [...SO_FORM_ALLOC_KEYS, ...customKeys("allocation")];
  const trimmed = (m: Record<string, string> | undefined) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  const out: Record<string, string>[] = [];
  const sources: SoFormRowSource[] = [];
  const add = (cells: Record<string, string>, label: string) => {
    out.push(cells);
    sources.push({ rowNo: out.length + 1, label });
  };
  const ccCells = (c: SoFormCostCentre) => ({ categoryName: c.category, costCentre: c.costCentre, costCentreAmount: c.amount });
  const totals = orderTotals(o);

  const voucher: Record<string, string> = {};
  for (const k of voucherKeys) {
    const value = (o.voucher[k] ?? "").trim();
    if (!value) continue;
    if (!o.separateConsignee && SO_FIELDS.find((f) => f.key === k)?.level === "consignee") continue;
    voucher[k] = value;
  }
  const [firstPartyCc, ...morePartyCc] = o.party.costCentres;
  add(
    { ...voucher, partyName: o.customerName, amount: money(totals.totalPaise), drCr: "Dr", ledgerRate: o.party.rate, ledgerNarration: o.party.narration, ledgerDescription: o.party.description, ...trimmed(o.party.custom), ...(firstPartyCc ? ccCells(firstPartyCc) : {}) },
    "Order and customer ledger",
  );
  for (const c of morePartyCc) add(ccCells(c), "Customer ledger cost centre");

  const [firstSalesCc, ...moreSalesCc] = o.sales.costCentres;
  o.items.forEach((item, i) => {
    const amount = itemAmountPaise(item.values);
    const line: Record<string, string> = { itemName: item.itemName, lineAmount: amount === null ? "" : money(amount) };
    for (const k of itemKeys) if ((item.values[k] ?? "").trim()) line[k] = item.values[k]!.trim();
    const [first, ...rest] = item.allocations.length ? item.allocations : [emptyAllocation()];
    const split = item.allocations.length > 1;
    const alloc = (a: Record<string, string>) => {
      const cells = Object.fromEntries(allocKeys.filter((k) => (a[k] ?? "").trim()).map((k) => [k, a[k]!.trim()]));
      // A split delivery's amount left blank is worked out from its own quantity, rate and discount (a single
      // delivery's is the line's, worked out by the import itself).
      const worked = split && !cells.allocAmount ? allocationAmountPaise(a) : null;
      if (worked !== null) cells.allocAmount = money(worked);
      return cells;
    };
    const ledger = i === 0 ? { partyName: o.sales.name, amount: money(totals.itemsPaise), drCr: "Cr", ledgerRate: o.sales.rate, ledgerNarration: o.sales.narration, ledgerDescription: o.sales.description, ...trimmed(o.sales.custom), ...(firstSalesCc ? ccCells(firstSalesCc) : {}) } : {};
    add({ ...ledger, ...line, ...alloc(first!) }, `Item ${i + 1}`);
    rest.forEach((a, j) => add(alloc(a), `Item ${i + 1} · allocation ${j + 2}`));
  });
  for (const c of moreSalesCc) add(ccCells(c), "Sales ledger cost centre");

  o.ledgers.forEach((l, i) => {
    const [first, ...more] = l.costCentres;
    add({ partyName: l.name, amount: l.amount, drCr: l.drCr, ledgerRate: l.rate, ledgerNarration: l.narration, ledgerDescription: l.description, ...trimmed(l.custom), ...(first ? ccCells(first) : {}) }, `Ledger ${i + 1}${l.name ? ` (${l.name})` : ""}`);
    for (const c of more) add(ccCells(c), `Ledger ${i + 1} cost centre`);
  });
  o.additionalCosts.forEach((a, i) => add({ addlCostLedger: a.ledger, addlCostPct: a.percent, addlCostAmount: a.amount, ...trimmed(a.custom) }, `Additional cost ${i + 1}`));

  // Only the columns the configuration imports: a retired or form-only field's value never reaches the import.
  return { headers: templateHeadings(c), rows: out.map((cells, i) => ({ rowNo: i + 2, cells: templateRow(c, cells) })), sources };
}

/** The hand-made matches the form's choices stand for: the import still checks them against the masters. */
export function salesOrderFormLinks(o: SoFormOrder): SalesOrderLinks {
  const products: Record<string, string> = {};
  for (const i of o.items) if (i.productRef && i.itemName) products[partyKey(i.itemName)] = i.productRef;
  return { customers: o.customerId && o.customerName ? { [partyKey(o.customerName)]: o.customerId } : {}, products, ledgers: {} };
}
