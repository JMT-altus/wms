import { createHash } from "node:crypto";
import { canonical } from "@/lib/incentives/category-a/hash";
import type { CategoryXInput, CategoryXResult } from "./types";

/** Categories C–G: input and result hashes over canonical JSON, with every list in a fixed order. */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sortBy = <T>(xs: readonly T[] | undefined, key: (x: T) => string) => (xs ? [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)) : undefined);
const byId = <T extends { id: string }>(xs: readonly T[] | undefined) => sortBy(xs, (x) => x.id);

export function normalizeInputX(i: CategoryXInput): CategoryXInput {
  const out: CategoryXInput = { ...i, employees: byId(i.employees)! };
  for (const k of ["orders", "customers", "invoices", "receipts", "creditNotes", "events", "cReviews", "leadBatches", "leadConversions", "meetings", "testimonials"] as const) if (i[k]) (out as unknown as Record<string, unknown>)[k] = byId(i[k] as { id: string }[]);
  if (i.repHistory) out.repHistory = sortBy(i.repHistory, (r) => `${r.customerId}|${r.from}|${r.employeeId}`);
  if (i.attributions) out.attributions = sortBy(i.attributions, (a) => `${a.documentId}|${a.employeeId}`);
  if (i.carry) out.carry = sortBy(i.carry.map((c) => ({ ...c, lots: byId(c.lots)! })), (c) => c.employeeId);
  if (i.incompleteReferences) out.incompleteReferences = { documentIds: [...new Set(i.incompleteReferences.documentIds)].sort(), customerIds: [...new Set(i.incompleteReferences.customerIds)].sort() };
  if (i.customerPartyKeys) out.customerPartyKeys = Object.fromEntries(Object.entries(i.customerPartyKeys).sort().map(([k, v]) => [k, [...v].sort()]));
  return out;
}
export const inputsHashX = (i: CategoryXInput) => sha(canonical(normalizeInputX(i)));
export const resultHashX = (r: CategoryXResult) => sha(canonical({ ...r, asOf: undefined }));
