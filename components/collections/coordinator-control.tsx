"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { assignSalesCoordinator } from "@/app/(forms-module)/forms/collection/actions";

const SELECT = "h-8 max-w-[180px] rounded-lg border border-hairline-strong bg-white px-2 text-[12.5px] text-ink-strong disabled:opacity-60";
const BTN = "h-8 rounded-lg px-2.5 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The Sales Coordinator cell for holders of collection.coordinator.assign — rendered only
 * when the server has confirmed the capability, and the server action checks again.
 * An unassigned company gets a dropdown; an assigned one shows its coordinator
 * with a "Change" button. Choices are the coordinators already in the
 * Collection Master. Nothing is saved until Save is pressed, there is no blank
 * choice, and the shown value changes only after the server accepts it.
 */
export function CoordinatorControl({
  companyId,
  companyName,
  current,
  options,
}: {
  companyId: string;
  companyName: string;
  /** The stored coordinator; null = Unassigned. */
  current: string | null;
  options: readonly string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(current === null);
  const [choice, setChoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const choices = options.filter((o) => o !== current);

  async function save() {
    if (!choice || choice === current) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await assignSalesCoordinator({ companyId, coordinatorLabel: choice, expected: current });
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        setChoice("");
        router.refresh();
      }
    } catch {
      setError("The Sales Coordinator could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>{current}</span>
        <button
          type="button"
          className="text-[12px] font-bold text-[#0B4FB8] underline-offset-2 hover:underline"
          aria-label={`Change the Sales Coordinator for ${companyName}`}
          onClick={() => {
            setEditing(true);
            setSaved(false);
          }}
        >
          Change
        </button>
        {saved && (
          <span role="status" className="text-[11.5px] font-semibold text-[#047857]">
            Saved.
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      {current === null && <p className="mb-0.5 text-[11.5px] text-ink-subtle">Unassigned</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label={`Sales Coordinator for ${companyName}`}
          className={SELECT}
          value={choice}
          disabled={busy || choices.length === 0}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="" disabled>
            {choices.length === 0 ? "No coordinators to choose" : "Choose…"}
          </option>
          {choices.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button type="button" className={BTN} style={{ background: "#0A6CFF", color: "#fff" }} disabled={busy || !choice} onClick={() => void save()}>
          Save
        </button>
        {current !== null && (
          <button
            type="button"
            className={BTN}
            style={{ background: "#EEF0F3", color: "#475569" }}
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setChoice("");
              setError(null);
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {current !== null && <p className="mt-0.5 text-[11px] text-ink-subtle">Currently {current}</p>}
      {saved && current === null && (
        <p role="status" className="mt-0.5 text-[11.5px] font-semibold text-[#047857]">
          Saved.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-0.5 max-w-[220px] text-[11.5px] font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
}
