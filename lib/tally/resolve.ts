import type { PlannedRow, TallyLine, TallyPlan } from "./plan";
import type { SalesOrderDetails } from "./sales-order-catalogue";

/**
 * Combines a file's plan with what the database knows. Pure, so the rules that
 * decide whether a row imports can be read and tested without a database.
 */

export interface RecordResolution {
  /** none = new; same = already here, identical; conflict = same identity, different details. */
  existing: "none" | "same" | "conflict";
  /** The batch that created the existing record: this one means a retry, not a duplicate. */
  existingBatchId: string | null;
  existingId?: string | null;
  partyId: string | null;
  refId: string | null;
  collectionCompanyId: string | null;
  attention: string[];
  invalid: string | null;
  note: string | null;
  /**
   * Sales Orders. Problems the masters found, on the rows that caused them: the
   * order is held back whole, and `invalid` is always set alongside.
   */
  rowInvalid?: Record<number, string[]>;
  /** Sales Orders: warnings that belong to one row (a unit that differs from the master's). */
  rowAttention?: Record<number, string[]>;
  /** Sales Orders: the product lines with their master links, as they will be stored. */
  lines?: TallyLine[];
  /** Sales Orders: the order's other details, with each ledger's listed name, as they will be stored. */
  details?: SalesOrderDetails;
  /** Sales Orders: matches a person made by hand, recorded with the import. */
  manual?: string[];
}

export type TallyImportRowStatus = "imported" | "skipped" | "rejected" | "failed";

/** The rows as validation shows them. */
export function resolveRows(plan: TallyPlan, resolutions: ReadonlyMap<string, RecordResolution>): PlannedRow[] {
  const flagged = new Set<string>();
  return plan.rows.map((row) => {
    const res = row.recordKey ? resolutions.get(row.recordKey) : undefined;
    if (!res || row.state === "invalid") return row;
    if (res.invalid && res.rowInvalid) {
      // The row that caused it says why; the rest of the order says which row that was.
      const own = res.rowInvalid[row.rowNo];
      if (own) return { ...row, state: "invalid", messages: own };
      const first = Math.min(...Object.keys(res.rowInvalid).map(Number));
      return { ...row, state: "invalid", messages: [`Not imported: row ${first} of this order has an error.`] };
    }
    if (res.invalid) return { ...row, state: "invalid", messages: [res.invalid] };
    if (res.existing === "same") return { ...row, state: "duplicate", messages: [res.note ?? "Already imported."] };
    if (row.state === "duplicate") return row;
    // A document's reference warnings belong on its first row, not on every line.
    const own = res.rowAttention?.[row.rowNo] ?? [];
    if (res.attention.length && !flagged.has(row.recordKey!)) {
      flagged.add(row.recordKey!);
      return { ...row, state: "attention", messages: [...row.messages, ...res.attention, ...own] };
    }
    if (own.length) return { ...row, state: "attention", messages: [...row.messages, ...own] };
    return row;
  });
}

export interface RowDecision {
  rowNo: number;
  status: TallyImportRowStatus;
  reason: string | null;
  recordKey: string | null;
}

/**
 * What the import does with each row and record. An invalid row is rejected and
 * recorded, never dropped. Attention rows need the person's opt-in, and a document
 * is all-or-nothing: if any of its rows is held back, none of it imports.
 */
export function importDecisions(plan: TallyPlan, resolutions: ReadonlyMap<string, RecordResolution>, includeAttention: boolean, batchId: string) {
  const rows = resolveRows(plan, resolutions);
  const held = new Set<string>();
  for (const r of rows) if (r.recordKey && r.state === "attention" && !includeAttention) held.add(r.recordKey);
  const records = new Map<string, "insert" | "skip">();
  for (const rec of plan.records) {
    const res = resolutions.get(rec.key);
    records.set(rec.key, !res?.invalid && res?.existing === "none" && !held.has(rec.key) ? "insert" : "skip");
  }
  const decided: RowDecision[] = rows.map((r) => {
    const res = r.recordKey ? resolutions.get(r.recordKey) : undefined;
    // Created by this same batch: a retry after an interruption, so the row did import.
    if (res?.existing === "same" && res.existingBatchId === batchId && r.state === "duplicate") return { rowNo: r.rowNo, status: "imported", reason: null, recordKey: null };
    if (r.state === "invalid") return { rowNo: r.rowNo, status: "rejected", reason: r.messages.join(" "), recordKey: null };
    if (r.state === "duplicate") return { rowNo: r.rowNo, status: "skipped", reason: r.messages.join(" "), recordKey: r.recordKey };
    if (r.recordKey && held.has(r.recordKey)) return { rowNo: r.rowNo, status: "skipped", reason: `Needs attention, not included: ${r.messages.join(" ") || "another line of this document does."}`, recordKey: r.recordKey };
    return { rowNo: r.rowNo, status: "imported", reason: null, recordKey: r.recordKey };
  });
  return { rows: decided, records };
}
