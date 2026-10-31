/**
 * The URL state of a Forms ledger listing — search, filters, sort and page —
 * read from `searchParams` and written back into links. Pure, so the server
 * pages and the tests share one reading of a URL. Anything unparseable falls
 * back to the default rather than erroring: a hand-edited URL shows the first
 * page, not a crash.
 */

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
export type SearchParams = Record<string, string | string[] | undefined>;

export interface ListParams<S extends string = string> {
  q: string;
  /** Financial year, e.g. "2025-26". */
  fy: string | null;
  /** yyyy-mm-dd bounds on the document / bill date. */
  from: string | null;
  to: string | null;
  /** An import batch id. */
  batch: string | null;
  /** A row status (batch pages) or other single-choice filter. */
  status: string | null;
  page: number;
  size: number;
  sort: S;
  dir: "asc" | "desc";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FY = /^\d{4}-\d{2}$/;

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export function readListParams<S extends string>(sp: SearchParams | undefined, sorts: readonly S[], defaults: { sort: S; dir: "asc" | "desc" }): ListParams<S> {
  const p = sp ?? {};
  const page = Math.max(1, Math.min(100_000, Number.parseInt(first(p.page), 10) || 1));
  const sizeRaw = Number.parseInt(first(p.size), 10);
  const size = (PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE;
  const sortRaw = first(p.sort);
  const sort = (sorts as readonly string[]).includes(sortRaw) ? (sortRaw as S) : defaults.sort;
  const dirRaw = first(p.dir);
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sortRaw && (sorts as readonly string[]).includes(sortRaw) ? "asc" : defaults.dir;
  const day = (v: string) => (DAY.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : null);
  const from = day(first(p.from));
  const to = day(first(p.to));
  return {
    q: first(p.q).slice(0, 120),
    fy: FY.test(first(p.fy)) ? first(p.fy) : null,
    // A reversed range is read as the person meant it.
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    batch: UUID.test(first(p.batch)) ? first(p.batch).toLowerCase() : null,
    status: first(p.status).slice(0, 20) || null,
    page,
    size,
    sort,
    dir,
  };
}

/** The same URL with some of its state changed. Defaults are left out so links stay short. */
export function listHref(base: string, params: ListParams, patch: Partial<ListParams> = {}): string {
  const p = { ...params, ...patch };
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.fy) qs.set("fy", p.fy);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.batch) qs.set("batch", p.batch);
  if (p.status) qs.set("status", p.status);
  if (p.sort) qs.set("sort", p.sort);
  if (p.dir) qs.set("dir", p.dir);
  if (p.size !== DEFAULT_PAGE_SIZE) qs.set("size", String(p.size));
  if (p.page > 1) qs.set("page", String(p.page));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Clicking a heading: a new column sorts ascending; the same column flips. */
export function toggleSort<S extends string>(params: ListParams<S>, sort: S): Partial<ListParams<S>> {
  return params.sort === sort ? { sort, dir: params.dir === "asc" ? "desc" : "asc", page: 1 } : { sort, dir: "asc", page: 1 };
}

export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));

/** "1–50 of 312", for the record count line. */
export function rangeLabel(total: number, page: number, size: number, noun: string): string {
  if (total === 0) return `No ${noun}`;
  const start = (page - 1) * size + 1;
  const end = Math.min(total, page * size);
  const n = total.toLocaleString("en-IN");
  return total <= size ? `${n} ${noun}` : `${start.toLocaleString("en-IN")}–${end.toLocaleString("en-IN")} of ${n} ${noun}`;
}
