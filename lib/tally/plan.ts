import { TALLY_CATEGORIES, TALLY_LIMITS, type TallyCategoryKey, type TallyDocumentType } from "./categories";
import type { TallyMapping } from "./mapping";
import { documentKey, financialYear, parseTallyAmount, parseTallyDateValue, parseTallyNumber, partyKey } from "./values";

/**
 * From raw rows to records, with every row accounted for. Pure: the browser runs
 * this for the preview and the server runs it again on what it is sent, because
 * nothing the browser worked out is trusted.
 *
 * Row states:
 *   valid      ready to import
 *   attention  importable, but someone should look (only imported if they opt in)
 *   duplicate  repeats an earlier row of this file; adds nothing
 *   invalid    can't be imported; the message says why
 *
 * Identity: a voucher is its type + financial year + document number, because
 * Tally restarts numbering each year and series. Purchase documents add the
 * vendor, since a supplier's bill number is only unique to that supplier. A
 * party's name or an amount is never treated as identity on its own.
 */

export type TallyRowState = "valid" | "attention" | "duplicate" | "invalid";

export interface RawRow {
  rowNo: number;
  cells: string[];
}

export interface PlannedRow {
  rowNo: number;
  state: TallyRowState;
  messages: string[];
  /** The record this row belongs to; rows sharing a key are lines of one document. */
  recordKey: string | null;
}

export interface TallyLine {
  item: string | null;
  quantity: number | null;
  ratePaise: number | null;
  amountPaise: number | null;
}

export interface PartyRecord {
  kind: "party";
  key: string;
  rowNos: number[];
  name: string;
  nameKey: string;
  code: string | null;
  gstin: string | null;
  pan: string | null;
  tallyGroup: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  creditDays: number | null;
}

export interface DocumentRecord {
  kind: "document";
  key: string;
  rowNos: number[];
  documentType: TallyDocumentType;
  documentNo: string;
  documentDate: string;
  financialYear: string;
  partyName: string;
  partyKey: string;
  gstin: string | null;
  totalPaise: number;
  taxablePaise: number | null;
  taxPaise: number | null;
  refDocumentNo: string | null;
  paymentMode: string | null;
  referenceNo: string | null;
  adjustmentType: string | null;
  dueDate: string | null;
  narration: string | null;
  lines: TallyLine[];
}

export interface OutstandingRecord {
  kind: "outstanding";
  key: string;
  rowNos: number[];
  direction: TallyDirection;
  asOfDate: string;
  partyName: string;
  partyKey: string;
  billRef: string | null;
  billDate: string | null;
  dueDate: string | null;
  originalPaise: number | null;
  pendingPaise: number;
  narration: string | null;
}

export type TallyRecord = PartyRecord | DocumentRecord | OutstandingRecord;
export type TallyDirection = "receivable" | "payable";

export interface PlanOptions {
  /** Outstanding only: the date the balances are as of, and which side of the ledger. */
  asOfDate?: string | null;
  direction?: TallyDirection | null;
  /** yyyy-mm-dd "today" in the business calendar, for future-date warnings. */
  today: string;
}

export interface TallyPlan {
  rows: PlannedRow[];
  records: TallyRecord[];
}

const EARLIEST = "2000-01-01";
/** Taxable + tax may differ from the total by Tally's own rounding. */
const ROUND_OFF_PAISE = 100;

const looksLikeTotalRow = (s: string) => /^(grand\s*total|total|sub\s*total|closing balance|opening balance|carried over|brought forward)$/i.test(s.trim());

export function planRows(category: TallyCategoryKey, rows: readonly RawRow[], mapping: TallyMapping, opts: PlanOptions): TallyPlan {
  const def = TALLY_CATEGORIES[category];
  const cell = (r: RawRow, key: string) => {
    const i = mapping[key];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };
  if (def.kind === "party") return planParties(category, rows, cell);
  if (def.kind === "outstanding") return planOutstanding(rows, cell, opts);
  return planDocuments(category as TallyDocumentType, rows, cell, opts);
}

type Cell = (r: RawRow, key: string) => string;

const blank = (r: RawRow) => r.cells.every((c) => !c.trim());

/* ── masters ─────────────────────────────────────────────────────────────── */

function planParties(category: TallyCategoryKey, rows: readonly RawRow[], cell: Cell): TallyPlan {
  const out: PlannedRow[] = [];
  const records = new Map<string, PartyRecord>();
  for (const r of rows) {
    if (blank(r)) continue;
    const name = cell(r, "name").replace(/\s+/g, " ");
    const messages: string[] = [];
    if (looksLikeTotalRow(name)) continue;
    const key = partyKey(name);
    if (!key) {
      out.push({ rowNo: r.rowNo, state: "invalid", messages: ["The name is missing."], recordKey: null });
      continue;
    }
    if (name.length > TALLY_LIMITS.cellChars) messages.push("The name is too long.");
    const gstin = cell(r, "gstin").toUpperCase() || null;
    const creditRaw = cell(r, "creditDays");
    const creditDays = creditRaw ? parseTallyNumber(creditRaw) : null;
    if (messages.length) {
      out.push({ rowNo: r.rowNo, state: "invalid", messages, recordKey: null });
      continue;
    }
    const recordKey = `${category}|${key}`;
    const seen = records.get(recordKey);
    if (seen) {
      seen.rowNos.push(r.rowNo);
      if (gstin && seen.gstin && gstin !== seen.gstin) out.push({ rowNo: r.rowNo, state: "invalid", messages: [`Same name as row ${seen.rowNos[0]} but a different GSTIN.`], recordKey: null });
      else out.push({ rowNo: r.rowNo, state: "duplicate", messages: [`Repeats row ${seen.rowNos[0]} of this file.`], recordKey });
      continue;
    }
    const warnings: string[] = [];
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) warnings.push(`"${gstin}" doesn't look like a GSTIN.`);
    if (creditRaw && creditDays === null) warnings.push(`Credit period "${creditRaw}" isn't a number, so it won't be stored.`);
    records.set(recordKey, {
      kind: "party",
      key: recordKey,
      rowNos: [r.rowNo],
      name,
      nameKey: key,
      code: cell(r, "code") || null,
      gstin,
      pan: cell(r, "pan").toUpperCase() || null,
      tallyGroup: cell(r, "tallyGroup") || null,
      phone: cell(r, "phone") || null,
      email: cell(r, "email") || null,
      address: cell(r, "address") || null,
      state: cell(r, "state") || null,
      creditDays: creditDays === null ? null : Math.trunc(creditDays),
    });
    out.push({ rowNo: r.rowNo, state: warnings.length ? "attention" : "valid", messages: warnings, recordKey });
  }
  return { rows: out, records: [...records.values()] };
}

/* ── vouchers ────────────────────────────────────────────────────────────── */

export function documentIdentity(type: TallyDocumentType, fy: string, documentNo: string, party: string): string {
  const base = `${type}|${fy}|${documentKey(documentNo)}`;
  return type === "purchase-invoices" || type === "debit-notes" || type === "vendor-payments" ? `${base}|${party}` : base;
}

function amountOf(r: RawRow, cell: Cell, key: string, label: string, errors: string[]): number | null {
  const raw = cell(r, key);
  if (!raw) return null;
  const a = parseTallyAmount(raw);
  if (!a) {
    errors.push(`${label} "${raw}" isn't a valid amount.`);
    return null;
  }
  return a.paise;
}

function planDocuments(type: TallyDocumentType, rows: readonly RawRow[], cell: Cell, opts: PlanOptions): TallyPlan {
  const out: PlannedRow[] = [];
  const records = new Map<string, DocumentRecord>();
  // A row's text as read, to tell an exact repeat from another line of the same voucher.
  const seenLines = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (blank(r)) continue;
    const documentNo = cell(r, "documentNo").replace(/\s+/g, " ");
    const partyName = cell(r, "partyName").replace(/\s+/g, " ");
    if (looksLikeTotalRow(partyName) || looksLikeTotalRow(documentNo)) continue;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!documentNo) errors.push("The document number is missing.");
    else if (!/[A-Za-z0-9]/.test(documentNo) || documentNo.length > 100) errors.push(`Document number "${documentNo.slice(0, 40)}" isn't valid.`);
    const pk = partyKey(partyName);
    if (!pk) errors.push("The party is missing.");
    const rawDate = cell(r, "documentDate");
    const documentDate = rawDate ? parseTallyDateValue(rawDate) : null;
    if (!rawDate) errors.push("The date is missing.");
    else if (!documentDate) errors.push(`Date "${rawDate}" can't be read.`);
    else if (documentDate < EARLIEST) errors.push(`Date ${documentDate} is too old to be a real document.`);
    else if (documentDate > opts.today) warnings.push(`Date ${documentDate} is in the future.`);
    const rawTotal = cell(r, "amount");
    const total = rawTotal ? parseTallyAmount(rawTotal) : null;
    if (!rawTotal) errors.push("The total amount is missing.");
    else if (!total) errors.push(`Total "${rawTotal}" isn't a valid amount.`);
    const taxablePaise = amountOf(r, cell, "taxableValue", "Taxable value", errors);
    const taxPaise = amountOf(r, cell, "taxAmount", "Tax amount", errors);
    const ratePaise = amountOf(r, cell, "rate", "Rate", errors);
    const lineAmount = amountOf(r, cell, "lineAmount", "Line amount", errors);
    const rawDue = cell(r, "dueDate");
    const dueDate = rawDue ? parseTallyDateValue(rawDue) : null;
    if (rawDue && !dueDate) errors.push(`Due date "${rawDue}" can't be read.`);
    const rawQty = cell(r, "quantity");
    const quantity = rawQty ? parseTallyNumber(rawQty) : null;
    if (rawQty && quantity === null) errors.push(`Quantity "${rawQty}" isn't a number.`);
    // Tally shows the voucher's value on one side; the sign carries no meaning here, zero does.
    const totalPaise = total ? Math.abs(total.paise) : 0;
    if (total && total.paise === 0) errors.push("The total is zero.");
    if (errors.length || !documentDate) {
      out.push({ rowNo: r.rowNo, state: "invalid", messages: errors, recordKey: null });
      continue;
    }
    if (total!.paise < 0) warnings.push("The total is negative in the file; it is stored as a positive value of this document type.");
    if (taxablePaise !== null && taxPaise !== null && Math.abs(Math.abs(taxablePaise) + Math.abs(taxPaise) - totalPaise) > ROUND_OFF_PAISE) warnings.push("Taxable value + tax doesn't equal the total.");
    if (dueDate && dueDate < documentDate) warnings.push("The due date is before the document date.");

    const fy = financialYear(documentDate);
    const key = documentIdentity(type, fy, documentNo, pk);
    const item = cell(r, "itemName") || null;
    const line: TallyLine = { item, quantity, ratePaise, amountPaise: lineAmount };
    const lineText = JSON.stringify([partyName, documentDate, rawTotal, item, rawQty, cell(r, "rate"), cell(r, "lineAmount")]);
    const seen = records.get(key);
    if (seen) {
      seen.rowNos.push(r.rowNo);
      const lines = seenLines.get(key)!;
      const first = lines.get(lineText);
      if (first !== undefined) {
        out.push({ rowNo: r.rowNo, state: "duplicate", messages: [`Repeats row ${first} of this file.`], recordKey: key });
        continue;
      }
      if (seen.partyKey !== pk || seen.documentDate !== documentDate || seen.totalPaise !== totalPaise || !item) {
        out.push({ rowNo: r.rowNo, state: "invalid", messages: [`Same document number as row ${seen.rowNos[0]} but different details, so it can't be a line of that document.`], recordKey: null });
        seen.rowNos.pop();
        continue;
      }
      lines.set(lineText, r.rowNo);
      seen.lines.push(line);
      out.push({ rowNo: r.rowNo, state: warnings.length ? "attention" : "valid", messages: warnings, recordKey: key });
      continue;
    }
    seenLines.set(key, new Map([[lineText, r.rowNo]]));
    records.set(key, {
      kind: "document",
      key,
      rowNos: [r.rowNo],
      documentType: type,
      documentNo,
      documentDate,
      financialYear: fy,
      partyName,
      partyKey: pk,
      gstin: cell(r, "gstin").toUpperCase() || null,
      totalPaise,
      taxablePaise: taxablePaise === null ? null : Math.abs(taxablePaise),
      taxPaise: taxPaise === null ? null : Math.abs(taxPaise),
      refDocumentNo: cell(r, "refDocumentNo") || null,
      paymentMode: cell(r, "paymentMode") || null,
      referenceNo: cell(r, "referenceNo") || null,
      adjustmentType: cell(r, "adjustmentType") || null,
      dueDate,
      narration: cell(r, "narration") || null,
      lines: item || lineAmount !== null ? [line] : [],
    });
    out.push({ rowNo: r.rowNo, state: warnings.length ? "attention" : "valid", messages: warnings, recordKey: key });
  }
  // Line values can only be compared once a document's rows are all read.
  for (const rec of records.values()) {
    const amounts = rec.lines.map((l) => l.amountPaise);
    if (amounts.length === 0 || amounts.some((a) => a === null)) continue;
    const sum = amounts.reduce<number>((a, b) => a + Math.abs(b!), 0);
    const target = rec.taxablePaise ?? rec.totalPaise;
    if (sum > target + ROUND_OFF_PAISE && sum > rec.totalPaise + ROUND_OFF_PAISE) {
      const row = out.find((p) => p.rowNo === rec.rowNos[0])!;
      row.state = "attention";
      row.messages.push("The line amounts add up to more than the document total.");
    }
  }
  return { rows: out, records: [...records.values()] };
}

/* ── outstanding ─────────────────────────────────────────────────────────── */

function planOutstanding(rows: readonly RawRow[], cell: Cell, opts: PlanOptions): TallyPlan {
  const out: PlannedRow[] = [];
  const records = new Map<string, OutstandingRecord>();
  const asOf = opts.asOfDate ?? null;
  const direction = opts.direction ?? null;
  for (const r of rows) {
    if (blank(r)) continue;
    const partyName = cell(r, "partyName").replace(/\s+/g, " ");
    if (looksLikeTotalRow(partyName)) continue;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!asOf) errors.push("Choose the date these balances are as of.");
    if (!direction) errors.push("Choose whether these are receivable or payable.");
    const pk = partyKey(partyName);
    if (!pk) errors.push("The party is missing.");
    const rawPending = cell(r, "pendingAmount");
    const pending = rawPending ? parseTallyAmount(rawPending) : null;
    if (!rawPending) errors.push("The pending amount is missing.");
    else if (!pending) errors.push(`Pending amount "${rawPending}" isn't a valid amount.`);
    const originalPaise = amountOf(r, cell, "originalAmount", "Original amount", errors);
    const rawBillDate = cell(r, "billDate");
    const billDate = rawBillDate ? parseTallyDateValue(rawBillDate) : null;
    if (rawBillDate && !billDate) errors.push(`Bill date "${rawBillDate}" can't be read.`);
    const rawDue = cell(r, "dueDate");
    const dueDate = rawDue ? parseTallyDateValue(rawDue) : null;
    if (rawDue && !dueDate) errors.push(`Due date "${rawDue}" can't be read.`);
    if (errors.length) {
      out.push({ rowNo: r.rowNo, state: "invalid", messages: errors, recordKey: null });
      continue;
    }
    if (billDate && asOf && billDate > asOf) warnings.push("The bill date is after the as-of date.");
    // An advance shows on the other side of the ledger; it is kept, negative, exactly as a credit against the party.
    const opposite = pending!.side && ((direction === "receivable" && pending!.side === "cr") || (direction === "payable" && pending!.side === "dr"));
    const pendingPaise = opposite ? -Math.abs(pending!.paise) : pending!.paise;
    if (pendingPaise < 0) warnings.push("This is a credit balance (an advance or excess).");
    const billRef = cell(r, "billRef") || null;
    const key = `${direction}|${pk}|${billRef ? documentKey(billRef) : `~row${r.rowNo}`}`;
    const seen = records.get(key);
    if (seen) {
      seen.rowNos.push(r.rowNo);
      if (seen.pendingPaise === pendingPaise) out.push({ rowNo: r.rowNo, state: "duplicate", messages: [`Repeats row ${seen.rowNos[0]} of this file.`], recordKey: key });
      else {
        seen.rowNos.pop();
        out.push({ rowNo: r.rowNo, state: "invalid", messages: [`Same party and bill as row ${seen.rowNos[0]} but a different amount.`], recordKey: null });
      }
      continue;
    }
    records.set(key, { kind: "outstanding", key, rowNos: [r.rowNo], direction: direction!, asOfDate: asOf!, partyName, partyKey: pk, billRef, billDate, dueDate, originalPaise, pendingPaise, narration: cell(r, "narration") || null });
    out.push({ rowNo: r.rowNo, state: warnings.length ? "attention" : "valid", messages: warnings, recordKey: key });
  }
  return { rows: out, records: [...records.values()] };
}

/* ── summary and chunks ──────────────────────────────────────────────────── */

export interface TallySummary {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  attention: number;
  ready: number;
}

/** `ready` excludes attention rows unless the person opted to include them. */
export function summarize(rows: readonly { state: TallyRowState }[], includeAttention: boolean): TallySummary {
  const count = (s: TallyRowState) => rows.filter((r) => r.state === s).length;
  const valid = count("valid");
  const attention = count("attention");
  return { total: rows.length, valid, invalid: count("invalid"), duplicate: count("duplicate"), attention, ready: valid + (includeAttention ? attention : 0) };
}

/**
 * Splits rows for the server, keeping every line of a document together: a chunk
 * is planned on its own there, so a split document would look like two.
 */
export function chunkRows(rows: readonly RawRow[], planned: readonly PlannedRow[], maxRows: number = TALLY_LIMITS.chunkRows, maxBytes: number = TALLY_LIMITS.chunkBytes): RawRow[][] {
  const keyOf = new Map(planned.map((p) => [p.rowNo, p.recordKey]));
  const groups = new Map<string, RawRow[]>();
  for (const r of rows) {
    const k = keyOf.get(r.rowNo) ?? `row:${r.rowNo}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const chunks: RawRow[][] = [];
  let cur: RawRow[] = [];
  let bytes = 0;
  for (const g of groups.values()) {
    const size = g.reduce((n, r) => n + JSON.stringify(r).length, 0);
    if (cur.length && (cur.length + g.length > maxRows || bytes + size > maxBytes)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(...g);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
