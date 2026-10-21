"use client";

import * as React from "react";
import { formatInrExact } from "@/lib/collections/money";
import { getCompanyCommitment, saveCompanyCommitment } from "@/app/(forms-module)/forms/collection/commitments/actions";
import type { Commitment } from "@/lib/queries/collection-commitments";
import { CommentList, type CommentEntry } from "@/components/collections/comment-list";

const FIELD = "w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[14px] text-ink-strong";
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * Committed amount + committed date for one company, in the party popup.
 * Rendered only for holders of collection.commitments.view or .edit. The
 * figures are fetched here, on open, through an action that requires
 * collection.commitments.view — they are never part of the tracker page's
 * data, so no one else's browser ever receives them. The form shows only with
 * collection.commitments.edit; both actions check again on the server.
 */
export function CommitmentSection({
  companyId,
  companyName,
  comments,
  canView = true,
  canEdit = true,
}: {
  companyId: string;
  companyName: string;
  /** collection.commitments.view: fetch and show the recorded commitment. */
  canView?: boolean;
  /** collection.commitments.edit: show the form to record one. */
  canEdit?: boolean;
  /**
   * The company's Collection Tracker comments — the same follow-up history the
   * popup already holds (no second query). Comments are visible to everyone with
   * Tracker access; only the amount and date above are owner-only.
   */
  comments: CommentEntry[];
}) {
  // Without collection.commitments.view nothing is fetched, so there is nothing to wait for.
  const [state, setState] = React.useState<{ loading: boolean; commitment: Commitment | null; storageReady: boolean; error: string | null }>({
    loading: canView,
    commitment: null,
    storageReady: true,
    error: null,
  });
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    getCompanyCommitment(companyId)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { loading: false, commitment: res.commitment, storageReady: res.storageReady, error: null } : { loading: false, commitment: null, storageReady: true, error: res.error });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, commitment: null, storageReady: true, error: "Could not load the commitment." });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, canView]);

  async function save() {
    setFormError(null);
    if (!amount.trim()) {
      setFormError("Enter the committed amount.");
      return;
    }
    if (!date) {
      setFormError("Choose the committed date.");
      return;
    }
    setSaving(true);
    try {
      const res = await // The typed text is sent as is; the server checks it exactly (no float conversion).
      saveCompanyCommitment({ companyId, amount: amount.trim(), committedDate: date });
      if (!res.ok) setFormError(res.error);
      else {
        setState((s) => ({ ...s, commitment: res.commitment }));
        setAmount("");
        setDate("");
      }
    } catch {
      setFormError("The commitment could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 border-t border-hairline pt-3" aria-label="Commitment">
      <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Commitment (restricted)</h3>
      {state.loading ? (
        <p className="mt-2 text-[13px] text-ink-subtle">Loading…</p>
      ) : state.error ? (
        <p role="alert" className="mt-2 text-[13px] text-[#B91C1C]">{state.error}</p>
      ) : !state.storageReady ? (
        <p className="mt-2 text-[13px] text-[#92400E]">Commitment storage isn&apos;t set up yet (migration 0114 is pending).</p>
      ) : !canView ? (
        <p className="mt-2 text-[13px] text-ink-subtle">You can record a commitment but not view recorded ones.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
          <div>
            <dt className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Committed amount</dt>
            <dd className="mt-0.5 font-semibold text-ink-strong tabular-nums">{state.commitment ? formatInrExact(state.commitment.amount) : "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Committed date</dt>
            <dd className="mt-0.5 font-semibold text-ink-strong tabular-nums">{state.commitment ? day(state.commitment.committedDate) : "Not recorded"}</dd>
          </div>
        </dl>
      )}
      <div className="mt-3">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Tracker comments</p>
        <div className="mt-0.5 text-[13px] text-ink-soft">
          <CommentList comments={comments} className="max-h-[96px]" label={`Tracker comments for ${companyName}, newest first`} />
        </div>
      </div>
      {canEdit && !state.loading && !state.error && state.storageReady && (
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <label className="block text-[12.5px] font-semibold text-ink-soft">
            New committed amount (₹)
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 125000.50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${FIELD} mt-1 tabular-nums`}
              aria-label={`Committed amount for ${companyName}`}
            />
          </label>
          <label className="block text-[12.5px] font-semibold text-ink-soft">
            Committed date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD} mt-1 tabular-nums`} aria-label={`Committed date for ${companyName}`} />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-10 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
            style={{ background: "#0A6CFF" }}
          >
            {saving ? "Saving…" : "Record"}
          </button>
        </div>
      )}
      {formError && (
        <p role="alert" className="mt-2 text-[13px] text-[#B91C1C]">
          {formError}
        </p>
      )}
    </section>
  );
}
