import { createHash } from "node:crypto";
import { canonical } from "@/lib/incentives/category-a/hash";
import type { CategoryBInput, CategoryBResult } from "./types";

/** Category B's input and result hashes: canonical JSON (keys sorted) of the input with its lists in a fixed order. */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sortBy = <T>(xs: readonly T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const byId = <T extends { id: string }>(xs: readonly T[]) => sortBy(xs, (x) => x.id);

export function normalizeInputB(i: CategoryBInput): CategoryBInput {
  return {
    ...i,
    orders: byId(i.orders),
    invoices: byId(i.invoices),
    receipts: byId(i.receipts),
    creditNotes: byId(i.creditNotes),
    events: byId(i.events),
    customers: byId(i.customers),
    repHistory: sortBy(i.repHistory, (r) => `${r.customerId}|${r.from}|${r.employeeId}`),
    attributions: sortBy(i.attributions, (a) => `${a.documentId}|${a.employeeId}`),
    employees: byId(i.employees),
    products: byId(i.products),
    overrides: byId(i.overrides),
    earned: sortBy(i.earned, (e) => `${e.orderId}|${e.invoiceId}`),
  };
}

export const inputsHashB = (i: CategoryBInput) => sha(canonical(normalizeInputB(i)));
/** The result's hash, without the day it was calculated on. */
export const resultHashB = (r: CategoryBResult) => sha(canonical({ ...r, asOf: undefined }));
