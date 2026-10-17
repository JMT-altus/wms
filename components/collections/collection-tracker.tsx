"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { formatInr } from "@/lib/format";
import { NOT_CONNECTED_MESSAGE, type TransactionSourceInfo } from "@/lib/collections/source";
import { businessDate, msUntilNextBusinessDay, partyOverdue, type OverdueLevel } from "@/lib/collections/overdue";
import { filterRows, sortRows, type PartyRow, type SortKey, type TrackerFilters } from "@/lib/collections/derive";
import { PartyDetailDialog } from "./party-detail-dialog";

const PAGE = 25;
const CARD = { border: "1px solid var(--color-hairline-strong)", boxShadow: "0 1px 2px rgba(15,23,42,0.05)" } as const;
const SELECT = "h-8 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong";

/** Row tint, edge and label per overdue level. Colour is never the only signal. */
const LEVEL_STYLE: Record<Exclude<OverdueLevel, "none">, { bg: string; edge: string; fg: string; label: string }> = {
  warning: { bg: "#FFFBEB", edge: "#F59E0B", fg: "#92400E", label: "Overdue" },
  critical: { bg: "#FEF2F2", edge: "#DC2626", fg: "#B91C1C", label: "Overdue" },
};

/**
 * The business date, rolled over at India midnight while the page stays open,
 * so a row turns yellow/red on the right day without a reload.
 */
function useBusinessToday(initial: string): string {
  const [rolled, setRolled] = React.useState<string | null>(null);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        setRolled(businessDate(new Date()));
        arm();
      }, msUntilNextBusinessDay(new Date()));
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  // YYYY-MM-DD compares as text; the later of the server's date and the rollover wins.
  return rolled !== null && rolled > initial ? rolled : initial;
}

const money = (n: number | null) => (n === null ? "—" : formatInr(n));
/** "10-Nov" — the date-wise note style from the design sketch. */
const dayDash = (d: Date) => {
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", timeZone: "Asia/Kolkata" });
  const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Kolkata" });
  return `${day}-${mon}`;
};
const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
};

/**
 * The Collection Tracker: one row per party, as listed by the accounting source.
 *
 * It displays what it is given — Debit, Credit and Collection Person arrive on
 * each row and are never calculated or edited here. Next follow-up and Comments
 * come from the saved follow-up history. With no source connected the table is
 * empty and says so; it never shows invented parties.
 */
export function CollectionTracker({
  rows,
  connected,
  storageReady,
  today: initialToday,
  emptyMessage = NOT_CONNECTED_MESSAGE,
  transactionSource,
}: {
  rows: PartyRow[];
  connected: boolean;
  storageReady: boolean;
  today: string;
  /** Why the list is empty when nothing is connected (from the loader). */
  emptyMessage?: string;
  /** The transaction source, so the detail can say when none is approved. */
  transactionSource?: TransactionSourceInfo;
}) {
  const today = useBusinessToday(initialToday);
  const [filters, setFilters] = React.useState<TrackerFilters>({ query: "", collectionPerson: "", followUp: "" });
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "party", dir: "asc" });
  const [page, setPage] = React.useState(0);
  const [openName, setOpenName] = React.useState<string | null>(null);

  const people = React.useMemo(
    () => [...new Set(rows.map((r) => r.collectionPerson).filter((p): p is string => Boolean(p)))].sort(),
    [rows],
  );
  const shown = React.useMemo(
    () => sortRows(filterRows(rows, filters, today), sort.key, sort.dir),
    [rows, filters, sort, today],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const slice = shown.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const open = rows.find((r) => r.partyName === openName) ?? null;

  function set<K extends keyof TrackerFilters>(k: K, v: TrackerFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  }
  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const th = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      scope="col"
      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => sortBy(key)}
        className="inline-flex items-center gap-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft hover:text-ink-strong"
      >
        {label}
        {sort.key === key && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search party, person or notes"
            aria-label="Search the tracker"
            className="h-8 w-[260px] rounded-lg border border-hairline-strong bg-white pl-8 pr-2.5 text-[13px] text-ink-strong placeholder:text-ink-subtle"
          />
        </div>
        <select
          aria-label="Collection person"
          value={filters.collectionPerson}
          onChange={(e) => set("collectionPerson", e.target.value)}
          className={SELECT}
        >
          <option value="">All collection persons</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          aria-label="Follow-up"
          value={filters.followUp}
          onChange={(e) => set("followUp", e.target.value as TrackerFilters["followUp"])}
          className={SELECT}
        >
          <option value="">Any follow-up</option>
          <option value="due">Follow-up due or overdue</option>
          <option value="none">No follow-up date</option>
        </select>
        <span className="ml-auto text-[12.5px] text-ink-subtle tabular-nums">
          {connected ? `${shown.length} part${shown.length === 1 ? "y" : "ies"}` : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
        <table className="w-full min-w-[940px] border-collapse text-[13.5px]">
          <thead style={{ background: "#F5F7FB" }}>
            <tr>
              {th("party", "Party name")}
              {th("debit", "Debit", "right")}
              {th("credit", "Credit", "right")}
              {th("person", "Collection person")}
              <th scope="col" className="px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                Sales coordinator
              </th>
              {th("next", "Next follow-up")}
              <th scope="col" className="px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                Comments
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[13.5px] text-ink-muted">
                  {!connected
                    ? emptyMessage
                    : rows.length === 0
                      ? "No parties in the collection data."
                      : "No parties match these filters."}
                </td>
              </tr>
            ) : (
              slice.map((r) => {
                const od = partyOverdue(r.transactions, today);
                const tone = od.level === "none" ? null : LEVEL_STYLE[od.level];
                return (
                <tr
                  key={r.partyName}
                  data-overdue={od.level}
                  className={`border-t border-[#EEF1F6] ${tone ? "" : "hover:bg-[#F7F9FD]"}`}
                  style={tone ? { background: tone.bg, boxShadow: `inset 3px 0 0 ${tone.edge}` } : undefined}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenName(r.partyName)}
                      className="text-left font-semibold text-ink-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#14336B]"
                    >
                      {r.partyName}
                    </button>
                    {tone && (
                      <span className="ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold" style={{ color: tone.fg, border: `1px solid ${tone.edge}` }}>
                        {tone.label} {od.daysOverdue} day{od.daysOverdue === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.credit)}</td>
                  <td className="px-3 py-2">{r.collectionPerson ?? <span className="text-ink-subtle">—</span>}</td>
                  <td className="px-3 py-2">{r.coordinatorLabel ?? <span className="text-ink-subtle">Unassigned</span>}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.nextFollowupDate ? short(r.nextFollowupDate) : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    {r.history.filter((h) => h.note).length === 0 ? (
                      <span className="text-ink-subtle">—</span>
                    ) : (
                      <span className="block max-h-[76px] max-w-[340px] overflow-y-auto pr-1" aria-label="Comments, newest first">
                        {r.history
                          .filter((h) => h.note)
                          .map((h) => (
                            <span key={h.id} className="block truncate" title={h.note ?? undefined}>
                              <span className="tabular-nums text-ink-subtle">{dayDash(h.createdAt)}</span> — {h.note}
                            </span>
                          ))}
                      </span>
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[13px]">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className="h-8 rounded-lg border border-hairline-strong px-3 font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <span className="tabular-nums text-ink-subtle">
            Page {safePage + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
            className="h-8 rounded-lg border border-hairline-strong px-3 font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <PartyDetailDialog
        key={openName ?? "closed"}
        row={open}
        today={today}
        storageReady={storageReady}
        transactionSource={transactionSource}
        onClose={() => setOpenName(null)}
      />
    </div>
  );
}
