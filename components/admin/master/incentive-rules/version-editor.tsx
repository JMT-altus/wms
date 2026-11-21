"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fireToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/dates";
import { MASTERS_GRADIENT, MASTERS_GRADIENT_BAR, MASTERS_INK } from "@/components/masters/theme";
import {
  CATEGORY_LABEL,
  SECTIONS,
  SOURCE_LABEL,
  sectionsFor,
  settingsFor,
  type CategoryCode,
  type DelayStep,
  type EligibilityRow,
  type IncentiveConfig,
  type SectionKey,
  type SettingDef,
  type SettingValue,
  type Slab,
  type Source,
} from "@/lib/incentives/rules-config/spec";
import { applies, checkConfig, diffConfigs, eligibilityText, settingText, slabText, stepText, type Difference } from "@/lib/incentives/rules-config/validate";
import {
  approveIncentiveVersion,
  createIncentiveDraft,
  discardIncentiveVersion,
  publishIncentiveVersion,
  rejectIncentiveVersion,
  returnIncentiveVersionToDraft,
  saveIncentiveDraft,
  submitIncentiveVersion,
  withdrawIncentiveVersion,
} from "@/app/(masters)/master-setup/incentive-rules/actions";
import { ACTION_LABEL, StatusBadge, type StatusName } from "./status";

/**
 * One Incentive Rules configuration version: its settings in eleven sections, its slabs, delay steps and eligibility,
 * the workflow (save, submit, withdraw, approve, reject, publish, return to draft, discard), a read-only preview of how
 * it reads and what differs from the version in force, and its complete history. Everything can be edited only while
 * the version is a draft (or rejected) and only by someone holding the edit right; the server and the database check
 * every step again. Nothing here calculates an incentive.
 */

const FIELD = "h-9 w-full rounded-lg border bg-white px-2.5 text-[13px] text-ink-strong disabled:bg-[#F6F8FB] disabled:text-ink-muted";
const OK = "border-hairline-strong";
const BAD = "border-[#DC2626] bg-[#FEF2F2]";
const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const SOURCE_TONE: Record<Source, [string, string]> = { pdf: ["#047857", "#ECFDF5"], screenshot: ["#0369A1", "#E0F2FE"], option: ["#B45309", "#FFFBEB"], decision: ["#6D28D9", "#F5F3FF"] };

export interface EditorVersion {
  id: string;
  programId: string;
  programCode: string;
  programName: string;
  categoryCode: string;
  versionNo: number;
  status: StatusName;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  rowVersion: number;
  changeNote: string | null;
  rejectionReason: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  publishedByName: string | null;
}
export interface EditorRights {
  edit: boolean;
  submit: boolean;
  approve: boolean;
  publish: boolean;
  backdate: boolean;
  history: boolean;
}
export interface EditorHistory {
  eventNo: number;
  action: string;
  actorName: string | null;
  at: string;
  note: string | null;
  before: unknown;
  after: unknown;
}
export interface EditorChoices {
  employees: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  roles: readonly string[];
}
export interface PublishedRange {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/* ── small inputs ──────────────────────────────────────────────────────── */

const rupeesText = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : (paise / 100).toString());
const parseRupees = (t: string): number | null | "bad" => {
  const s = t.replace(/[,₹\s]/g, "");
  if (!s) return null;
  return /^\d{1,13}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : "bad";
};
const percentText = (ppm: number | null | undefined) => (ppm === null || ppm === undefined ? "" : (ppm / 10_000).toString());
const parsePercentPpm = (t: string): number | null | "bad" => {
  const s = t.replace(/[%\s]/g, "");
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return "bad";
  const n = Math.round(Number(s) * 10_000);
  return n <= 1_000_000 ? n : "bad";
};
const intText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const parseInt_ = (t: string): number | null | "bad" => {
  const s = t.trim();
  if (!s) return null;
  return /^\d{1,7}$/.test(s) ? Number(s) : "bad";
};

/** A number typed as text: the text is kept as typed, the value changes only when it can be read. */
function NumberInput({ value, toText, parse, onChange, aria, disabled, suffix, placeholder }: { value: number | null | undefined; toText: (v: number | null | undefined) => string; parse: (t: string) => number | null | "bad"; onChange: (v: number | null) => void; aria: string; disabled: boolean; suffix?: string; placeholder?: string }) {
  const [text, setText] = React.useState(toText(value));
  // When the value changes from outside (not from this box's own typing), show it.
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    const p = parse(text);
    if (p === "bad" || p !== (value ?? null)) setText(toText(value));
  }
  const bad = parse(text) === "bad";
  return (
    <span className="relative block">
      <input
        aria-label={aria}
        aria-invalid={bad || undefined}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        className={`${FIELD} ${bad ? BAD : OK} ${suffix ? "pr-9" : ""} tabular-nums`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = parse(e.target.value);
          if (p !== "bad") onChange(p);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-subtle">{suffix}</span>}
    </span>
  );
}

function SettingInput({ def, value, onChange, disabled }: { def: SettingDef; value: SettingValue | undefined; onChange: (v: SettingValue | undefined) => void; disabled: boolean }) {
  const aria = def.label;
  switch (def.kind) {
    case "choice":
      return (
        <select aria-label={aria} disabled={disabled} className={`${FIELD} ${OK}`} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Not set</option>
          {def.choices!.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    case "multi": {
      const list = Array.isArray(value) ? value : undefined;
      return (
        <div role="group" aria-label={aria} className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {def.choices!.map((c) => (
            <label key={c.value} className="inline-flex items-center gap-1.5">
              <input type="checkbox" disabled={disabled} checked={!!list?.includes(c.value)} onChange={(e) => onChange(e.target.checked ? [...(list ?? []), c.value] : (list ?? []).filter((x) => x !== c.value))} />
              {c.label}
            </label>
          ))}
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" disabled={disabled} checked={!!list && list.length === 0} onChange={(e) => onChange(e.target.checked ? [] : undefined)} />
            None of these
          </label>
        </div>
      );
    }
    case "ordered": {
      const list = Array.isArray(value) ? value : [];
      const rest = def.choices!.filter((c) => !list.includes(c.value));
      const label = (v: string) => def.choices!.find((c) => c.value === v)?.label ?? v;
      return (
        <div role="group" aria-label={aria} className="grid gap-1">
          {list.map((v, i) => (
            <div key={v} className="flex items-center gap-1.5 text-[13px]">
              <span className="w-5 text-right tabular-nums text-ink-subtle">{i + 1}.</span>
              <span className="flex-1">{label(v)}</span>
              <button type="button" aria-label={`Move ${label(v)} up`} disabled={disabled || i === 0} onClick={() => onChange(list.map((x, j) => (j === i - 1 ? v : j === i ? list[i - 1]! : x)))} className="grid h-7 w-7 place-items-center rounded text-ink-subtle disabled:opacity-30"><ArrowUp size={13} /></button>
              <button type="button" aria-label={`Move ${label(v)} down`} disabled={disabled || i === list.length - 1} onClick={() => onChange(list.map((x, j) => (j === i + 1 ? v : j === i ? list[i + 1]! : x)))} className="grid h-7 w-7 place-items-center rounded text-ink-subtle disabled:opacity-30"><ArrowDown size={13} /></button>
              <button type="button" aria-label={`Remove ${label(v)}`} disabled={disabled} onClick={() => { const next = list.filter((x) => x !== v); onChange(next.length ? next : undefined); }} className="grid h-7 w-7 place-items-center rounded text-ink-subtle hover:text-[#B91C1C] disabled:opacity-30"><Trash2 size={13} /></button>
            </div>
          ))}
          {rest.length > 0 && (
            <select aria-label={`Add to ${aria}`} disabled={disabled} className={`${FIELD} ${OK}`} value="" onChange={(e) => e.target.value && onChange([...list, e.target.value])}>
              <option value="">{list.length ? "Add another…" : "Not set — choose the first…"}</option>
              {rest.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
    case "amount":
      return <NumberInput aria={aria} disabled={disabled} value={typeof value === "number" ? value : null} toText={rupeesText} parse={parseRupees} onChange={(v) => onChange(v ?? undefined)} suffix="₹" placeholder="Not set" />;
    case "integer":
      return <NumberInput aria={aria} disabled={disabled} value={typeof value === "number" ? value : null} toText={intText} parse={parseInt_} onChange={(v) => onChange(v ?? undefined)} placeholder="Not set" />;
    case "rate":
      return <NumberInput aria={aria} disabled={disabled} value={typeof value === "number" ? value : null} toText={percentText} parse={parsePercentPpm} onChange={(v) => onChange(v ?? undefined)} suffix="%" placeholder="Not set" />;
    case "cap":
      return <CapInput def={def} aria={aria} disabled={disabled} value={value} onChange={onChange} />;
  }
}

/**
 * A limit: "Not set", "No limit" (or "No minimum") or an amount. Choosing "An amount" never stores anything by itself —
 * in particular never ₹0, which would mean nothing is ever paid: the setting stays NOT SET (and the version can't be
 * submitted) until an amount is typed.
 */
function CapInput({ def, aria, disabled, value, onChange }: { def: SettingDef; aria: string; disabled: boolean; value: SettingValue | undefined; onChange: (v: SettingValue | undefined) => void }) {
  const [wantAmount, setWantAmount] = React.useState(false);
  const mode = typeof value === "number" || (value === undefined && wantAmount) ? "amount" : value === "none" ? "none" : "";
  return (
    <div className="grid grid-cols-[160px_1fr] max-sm:grid-cols-1 gap-2">
      <select aria-label={`${aria} — kind`} disabled={disabled} className={`${FIELD} ${OK}`} value={mode} onChange={(e) => {
        setWantAmount(e.target.value === "amount");
        onChange(e.target.value === "none" ? "none" : undefined);
      }}>
        <option value="">Not set</option>
        <option value="none">{def.noneLabel ?? "No limit"}</option>
        <option value="amount">An amount</option>
      </select>
      {mode === "amount" && (
        <div className="grid gap-1">
          <NumberInput aria={aria} disabled={disabled} value={typeof value === "number" ? value : null} toText={rupeesText} parse={parseRupees} onChange={(v) => onChange(v ?? undefined)} suffix="₹" placeholder="Enter the amount" />
          {typeof value !== "number" && <span className="text-[12px] text-ink-subtle">Not set until an amount is entered.</span>}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: Source }) {
  const [ink, bg] = SOURCE_TONE[source];
  return (
    <span className="rounded px-1 text-[10.5px] font-bold" style={{ color: ink, background: bg }}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

/* ── the lists ─────────────────────────────────────────────────────────── */

function SlabEditor({ slabs, onChange, disabled }: { slabs: Slab[]; onChange: (s: Slab[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<Slab>) => onChange(slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-[13px] font-bold text-ink-strong">Slabs</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ minWidth: 900 }}>
          <thead>
            <tr className="text-left text-ink-subtle">
              {["Line", "Label", "From (₹)", "To (₹)", "Incentive", "Rate / amount", "Most it pays (₹, optional)", ""].map((h) => (
                <th key={h} className="px-1.5 py-1 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slabs.map((s, i) => (
              <tr key={i} className="border-t border-hairline align-top">
                <td className="w-[80px] px-1.5 py-1"><input aria-label={`Slab ${i + 1} line code`} disabled={disabled} className={`${FIELD} ${OK}`} value={s.lineCode} maxLength={10} onChange={(e) => set(i, { lineCode: e.target.value })} /></td>
                <td className="px-1.5 py-1"><input aria-label={`Slab ${i + 1} label`} disabled={disabled} className={`${FIELD} ${OK}`} value={s.label} maxLength={120} onChange={(e) => set(i, { label: e.target.value })} /></td>
                <td className="w-[140px] px-1.5 py-1"><NumberInput aria={`Slab ${i + 1} from`} disabled={disabled} value={s.fromPaise} toText={rupeesText} parse={parseRupees} onChange={(v) => set(i, { fromPaise: v ?? 0 })} /></td>
                <td className="w-[140px] px-1.5 py-1"><NumberInput aria={`Slab ${i + 1} to`} disabled={disabled} value={s.toPaise} toText={rupeesText} parse={parseRupees} onChange={(v) => set(i, { toPaise: v ?? 0 })} /></td>
                <td className="w-[130px] px-1.5 py-1">
                  <select aria-label={`Slab ${i + 1} incentive type`} disabled={disabled} className={`${FIELD} ${OK}`} value={s.valueType} onChange={(e) => set(i, e.target.value === "fixed" ? { valueType: "fixed", ratePpm: null, fixedPaise: s.fixedPaise ?? 0 } : { valueType: "percent", fixedPaise: null, ratePpm: s.ratePpm ?? 0 })}>
                    <option value="percent">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </td>
                <td className="w-[130px] px-1.5 py-1">
                  {s.valueType === "percent" ? (
                    <NumberInput aria={`Slab ${i + 1} rate`} disabled={disabled} value={s.ratePpm} toText={percentText} parse={parsePercentPpm} onChange={(v) => set(i, { ratePpm: v ?? 0 })} suffix="%" />
                  ) : (
                    <NumberInput aria={`Slab ${i + 1} amount`} disabled={disabled} value={s.fixedPaise} toText={rupeesText} parse={parseRupees} onChange={(v) => set(i, { fixedPaise: v ?? 0 })} suffix="₹" />
                  )}
                </td>
                <td className="w-[150px] px-1.5 py-1"><NumberInput aria={`Slab ${i + 1} limit`} disabled={disabled} value={s.capPaise} toText={rupeesText} parse={parseRupees} onChange={(v) => set(i, { capPaise: v })} placeholder="No limit" /></td>
                <td className="px-1.5 py-1">
                  <button type="button" aria-label={`Remove slab ${i + 1}`} disabled={disabled} onClick={() => onChange(slabs.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded text-ink-subtle hover:text-[#B91C1C] disabled:opacity-30"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" disabled={disabled || slabs.length >= 20} onClick={() => { const last = slabs[slabs.length - 1]; onChange([...slabs, { lineCode: `A.${slabs.length + 1}`, label: "New slab", fromPaise: last?.toPaise ?? 0, toPaise: (last?.toPaise ?? 0) + 100, valueType: "percent", ratePpm: 0, fixedPaise: null, capPaise: null }]); }} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold disabled:opacity-40" style={{ color: MASTERS_INK }}>
        <Plus size={14} /> Add slab
      </button>
    </div>
  );
}

function StepEditor({ steps, onChange, disabled }: { steps: DelayStep[]; onChange: (s: DelayStep[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<DelayStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-[13px] font-bold text-ink-strong">Delay steps</h3>
      <p className="mb-1 text-[12px] text-ink-muted">Days of delay counted from the reference date chosen above. Each step starts where the one before ends; the last one covers every later day.</p>
      <table className="w-full max-w-[620px] text-[12.5px]">
        <thead>
          <tr className="text-left text-ink-subtle">
            {["From day", "To day", "Incentive kept", ""].map((h) => (
              <th key={h} className="px-1.5 py-1 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={i} className="border-t border-hairline">
              <td className="px-1.5 py-1"><NumberInput aria={`Step ${i + 1} from day`} disabled={disabled} value={s.fromDays} toText={intText} parse={parseInt_} onChange={(v) => set(i, { fromDays: v ?? 0 })} /></td>
              <td className="px-1.5 py-1"><NumberInput aria={`Step ${i + 1} to day`} disabled={disabled} value={s.toDays} toText={intText} parse={parseInt_} onChange={(v) => set(i, { toDays: v })} placeholder="No end" /></td>
              <td className="px-1.5 py-1"><NumberInput aria={`Step ${i + 1} incentive kept`} disabled={disabled} value={s.multiplierPpm} toText={percentText} parse={parsePercentPpm} onChange={(v) => set(i, { multiplierPpm: v ?? 0 })} suffix="%" /></td>
              <td className="px-1.5 py-1">
                <button type="button" aria-label={`Remove step ${i + 1}`} disabled={disabled} onClick={() => onChange(steps.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded text-ink-subtle hover:text-[#B91C1C] disabled:opacity-30"><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={disabled || steps.length >= 10} onClick={() => { const last = steps[steps.length - 1]; const from = last ? (last.toDays ?? last.fromDays + 30) : 0; onChange([...(last && last.toDays === null ? steps.map((s, j) => (j === steps.length - 1 ? { ...s, toDays: from } : s)) : steps), { fromDays: from, toDays: null, multiplierPpm: 0 }]); }} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold disabled:opacity-40" style={{ color: MASTERS_INK }}>
        <Plus size={14} /> Add step
      </button>
    </div>
  );
}

function EligibilityEditor({ rows, onChange, disabled, choices }: { rows: EligibilityRow[]; onChange: (r: EligibilityRow[]) => void; disabled: boolean; choices: EditorChoices }) {
  const set = (i: number, patch: Partial<EligibilityRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const options = (t: EligibilityRow["subjectType"]) => (t === "employee" ? choices.employees : t === "department" ? choices.departments : choices.roles.map((r) => ({ id: r, label: r })));
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-[13px] font-bold text-ink-strong">Who this version covers</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ minWidth: 820 }}>
          <thead>
            <tr className="text-left text-ink-subtle">
              {["Include / exclude", "By", "Who", "From", "To (optional)", ""].map((h) => (
                <th key={h} className="px-1.5 py-1 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const opts = options(r.subjectType);
              const current = r.subjectType === "role" ? r.role : r.subjectId;
              return (
                <tr key={i} className="border-t border-hairline">
                  <td className="w-[130px] px-1.5 py-1">
                    <select aria-label={`Row ${i + 1} include or exclude`} disabled={disabled} className={`${FIELD} ${OK}`} value={r.mode} onChange={(e) => set(i, { mode: e.target.value as EligibilityRow["mode"] })}>
                      <option value="include">Include</option>
                      <option value="exclude">Exclude</option>
                    </select>
                  </td>
                  <td className="w-[130px] px-1.5 py-1">
                    <select aria-label={`Row ${i + 1} by`} disabled={disabled} className={`${FIELD} ${OK}`} value={r.subjectType} onChange={(e) => set(i, { subjectType: e.target.value as EligibilityRow["subjectType"], subjectId: null, role: null, subjectLabel: "" })}>
                      <option value="employee">Employee</option>
                      <option value="department">Department</option>
                      <option value="role">Role</option>
                    </select>
                  </td>
                  <td className="px-1.5 py-1">
                    <select
                      aria-label={`Row ${i + 1} who`}
                      disabled={disabled}
                      className={`${FIELD} ${OK}`}
                      value={current ?? ""}
                      onChange={(e) => {
                        const o = opts.find((x) => x.id === e.target.value);
                        set(i, r.subjectType === "role" ? { role: o?.id ?? null, subjectId: null, subjectLabel: o?.label ?? "" } : { subjectId: o?.id ?? null, role: null, subjectLabel: o?.label ?? "" });
                      }}
                    >
                      <option value="">Choose…</option>
                      {/* A person or department no longer listed (it was chosen earlier) is still shown by its name. */}
                      {current && !opts.some((o) => o.id === current) && <option value={current}>{r.subjectLabel} (no longer listed)</option>}
                      {opts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="w-[150px] px-1.5 py-1"><input type="date" aria-label={`Row ${i + 1} from`} disabled={disabled} className={`${FIELD} ${OK}`} value={r.effectiveFrom} onChange={(e) => set(i, { effectiveFrom: e.target.value })} /></td>
                  <td className="w-[150px] px-1.5 py-1"><input type="date" aria-label={`Row ${i + 1} to`} disabled={disabled} className={`${FIELD} ${OK}`} value={r.effectiveTo ?? ""} onChange={(e) => set(i, { effectiveTo: e.target.value || null })} /></td>
                  <td className="px-1.5 py-1">
                    <button type="button" aria-label={`Remove row ${i + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded text-ink-subtle hover:text-[#B91C1C] disabled:opacity-30"><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" disabled={disabled || rows.length >= 500} onClick={() => onChange([...rows, { subjectType: "employee", subjectId: null, role: null, subjectLabel: "", mode: "include", effectiveFrom: new Date().toISOString().slice(0, 8) + "01", effectiveTo: null }])} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold disabled:opacity-40" style={{ color: MASTERS_INK }}>
        <Plus size={14} /> Add row
      </button>
    </div>
  );
}

/* ── the preview and history ───────────────────────────────────────────── */

function DiffTable({ diffs, empty }: { diffs: Difference[]; empty: string }) {
  if (!diffs.length) return <p className="text-[12.5px] text-ink-subtle">{empty}</p>;
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-ink-subtle">
          {["Section", "Setting", "Before", "After"].map((h) => (
            <th key={h} className="px-2 py-1 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {diffs.map((d, i) => (
          <tr key={i} className="border-t border-hairline align-top">
            <td className="px-2 py-1 text-ink-muted">{SECTIONS.find((s) => s.key === d.section)?.label}</td>
            <td className="px-2 py-1 font-semibold text-ink-strong">{d.label}</td>
            <td className="whitespace-pre-line px-2 py-1 text-[#B91C1C]">{d.before}</td>
            <td className="whitespace-pre-line px-2 py-1 text-[#047857]">{d.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export { DiffTable };

function Preview({ config, inForce, published, currentMonth, isDraft, category }: { config: IncentiveConfig; inForce: { versionNo: number; config: IncentiveConfig } | null; published: PublishedRange[]; currentMonth: string; isDraft: boolean; category: CategoryCode }) {
  const [month, setMonth] = React.useState(currentMonth.slice(0, 7));
  const day = `${month}-01`;
  const applying = published.find((p) => p.effectiveFrom <= day && (!p.effectiveTo || p.effectiveTo >= day));
  return (
    <div className="grid gap-4">
      <p className="rounded-lg px-3 py-2 text-[12.5px] text-ink-muted" style={{ background: "#F6F8FB" }}>
        A preview reads the configuration and shows which version applies to a month. It calculates nothing and writes nothing.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <label className="inline-flex items-center gap-2 font-semibold text-ink-muted">
          Month
          <input type="month" aria-label="Preview month" className={`${FIELD} ${OK} w-[170px]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <span role="status" className="text-ink-strong">{applying ? `Version ${applying.versionNo} applies to ${month} (${applying.effectiveFrom} → ${applying.effectiveTo ?? "open"}).` : `No published version applies to ${month}.`}</span>
      </div>
      {sectionsFor(category).map((s) => {
        const defs = settingsFor(category).filter((d) => d.section === s.key && applies(d, config.settings));
        return (
          <section key={s.key} aria-label={`Preview ${s.label}`}>
            <h3 className="mb-1 text-[13px] font-bold text-ink-strong">{s.label}</h3>
            <dl className="grid grid-cols-[minmax(0,320px)_1fr] max-sm:grid-cols-1 gap-x-4 gap-y-0.5 text-[12.5px]">
              {defs.map((d) => (
                <React.Fragment key={d.key}>
                  <dt className="text-ink-muted">{d.label}</dt>
                  <dd className={config.settings[d.key] === undefined ? "font-semibold text-[#B45309]" : "text-ink-strong"}>{settingText(d, config.settings[d.key])}</dd>
                </React.Fragment>
              ))}
            </dl>
            {s.key === "slabs" && <ul className="mt-1 list-disc pl-5 text-[12.5px]">{config.slabs.length ? config.slabs.map((x, i) => <li key={i}>{slabText(x)}</li>) : <li>No slab</li>}</ul>}
            {s.key === "delay" && <ul className="mt-1 list-disc pl-5 text-[12.5px]">{config.delaySteps.length ? config.delaySteps.map((x, i) => <li key={i}>{stepText(x)}</li>) : <li>No step</li>}</ul>}
            {s.key === "people" && <ul className="mt-1 list-disc pl-5 text-[12.5px]">{config.eligibility.length ? config.eligibility.map((x, i) => <li key={i}>{eligibilityText(x)}</li>) : <li>Nobody</li>}</ul>}
          </section>
        );
      })}
      <section aria-label="Differences from the version in force">
        <h3 className="mb-1 text-[13px] font-bold text-ink-strong">{inForce ? `What ${isDraft ? "would change" : "differs"} from version ${inForce.versionNo} (in force this month)` : "Differences from the version in force"}</h3>
        {inForce ? <DiffTable diffs={diffConfigs(inForce.config, config, category)} empty="Nothing differs." /> : <p className="text-[12.5px] text-ink-subtle">No version is in force this month.</p>}
      </section>
    </div>
  );
}

function HistoryList({ history, category }: { history: EditorHistory[]; category: CategoryCode }) {
  if (!history.length) return <p className="text-[12.5px] text-ink-subtle">No change yet.</p>;
  return (
    <ol className="grid gap-2">
      {history.map((h) => {
        const b = h.before as { config?: IncentiveConfig; status?: string; effectiveFrom?: string | null; effectiveTo?: string | null } | null;
        const a = h.after as { config?: IncentiveConfig; status?: string; effectiveFrom?: string | null; effectiveTo?: string | null } | null;
        const diffs = b?.config && a?.config ? diffConfigs(b.config, a.config, category) : null;
        return (
          <li key={h.eventNo} className="rounded-lg p-2.5 text-[12.5px]" style={{ border: "1px solid var(--color-hairline)" }}>
            <div className="flex flex-wrap gap-x-2">
              <span className="font-mono text-ink-subtle">#{h.eventNo}</span>
              <span className="font-bold text-ink-strong">{ACTION_LABEL[h.action] ?? h.action}</span>
              <span className="text-ink-muted">· {h.actorName ?? "—"} · {fmtDateTime(h.at)}</span>
            </div>
            {h.note && <p className="mt-0.5 text-ink-muted">“{h.note}”</p>}
            {b?.status !== undefined && a?.status !== undefined && (b.status !== a.status || b.effectiveTo !== a.effectiveTo || b.effectiveFrom !== a.effectiveFrom) && (
              <p className="mt-0.5 text-ink-muted">
                Status {b.status} → {a.status}
                {a.effectiveFrom ? ` · effective ${a.effectiveFrom} → ${a.effectiveTo ?? "open"}` : ""}
              </p>
            )}
            {diffs && (
              <details className="mt-1">
                <summary className="cursor-pointer font-semibold" style={{ color: MASTERS_INK }}>{diffs.length} setting{diffs.length === 1 ? "" : "s"} changed</summary>
                <div className="mt-1 overflow-x-auto">
                  <DiffTable diffs={diffs} empty="No setting changed." />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── the editor ────────────────────────────────────────────────────────── */

type Tab = SectionKey | "preview" | "history";

export function IncentiveVersionEditor({ version, config: initial, inForce, published, history, choices, rights, meIsWriter, currentMonth }: {
  version: EditorVersion;
  config: IncentiveConfig;
  inForce: { versionNo: number; config: IncentiveConfig } | null;
  published: PublishedRange[];
  history: EditorHistory[] | null;
  choices: EditorChoices;
  rights: EditorRights;
  meIsWriter: boolean;
  currentMonth: string;
}) {
  const router = useRouter();
  // Every list below is this version's category's: its sections and settings (Category B has no slabs).
  const category = version.categoryCode as CategoryCode;
  const sections = sectionsFor(category);
  const defs = settingsFor(category);
  const [config, setConfig] = React.useState<IncentiveConfig>(initial);
  const [changeNote, setChangeNote] = React.useState(version.changeNote ?? "");
  const [dirty, setDirty] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>(sections[0]!.key);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | { kind: "approve" | "reject"; note: string } | { kind: "publish"; month: string }>(null);
  const editable = (version.status === "draft" || version.status === "rejected") && rights.edit;
  const { problems, missing } = React.useMemo(() => checkConfig(config, { roles: choices.roles, category }), [config, choices.roles, category]);

  const update = (next: IncentiveConfig) => {
    setConfig(next);
    setDirty(true);
  };
  const setSetting = (key: string, v: SettingValue | undefined) => {
    const settings = { ...config.settings };
    if (v === undefined) delete settings[key];
    else settings[key] = v;
    update({ ...config, settings });
  };

  async function act(call: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, done: string, after?: (r: Record<string, unknown>) => void) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await call();
      if (!r.ok) return setProblem(r.error ?? "That couldn't be done.");
      fireToast({ message: done, type: "success" });
      setDirty(false);
      setDialog(null);
      after?.(r);
      router.refresh();
    } catch {
      setProblem("That couldn't be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }
  const ids = { versionId: version.id, expectedRowVersion: version.rowVersion };
  const sectionMissing = (k: SectionKey) => missing.filter((m) => m.section === k).length + problems.filter((p) => p.section === k).length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Link href={"/master-setup/incentive-rules" as Route} className="inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: MASTERS_INK }}>
        <ArrowLeft size={14} /> All programmes
      </Link>

      <section aria-label="Version" className="rounded-section bg-white p-4" style={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-ink-strong" style={{ fontSize: 16 }}>
            {version.programName} · Category {version.categoryCode} ({CATEGORY_LABEL[version.categoryCode as CategoryCode]}) · version {version.versionNo}
          </h2>
          <StatusBadge status={version.status} />
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Written by {version.createdByName ?? "—"}
          {version.approvedByName ? ` · approved by ${version.approvedByName}` : ""}
          {version.publishedByName ? ` · published by ${version.publishedByName}` : ""}
          {version.effectiveFrom ? ` · effective ${version.effectiveFrom} → ${version.effectiveTo ?? "open"}` : ""}
        </p>
        {version.status === "rejected" && version.rejectionReason && (
          <p role="note" className="mt-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "#FEF2F2", color: "#991B1B" }}>
            <strong>Rejected:</strong> {version.rejectionReason} Edit and save it to make it a draft again, then submit it.
          </p>
        )}
        {(version.status === "published" || version.status === "discarded") && (
          <p className="mt-2 text-[12.5px] text-ink-muted">A {version.status} version never changes. To change these rules, create a new draft from it.</p>
        )}

        {/* The workflow: only what this version's status and the signed-in person's rights allow. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <input aria-label="Change note" placeholder="What changed and why (optional)" maxLength={1000} className={`${FIELD} ${OK} max-w-[360px]`} value={changeNote} onChange={(e) => { setChangeNote(e.target.value); setDirty(true); }} />
              <button type="button" disabled={busy || !dirty || problems.length > 0} onClick={() => void act(() => saveIncentiveDraft({ ...ids, config, changeNote: changeNote.trim() || null }), "Draft saved.")} className="h-9 rounded-lg px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
                Save draft
              </button>
            </>
          )}
          {(version.status === "draft" || version.status === "rejected") && rights.submit && (
            <button type="button" disabled={busy || dirty || problems.length > 0 || missing.length > 0} title={dirty ? "Save your changes first." : missing.length ? "Every required setting must be set first." : undefined} onClick={() => void act(() => submitIncentiveVersion(ids), "Submitted for Rules Approval.")} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13px] font-bold text-ink-strong disabled:opacity-50">
              Submit for Rules Approval
            </button>
          )}
          {(version.status === "draft" || version.status === "rejected") && rights.edit && (
            <button type="button" disabled={busy} onClick={() => void act(() => discardIncentiveVersion(ids), "Draft discarded.")} className="h-9 rounded-lg px-3 text-[13px] font-bold text-ink-muted disabled:opacity-50">
              Discard draft
            </button>
          )}
          {version.status === "submitted" && rights.submit && (
            <button type="button" disabled={busy} onClick={() => void act(() => withdrawIncentiveVersion(ids), "Submission withdrawn.")} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13px] font-bold text-ink-strong disabled:opacity-50">
              Withdraw submission
            </button>
          )}
          {version.status === "submitted" && rights.approve && (
            <>
              <button type="button" disabled={busy || meIsWriter} title={meIsWriter ? "You created, edited or submitted this version; another authorised person must decide on it." : undefined} onClick={() => (setProblem(null), setDialog({ kind: "approve", note: "" }))} className="h-9 rounded-lg px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: "#047857" }}>
                Approve rules
              </button>
              <button type="button" disabled={busy || meIsWriter} onClick={() => (setProblem(null), setDialog({ kind: "reject", note: "" }))} className="h-9 rounded-lg border border-[#FECACA] bg-white px-4 text-[13px] font-bold text-[#B91C1C] disabled:opacity-50">
                Reject rules
              </button>
              {meIsWriter && <span className="text-[12px] text-ink-muted">You wrote or submitted this version, so someone else must approve it.</span>}
            </>
          )}
          {version.status === "approved" && rights.publish && (
            <button type="button" disabled={busy} onClick={() => (setProblem(null), setDialog({ kind: "publish", month: currentMonth.slice(0, 7) }))} className="h-9 rounded-lg px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
              Publish…
            </button>
          )}
          {version.status === "approved" && rights.edit && (
            <button type="button" disabled={busy} onClick={() => void act(() => returnIncentiveVersionToDraft(ids), "Returned to draft; it must be approved again.")} className="h-9 rounded-lg px-3 text-[13px] font-bold text-ink-muted disabled:opacity-50">
              Return to draft
            </button>
          )}
          {version.status !== "draft" && version.status !== "rejected" && rights.edit && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => createIncentiveDraft({ programId: version.programId, category: version.categoryCode, startFrom: { versionId: version.id } }),
                  "New draft created from this version.",
                  (r) => router.push(`/master-setup/incentive-rules/${String(r.versionId)}` as Route),
                )
              }
              className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13px] font-bold text-ink-strong disabled:opacity-50"
            >
              New draft from this version
            </button>
          )}
          {problem && <p role="alert" className="w-full text-[12.5px] font-semibold text-[#B91C1C]">{problem}</p>}
        </div>
        {(missing.length > 0 || problems.length > 0) && (version.status === "draft" || version.status === "rejected") && (
          <div role="region" aria-label="Not yet configured" className="mt-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
            {problems.length > 0 && (
              <>
                <p className="font-bold text-[#B91C1C]">{problems.length} problem{problems.length === 1 ? "" : "s"} to fix before it can be saved:</p>
                <ul className="mb-1 list-disc pl-5 text-[#991B1B]">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
              </>
            )}
            {missing.length > 0 && (
              // Folded: the section tabs carry the same counts; open it for the full list.
              <details>
                <summary className="cursor-pointer font-bold text-[#92400E]">Not yet configured — {missing.length} required setting{missing.length === 1 ? "" : "s"} must be chosen before it can be submitted (the section tabs show where)</summary>
                <ul className="mt-1 list-disc pl-5 text-[#92400E]">{missing.map((m, i) => <li key={i}>{m.message}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </section>

      <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-1.5">
        {[...sections.map((s) => ({ key: s.key as Tab, label: s.label, count: sectionMissing(s.key) })), { key: "preview" as Tab, label: "Preview", count: 0 }, ...(history && rights.history ? [{ key: "history" as Tab, label: "History", count: 0 }] : [])].map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className="rounded-pill px-3 py-1 text-[12.5px] font-bold" style={tab === t.key ? { background: MASTERS_INK, color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}>
            {t.label}
            {t.count > 0 && <span className="ml-1 rounded-full px-1.5 text-[10.5px]" style={{ background: tab === t.key ? "rgba(255,255,255,.25)" : "#FDE68A", color: tab === t.key ? "#fff" : "#92400E" }}>{t.count}</span>}
          </button>
        ))}
      </div>

      <section role="tabpanel" aria-label={tab === "preview" ? "Preview" : tab === "history" ? "History" : SECTIONS.find((s) => s.key === tab)!.label} className="rounded-section bg-white p-4" style={CARD}>
        {tab === "preview" ? (
          <Preview config={config} inForce={inForce} published={published} currentMonth={currentMonth} isDraft={editable} category={category} />
        ) : tab === "history" && rights.history ? (
          <HistoryList history={history ?? []} category={category} />
        ) : (
          <>
            <div className="grid gap-3">
              {defs.filter((d) => d.section === tab).map((d) => {
                const shown = applies(d, config.settings);
                if (!shown && config.settings[d.key] === undefined) return null;
                const unset = d.required && shown && config.settings[d.key] === undefined;
                return (
                  <div key={d.key} className="grid grid-cols-[minmax(0,340px)_1fr] max-md:grid-cols-1 gap-x-4 gap-y-1 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
                    <div>
                      <p className="text-[13px] font-semibold text-ink-strong">
                        {d.label}
                        {d.required && shown && <span className="ml-0.5 text-[#B91C1C]">*</span>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-ink-muted">
                        <SourceBadge source={d.source} />
                        {unset && <span className="rounded px-1 text-[10.5px] font-bold text-[#92400E]" style={{ background: "#FEF3C7" }}>Not set</span>}
                        {!shown && <span className="rounded px-1 text-[10.5px] font-bold text-ink-subtle" style={{ background: "#F1F5F9" }}>Not used with the current choices</span>}
                      </p>
                      <p className="mt-1 text-[12px] text-ink-muted">{d.help}</p>
                    </div>
                    <div>{editable ? <SettingInput def={d} value={config.settings[d.key]} disabled={!editable} onChange={(v) => setSetting(d.key, v)} /> : <p className="pt-1.5 text-[13px] text-ink-strong">{settingText(d, config.settings[d.key])}</p>}</div>
                  </div>
                );
              })}
            </div>
            {tab === "slabs" && <SlabEditor slabs={config.slabs} disabled={!editable} onChange={(slabs) => update({ ...config, slabs })} />}
            {tab === "delay" && <StepEditor steps={config.delaySteps} disabled={!editable} onChange={(delaySteps) => update({ ...config, delaySteps })} />}
            {tab === "people" && <EligibilityEditor rows={config.eligibility} disabled={!editable} choices={choices} onChange={(eligibility) => update({ ...config, eligibility })} />}
          </>
        )}
      </section>

      <CenterDialog
        open={dialog !== null}
        title={dialog?.kind === "approve" ? "Rules Approval: approve this version" : dialog?.kind === "reject" ? "Rules Approval: reject this version" : "Publish these rules"}
        subtitle={dialog?.kind === "publish" ? "They apply to calculations from the first day of the month you choose. The version in force before it ends the day before." : dialog?.kind === "reject" ? "The author sees the reason and can edit and resubmit it." : "This approves the rules only. Once approved, they can be published by someone holding the publish right."}
        accentBar={MASTERS_GRADIENT_BAR}
        width={520}
        onClose={() => setDialog(null)}
        footer={
          <div className="flex items-center justify-end gap-2">
            {problem && <p role="alert" className="mr-auto text-[12.5px] font-semibold text-[#B91C1C]">{problem}</p>}
            <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold">Cancel</button>
            {dialog?.kind === "approve" && (
              <button type="button" disabled={busy} onClick={() => void act(() => approveIncentiveVersion({ ...ids, note: dialog.note.trim() || null }), "Rules approved.")} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: "#047857" }}>
                Approve rules
              </button>
            )}
            {dialog?.kind === "reject" && (
              <button type="button" disabled={busy || !dialog.note.trim()} onClick={() => void act(() => rejectIncentiveVersion({ ...ids, note: dialog.note.trim() }), "Rules rejected.")} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: "#B91C1C" }}>
                Reject rules
              </button>
            )}
            {dialog?.kind === "publish" && (
              <button type="button" disabled={busy || !/^\d{4}-\d{2}$/.test(dialog.month) || (`${dialog.month}-01` < currentMonth && !rights.backdate)} onClick={() => void act(() => publishIncentiveVersion({ ...ids, effectiveFrom: `${dialog.month}-01` }), "Published.")} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
                Publish
              </button>
            )}
          </div>
        }
      >
        {dialog && (dialog.kind === "approve" || dialog.kind === "reject") && (
          <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
            {dialog.kind === "reject" ? "Reason (required)" : "Note (optional)"}
            <textarea aria-label={dialog.kind === "reject" ? "Reason for rejecting" : "Approval note"} rows={3} maxLength={1000} className={`${FIELD} ${OK} h-auto py-2`} value={dialog.note} onChange={(e) => setDialog({ ...dialog, note: e.target.value })} />
          </label>
        )}
        {dialog?.kind === "publish" && (
          <div className="grid gap-2">
            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
              Effective from the month
              <input type="month" aria-label="Effective from month" className={`${FIELD} ${OK}`} value={dialog.month} onChange={(e) => setDialog({ ...dialog, month: e.target.value })} />
            </label>
            {`${dialog.month}-01` < currentMonth && (
              <p className="text-[12.5px] text-ink-muted">{rights.backdate ? "This is an earlier month: it is recorded as back-dated." : "Publishing from an earlier month needs the “Publish from an earlier month” permission."}</p>
            )}
            <p role="note" className="rounded-lg px-3 py-2 text-[12.5px] text-ink-strong" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
              Publishing makes these rules apply to calculations from that month. It does not approve, release or pay any employee&apos;s incentive: each month&apos;s calculated incentives still go through Incentive Approval in Incentive Tracker → Incentive Management.
            </p>
          </div>
        )}
      </CenterDialog>
    </div>
  );
}
