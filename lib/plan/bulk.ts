/**
 * Bulk upload — reading and checking a pasted block or a spreadsheet.
 *
 * Fifty actions under one result in one gesture. Kept CLIENT-SAFE and separate
 * from the dialog: the reading and checking is worth a unit test, the dialog
 * is not.
 */

import { hasSchedule, type PlanKind } from "@/lib/plan/levels";

/**
 * The dialog refuses to preview more than this and the action refuses to
 * accept more, so a ten-thousand-line paste fails at the paste box with a
 * sentence rather than at the database with a timeout.
 */
export const BULK_MAX_ROWS = 300;

/** The six columns, and nothing else. */
export const BULK_FIELDS = [
  "name",
  "owner",
  "targetDate",
  "startDate",
  "endDate",
  "description",
] as const;

export type BulkField = (typeof BULK_FIELDS)[number];

/**
 * Header aliases, matched on a lower-cased, punctuation-free key.
 *
 * Bulk upload is for STRUCTURE. Priority, client, tags, links and attachments
 * are per-row judgements someone makes with the row in front of them, and a
 * spreadsheet column of them is a column nobody fills.
 */
const ALIASES: Record<BulkField, string[]> = {
  name: ["name", "title", "action", "task", "milestone", "result", "project", "subaction", "item", "activity", "particulars"],
  owner: ["owner", "assignee", "responsible", "doer", "assignedto", "person", "who"],
  targetDate: ["targetdate", "target", "due", "duedate", "deadline", "by", "bywhen", "completiondate"],
  startDate: ["startdate", "start", "from", "begin", "begins", "startson", "plannedstart"],
  endDate: ["enddate", "end", "to", "finish", "ends", "endson", "plannedend"],
  description: ["description", "desc", "remarks", "scope", "details", "notes", "comment", "comments"],
};

/** Lower-case and strip everything that is not a letter or a digit. */
export function normaliseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const ALIAS_LOOKUP: Map<string, BulkField> = new Map(
  BULK_FIELDS.flatMap((f) => ALIASES[f].map((a) => [a, f] as const)),
);

/** Which columns a level actually has somewhere to put. */
export function fieldsForLevel(kind: PlanKind): BulkField[] {
  return hasSchedule(kind)
    ? [...BULK_FIELDS]
    : BULK_FIELDS.filter((f) => f !== "startDate" && f !== "endDate");
}

/* ── Header detection ────────────────────────────────────────────────────── */

export interface HeaderMatch {
  /** Index of the header row in the grid, or -1 when there is none. */
  rowIndex: number;
  /** Column index → field. */
  columns: Map<number, BulkField>;
}

const HEADER_SCAN_ROWS = 10;

/**
 * Find the header row.
 *
 * Scans the first ten rows for TWO recognised columns — one is a coincidence
 * ("Name" is a common first cell), two is a header — then falls back to a
 * single hit, because a filled-in template usually has a title and a blank
 * line above the grid and people paste from halfway down a sheet.
 */
export function detectHeader(grid: string[][], allowed: BulkField[]): HeaderMatch {
  const allow = new Set(allowed);
  let best: HeaderMatch | null = null;
  let bestSingle: HeaderMatch | null = null;

  const limit = Math.min(HEADER_SCAN_ROWS, grid.length);
  for (let r = 0; r < limit; r++) {
    const columns = new Map<number, BulkField>();
    grid[r]!.forEach((cell, c) => {
      const field = ALIAS_LOOKUP.get(normaliseKey(cell ?? ""));
      // First column wins a duplicate header — a second "Notes" is a different
      // column that happens to share a name, not a correction of the first.
      if (field && allow.has(field) && ![...columns.values()].includes(field)) {
        columns.set(c, field);
      }
    });
    if (columns.size >= 2) {
      best = { rowIndex: r, columns };
      break;
    }
    if (columns.size === 1 && !bestSingle) bestSingle = { rowIndex: r, columns };
  }

  return best ?? bestSingle ?? { rowIndex: -1, columns: new Map() };
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Excel's day 0 is 1899-12-30 (the famous 1900 leap-year bug). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * Read `DD-MMM-YYYY`, `YYYY-MM-DD`, a real Excel date serial, and the common
 * regional forms. Returns a local `YYYY-MM-DD`, or null.
 *
 * Day-first for the ambiguous `x/y/zzzz`: this is an Indian business, where
 * 03/04/2026 is the third of April.
 */
export function parseBulkDate(input: string | number | null | undefined): string | null {
  if (input == null) return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    return fromExcelSerial(input);
  }

  const raw = String(input).trim();
  if (raw === "") return null;

  // An Excel serial that came through as text. Bounded so a bare "45" (which
  // is far more likely to be a typo than 1900-02-14) is not read as a date.
  if (/^\d{5}(\.\d+)?$/.test(raw)) return fromExcelSerial(Number(raw));

  // YYYY-MM-DD
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD-MMM-YYYY / DD MMM YY
  m = /^(\d{1,2})[-/\s]([A-Za-z]{3,4})[-/\s](\d{2,4})$/.exec(raw);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    if (mon === undefined) return null;
    return ymd(fullYear(Number(m[3])), mon + 1, Number(m[1]));
  }

  // MMM DD, YYYY
  m = /^([A-Za-z]{3,4})\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(raw);
  if (m) {
    const mon = MONTHS[m[1]!.toLowerCase()];
    if (mon === undefined) return null;
    return ymd(fullYear(Number(m[3])), mon + 1, Number(m[2]));
  }

  // DD/MM/YYYY — day first.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(raw);
  if (m) return ymd(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));

  return null;
}

function fromExcelSerial(serial: number): string | null {
  if (serial < 1 || serial > 200_000) return null;
  const d = new Date(EXCEL_EPOCH + Math.floor(serial) * 86_400_000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fullYear(y: number): number {
  return y >= 100 ? y : y >= 70 ? 1900 + y : 2000 + y;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(y, m - 1, d);
  // Rejects 31-Feb rather than silently rolling it to 3-Mar.
  if (probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/* ── Owner matching ──────────────────────────────────────────────────────── */

export interface RosterEntry {
  id: string;
  name: string;
  email?: string | null;
}

export type OwnerMatch =
  | { kind: "none" }
  | { kind: "matched"; id: string; name: string }
  | { kind: "ambiguous"; candidates: string[] };

/**
 * Exact normalised name → email → unique prefix.
 *
 * AMBIGUITY NEVER GUESSES: two Manans leave the cell empty and the row says
 * so, because the wrong doer on forty imported actions is forty notifications
 * to the wrong person.
 */
export function matchOwner(input: string, roster: readonly RosterEntry[]): OwnerMatch {
  const raw = input.trim();
  if (raw === "") return { kind: "none" };
  const key = normaliseKey(raw);
  if (key === "") return { kind: "none" };

  const exact = roster.filter((e) => normaliseKey(e.name) === key);
  if (exact.length === 1) return { kind: "matched", id: exact[0]!.id, name: exact[0]!.name };
  if (exact.length > 1) {
    return { kind: "ambiguous", candidates: exact.map((e) => e.name) };
  }

  const byEmail = roster.filter(
    (e) => e.email && e.email.trim().toLowerCase() === raw.toLowerCase(),
  );
  if (byEmail.length === 1) {
    return { kind: "matched", id: byEmail[0]!.id, name: byEmail[0]!.name };
  }

  // "Manan" finds Manan Vasa when he is the only Manan.
  const prefix = roster.filter((e) => normaliseKey(e.name).startsWith(key));
  if (prefix.length === 1) {
    return { kind: "matched", id: prefix[0]!.id, name: prefix[0]!.name };
  }
  if (prefix.length > 1) {
    return { kind: "ambiguous", candidates: prefix.map((e) => e.name) };
  }

  return { kind: "none" };
}

/* ── Row model ───────────────────────────────────────────────────────────── */

export type BulkIssue =
  | { level: "error"; code: "name-missing" | "name-too-long" | "end-before-start"; message: string }
  | { level: "warning"; code: "owner-unmatched" | "not-scheduled" | "duplicate-existing" | "duplicate-file"; message: string };

export interface BulkRow {
  /** Stable across re-evaluation so React keys and tick state survive. */
  key: string;
  name: string;
  ownerId: string | null;
  /** What the file said, kept so the row can explain an unmatched owner. */
  ownerText: string;
  targetDate: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  issues: BulkIssue[];
  /** Ticked for import. Anything with a blocking error is unticked and says why. */
  include: boolean;
}

export const NAME_MAX = 160;

export interface EvaluateOptions {
  kind: PlanKind;
  /** Names already sitting under the destination parent. */
  existingNames: readonly string[];
  /** Preserve the user's own tick decisions where the row is still valid. */
  previous?: readonly BulkRow[];
}

/** Does this row have a blocking problem? */
export function hasBlockingError(row: BulkRow): boolean {
  return row.issues.some((i) => i.level === "error");
}

/**
 * Check the WHOLE set, every time.
 *
 * "This name is repeated" only means anything in the company of the rows
 * around it, and editing a name has to be able to clear the flag on the row it
 * was clashing with.
 *
 * `include` is recomputed ONLY for rows that just became invalid — a clean row
 * keeps whatever the user ticked, or typing in one name box silently re-ticks
 * forty rows somebody had just unticked.
 */
export function evaluateBulkRows(
  rows: readonly BulkRow[],
  options: EvaluateOptions,
): BulkRow[] {
  const { kind, existingNames, previous } = options;
  const scheduled = hasSchedule(kind);
  const existing = new Set(existingNames.map(normaliseKey));
  const seenInFile = new Map<string, number>();
  const previousById = new Map((previous ?? []).map((r) => [r.key, r]));

  return rows.map((row) => {
    const issues: BulkIssue[] = [];
    const name = row.name.trim();

    if (name === "") {
      issues.push({
        level: "error",
        code: "name-missing",
        message: "Every row needs a name.",
      });
    } else if (name.length > NAME_MAX) {
      issues.push({
        level: "error",
        code: "name-too-long",
        message: `That name is ${name.length} characters — the limit is ${NAME_MAX}.`,
      });
    }

    if (row.startDate && row.endDate && row.endDate < row.startDate) {
      issues.push({
        level: "error",
        code: "end-before-start",
        message: "The end date is before the start date.",
      });
    }

    if (row.ownerText.trim() !== "" && !row.ownerId) {
      issues.push({
        level: "warning",
        code: "owner-unmatched",
        message: `No one on the roster matches "${row.ownerText.trim()}" — pick someone, or leave it and set the owner later.`,
      });
    }

    if (name !== "") {
      const key = normaliseKey(name);
      if (existing.has(key)) {
        issues.push({
          level: "warning",
          code: "duplicate-existing",
          message: "A row with this name is already under this parent.",
        });
      }
      const count = seenInFile.get(key) ?? 0;
      if (count > 0) {
        issues.push({
          level: "warning",
          code: "duplicate-file",
          message: "This name appears earlier in the file.",
        });
      }
      seenInFile.set(key, count + 1);
    }

    // A task-level row with no owner or no date will not become a task yet.
    // The importer fills both in, so this is a heads-up, not a blocker.
    if (scheduled && (!row.ownerId || !row.targetDate)) {
      issues.push({
        level: "warning",
        code: "not-scheduled",
        message: "No task yet — needs an owner and a target date.",
      });
    }

    const blocked = issues.some((i) => i.level === "error");
    const was = previousById.get(row.key);
    const wasBlocked = was ? hasBlockingError(was) : false;

    const include = blocked
      ? false
      : wasBlocked
        ? true // it just became valid — offer it
        : (was?.include ?? row.include);

    return { ...row, name, issues, include };
  });
}

/* ── Reading a paste or a sheet ──────────────────────────────────────────── */

/** Split a pasted block into a grid. Tabs first (Excel), then commas. */
export function parsePastedGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const useTabs = lines.some((l) => l.includes("\t"));
  return lines
    .filter((l) => l.trim() !== "")
    .map((line) => (useTabs ? line.split("\t") : splitCsvLine(line)).map((c) => c.trim()));
}

/** RFC-4180-ish: quotes protect commas, `""` is a literal quote. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface ReadResult {
  rows: BulkRow[];
  /** Set when the paste was over the cap and nothing was read. */
  error?: string;
}

/**
 * Turn a grid into rows.
 *
 * With no header at all, the FIRST COLUMN is the name — pasting a bare column
 * of names out of a document is the commonest case and should not require a
 * header line.
 */
export function readBulkGrid(
  grid: string[][],
  options: { kind: PlanKind; roster: readonly RosterEntry[]; existingNames: readonly string[] },
): ReadResult {
  const allowed = fieldsForLevel(options.kind);
  const header = detectHeader(grid, allowed);
  const body = header.rowIndex >= 0 ? grid.slice(header.rowIndex + 1) : grid;

  const dataRows = body.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (dataRows.length > BULK_MAX_ROWS) {
    return {
      rows: [],
      error: `That's ${dataRows.length} rows — the limit is ${BULK_MAX_ROWS}. Split the paste and import it in batches.`,
    };
  }

  const columnFor = (field: BulkField): number => {
    for (const [index, f] of header.columns) if (f === field) return index;
    return -1;
  };
  const nameCol = header.rowIndex >= 0 ? columnFor("name") : 0;
  const ownerCol = columnFor("owner");
  const targetCol = columnFor("targetDate");
  const startCol = columnFor("startDate");
  const endCol = columnFor("endDate");
  const descCol = columnFor("description");

  const cell = (row: string[], index: number): string =>
    index >= 0 ? (row[index] ?? "").trim() : "";

  const rows: BulkRow[] = dataRows.map((row, i) => {
    const ownerText = cell(row, ownerCol);
    const match = ownerText ? matchOwner(ownerText, options.roster) : { kind: "none" as const };
    return {
      key: `r${i}`,
      name: cell(row, nameCol >= 0 ? nameCol : 0),
      ownerId: match.kind === "matched" ? match.id : null,
      ownerText,
      targetDate: parseBulkDate(cell(row, targetCol)),
      startDate: parseBulkDate(cell(row, startCol)),
      endDate: parseBulkDate(cell(row, endCol)),
      description: cell(row, descCol) || null,
      issues: [],
      include: true,
    };
  });

  return {
    rows: evaluateBulkRows(rows, {
      kind: options.kind,
      existingNames: options.existingNames,
    }),
  };
}

/** The template's header line — exactly the columns this level can store. */
export function templateHeader(kind: PlanKind): string[] {
  const labels: Record<BulkField, string> = {
    name: "Name",
    owner: "Owner",
    targetDate: "Target Date",
    startDate: "Start Date",
    endDate: "End Date",
    description: "Description",
  };
  return fieldsForLevel(kind).map((f) => labels[f]);
}
