/**
 * Bulk-upload parsing for the Masters module.
 *
 * Pure and dependency-free so the browser can parse + preview a file before
 * anything is sent, the server can re-normalise what arrives (never trust the
 * client's coercion), and both paths stay unit-testable without a DB.
 *
 * Deliberately NOT a CSV library: the parser below is ~40 lines and handles
 * everything a Tally / Google Sheets / Excel "Save as CSV" export produces —
 * quoted fields, escaped quotes, CRLF, a UTF-8 BOM. Same reasoning as
 * components/admin/master/import-manager.tsx, which uses the same parser.
 */

import {
  CUSTOMER_SENSITIVITIES,
  CUSTOMER_SENSITIVITY_LABELS,
  PURCHASE_PATTERNS,
  PURCHASE_PATTERN_LABELS,
  type CustomerSensitivity,
  type PurchasePattern,
} from "@/db/enums";

export type BulkTarget = "products" | "customers";

export interface BulkField {
  key: string;
  label: string;
  /** Extra header spellings that should auto-map to this field. */
  aliases?: string[];
  required?: boolean;
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/** One row as the server receives it: keyed by FIELD, not by sheet header. */
export type MappedRow = Record<string, string>;

/**
 * What each master accepts. Only `name` is required — the brief is explicit
 * that a legacy row missing a classification must import with that column
 * blank rather than failing validation.
 */
export const BULK_FIELDS: Record<BulkTarget, BulkField[]> = {
  products: [
    { key: "name", label: "Name", aliases: ["product", "productname", "item", "itemname"], required: true },
    { key: "code", label: "Code", aliases: ["productcode", "itemcode", "sku", "partno", "partnumber"] },
    { key: "specification", label: "Specification", aliases: ["spec", "specs", "specification", "description", "details"] },
  ],
  customers: [
    { key: "name", label: "Name", aliases: ["customer", "customername", "party", "partyname", "account"], required: true },
    { key: "code", label: "Code", aliases: ["customercode", "partycode", "accountcode"] },
    { key: "customerCategory", label: "Category", aliases: ["customercategory", "type", "customertype", "channel"] },
    { key: "purchasePattern", label: "Purchase pattern", aliases: ["pattern", "buyingpattern", "frequency"] },
    { key: "sensitivity", label: "Sensitivity", aliases: ["behaviour", "behavior", "loyalty"] },
    { key: "salesRep", label: "Salesperson", aliases: ["salesrep", "rep", "salesperson", "owner", "executive"] },
  ],
};

/** Normalise a header or value for loose comparison: lowercase, letters only. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Minimal CSV parser — quoted fields, escaped quotes, CRLF, BOM. */
export function parseDelimited(text: string): ParsedSheet {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }

  const nonEmpty = out.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  // Strip a UTF-8 BOM off the first header or the mapper shows "﻿Name".
  const headers = nonEmpty[0]!.map((h, i) => (i === 0 ? h.replace(/^﻿/, "") : h).trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
  return { headers, rows };
}

/**
 * Guess header → field by exact-ish match on the key, the label or an alias,
 * so the common case ("Name,Code,Specification") needs zero clicks. A header
 * we don't recognise simply stays unmapped and its column is ignored.
 */
export function autoMap(headers: string[], target: BulkTarget): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const field of BULK_FIELDS[target]) {
    const candidates = [field.key, field.label, ...(field.aliases ?? [])].map(norm);
    const hit = headers.find((h) => !out[h] && candidates.includes(norm(h)));
    if (hit && !taken.has(field.key)) {
      out[hit] = field.key;
      taken.add(field.key);
    }
  }
  return out;
}

/** Re-key raw sheet rows by field, dropping unmapped columns. */
export function applyMapping(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
): MappedRow[] {
  return rows.map((row) => {
    const out: MappedRow = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (!field) continue;
      const v = (row[header] ?? "").trim();
      if (v.length > 0) out[field] = v;
    }
    return out;
  });
}

/**
 * Accept either the stored token ("one_time") or the label a human typed
 * ("One-time", "one time"). Anything unrecognised returns null — an unmapped
 * classification imports blank rather than guessing wrong.
 */
export function normalisePurchasePattern(raw: string | undefined): PurchasePattern | null {
  if (!raw) return null;
  const n = norm(raw);
  for (const p of PURCHASE_PATTERNS) {
    if (n === norm(p) || n === norm(PURCHASE_PATTERN_LABELS[p])) return p;
  }
  // "Regular (monthly)" typed as just "monthly", and the common shorthands.
  if (n === "monthly" || n === "regular") return "regular";
  if (n === "seasonal" || n === "season") return "seasonal";
  if (n === "onetime" || n === "onetimeonly" || n === "oneoff") return "one_time";
  return null;
}

export function normaliseSensitivity(raw: string | undefined): CustomerSensitivity | null {
  if (!raw) return null;
  const n = norm(raw);
  for (const s of CUSTOMER_SENSITIVITIES) {
    if (n === norm(s) || n === norm(CUSTOMER_SENSITIVITY_LABELS[s])) return s;
  }
  if (n === "costsensitive" || n === "cost" || n === "unloyal" || n === "pricedriven") return "cost_sensitive";
  if (n === "neutral") return "neutral";
  if (n === "loyal" || n === "relationship" || n === "relationshipbased") return "loyal";
  return null;
}

/**
 * Match a salesperson cell against the roster by name or email, case- and
 * punctuation-insensitively. Ambiguous or unknown → null (imports unassigned)
 * rather than picking the first partial hit: a customer silently allocated to
 * the wrong rep is worse than one left blank for someone to fix.
 */
export function matchSalesRep(
  raw: string | undefined,
  roster: { id: string; name: string; email: string }[],
): string | null {
  if (!raw) return null;
  const n = norm(raw);
  if (!n) return null;
  const hits = roster.filter((e) => norm(e.name) === n || norm(e.email) === n);
  return hits.length === 1 ? hits[0]!.id : null;
}

/** Rows whose required fields are present, and the count of those that aren't. */
export function splitUsableRows(
  rows: MappedRow[],
  target: BulkTarget,
): { usable: MappedRow[]; skipped: number } {
  const required = BULK_FIELDS[target].filter((f) => f.required).map((f) => f.key);
  const usable = rows.filter((r) => required.every((k) => (r[k] ?? "").length > 0));
  return { usable, skipped: rows.length - usable.length };
}
