import { SO_FIELDS, SO_GROUPS } from "./sales-order-catalogue";
import type { SalesOrderDetails, SoGroupRows } from "./sales-order-catalogue";
import type { TallyLine } from "./plan";
import { partyKey } from "./values";

/**
 * Comparing two versions of one Sales Order — the same voucher number read
 * twice in a file, or a file's order against the one already stored. Pure.
 *
 * An order is reduced to its COMPLETE canonical content: every voucher, order,
 * dispatch, buyer, consignee and voucher-state field, every ledger entry with
 * its rate, narration, description and cost centres, every additional cost,
 * and every product line with its description, discounts, MRP, GST, HSN/SAC
 * and allocations. Each value is keyed by a readable label (the field's Tally
 * name, with the item or ledger it belongs to), so two versions are:
 *   - an EXACT duplicate when every label holds the same value, and
 *   - a CHANGED version otherwise, with the labels that differ listed.
 * Order-level fields that a future configuration adds under `details` are
 * compared too: any key not in the table below is compared under its own path.
 *
 * What is left out is what the import itself decides, not what the file says:
 * file row numbers, the Product Master link, the listed-ledger match.
 */

export type CanonicalOrder = Map<string, string>;

/** Where each order-level field lives in SalesOrderDetails, so a difference is named by its Tally field name. */
const DETAIL_LABEL: Record<string, string> = {
  "voucher.typeName": "Voucher Type Name",
  "voucher.seriesName": "Voucher Number Series Name",
  "voucher.narration": "Voucher Narration",
  "voucher.costCentreClass": "Cost Centre/Classes",
  "voucher.voucherClass": "Voucher Class",
  "voucher.priceLevel": "Price Level",
  "voucher.gstRegistration": "GST Registration",
  "order.orderNos": "Order No(s)",
  "order.orderDate": "Order - Date",
  "order.paymentTerms": "Mode/Terms of Payment",
  "order.otherReferences": "Other References",
  "order.deliveryTerms": "Terms of Delivery",
  "dispatch.dispatchedThrough": "Dispatched through",
  "dispatch.destination": "Destination",
  "dispatch.carrier": "Carrier Name/Agent",
  "buyer.billTo": "Buyer/Supplier - Bill to/from",
  "buyer.addressType": "Buyer/Supplier - Address Type",
  "buyer.mailingName": "Buyer/Supplier - Mailing Name",
  "buyer.address": "Buyer/Supplier - Address",
  "buyer.country": "Buyer/Supplier - Country",
  "buyer.state": "Buyer/Supplier - State",
  "buyer.gstin": "Buyer/Supplier - GSTIN/UIN",
  "buyer.pincode": "Buyer/Supplier - Pincode",
  "buyer.registrationType": "Buyer/Supplier - GST Registration Type",
  "buyer.billOfEntry": "Buyer/Supplier - Is Bill of Entry available",
  "buyer.section7": "Buyer/Supplier - Supplies under section 7 of IGST Act",
  "buyer.placeOfSupply": "Buyer/Supplier - Place of Supply",
  "consignee.sameAsBuyer": "Consignee is the buyer",
  "consignee.billTo": "Consignee (ship to)",
  "consignee.addressType": "Consignee - Address Type",
  "consignee.mailingName": "Consignee - Mailing Name",
  "consignee.address": "Consignee - Address",
  "consignee.country": "Consignee - Country",
  "consignee.state": "Consignee - State",
  "consignee.gstin": "Consignee - GSTIN/UIN",
  "consignee.pincode": "Consignee - Pincode",
  supplyType: "Type of Supply",
  originalSalesNature: "Nature of Original Sales",
  "states.optional": "Optional",
  "states.postDated": "Post-Dated",
  "states.cancelled": "Cancelled",
  "states.changeMode": "Change Mode",
};

const name = (key: string) => SO_FIELDS.find((f) => f.key === key)?.tallyName ?? key;
/** A keyed value's label: a matrix field's Tally name (an x field the WMS offers), else the custom field's key as before. */
const keyedLabel = (key: string, fallback: string) => SO_FIELDS.find((f) => f.key === key)?.tallyName ?? fallback;
/** Labels of fields orders stored earlier may not have at all. */
const ADDED_LATER = (label: string) => label === name("buyerBillOfEntry") || label.endsWith(` · ${name("gstClassification")}`);
const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? String(v) : JSON.stringify(v));
const money = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : `₹${(paise / 100).toFixed(2)}`);

/** Every leaf of an object, by dotted path (arrays and nested objects of a future field included). */
function leaves(o: unknown, prefix: string, out: [string, unknown][]) {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.push([prefix, o]);
}

/** True when the stored order carries its order-level fields (imported after migration 0127). */
export const hasDetails = (d: unknown): d is SalesOrderDetails => !!d && typeof d === "object" && (d as { version?: unknown }).version === 1;

export interface ComparableOrder {
  partyKey: string;
  documentDate: string;
  totalPaise: number;
  lines: readonly TallyLine[];
  details?: SalesOrderDetails | Record<string, never> | null;
}

/** The order's complete content, label → value. */
export function canonicalSalesOrder(o: ComparableOrder): CanonicalOrder {
  const out: CanonicalOrder = new Map();
  const put = (label: string, v: unknown) => out.set(label, text(v));
  put("Customer", o.partyKey);
  put(name("documentDate"), o.documentDate);
  put("Order total", money(o.totalPaise));

  if (hasDetails(o.details)) {
    const { ledgers, additionalCosts, groups, version: _v, ...rest } = o.details;
    putGroups(put, "Order", groups);
    const flat: [string, unknown][] = [];
    // A consignee who is the buyer is a copy of the buyer's fields: compared once, as the buyer's.
    leaves(rest.consignee.sameAsBuyer ? { ...rest, consignee: { sameAsBuyer: true } } : rest, "", flat);
    for (const [path, v] of flat) put(DETAIL_LABEL[path] ?? (path.startsWith("custom.") ? keyedLabel(path.slice(7), path) : path), v);
    // Ledger entries, by name (the customer's first): every field the file gave them.
    const seen = new Map<string, number>();
    const entries = [...ledgers].sort((a, b) => Number(b.isParty) - Number(a.isParty) || a.name.localeCompare(b.name) || a.amountPaise - b.amountPaise);
    for (const e of entries) {
      const n = (seen.get(partyKey(e.name)) ?? 0) + 1;
      seen.set(partyKey(e.name), n);
      const who = `Ledger "${e.name}"${n > 1 ? ` (${n})` : ""}`;
      put(`${who} · ${name("amount")}`, money(e.amountPaise));
      put(`${who} · ${name("drCr")}`, e.side ?? "");
      put(`${who} · ${name("ledgerRate")}`, e.rate);
      put(`${who} · ${name("ledgerNarration")}`, e.narration);
      put(`${who} · ${name("ledgerDescription")}`, e.description);
      put(`${who} · cost centres`, e.costCentres.map((c) => `${c.category ?? ""}/${c.costCentre}/${money(c.amountPaise)}`).sort().join("; "));
      for (const [k, v] of Object.entries(e.custom ?? {})) put(`${who} · ${keyedLabel(k, k)}`, v);
      putGroups(put, who, e.groups);
    }
    put("Additional costs", additionalCosts.map((a) => `${a.ledger}/${a.percent ?? ""}/${money(a.amountPaise)}/${customText(a.custom)}`).sort().join("; "));
  }

  // Product lines, order-insensitive: by item, then by their own content.
  const lineText = (l: TallyLine) => JSON.stringify([partyKey(l.item ?? ""), l.quantity, l.amountPaise, l.ratePaise]);
  const seen = new Map<string, number>();
  for (const l of [...o.lines].sort((a, b) => lineText(a).localeCompare(lineText(b)))) {
    const k = partyKey(l.item ?? "");
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    const who = `Item "${l.item ?? ""}"${n > 1 ? ` (${n})` : ""}`;
    put(`${who} · ${name("quantity")}`, l.quantity);
    put(`${who} · ${name("rate")}`, money(l.ratePaise));
    put(`${who} · ${name("lineAmount")}`, money(l.amountPaise));
    put(`${who} · ${name("ratePer")}`, l.uom);
    put(`${who} · ${name("itemDescription")}`, l.description);
    put(`${who} · ${name("discPct")}`, l.discPct);
    put(`${who} · ${name("discAmount")}`, money(l.discountPaise));
    put(`${who} · ${name("mrp")}`, money(l.mrpPaise));
    if (l.gst) {
      const g = l.gst;
      put(`${who} · ${name("gstRateDetails")}`, g.rateDetails);
      put(`${who} · ${name("gstSource")}`, g.source);
      put(`${who} · ${name("gstSourceType")}`, g.sourceType);
      put(`${who} · ${name("gstTaxability")}`, g.taxability);
      put(`${who} · ${name("gstNature")}`, g.nature);
      // Absent (not null) on an order stored before the field existed: then there is nothing to compare.
      if (g.classification !== undefined) put(`${who} · ${name("gstClassification")}`, g.classification);
      put(`${who} · ${name("igstRate")}`, g.igstRate);
      put(`${who} · ${name("cgstRate")}`, g.cgstRate);
      put(`${who} · ${name("sgstRate")}`, g.sgstRate);
      put(`${who} · ${name("reverseCharge")}`, g.reverseCharge);
      put(`${who} · ${name("itcEligible")}`, g.itcEligible);
      put(`${who} · ${name("taxableValue")}`, money(g.taxablePaise));
    }
    if (l.hsn) {
      const h = l.hsn;
      put(`${who} · ${name("hsnDetails")}`, h.details);
      put(`${who} · ${name("hsnSource")}`, h.source);
      put(`${who} · ${name("hsnSourceType")}`, h.sourceType);
      put(`${who} · ${name("hsnClassification")}`, h.classification);
      put(`${who} · ${name("hsn")}`, h.code);
      put(`${who} · ${name("hsnDescription")}`, h.description);
    }
    put(
      `${who} · allocations`,
      (l.allocations ?? [])
        .map((a) => [a.dueDate ?? "", a.quantity, money(a.ratePaise), a.ratePer, money(a.amountPaise), a.trackingNo ?? "", a.orderNo ?? "", a.discPct ?? "", money(a.discountPaise), a.costTracking ?? "", customText(a.custom)].join("/"))
        .sort()
        .join("; "),
    );
    for (const [k, v] of Object.entries(l.custom ?? {})) put(`${who} · ${keyedLabel(k, k)}`, v);
  }
  return out;
}

/**
 * A ledger entry's or the order's repeating-group rows, one label per group ("Ledger "Alpha" · Bill Allocations"): the
 * rows' values by their Tally names, in any order — the file row numbers they came from are not part of the order.
 */
function putGroups(put: (label: string, v: unknown) => void, who: string, groups: SoGroupRows | undefined) {
  for (const g of SO_GROUPS) {
    const rows = groups?.[g.key];
    if (!rows?.length) continue;
    put(`${who} · ${g.section}`, rows.map((r) => Object.keys(r.values).sort().map((k) => `${keyedLabel(k, k)}=${text(r.values[k])}`).join(", ")).sort().join("; "));
  }
}

/** Custom values of an allocation or additional cost, in a stable order. */
const customText = (c: Record<string, string> | undefined) => (c ? Object.keys(c).sort().map((k) => `${k}=${c[k]}`).join(",") : "");

export interface OrderDifference {
  label: string;
  before: string;
  after: string;
}

/** The labels whose values differ between two versions (a label only one version has counts, against blank). */
export function orderDifferences(before: ComparableOrder, after: ComparableOrder): OrderDifference[] {
  const a = canonicalSalesOrder(before);
  const b = canonicalSalesOrder(after);
  // An order stored before its details were kept (pre-0127) kept only its customer, date, total and each line's
  // item, quantity and amount: it can only be compared on those, or every re-import would look changed.
  const comparable = hasDetails(before.details) && hasDetails(after.details);
  const core = (label: string) => label === "Customer" || label === name("documentDate") || label === "Order total" || label.endsWith(` · ${name("quantity")}`) || label.endsWith(` · ${name("lineAmount")}`);
  // An item or ledger only one version has is one difference ("Item "X" — only in the stored order"), not one per field.
  const owner = (label: string) => (/^(Item|Ledger) "/.test(label) ? label.slice(0, label.indexOf(" · ")) : null);
  const ownersOf = (m: CanonicalOrder) => new Set([...m.keys()].map(owner).filter((o): o is string => !!o));
  const inA = ownersOf(a);
  const inB = ownersOf(b);
  const out: OrderDifference[] = [];
  const reported = new Set<string>();
  for (const label of new Set([...a.keys(), ...b.keys()])) {
    if (!comparable && !core(label)) continue;
    // A field added to the catalogue after one of the two was stored (Is Bill of Entry available, GST Classification):
    // that order never had it, so its absence there is not a change.
    if (ADDED_LATER(label) && a.has(label) !== b.has(label)) continue;
    const o = owner(label);
    if (o && inA.has(o) !== inB.has(o)) {
      if (!reported.has(o)) out.push({ label: o, before: inA.has(o) ? "present" : "", after: inB.has(o) ? "present" : "" });
      reported.add(o);
      continue;
    }
    const x = a.get(label) ?? "";
    const y = b.get(label) ?? "";
    if (x !== y) out.push({ label, before: x, after: y });
  }
  return out;
}

/** "Buyer/Supplier - Address ("1 Road" → "2 Road"), …" — the first few, and how many more. */
export function describeDifferences(diffs: readonly OrderDifference[], max = 5): string {
  const shown = diffs.slice(0, max).map((d) => `${d.label} ("${d.before || "blank"}" → "${d.after || "blank"}")`);
  return diffs.length > max ? `${shown.join("; ")}; and ${diffs.length - max} more` : shown.join("; ");
}
