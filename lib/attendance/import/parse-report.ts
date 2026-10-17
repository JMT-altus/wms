import * as XLSX from "xlsx";

/**
 * Reads a biometric attendance export in the browser (nothing is uploaded).
 *
 * Two layouts are understood:
 *  - "block-report": the printed Daily Attendance Report — merged cells, one
 *    block per employee ("Employee Code: 12   Employee Name: …"), a header row
 *    (Date, InTime, OutTime, Shift, Total Duration, Status, Remarks) and one row
 *    per calendar day, followed by a "Total Duration=…" summary line.
 *  - "flat-table": a plain header row + one row per employee-day (the CSV shape).
 *
 * Only what is in the file is read. Shift, duration and status are carried for
 * display and checking — they are never used to work out attendance or pay.
 */

export interface SourceDay {
  /** 1-based sheet row, so a message can say where to look. */
  rowNo: number;
  /** ISO yyyy-mm-dd, or null when the date cell could not be read. */
  date: string | null;
  dateRaw: string;
  /** HH:mm (24h), or null when blank / unreadable. */
  inTime: string | null;
  outTime: string | null;
  shift: string | null;
  duration: string | null;
  /** Whitespace-collapsed source status — display only. */
  status: string | null;
  /** Reasons this row cannot be used (bad date, unreadable time, …). */
  problems: string[];
}

export interface SourceEmployee {
  /** Stable key within the file: the biometric employee code (or name when there is none). */
  key: string;
  code: string;
  name: string;
  department: string | null;
  days: SourceDay[];
}

export interface ParsedReport {
  sheet: string;
  layout: "block-report" | "flat-table";
  period: { from: string; to: string } | null;
  employees: SourceEmployee[];
  /** File-level problems (not row-level). */
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(/\s+/g, " ").trim();
};

/** Reads 01-Apr-2026, 2026-04-01, 01/04/2026 (day first), 01-04-2026 or an Excel serial. */
export function parseDateCell(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return null;
    const p = XLSX.SSF.parse_date_code(v);
    return p ? validYmd(p.y, p.m, p.d) : null;
  }
  if (v instanceof Date) return validYmd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  const s = cellText(v);
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]*(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    return mon ? validYmd(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** Reads H:mm, HH:mm, HH:mm:ss, "9:05 AM" or an Excel day fraction → "HH:mm"; null when blank. */
export function parseTimeCell(v: unknown): { time: string | null; bad: boolean } {
  if (v == null || v === "") return { time: null, bad: false };
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0 || v >= 1) return { time: null, bad: true };
    const mins = Math.round(v * 24 * 60);
    return { time: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`, bad: false };
  }
  const s = cellText(v);
  if (s === "" || s === "-" || s === "--" || s === "--:--") return { time: null, bad: false };
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(s);
  if (!m) return { time: null, bad: true };
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const ap = m[4]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return { time: null, bad: true };
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
  }
  if (h > 23 || mi > 59) return { time: null, bad: true };
  return { time: `${pad(h)}:${pad(mi)}`, bad: false };
}

type Row = unknown[];

function sheetRows(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

const HEADER_SYNONYMS = {
  code: ["employee code", "emp code", "employee id", "emp id", "code", "empcode", "userid", "user id"],
  name: ["employee name", "emp name", "name", "employee"],
  department: ["department", "dept"],
  date: ["date", "attendance date", "log date", "day"],
  inTime: ["intime", "in time", "in", "check in", "check-in", "punch in", "first in", "time in"],
  outTime: ["outtime", "out time", "out", "check out", "check-out", "punch out", "last out", "time out"],
  shift: ["shift"],
  duration: ["total duration", "duration", "work hours", "hours"],
  status: ["status", "attendance status"],
} as const;
type Field = keyof typeof HEADER_SYNONYMS;

const norm = (v: unknown) => cellText(v).toLowerCase().replace(/[:.]/g, "").trim();

function mapHeader(row: Row): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  row.forEach((cell, idx) => {
    const t = norm(cell);
    if (!t) return;
    for (const f of Object.keys(HEADER_SYNONYMS) as Field[]) {
      if (out[f] === undefined && (HEADER_SYNONYMS[f] as readonly string[]).includes(t)) out[f] = idx;
    }
  });
  return out;
}

function makeDay(row: Row, rowNo: number, cols: Partial<Record<Field, number>>): SourceDay {
  const at = (f: Field) => (cols[f] === undefined ? null : (row[cols[f]!] ?? null));
  const dateCell = at("date");
  const date = parseDateCell(dateCell);
  const inP = parseTimeCell(at("inTime"));
  const outP = parseTimeCell(at("outTime"));
  const problems: string[] = [];
  if (!date) problems.push(`Date "${cellText(dateCell)}" is not a valid date.`);
  if (inP.bad) problems.push(`In time "${cellText(at("inTime"))}" is not a valid time.`);
  if (outP.bad) problems.push(`Out time "${cellText(at("outTime"))}" is not a valid time.`);
  const dur = cellText(at("duration"));
  const shift = cellText(at("shift"));
  const status = cellText(at("status"));
  return {
    rowNo,
    date,
    dateRaw: cellText(dateCell),
    inTime: inP.time,
    outTime: outP.time,
    shift: shift || null,
    duration: dur || null,
    status: status || null,
    problems,
  };
}

const PERIOD_RE = /([A-Za-z]{3}\s+\d{1,2}\s+\d{4})\s+To\s+([A-Za-z]{3}\s+\d{1,2}\s+\d{4})/i;

function periodDate(s: string): string | null {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS[m[1]!.toLowerCase()];
  return mon ? validYmd(Number(m[3]), mon, Number(m[2])) : null;
}

/** Text of the first non-empty cell after `from` (exclusive). */
function nextText(row: Row, from: number): string {
  for (let i = from + 1; i < row.length; i++) {
    const t = cellText(row[i]);
    if (t) return t;
  }
  return "";
}

function parseBlockReport(sheet: string, rows: Row[]): ParsedReport | null {
  const isEmpRow = (r: Row) => r.some((c) => /^employee code\s*:?$/i.test(cellText(c)));
  if (!rows.some(isEmpRow)) return null;

  let period: ParsedReport["period"] = null;
  const warnings: string[] = [];
  const employees: SourceEmployee[] = [];
  let department: string | null = null;
  let cur: SourceEmployee | null = null;
  let cols: Partial<Record<Field, number>> | null = null;

  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (!period) {
      for (const c of r) {
        const m = PERIOD_RE.exec(cellText(c));
        if (m) {
          const from = periodDate(m[1]!);
          const to = periodDate(m[2]!);
          if (from && to) period = { from, to };
        }
      }
    }
    const deptIdx = r.findIndex((c) => /^department\s*:?$/i.test(cellText(c)));
    if (deptIdx >= 0) {
      department = nextText(r, deptIdx) || null;
      return;
    }
    if (isEmpRow(r)) {
      const codeIdx = r.findIndex((c) => /^employee code\s*:?$/i.test(cellText(c)));
      const nameIdx = r.findIndex((c) => /^employee name\s*:?$/i.test(cellText(c)));
      const code = nextText(r, codeIdx);
      const name = nameIdx >= 0 ? nextText(r, nameIdx) : "";
      if (!code) warnings.push(`Row ${rowNo}: an employee block has no employee code and was ignored.`);
      cur = code ? { key: code, code, name, department, days: [] } : null;
      if (cur) employees.push(cur);
      cols = null;
      return;
    }
    // The block's own header row (Date, InTime, OutTime, …).
    const hasDateHeader = r.some((c) => norm(c) === "date");
    if (hasDateHeader && r.some((c) => ["intime", "outtime", "in time", "out time"].includes(norm(c)))) {
      cols = mapHeader(r);
      return;
    }
    if (!cur || !cols || cols.date === undefined) return;
    const dateCell = r[cols.date] ?? null;
    const text = cellText(dateCell);
    if (!text || /^total\b/i.test(text)) return;
    const looksLikeData =
      parseDateCell(dateCell) !== null ||
      [cols.inTime, cols.outTime, cols.status].some((ix) => ix !== undefined && cellText(r[ix]) !== "");
    if (!looksLikeData) return;
    cur.days.push(makeDay(r, rowNo, cols));
  });

  return { sheet, layout: "block-report", period, employees, warnings };
}

// A flat table is tried FIRST: its header row (Employee Code, Date, In, Out) would
// otherwise look like the start of a block report. A block report never has the
// code, date and time headers on one row, so it is not mistaken for a table.
function parseFlatTable(sheet: string, rows: Row[]): ParsedReport | null {
  let headerAt = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const c = mapHeader(rows[i] ?? []);
    if (c.date !== undefined && (c.code !== undefined || c.name !== undefined) && (c.inTime !== undefined || c.outTime !== undefined)) {
      headerAt = i;
      cols = c;
      break;
    }
  }
  if (headerAt < 0) return null;

  const byKey = new Map<string, SourceEmployee>();
  const warnings: string[] = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => c == null || cellText(c) === "")) continue;
    const code = cols.code === undefined ? "" : cellText(r[cols.code]);
    const name = cols.name === undefined ? "" : cellText(r[cols.name]);
    const key = code || (name ? `name:${name.toLowerCase()}` : "");
    if (!key) {
      warnings.push(`Row ${i + 1}: no employee code or name — row ignored.`);
      continue;
    }
    let emp = byKey.get(key);
    if (!emp) {
      emp = {
        key,
        code: code || "—",
        name,
        department: cols.department === undefined ? null : cellText(r[cols.department]) || null,
        days: [],
      };
      byKey.set(key, emp);
    }
    emp.days.push(makeDay(r, i + 1, cols));
  }
  return { sheet, layout: "flat-table", period: null, employees: [...byKey.values()], warnings };
}

/** Reads an .xlsx / .xls / .csv file's bytes (or CSV text). Nothing leaves the browser. */
export function readWorkbook(data: ArrayBuffer | Uint8Array | string): XLSX.WorkBook {
  if (typeof data === "string") return XLSX.read(data, { type: "string", raw: true });
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return XLSX.read(bytes, { type: "array", raw: true });
}

export function parseSheet(wb: XLSX.WorkBook, sheet: string): ParsedReport {
  const ws = wb.Sheets[sheet];
  const empty: ParsedReport = {
    sheet,
    layout: "flat-table",
    period: null,
    employees: [],
    warnings: ["This sheet could not be read."],
  };
  if (!ws) return empty;
  const rows = sheetRows(ws);
  const parsed = parseFlatTable(sheet, rows) ?? parseBlockReport(sheet, rows);
  if (!parsed) {
    return {
      ...empty,
      warnings: [
        "This sheet is not in a recognised layout. Expected the Daily Attendance Report, or a table with Employee Code/Name, Date and In/Out time columns.",
      ],
    };
  }
  if (parsed.employees.length === 0) parsed.warnings.push("No employees were found in this sheet.");
  return parsed;
}
