import { COLLECTION_RULES, type CollectionRules } from "../config";
import {
  TEXT_LIMIT,
  coordinatorKey,
  coordinatorLabel,
  displayName,
  exactNameKey,
  isInvalidCoordinator,
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
  /** "client-master": about the Client Master link, not the file's data — the import preview leaves it out. */
  topic?: "client-master";
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
  /** Filled coordinator cells that can't be a name (no letter); imported as unassigned. */
  invalidCoordinators: number;
  /** Rows whose coordinator was written in another capitalisation and is shown in the common spelling. */
  coordinatorSpellingsUnified: number;
  /** Every coordinator in the file (common spelling) with how many rows name them. */
  coordinatorLabels: { label: string; rows: number }[];
  /** Coordinators not already in the Collection Master — check these are real people before importing. */
  newCoordinatorLabels: string[];
}

export interface MasterPlan {
  rows: PlannedRow[];
  summary: PlanSummary;
}

export interface PlanOptions {
  /** Which fields the admin mapped to a column. An unmapped field is never read or changed. */
  mapped: { coordinator: boolean; paymentTerms: boolean };
  rules?: CollectionRules;
  /**
   * Coordinator labels already stored in the Collection Master. Their spelling
   * wins when the file writes the same person in another case, and labels not
   * among them are listed as new in the preview.
   */
  knownCoordinatorLabels?: readonly string[];
}

export function buildMasterPlan(
  source: MasterSourceRow[],
  existing: ReadonlyMap<string, ExistingCompany>,
  clientIndex: ReadonlyMap<string, readonly string[]>,
  opts: PlanOptions,
): MasterPlan {
  const rules = opts.rules ?? COLLECTION_RULES;
  const out: PlannedRow[] = [];

  let invalidCoordinators = 0;
  const base = (r: MasterSourceRow): PlannedRow => {
    const invalid = opts.mapped.coordinator && isInvalidCoordinator(r.coordinator, rules);
    if (invalid) invalidCoordinators++;
    const coord = opts.mapped.coordinator && !invalid ? coordinatorLabel(r.coordinator, rules) : null;
    const row: PlannedRow = {
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
    if (invalid) {
      row.messages.push({ level: "warning", text: "The coordinator cell isn't a name (it has no letters) — imported as Unassigned. Check the file." });
    }
    return row;
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

  // 1b. One spelling per coordinator. The file writes the same person in several
  //     capitalisations ("MANGESH", "Mangesh", "mangesh"); shown as one person:
  //     the spelling already stored in the Collection Master, else the one the
  //     file uses most (ties: the first seen). Never mapped to an employee.
  const known = new Map<string, string>();
  for (const l of opts.knownCoordinatorLabels ?? []) {
    const k = coordinatorKey(l);
    if (k && !known.has(k)) known.set(k, cleanTextLabel(l));
  }
  const spellings = new Map<string, Map<string, number>>();
  for (const p of valid) {
    if (p.coordinatorLabel === null) continue;
    const k = coordinatorKey(p.coordinatorLabel);
    const m = spellings.get(k) ?? new Map<string, number>();
    m.set(p.coordinatorLabel, (m.get(p.coordinatorLabel) ?? 0) + 1);
    spellings.set(k, m);
  }
  const canonical = new Map<string, string>();
  for (const [k, m] of spellings) {
    let best = "";
    let bestN = -1;
    for (const [s, n] of m) if (n > bestN) [best, bestN] = [s, n]; // Map keeps first-seen order for ties
    canonical.set(k, known.get(k) ?? best);
  }
  let coordinatorSpellingsUnified = 0;
  for (const p of valid) {
    if (p.coordinatorLabel === null) continue;
    const c = canonical.get(coordinatorKey(p.coordinatorLabel))!;
    if (c !== p.coordinatorLabel) {
      coordinatorSpellingsUnified++;
      p.messages.push({ level: "info", text: `Coordinator written "${p.coordinatorLabel}" — shown as "${c}" (same person).` });
      p.coordinatorLabel = c;
    }
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
        p.messages.push({ level: "warning", text: `${matches.length} Client Master records have this exact name, so it is not linked to any.`, topic: "client-master" });
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
      invalidCoordinators,
      coordinatorSpellingsUnified,
      coordinatorLabels: [...canonical.entries()]
        .map(([k, label]) => ({ label, rows: [...(spellings.get(k)?.values() ?? [])].reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label)),
      newCoordinatorLabels: [...canonical.entries()].filter(([k]) => !known.has(k)).map(([, l]) => l).sort((a, b) => a.localeCompare(b)),
    },
  };
}

const cleanTextLabel = (s: string) => s.replace(/\s+/g, " ").trim();
