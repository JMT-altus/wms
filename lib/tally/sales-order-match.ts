import type { DocumentRecord, TallyLine } from "./plan";
import type { RecordResolution } from "./resolve";
import { changeKind } from "./sales-orders";
import { describeDifferences, orderDifferences } from "./sales-order-compare";
import type { SalesOrderDetails } from "./sales-order-catalogue";
import { partyKey } from "./values";

/**
 * Matching a sales order's customer and items to the WMS masters. Pure: the
 * server hands it the masters it read and the order the planner built.
 *
 * Nothing is created and nothing is guessed. A name links only when exactly one
 * master record carries it; otherwise the order is held back until a person
 * with the import permission picks the record (a "link"), or adds it to the
 * master. A link applies only to a name the masters could not settle on their
 * own, so it can never quietly replace an exact match.
 *
 * Ledgers (sales, tax, freight, additional cost) have no master in the WMS. They
 * are checked against the "Sales Orders — Tally Ledgers" list in Admin & Master
 * Setup → Libraries: while that list is empty they are reported as not
 * checked; once it lists any, a ledger it doesn't list holds the order back
 * until it is matched to a listed ledger or added to the list.
 */

/** Hand-made matches for one file: normalized name → Customer Master id, normalized item name → "sku:<id>" or "product:<id>", normalized ledger name → a listed ledger. */
export interface SalesOrderLinks {
  customers: Record<string, string>;
  products: Record<string, string>;
  ledgers?: Record<string, string>;
}
export const NO_LINKS: SalesOrderLinks = { customers: {}, products: {}, ledgers: {} };

export interface MasterCustomer {
  id: string;
  name: string;
  code: string | null;
  gstin: string | null;
}
export interface MasterProduct {
  id: string;
  name: string;
  code: string | null;
  tallyName: string | null;
  isActive: boolean;
}
export interface MasterSku {
  id: string;
  productId: string;
  skuCode: string;
  variantLabel: string | null;
  uom: string;
  tallyItemName: string | null;
  isActive: boolean;
}

export interface ProductTarget {
  /** "sku:<id>" or "product:<id>" — the value a link carries. */
  ref: string;
  productId: string;
  skuId: string | null;
  label: string;
  uom: string | null;
  /** The name an import reads for exactly this record: a variant's Tally item name (else its SKU code), a product's Tally name (else its name). */
  importName: string;
}

export interface SalesOrderMasters {
  customerById: Map<string, MasterCustomer>;
  customersByKey: Map<string, string[]>;
  customersByGstin: Map<string, string[]>;
  productByRef: Map<string, ProductTarget>;
  /** Most specific first: a SKU's Tally item name, a product's Tally name, a SKU code, a product name, a product code. */
  productLevels: Map<string, ProductTarget[]>[];
  /** Names that only match something switched off in the master. */
  inactiveKeys: Set<string>;
  /** The Tally Ledgers list, by normalized name. Empty = ledgers aren't checked. */
  ledgerByKey: Map<string, string>;
}

const add = <T>(m: Map<string, T[]>, k: string, v: T) => {
  if (!k) return;
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

export const customerLabel = (c: MasterCustomer) => (c.code ? `${c.name} · ${c.code}` : c.name);

export function buildSalesOrderMasters(customers: readonly MasterCustomer[], products: readonly MasterProduct[], skus: readonly MasterSku[], ledgers: readonly string[] = []): SalesOrderMasters {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const customersByKey = new Map<string, string[]>();
  const customersByGstin = new Map<string, string[]>();
  for (const c of customers) {
    add(customersByKey, partyKey(c.name), c.id);
    if (c.gstin) add(customersByGstin, c.gstin.toUpperCase(), c.id);
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const activeSkus = skus.filter((s) => s.isActive && productById.get(s.productId)?.isActive);
  const skusOf = new Map<string, MasterSku[]>();
  for (const s of activeSkus) add(skusOf, s.productId, s);
  const productByRef = new Map<string, ProductTarget>();
  const skuTarget = (s: MasterSku): ProductTarget => {
    const p = productById.get(s.productId)!;
    return { ref: `sku:${s.id}`, productId: p.id, skuId: s.id, label: `${p.name}${s.variantLabel ? ` · ${s.variantLabel}` : ""} (${s.skuCode})`, uom: s.uom, importName: s.tallyItemName?.trim() || s.skuCode };
  };
  const productTarget = (p: MasterProduct): ProductTarget => {
    // A product with exactly one variant is that variant: there is nothing to choose between.
    const only = skusOf.get(p.id)?.length === 1 ? skusOf.get(p.id)![0]! : null;
    return { ref: `product:${p.id}`, productId: p.id, skuId: only?.id ?? null, label: p.code ? `${p.name} (${p.code})` : p.name, uom: only?.uom ?? null, importName: p.tallyName?.trim() || p.name };
  };
  const levels: Map<string, ProductTarget[]>[] = [new Map(), new Map(), new Map(), new Map(), new Map()];
  for (const s of activeSkus) {
    const t = skuTarget(s);
    productByRef.set(t.ref, t);
    add(levels[0]!, partyKey(s.tallyItemName ?? ""), t);
    add(levels[2]!, partyKey(s.skuCode), t);
  }
  for (const p of products) {
    if (!p.isActive) continue;
    const t = productTarget(p);
    productByRef.set(t.ref, t);
    add(levels[1]!, partyKey(p.tallyName ?? ""), t);
    add(levels[3]!, partyKey(p.name), t);
    add(levels[4]!, partyKey(p.code ?? ""), t);
  }
  const inactiveKeys = new Set<string>();
  for (const p of products) if (!p.isActive) for (const v of [p.tallyName, p.name, p.code]) if (v) inactiveKeys.add(partyKey(v));
  for (const s of skus) if (!s.isActive || !productById.get(s.productId)?.isActive) for (const v of [s.tallyItemName, s.skuCode]) if (v) inactiveKeys.add(partyKey(v));
  const ledgerByKey = new Map<string, string>();
  for (const l of ledgers) if (partyKey(l) && !ledgerByKey.has(partyKey(l))) ledgerByKey.set(partyKey(l), l.trim());
  return { customerById, customersByKey, customersByGstin, productByRef, productLevels: levels, inactiveKeys, ledgerByKey };
}

type Found<T> = { kind: "one"; hit: T } | { kind: "many"; count: number } | { kind: "none" };

/** GSTIN first — it identifies the business — then the name. Two candidates link to neither: a person decides. */
export function findCustomer(m: SalesOrderMasters, gstin: string | null, key: string): Found<MasterCustomer> {
  const pool = (gstin && m.customersByGstin.get(gstin.toUpperCase())) || m.customersByKey.get(key) || [];
  if (pool.length === 1) return { kind: "one", hit: m.customerById.get(pool[0]!)! };
  return pool.length > 1 ? { kind: "many", count: pool.length } : { kind: "none" };
}

/** The first level that knows the name decides: one record there links, several never do. */
export function findProduct(m: SalesOrderMasters, key: string): Found<ProductTarget> {
  if (!key) return { kind: "none" };
  for (const level of m.productLevels) {
    const hits = level.get(key);
    if (!hits?.length) continue;
    const distinct = [...new Map(hits.map((h) => [h.ref, h])).values()];
    return distinct.length === 1 ? { kind: "one", hit: distinct[0]! } : { kind: "many", count: distinct.length };
  }
  return { kind: "none" };
}

/** "Nos", "NOS." and "No" are one unit; "Kg" is another. */
const unitKey = (u: string) => u.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");

/** unchecked = a ledger, while the Tally Ledgers list is empty. */
export type MatchStatus = "matched" | "manual" | "unmatched" | "ambiguous" | "unchecked";

/** One name from the file and what the masters make of it — the rows of the matching screen. */
export interface NameMatch {
  key: string;
  name: string;
  status: MatchStatus;
  /** The master record it links to (matched or manual). */
  label: string | null;
  ref: string | null;
  /** The file rows that use the name (the first few). */
  rows: number[];
}

export interface SalesOrderMatches {
  customers: NameMatch[];
  products: NameMatch[];
  ledgers: NameMatch[];
}

export class MatchCollector {
  private customers = new Map<string, NameMatch>();
  private products = new Map<string, NameMatch>();
  private ledgers = new Map<string, NameMatch>();
  private note(into: Map<string, NameMatch>, key: string, name: string, status: MatchStatus, label: string | null, ref: string | null, rowNo: number) {
    const seen = into.get(key);
    if (seen) {
      if (seen.rows.length < 5 && !seen.rows.includes(rowNo)) seen.rows.push(rowNo);
      return;
    }
    into.set(key, { key, name, status, label, ref, rows: [rowNo] });
  }
  customer(key: string, name: string, status: MatchStatus, label: string | null, ref: string | null, rowNo: number) {
    this.note(this.customers, key, name, status, label, ref, rowNo);
  }
  product(key: string, name: string, status: MatchStatus, label: string | null, ref: string | null, rowNo: number) {
    this.note(this.products, key, name, status, label, ref, rowNo);
  }
  ledger(key: string, name: string, status: MatchStatus, label: string | null, rowNo: number) {
    this.note(this.ledgers, key, name, status, label, label, rowNo);
  }
  result(): SalesOrderMatches {
    return { customers: [...this.customers.values()], products: [...this.products.values()], ledgers: [...this.ledgers.values()] };
  }
}

/** Matches from several chunks of one file, as one list (a name is the same name in every chunk). */
export function mergeMatches(parts: readonly SalesOrderMatches[]): SalesOrderMatches {
  const merge = (lists: NameMatch[][]) => {
    const out = new Map<string, NameMatch>();
    for (const m of lists.flat()) {
      const seen = out.get(m.key);
      if (!seen) out.set(m.key, { ...m, rows: [...m.rows] });
      else for (const r of m.rows) if (seen.rows.length < 5 && !seen.rows.includes(r)) seen.rows.push(r);
    }
    return [...out.values()].sort((a, b) => a.rows[0]! - b.rows[0]!);
  };
  return { customers: merge(parts.map((p) => p.customers)), products: merge(parts.map((p) => p.products)), ledgers: merge(parts.map((p) => p.ledgers ?? [])) };
}

export interface ExistingSalesOrder {
  id: string;
  batch: string | null;
  totalPaise: number;
  documentDate: string;
  partyKey: string;
  lines: readonly TallyLine[];
  /** The stored order's order-level fields (0127); {} for an order stored before they were kept. */
  details?: SalesOrderDetails | Record<string, never> | null;
}

const fresh = (over: Partial<RecordResolution>): RecordResolution => ({ existing: "none", existingBatchId: null, existingId: null, partyId: null, refId: null, collectionCompanyId: null, attention: [], invalid: null, note: null, ...over });

/**
 * What the WMS says about one sales order: already here, or new and linked to
 * its customer and products, or held back with the reason on the row that
 * caused it.
 */
export function resolveSalesOrder(rec: DocumentRecord, m: SalesOrderMasters, links: SalesOrderLinks, existing: ExistingSalesOrder | undefined, collect: MatchCollector): RecordResolution {
  const firstRow = rec.rowNos[0]!;
  const rowInvalid: Record<number, string[]> = {};
  const rowAttention: Record<number, string[]> = {};
  const push = (into: Record<number, string[]>, rowNo: number, message: string) => {
    (into[rowNo] ??= []).push(message);
  };
  const manual: string[] = [];

  // ── the customer ──
  let partyId: string | null = null;
  const found = findCustomer(m, rec.gstin, rec.partyKey);
  const linked = links.customers[rec.partyKey];
  if (found.kind === "one") {
    partyId = found.hit.id;
    collect.customer(rec.partyKey, rec.partyName, "matched", customerLabel(found.hit), found.hit.id, firstRow);
    if (partyKey(found.hit.name) !== rec.partyKey) push(rowAttention, firstRow, `Matched by GSTIN to "${found.hit.name}" in the Customer Master; the file calls it "${rec.partyName}".`);
  } else if (linked && m.customerById.has(linked)) {
    const hit = m.customerById.get(linked)!;
    partyId = hit.id;
    collect.customer(rec.partyKey, rec.partyName, "manual", customerLabel(hit), hit.id, firstRow);
    manual.push(`Customer "${rec.partyName}" was matched by hand to "${customerLabel(hit)}".`);
  } else if (found.kind === "many") {
    collect.customer(rec.partyKey, rec.partyName, "ambiguous", null, null, firstRow);
    push(rowInvalid, firstRow, `${found.count} Customer Master records match "${rec.partyName}". Choose the right one under Match customers and items.`);
  } else {
    collect.customer(rec.partyKey, rec.partyName, "unmatched", null, null, firstRow);
    push(rowInvalid, firstRow, `"${rec.partyName}" isn't in the Customer Master. Match it under Match customers and items, or add the customer first.`);
  }
  // A second customer inside one voucher: the order can't belong to both.
  for (const l of rec.details ? rec.details.ledgers.filter((e) => !e.isParty).map((e) => ({ ...e, key: partyKey(e.name) })) : (rec.ledgers ?? [])) {
    if (l.key !== rec.partyKey && m.customersByKey.has(l.key)) push(rowInvalid, l.rowNo, `"${l.name}" is another customer in the Customer Master. One order can't belong to two customers.`);
  }

  // ── the products ──
  const lines: TallyLine[] = rec.lines.map((line) => {
    const rowNo = line.rowNo ?? firstRow;
    const name = line.item ?? "";
    const key = partyKey(name);
    const hit = findProduct(m, key);
    const pick = links.products[key];
    let target: ProductTarget | null = null;
    if (hit.kind === "one") {
      target = hit.hit;
      collect.product(key, name, "matched", target.label, target.ref, rowNo);
    } else if (pick && m.productByRef.has(pick)) {
      target = m.productByRef.get(pick)!;
      collect.product(key, name, "manual", target.label, target.ref, rowNo);
      const note = `Item "${name}" was matched by hand to "${target.label}".`;
      if (!manual.includes(note)) manual.push(note);
    } else if (hit.kind === "many") {
      collect.product(key, name, "ambiguous", null, null, rowNo);
      push(rowInvalid, rowNo, `${hit.count} items in the Product Master match "${name}". Choose the right one under Match customers and items.`);
    } else {
      collect.product(key, name, "unmatched", null, null, rowNo);
      push(rowInvalid, rowNo, m.inactiveKeys.has(key) ? `"${name}" is switched off in the Product Master. Match it to an active item under Match customers and items.` : `"${name}" isn't in the Product Master. Match it under Match customers and items, or add the item first.`);
    }
    if (target?.uom && line.uom && unitKey(target.uom) !== unitKey(line.uom)) push(rowAttention, rowNo, `Unit "${line.uom}" differs from the Product Master's "${target.uom}" for ${target.label}.`);
    return { ...line, productId: target?.productId ?? null, skuId: target?.skuId ?? null, productLabel: target?.label ?? null };
  });

  // ── the ledgers: every entry but the customer's, and every additional cost ──
  // Every entry but the customer's — the sales ledger carrying product lines included — and every additional cost.
  const entries = rec.details ? rec.details.ledgers.filter((e) => !e.isParty) : (rec.ledgers ?? []);
  const ledgerNames = [...entries.map((l) => ({ name: l.name, rowNo: l.rowNo })), ...(rec.details?.additionalCosts ?? []).map((a) => ({ name: a.ledger, rowNo: a.rowNo }))];
  const ledgerMatches = new Map<string, string | null>();
  for (const { name, rowNo } of ledgerNames) {
    const key = partyKey(name);
    if (!key || m.customersByKey.has(key)) continue; // a customer as a ledger is reported above
    if (m.ledgerByKey.size === 0) {
      collect.ledger(key, name, "unchecked", null, rowNo);
      continue;
    }
    const listed = m.ledgerByKey.get(key);
    const chosen = links.ledgers?.[key];
    const picked = chosen ? m.ledgerByKey.get(partyKey(chosen)) : undefined;
    if (listed) {
      collect.ledger(key, name, "matched", listed, rowNo);
      ledgerMatches.set(key, listed);
    } else if (picked) {
      collect.ledger(key, name, "manual", picked, rowNo);
      ledgerMatches.set(key, picked);
      const note = `Ledger "${name}" was matched by hand to "${picked}".`;
      if (!manual.includes(note)) manual.push(note);
    } else {
      collect.ledger(key, name, "unmatched", null, rowNo);
      push(rowInvalid, rowNo, `Ledger "${name}" isn't in the Sales Orders — Tally Ledgers list (Admin & Master Setup → Libraries). Match it under Match customers, items and ledgers, or ask an admin to add it.`);
    }
  }

  // ── already in the WMS? An existing order is never changed, whatever the file now says. ──
  if (existing) {
    // The whole order is compared, as the import would store it: an exact copy is a duplicate; ANY difference — a
    // corrected address, GST rate, delivery date, narration — is a changed version, listed for review, never dropped.
    const diffs = orderDifferences(existing, { ...rec, lines });
    if (diffs.length === 0) return fresh({ existing: "same", existingBatchId: existing.batch, existingId: existing.id, partyId, note: "Already in Sales Orders; skipped." });
    const kind = changeKind(diffs);
    const what = kind === "a different date" ? `a different date (${existing.documentDate})` : kind === "a different total" ? `a different total (₹${(existing.totalPaise / 100).toFixed(2)})` : kind;
    const message = `This voucher number is already in Sales Orders with ${what}: ${describeDifferences(diffs)}. The existing order is never overwritten; review it before importing this one.`;
    return fresh({ existing: "conflict", existingBatchId: existing.batch, existingId: existing.id, partyId, invalid: message, rowInvalid: { [firstRow]: [message] } });
  }

  const bad = Object.keys(rowInvalid).map(Number).sort((a, b) => a - b);
  // The listed ledger each entry was matched to is stored beside the name the file used.
  const listedAs = (name: string) => ledgerMatches.get(partyKey(name)) ?? null;
  const details = rec.details
    ? { ...rec.details, ledgers: rec.details.ledgers.map((e) => (e.isParty ? e : { ...e, listedAs: listedAs(e.name) })), additionalCosts: rec.details.additionalCosts.map((a) => ({ ...a, listedAs: listedAs(a.ledger) })) }
    : undefined;
  return fresh({ partyId, invalid: bad.length ? rowInvalid[bad[0]!]![0]! : null, rowInvalid: bad.length ? rowInvalid : undefined, rowAttention: Object.keys(rowAttention).length ? rowAttention : undefined, lines, details, manual: manual.length ? manual : undefined });
}
