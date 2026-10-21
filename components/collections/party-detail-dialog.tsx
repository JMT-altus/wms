"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { formatInr } from "@/lib/format";
import { saveFollowUp } from "@/app/(forms-module)/forms/collection/actions";
import type { PartyRow } from "@/lib/collections/derive";
import { NO_TRANSACTION_SOURCE_MESSAGE, type TransactionSourceInfo } from "@/lib/collections/source";
import { evaluateOverdue } from "@/lib/collections/overdue";
import { CommitmentSection } from "@/components/collections/commitment-section";

const FIELD = "w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[14px] text-ink-strong";

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
 * One party, in a panel: the figures from the accounting source (read-only),
 * the form for the next follow-up, and every earlier entry date-wise.
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
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[100] w-[min(560px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-[18px] font-bold text-ink-strong">
              {row?.partyName}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded-md p-1 text-ink-subtle hover:bg-[#EEF2F8] hover:text-ink-strong"
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          {row && (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13.5px]">
                <Fact label="Sales coordinator" value={row.coordinatorLabel ?? "Unassigned"} />
                <Fact label="Payment terms" value={row.paymentTerms ?? "Not given"} />
                <Fact label="Debit amount" value={money(row.debit)} />
                <Fact label="Credit amount" value={money(row.credit)} />
                <Fact label="Collection person" value={row.collectionPerson ?? "Not assigned"} />
                <Fact label="Next follow-up" value={row.nextFollowupDate ? day(row.nextFollowupDate) : "Not set"} />
              </dl>
              <p className="mt-1 text-[12px] text-ink-subtle">
                Figures come from the accounting source and can&apos;t be edited here.
                {row.masterId ? " The coordinator is the label from the Collection Master, not an employee record." : ""}
              </p>

              {(canSeeCommitments || canEditCommitments) && row.masterId && (
                <CommitmentSection companyId={row.masterId} companyName={row.partyName} comments={row.history} canView={canSeeCommitments} canEdit={canEditCommitments} />
              )}

              <Transactions row={row} today={today} source={transactionSource} />

              {!canWriteFollowUps ? (
                <p className="mt-4 border-t border-hairline pt-4 text-[13px] text-ink-subtle">You can view follow-ups but not add them.</p>
              ) : (
              <div className="mt-4 border-t border-hairline pt-4 grid gap-3">
                <label className="block text-[13px] font-semibold text-ink-soft">
                  Next follow-up date
                  <input
                    type="date"
                    value={date}
                    min={today}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${FIELD} mt-1 tabular-nums`}
                  />
                </label>
                <label className="block text-[13px] font-semibold text-ink-soft">
                  Note
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    className={`${FIELD} mt-1`}
                  />
                </label>
                {!storageReady && (
                  <p role="status" className="text-[12.5px] text-[#92400E]">
                    Follow-up storage isn&apos;t set up yet, so saving is unavailable.
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-[13px] text-[#B91C1C]">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Dialog.Close className="h-9 rounded-lg border border-hairline-strong px-3.5 text-[13.5px] font-semibold text-ink-soft hover:bg-[#F8FAFD]">
                    Close
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || !storageReady}
                    className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "#0A6CFF" }}
                  >
                    {saving ? "Saving…" : "Save follow-up"}
                  </button>
                </div>
              </div>
              )}

              <div className="mt-4 border-t border-hairline pt-3">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-subtle">History</h3>
                {row.history.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-subtle">No follow-ups recorded yet.</p>
                ) : (
                  <ul className="mt-2 grid gap-2">
                    {row.history.map((h) => (
                      <li key={h.id} className="rounded-lg bg-[#F8FAFD] px-3 py-2 text-[13px]">
                        <p className="text-ink-subtle tabular-nums">
                          {h.createdAt.toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            timeZone: "Asia/Kolkata",
                          })}
                          {h.createdByName ? ` · ${h.createdByName}` : ""}
                          {h.nextFollowupDate ? ` · next ${day(h.nextFollowupDate)}` : ""}
                        </p>
                        {h.note && <p className="mt-0.5 whitespace-pre-wrap text-ink-strong">{h.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink-strong tabular-nums">{value}</dd>
    </div>
  );
}

function Transactions({ row, today, source }: { row: PartyRow; today: string; source?: TransactionSourceInfo }) {
  const list = row.transactions ?? [];
  return (
    <section className="mt-4 border-t border-hairline pt-3" aria-label="Transactions">
      <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Transactions</h3>
      {!source?.approved ? (
        <p className="mt-2 text-[13px] text-ink-muted">
          {NO_TRANSACTION_SOURCE_MESSAGE}
        </p>
      ) : list.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-subtle">No transactions from {source.label} for this company.</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {list.map((t) => {
            const od = evaluateOverdue(t, today);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-[#F8FAFD] px-3 py-2 text-[13px]">
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
      )}
    </section>
  );
}
