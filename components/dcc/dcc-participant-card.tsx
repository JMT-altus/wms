"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, Users, Plus, X, Pencil, Loader2 } from "lucide-react";
import { dccStatusTone, slotKey, type DccStatus } from "@/lib/dcc/util";
import {
  participantStats,
  type BoardItem,
  type BoardSubject,
  type SlotValue,
} from "@/lib/dcc/board-model";
import { addParticipant, removeParticipant, renameParticipant } from "@/app/(app)/dcc/actions";

export interface ParticipantCardProps {
  item: BoardItem;
  date: string;
  subjects: BoardSubject[];
  slots: Map<string, SlotValue>;
  busyKeys: Set<string>;
  readOnly: boolean;
  canManage: boolean;
  onSet: (subjectId: string, status: DccStatus | null) => void;
  onBulk: (status: DccStatus | null) => void;
  onRefresh: () => void;
}

/**
 * One participant-list KPI: a roster of external people, each with their own
 * Done / NA for the day.
 *
 * Collapsed by default — a 20-person mentee list would otherwise dominate the
 * board. These KPIs sit outside the daily compliance count entirely.
 */
export function DccParticipantCard({
  item,
  date,
  subjects,
  slots,
  busyKeys,
  readOnly,
  canManage,
  onSet,
  onBulk,
  onRefresh,
}: ParticipantCardProps) {
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const stats = participantStats(
    item.id,
    subjects.map((s) => s.id),
    slots,
    date,
  );

  async function add() {
    const name = adding.trim();
    if (!name) return;
    setPending(true);
    const res = await addParticipant({ itemId: item.id, name });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setAdding("");
    onRefresh();
  }

  async function rename(subjectId: string, current: string) {
    const next = window.prompt("Rename participant", current);
    if (next == null || !next.trim() || next.trim() === current) return;
    const res = await renameParticipant({ subjectId, name: next.trim() });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onRefresh();
  }

  async function remove(subjectId: string) {
    const res = await removeParticipant({ itemId: item.id, subjectId });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onRefresh();
  }

  return (
    <section className="overflow-hidden rounded-[16px] border border-hairline bg-surface-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-soft"
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px]"
          style={{ background: "var(--color-purple-bg)", color: "var(--color-purple-deep)" }}
        >
          <Users size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {item.code && (
              <span className="rounded-[6px] bg-surface-track px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink-muted">
                {item.code}
              </span>
            )}
            <span className="text-[14px] font-bold text-ink-strong">{item.title}</span>
          </span>
          <span className="mt-0.5 block text-[11.5px] text-ink-subtle tabular-nums">
            {stats.total} participants · {stats.done} done · {stats.addressed} addressed
            {item.frequency ? ` · ${item.frequency}` : ""}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 text-ink-subtle transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <div className="border-t border-hairline px-4 py-3">
          {!readOnly && subjects.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <BulkButton label="All Done" onClick={() => onBulk("Done")} tone="Done" />
              <BulkButton label="All NA" onClick={() => onBulk("NA")} tone="NA" />
              <BulkButton label="Clear" onClick={() => onBulk(null)} tone={null} />
            </div>
          )}

          <ul className="space-y-1.5">
            {subjects.map((s) => {
              const key = slotKey(item.id, s.id, date);
              const value = slots.get(key);
              const busy = busyKeys.has(key);
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-1.5"
                  style={{
                    background:
                      value?.status === "Done" ? "var(--color-green-bg)" : undefined,
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-strong">
                    {s.name}
                    {s.kind && (
                      <span className="ml-1.5 text-[11px] text-ink-subtle">{s.kind}</span>
                    )}
                  </span>
                  {busy && <Loader2 size={13} className="animate-spin text-ink-subtle" />}
                  <div className="inline-flex overflow-hidden rounded-[8px] border border-hairline">
                    {(["Done", "NA"] as const).map((st) => {
                      const active = value?.status === st;
                      const tone = dccStatusTone(st);
                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={readOnly || busy}
                          aria-pressed={active}
                          aria-label={`Mark ${s.name} as ${st}`}
                          onClick={() => onSet(s.id, active ? null : st)}
                          className="border-r border-hairline px-2.5 py-1 text-[12px] font-semibold transition last:border-r-0 disabled:opacity-50"
                          style={{
                            background: active ? tone.bg : "transparent",
                            color: active ? tone.fg : "var(--color-ink-subtle)",
                          }}
                        >
                          {st}
                        </button>
                      );
                    })}
                  </div>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => rename(s.id, s.name)}
                        aria-label={`Rename ${s.name}`}
                        className="rounded p-1 text-ink-subtle transition hover:text-ink-strong"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        aria-label={`Remove ${s.name}`}
                        className="rounded p-1 text-ink-subtle transition hover:text-red-deep"
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {subjects.length === 0 && (
            <p className="py-2 text-[13px] text-ink-subtle">No participants yet.</p>
          )}

          {!readOnly && (
            <div className="mt-3 flex gap-2">
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void add();
                  }
                }}
                placeholder="Add participant…"
                aria-label={`Add a participant to ${item.title}`}
                className="flex-1 rounded-[9px] border border-hairline bg-surface-input px-2.5 py-1.5 text-[13px] text-ink-strong outline-none transition focus:border-altus-red"
              />
              <button
                type="button"
                onClick={add}
                disabled={pending || !adding.trim()}
                className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[12px] font-bold text-white transition disabled:opacity-40"
                style={{ background: "var(--color-purple-deep)" }}
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BulkButton({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: DccStatus | null;
}) {
  const t = dccStatusTone(tone);
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[8px] border border-hairline px-2.5 py-1 text-[12px] font-bold transition hover:brightness-95"
      style={{ background: t.bg, color: t.fg }}
    >
      {label}
    </button>
  );
}
