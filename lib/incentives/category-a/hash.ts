import { createHash } from "node:crypto";
import type { CategoryAInput, CategoryAResult } from "./types";

/** JSON with every object's keys sorted, so equal data always gives the same text (and hash). */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const sortBy = <T>(xs: readonly T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const byId = <T extends { id: string }>(xs: readonly T[], key?: (x: T) => string) => sortBy(xs, key ?? ((x) => x.id));

/** The input in a fixed order (lists sorted), so the order a database returns rows in never changes the hash. */
export function normalizeInput(i: CategoryAInput): CategoryAInput {
  return {
    ...i,
    orders: byId(i.orders),
    invoices: byId(i.invoices),
    receipts: byId(i.receipts),
    creditNotes: byId(i.creditNotes),
    preclosures: sortBy(i.preclosures, (p) => `${p.orderId}|${p.date}|${p.itemsValuePaise}`),
    events: byId(i.events),
    customers: byId(i.customers),
    repHistory: sortBy(i.repHistory, (r) => `${r.customerId}|${r.from}|${r.employeeId}`),
    attributions: sortBy(i.attributions, (a) => `${a.documentId}|${a.employeeId}`),
    employees: byId(i.employees),
    // Only present for a version that leaves Category B orders out of Category A (absent: the input is as it always was).
    ...(i.categoryBOrderIds ? { categoryBOrderIds: [...i.categoryBOrderIds].sort() } : {}),
    // category-a/2: only present when the loader found something it couldn't value or follow.
    ...(i.preclosureProblems ? { preclosureProblems: sortBy(i.preclosureProblems, (p) => `${p.orderId}|${p.date}|${p.reason}`) } : {}),
    ...(i.referencesIncomplete ? { referencesIncomplete: sortBy(i.referencesIncomplete, (r) => r.documentId) } : {}),
  };
}

export const inputsHash = (i: CategoryAInput) => sha(canonical(normalizeInput(i)));
/** The result's hash, without the day it was calculated on: the same figures from the same data hash the same. */
export const resultHash = (r: CategoryAResult) => sha(canonical({ ...r, asOf: undefined }));
