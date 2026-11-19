/**
 * Date and ordering helpers shared by the incentive engines (Category A and Category B). Pure. Dates are yyyy-mm-dd
 * strings read as UTC days, so no time zone or clock is ever involved.
 */

export const DAY = 86_400_000;
export const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
export const monthOf = (d: string) => d.slice(0, 7);
export const monthEnd = (monthStart: string) => {
  const [y, m] = monthStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * The same day `n` calendar months earlier (n > 0) or later (n < 0), clamped to the month's last day (31 May − 3
 * months = 28/29 Feb). Used for lookback windows: "within 24 months before 2026-05-31" starts on 2024-05-31.
 */
export const monthsBefore = (d: string, n: number) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 - n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
};

export const byKey = <T>(xs: readonly T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** Document numbers in natural order (INV 2 before INV 10): each run of digits is padded so text order is number order. */
export const natural = (s: string) => s.replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, "").padStart(20, "0"));

/**
 * A document's place in time: its date, then its number in natural order, then its id. Tally's import carries no time
 * of day, so documents of the same day are ordered by voucher number (and, for two with the same number, by id) —
 * deterministic, and never placing a document before itself.
 */
export const docKey = (x: { date: string; no: string; id: string }) => `${x.date}|${natural(x.no)}|${x.id}`;
