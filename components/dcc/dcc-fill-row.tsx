"use client";

import * as React from "react";
import { Loader2, Pencil, MessageSquare, AlertTriangle } from "lucide-react";
import { DCC_STATUSES, dccStatusTone, maskLabel, type DccStatus } from "@/lib/dcc/util";
import type { BoardItem, SlotValue } from "@/lib/dcc/board-model";

export interface FillRowProps {
  item: BoardItem;
  value: SlotValue | undefined;
  busy: boolean;
  readOnly: boolean;
  canEdit: boolean;
  onStatus: (status: DccStatus | null) => void;
  onValue: (value: number | null) => void;
  onNote: (note: string | null) => void;
  onEdit: () => void;
}

/**
 * One checklist line: identity on the left, the four status buttons on the
 * right, with an optional number field and a note drawer.
 *
 * Text inputs commit on BLUR, not on change. Every keystroke firing a server
 * action would be a write per character; blur gives one write per edit and
 * keeps the field feeling like a plain input while you type.
 */
export function DccFillRow({
  item,
  value,
  busy,
  readOnly,
  canEdit,
  onStatus,
  onValue,
  onNote,
  onEdit,
}: FillRowProps) {
  const [noteOpen, setNoteOpen] = React.useState(Boolean(value?.note));
  const [noteDraft, setNoteDraft] = React.useState(value?.note ?? "");
  const [numDraft, setNumDraft] = React.useState(value?.valueNumber ?? "");

  // Re-sync the drafts when the stored value changes underneath us (another
  // tab, or a rolled-back optimistic write).
  React.useEffect(() => setNoteDraft(value?.note ?? ""), [value?.note]);
  React.useEffect(() => setNumDraft(value?.valueNumber ?? ""), [value?.valueNumber]);

  const isDone = value?.status === "Done";
  const hasNumberField = item.targetNumber != null || Boolean(item.unit);

  return (
    <div
      className="relative flex items-center gap-3 rounded-[12px] border border-hairline px-3 py-2.5 transition max-md:flex-col max-md:items-stretch"
      style={{
        background: isDone ? "var(--color-green-bg)" : "var(--color-surface-card)",
        borderColor: isDone ? "var(--color-green)" : undefined,
      }}
    >
      {isDone && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
          style={{ background: "var(--color-green)" }}
        />
      )}

      {/* Identity */}
      <div className="min-w-0 flex-1 pl-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.code && (
            <span className="rounded-[6px] bg-surface-track px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink-muted tabular-nums">
              {item.code}
            </span>
          )}
          <span className="text-[14px] font-semibold leading-snug text-ink-strong">
            {item.title}
          </span>
          {item.needsReview && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: "var(--color-amber-bg)", color: "var(--color-amber-deep)" }}
              title="This KPI's frequency couldn't be read — it isn't counted in the daily checklist"
            >
              <AlertTriangle size={10} /> Check frequency
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-subtle">
          <span>{item.frequency?.trim() || maskLabel(item.weekdays)}</span>
          {item.targetNumber != null && (
            <span className="tabular-nums">
              · target {item.targetNumber}
              {item.unit ? ` ${item.unit}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex shrink-0 items-center gap-2 max-md:flex-wrap">
        <div className="inline-flex overflow-hidden rounded-[9px] border border-hairline">
          {DCC_STATUSES.map((s) => {
            const active = value?.status === s;
            const tone = dccStatusTone(s);
            return (
              <button
                key={s}
                type="button"
                disabled={readOnly || busy}
                aria-pressed={active}
                aria-label={`Mark ${item.title} as ${s}`}
                // Clicking the active status clears it — a mis-click should be
                // undoable without hunting for a "clear" affordance.
                onClick={() => onStatus(active ? null : s)}
                className="border-r border-hairline px-2.5 py-1.5 text-[12px] font-semibold transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: active ? tone.bg : "transparent",
                  color: active ? tone.fg : "var(--color-ink-subtle)",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>

        {hasNumberField && (
          <input
            type="number"
            inputMode="decimal"
            disabled={readOnly || busy}
            value={numDraft}
            onChange={(e) => setNumDraft(e.target.value)}
            onBlur={() => {
              const next = numDraft.trim() === "" ? null : Number(numDraft);
              const prev = value?.valueNumber == null ? null : Number(value.valueNumber);
              if (next === prev) return;
              if (next != null && !Number.isFinite(next)) return;
              onValue(next);
            }}
            aria-label={`Number for ${item.title}`}
            placeholder={item.unit ?? "0"}
            className="w-[74px] rounded-[9px] border border-hairline bg-surface-input px-2 py-1.5 text-[13px] tabular-nums text-ink-strong outline-none transition focus:border-altus-red disabled:opacity-50"
          />
        )}

        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          aria-label={`${noteOpen ? "Hide" : "Add"} note for ${item.title}`}
          aria-expanded={noteOpen}
          className="rounded-[9px] border border-hairline p-1.5 transition hover:bg-surface-track"
          style={{
            color: value?.note ? "var(--color-green-deep)" : "var(--color-ink-subtle)",
            borderColor: value?.note ? "var(--color-green)" : undefined,
          }}
        >
          <MessageSquare size={14} />
        </button>

        {busy ? (
          <Loader2 size={14} className="animate-spin text-ink-subtle" aria-label="Saving" />
        ) : (
          <span className="w-[14px]" aria-hidden />
        )}

        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${item.title}`}
            className="rounded-[9px] p-1.5 text-ink-subtle transition hover:bg-surface-track hover:text-ink-strong"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {noteOpen && (
        <div className="w-full basis-full max-md:order-last md:mt-2">
          <input
            value={noteDraft}
            disabled={readOnly || busy}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              const next = noteDraft.trim() || null;
              if (next === (value?.note ?? null)) return;
              onNote(next);
            }}
            placeholder="Note…"
            aria-label={`Note for ${item.title}`}
            className="w-full rounded-[9px] border border-hairline bg-surface-input px-2.5 py-1.5 text-[13px] text-ink-strong outline-none transition focus:border-altus-red disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}
