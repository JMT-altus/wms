"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, CircleDot, Search, Upload, Users } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { MARK_STATES, STATE_LABELS, markStateOf } from "@/lib/collections/marks";
import { MarkBadge, MarkMenu, markRowStyle, useMarkRunner, type MarkTarget } from "./mark-controls";
import { TrackerBulkBar } from "./tracker-bulk-bar";
import { formatInr } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { NOT_CONNECTED_MESSAGE, type TransactionSourceInfo } from "@/lib/collections/source";
import { partyOverdue } from "@/lib/collections/overdue";
import { OverdueBadge, overdueRowStyle, useBusinessToday } from "./overdue-display";
import { UNASSIGNED_PERSON, filterRows, personOf, sortRows, type PartyRow, type SortKey, type TrackerFilters } from "@/lib/collections/derive";
import { PartyDetailDialog } from "./party-detail-dialog";
import { TrackerComments } from "./tracker-comments";
import { SalespersonScorecard } from "./salesperson-scorecards";
import type { ScorecardView } from "@/lib/collections/scorecards";
import { EscalateControl } from "./review-controls";
import { LatestCommitment } from "@/components/collections/latest-commitment";
import { CoordinatorControl } from "./coordinator-control";
// Loaded only when Bulk Upload is opened, so the Tracker page itself stays as light as before.
const TrackerBulkUpload = React.lazy(() => import("./tracker-bulk-upload").then((m) => ({ default: m.TrackerBulkUpload })));

const CARD = { border: "1px solid var(--color-hairline-strong)", boxShadow: "0 1px 2px rgba(15,23,42,0.05)" } as const;
const money = (n: number | null) => (n === null ? "—" : formatInr(n));

/**
 * One filter chip: icon · current choice · chevron, in the app's `filter-chip`
 * style (the Tasks bar). The control inside is a native select, so it stays a
 * keyboard-accessible combobox and works without any script.
 */
function FilterChip({ icon, label, value, onChange, children }: { icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <span className="filter-chip relative pr-1" data-active={value !== "" || undefined}>
      <span className="text-ink-subtle" aria-hidden>
        {icon}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none bg-transparent pr-5 text-[12.5px] font-semibold text-ink-strong outline-none"
      >
        {children}
      </select>
      <ChevronDown size={12} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
    </span>
  );
}

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
  scopeNote,
  defaultCollectionPerson,
  logsNote,
  transactionSource,
  canSeeCommitments = false,
  canEditCommitments = false,
  canWriteFollowUps = true,
  commentEditorId = null,
  scorecard,
  canEscalate = true,
  canImportBalances = false,
  canAddMasterCompanies = false,
  canSetPriority = false,
  canSetDone = false,
  marksStorageReady = true,
  balancesProblem,
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
  /** Whose companies these are, when not every company (a linked Sales Coordinator's own) — decided on the server. */
  scopeNote?: string;
  /**
   * The viewer's OWN Sales Coordinator label (from the super-admin-kept link, decided on the server) when they may
   * see every company: the Collection person filter starts on it, so the Tracker opens on their own companies.
   * "All collection persons" and every other coordinator stay available in the dropdown. Absent = start on everyone.
   */
  defaultCollectionPerson?: string;
  /**
   * How many companies in the viewer's scope are in Collection Logs (₹0 Debit and ₹0 Credit in a confirmed upload),
   * and the Logs link when the viewer may open it (collection.logs.view). Absent when there are none.
   */
  logsNote?: { count: number; href: string | null };
  /** The transaction source, so the detail can say when none is approved. */
  transactionSource?: TransactionSourceInfo;
  /** collection.commitments.view — decided on the server from the signed session, like every flag below. */
  canSeeCommitments?: boolean;
  /** collection.commitments.edit. */
  canEditCommitments?: boolean;
  /** collection.followup.write. */
  canWriteFollowUps?: boolean;
  /** The signed-in employee's id when they hold collection.followup.write: their own comments get Edit. */
  commentEditorId?: string | null;
  /** The signed-in salesperson's own scorecard (or why there is none), worked out on the server; absent = not shown. */
  scorecard?: ScorecardView;
  /** collection.confirmation.set. */
  canSetConfirmation?: boolean;
  /** collection.escalation.create. */
  canEscalate?: boolean;
  /**
   * collection.balances.import ("Collection Tracker — Bulk Upload"), decided on
   * the server from the signed session. Without it neither the Bulk Upload
   * button nor its dialog is rendered; the preview and import server actions
   * refuse without it as well.
   */
  canImportBalances?: boolean;
  /** collection.master.import: Bulk Upload may add the file's unmatched companies to the Collection Master (as Unassigned) before the balances are confirmed. */
  canAddMasterCompanies?: boolean;
  /** collection.priority.set: MARK AS PRIORITY / Remove priority, per row and in bulk (the action checks again). */
  canSetPriority?: boolean;
  /** collection.done.set (sensitive, explicit grant): COLLECTION DONE / Undo, per row and in bulk (the action checks again). */
  canSetDone?: boolean;
  /** False while migration 0125 isn't applied: the mark actions are disabled and say so. */
  marksStorageReady?: boolean;
  /** Set (to the database error code) when the uploaded Debit / Credit couldn't be read: a permission or configuration problem. Everything else still works. */
  balancesProblem?: string;
  /** False while migration 0115 isn't applied: the escalation control is disabled. */
  reviewStorageReady?: boolean;
  /** False while migration 0123 isn't applied: the confirmed-amount field is read-only and says so. */
  amountStorageReady?: boolean;
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
  // The starting filter is decided before the first render, so the list never shows everyone's companies first.
  const [filters, setFilters] = React.useState<TrackerFilters>({ query: "", collectionPerson: defaultCollectionPerson ?? "", followUp: "", status: "" });
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "party", dir: "asc" });
  const [openName, setOpenName] = React.useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  // Ticked companies (Collection Master ids) for the bulk bar. Only drawn for someone who may mark; cleared after a
  // successful action and pruned against the rows the server sent, so a stale id can never be acted on.
  const canMark = canSetPriority || canSetDone;
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const clearSelection = React.useCallback(() => setSelected(new Set()), []);
  const marker = useMarkRunner({ onDone: clearSelection });

  // Every collection person on the list, plus the viewer's own label even when none of their companies is on the
  // list (so the starting choice is always a real option and shows their name).
  const people = React.useMemo(
    () => [...new Set([...rows.map(personOf).filter((p): p is string => Boolean(p)), ...(defaultCollectionPerson ? [defaultCollectionPerson] : [])])].sort((a, b) => a.localeCompare(b)),
    [rows, defaultCollectionPerson],
  );
  // Filter and sort the WHOLE list (every company the server sent), then show all of it: one continuous,
  // scrollable list with no pages, so search, filters and sort always cover every company.
  const shown = React.useMemo(() => sortRows(filterRows(rows, filters, today), sort.key, sort.dir), [rows, filters, sort, today]);
  const open = rows.find((r) => r.partyName === openName) ?? null;
  const selectable = React.useMemo(() => shown.filter((r): r is PartyRow & { masterId: string } => !!r.masterId), [shown]);
  const targets: MarkTarget[] = React.useMemo(
    () => rows.filter((r): r is PartyRow & { masterId: string } => !!r.masterId && selected.has(r.masterId)).map((r) => ({ id: r.masterId, name: r.partyName })),
    [rows, selected],
  );
  const allShownSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.masterId));
  const someShownSelected = selectable.some((r) => selected.has(r.masterId));
  function toggleAllShown(next: boolean) {
    setSelected((s) => {
      const out = new Set(s);
      for (const r of selectable) if (next) out.add(r.masterId);
      else out.delete(r.masterId);
      return out;
    });
  }
  function toggleOne(id: string, next: boolean) {
    setSelected((s) => {
      const out = new Set(s);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }

  function set<K extends keyof TrackerFilters>(k: K, v: TrackerFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
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
      {balancesProblem && (
        <div role="alert" aria-label="Debit and Credit unavailable" className="mb-3 rounded-lg px-3 py-2.5" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
          <p className="text-[13px] font-bold text-[#B91C1C]">Debit and Credit couldn&apos;t be loaded</p>
          <p className="mt-0.5 text-[12.5px] text-[#B91C1C]">
            The uploaded balances are unavailable because of a database permission or configuration problem (code {balancesProblem}), so Debit and Credit are blank. Everything else on this page works.
            Tell an administrator; the details are in the server log.
          </p>
        </div>
      )}
      {scopeNote && (
        <p aria-label="Companies shown" className="mb-3 rounded-lg border border-hairline bg-[#F8FAFD] px-3 py-2 text-[12.5px] font-semibold text-ink-soft">
          {scopeNote}
        </p>
      )}
      {logsNote && logsNote.count > 0 && (
        <p aria-label="Companies in Collection Logs" className="mb-3 rounded-lg border border-hairline bg-[#F8FAFD] px-3 py-2 text-[12.5px] text-ink-subtle">
          {logsNote.count} {logsNote.count === 1 ? "company has" : "companies have"} ₹0 Debit and ₹0 Credit in the latest upload that included {logsNote.count === 1 ? "it, so it is" : "them, so they are"} in{" "}
          {logsNote.href ? (
            <a href={logsNote.href} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
              Collection Logs
            </a>
          ) : (
            "Collection Logs"
          )}
          . {logsNote.count === 1 ? "It returns" : "They return"} here automatically when an upload gives {logsNote.count === 1 ? "it" : "them"} a Debit or Credit.
        </p>
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
      {scorecard && (
        <div className="mb-2 flex justify-end">
          <SalespersonScorecard view={scorecard} />
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
        {/* Status · Collection person · Follow-up: every chip narrows the same whole list, together with the search. */}
        <FilterChip icon={<CircleDot size={14} strokeWidth={2} />} label="Status" value={filters.status ?? ""} onChange={(v) => set("status", v as TrackerFilters["status"])}>
          <option value="">All status</option>
          {MARK_STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABELS[s]}
            </option>
          ))}
        </FilterChip>
        <FilterChip icon={<Users size={14} strokeWidth={2} />} label="Collection person" value={filters.collectionPerson} onChange={(v) => set("collectionPerson", v)}>
          <option value="">All collection persons</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p === defaultCollectionPerson ? `${p} (you)` : p}
            </option>
          ))}
          {rows.some((r) => r.masterId && personOf(r) === null) && <option value={UNASSIGNED_PERSON}>Unassigned</option>}
        </FilterChip>
        <FilterChip icon={<CalendarClock size={14} strokeWidth={2} />} label="Follow-up" value={filters.followUp} onChange={(v) => set("followUp", v as TrackerFilters["followUp"])}>
          <option value="">Any follow-up</option>
          <option value="due">Follow-up due or overdue</option>
          <option value="none">No follow-up date</option>
        </FilterChip>
        {/* Only for holders of collection.balances.import; nobody else gets the button or the dialog. */}
        {canImportBalances && (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] font-semibold text-ink-strong hover:bg-[#F7F9FD]"
          >
            <Upload size={14} aria-hidden />
            Bulk Upload
          </button>
        )}
        <span className={`text-[12.5px] text-ink-subtle tabular-nums${canImportBalances ? "" : " ml-auto"}`}>
          {connected ? `${shown.length} part${shown.length === 1 ? "y" : "ies"}` : ""}
        </span>
      </div>

      {canImportBalances && (
        <CenterDialog
          open={bulkOpen}
          title="Bulk Upload"
          subtitle="Upload the Tally customer summary to fill Debit and Credit for companies in the Collection Master. Companies not in the Master yet can be added as Unassigned before you confirm."
          onClose={() => setBulkOpen(false)}
          accentBar="linear-gradient(90deg, #0A6CFF 0%, #0B4FB8 100%)"
          width={920}
        >
          <React.Suspense fallback={<p className="text-[13px] text-ink-subtle">Loading…</p>}>
            <TrackerBulkUpload canImport={canImportBalances} canAddCompanies={canAddMasterCompanies} onClose={() => setBulkOpen(false)} />
          </React.Suspense>
        </CenterDialog>
      )}

      {/* The bulk bar: drawn while companies are ticked, for someone who may mark them. */}
      {canMark && targets.length > 0 && (
        <TrackerBulkBar targets={targets} canSetPriority={canSetPriority} canSetDone={canSetDone} storageReady={marksStorageReady} pending={marker.pending} onRun={marker.run} onClear={clearSelection} />
      )}
      {canMark && !marksStorageReady && (
        <p role="note" className="mb-3 rounded-lg border border-hairline bg-[#F8FAFD] px-3 py-2 text-[12.5px] text-ink-subtle">
          Priority and Collection Done aren&apos;t available yet (migration 0125 is pending).
        </p>
      )}
      {marker.dialog}

      {/* One scroll box for both directions: the list scrolls vertically inside it with the header pinned on top,
          and narrow screens still scroll sideways. */}
      <div className="max-h-[calc(100dvh-220px)] min-h-[320px] overflow-auto rounded-section bg-white" style={CARD} data-testid="tracker-scroll">
        <table className="w-full min-w-[1120px] border-collapse text-[13.5px]">
          <thead className="sticky top-0 z-10 shadow-[0_1px_0_#E6ECF5]" style={{ background: "#F5F7FB" }}>
            <tr>
              {canMark && (
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox checked={allShownSelected} indeterminate={someShownSelected && !allShownSelected} onChange={toggleAllShown} ariaLabel="Select all shown companies" />
                </th>
              )}
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
              {canMark && (
                <th scope="col" className="w-12 px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={canMark ? 10 : 8} className="px-3 py-10 text-center text-[13.5px] text-ink-muted">
                  {!connected
                    ? emptyMessage
                    : rows.length === 0
                      ? "No parties in the collection data."
                      : "No parties match these filters."}
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const od = partyOverdue(r.transactions, today);
                const state = markStateOf(r.marks);
                const ticked = !!r.masterId && selected.has(r.masterId);
                return (
                <tr
                  key={r.partyName}
                  data-overdue={od.level}
                  data-mark-state={state}
                  aria-selected={canMark && r.masterId ? ticked : undefined}
                  className={`border-t border-[#EEF1F6] ${od.level !== "none" || state !== "pending" ? "" : "hover:bg-[#F7F9FD]"}`}
                  style={markRowStyle(state) ?? overdueRowStyle(od.level)}
                >
                  {canMark && (
                    <td className="px-3 py-2">
                      {r.masterId && <Checkbox checked={ticked} onChange={(next) => toggleOne(r.masterId!, next)} ariaLabel={`Select ${r.partyName}`} />}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenName(r.partyName)}
                      className="text-left font-semibold text-ink-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#14336B]"
                    >
                      {r.partyName}
                    </button>
                    <MarkBadge marks={r.marks} />
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
                    {r.nextFollowupDate ? fmtDate(r.nextFollowupDate) : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    <TrackerComments companyName={r.partyName} history={r.history} editorId={canWriteFollowUps ? commentEditorId : null} />
                  </td>
                  <td className="px-3 py-2">
                    {r.commitment !== undefined ? (
                      // The popup's latest Commitment History record, for those allowed to see it: the same stored row,
                      // rendered by the same component. Read-only here: a commitment is recorded from the company popup.
                      <div className="min-w-[200px]" aria-label={`Commitment for ${r.partyName}`} data-commitment={r.commitment ? "set" : "none"}>
                        {r.commitment ? <LatestCommitment record={r.commitment} compact /> : <p className="text-[13px] text-ink-subtle">No commitment recorded</p>}
                      </div>
                    ) : (
                      // Not allowed to see commitments (collection.commitments.view): nothing is sent, so nothing is claimed.
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
                  {canMark && (
                    <td className="px-3 py-2">
                      {r.masterId && (
                        <MarkMenu
                          target={{ id: r.masterId, name: r.partyName }}
                          marks={r.marks}
                          canSetPriority={canSetPriority}
                          canSetDone={canSetDone}
                          storageReady={marksStorageReady}
                          pending={marker.pending}
                          onRun={marker.run}
                        />
                      )}
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
