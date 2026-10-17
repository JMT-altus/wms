import { COLLECTION_RULES, type CollectionRules } from "../config";
import {
  TEXT_LIMIT,
  coordinatorLabel,
  displayName,
  exactNameKey,
  isUnassignedCoordinator,
  nameKey,
  paymentTermsText,
  sameValue,
} from "./normalize";
import type { MasterSourceRow } from "./workbook";

/**
 * What an import of the company master would do, row by row. Pure — the server
 * runs it for the read-only preview and again, from scratch, at confirmation.
 *
 * Statuses:
 *   new        not in the Collection Master yet → would be inserted
 *   unchanged  already there with the same values (or the file adds nothing)
 *   changed    already there, the file has a DIFFERENT non-blank value; applied
 *              only if the admin accepts that row explicitly
 *   duplicate  repeats an earlier row for the same company with no conflict;
 *              skipped (the earlier row carries the values)
 *   rejected   cannot be imported: blank or unusable name, or rows for the same
 *              company that disagree with each other
 *
 * Safety rules:
 *   - a blank or placeholder cell never clears an existing value;
 *   - an existing assignment is never overwritten unless the admin accepts it;
 *   - two spellings of one company (same `nameKey`) are one company — the
 *     spelling already stored is kept;
 *   - a Client Master link is set only on insert and only when exactly one
 *     Client Master record has the same exact name; several is "ambiguous".
 */

export interface ExistingCompany {
  id: string;
  companyName: string;
  nameKey: string;
  coordinatorLabel: string | null;
  paymentTerms: string | null;
  customerMasterId: string | null;
}

export type RowStatus = "new" | "unchanged" | "changed" | "duplicate" | "rejected";
export type ClientMatch = "none" | "linked" | "ambiguous";

export interface FieldChange {
  field: "coordinatorLabel" | "paymentTerms";
  from: string | null;
  to: string | null;
}

export interface RowMessage {
  level: "error" | "warning" | "info";
  text: string;
}

export interface PlannedRow {
  rowNo: number;
  companyName: string;
  nameKey: string;
  status: RowStatus;
  coordinatorLabel: string | null;
  paymentTerms: string | null;
  /** The file had a placeholder such as XXX or "-" (treated as unassigned). */
  coordinatorPlaceholder: boolean;
  clientMatch: ClientMatch;
  clientMatchCount: number;
  /** Set only for a "new" row with exactly one Client Master match. */
  customerMasterId: string | null;
  existingId: string | null;
  changes: FieldChange[];
  duplicateOf: number | null;
  messages: RowMessage[];
}

export interface PlanSummary {
  rows: number;
  new: number;
  unchanged: number;
  changed: number;
  duplicate: number;
  rejected: number;
  newWithoutCoordinator: number;
  newWithoutPaymentTerms: number;
  placeholderCoordinators: number;
  clientLinked: number;
  clientAmbiguous: number;
  conflictGroups: number;
}

export interface MasterPlan {
  rows: PlannedRow[];
  summary: PlanSummary;
}

export interface PlanOptions {
  /** Which fields the admin mapped to a column. An unmapped field is never read or changed. */
  mapped: { coordinator: boolean; paymentTerms: boolean };
  rules?: CollectionRules;
}

export function buildMasterPlan(
  source: MasterSourceRow[],
  existing: ReadonlyMap<string, ExistingCompany>,
  clientIndex: ReadonlyMap<string, readonly string[]>,
  opts: PlanOptions,
): MasterPlan {
  const rules = opts.rules ?? COLLECTION_RULES;
  const out: PlannedRow[] = [];

  const base = (r: MasterSourceRow): PlannedRow => {
    const coord = opts.mapped.coordinator ? coordinatorLabel(r.coordinator, rules) : null;
    return {
      rowNo: r.rowNo,
      companyName: displayName(r.company),
      nameKey: nameKey(r.company),
      status: "new",
      coordinatorLabel: coord,
      paymentTerms: opts.mapped.paymentTerms ? paymentTermsText(r.paymentTerms) : null,
      coordinatorPlaceholder:
        opts.mapped.coordinator && r.coordinator.trim() !== "" && isUnassignedCoordinator(r.coordinator, rules),
      clientMatch: "none",
      clientMatchCount: 0,
      customerMasterId: null,
      existingId: null,
      changes: [],
      duplicateOf: null,
      messages: [],
    };
  };

  // 1. Row-level validity.
  const valid: PlannedRow[] = [];
  for (const r of source) {
    const p = base(r);
    if (!p.companyName) {
      p.status = "rejected";
      p.messages.push({ level: "error", text: "Company name is blank." });
    } else if (!p.nameKey) {
      p.status = "rejected";
      p.messages.push({ level: "error", text: "Company name has no letters or digits." });
    } else if (p.companyName.length > TEXT_LIMIT || (p.coordinatorLabel ?? "").length > TEXT_LIMIT || (p.paymentTerms ?? "").length > TEXT_LIMIT) {
      p.status = "rejected";
      p.messages.push({ level: "error", text: `A value is longer than ${TEXT_LIMIT} characters.` });
    } else {
      valid.push(p);
    }
    out.push(p);
  }

  // 2. Rows for the same company (same nameKey) within the file.
  const groups = new Map<string, PlannedRow[]>();
  for (const p of valid) groups.set(p.nameKey, [...(groups.get(p.nameKey) ?? []), p]);
  let conflictGroups = 0;
  const leads: PlannedRow[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      leads.push(g[0]!);
      continue;
    }
    const distinct = (vals: (string | null)[]) => {
      const seen: string[] = [];
      for (const v of vals) if (v !== null && !seen.some((s) => sameValue(s, v))) seen.push(v);
      return seen;
    };
    const coords = distinct(g.map((p) => p.coordinatorLabel));
    const terms = distinct(g.map((p) => p.paymentTerms));
    const rowList = g.map((p) => p.rowNo).join(", ");
    if (coords.length > 1 || terms.length > 1) {
      conflictGroups++;
      const what = [coords.length > 1 ? `coordinators (${coords.join(" / ")})` : "", terms.length > 1 ? `payment terms (${terms.join(" / ")})` : ""]
        .filter(Boolean)
        .join(" and ");
      for (const p of g) {
        p.status = "rejected";
        p.messages.push({ level: "error", text: `Rows ${rowList} are the same company with different ${what}. Fix the file; none of them is imported.` });
      }
      continue;
    }
    const lead = g[0]!;
    lead.coordinatorLabel = coords[0] ?? null;
    lead.paymentTerms = terms[0] ?? null;
    lead.coordinatorPlaceholder = lead.coordinatorLabel === null && g.some((p) => p.coordinatorPlaceholder);
    lead.messages.push({ level: "info", text: `Also listed in row${g.length > 2 ? "s" : ""} ${g.slice(1).map((p) => p.rowNo).join(", ")} (same company).` });
    leads.push(lead);
    for (const p of g.slice(1)) {
      p.status = "duplicate";
      p.duplicateOf = lead.rowNo;
      p.messages.push({ level: "info", text: `Same company as row ${lead.rowNo}; skipped.` });
    }
  }

  // 3. Against what is already stored, and against the Client Master.
  for (const p of leads) {
    const ex = existing.get(p.nameKey);
    const matches = clientIndex.get(exactNameKey(p.companyName)) ?? [];
    p.clientMatchCount = matches.length;
    p.clientMatch = matches.length === 1 ? "linked" : matches.length > 1 ? "ambiguous" : "none";

    if (!ex) {
      p.status = "new";
      p.customerMasterId = p.clientMatch === "linked" ? matches[0]! : null;
      if (p.clientMatch === "ambiguous") {
        p.messages.push({ level: "warning", text: `${matches.length} Client Master records have this exact name, so it is not linked to any.` });
      }
      if (p.coordinatorLabel === null) {
        p.messages.push({
          level: "warning",
          text: p.coordinatorPlaceholder ? "Coordinator is a placeholder (e.g. XXX or -) — imported as Unassigned." : "No Sales Coordinator — imported as Unassigned.",
        });
      }
      if (p.paymentTerms === null) p.messages.push({ level: "warning", text: "No payment terms in the file — left blank." });
      continue;
    }

    p.existingId = ex.id;
    p.customerMasterId = ex.customerMasterId;
    if (ex.companyName !== p.companyName) {
      p.messages.push({ level: "info", text: `Already stored as "${ex.companyName}"; that spelling is kept.` });
    }
    if (opts.mapped.coordinator) {
      if (p.coordinatorLabel === null) {
        if (ex.coordinatorLabel !== null) p.messages.push({ level: "info", text: "File has no coordinator here; the existing assignment is kept." });
      } else if (!sameValue(ex.coordinatorLabel, p.coordinatorLabel)) {
        p.changes.push({ field: "coordinatorLabel", from: ex.coordinatorLabel, to: p.coordinatorLabel });
      }
    }
    if (opts.mapped.paymentTerms) {
      if (p.paymentTerms === null) {
        if (ex.paymentTerms !== null) p.messages.push({ level: "info", text: "File has no payment terms here; the existing terms are kept." });
      } else if (!sameValue(ex.paymentTerms, p.paymentTerms)) {
        p.changes.push({ field: "paymentTerms", from: ex.paymentTerms, to: p.paymentTerms });
      }
    }
    p.status = p.changes.length > 0 ? "changed" : "unchanged";
    if (p.status === "changed") {
      p.messages.push({ level: "warning", text: "Differs from what is stored. Not applied unless you accept this row." });
    }
  }

  const count = (s: RowStatus) => out.filter((p) => p.status === s).length;
  const fresh = out.filter((p) => p.status === "new");
  return {
    rows: out,
    summary: {
      rows: out.length,
      new: count("new"),
      unchanged: count("unchanged"),
      changed: count("changed"),
      duplicate: count("duplicate"),
      rejected: count("rejected"),
      newWithoutCoordinator: fresh.filter((p) => p.coordinatorLabel === null).length,
      newWithoutPaymentTerms: fresh.filter((p) => p.paymentTerms === null).length,
      placeholderCoordinators: out.filter((p) => p.coordinatorPlaceholder).length,
      clientLinked: fresh.filter((p) => p.clientMatch === "linked").length,
      clientAmbiguous: out.filter((p) => p.clientMatch === "ambiguous" && (p.status === "new" || p.status === "changed" || p.status === "unchanged")).length,
      conflictGroups,
    },
  };
}
