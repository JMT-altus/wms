/**
 * DCC — bulk KPI configuration from pasted text.
 *
 * An administrator pastes a checklist (typed, or copied from the workbook) and
 * the app turns it into KPI definitions. Pure and client-safe: the same
 * parser runs in the browser for the live preview and on the server before
 * anything is written, so what was previewed is exactly what is applied.
 *
 * Format — one group per sheet tab, one KPI per line:
 *
 *   # BH – Bhavisha                         ← a line starting with "#" opens a group (the sheet tab's label)
 *   1 | Tally - Total Value of SO Recd | Daily | Number
 *   9 | Sales - Enquiry Funnel - Updated? | Sat / Tues | Yes/No
 *   4.1 | To whom & what brand? | | Text    ← an empty frequency is allowed and is NOT invented
 *
 * Columns are separated by "|" or by tabs (what Sheets puts on the clipboard):
 *   Sr No (optional) | Title | Frequency | Input type
 * Input type words: Number / Yes-No (also "Y/N", "Y/N/NA", "Boolean") / Text.
 * Nothing here names an employee: the label is whatever the sheet tab said,
 * and the administrator maps each label to a person in the preview.
 */

import { parseFrequency, type ParsedFrequency } from "@/lib/dcc/util";

export type BulkInputType = "number" | "yesno" | "text";

export interface BulkLine {
  /** 1-based line number in the pasted text, for error messages. */
  line: number;
  /** The sheet's Sr No, kept as the KPI code ("1", "4.1"); null when omitted. */
  sr: string | null;
  title: string;
  /** The frequency words exactly as typed; null when the cell was empty. */
  frequency: string | null;
  parsed: ParsedFrequency;
  inputType: BulkInputType | null;
  errors: string[];
  /** Advisory, not blocking: e.g. no frequency → ad-hoc tray. */
  notes: string[];
}

export interface BulkGroup {
  label: string;
  lines: BulkLine[];
  errors: string[];
}

export interface BulkParse {
  groups: BulkGroup[];
  /** Problems outside any group (text before the first header, unreadable lines). */
  errors: string[];
}

const HEADER = /^\s*#+\s*(.+?)\s*$/;

/** The canonical form a title is compared in: case and spacing do not make a new KPI. */
export function normaliseTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "Number", "num", "Y/N", "Yes/No", "boolean", "text" … → the stored vocabulary; null when unknown. */
export function normaliseInputType(raw: string | null | undefined): BulkInputType | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return null;
  if (/^(number|num|numeric|count|value|amount|integer|int|decimal|qty|quantity)$/.test(s)) return "number";
  if (/^(yesno|yn|y\/n|yes\/no|y\/n\/na|yesnona|yes\/no\/na|bool|boolean|binary|done|donenotdone)$/.test(s)) return "yesno";
  if (/^(text|string|freetext|free|note|notes|remark|remarks|description)$/.test(s)) return "text";
  return null;
}

function splitColumns(line: string): string[] {
  const cells = line.includes("\t") ? line.split("\t") : line.split("|");
  return cells.map((c) => c.trim());
}

const SR = /^\d+(\.\d+)?[a-z]?$/i;

export function parseBulkImport(text: string): BulkParse {
  const groups: BulkGroup[] = [];
  const errors: string[] = [];
  let current: BulkGroup | null = null;
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  rows.forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim()) return;
    const h = HEADER.exec(raw);
    if (h) {
      const label = h[1]!.replace(/\s+/g, " ");
      if (groups.some((g) => g.label.toLowerCase() === label.toLowerCase())) errors.push(`Line ${n}: group "${label}" appears twice`);
      current = { label, lines: [], errors: [] };
      groups.push(current);
      return;
    }
    if (!current) {
      errors.push(`Line ${n}: a KPI line before any group header — start with "# <sheet tab label>"`);
      return;
    }
    let cells = splitColumns(raw);
    // Sr No is optional: when the first cell is not a number, shift.
    let sr: string | null = null;
    if (cells.length >= 2 && SR.test(cells[0]!)) {
      sr = cells[0]!;
      cells = cells.slice(1);
    }
    // A sheet copy may carry trailing empty cells (the day columns) — drop them.
    while (cells.length > 3 && cells[cells.length - 1] === "") cells.pop();
    const [titleRaw = "", freqRaw = "", typeRaw = ""] = cells;
    const title = titleRaw.replace(/\s+/g, " ").trim();
    const frequency = freqRaw.trim() || null;
    const inputType = normaliseInputType(typeRaw);
    const parsed = parseFrequency(frequency);
    const lineErrors: string[] = [];
    const notes: string[] = [];
    if (!title) lineErrors.push("title is missing");
    if (title.length > 300) lineErrors.push("title is longer than 300 characters");
    if (cells.length > 3) lineErrors.push(`expected Sr No | Title | Frequency | Input type, found ${cells.length + (sr ? 1 : 0)} columns`);
    if (!typeRaw.trim()) lineErrors.push("input type is missing (Number, Yes/No or Text)");
    else if (!inputType) lineErrors.push(`input type "${typeRaw.trim()}" is not Number, Yes/No or Text`);
    if (!frequency) notes.push("no frequency: kept as written (ad-hoc tray, no daily cell) — not invented");
    else if (parsed.needsReview) lineErrors.push(`frequency "${frequency}" is not understood (try Daily, Weekly, Monthly, "Sat / Tues", "prev day")`);
    const line: BulkLine = { line: n, sr, title, frequency, parsed, inputType, errors: lineErrors, notes };
    if (title && current.lines.some((l) => normaliseTitle(l.title) === normaliseTitle(title))) line.errors.push(`duplicate of an earlier line in "${current.label}"`);
    current.lines.push(line);
  });
  for (const g of groups) if (g.lines.length === 0) g.errors.push("no KPI lines under this group");
  if (groups.length === 0 && errors.length === 0) errors.push('Nothing to import: start a group with "# <sheet tab label>" and list one KPI per line');
  return { groups, errors };
}

/* ── which person a sheet tab means ─────────────────────────────────── */

export interface BulkPerson {
  id: string;
  name: string;
}

/**
 * Suggest the roster entry a tab label refers to — only a suggestion, the
 * administrator confirms it. A label like "BH – Bhavisha" matches a person
 * whose first name appears in it, or whose initials equal a short token of it.
 * Ambiguity (two people match equally) suggests nobody. No names live here.
 */
export function suggestEmployee(label: string, people: readonly BulkPerson[]): BulkPerson | null {
  const tokens = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let best: { score: number; who: BulkPerson[] } = { score: 0, who: [] };
  for (const p of people) {
    const nameTokens = p.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (nameTokens.length === 0) continue;
    let score = 0;
    // Signals add up: the whole name, the first name, the initials ("AR" next
    // to "Asha" separates two Ashas), a short prefix of a single-word name.
    if (tokens.join(" ").includes(nameTokens.join(" "))) score += 4;
    else if (nameTokens[0]!.length >= 3 && tokens.includes(nameTokens[0]!)) score += 3;
    if (nameTokens.length >= 2 && tokens.includes(nameTokens.map((t) => t[0]!).join(""))) score += 2;
    if (score === 0 && nameTokens.length === 1 && tokens.some((t) => t.length >= 2 && t.length <= 3 && nameTokens[0]!.startsWith(t))) score += 1;
    if (score === 0) continue;
    if (score > best.score) best = { score, who: [p] };
    else if (score === best.score) best.who.push(p);
  }
  return best.who.length === 1 ? best.who[0]! : null;
}

/** Counts for the summary chips. */
export function countLines(groups: readonly BulkGroup[]): { groups: number; lines: number; invalid: number } {
  let lines = 0;
  let invalid = 0;
  for (const g of groups) {
    lines += g.lines.length;
    invalid += g.lines.filter((l) => l.errors.length > 0).length;
  }
  return { groups: groups.length, lines, invalid };
}
