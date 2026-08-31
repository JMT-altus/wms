"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import { DictateButton } from "@/components/ui/dictate-button";

/**
 * Shared controls for the Create New Client KYC form.
 *
 * The signature here is the notched label: the caption sits ON the input's top
 * border rather than above it, which is what lets six fields share a row and
 * still be readable. Everything is driven by the app's own tokens — indigo for
 * primary/selected state (--color-indigo, already in globals.css), hairline
 * borders, ink-* for text — so no new colour enters the system.
 */

import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./tokens";

// Re-exported so existing importers of ./kyc/fields keep working unchanged.
export { KYC_ACCENT, KYC_ACCENT_SOFT };

const CONTROL =
  "w-full rounded-lg h-11 px-3 bg-surface-card border outline-none text-[14px] text-ink-strong " +
  "focus:border-[color:var(--color-indigo)] transition-colors";

/* ── Section shell ───────────────────────────────────────────────────────── */

/** One of the seven white cards the form scrolls through. */
export function SectionCard({
  title,
  subtitle,
  optional,
  children,
}: {
  title: string;
  subtitle: string;
  /**
   * Marks a section nothing in `kyc-completeness.ts` asks for, so it can be
   * skipped without holding the record in Draft. Worth stating outright: the
   * red asterisks elsewhere tell you what a section demands, and a section
   * with no asterisks at all reads as ambiguous rather than as free.
   */
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-section bg-surface-card px-6 py-5 max-md:px-4"
      style={{
        border: "1px solid var(--color-hairline)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h2
          className="uppercase font-bold tracking-[0.09em] text-ink-strong shrink-0"
          style={{ fontSize: 12 }}
        >
          {title}
        </h2>
        {optional && (
          <span
            className="shrink-0 rounded-pill px-2 py-0.5 font-semibold"
            style={{
              fontSize: 10.5,
              color: "var(--color-ink-soft)",
              background: "var(--color-surface-soft)",
              border: "1px solid var(--color-hairline)",
            }}
          >
            Optional
          </span>
        )}
        <p className="text-ink-subtle" style={{ fontSize: 13 }}>
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  );
}

/** The numbered "1 Purchase Contact" / "2 Delivery Address" divider inside a card. */
export function BlockHeader({
  n,
  label,
  action,
}: {
  n: number;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span
        className="shrink-0 grid place-items-center rounded-full text-white font-bold"
        style={{ width: 22, height: 22, fontSize: 11, background: KYC_ACCENT }}
      >
        {n}
      </span>
      <span className="shrink-0 font-bold text-ink-strong" style={{ fontSize: 14 }}>
        {label}
      </span>
      <span className="flex-1 h-px" style={{ background: "var(--color-hairline)" }} />
      {action}
    </div>
  );
}

/* ── Notched-label field shell ───────────────────────────────────────────── */

/**
 * Wraps one control with its floating caption and, optionally, the small
 * "+ Add" chip that sits on the top-right border for master-backed pickers.
 */
export function KycField({
  label,
  required,
  onAdd,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  /** Renders the inline "+ Add" chip and calls this with the typed value. */
  onAdd?: (value: string) => void;
  error?: string | null;
  /**
   * Quiet note under the control, for a value the form filled in itself.
   * An auto-filled box that says nothing looks like data the user typed and
   * forgot — this says where it came from. `error` wins when both are set.
   */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0">
      <span
        className="absolute -top-[7px] left-2.5 z-10 px-1 bg-surface-card text-ink-subtle whitespace-nowrap"
        style={{ fontSize: 11 }}
      >
        {label}
        {required && <span style={{ color: "var(--color-red)" }}> *</span>}
      </span>
      {onAdd && <AddChip onAdd={onAdd} label={label} />}
      {children}
      {error ? (
        <span className="block mt-1 pl-1" style={{ fontSize: 11.5, color: "var(--color-red-deep)" }}>
          {error}
        </span>
      ) : hint ? (
        <span className="block mt-1 pl-1 text-ink-subtle" style={{ fontSize: 11.5 }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** The "+ Add" pill that overlaps a field's top-right border. */
function AddChip({ onAdd, label }: { onAdd: (v: string) => void; label: string }) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  function commit() {
    const clean = value.trim();
    if (clean) onAdd(clean);
    setValue("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Add a ${label} option`}
        className="absolute -top-[9px] right-2 z-10 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold"
        style={{
          fontSize: 10.5,
          background: KYC_ACCENT_SOFT,
          color: KYC_ACCENT,
          border: "1px solid color-mix(in srgb, var(--color-indigo) 30%, transparent)",
        }}
      >
        <Plus size={10} strokeWidth={3} />
        Add
      </button>
    );
  }

  return (
    <span
      className="absolute -top-[13px] right-2 z-20 inline-flex items-center gap-1 rounded-md bg-surface-card px-1 py-0.5"
      style={{ border: `1px solid ${KYC_ACCENT}` }}
    >
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // This chip lives inside the KYC <form>; Enter must add the option,
          // never submit the whole thing.
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={`New ${label.toLowerCase()}`}
        maxLength={200}
        className="w-32 bg-transparent outline-none px-1 text-ink-strong"
        style={{ fontSize: 11.5 }}
      />
      <button type="button" onClick={commit} title="Add" className="grid place-items-center size-4" style={{ color: KYC_ACCENT }}>
        <Check size={11} strokeWidth={3.2} />
      </button>
      <button type="button" onClick={() => setOpen(false)} title="Cancel" className="grid place-items-center size-4 text-ink-subtle">
        <X size={11} strokeWidth={3} />
      </button>
    </span>
  );
}

/* ── Controls ────────────────────────────────────────────────────────────── */

export function TextControl(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return (
    <input
      {...rest}
      className={CONTROL}
      style={{ borderColor: invalid ? "var(--color-red)" : "var(--color-hairline-strong)" }}
    />
  );
}

export function SelectControl({
  placeholder,
  options,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  placeholder?: string;
  options: readonly string[];
}) {
  return (
    <select
      {...rest}
      className={`${CONTROL} appearance-none pr-8 bg-no-repeat`}
      style={{
        borderColor: "var(--color-hairline-strong)",
        // Inline chevron rather than an absolutely-positioned icon: a native
        // <select> can't host a child element, and an overlay would swallow
        // the click that opens it.
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
        backgroundPosition: "right 10px center",
      }}
    >
      <option value="">{placeholder ?? "—"}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Free text with suggestions — for City, which has no managed master. */
export function SuggestControl({
  suggestions,
  listId,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { suggestions: readonly string[]; listId: string }) {
  return (
    <>
      <input
        {...rest}
        list={listId}
        className={CONTROL}
        style={{ borderColor: "var(--color-hairline-strong)" }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

/**
 * Textarea with the app's existing dictation control parked bottom-right.
 * `DictateButton` renders nothing where the Web Speech API is unavailable
 * (Firefox), so this needs no capability check of its own.
 */
export function TextAreaControl({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={2000}
        className="w-full rounded-lg px-3 py-2.5 pr-3 bg-surface-card border outline-none text-[14px] text-ink-strong resize-y focus:border-[color:var(--color-indigo)] transition-colors"
        style={{ borderColor: "var(--color-hairline-strong)" }}
      />
      <span
        className="absolute right-2 bottom-3 inline-flex items-center gap-1 rounded-md bg-surface-card px-1.5 py-0.5"
        style={{ border: "1px solid var(--color-hairline)" }}
      >
        <DictateButton
          getValue={() => value}
          setValue={onChange}
          title="Dictate with Voice"
          size={13}
        />
        <span className="font-semibold text-ink-soft" style={{ fontSize: 11 }}>
          Dictate with Voice
        </span>
      </span>
    </div>
  );
}

/* ── Selectable pill ─────────────────────────────────────────────────────── */

/** Checkbox-in-a-pill, used by Customer Type, Industry Type and Product Types. */
export function CheckPill({
  label,
  checked,
  onToggle,
  full,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  /** Fill the grid cell (Product Types) instead of hugging the label. */
  full?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors min-h-[38px] hover:border-[color:var(--color-indigo)] ${
        full ? "w-full" : ""
      }`}
      style={{
        border: `1px solid ${checked ? KYC_ACCENT : "var(--color-hairline-strong)"}`,
        background: checked ? KYC_ACCENT_SOFT : "var(--color-surface-card)",
      }}
    >
      <span
        aria-hidden
        className="shrink-0 grid place-items-center rounded-[4px]"
        style={{
          width: 15,
          height: 15,
          background: checked ? KYC_ACCENT : "var(--color-surface-card)",
          border: `1px solid ${checked ? KYC_ACCENT : "var(--color-hairline-strong)"}`,
        }}
      >
        {checked && <Check size={10} strokeWidth={3.5} color="#fff" />}
      </span>
      <span
        className="min-w-0 font-semibold leading-tight"
        style={{ fontSize: 12.5, color: checked ? "var(--color-ink-strong)" : "var(--color-ink-soft)" }}
      >
        {label}
      </span>
    </button>
  );
}

/** The solid "+ Add" button that closes each pill row. */
export function AddPillButton({
  onAdd,
  placeholder,
  full,
  pending,
}: {
  onAdd: (v: string) => void;
  placeholder: string;
  full?: boolean;
  pending?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  function commit() {
    const clean = value.trim();
    if (clean) onAdd(clean);
    setValue("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 min-h-[38px] text-white font-bold disabled:opacity-60 ${
          full ? "w-full" : ""
        }`}
        style={{ fontSize: 12.5, background: KYC_ACCENT }}
      >
        <Plus size={14} strokeWidth={3} />
        Add
      </button>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 min-h-[38px] bg-surface-card ${full ? "w-full" : ""}`}
      style={{ border: `1px solid ${KYC_ACCENT}` }}
    >
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        maxLength={200}
        className="w-32 min-w-0 flex-1 bg-transparent outline-none px-1 text-[12.5px] text-ink-strong"
      />
      <button type="button" onClick={commit} title="Add" className="grid place-items-center size-5" style={{ color: KYC_ACCENT }}>
        <Check size={12} strokeWidth={3.2} />
      </button>
      <button type="button" onClick={() => setOpen(false)} title="Cancel" className="grid place-items-center size-5 text-ink-subtle">
        <X size={12} strokeWidth={3} />
      </button>
    </span>
  );
}

/* ── Tag input ───────────────────────────────────────────────────────────── */

/** Comma/Enter-committed chips. Backspace on an empty box drops the last one. */
export function TagControl({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = React.useState("");

  function commit(raw: string) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) {
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <>
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          }
          if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        maxLength={30}
        className={CONTROL}
        style={{ borderColor: "var(--color-hairline-strong)" }}
      />
      {values.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {values.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-pill pl-2 pr-1 py-0.5 font-semibold"
              style={{ fontSize: 11.5, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
            >
              {t}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== t))}
                title={`Remove ${t}`}
                className="grid place-items-center size-3.5"
              >
                <X size={10} strokeWidth={3} />
              </button>
            </span>
          ))}
        </span>
      )}
    </>
  );
}

/* ── Small inline buttons ────────────────────────────────────────────────── */

/** "+ Add Contact" / "+ Add address" / "+ Add Account". */
export function AddBlockButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-3.5 h-9 font-bold"
      style={{
        fontSize: 13,
        color: KYC_ACCENT,
        background: KYC_ACCENT_SOFT,
        border: "1px solid color-mix(in srgb, var(--color-indigo) 28%, transparent)",
      }}
    >
      <Plus size={14} strokeWidth={3} />
      {label}
    </button>
  );
}

/** The "✕ Remove" affordance on a repeatable block. */
export function RemoveButton({ onClick, label = "Remove" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg px-2.5 h-7 font-semibold text-ink-soft hover:text-ink-strong"
      style={{ fontSize: 12, border: "1px solid var(--color-hairline)" }}
    >
      <X size={12} strokeWidth={2.6} />
      {label}
    </button>
  );
}
