"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { escalateForReview, setCollectionConfirmation } from "@/app/(forms-module)/forms/collection/actions";
import {
  CONFIRMATION_LABELS,
  CONFIRMATION_UNAVAILABLE,
  CONFIRMATION_VALUES,
  confirmationAvailable,
  type ConfirmationValue,
} from "@/lib/collections/review";

const SELECT = "h-8 rounded-lg border border-hairline-strong bg-white px-2 text-[12.5px] text-ink-strong disabled:opacity-60";
const when = (d: Date) =>
  d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * Collection Amount Confirmation for one Tracker row. Starts at "Not set" — never
 * a default Yes — and is only offered when the approved transaction source
 * supplies an outstanding amount to confirm. Saved by the server (append-only);
 * the shown value changes only after the server accepts it.
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

/**
 * "Escalate for review" for one Tracker row. Every holder of
 * collection.escalation.review is a reviewer — no person is named. Shows the
 * open escalation (who and when) instead of the button while one is open; the
 * server refuses a duplicate.
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
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function escalate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await escalateForReview({ companyId });
      if (!res.ok) setMessage({ ok: false, text: res.error });
      else {
        setMessage({ ok: true, text: "Escalation submitted for review." });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "The escalation could not be saved. Please try again." });
    } finally {
      setBusy(false);
    }
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
        <button
          type="button"
          onClick={() => void escalate()}
          disabled={busy || !storageReady}
          aria-label={`Escalate ${companyName} for review`}
          className="h-8 whitespace-nowrap rounded-lg border border-hairline-strong px-2.5 text-[12.5px] font-semibold text-ink-strong hover:bg-[#F7F9FD] disabled:opacity-50"
        >
          {busy ? "Escalating…" : "Escalate for review"}
        </button>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-0.5 max-w-[200px] text-[11.5px] font-semibold ${message.ok ? "text-[#047857]" : "text-[#B91C1C]"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
