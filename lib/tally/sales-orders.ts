import type { TallyMapping } from "./mapping";
import { describeDifferences, orderDifferences, type OrderDifference } from "./sales-order-compare";
import { BASE_CATALOGUE, COST_CENTRE_KEYS, isKeyed, isRequired, type ConfiguredField, type SoCatalogue } from "./sales-order-config";
import type { Cell, DocumentRecord, LedgerLine, PlanOptions, PlannedRow, RawRow, TallyLine, TallyPlan } from "./plan";
import { documentKey, financialYear, parseTallyAmount, parseTallyDateValue, parseTallyNumber, partyKey } from "./values";
import { deriveStateFromGstin, isPlausibleGstin } from "@/lib/masters/gstin";
import {
  SO_FIELDS,
  isIndia,
  officialState,
  parsePercent,
  parseYesNo,
  pickOption,
  soField,
  validHsn,
  validPincode,
  type SalesOrderDetails,
  type SoAdditionalCost,
  type SoAllocation,
  type SoField,
  type SoGst,
  type SoHsn,
  type SoLedgerEntry,
} from "./sales-order-catalogue";

/**
 * Sales Orders from TallyPrime's "Import data format" (the Accounting Voucher
 * sheet), every field in the Sales Order field catalogue
 * (./sales-order-catalogue). Pure: the browser runs this for the preview and
 * the server runs it again on what it is sent. The manual-entry form writes the
 * same rows (./sales-order-form), so it is checked by exactly this code too.
 *
 * THE FILE'S SHAPE. One row per ledger entry, product line or allocation. A
 * voucher's first row carries the voucher date, type and number and the
 * customer's ledger entry, whose Ledger Amount (Dr) is the order total. The
 * rows below it belong to the same voucher: their voucher number is blank, or
 * repeats the number. They hold:
 *   - product lines (Item Name, Billed Quantity, Item Rate, Item Rate per,
 *     Item Amount and the line's GST and HSN/SAC details), on the sales
 *     ledger's row or on rows with no ledger at all;
 *   - further allocations of the product line above (Item Allocations - … with
 *     no item of their own). A line's first allocation is on the line's row;
 *     a line with a single allocation may leave its quantity, rate, unit and
 *     amount blank, which then are the line's;
 *   - other ledger entries (tax, freight, discount, round-off) with no item;
 *   - cost-centre allocations of the ledger entry on their row (or the one
 *     above), and the order's additional costs.
 * Voucher-level fields (order details, dispatch, buyer, consignee, voucher
 * states…) may sit on any row of the voucher; the same field with two
 * different values in one voucher is an error. A "flattened" file — every row
 * repeating the voucher cells, the customer and the total, one item per row —
 * reads the same way.
 *
 * ONE VOUCHER = ONE SALES ORDER with every product line attached. A voucher is
 * its number within its financial year; a second block with that number is a
 * repeat when it says exactly the same thing and is refused when it doesn't —
 * never merged. Every field marked Y in the matrix is required (see the
 * catalogue for the few that apply only in some cases); quantity × rate less
 * discount must equal each amount; allocations must add up to their line; the
 * lines plus the other ledgers must add up to the total. An order with any
 * error is held back WHOLE: none of its rows import, and each says why.
 */

const EARLIEST = "2000-01-01";
/** Tally rounds a voucher to the rupee: a rupee either way is not an error. */
export const SO_TOLERANCE_PAISE = 100;
const isTotalRow = (s: string) => /^(grand\s*total|total|sub\s*total|closing balance|opening balance|carried over|brought forward)$/i.test(s.trim());
const blank = (r: RawRow) => r.cells.every((c) => !c.trim());
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const rupees = (paise: number) => `₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const near = (a: number, b: number) => Math.abs(a - b) <= SO_TOLERANCE_PAISE;
const sameText = (a: string, b: string) => squash(a).toLowerCase() === squash(b).toLowerCase();
/** The field's Tally name, quoted, for a message. */
const q = (key: string) => `“${fieldOf(key).tallyName}”`;

/** Type, financial year and number — the same identity every Tally document has. The customer is checked separately, never silently part of it. */
export const salesOrderIdentity = (fy: string, documentNo: string) => `sales-orders|${fy}|${documentKey(documentNo)}`;

/** Tally's own type is "Sales Order"; companies add theirs ("Sales Order - Export"). Anything else is another kind of voucher. */
export const isSalesOrderType = (v: string) => /sales\s*order/i.test(v);

/** What kind of change two versions of one voucher show, for the message (the differences themselves follow it). */
export function changeKind(diffs: readonly OrderDifference[]): string {
  const has = (label: string) => diffs.some((d) => d.label === label);
  if (has("Customer")) return "a different customer";
  if (has("Voucher Date")) return "a different date";
  if (has("Order total")) return "a different total";
  if (diffs.some((d) => d.label.startsWith('Item "'))) return "different product lines";
  return "different order details";
}

/**
 * The CORE of an order — customer, date, total and its lines' item, quantity and amount; line order doesn't matter.
 * Kept for callers that need only that; whether two versions are the same order is decided on their whole content
 * (./sales-order-compare).
 */
export function salesOrderSignature(o: { partyKey: string; documentDate: string; totalPaise: number; lines: readonly { item: string | null; quantity: number | null; amountPaise: number | null }[] }): string {
  const lines = o.lines.map((l) => JSON.stringify([partyKey(l.item ?? ""), l.quantity, l.amountPaise])).sort();
  return JSON.stringify([o.partyKey, o.documentDate, o.totalPaise, lines]);
}

/* ── the effective field configuration, by where each field lives ─────────── */

const HEAD = new Set(["documentNo", "documentDate", "voucherType"]);
const LINE_CORE = new Set(["itemName", "quantity", "rate", "lineAmount"]);
/** A ledger entry's name, amount and Dr/Cr are its identity; cost-centre fields are its allocations. The rest are its own fields. */
const ENTRY_CORE = new Set(["partyName", "amount", "drCr"]);

interface Ctx {
  c: SoCatalogue;
  /** Once per order: the voucher's own fields, order details, dispatch, buyer, consignee, voucher states (and custom order fields). */
  voucher: ConfiguredField[];
  consignee: ConfiguredField[];
  /** The rest of a product line: description, unit, discounts, MRP, GST and HSN/SAC, custom line fields. They need an item on their row. */
  itemExtra: ConfiguredField[];
  alloc: ConfiguredField[];
  /** A ledger entry's own fields: rate, narration, description, custom ledger fields. */
  entry: ConfiguredField[];
  cc: ConfiguredField[];
  addl: ConfiguredField[];
}

function makeCtx(c: SoCatalogue): Ctx {
  // A new order's fields only: the pre-close fields (marked "Update") change an existing order, on its own page.
  const active = c.fields.filter((f) => f.status === "active" && f.inImport && !f.workflow);
  return {
    c,
    voucher: active.filter((f) => f.scope === "voucher" && !HEAD.has(f.key)),
    consignee: active.filter((f) => f.level === "consignee"),
    itemExtra: active.filter((f) => f.scope === "item" && !LINE_CORE.has(f.key)),
    alloc: active.filter((f) => f.scope === "allocation"),
    entry: active.filter((f) => f.scope === "ledger" && !ENTRY_CORE.has(f.key) && !COST_CENTRE_KEYS.has(f.key)),
    cc: active.filter((f) => COST_CENTRE_KEYS.has(f.key)),
    addl: active.filter((f) => f.scope === "additionalCost"),
  };
}

/**
 * The configuration of the plan being made. The planner runs synchronously from start to finish, so it is set when a
 * plan starts and restored when it ends (planSalesOrders); between plans it is the Tally matrix itself.
 */
let CTX: Ctx = makeCtx(BASE_CATALOGUE);
/** A field as the current configuration has it (its narrowed values, its rule); the matrix's for a key it doesn't know. */
const fieldOf = (key: string): ConfiguredField | SoField => CTX.c.byKey.get(key) ?? soField(key);

/** A keyed field's value as stored (a custom field, or an x field the WMS offers): dates as yyyy-mm-dd, Yes/No and choices as spelled in their list, amounts in rupees. */
function storedCustom(f: SoField, raw: string): string {
  if (f.type === "date") return parseTallyDateValue(raw) ?? raw;
  if (f.type === "yesno") return parseYesNo(raw) === null ? raw : parseYesNo(raw) ? "Yes" : "No";
  if (f.type === "choice") return pickOption(f, raw) ?? raw;
  if (f.type === "amount") {
    const a = parseTallyAmount(raw);
    return a ? (a.paise / 100).toFixed(2) : raw;
  }
  if (f.type === "percent") return String(parsePercent(raw) ?? raw);
  return raw;
}
/** The keyed fields among these values (custom fields and the x fields the WMS offers), as stored; undefined when there are none. */
function customOf(fields: readonly ConfiguredField[], raw: Raw): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const f of fields) if (isKeyed(f) && raw[f.key]) out[f.key] = storedCustom(f, raw[f.key]!);
  return Object.keys(out).length ? out : undefined;
}

type Raw = Record<string, string>;
/** The filled cells of these fields on a row. */
function pick(fields: readonly SoField[], r: RawRow, cell: Cell): Raw {
  const out: Raw = {};
  for (const f of fields) {
    const v = squash(cell(r, f.key));
    if (v) out[f.key] = v;
  }
  return out;
}

/** A plain number of 0 or more ("18", "18 %", "1,000.5"), or null. */
function strictNumber(raw: string): number | null {
  const s = raw.replace(/,/g, "").replace(/\s*%$/, "").trim();
  if (!/^\d{1,13}(\.\d{1,6})?$/.test(s)) return null;
  return Number(s);
}

/** Why a filled cell isn't a valid value for its field, or null. `country` decides the state and pincode rules. */
function badValue(f: SoField, raw: string, country: string | null): string | null {
  const name = `“${f.tallyName}”`;
  switch (f.type) {
    case "date":
      return parseTallyDateValue(raw) ? null : `${name} "${raw}" can't be read as a date.`;
    case "amount": {
      const a = parseTallyAmount(raw);
      return !a ? `${name} "${raw}" isn't a valid amount.` : a.paise < 0 ? `${name} can't be negative.` : null;
    }
    case "number":
      return strictNumber(raw) === null ? `${name} "${raw}" isn't a number of 0 or more.` : null;
    case "percent":
      return parsePercent(raw) === null ? `${name} "${raw}" isn't a percentage from 0 to 100.` : null;
    case "yesno":
      return parseYesNo(raw) === null ? `${name} must be Yes or No, not "${raw}".` : null;
    case "choice":
      return pickOption(f, raw) ? null : `${name} "${raw}" isn't one of: ${f.options!.join(", ")}.`;
    case "gstin":
      return isPlausibleGstin(raw) ? null : `${name} "${raw}" isn't a valid 15-character GSTIN.`;
    case "state":
      return isIndia(country) && !officialState(raw) ? `${name} "${raw}" isn't the official GST name of an Indian state.` : null;
    case "pincode":
      return validPincode(raw, country) ? null : isIndia(country) ? `${name} "${raw}" isn't a 6-digit Indian pincode.` : `${name} "${raw}" isn't a valid pincode.`;
    case "hsn":
      return validHsn(raw) ? null : `${name} "${raw}" isn't a 4, 6 or 8-digit HSN/SAC code.`;
    default:
      return null;
  }
}

const amountOf = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const a = parseTallyAmount(raw);
  return a && a.paise >= 0 ? a.paise : null;
};
const percentOf = (raw: string | undefined): number | null => (raw ? parsePercent(raw) : null);
/** quantity × rate, less a percentage discount and then a discount amount: the value Tally works out for a line or an allocation. */
function expectedAmount(quantity: number, ratePaise: number, discPct: number | null, discountPaise: number | null): number {
  let v = Math.round(quantity * ratePaise);
  if (discPct) v = Math.round(v * (1 - discPct / 100));
  if (discountPaise) v -= discountPaise;
  return v;
}

/** "Disc% 10 and Discount ₹50.00", or "no discount". */
const discountText = (pct: number | null | undefined, paise: number | null | undefined) => [pct ? `Disc% ${pct}` : "", paise ? `Discount ${rupees(paise)}` : ""].filter(Boolean).join(" and ") || "no discount";

/**
 * Why a line's allocations don't add up to its Item Amount, in words a person can act on. A single delivery IS the
 * whole line, so a discount of its own that differs from the line's can't work; split deliveries before the line's
 * discount are told to carry their share of it.
 */
function allocationTotalProblem(allocations: readonly SoAllocation[], total: number, lineAmount: number, lineDiscPct: number | null, lineDiscount: number | null): string {
  const base = `The allocations of this line add up to ${rupees(total)}, not its Item Amount ${rupees(lineAmount)}.`;
  const lineHas = !!(lineDiscPct || lineDiscount);
  const ownOf = (a: SoAllocation) => !!(a.discPct || a.discountPaise);
  const differs = (a: SoAllocation) => (a.discPct ?? 0) !== (lineDiscPct ?? 0) || (a.discountPaise ?? 0) !== (lineDiscount ?? 0);
  if (allocations.length === 1 && differs(allocations[0]!)) {
    const a = allocations[0]!;
    return `This delivery comes to ${rupees(total)} with its own discount (${discountText(a.discPct, a.discountPaise)}), but the line comes to ${rupees(lineAmount)} with the line's (${discountText(lineDiscPct, lineDiscount)}). A single delivery is the whole line: give it the same Disc% and Discount Amount as the line, or leave them blank to use the line's.`;
  }
  if (allocations.length > 1 && lineHas && !allocations.some(ownOf)) return `${base} The line has a discount (${discountText(lineDiscPct, lineDiscount)}) and its deliveries have none: give each delivery its share of it as its own Disc% or Discount Amount.`;
  return base;
}

type Side = "dr" | "cr" | null;

interface AllocDraft {
  raw: Raw;
  rowNo: number;
}
interface LineDraft {
  line: TallyLine;
  /** The line's own cells: item, quantity, rate, unit, amount — the defaults of a single allocation. */
  core: Raw;
  extra: Raw;
  allocs: AllocDraft[];
  rowNo: number;
}

interface Block {
  /** open = the first block of its voucher; repeat = a later block with the same number; bad = its first row can't start an order. */
  kind: "open" | "repeat" | "bad";
  start: number;
  noKey: string | null;
  fy: string | null;
  rec: DocumentRecord | null;
  /** repeat: the order this block says again. */
  of: DocumentRecord | null;
  /** The first row of this block with an error. */
  badRow: number | null;
  groupKey: string;
  rows: PlannedRow[];
  /** The ledger whose item lines the rows below it may be listing. */
  lastLedger: LedgerLine | null;
  /** Voucher-level values, with the row each was first given on. */
  voucher: Map<string, { value: string; rowNo: number }>;
  lineDrafts: LineDraft[];
  /** Every ledger entry, the customer's first. */
  entries: SoLedgerEntry[];
  /** The entry a cost-centre row without a ledger of its own belongs to. */
  lastEntry: SoLedgerEntry | null;
  addl: SoAdditionalCost[];
  /** Each entry's own cells and each additional cost's, for the checks made once the whole order is read. */
  entryRaw: Map<SoLedgerEntry, Raw>;
  addlRaw: Map<SoAdditionalCost, Raw>;
}

function readSide(raw: string, errors: string[]): Side {
  if (!raw) return null;
  if (/^(dr\.?|debit)$/i.test(raw)) return "dr";
  if (/^(cr\.?|credit)$/i.test(raw)) return "cr";
  errors.push(`Dr/Cr "${raw}" isn't Dr or Cr.`);
  return null;
}

/** The product-line cells of a row, or null when the row carries none. Every problem is listed. */
function readLine(r: RawRow, cell: Cell, errors: string[], warnings: string[]): TallyLine | null {
  const item = squash(cell(r, "itemName"));
  const rawQty = cell(r, "quantity");
  const rawRate = cell(r, "rate");
  const rawAmount = cell(r, "lineAmount");
  const description = squash(cell(r, "itemDescription")) || null;
  const uom = squash(cell(r, "ratePer")) || null;
  if (!item && !rawQty && !rawRate && !rawAmount) return null;
  if (!item) errors.push("The item name is missing.");
  let quantity: number | null = null;
  if (!rawQty) errors.push("The quantity is missing.");
  else {
    quantity = parseTallyNumber(rawQty);
    if (quantity === null) errors.push(`Quantity "${rawQty}" isn't a number.`);
    else if (quantity <= 0) errors.push("The quantity must be more than zero.");
  }
  let ratePaise: number | null = null;
  if (!rawRate) errors.push(`${q("rate")} is required.`);
  else {
    const rate = parseTallyAmount(rawRate);
    if (!rate) errors.push(`Rate "${rawRate}" isn't a valid amount.`);
    else if (rate.paise < 0) errors.push("The rate can't be negative.");
    else ratePaise = rate.paise;
  }
  let amountPaise: number | null = null;
  if (!rawAmount) errors.push("The item amount is missing.");
  else {
    const amount = parseTallyAmount(rawAmount);
    if (!amount) errors.push(`Item amount "${rawAmount}" isn't a valid amount.`);
    else if (amount.paise < 0) errors.push("The item amount can't be negative.");
    else amountPaise = amount.paise;
  }
  const discPct = percentOf(squash(cell(r, "discPct")) || undefined);
  const discountPaise = amountOf(squash(cell(r, "discAmount")) || undefined);
  if (quantity !== null && quantity > 0 && ratePaise !== null && amountPaise !== null) {
    const expected = expectedAmount(quantity, ratePaise, discPct, discountPaise);
    if (!near(expected, amountPaise)) {
      errors.push(discPct || discountPaise ? `Item amount ${rupees(amountPaise)} doesn't equal quantity × rate less the discount (${rupees(expected)}).` : `Item amount ${rupees(amountPaise)} doesn't equal quantity × rate (${rupees(expected)}).`);
    }
  }
  if (amountPaise === 0 && (ratePaise ?? 0) === 0) warnings.push("This line has no value (a free item).");
  return { item: item || null, quantity, ratePaise, amountPaise, uom, description, dueDate: null, rowNo: r.rowNo };
}

/** A new ledger entry, its own fields read from its row; they are checked once the whole order is read (settleEntries). */
function newEntry(b: Block, r: RawRow, cell: Cell, entry: Omit<SoLedgerEntry, "rate" | "narration" | "description">): SoLedgerEntry {
  const e: SoLedgerEntry = { ...entry, rate: 0, narration: "", description: "" };
  b.entryRaw.set(e, pick(CTX.entry, r, cell));
  return e;
}

/** Voucher-level cells, allocations, cost centres and additional costs on any row of a voucher. */
function readRowExtras(b: Block, r: RawRow, cell: Cell, line: TallyLine | null, entryOnRow: SoLedgerEntry | null, hasLedger: boolean, errors: string[]) {
  for (const [key, value] of Object.entries(pick(CTX.voucher, r, cell))) {
    const seen = b.voucher.get(key);
    if (!seen) b.voucher.set(key, { value, rowNo: r.rowNo });
    else if (!sameText(seen.value, value)) errors.push(`${q(key)} "${value}" differs from row ${seen.rowNo} ("${seen.value}"). One order has one ${fieldOf(key).tallyName}.`);
  }
  const extra = pick(CTX.itemExtra, r, cell);
  const alloc = pick(CTX.alloc, r, cell);
  if (!hasLedger) {
    const strayEntry = Object.keys(pick(CTX.entry.filter((f) => f.isCustom), r, cell));
    if (strayEntry.length) errors.push(`${strayEntry.map(q).join(", ")} ${strayEntry.length === 1 ? "belongs" : "belong"} to a ledger entry, but this row has no ledger.`);
  }
  if (line) {
    const core = pick(SO_FIELDS.filter((f) => LINE_CORE.has(f.key) || f.key === "ratePer"), r, cell);
    b.lineDrafts.push({ line, core, extra, allocs: Object.keys(alloc).length ? [{ raw: alloc, rowNo: r.rowNo }] : [], rowNo: r.rowNo });
  } else {
    const stray = Object.keys(extra);
    if (stray.length) errors.push(`${stray.map(q).join(", ")} ${stray.length === 1 ? "belongs" : "belong"} to a product line, but this row has no item.`);
    if (Object.keys(alloc).length) {
      const last = b.lineDrafts[b.lineDrafts.length - 1];
      if (hasLedger) errors.push("An allocation row can't also be a ledger entry: put the allocation on its own row under its product line.");
      else if (!last) errors.push("This allocation comes before any product line of the order.");
      else last.allocs.push({ raw: alloc, rowNo: r.rowNo });
    }
  }
  const cc = pick(CTX.cc, r, cell);
  if (Object.keys(cc).length) {
    const target = entryOnRow ?? b.lastEntry;
    if (!target) errors.push("This cost-centre allocation comes before any ledger entry of the order.");
    else if (!cc.costCentre || !cc.costCentreAmount) errors.push(`${q("costCentre")} and ${q("costCentreAmount")} go together.`);
    else {
      const amount = parseTallyAmount(cc.costCentreAmount);
      if (!amount || amount.paise < 0) errors.push(`${q("costCentreAmount")} "${cc.costCentreAmount}" isn't a valid amount.`);
      else target.costCentres.push({ category: cc.categoryName ?? null, costCentre: cc.costCentre, amountPaise: amount.paise, rowNo: r.rowNo });
    }
  }
  const addl = pick(CTX.addl, r, cell);
  if (Object.keys(addl).length) {
    // An additional cost is its ledger with a percentage or an amount (Tally's own shape); custom fields ride along.
    const bad = Object.entries(addl).map(([key, value]) => badValue(fieldOf(key), value, null)).filter((m): m is string => !!m);
    if (!addl.addlCostLedger) errors.push(`${q("addlCostLedger")} is required with an additional cost.`);
    else if (!addl.addlCostPct && !addl.addlCostAmount) errors.push(`An additional cost needs ${q("addlCostPct")} or ${q("addlCostAmount")}.`);
    errors.push(...bad);
    if (addl.addlCostLedger && (addl.addlCostPct || addl.addlCostAmount) && !bad.length) {
      const custom = customOf(CTX.addl, addl);
      b.addl.push({ ledger: addl.addlCostLedger, percent: percentOf(addl.addlCostPct), amountPaise: amountOf(addl.addlCostAmount), rowNo: r.rowNo, ...(custom ? { custom } : {}) });
      b.addlRaw.set(b.addl[b.addl.length - 1]!, addl);
    }
  }
}

/** Plans with the configuration the caller passes (opts.soCatalogue), the Tally matrix when it passes none. */
export function planSalesOrders(rows: readonly RawRow[], cell: Cell, opts: PlanOptions): TallyPlan {
  const previous = CTX;
  CTX = makeCtx(opts.soCatalogue ?? BASE_CATALOGUE);
  try {
    return planWith(rows, cell, opts);
  } finally {
    CTX = previous;
  }
}

function planWith(rows: readonly RawRow[], cell: Cell, opts: PlanOptions): TallyPlan {
  const out: PlannedRow[] = [];
  const records = new Map<string, DocumentRecord>();
  const blocks: Block[] = [];
  let current: Block | null = null;
  const emit = (b: Block, row: Omit<PlannedRow, "block" | "groupKey">) => {
    const planned: PlannedRow = { ...row, block: b.start, groupKey: b.groupKey };
    out.push(planned);
    b.rows.push(planned);
  };

  for (const r of rows) {
    if (blank(r)) continue;
    const documentNo = squash(cell(r, "documentNo"));
    const partyName = squash(cell(r, "partyName"));
    if (isTotalRow(documentNo) || isTotalRow(partyName)) continue;
    const rawDate = cell(r, "documentDate");
    const rawType = squash(cell(r, "voucherType"));
    const rawAmount = cell(r, "amount");
    const rawSide = cell(r, "drCr");
    const noKey = documentNo ? documentKey(documentNo) : null;
    const rowDate = rawDate ? parseTallyDateValue(rawDate) : null;

    // A row with no voucher number continues the voucher above it. So does a row repeating its number, unless
    // other vouchers sat between them, or its date falls in another financial year (numbering restarts in April).
    const sameVoucher: boolean = current !== null && noKey !== null && noKey === current.noKey && !r.breakBefore && !(rowDate && current.fy && financialYear(rowDate) !== current.fy);
    if (current && (!documentNo || sameVoucher)) {
      const b: Block = current;
      if (b.kind === "bad") {
        emit(b, { rowNo: r.rowNo, state: "invalid", messages: [`Not imported: row ${b.start} of this order has an error.`], recordKey: null, hasLine: !!(cell(r, "itemName") || cell(r, "lineAmount")) });
        continue;
      }
      const rec = b.rec!;
      const recordKey = b.kind === "open" ? rec.key : null;
      const errors: string[] = [];
      const warnings: string[] = [];
      const which = documentNo ? "Same voucher number as" : "No voucher number, so this row continues the order on";
      if (rawDate && !rowDate) errors.push(`Date "${rawDate}" can't be read.`);
      else if (rowDate && rowDate !== rec.documentDate) errors.push(`${which} row ${b.start}, but a different date (${rowDate} vs ${rec.documentDate}).`);
      if (rawType && !isSalesOrderType(rawType)) errors.push(`Voucher type "${rawType}" isn't a Sales Order.`);
      else if (rawType && rec.voucherType && rawType.toLowerCase() !== rec.voucherType.toLowerCase()) errors.push(`${which} row ${b.start}, but a different voucher type ("${rawType}" vs "${rec.voucherType}").`);
      else if (rawType && !rec.voucherType) rec.voucherType = rec.adjustmentType = rawType;
      const columnSide = readSide(rawSide, errors);
      const line = readLine(r, cell, errors, warnings);
      let entryOnRow: SoLedgerEntry | null = null;
      if (partyName) {
        const pk = partyKey(partyName);
        const amount = rawAmount ? parseTallyAmount(rawAmount) : null;
        if (rawAmount && !amount) errors.push(`Ledger amount "${rawAmount}" isn't a valid amount.`);
        const side = columnSide ?? amount?.side ?? null;
        b.lastLedger = null;
        if (pk === rec.partyKey && side !== "cr") {
          // The customer's own line again (a flattened file): its amount is the order total on every row.
          if (amount && !near(Math.abs(amount.paise), rec.totalPaise)) errors.push(`${which} row ${b.start}, but a different order total (${rupees(amount.paise)} vs ${rupees(rec.totalPaise)}).`);
          entryOnRow = b.entries[0] ?? null;
        } else if (!rawAmount) {
          errors.push(`${q("amount")} is required for ledger "${partyName}".`);
        } else if (amount) {
          const paise = Math.abs(amount.paise);
          if (!line && side === "dr" && near(paise, rec.totalPaise)) {
            errors.push(`${which} row ${b.start}, but a different customer ("${partyName}" vs "${rec.partyName}").`);
          } else {
            // Another ledger: sales, tax, freight, a discount or round-off. With an item on its row it is the sales
            // ledger carrying that line: the lines count its value, so it stays out of the total (as Tally's own
            // layouts write its amount either as that line's or as all the lines'). Every entry is kept for the order.
            if (!line) {
              const ledger: LedgerLine = { name: partyName, key: pk, signedPaise: side === "dr" ? -paise : side === "cr" ? paise : amount.paise, side, itemsPaise: 0, rowNo: r.rowNo };
              rec.ledgers!.push(ledger);
              b.lastLedger = ledger;
            }
            entryOnRow = newEntry(b, r, cell, { name: partyName, isParty: false, amountPaise: paise, side, costCentres: [], rowNo: r.rowNo });
            b.entries.push(entryOnRow);
          }
        }
      } else if (rawAmount && !line) {
        errors.push("This row has a ledger amount but no ledger name.");
      } else if (line && b.lastLedger) {
        b.lastLedger.itemsPaise += Math.abs(line.amountPaise ?? 0);
      }
      if (entryOnRow) b.lastEntry = entryOnRow;
      if (line) rec.lines.push(line);
      readRowExtras(b, r, cell, line, entryOnRow, !!partyName, errors);
      const gstin = cell(r, "gstin").toUpperCase();
      if (gstin && !rec.gstin) rec.gstin = gstin;
      const ref = squash(cell(r, "referenceNo"));
      if (ref && !rec.referenceNo) rec.referenceNo = ref;
      const narration = squash(cell(r, "narration"));
      if (narration && !rec.narration) rec.narration = narration;
      rec.rowNos.push(r.rowNo);
      if (errors.length) {
        b.badRow ??= r.rowNo;
        emit(b, { rowNo: r.rowNo, state: "invalid", messages: errors, recordKey, hasLine: !!line });
      } else emit(b, { rowNo: r.rowNo, state: warnings.length ? "attention" : "valid", messages: warnings, recordKey, hasLine: !!line });
      continue;
    }

    // ── the first row of a voucher ────────────────────────────────────────
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!documentNo) errors.push("The voucher number is missing.");
    else if (!/[A-Za-z0-9]/.test(documentNo) || documentNo.length > 100) errors.push(`Voucher number "${documentNo.slice(0, 40)}" isn't valid.`);
    const pk = partyKey(partyName);
    if (!pk) errors.push("The customer (ledger name) is missing.");
    if (!rawDate) errors.push("The date is missing.");
    else if (!rowDate) errors.push(`Date "${rawDate}" can't be read.`);
    else if (rowDate < EARLIEST) errors.push(`Date ${rowDate} is too old to be a real order.`);
    else if (rowDate > opts.today) warnings.push(`Date ${rowDate} is in the future.`);
    if (rawType && !isSalesOrderType(rawType)) errors.push(`Voucher type "${rawType}" isn't a Sales Order.`);
    const total = rawAmount ? parseTallyAmount(rawAmount) : null;
    if (!rawAmount) errors.push("The ledger amount (order total) is missing.");
    else if (!total) errors.push(`Ledger amount "${rawAmount}" isn't a valid amount.`);
    else if (total.paise === 0) errors.push("The order total is zero.");
    const side = readSide(rawSide, errors) ?? total?.side ?? null;
    if (side === "cr") warnings.push("The customer's ledger line is Cr; a sales order debits the customer.");
    const line = readLine(r, cell, errors, warnings);
    const fy = rowDate ? financialYear(rowDate) : null;
    const key = fy && documentNo ? salesOrderIdentity(fy, documentNo) : null;
    const block: Block = { kind: "bad", start: r.rowNo, noKey, fy, rec: null, of: null, badRow: r.rowNo, groupKey: `bad:${r.rowNo}`, rows: [], lastLedger: null, voucher: new Map(), lineDrafts: [], entries: [], lastEntry: null, addl: [], entryRaw: new Map(), addlRaw: new Map() };
    blocks.push(block);
    current = block;
    if (errors.length || !rowDate || !key) {
      emit(block, { rowNo: r.rowNo, state: "invalid", messages: errors, recordKey: null, hasLine: !!line });
      continue;
    }
    // Every block of one voucher number travels to the server together, so a repeat is always seen as one.
    block.groupKey = key;
    const totalPaise = Math.abs(total!.paise);
    const seen = records.get(key);
    if (seen) {
      // The same voucher number again, after other vouchers. Saying the same thing → a repeat; anything else is refused.
      const what =
        seen.partyKey !== pk ? `customer ("${partyName}" vs "${seen.partyName}")`
        : seen.documentDate !== rowDate ? `date (${rowDate} vs ${seen.documentDate})`
        : seen.totalPaise !== totalPaise ? `order total (${rupees(totalPaise)} vs ${rupees(seen.totalPaise)})`
        : rawType && seen.voucherType && rawType.toLowerCase() !== seen.voucherType.toLowerCase() ? `voucher type ("${rawType}" vs "${seen.voucherType}")`
        : null;
      if (what) {
        emit(block, { rowNo: r.rowNo, state: "invalid", messages: [`Same voucher number as row ${seen.rowNos[0]}, but a different ${what}, so it can't be the same order.`], recordKey: null, hasLine: !!line });
        continue;
      }
    }
    const rec: DocumentRecord = {
      kind: "document",
      key,
      rowNos: [r.rowNo],
      documentType: "sales-orders",
      documentNo,
      documentDate: rowDate,
      financialYear: fy!,
      partyName,
      partyKey: pk,
      gstin: cell(r, "gstin").toUpperCase() || null,
      totalPaise,
      taxablePaise: null,
      taxPaise: null,
      refDocumentNo: null,
      paymentMode: null,
      referenceNo: squash(cell(r, "referenceNo")) || null,
      // The voucher type as Tally names it ("Sales Order", or the company's own).
      adjustmentType: rawType || null,
      dueDate: null,
      narration: squash(cell(r, "narration")) || null,
      lines: line ? [line] : [],
      voucherType: rawType || null,
      ledgers: [],
    };
    block.kind = seen ? "repeat" : "open";
    block.rec = rec;
    block.of = seen ?? null;
    block.badRow = null;
    // The customer's own entry: its rate, narration and description are fields of the order, not of its identity —
    // a gap there holds the order back (settleEntries) but doesn't stop the rest of it being read and checked.
    const partyEntry = newEntry(block, r, cell, { name: partyName, isParty: true, amountPaise: totalPaise, side: side ?? "dr", costCentres: [], rowNo: r.rowNo });
    block.entries.push(partyEntry);
    block.lastEntry = partyEntry;
    const extras: string[] = [];
    readRowExtras(block, r, cell, line, partyEntry, true, extras);
    if (!seen) records.set(key, rec);
    const rowErrors = extras;
    if (rowErrors.length) {
      block.badRow = r.rowNo;
      emit(block, { rowNo: r.rowNo, state: "invalid", messages: rowErrors, recordKey: seen ? null : key, hasLine: !!line });
    } else emit(block, { rowNo: r.rowNo, state: warnings.length ? "attention" : "valid", messages: warnings, recordKey: seen ? null : key, hasLine: !!line });
  }

  // ── whole-order checks, once every row of each order has been read ─────
  for (const b of blocks) {
    if (b.kind === "bad") continue;
    const rec = b.rec!;
    const first = b.rows[0]!;
    settleVoucher(b);
    settleEntries(b);
    settleAdditionalCosts(b);
    if (b.badRow === null) settleLines(b);
    if (b.badRow === null && b.kind === "repeat") {
      // The whole order is compared — every field, line, allocation and ledger — not just its total and lines.
      const diffs = orderDifferences(b.of!, rec);
      if (diffs.length === 0) {
        for (const p of b.rows) {
          p.state = "duplicate";
          p.messages = [`Repeats row ${b.of!.rowNos[0]} of this file.`];
        }
        continue;
      }
      first.state = "invalid";
      first.messages = [`Same voucher number as row ${b.of!.rowNos[0]}, but ${changeKind(diffs)}, so it can't be the same order: ${describeDifferences(diffs)}. Keep one version of the order in the file.`];
      b.badRow = b.start;
    }
    if (b.badRow === null) continue;
    // An order with an error on any row is held back whole: every other row of it says so.
    for (const p of b.rows) {
      if (p.state !== "invalid") {
        p.state = "invalid";
        p.messages = [`Not imported: row ${b.badRow} of this order has an error.`];
      }
    }
    if (b.kind === "open") records.delete(rec.key);
  }
  return { rows: out, records: [...records.values()] };
}

/* ── whole-order checks ──────────────────────────────────────────────────── */

const rowOf = (b: Block, rowNo: number) => b.rows.find((p) => p.rowNo === rowNo) ?? b.rows[0]!;
function fail(b: Block, rowNo: number, message: string) {
  const p = rowOf(b, rowNo);
  if (p.state !== "invalid") {
    p.state = "invalid";
    p.messages = [];
  }
  p.messages.push(message);
  b.badRow = b.badRow === null ? p.rowNo : Math.min(b.badRow, p.rowNo);
}
function warn(b: Block, rowNo: number, message: string) {
  const p = rowOf(b, rowNo);
  if (p.state === "invalid" || p.state === "duplicate") return;
  p.state = "attention";
  p.messages.push(message);
}

/** The voucher-level fields: every required field present (by the configuration: always, or while its condition holds), every value valid. */
function settleVoucher(b: Block) {
  const v = (key: string) => b.voucher.get(key)?.value ?? null;
  const consigneeGiven = CTX.consignee.some((f) => b.voucher.has(f.key));
  const missing: string[] = [];
  if (!b.rec!.voucherType) missing.push(fieldOf("voucherType").tallyName);
  for (const f of CTX.voucher) {
    if (b.voucher.has(f.key)) continue;
    if (f.level === "consignee" && !consigneeGiven) continue; // the buyer's details are used
    if (isRequired(f, v)) missing.push(f.tallyName);
  }
  if (missing.length) fail(b, b.start, `Required ${missing.length === 1 ? "field is" : "fields are"} blank: ${missing.map((m) => `“${m}”`).join(", ")}.`);

  const buyerCountry = v("buyerCountry");
  const consigneeCountry = v("consigneeCountry") ?? buyerCountry;
  for (const [key, { value, rowNo }] of b.voucher) {
    const f = fieldOf(key);
    const problem = badValue(f, value, f.level === "consignee" ? consigneeCountry : buyerCountry);
    if (problem) fail(b, rowNo, problem);
  }
  const date = b.rec!.documentDate;
  const orderDate = v("orderDate") ? parseTallyDateValue(v("orderDate")!) : null;
  if (orderDate && orderDate > date) warn(b, b.voucher.get("orderDate")!.rowNo, `${q("orderDate")} ${orderDate} is after the Voucher Date ${date}.`);
  // An optional voucher applies from its date up to this one: never an earlier date.
  const upto = v("applicableUpto") ? parseTallyDateValue(v("applicableUpto")!) : null;
  if (upto && upto < date) fail(b, b.voucher.get("applicableUpto")!.rowNo, `${q("applicableUpto")} ${upto} is before the Voucher Date ${date}.`);
  for (const [gstinKey, stateKey] of [["gstin", "buyerState"], ["consigneeGstin", "consigneeState"]] as const) {
    const g = v(gstinKey);
    const s = v(stateKey);
    const fromCode = g && isPlausibleGstin(g) ? deriveStateFromGstin(g) : null;
    if (g && fromCode && s && officialState(s) && fromCode !== officialState(s)) warn(b, b.voucher.get(gstinKey)!.rowNo, `${q(gstinKey)} ${g.toUpperCase()} is registered in ${fromCode}, but ${q(stateKey)} is ${s}.`);
  }
}

/**
 * Every ledger entry's own fields (rate, narration, description, custom fields): required by the configuration —
 * always, on the customer's or the other entries only, or while a condition holds — and valid. A cost-centre field
 * made mandatory means every (applicable) entry carries an allocation.
 */
function settleEntries(b: Block) {
  const order = (key: string) => b.voucher.get(key)?.value ?? null;
  for (const e of b.entries) {
    const raw = b.entryRaw.get(e) ?? {};
    const kind = e.isParty ? "customer" : "other";
    const valueOf = (key: string) => raw[key] ?? order(key);
    for (const f of CTX.entry) {
      const value = raw[f.key];
      if (!value) {
        if (isRequired(f, valueOf, kind)) fail(b, e.rowNo, `“${f.tallyName}” is required for ledger "${e.name}"${f.key === "ledgerRate" ? " (0 where it has none)" : ""}.`);
        continue;
      }
      const problem = badValue(f, value, null);
      if (problem) fail(b, e.rowNo, problem);
    }
    for (const f of CTX.cc) {
      if (f.key === "categoryName") {
        for (const c of e.costCentres) if (!c.category && isRequired(f, (k) => (k === "costCentre" ? c.costCentre : valueOf(k)), kind)) fail(b, c.rowNo, `“${f.tallyName}” is required for the cost-centre allocation ${c.costCentre}.`);
      } else if (!e.costCentres.length && isRequired(f, valueOf, kind)) {
        fail(b, e.rowNo, `“${f.tallyName}” is required for ledger "${e.name}": give it a cost-centre allocation.`);
      }
    }
    e.rate = raw.ledgerRate ? (strictNumber(raw.ledgerRate) ?? 0) : 0;
    e.narration = raw.ledgerNarration ?? "";
    e.description = raw.ledgerDescription ?? "";
    const custom = customOf(CTX.entry, raw);
    if (custom) e.custom = custom;
  }
}

/**
 * Additional costs. A MATRIX additional-cost field made mandatory means the order must carry an additional cost; a
 * CUSTOM one made mandatory means each additional cost the order carries needs it.
 */
function settleAdditionalCosts(b: Block) {
  const order = (key: string) => b.voucher.get(key)?.value ?? null;
  if (!b.addl.length) {
    const needed = CTX.addl.filter((f) => !f.isCustom && isRequired(f, order));
    if (needed.length) fail(b, b.start, `This order needs an additional cost: ${needed.map((f) => `“${f.tallyName}”`).join(", ")} ${needed.length === 1 ? "is" : "are"} required.`);
    return;
  }
  for (const a of b.addl) {
    const raw = b.addlRaw.get(a) ?? {};
    const missing = CTX.addl.filter((f) => f.isCustom && !raw[f.key] && isRequired(f, (k) => raw[k] ?? order(k)));
    if (missing.length) fail(b, a.rowNo, `Required ${missing.length === 1 ? "field is" : "fields are"} blank on this additional cost: ${missing.map((f) => `“${f.tallyName}”`).join(", ")}.`);
  }
}

/** Product lines, allocations, ledgers and the total. Builds the order's stored details when everything holds. */
function settleLines(b: Block) {
  const rec = b.rec!;
  if (rec.lines.length === 0) return fail(b, b.start, "This order has no product line.");
  for (const d of b.lineDrafts) settleLine(b, d);
  for (const e of b.entries) {
    if (!e.costCentres.length) continue;
    const allocated = e.costCentres.reduce((n, c) => n + c.amountPaise, 0);
    if (!near(allocated, e.amountPaise)) warn(b, e.rowNo, `The cost-centre allocations of ledger "${e.name}" add up to ${rupees(allocated)}, not its ${rupees(e.amountPaise)}.`);
  }
  if (b.badRow !== null) return;

  const itemsSum = rec.lines.reduce((n, l) => n + Math.abs(l.amountPaise ?? 0), 0);
  // A ledger whose own item lines add up to it is their sales ledger: the lines already count it.
  const others = rec.ledgers!.reduce((n, l) => n + (l.itemsPaise > 0 && near(l.itemsPaise, Math.abs(l.signedPaise)) ? 0 : l.signedPaise), 0);
  if (!near(itemsSum + others, rec.totalPaise)) {
    const extra = others > 0 ? ` plus ${rupees(others)} of other ledgers` : others < 0 ? ` less ${rupees(others)} of other ledgers` : "";
    return fail(b, b.start, `The product lines add up to ${rupees(itemsSum)}${extra}, but the order total is ${rupees(rec.totalPaise)}.`);
  }
  if (others !== 0) rec.taxablePaise = itemsSum;
  rec.dueDate = rec.lines.map((l) => l.dueDate).filter((d): d is string => !!d).sort()[0] ?? null;
  if (rec.dueDate && rec.dueDate < rec.documentDate) warn(b, b.start, "The order is due before its own date.");
  rec.details = buildDetails(b);
}


/** One product line: its Y fields (with their GST/HSN conditions), every value, its GST/HSN and allocations. */
function settleLine(b: Block, d: LineDraft) {
  const { extra, line } = d;
  const errors: string[] = [];
  const order = (key: string) => b.voucher.get(key)?.value ?? null;
  // Every field of the line the configuration requires — always, or while its condition (on the line or the order) holds.
  const lineValue = (key: string) => extra[key] ?? d.core[key] ?? order(key);
  const missing = CTX.itemExtra.filter((f) => !extra[f.key] && isRequired(f, lineValue)).map((f) => f.key);
  const gstMode = extra.gstRateDetails ? pickOption(fieldOf("gstRateDetails"), extra.gstRateDetails) : null;
  const hsnMode = extra.hsnDetails ? pickOption(fieldOf("hsnDetails"), extra.hsnDetails) : null;
  if (missing.length) errors.push(`Required ${missing.length === 1 ? "field is" : "fields are"} blank on this product line: ${missing.map(q).join(", ")}.`);
  for (const [key, value] of Object.entries(extra)) {
    const problem = badValue(fieldOf(key), value, null);
    if (problem) errors.push(problem);
  }
  for (const e of errors) fail(b, d.rowNo, e);
  if (errors.length) return;

  const igst = percentOf(extra.igstRate);
  const cgst = percentOf(extra.cgstRate);
  const sgst = percentOf(extra.sgstRate);
  if (igst !== null && cgst !== null && sgst !== null && Math.abs(igst - (cgst + sgst)) > 1e-9) warn(b, d.rowNo, `${q("igstRate")} ${igst}% isn't ${q("cgstRate")} + ${q("sgstRate")} (${cgst}% + ${sgst}%).`);
  else if (cgst !== null && sgst !== null && Math.abs(cgst - sgst) > 1e-9) warn(b, d.rowNo, `${q("cgstRate")} ${cgst}% and ${q("sgstRate")} ${sgst}% differ.`);
  const taxablePaise = amountOf(extra.taxableValue)!;
  if (line.amountPaise !== null && !near(taxablePaise, line.amountPaise)) warn(b, d.rowNo, `${q("taxableValue")} ${rupees(taxablePaise)} differs from the Item Amount ${rupees(line.amountPaise)}.`);
  const gst: SoGst = {
    rateDetails: gstMode!,
    source: extra.gstSource ?? null,
    sourceType: extra.gstSourceType ? pickOption(fieldOf("gstSourceType"), extra.gstSourceType) : null,
    taxability: extra.gstTaxability ? pickOption(fieldOf("gstTaxability"), extra.gstTaxability) : null,
    nature: extra.gstNature ? pickOption(fieldOf("gstNature"), extra.gstNature) : null,
    classification: extra.gstClassification ?? null,
    igstRate: igst,
    cgstRate: cgst,
    sgstRate: sgst,
    reverseCharge: parseYesNo(extra.reverseCharge!)!,
    itcEligible: parseYesNo(extra.itcEligible!)!,
    taxablePaise,
  };
  const hsn: SoHsn = {
    details: hsnMode!,
    source: extra.hsnSource ?? null,
    sourceType: extra.hsnSourceType ? pickOption(fieldOf("hsnSourceType"), extra.hsnSourceType) : null,
    classification: extra.hsnClassification ?? null,
    code: extra.hsn ?? null,
    description: extra.hsnDescription ?? null,
  };

  // ── allocations ──
  const drafts = d.allocs.length ? d.allocs : [{ raw: {}, rowNo: d.rowNo }];
  const single = drafts.length === 1;
  const allocations: SoAllocation[] = [];
  for (const a of drafts) {
    const raw: Raw = { ...a.raw };
    if (single) {
      // A line with one allocation IS the line: its quantity, rate and unit are the line's when left blank, and so
      // is each of its discount fields (Disc%, Discount Amount) left blank. Its amount, when left blank, is the
      // line's amount while its discount is the line's; with a discount of its own it is worked out from it —
      // quantity × rate less ITS discount — and checked against the line, with the reason if the two differ.
      if (!raw.allocDiscPct) raw.allocDiscPct = extra.discPct ?? "";
      if (!raw.allocDiscAmount) raw.allocDiscAmount = extra.discAmount ?? "";
      const sameDiscount = (percentOf(raw.allocDiscPct) ?? 0) === (percentOf(extra.discPct) ?? 0) && (amountOf(raw.allocDiscAmount) ?? 0) === (amountOf(extra.discAmount) ?? 0);
      if (!raw.allocAmount && !sameDiscount) {
        const q = parseTallyNumber(raw.allocQuantity || d.core.quantity || "");
        const rate = amountOf(raw.allocRate || d.core.rate || undefined);
        if (q !== null && q > 0 && rate !== null) raw.allocAmount = (expectedAmount(q, rate, percentOf(raw.allocDiscPct), amountOf(raw.allocDiscAmount)) / 100).toFixed(2);
      }
      // Each allocation field that defaults from a field of its line (the matrix's own) takes the line's value.
      for (const f of CTX.alloc) if (f.defaultsFrom) raw[f.key] ??= d.core[f.defaultsFrom] ?? d.extra[f.defaultsFrom] ?? "";
      for (const k of Object.keys(raw)) if (!raw[k]) delete raw[k];
    }
    const aErrors: string[] = [];
    const allocValue = (key: string) => raw[key] ?? lineValue(key);
    const aMissing = CTX.alloc.filter((f) => !raw[f.key] && isRequired(f, allocValue)).map((f) => f.key);
    if (aMissing.length) aErrors.push(`Required ${aMissing.length === 1 ? "field is" : "fields are"} blank on this allocation: ${aMissing.map(q).join(", ")}.`);
    for (const [key, value] of Object.entries(raw)) {
      if (key === "allocQuantity") continue;
      const problem = badValue(fieldOf(key), value, null);
      if (problem) aErrors.push(problem);
    }
    if (!raw.allocQuantity || !raw.allocRate || !raw.allocRatePer || !raw.allocAmount) {
      // An allocation IS a quantity at a rate per unit making an amount: without them it can't be checked against its
      // line, whatever the configuration says (a single allocation takes them from its line). The due date is configurable.
      if (!aErrors.length) aErrors.push(`An allocation needs its ${["allocQuantity", "allocRate", "allocRatePer", "allocAmount"].filter((k) => !raw[k]).map(q).join(", ")}.`);
    }
    const quantity = raw.allocQuantity ? parseTallyNumber(raw.allocQuantity) : null;
    if (raw.allocQuantity && (quantity === null || quantity <= 0)) aErrors.push(`${q("allocQuantity")} "${raw.allocQuantity}" must be a number more than zero.`);
    if (aErrors.length) {
      for (const e of aErrors) fail(b, a.rowNo, e);
      continue;
    }
    const ratePaise = amountOf(raw.allocRate)!;
    const amountPaise = amountOf(raw.allocAmount)!;
    const discPct = percentOf(raw.allocDiscPct);
    const discountPaise = amountOf(raw.allocDiscAmount);
    const expected = expectedAmount(quantity!, ratePaise, discPct, discountPaise);
    if (!near(expected, amountPaise)) {
      fail(b, a.rowNo, `${q("allocAmount")} ${rupees(amountPaise)} doesn't equal its quantity × rate${discPct || discountPaise ? " less the discount" : ""} (${rupees(expected)}).`);
      continue;
    }
    if (line.uom && raw.allocRatePer && !sameText(line.uom, raw.allocRatePer)) warn(b, a.rowNo, `${q("allocRatePer")} "${raw.allocRatePer}" differs from the line's “Item Rate per” "${line.uom}".`);
    const allocCustom = customOf(CTX.alloc, raw);
    allocations.push({
      ...(allocCustom ? { custom: allocCustom } : {}),
      trackingNo: raw.allocTrackingNo ?? null,
      orderNo: raw.allocOrderNo ?? null,
      quantity: quantity!,
      ratePaise,
      ratePer: raw.allocRatePer!,
      amountPaise,
      dueDate: raw.dueDate ? parseTallyDateValue(raw.dueDate) : null,
      discPct,
      discountPaise,
      costTracking: raw.allocCostTracking ?? null,
      rowNo: a.rowNo,
    });
  }
  if (allocations.length !== drafts.length) return;
  const qty = allocations.reduce((n, a) => n + a.quantity, 0);
  const amount = allocations.reduce((n, a) => n + a.amountPaise, 0);
  if (line.quantity !== null && Math.abs(qty - line.quantity) > 1e-6) return fail(b, d.rowNo, `The allocations of this line add up to a quantity of ${qty}, not its Billed Quantity ${line.quantity}.`);
  if (line.amountPaise !== null && !near(amount, line.amountPaise)) return fail(b, d.rowNo, allocationTotalProblem(allocations, amount, line.amountPaise, percentOf(extra.discPct), amountOf(extra.discAmount)));

  line.description = extra.itemDescription ?? line.description ?? null;
  line.dueDate = allocations.map((a) => a.dueDate).filter((x): x is string => !!x).sort()[0] ?? null;
  line.discPct = percentOf(extra.discPct);
  line.discountPaise = amountOf(extra.discAmount);
  line.mrpPaise = amountOf(extra.mrp);
  line.allocations = allocations;
  line.gst = gst;
  line.hsn = hsn;
  const lineCustom = customOf(CTX.itemExtra, extra);
  if (lineCustom) line.custom = lineCustom;
}

function buildDetails(b: Block): SalesOrderDetails {
  const v = (key: string) => b.voucher.get(key)?.value ?? "";
  const opt = (key: string) => b.voucher.get(key)?.value ?? null;
  const choice = (key: string) => (b.voucher.has(key) ? pickOption(fieldOf(key), v(key)) : null);
  const state = (key: string, country: string) => (isIndia(country) ? (officialState(v(key)) ?? v(key)) : v(key));
  const sameAsBuyer = !CTX.consignee.some((f) => b.voucher.has(f.key));
  const custom = customOf(CTX.voucher, Object.fromEntries([...b.voucher].map(([k, x]) => [k, x.value])));
  const buyerCountry = v("buyerCountry");
  const consigneeCountry = sameAsBuyer ? buyerCountry : v("consigneeCountry");
  return {
    version: 1,
    voucher: {
      typeName: b.rec!.voucherType ?? "",
      seriesName: opt("seriesName"),
      narration: v("narration"),
      costCentreClass: v("costCentreClass"),
      voucherClass: opt("voucherClass"),
      priceLevel: opt("priceLevel"),
      gstRegistration: v("gstRegistration"),
    },
    order: { orderNos: v("referenceNo"), orderDate: parseTallyDateValue(v("orderDate")) ?? v("orderDate"), paymentTerms: v("paymentTerms"), otherReferences: v("otherReferences"), deliveryTerms: v("deliveryTerms") },
    dispatch: { dispatchedThrough: v("dispatchedThrough"), destination: v("destination"), carrier: v("carrier") },
    buyer: {
      billTo: v("buyerBillTo"),
      addressType: v("buyerAddressType"),
      mailingName: v("buyerMailingName"),
      address: v("buyerAddress"),
      country: buyerCountry,
      state: state("buyerState", buyerCountry),
      gstin: opt("gstin")?.toUpperCase() ?? null,
      pincode: v("buyerPincode"),
      registrationType: choice("buyerRegType") ?? v("buyerRegType"),
      billOfEntry: parseYesNo(v("buyerBillOfEntry")),
      section7: parseYesNo(v("buyerSec7")) ?? false,
      placeOfSupply: state("placeOfSupply", buyerCountry),
    },
    consignee: sameAsBuyer
      ? { sameAsBuyer: true, billTo: v("buyerBillTo"), addressType: v("buyerAddressType"), mailingName: v("buyerMailingName"), address: v("buyerAddress"), country: buyerCountry, state: state("buyerState", buyerCountry), gstin: opt("gstin")?.toUpperCase() ?? null, pincode: v("buyerPincode") }
      : { sameAsBuyer: false, billTo: v("consignee"), addressType: v("consigneeAddressType"), mailingName: v("consigneeMailingName"), address: v("consigneeAddress"), country: consigneeCountry, state: state("consigneeState", consigneeCountry), gstin: opt("consigneeGstin")?.toUpperCase() ?? null, pincode: v("consigneePincode") },
    supplyType: v("supplyType"),
    originalSalesNature: choice("originalSalesNature"),
    states: { optional: parseYesNo(v("isOptional")) ?? false, postDated: parseYesNo(v("isPostDated")) ?? false, cancelled: parseYesNo(v("isCancelled")) ?? false, changeMode: choice("changeMode") ?? v("changeMode") },
    ledgers: b.entries,
    additionalCosts: b.addl,
    ...(custom ? { custom } : {}),
  };
}

/* ── the order-level view of a validated file ────────────────────────────── */

export type SalesOrderState = "valid" | "attention" | "duplicate" | "invalid";

export interface SalesOrderLineView {
  rowNo: number;
  item: string;
  quantity: string;
  rate: string;
  unit: string;
  amountPaise: number | null;
  description: string;
  /** Order Due on of each allocation (yyyy-mm-dd when readable, else as written), the line's own first. */
  dueDates: string[];
  allocations: number;
  /** "IGST 18% · CGST 9% · SGST/UTGST 9%", or the GST Rate Details choice. */
  gst: string;
  hsn: string;
}

export interface SalesOrderLedgerView {
  rowNo: number;
  name: string;
  amountPaise: number | null;
  side: string;
}

export interface SalesOrderView {
  /** The first row of the block. */
  rowNo: number;
  state: SalesOrderState;
  /** A second copy of an order earlier in this same file. */
  repeatsInFile: boolean;
  rowNos: number[];
  documentNo: string;
  /** yyyy-mm-dd when the cell can be read, else the cell as written. */
  documentDate: string;
  partyName: string;
  totalPaise: number | null;
  lines: SalesOrderLineView[];
  /** The ledger entries other than the customer's. */
  ledgers: SalesOrderLedgerView[];
  /** A few voucher-level fields, as written, for the expanded order (empty when not given). */
  facts: { label: string; value: string }[];
  /** Every message on the order's rows, with the row it belongs to. */
  messages: { rowNo: number; text: string }[];
}

const FACT_KEYS = ["voucherType", "referenceNo", "orderDate", "paymentTerms", "deliveryTerms", "buyerBillTo", "buyerState", "gstin", "placeOfSupply", "consignee", "consigneeState", "dispatchedThrough", "destination", "carrier", "changeMode"] as const;

/** One entry per voucher block, in file order, from the rows as validation returned them and the file's own cells. */
export function salesOrderViews(planned: readonly PlannedRow[], fileRows: readonly RawRow[], mapping: TallyMapping, catalogue: SoCatalogue = BASE_CATALOGUE): SalesOrderView[] {
  const allocFields = catalogue.fields.filter((f) => f.status === "active" && f.scope === "allocation" && !f.workflow);
  const cells = new Map(fileRows.map((r) => [r.rowNo, r.cells]));
  const cell = (rowNo: number, field: string) => {
    const i = mapping[field];
    return i === undefined ? "" : (cells.get(rowNo)?.[i] ?? "").trim();
  };
  const blocks = new Map<number, PlannedRow[]>();
  for (const p of planned) {
    const k = p.block ?? p.rowNo;
    const g = blocks.get(k);
    if (g) g.push(p);
    else blocks.set(k, [p]);
  }
  const views: SalesOrderView[] = [];
  for (const [start, rows] of blocks) {
    const state: SalesOrderState = rows.some((r) => r.state === "invalid") ? "invalid" : rows.every((r) => r.state === "duplicate") ? "duplicate" : rows.some((r) => r.state === "attention") ? "attention" : "valid";
    const amount = parseTallyAmount(cell(start, "amount"));
    const rawDate = cell(start, "documentDate");
    const party = partyKey(cell(start, "partyName"));
    const lines: SalesOrderLineView[] = [];
    const ledgers: SalesOrderLedgerView[] = [];
    for (const r of rows) {
      const due = cell(r.rowNo, "dueDate");
      if (r.hasLine) {
        const igst = cell(r.rowNo, "igstRate");
        const cgst = cell(r.rowNo, "cgstRate");
        const sgst = cell(r.rowNo, "sgstRate");
        const rates = [igst && `IGST ${igst.replace(/\s*%$/, "")}%`, cgst && `CGST ${cgst.replace(/\s*%$/, "")}%`, sgst && `SGST/UTGST ${sgst.replace(/\s*%$/, "")}%`].filter(Boolean).join(" · ");
        lines.push({
          rowNo: r.rowNo,
          item: cell(r.rowNo, "itemName"),
          quantity: cell(r.rowNo, "quantity"),
          rate: cell(r.rowNo, "rate"),
          unit: cell(r.rowNo, "ratePer"),
          amountPaise: parseTallyAmount(cell(r.rowNo, "lineAmount"))?.paise ?? null,
          description: cell(r.rowNo, "itemDescription"),
          dueDates: due ? [parseTallyDateValue(due) ?? due] : [],
          allocations: 1,
          gst: rates || cell(r.rowNo, "gstRateDetails"),
          hsn: cell(r.rowNo, "hsn") || cell(r.rowNo, "hsnDetails"),
        });
      } else if (lines.length && allocFields.some((f) => cell(r.rowNo, f.key))) {
        const last = lines[lines.length - 1]!;
        last.allocations += 1;
        if (due) last.dueDates.push(parseTallyDateValue(due) ?? due);
      }
      const name = cell(r.rowNo, "partyName");
      if (name && r.rowNo !== start && partyKey(name) !== party) {
        const a = parseTallyAmount(cell(r.rowNo, "amount"));
        ledgers.push({ rowNo: r.rowNo, name, amountPaise: a ? Math.abs(a.paise) : null, side: cell(r.rowNo, "drCr") || (a?.side ? a.side.replace(/^./, (c) => c.toUpperCase()) : "") });
      }
    }
    const facts: { label: string; value: string }[] = [];
    for (const key of FACT_KEYS) {
      const value = rows.map((r) => cell(r.rowNo, key)).find(Boolean);
      const f = catalogue.byKey.get(key);
      if (value && f && f.status === "active") facts.push({ label: f.label === f.tallyName ? f.tallyName : `${f.label} (${f.tallyName})`, value });
    }
    views.push({
      rowNo: start,
      state,
      repeatsInFile: state === "duplicate" && rows[0]!.recordKey === null,
      rowNos: rows.map((r) => r.rowNo),
      documentNo: cell(start, "documentNo"),
      documentDate: parseTallyDateValue(rawDate) ?? rawDate,
      partyName: cell(start, "partyName"),
      totalPaise: amount ? Math.abs(amount.paise) : null,
      lines,
      ledgers,
      facts,
      messages: rows.flatMap((r) => r.messages.map((text) => ({ rowNo: r.rowNo, text }))),
    });
  }
  return views.sort((a, b) => a.rowNo - b.rowNo);
}

export interface SalesOrderSummary {
  /** Distinct sales orders in the file: a repeat of one earlier in the file isn't counted again. */
  orders: number;
  /** Product lines over the whole file. */
  lines: number;
  valid: number;
  invalid: number;
  duplicate: number;
  /** Orders that are importable but carry a warning (imported only with the opt-in). */
  warnings: number;
  /** Orders that will be written, and the product lines on them. */
  ready: number;
  readyLines: number;
}

export function summarizeSalesOrders(views: readonly SalesOrderView[], includeAttention: boolean): SalesOrderSummary {
  const n = (s: SalesOrderState) => views.filter((v) => v.state === s).length;
  const ready = views.filter((v) => v.state === "valid" || (includeAttention && v.state === "attention"));
  return {
    orders: views.filter((v) => !v.repeatsInFile).length,
    lines: views.reduce((a, v) => a + v.lines.length, 0),
    valid: n("valid"),
    invalid: n("invalid"),
    duplicate: n("duplicate"),
    warnings: n("attention"),
    ready: ready.length,
    readyLines: ready.reduce((a, v) => a + v.lines.length, 0),
  };
}
