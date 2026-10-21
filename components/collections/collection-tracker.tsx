"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { formatInr } from "@/lib/format";
import { NOT_CONNECTED_MESSAGE, type TransactionSourceInfo } from "@/lib/collections/source";
import { partyOverdue } from "@/lib/collections/overdue";
import { OverdueBadge, overdueRowStyle, useBusinessToday } from "./overdue-display";
import { UNASSIGNED_PERSON, filterRows, personOf, sortRows, type PartyRow, type SortKey, type TrackerFilters } from "@/lib/collections/derive";
import { PartyDetailDialog } from "./party-detail-dialog";
import { CommentList } from "./comment-list";
import { ConfirmationControl, EscalateControl } from "./review-controls";
import { CoordinatorControl } from "./coordinator-control";

const PAGE = 25;
const CARD = { border: "1px solid var(--color-hairline-strong)", boxShadow: "0 1px 2px rgba(15,23,42,0.05)" } as const;
const SELECT = "h-8 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong";

const money = (n: number | null) => (n === null ? "—" : formatInr(n));
const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
};

/**
 * The Collection Tracker: one row per party, as listed by the accounting source.
 *
 * It displays what it is given — Debit, Credit and Collection Person arrive on
 * each row and are never calculated here. Only holders of
 * collection.coordinator.assign can set or correct a Sales Coordinator
 * (server-checked). Next follow-up and Comments
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
  canSeeCommitments = false,
  canEditCommitments = false,
  canWriteFollowUps = true,
  canSetConfirmation = true,
  canEscalate = true,
  reviewStorageReady = true,
  coordinatorEditor,
  reviewQueue,
  setupHints = [],
  setupHref,
}: {
  rows: PartyRow[];
  connected: boolean;
  storageReady: boolean;
  today: string;
  /** Why the list is empty when nothing is connected (from the loader). */
  emptyMessage?: string;
  /** The transaction source, so the detail can say when none is approved. */
  transactionSource?: TransactionSourceInfo;
  /** collection.commitments.view — decided on the server from the signed session, like every flag below. */
  canSeeCommitments?: boolean;
  /** collection.commitments.edit. */
  canEditCommitments?: boolean;
  /** collection.followup.write. */
  canWriteFollowUps?: boolean;
  /** collection.confirmation.set. */
  canSetConfirmation?: boolean;
  /** collection.escalation.create. */
  canEscalate?: boolean;
  /** False while migration 0115 isn't applied: the confirmation/escalation controls are disabled. */
  reviewStorageReady?: boolean;
  /**
   * Given only to holders of collection.coordinator.assign (decided on the
   * server): lets them set or correct a Sales Coordinator, choosing from these
   * Collection Master coordinators. Everyone else sees the coordinator as text.
   */
  coordinatorEditor?: { options: readonly string[] };
  /**
   * Given only to holders of collection.escalation.review (decided on the
   * server): the number of open escalations and where the review queue is.
   */
  reviewQueue?: { openCount: number; href: string };
  /**
   * Given only to super-admins (the only people who can grant the sensitive
   * capabilities): work is waiting that nobody has been granted the capability
   * to handle. Nothing is granted by showing this.
   */
  setupHints?: { id: string; text: string }[];
  /** Where those capabilities are granted (Field Permissions). */
  setupHref?: string;
}) {
  const today = useBusinessToday(initialToday);
  const [filters, setFilters] = React.useState<TrackerFilters>({ query: "", collectionPerson: "", followUp: "" });
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "party", dir: "asc" });
  const [page, setPage] = React.useState(0);
  const [openName, setOpenName] = React.useState<string | null>(null);

  const people = React.useMemo(
    () => [...new Set(rows.map(personOf).filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b)),
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
      {reviewQueue && (
        <div role="note" aria-label="Escalations awaiting review" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5" style={{ background: "#EEF4FF", border: "1px solid #C9DAFB" }}>
          <p className="text-[13px] font-semibold text-[#0B4FB8]">
            {reviewQueue.openCount === 0
              ? "No escalations are waiting for review."
              : `${reviewQueue.openCount.toLocaleString("en-IN")} escalation${reviewQueue.openCount === 1 ? " is" : "s are"} waiting for your review.`}
          </p>
          <Link href={reviewQueue.href as Route} className="text-[13px] font-bold text-[#0B4FB8] underline-offset-2 hover:underline">
            Open the review queue
          </Link>
        </div>
      )}
      {setupHints.length > 0 && (
        <div role="note" aria-label="Setup needed" className="mb-3 rounded-lg px-3 py-2.5" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0" }}>
          <p className="text-[13px] font-bold text-[#92400E]">Setup needed (shown to super-admins only)</p>
          <ul className="mt-1 grid gap-1">
            {setupHints.map((h) => (
              <li key={h.id} className="text-[12.5px] text-[#92400E]">
                {h.text}
              </li>
            ))}
          </ul>
          {setupHref && (
            <p className="mt-1.5 text-[12.5px] text-[#92400E]">
              Grant it in{" "}
              <Link href={setupHref as Route} className="font-bold underline underline-offset-2">
                Field Permissions
              </Link>{" "}
              → “One person” → pick them → Allow. Sensitive permissions can be granted to a person or organisation-wide, never to a department.
            </p>
          )}
        </div>
      )}
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
          {rows.some((r) => r.masterId && personOf(r) === null) && <option value={UNASSIGNED_PERSON}>Unassigned</option>}
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
        <table className="w-full min-w-[1120px] border-collapse text-[13.5px]">
          <thead style={{ background: "#F5F7FB" }}>
            <tr>
              {th("party", "Party name")}
              {th("debit", "Debit", "right")}
              {th("credit", "Credit", "right")}
              {th("person", "Collection person (Sales coordinator)")}
              {th("next", "Next follow-up")}
              <th scope="col" className="px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                Comments
              </th>
              <th scope="col" className="px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                Collection Amount Confirmation
              </th>
              <th scope="col" className="px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                Escalation
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-[13.5px] text-ink-muted">
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
                return (
                <tr
                  key={r.partyName}
                  data-overdue={od.level}
                  className={`border-t border-[#EEF1F6] ${od.level !== "none" ? "" : "hover:bg-[#F7F9FD]"}`}
                  style={overdueRowStyle(od.level)}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenName(r.partyName)}
                      className="text-left font-semibold text-ink-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#14336B]"
                    >
                      {r.partyName}
                    </button>
                    <OverdueBadge level={od.level} daysOverdue={od.daysOverdue} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.credit)}</td>
                  <td className="px-3 py-2">
                    {coordinatorEditor && r.masterId ? (
                      <CoordinatorControl
                        // Remount when the stored value changes, so the cell shows what the server saved.
                        key={`${r.masterId}:${personOf(r) ?? ""}`}
                        companyId={r.masterId}
                        companyName={r.partyName}
                        current={personOf(r)}
                        options={coordinatorEditor.options}
                      />
                    ) : (
                      personOf(r) ?? <span className="text-ink-subtle">{r.masterId ? "Unassigned" : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.nextFollowupDate ? short(r.nextFollowupDate) : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    <CommentList comments={r.history} />
                  </td>
                  <td className="px-3 py-2">
                    {r.masterId ? (
                      <ConfirmationControl
                        companyId={r.masterId}
                        companyName={r.partyName}
                        outstanding={r.outstanding}
                        current={r.confirmation ?? null}
                        storageReady={reviewStorageReady}
                        canSet={canSetConfirmation}
                      />
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.masterId ? (
                      <EscalateControl companyId={r.masterId} companyName={r.partyName} open={r.openEscalation ?? null} storageReady={reviewStorageReady} canEscalate={canEscalate} />
                    ) : (
                      <span className="text-ink-subtle">—</span>
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
        canSeeCommitments={canSeeCommitments}
        canEditCommitments={canEditCommitments}
        canWriteFollowUps={canWriteFollowUps}
        onClose={() => setOpenName(null)}
      />
    </div>
  );
}
