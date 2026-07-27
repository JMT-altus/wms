"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown, Eye, EyeOff, Check, Loader2 } from "lucide-react";
import type { StatusMeta } from "@/lib/queries/status-display";
import { ColorPicker, colorToCss } from "./color-picker";
import { updateStatusSettingAction, setStatusActiveAction, reorderStatusesAction } from "@/app/(admin)/admin/settings/actions";

export function StatusManager({ initial }: { initial: StatusMeta[] }) {
  const [rows, setRows] = useState(initial);
  const [, startReorder] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[index], next[j]] = [next[j]!, next[index]!];
    setRows(next);
    startReorder(async () => { await reorderStatusesAction({ order: next.map((r) => r.status) }); });
  }

  function toggle(status: string, active: boolean) {
    setRows((rs) => rs.map((r) => (r.status === status ? { ...r, active } : r)));
    startReorder(async () => { await setStatusActiveAction({ status: status as StatusMeta["status"], active }); });
  }

  return (
    <div className="rounded-xl border border-[rgba(15,23,42,0.08)] bg-white overflow-hidden">
      {rows.map((r, i) => (
        <Row key={r.status} row={r} first={i === 0} last={i === rows.length - 1} isLast={i === rows.length - 1}
          onUp={() => move(i, -1)} onDown={() => move(i, 1)} onToggle={(a) => toggle(r.status, a)} />
      ))}
    </div>
  );
}

function Row({ row, first, last, isLast, onUp, onDown, onToggle }: {
  row: StatusMeta; first: boolean; last: boolean; isLast: boolean;
  onUp: () => void; onDown: () => void; onToggle: (active: boolean) => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [color, setColor] = useState(row.colorToken);
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = label !== row.label || color !== row.colorToken;

  function save() {
    setError(null); setSaved(false);
    startSave(async () => {
      const res = await updateStatusSettingAction({ status: row.status, label, color });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); } else setError(res.error);
    });
  }

  return (
    <div className={`grid grid-cols-[auto_1fr_1.4fr_auto_auto_auto] items-center gap-3 px-4 py-3 ${isLast ? "" : "border-b border-[rgba(15,23,42,0.06)]"}`} style={{ opacity: row.active ? 1 : 0.55 }}>
      {/* reorder */}
      <div className="flex flex-col -my-1">
        <button type="button" onClick={onUp} disabled={first} aria-label="Move up" className="text-ink-subtle hover:text-ink-strong disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
        <button type="button" onClick={onDown} disabled={last} aria-label="Move down" className="text-ink-subtle hover:text-ink-strong disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
      </div>

      {/* live pill preview */}
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold justify-self-start" style={{ background: `${colorToCss(color)}1a`, color: colorToCss(color) }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorToCss(color) }} />
        {label}{!row.active && <span className="text-ink-subtle font-normal">· hidden</span>}
      </span>

      {/* rename */}
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} className="rounded-md border border-[rgba(15,23,42,0.10)] bg-white px-3 py-1.5 text-sm" />

      {/* colour palette */}
      <ColorPicker value={color} onChange={setColor} />

      {/* save */}
      <button type="button" onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(15,23,42,0.10)] bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-40">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save"}
      </button>

      {/* hide / show */}
      <button type="button" onClick={() => onToggle(!row.active)} aria-label={row.active ? "Hide status" : "Show status"} title={row.active ? "Hide from pickers" : "Show in pickers"} className="rounded-md border border-[rgba(15,23,42,0.10)] bg-white p-1.5 text-ink-subtle hover:text-ink-strong">
        {row.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>

      {error && <p className="col-span-6 text-xs text-red-600">{error}</p>}
    </div>
  );
}
