"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { formatInrExact, toPaise } from "@/lib/collections/money";
import { fmtDate } from "@/lib/dates";
import { CommentList, type CommentEntry } from "@/components/collections/comment-list";
import { partyOverdue, type OverdueInput } from "@/lib/collections/overdue";
import { OverdueBadge, overdueRowStyle, useBusinessToday } from "@/components/collections/overdue-display";
import { confirmationLabel, type ConfirmationValue } from "@/lib/collections/review";
import { commentDate, commentTime } from "@/lib/collections/comment-audit";
import { addEscalationComment, closeEscalation } from "@/app/(collection-module)/collection/commitments/actions";

/**
 * One company on the commitments and escalations page: a recorded commitment, an open
 * escalation, or both. Commitment fields are null when none is recorded — an
 * escalation never invents an amount or a date.
 */
export interface CommitmentView {
  companyId: string;
  companyName: string;
  collectionPerson: string | null;
  /** Exact decimal text, or null when no commitment is recorded. */
  amount: string | null;
  committedDate: string | null;
  recordedAt: Date | null;
  /** The company's Collection Tracker comments, most recent first. */
  comments: CommentEntry[];
  /** Due-date facts the Tracker's overdue colouring reads. */
  due?: OverdueInput[];
  /** Current Collection Amount Confirmation (Yes/No); null = not set. */
  confirmation?: ConfirmationValue | null;
  /** Current confirmed amount ("x.yy" rupees); null = not entered. */
  confirmedAmount?: string | null;
  /** Outstanding as the approved transaction source supplies it; null = not available. */
  outstanding?: number | null;
  /** The open escalation, if any. */
  escalation?: {
    id: string;
    escalatedAt: Date;
    escalatedByName: string | null;
    confirmationAtEscalation: ConfirmationValue | null;
    /** The confirmed amount in force when escalated ("x.yy" rupees); null = none entered then (or raised before amounts existed). */
    confirmedAmountAtEscalation?: string | null;
    /** Reason for Escalation recorded with this escalation; null = raised before reasons were recorded. */
    reason?: string | null;
  } | null;
}

const CARD = { border: "1px solid var(--color-hairline-strong)", boxShadow: "0 1px 2px rgba(15,23,42,0.05)" } as const;
const SELECT = "h-8 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong";
const UNASSIGNED = "__unassigned__";
const DASH = <span className="text-ink-subtle">—</span>;

/** Pure filter, shared with the tests: search on company, person and comment text, and a person filter. */
export function filterCommitments<T extends Pick<CommitmentView, "companyName" | "collectionPerson"> & { comments?: CommentEntry[] }>(
  rows: T[],
  query: string,
  person: string,
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    // Like the Tracker's search: company, person and comment text.
    const hay = [r.companyName, r.collectionPerson ?? "", ...(r.comments ?? []).map((c) => c.note ?? "")].join(" ").toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (person === UNASSIGNED) return r.collectionPerson === null;
    if (person && r.collectionPerson !== person) return false;
    return true;
  });
}

function CloseEscalationButton({ escalationId, companyName }: { escalationId: string; companyName: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function close() {
    setBusy(true);
    setError(null);
    try {
      const res = await closeEscalation({ escalationId });
      if (!res.ok) setError(res.error);
      else router.refresh();
    } catch {
      setError("The escalation could not be closed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void close()}
        disabled={busy}
        aria-label={`Close the escalation for ${companyName}`}
        className="mt-1 h-7 rounded-md border border-hairline-strong px-2 text-[12px] font-semibold text-ink-strong hover:bg-[#F7F9FD] disabled:opacity-50"
      >
        {busy ? "Closing…" : "Close"}
      </button>
      {error && (
        <p role="alert" className="mt-0.5 text-[11.5px] font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
    </>
  );
}

/** A one-time key for one comment dialog: a repeated click sends the same key, and the server saves it once. */
const newToken = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

/**
 * Add Comment on an open escalation (collection.escalation.review, checked again
 * by the action). A small inline form: Save Comment / Cancel, nothing empty.
 * Saving never closes the escalation; Close stays a separate button.
 */
function AddReviewerCommentButton({ escalationId, companyName }: { escalationId: string; companyName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  function start() {
    setOpen(true);
    setNote("");
    setError(null);
    setSaved(false);
    setToken(newToken());
  }
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!note.trim()) {
      setError("A comment can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await addEscalationComment({ escalationId, note: note.trim(), token });
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        setNote("");
        setSaved(true);
        router.refresh();
      }
    } catch {
      setError("The comment could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={start}
          aria-label={`Add a reviewer comment for ${companyName}`}
          className="mt-1 mr-1.5 h-7 rounded-md border border-[#C4B5FD] bg-[#F5F3FF] px-2 text-[12px] font-semibold text-[#5B21B6] hover:bg-[#EDE9FE]"
        >
          Add Comment
        </button>
        {saved && (
          <p role="status" className="mt-0.5 text-[11.5px] font-semibold text-[#047857]">
            Comment saved. The escalation is still open.
          </p>
        )}
      </>
    );
  }
  return (
    <form onSubmit={(e) => void save(e)} className="mt-1 block max-w-[320px] rounded-md border border-[#C4B5FD] bg-[#F5F3FF] p-2" aria-label={`Reviewer comment for ${companyName}`}>
      <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-[#5B21B6]">
        Reviewer comment
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          autoFocus
          disabled={busy}
          aria-label={`Reviewer comment text for ${companyName}`}
          className="mt-1 block w-full rounded-md border border-hairline-strong bg-white px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal text-ink-strong"
        />
      </label>
      {error && (
        <p role="alert" className="mt-1 text-[11.5px] font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
      <span className="mt-1.5 flex gap-1.5">
        <button type="submit" disabled={busy || !note.trim()} className="h-7 rounded-md px-2.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "#6D28D9" }}>
          {busy ? "Saving…" : "Save Comment"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="h-7 rounded-md border border-hairline-strong px-2.5 text-[12px] font-semibold text-ink-strong disabled:opacity-50">
          Cancel
        </button>
      </span>
    </form>
  );
}

/**
 * Recorded commitments and open escalations, each with its collection person,
 * confirmation, outstanding (when the source supplies it), due dates with the
 * Tracker's overdue colouring, and comments. Which parts render follows the
 * viewer's capabilities, decided on the server (which also decides what data
 * is sent): commitment columns with collection.commitments.view, the
 * escalation column with collection.escalation.review, and Close with
 * collection.escalation.close.
 */
export function CommitmentsTable({
  rows,
  today: initialToday,
  showCommitments = true,
  showEscalations = true,
  canClose = true,
  canComment = false,
  emptyMessage = "No commitments or open escalations yet.",
}: {
  rows: CommitmentView[];
  today: string;
  showCommitments?: boolean;
  showEscalations?: boolean;
  canClose?: boolean;
  /** collection.escalation.review (the Escalations page): Add Comment on each open escalation. */
  canComment?: boolean;
  /** Shown when there are no rows at all (what "empty" means depends on what the viewer may see). */
  emptyMessage?: string;
}) {
  // Same business date and midnight rollover as the Tracker.
  const today = useBusinessToday(initialToday);
  const [query, setQuery] = React.useState("");
  const [person, setPerson] = React.useState("");
  const people = React.useMemo(
    () => [...new Set(rows.map((r) => r.collectionPerson).filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const shown = filterCommitments(rows, query, person);
  // Summed in whole paise (BigInt) — exact at any size; only recorded commitments count.
  const total = shown.reduce((s, r) => (r.amount === null ? s : s + toPaise(r.amount)), 0n);
  const openCount = shown.filter((r) => r.escalation).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company, person or comments"
            aria-label="Search commitments"
            className="h-8 w-[260px] rounded-lg border border-hairline-strong bg-white pl-8 pr-2.5 text-[13px] text-ink-strong placeholder:text-ink-subtle"
          />
        </div>
        <select aria-label="Collection person" value={person} onChange={(e) => setPerson(e.target.value)} className={SELECT}>
          <option value="">All collection persons</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {rows.some((r) => r.collectionPerson === null) && <option value={UNASSIGNED}>Unassigned</option>}
        </select>
        <span className="ml-auto text-[12.5px] text-ink-subtle tabular-nums">
          {shown.length} compan{shown.length === 1 ? "y" : "ies"}
          {showCommitments && ` · ${formatInrExact(total)} committed`}
          {showEscalations && ` · ${openCount} open escalation${openCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
        <table className="w-full min-w-[1040px] border-collapse text-[13.5px]">
          <thead style={{ background: "#F5F7FB" }}>
            <tr className="text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-soft">
              <th scope="col" className="px-3 py-2">Company</th>
              {showCommitments && (
                <>
                  <th scope="col" className="px-3 py-2 text-right">Committed amount</th>
                  <th scope="col" className="px-3 py-2">Committed date</th>
                </>
              )}
              <th scope="col" className="px-3 py-2">Collection person</th>
              <th scope="col" className="px-3 py-2">Confirmation</th>
              {/* Outstanding and Due date are no longer columns here (management's decision). The row's overdue
                  colouring still reads the same due dates, so nothing about the data or the rule changed. */}
              <th scope="col" className="px-3 py-2">Comments</th>
              {showEscalations && <th scope="col" className="px-3 py-2">Escalation</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4 + (showCommitments ? 2 : 0) + (showEscalations ? 1 : 0)} className="px-3 py-10 text-center text-ink-muted">
                  {rows.length === 0 ? emptyMessage : "Nothing matches these filters."}
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                // The Tracker's rule, unchanged: worst level across the company's due dates.
                const od = partyOverdue(r.due, today);
                return (
                  <tr key={r.companyId} data-overdue={od.level} className="border-t border-[#EEF1F6] align-top" style={overdueRowStyle(od.level)}>
                    <td className="px-3 py-2 font-semibold text-ink-strong">
                      {r.companyName}
                      <OverdueBadge level={od.level} daysOverdue={od.daysOverdue} />
                      <span className="mt-1 flex flex-wrap gap-1">
                        {showEscalations && r.escalation && (
                          <span className="rounded-full px-1.5 py-0.5 text-[11px] font-bold" style={{ background: "#EEF4FF", color: "#0B4FB8" }}>
                            Escalated
                          </span>
                        )}
                        {showCommitments && r.amount !== null && (
                          <span className="rounded-full px-1.5 py-0.5 text-[11px] font-bold" style={{ background: "#ECFDF5", color: "#047857" }}>
                            Commitment recorded
                          </span>
                        )}
                      </span>
                    </td>
                    {showCommitments && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">{r.amount === null ? <span className="text-ink-subtle">Not recorded</span> : formatInrExact(r.amount)}</td>
                        <td className="px-3 py-2 tabular-nums">{r.committedDate === null ? <span className="text-ink-subtle">Not recorded</span> : fmtDate(r.committedDate)}</td>
                      </>
                    )}
                    <td className="px-3 py-2">{r.collectionPerson ?? <span className="text-ink-subtle">Unassigned</span>}</td>
                    <td className="px-3 py-2">
                      {confirmationLabel(r.confirmation)}
                      {r.confirmedAmount && <span className="block text-[12px] tabular-nums text-ink-subtle">Amount: {formatInrExact(r.confirmedAmount)}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">
                      <CommentList comments={r.comments} label={`Comments for ${r.companyName}, newest first`} />
                    </td>
                    {showEscalations && (
                    <td className="px-3 py-2 text-[12.5px]">
                      {r.escalation ? (
                        <>
                          <span className="block font-semibold text-ink-strong">Open</span>
                          <span className="mt-1 block max-w-[320px] rounded-md px-2 py-1.5" style={{ background: "#FFF7ED", border: "1px solid #FED7AA" }} data-escalation-reason>
                            <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-[#9A3412]">Reason for Escalation</span>
                            {r.escalation.reason ? (
                              <span className="block whitespace-pre-wrap break-words text-[13px] font-semibold text-ink-strong">{r.escalation.reason}</span>
                            ) : (
                              <span className="block italic text-ink-subtle">Not recorded (escalated before a reason was required)</span>
                            )}
                          </span>
                          <span className="mt-1 block text-ink-muted">
                            Escalated by: {r.escalation.escalatedByName ?? "Not on record"} · {commentDate(r.escalation.escalatedAt)} · {commentTime(r.escalation.escalatedAt)}
                          </span>
                          <span className="block text-ink-subtle">Confirmation then: {confirmationLabel(r.escalation.confirmationAtEscalation)}</span>
                          <span className="block text-ink-subtle">Confirmed amount then: {r.escalation.confirmedAmountAtEscalation ? formatInrExact(r.escalation.confirmedAmountAtEscalation) : "Not entered"}</span>
                          <span className="block">
                            {canComment && <AddReviewerCommentButton escalationId={r.escalation.id} companyName={r.companyName} />}
                            {canClose && <CloseEscalationButton escalationId={r.escalation.id} companyName={r.companyName} />}
                          </span>
                        </>
                      ) : (
                        DASH
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
    </div>
  );
}
