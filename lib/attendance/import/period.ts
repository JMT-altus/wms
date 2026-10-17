/**
 * Reporting-period helpers for the attendance import. Pure.
 *
 * The period the admin confirms is the one found in the DATA, never the one in
 * the file name — a file called "Aug26" has held April rows.
 */

export interface DateSummary {
  first: string | null;
  last: string | null;
  /** Distinct calendar dates. */
  distinct: number;
  /** Distinct yyyy-mm values, sorted. */
  months: string[];
  /** "April 2026", or "March 2026 – April 2026 (2 months)". */
  label: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const name = MONTH_NAMES[Number(m) - 1];
  return name ? `${name} ${y}` : ym;
}

export function summarizeDates(dates: Iterable<string | null | undefined>): DateSummary {
  const set = new Set<string>();
  for (const d of dates) if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  const sorted = [...set].sort();
  const months = [...new Set(sorted.map((d) => d.slice(0, 7)))];
  const label =
    months.length === 0
      ? "no dates"
      : months.length === 1
        ? monthLabel(months[0]!)
        : `${monthLabel(months[0]!)} – ${monthLabel(months[months.length - 1]!)} (${months.length} months)`;
  return { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, distinct: sorted.length, months, label };
}

const FILE_MONTHS: [string, number][] = [
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
  ["sept", 9], ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["jun", 6], ["jul", 7],
  ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
];

/** The month named in a file name ("Report Aug26.xlsx" → August 2026), or null. */
export function fileNameMonth(fileName: string): { month: number; year: number | null } | null {
  const base = fileName.replace(/\.[A-Za-z0-9]+$/g, "");
  const alt = FILE_MONTHS.map(([n]) => n).join("|");
  // The month must start a word and not run into more letters ("Mark", "Summary").
  const re = new RegExp(`(?:^|[^a-z])(${alt})[\\s_.-]*(\\d{4}|\\d{2})?(?![a-z0-9])`, "gi");
  let last: { month: number; year: number | null } | null = null;
  for (const m of base.matchAll(re)) {
    const month = FILE_MONTHS.find(([n]) => n === m[1]!.toLowerCase())?.[1];
    if (!month) continue;
    const y = m[2] ? Number(m[2]) : null;
    last = { month, year: y === null ? null : y < 100 ? 2000 + y : y };
  }
  return last;
}

/** Warnings about the period; empty when everything agrees. */
export function periodWarnings(opts: {
  fileName: string | null | undefined;
  dates: DateSummary;
  declared: { from: string; to: string } | null;
}): string[] {
  const out: string[] = [];
  const { dates, declared } = opts;
  if (dates.months.length > 1) {
    out.push(`The dates span ${dates.months.length} months (${dates.label}). Check this is the period you meant.`);
  }
  const fm = opts.fileName ? fileNameMonth(opts.fileName) : null;
  if (fm && dates.months.length > 0) {
    const hit = dates.months.some((ym) => {
      const [y, m] = ym.split("-").map(Number);
      return m === fm.month && (fm.year === null || y === fm.year);
    });
    if (!hit) {
      const named = `${MONTH_NAMES[fm.month - 1]}${fm.year ? ` ${fm.year}` : ""}`;
      out.push(`The file name says ${named}, but the dates inside the file are ${dates.label}. The dates in the file are what will be imported.`);
    }
  }
  if (declared && dates.first && dates.last && (dates.first < declared.from || dates.last > declared.to)) {
    out.push(`Some rows fall outside the file's own reporting period (${declared.from} to ${declared.to}).`);
  }
  return out;
}

export const inPeriod = (date: string, p: { from: string; to: string }) => date >= p.from && date <= p.to;
