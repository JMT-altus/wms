"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { escalateForReview, setCollectionConfirmation, setConfirmedAmount } from "@/app/(collection-module)/collection/actions";
import {
  CONFIRMATION_LABELS,
  CONFIRMATION_UNAVAILABLE,
  CONFIRMATION_VALUES,
  CONFIRMED_AMOUNT_MAX_CHARS,
  CONFIRMED_AMOUNT_PLACEHOLDER,
  ESCALATION_REASON_MAX,
  ESCALATION_REASON_REQUIRED,
  EscalationReason,
  confirmationAvailable,
  parseConfirmedAmount,
  type ConfirmationValue,
} from "@/lib/collections/review";
import { formatInrExact } from "@/lib/collections/money";

const SELECT = "h-8 rounded-lg border border-hairline-strong bg-white px-2 text-[12.5px] text-ink-strong disabled:opacity-60";
const when = (d: Date) =>
  d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * The confirmed AMOUNT for one Tracker row — the text field under the
 * "Collection Amount Confirmation" heading (migration 0123). A separate value
 * from the Yes/No answer (`ConfirmationControl` below, no longer in the row):
 * entering it verifies nothing. Starts blank ("not entered") and shows the
 * newest saved amount; Save appears once the field differs from it. Checked in
 * the browser first for a quick message (parseConfirmedAmount — the same rule
 * the server applies), sent only when valid, and the shown value changes only
 * after the server accepts it. Append-only on the server: who and when are
 * recorded with every entry.
 */
export function ConfirmedAmountControl({
  companyId,
  companyName,
  current,
  storageReady,
  canSet = true,
}: {
  companyId: string;
  companyName: string;
  /** The newest saved amount ("x.yy" rupees text), or null when none has been entered. */
  current: { amount: string; recordedByName: string | null; recordedAt: Date } | null;
  /** False while migration 0123 isn't applied. */
  storageReady: boolean;
  /** collection.confirmation.set, decided on the server; without it the amount is shown read-only (the action checks again). */
  canSet?: boolean;
}) {
  const router = useRouter();
  const saved = current?.amount ?? "";
  const [value, setValue] = React.useState(saved);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  // A refresh with a newer saved amount replaces what the field shows (nothing is being typed then).
  const [shownFor, setShownFor] = React.useState(saved);
  if (shownFor !== saved) {
    setShownFor(saved);
    setValue(saved);
  }
  const dirty = value.trim() !== saved;
  const label = `Collection Amount Confirmation for ${companyName}`;
  const editable = storageReady && canSet;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !editable) return;
    const parsed = parseConfirmedAmount(value);
    if (!parsed.ok) {
      setError(parsed.error);
      setDone(false);
      return;
    }
    if (parsed.text === saved) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await setConfirmedAmount({ companyId, amount: parsed.text });
      if (!res.ok) setError(res.error);
      else {
        setValue(parsed.text);
        setDone(true);
        router.refresh();
      }
    } catch {
      setError("The confirmed amount could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={(e) => void save(e)} noValidate className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={label}
          placeholder={CONFIRMED_AMOUNT_PLACEHOLDER}
          value={value}
          maxLength={CONFIRMED_AMOUNT_MAX_CHARS}
          disabled={busy || !editable}
          readOnly={!editable}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
            if (done) setDone(false);
          }}
          className={`${SELECT} w-[150px] max-w-full tabular-nums placeholder:text-ink-subtle`}
        />
        {editable && dirty && !busy && (
          <button type="submit" aria-label={`Save confirmed amount for ${companyName}`} className="h-8 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-semibold text-white" style={{ background: "#0A6CFF" }}>
            Save
          </button>
        )}
        {busy && <span className="text-[11.5px] text-ink-subtle">Saving…</span>}
      </form>
      {current && (
        <p className="mt-0.5 text-[11px] text-ink-subtle">
          {formatInrExact(current.amount)}
          {current.recordedByName ? ` · ${current.recordedByName}, ` : " · "}
          {when(current.recordedAt)}
        </p>
      )}
      {!storageReady && <p className="mt-0.5 max-w-[180px] text-[11px] text-ink-subtle">Confirmed amounts aren&apos;t available yet (migration 0123 is pending).</p>}
      {storageReady && !canSet && <p className="mt-0.5 max-w-[180px] text-[11px] text-ink-subtle">You can view this but not change it.</p>}
      {done && !error && (
        <p role="status" className="mt-0.5 text-[11.5px] font-semibold text-[#047857]">
          Saved.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-0.5 max-w-[200px] text-[11.5px] font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The Yes/No Collection Amount Confirmation (migration 0115) — kept as it is for
 * the answer's history and the review page, but no longer rendered in the
 * Tracker row, where the confirmed-amount field above replaced the dropdown.
 * Starts at "Not set" — never a default Yes — and is only offered when the
 * approved transaction source supplies an outstanding amount to confirm. Saved
 * by the server (append-only); the shown value changes only after the server
 * accepts it.
 */
export function ConfirmationControl({
  companyId,
  companyName,
  outstanding,
  current,
  storageReady,
  canSet = true,
}: {
  companyId: string;
  companyName: string;
  outstanding: number | null;
  current: { value: ConfirmationValue; recordedByName: string | null; recordedAt: Date } | null;
  storageReady: boolean;
  /** collection.confirmation.set, decided on the server; without it the value is shown read-only (the action checks again). */
  canSet?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const available = confirmationAvailable(outstanding);
  const label = `Collection Amount Confirmation for ${companyName}`;

  async function choose(value: string) {
    if (!(CONFIRMATION_VALUES as readonly string[]).includes(value)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await setCollectionConfirmation({ companyId, value });
      if (!res.ok) setError(res.error);
      else router.refresh();
    } catch {
      setError("The confirmation could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <select
        aria-label={label}
        className={SELECT}
        value={current?.value ?? ""}
        disabled={busy || !available || !storageReady || !canSet}
        title={!available ? CONFIRMATION_UNAVAILABLE : undefined}
        onChange={(e) => void choose(e.target.value)}
      >
        {/* The unset state is explicit and can't be re-selected once answered. */}
        <option value="" disabled={!!current}>
          {available ? "Not set" : "Unavailable"}
        </option>
        {CONFIRMATION_VALUES.map((v) => (
          <option key={v} value={v}>
            {CONFIRMATION_LABELS[v]}
          </option>
        ))}
      </select>
      {current && (
        <p className="mt-0.5 text-[11px] text-ink-subtle">
          {current.recordedByName ? `${current.recordedByName}, ` : ""}
          {when(current.recordedAt)}
        </p>
      )}
      {!available && <p className="mt-0.5 max-w-[180px] text-[11px] text-ink-subtle">No outstanding amount from an approved source.</p>}
      {available && !canSet && <p className="mt-0.5 max-w-[180px] text-[11px] text-ink-subtle">You can view this but not change it.</p>}
      {error && (
        <p role="alert" className="mt-0.5 max-w-[200px] text-[11.5px] font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
}

/** The escalate button's wording. A label only: who reviews is decided by the collection.escalation.review grant, never by a name. */
export const ESCALATE_LABEL = "Escalate";

/**
 * The escalate control for one Tracker row: a button that opens a dialog asking
 * for the Reason for Escalation (required, trimmed, at most 1,000 characters).
 * Nothing is sent until the reason is valid, and the server checks it again.
 * Every holder of collection.escalation.review is a reviewer — the button's
 * wording names nobody in any permission or routing rule. Shows the open
 * escalation (who and when) instead of the button while one is open; the server
 * refuses a duplicate.
 */
export function EscalateControl({
  companyId,
  companyName,
  open,
  storageReady,
  canEscalate = true,
}: {
  companyId: string;
  companyName: string;
  open: { escalatedAt: Date; escalatedByName: string | null } | null;
  storageReady: boolean;
  /** collection.escalation.create, decided on the server (the action checks again). */
  canEscalate?: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false); // blocks a second submit before React re-renders the disabled button
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const fieldId = React.useId();
  const countId = React.useId();
  const errorId = React.useId();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busyRef.current) return;
    const checked = EscalationReason.safeParse(reason);
    if (!checked.success) {
      setFieldError(checked.error.issues[0]?.message ?? ESCALATION_REASON_REQUIRED);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFieldError(null);
    setMessage(null);
    try {
      const res = await escalateForReview({ companyId, reason: checked.data });
      if (!res.ok) setFieldError(res.error); // keep the dialog and the typed reason
      else {
        setDialogOpen(false);
        setReason("");
        setMessage({ ok: true, text: "Escalation submitted for review." });
        router.refresh();
      }
    } catch {
      setFieldError("The escalation could not be saved. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function onOpenChange(next: boolean) {
    if (busy) return; // can't be dismissed mid-submit
    setDialogOpen(next);
    if (!next) setFieldError(null);
  }

  return (
    <div>
      {open ? (
        <p className="text-[12px] font-semibold text-[#0B4FB8]">
          Escalated
          <span className="block text-[11px] font-normal text-ink-subtle">
            {open.escalatedByName ? `${open.escalatedByName}, ` : ""}
            {when(open.escalatedAt)}
          </span>
        </p>
      ) : !canEscalate ? (
        <span className="text-[12px] text-ink-subtle">Not escalated</span>
      ) : (
        <Dialog.Root open={dialogOpen} onOpenChange={onOpenChange}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              disabled={!storageReady}
              aria-label={`Escalate ${companyName}`}
              className="h-8 whitespace-nowrap rounded-lg border border-hairline-strong px-2.5 text-[12.5px] font-semibold text-ink-strong hover:bg-[#F7F9FD] disabled:opacity-50"
            >
              {ESCALATE_LABEL}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.35)]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
              <Dialog.Title className="text-[16px] font-bold text-ink-strong">{ESCALATE_LABEL}</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-subtle">
                {companyName} — explain why this collection record needs review.
              </Dialog.Description>
              <form onSubmit={(e) => void submit(e)} noValidate className="mt-3">
                <label htmlFor={fieldId} className="block text-[13px] font-semibold text-ink-soft">
                  Reason for Escalation{" "}
                  <span aria-hidden="true" className="text-[#B91C1C]">
                    *
                  </span>
                </label>
                <textarea
                  id={fieldId}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  required
                  aria-required="true"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${countId} ${errorId}` : countId}
                  maxLength={ESCALATION_REASON_MAX}
                  rows={5}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[14px] text-ink-strong disabled:opacity-60"
                />
                <p id={countId} className="mt-0.5 text-right text-[11.5px] tabular-nums text-ink-subtle">
                  {reason.length.toLocaleString("en-IN")} / {ESCALATION_REASON_MAX.toLocaleString("en-IN")}
                </p>
                {fieldError && (
                  <p id={errorId} role="alert" className="mt-1 text-[13px] font-semibold text-[#B91C1C]">
                    {fieldError}
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      disabled={busy}
                      className="h-9 rounded-lg border border-hairline-strong px-3.5 text-[13.5px] font-semibold text-ink-soft hover:bg-[#F8FAFD] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "#0A6CFF" }}
                  >
                    {busy ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-0.5 max-w-[200px] text-[11.5px] font-semibold ${message.ok ? "text-[#047857]" : "text-[#B91C1C]"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
