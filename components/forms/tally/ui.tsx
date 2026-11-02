import Link from "next/link";
import type { ReactNode } from "react";
import type { Route } from "next";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ArrowUpDown, Search } from "lucide-react";
import { formatInrPaise } from "@/lib/format";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { DateField } from "@/components/ui/date-field";
import { PAGE_SIZES, listHref, pageCount, rangeLabel, toggleSort, type ListParams } from "@/lib/tally/list-params";
import type { BatchOption } from "@/lib/queries/tally-ledger";

/**
 * The building blocks of the Forms ledger pages (Vendor Master, the document
 * ledgers, Outstanding Balances, an import batch): a GET filter bar, sortable
 * headings, pagination and the empty / not-ready / detail pieces. Server
 * components — every control is a link or a plain form, so the pages work
 * before any JavaScript loads and the URL is the whole state (shareable,
 * bookmarkable, back-button-safe).
 *
 * Styling follows the Tally Data Import screen beside them in the rail:
 * the same cards, hairlines, 12.5px tables and the Forms rose for emphasis.
 */

export const FORMS_ROSE = "#BE123C";
export const CARD_STYLE = { border: "1px solid var(--color-hairline)", boxShadow: "0 14px 32px -20px rgba(190, 18, 60, 0.18), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" } as const;
const FIELD = "h-9 rounded-lg border border-hairline-strong bg-white px-2 text-[13px] text-ink-strong";

/* ── formatting ──────────────────────────────────────────────────────────── */

/** yyyy-mm-dd → dd/mm/yy, the date form every WMS table uses. */
export function fmtDay(ymd: string | null | undefined): string {
  return fmtDate(ymd) || "—";
}
/** A stored timestamp → "dd/mm/yy, hh:mm AM" on the Indian clock. */
export const fmtWhen = (d: Date | string | null | undefined) => fmtDateTime(d) || "—";
export const shortId = (id: string) => id.slice(0, 8);

export function Money({ paise, strong = false }: { paise: number | null | undefined; strong?: boolean }) {
  if (paise === null || paise === undefined) return <Dash />;
  return <span className={`tabular-nums ${strong ? "font-bold text-ink-strong" : ""}`}>{formatInrPaise(paise)}</span>;
}
export const Dash = () => <span className="text-ink-subtle">—</span>;

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  imported: { bg: "#ECFDF5", fg: "#047857" },
  completed: { bg: "#ECFDF5", fg: "#047857" },
  skipped: { bg: "#F1F5F9", fg: "#475569" },
  partial: { bg: "#FFFBEB", fg: "#B45309" },
  running: { bg: "#EFF6FF", fg: "#1D4ED8" },
  rejected: { bg: "#FEF2F2", fg: "#B91C1C" },
  failed: { bg: "#FEF2F2", fg: "#B91C1C" },
};
export function StatusPill({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? { bg: "#F1F5F9", fg: "#475569" };
  return (
    <span className="inline-block rounded-pill px-2 py-0.5 text-[11.5px] font-bold capitalize" style={{ background: t.bg, color: t.fg }}>
      {status}
    </span>
  );
}

/* ── page frame ──────────────────────────────────────────────────────────── */

export function SectionHead({ eyebrow, title, lede, back, right }: { eyebrow: string; title: string; lede: ReactNode; back?: { href: Route; label: string }; right?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-subtle underline-offset-2 hover:underline">
            <ChevronLeft size={14} strokeWidth={2.4} /> {back.label}
          </Link>
        )}
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">{eyebrow}</div>
        <h1 className="mt-1 text-ink-strong max-md:!text-[30px]" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 500, fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
          {title}
        </h1>
        <p className="text-body-lg text-ink-subtle mt-2 max-w-3xl tabular-nums">{lede}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-section bg-surface-card p-5 ${className}`} style={CARD_STYLE}>
      {children}
    </section>
  );
}

/** Migration 0122 hasn't reached this database: say so instead of pretending the ledger is empty. */
export function StoragePending() {
  return (
    <p role="status" className="rounded-lg px-3 py-3 text-[13.5px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E" }}>
      Tally import isn&apos;t set up on this database yet (database update 0122 is needed). Nothing can be shown until it is applied.
    </p>
  );
}

export function EmptyState({ title, body, cta }: { title: string; body: ReactNode; cta?: { href: Route; label: string } }) {
  return (
    <div role="status" className="rounded-xl px-6 py-10 text-center" style={{ background: "var(--color-surface-soft)", border: "1px dashed var(--color-hairline-strong)" }}>
      <p className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
        {title}
      </p>
      <p className="mt-1 text-[13.5px] text-ink-muted max-w-md mx-auto">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-4 inline-block rounded-pill px-4 py-2 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, #FB7185 0%, ${FORMS_ROSE} 100%)` }}>
          {cta.label}
        </Link>
      )}
    </div>
  );
}

/* ── filters ─────────────────────────────────────────────────────────────── */

export interface FilterSpec {
  search?: string;
  financialYears?: string[];
  dates?: { label: string };
  batches?: BatchOption[];
  statuses?: readonly string[];
}

/** A plain GET form: every filter is a query parameter, so the page is its URL. Sort survives a filter change; the page resets. */
export function FilterBar({ base, params, spec }: { base: string; params: ListParams; spec: FilterSpec }) {
  const batchLabel = (b: BatchOption) => `${fmtWhen(b.createdAt)} · ${b.fileName}${b.asOfDate ? ` · as of ${fmtDay(b.asOfDate)}` : ""}`;
  return (
    <form method="get" action={base} role="search" aria-label="Filters" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="sort" value={params.sort} />
      <input type="hidden" name="dir" value={params.dir} />
      {spec.search && (
        <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
          Search
          <span className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input name="q" defaultValue={params.q} placeholder={spec.search} className={`${FIELD} pl-8 w-[260px] max-md:w-full`} maxLength={120} />
          </span>
        </label>
      )}
      {spec.financialYears && (
        <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
          Financial year
          <select name="fy" defaultValue={params.fy ?? ""} className={FIELD}>
            <option value="">All years</option>
            {spec.financialYears.map((fy) => (
              <option key={fy} value={fy}>
                {fy}
              </option>
            ))}
          </select>
        </label>
      )}
      {spec.dates && (
        <>
          <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
            {spec.dates.label} from
            <DateField name="from" defaultValue={params.from ?? ""} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
            to
            <DateField name="to" defaultValue={params.to ?? ""} className={FIELD} />
          </label>
        </>
      )}
      {spec.batches && (
        <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
          Import batch
          <select name="batch" defaultValue={params.batch ?? ""} className={`${FIELD} max-w-[320px]`}>
            <option value="">All batches</option>
            {spec.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {batchLabel(b)}
              </option>
            ))}
          </select>
        </label>
      )}
      {spec.statuses && (
        <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
          Status
          <select name="status" defaultValue={params.status ?? ""} className={`${FIELD} capitalize`}>
            <option value="">All rows</option>
            {spec.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
        Per page
        <select name="size" defaultValue={String(params.size)} className={FIELD}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="h-9 rounded-lg px-4 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, #FB7185 0%, ${FORMS_ROSE} 100%)` }}>
        Apply
      </button>
      <Link href={base as Route} className="h-9 inline-flex items-center rounded-lg border border-hairline-strong bg-white px-3 text-[13px] font-semibold text-ink-strong">
        Clear
      </Link>
    </form>
  );
}

/* ── results, sorting, paging ────────────────────────────────────────────── */

export function ResultCount({ total, params, noun, right }: { total: number; params: ListParams; noun: string; right?: ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center justify-between gap-3 flex-wrap text-[13px]">
      <p className="font-semibold text-ink-muted tabular-nums" aria-live="polite">
        {rangeLabel(total, params.page, params.size, noun)}
      </p>
      {right}
    </div>
  );
}

export function SortTh<S extends string>({ base, params, sort, label, align = "left", width }: { base: string; params: ListParams<S>; sort: S; label: string; align?: "left" | "right"; width?: number }) {
  const on = params.sort === sort ? params.dir : null;
  return (
    <th className={`px-2 py-1.5 font-semibold text-ink-subtle whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`} style={width ? { width } : undefined} aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : "none"}>
      <Link href={listHref(base, params, toggleSort(params, sort)) as Route} className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${on ? "text-ink-strong" : ""}`}>
        {label}
        <span aria-hidden style={{ color: on ? FORMS_ROSE : "var(--color-ink-subtle)" }}>
          {on === "asc" ? <ChevronUp size={12} strokeWidth={3} /> : on === "desc" ? <ChevronDown size={12} strokeWidth={3} /> : <ArrowUpDown size={11} strokeWidth={2.4} />}
        </span>
      </Link>
    </th>
  );
}

export function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return <th className={`px-2 py-1.5 font-semibold text-ink-subtle whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Pagination({ base, params, total }: { base: string; params: ListParams; total: number }) {
  const pages = pageCount(total, params.size);
  if (pages <= 1) return null;
  const page = Math.min(params.page, pages);
  const link = (p: number, label: ReactNode, aria: string, disabled: boolean) =>
    disabled ? (
      <span aria-disabled className="inline-flex h-8 items-center rounded-lg border border-hairline px-2.5 text-ink-subtle">
        {label}
      </span>
    ) : (
      <Link href={listHref(base, params, { page: p }) as Route} aria-label={aria} className="inline-flex h-8 items-center rounded-lg border border-hairline-strong bg-white px-2.5 font-semibold text-ink-strong hover:bg-surface-soft">
        {label}
      </Link>
    );
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-end gap-2 text-[13px]">
      {link(page - 1, <ChevronLeft size={14} />, "Previous page", page <= 1)}
      <span className="tabular-nums text-ink-muted">
        Page {page.toLocaleString("en-IN")} of {pages.toLocaleString("en-IN")}
      </span>
      {link(page + 1, <ChevronRight size={14} />, "Next page", page >= pages)}
    </nav>
  );
}

/* ── detail pages ────────────────────────────────────────────────────────── */

export function KeyValues({ title, items }: { title?: string; items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <Card>
      {title && (
        <h2 className="mb-3 font-bold text-ink-strong" style={{ fontSize: 15 }}>
          {title}
        </h2>
      )}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[13.5px]">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-subtle font-semibold">{k}</dt>
            <dd className="text-ink-strong min-w-0 break-words">{v === null || v === undefined || v === "" ? <Dash /> : v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** "Imported by …, from file …, on …" with a link to the batch — the source of every record on these pages. */
export function BatchSource({ batch, categoryLabel }: { batch: { id: string; fileName: string; sheetName?: string | null; status: string; createdAt: Date; completedAt?: Date | null; uploadedBy: string | null } | null; categoryLabel?: string }) {
  if (!batch) return <KeyValues title="Source" items={[["Import batch", <Dash key="d" />]]} />;
  return (
    <KeyValues
      title="Source"
      items={[
        ["Import batch", <Link key="b" href={`/forms/tally-import/batches/${batch.id}` as Route} className="font-mono text-[12.5px] font-bold text-[#0B4FB8] underline-offset-2 hover:underline">{shortId(batch.id)}</Link>],
        ...(categoryLabel ? ([["Category", categoryLabel]] as const) : []),
        ["File", `${batch.fileName}${batch.sheetName ? ` · ${batch.sheetName}` : ""}`],
        ["Uploaded by", batch.uploadedBy],
        ["Uploaded", fmtWhen(batch.createdAt)],
        ["Import status", <StatusPill key="s" status={batch.status} />],
      ]}
    />
  );
}
