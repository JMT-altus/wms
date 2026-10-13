"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import type { PolicyDef, PolicyValue } from "@/lib/attendance/policy";
import { saveAttendancePolicy } from "@/app/(admin)/admin/attendance-policy/actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FIELD = "rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px]";

export function describeValue(def: PolicyDef, v: PolicyValue): string {
  if (v === null) return "None";
  if (def.kind === "weekdays") return (v as number[]).map((d) => DAYS[d]).join(", ") || "None";
  if (def.kind === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** One setting: its current value, whether it is confirmed, and a change form. */
export function PolicyRow({
  def,
  current,
  today,
}: {
  def: PolicyDef;
  current: PolicyValue;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PolicyValue>(current);
  const [effective, setEffective] = useState(`${today.slice(0, 7)}-01`);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveAttendancePolicy({ key: def.key, value, effectiveFrom: effective, reason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      fireToast({ message: `${def.label} updated from ${effective}.`, type: "success" });
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <li className="py-4 border-b border-hairline last:border-b-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-2xl">
          <p className="text-[15px] font-semibold text-ink-strong">
            {def.label}
            {def.status === "pending" && (
              <span className="ml-2 rounded-pill px-2 py-0.5 text-[11px] font-bold bg-[#FFFBEB] text-[#B45309]">
                Awaiting confirmation
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-subtle">{def.help}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold tabular-nums text-ink-strong">{describeValue(def, current)}</span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="text-[13px] font-semibold underline underline-offset-2 text-ink-strong"
          >
            {open ? "Close" : "Change"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 grid gap-3 max-w-xl rounded-lg bg-surface-soft p-4">
          <label className="block text-[13px] font-medium text-ink-soft">
            New value
            <div className="mt-1">
              <ValueInput def={def} value={value} onChange={setValue} />
            </div>
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Effective from
            <input
              type="date"
              value={effective}
              min={`${today.slice(0, 7)}-01`}
              onChange={(e) => setEffective(e.target.value)}
              className={`${FIELD} mt-1 block`}
            />
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={`${FIELD} mt-1 block w-full`} />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-[#B91C1C]">
              {error}
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={save}
              className="rounded-md px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #0A6CFF, #0751BE)" }}
            >
              {pending ? "Saving…" : "Save change"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function ValueInput({
  def,
  value,
  onChange,
}: {
  def: PolicyDef;
  value: PolicyValue;
  onChange: (v: PolicyValue) => void;
}) {
  if (def.kind === "boolean") {
    return (
      <select value={value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "yes")} className={FIELD}>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (def.kind === "enum") {
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (def.kind === "weekdays") {
    const set = new Set(value as number[]);
    return (
      <div className="flex gap-1.5 flex-wrap">
        {DAYS.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-pressed={set.has(i)}
            onClick={() => {
              const next = new Set(set);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              onChange([...next].sort((a, b) => a - b));
            }}
            className="rounded-md px-3 py-1.5 text-[13px] font-semibold"
            style={
              set.has(i)
                ? { background: "var(--color-ink-strong)", color: "#fff" }
                : { background: "var(--color-surface-card)", border: "1px solid var(--color-hairline)" }
            }
          >
            {d}
          </button>
        ))}
      </div>
    );
  }
  return (
    <input
      type="number"
      step="any"
      value={value === null ? "" : String(value)}
      placeholder={def.nullable ? "None" : undefined}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={`${FIELD} w-40`}
    />
  );
}
