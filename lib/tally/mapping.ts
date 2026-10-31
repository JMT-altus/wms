import { TALLY_CATEGORIES, requiredFields, type TallyCategoryKey, type TallyField } from "./categories";
import { parseTallyAmount, parseTallyDateValue, parseTallyNumber } from "./values";

/**
 * Tally column → WMS field mapping. Pure.
 *
 * A mapping is { fieldKey: columnIndex }. Suggestions come from the heading and
 * must also fit the column's data: a "Date" heading over text is not suggested,
 * so two incompatible things are never mapped silently. Each column maps to one
 * field at most.
 */
export type TallyMapping = Record<string, number>;

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Share of the column's filled sample cells that can be read as this field's type. */
export function columnFit(field: TallyField, samples: readonly string[]): number {
  const filled = samples.map((s) => s.trim()).filter(Boolean);
  if (filled.length === 0) return 1;
  const reads = (s: string) =>
    field.type === "date" ? parseTallyDateValue(s) !== null
    : field.type === "amount" ? parseTallyAmount(s) !== null
    : field.type === "number" ? parseTallyNumber(s) !== null
    : true;
  return filled.filter(reads).length / filled.length;
}

const MIN_FIT = 0.8;

export function suggestMapping(category: TallyCategoryKey, headers: readonly string[], sampleRows: readonly string[][], saved?: Record<string, string> | null): TallyMapping {
  const used = new Set<number>();
  const out: TallyMapping = {};
  const heads = headers.map(norm);
  const samplesOf = (i: number) => sampleRows.map((r) => r[i] ?? "");
  const fits = (field: TallyField, i: number) => columnFit(field, samplesOf(i)) >= MIN_FIT;
  const fields = TALLY_CATEGORIES[category].fields;
  // A saved mapping (by heading text) wins, as long as the column is here and still fits.
  for (const field of fields) {
    const want = saved?.[field.key];
    if (!want) continue;
    const i = heads.indexOf(norm(want));
    if (i >= 0 && !used.has(i) && fits(field, i)) {
      out[field.key] = i;
      used.add(i);
    }
  }
  // Required fields choose first, so an optional one can't take their column.
  const ordered = [...fields].sort((a, b) => Number(!!b.required) - Number(!!a.required));
  for (const field of ordered) {
    if (out[field.key] !== undefined) continue;
    for (const syn of field.synonyms) {
      const i = heads.findIndex((h, idx) => h === syn && !used.has(idx));
      if (i >= 0 && fits(field, i)) {
        out[field.key] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

/** The mapping as heading text, the form saved per category so it survives column reordering. */
export function mappingToHeadings(mapping: TallyMapping, headers: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(mapping).filter(([, i]) => headers[i]).map(([k, i]) => [k, headers[i]!.trim()]));
}

export interface MappingProblems {
  missingRequired: TallyField[];
  /** Columns claimed by more than one field. */
  duplicated: string[];
  /** Fields whose mapped column mostly can't be read as that type. */
  incompatible: { field: TallyField; column: string; fit: number }[];
}

export function checkMapping(category: TallyCategoryKey, mapping: TallyMapping, headers: readonly string[], sampleRows: readonly string[][]): MappingProblems {
  const missingRequired = requiredFields(category).filter((x) => mapping[x.key] === undefined);
  const counts = new Map<number, number>();
  for (const i of Object.values(mapping)) counts.set(i, (counts.get(i) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([i]) => headers[i] ?? `Column ${i + 1}`);
  const incompatible = TALLY_CATEGORIES[category].fields.flatMap((field) => {
    const i = mapping[field.key];
    if (i === undefined) return [];
    const fit = columnFit(field, sampleRows.map((r) => r[i] ?? ""));
    return fit < MIN_FIT ? [{ field, column: headers[i] ?? `Column ${i + 1}`, fit }] : [];
  });
  return { missingRequired, duplicated, incompatible };
}

export const mappingIsUsable = (p: MappingProblems) => p.missingRequired.length === 0 && p.duplicated.length === 0 && p.incompatible.length === 0;

/**
 * The header row of a sheet. Tally prints the company, report title and period
 * above the table, so the header is the first row (of the first 30) with the
 * most recognisable headings, not simply row one.
 */
export function findHeaderRow(category: TallyCategoryKey, grid: readonly string[][]): number {
  const known = new Set(TALLY_CATEGORIES[category].fields.flatMap((x) => x.synonyms));
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(30, grid.length); i++) {
    const score = (grid[i] ?? []).filter((c) => known.has(norm(c))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (bestScore > 0) return best;
  const first = grid.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
  return first < 0 ? 0 : first;
}
