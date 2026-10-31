"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { formatInr } from "@/lib/format";
import { saveFollowUp } from "@/app/(collection-module)/collection/actions";
import type { PartyRow } from "@/lib/collections/derive";
import type { TransactionSourceInfo } from "@/lib/collections/source";
import { evaluateOverdue } from "@/lib/collections/overdue";
import { CommitmentSection } from "@/components/collections/commitment-section";
import { CommentAudit } from "@/components/collections/comment-list";
import { POPUP_HEADING, POPUP_SECTION, POPUP_VALUE } from "@/components/collections/popup-style";

const FIELD = "w-full rounded-lg border border-hairline-strong bg-white px-2.5 py-1.5 text-[13.5px] text-ink-strong";

const money = (n: number | null) => (n === null ? "—" : formatInr(n));
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/**
 * One party, in a compact panel: the figures from the accounting source
 * (read-only), the commitment (for its holders), the form for the next
 * follow-up, and every earlier entry date-wise.
 *
 * Nothing is reported saved until the server says so, and the figures are shown
 * exactly as supplied — never edited or recalculated here.
 */
export function PartyDetailDialog({
  row,
  today,
  storageReady,
  transactionSource,
  canSeeCommitments = false,
  canEditCommitments = false,
  canWriteFollowUps = true,
  onClose,
}: {
  row: PartyRow | null;
  today: string;
  storageReady: boolean;
  transactionSource?: TransactionSourceInfo;
  /** collection.commitments.view; without it (and without .edit) the section isn't rendered and nothing is fetched. */
  canSeeCommitments?: boolean;
  /** collection.commitments.edit: the commitment form. */
  canEditCommitments?: boolean;
  /** collection.followup.write: the follow-up form (the action checks again). */
  canWriteFollowUps?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const inFlight = React.useRef(false);

  // A different party starts a clean form: the caller keys this component by party.

  async function save() {
    if (!row || inFlight.current) return;
    setError(null);
    if (!date && !note.trim()) {
      setError("Enter a next follow-up date or a note.");
      return;
    }
    if (date && date < today) {
      setError("The next follow-up date can't be in the past.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await saveFollowUp({
        partyName: row.partyName,
        nextFollowupDate: date || null,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      fireToast({ message: "Follow-up saved.", type: "success" });
      setDate("");
      setNote("");
      router.refresh();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-[#0F172A]/35" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[100] flex max-h-[calc(100dvh-24px)] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-hairline bg-white shadow-xl"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-2.5">
            <Dialog.Title className="min-w-0 break-words text-[15px] font-bold leading-6 text-ink-strong">
              {row?.partyName}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mr-1 shrink-0 rounded-md p-1 text-ink-subtle hover:bg-[#EEF2F8] hover:text-ink-strong"
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          {row && (
            <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-hairline bg-[#F8FAFD] px-3 py-2.5 text-[13.5px] sm:grid-cols-3">
                <Fact label="Sales coordinator" value={row.coordinatorLabel ?? "Unassigned"} />
                <Fact label="Payment terms" value={row.paymentTerms ?? "Not given"} />
                <Fact label="Next follow-up" value={row.nextFollowupDate ? day(row.nextFollowupDate) : "Not set"} />
                <Fact label="Debit amount" value={money(row.debit)} />
                <Fact label="Credit amount" value={money(row.credit)} />
                <Fact label="Collection person" value={row.collectionPerson ?? "Not assigned"} />
              </dl>
              <p className="mt-1.5 text-[11.5px] leading-snug text-ink-subtle">
                Figures come from the accounting source and can&apos;t be edited here.
                {row.masterId ? " The coordinator is the label from the Collection Master, not an employee record." : ""}
              </p>

              {(canSeeCommitments || canEditCommitments) && row.masterId && (
                <CommitmentSection companyId={row.masterId} companyName={row.partyName} comments={row.history} canView={canSeeCommitments} canEdit={canEditCommitments} />
              )}

              <Transactions row={row} today={today} source={transactionSource} />

              {!canWriteFollowUps ? (
                <p className={`${POPUP_SECTION} text-[12.5px] text-ink-subtle`}>You can view follow-ups but not add them.</p>
              ) : (
              <div className={`${POPUP_SECTION} grid gap-2`}>
                <h3 className={POPUP_HEADING}>Next follow-up</h3>
                <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                  <label className="block text-[12.5px] font-semibold text-ink-soft">
                    Next follow-up date
                    <input
                      type="date"
                      value={date}
                      min={today}
                      onChange={(e) => setDate(e.target.value)}
                      className={`${FIELD} mt-1 tabular-nums`}
                    />
                  </label>
                  <label className="block min-w-0 text-[12.5px] font-semibold text-ink-soft">
                    Note
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={2000}
                      rows={2}
                      className={`${FIELD} mt-1 resize-y`}
                    />
                  </label>
                </div>
                {!storageReady && (
                  <p role="status" className="text-[12.5px] text-[#92400E]">
                    Follow-up storage isn&apos;t set up yet, so saving is unavailable.
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-[12.5px] text-[#B91C1C]">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Dialog.Close className="h-8 rounded-lg border border-hairline-strong px-3 text-[13px] font-semibold text-ink-soft hover:bg-[#F8FAFD]">
                    Close
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || !storageReady}
                    className="h-8 rounded-lg px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "#0A6CFF" }}
                  >
                    {saving ? "Saving…" : "Save follow-up"}
                  </button>
                </div>
              </div>
              )}

              <div className={POPUP_SECTION}>
                <h3 className={POPUP_HEADING}>History</h3>
                {row.history.length === 0 ? (
                  <p className="mt-1.5 text-[12.5px] text-ink-subtle">No follow-ups recorded yet.</p>
                ) : (
                  <ul className="mt-1.5 grid max-h-[240px] gap-1.5 overflow-y-auto pr-0.5">
                    {row.history.map((h) => (
                      <li key={h.id} className="rounded-lg border border-hairline bg-[#F8FAFD] px-2.5 py-1.5 text-[12.5px]">
                        <CommentAudit entry={h} variant="full" />
                        {h.nextFollowupDate && <p className="mt-0.5 tabular-nums text-ink-subtle">Next follow-up: {day(h.nextFollowupDate)}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={POPUP_HEADING}>{label}</dt>
      <dd className={POPUP_VALUE} title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The company's transactions from the approved source, when there are any.
 * With no approved source, or none for this company, nothing is shown — the
 * figures above already say what is known.
 */
function Transactions({ row, today, source }: { row: PartyRow; today: string; source?: TransactionSourceInfo }) {
  const list = row.transactions ?? [];
  if (!source?.approved || list.length === 0) return null;
  return (
    <section className={POPUP_SECTION} aria-label="Transactions">
      <h3 className={POPUP_HEADING}>Transactions</h3>
      <ul className="mt-1.5 grid gap-1.5">
        {list.map((t) => {
          const od = evaluateOverdue(t, today);
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-hairline bg-[#F8FAFD] px-2.5 py-1.5 text-[12.5px]">
              <span className="font-semibold text-ink-strong">{t.reference ?? "No reference"}</span>
              <span className="tabular-nums">{money(t.amount)}</span>
              <span className="tabular-nums text-ink-soft">Outstanding {money(t.outstanding)}</span>
              <span className="tabular-nums text-ink-soft">Due {t.dueDate ? day(t.dueDate) : "—"}</span>
              {t.status && <span className="text-ink-subtle">{t.status}</span>}
              {od.level !== "none" && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[11px] font-bold"
                  style={od.level === "critical" ? { color: "#B91C1C", background: "#FEF2F2" } : { color: "#92400E", background: "#FFFBEB" }}
                >
                  Overdue {od.daysOverdue} day{od.daysOverdue === 1 ? "" : "s"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
