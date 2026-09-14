"use client";

import * as React from "react";
import { toast } from "sonner";
import { Minus, Plus, X } from "lucide-react";
import { formatInr } from "@/lib/format";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./tokens";

/**
 * The edit form behind the selection bar's Edit button, for the Client KYC
 * directories.
 *
 * One dialog driven by a field list rather than three hand-written forms:
 * contacts, addresses and bank accounts are all flat records of text boxes
 * and a couple of pickers, and three copies would drift the moment one of
 * them gained a field.
 *
 * It edits ONE record. Nothing here can move a record to a different client —
 * the parent id is never part of the payload, so a directory edit can fix a
 * phone number but not re-parent someone's contact.
 */

export interface EditField {
  key: string;
  label: string;
  /**
   * `select`  one value, closed list — a plain dropdown.
   * `combo`   one value, open list — a dropdown you can also type into, for
   *           the admin-managed suggestion lists (State, Payment Terms and
   *           friends) that the schema stores as free text. Refusing a value
   *           nobody has added to the list yet would make this dialog
   *           stricter than the KYC form it edits.
   * `multi`   several values off a list, shown as removable chips.
   * `number`  a figure with −/+ steppers, for the ones people nudge rather
   *           than retype (Credit Limit, Credit Days).
   */
  type?: "text" | "select" | "combo" | "multi" | "number" | "textarea" | "checkbox";
  /** For `select` / `combo` / `multi`. `select` prepends an empty option. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  maxLength?: number;
  /** Column span out of 4. Defaults to 2 (half width). */
  span?: 1 | 2 | 3 | 4;
  inputMode?: "text" | "tel" | "numeric" | "email";
  /** `number`: what one −/+ press moves the value by. Defaults to 1. */
  step?: number;
  /** `number`: the floor the steppers clamp to. Defaults to 0. */
  min?: number;
  /** `number`: render the current figure in ₹ under the box. */
  format?: "inr";
  /** `multi`: accept values that aren't on the list. */
  allowCustom?: boolean;
}

export type EditValues = Record<string, string | boolean>;

const CONTROL =
  "w-full rounded-lg h-10 px-3 bg-surface-card border outline-none text-[13.5px] text-ink-strong";
const BORDER = "var(--color-hairline-strong)";

/** Comma-separated text ⇄ list, the shape `multi` keeps its value in. */
const splitList = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const joinList = (v: string[]): string => v.join(", ");

/** `{ value, label }` from a plain list of strings, for option-list fields. */
export const asOptions = (values: readonly string[]): { value: string; label: string }[] =>
  values.map((v) => ({ value: v, label: v }));

/**
 * Several values off a list, as removable chips.
 *
 * Customer Type, Industry Type and Tags used to be one comma-separated text
 * box here — the values come from admin-managed master lists, and typing them
 * back in by hand is how "Fabrication" and "fabrications" end up as two
 * different types. The picker offers what the list holds and takes the typing
 * out of it; the stored value is still the same comma-separated string, so
 * nothing downstream had to change.
 */
function MultiPicker({
  value,
  options,
  allowCustom,
  label,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  allowCustom?: boolean;
  label: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const selected = splitList(value);
  const lower = new Set(selected.map((s) => s.toLowerCase()));
  const remaining = options.filter((o) => !lower.has(o.value.toLowerCase()));

  const add = (v: string) => {
    const clean = v.trim();
    // Commas are the separator — a value carrying one would come back as two.
    if (!clean || clean.includes(",") || lower.has(clean.toLowerCase())) return;
    onChange(joinList([...selected, clean]));
  };
  const drop = (v: string) => onChange(joinList(selected.filter((s) => s !== v)));

  return (
    <div
      className="rounded-lg bg-surface-card border px-2 py-2 flex flex-col gap-2"
      style={{ borderColor: BORDER, minHeight: 40 }}
    >
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-pill pl-2 pr-1 py-0.5 font-semibold"
              style={{ fontSize: 11.5, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
            >
              {v}
              <button
                type="button"
                onClick={() => drop(v)}
                aria-label={`Remove ${v}`}
                className="grid place-items-center rounded-full hover:opacity-70"
                style={{ width: 15, height: 15 }}
              >
                <X size={11} strokeWidth={3} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <select
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.currentTarget.value = "";
          }}
          disabled={remaining.length === 0}
          className="flex-1 min-w-0 rounded-md h-8 px-2 bg-surface-soft border outline-none text-[12.5px] text-ink-soft disabled:opacity-50"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <option value="">
            {remaining.length === 0 ? "All options added" : `+ Add ${label.toLowerCase()}`}
          </option>
          {remaining.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {allowCustom && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Enter inside the dialog would otherwise submit nothing and
              // lose the word being typed.
              e.preventDefault();
              add(draft);
              setDraft("");
            }}
            onBlur={() => {
              add(draft);
              setDraft("");
            }}
            placeholder="or type one, Enter"
            className="w-[150px] shrink-0 rounded-md h-8 px-2 bg-surface-soft border outline-none text-[12.5px] text-ink-strong"
            style={{ borderColor: "var(--color-hairline)" }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A figure with −/+ buttons either side.
 *
 * Credit limits move in round steps — a review nudges one up by a lakh, it is
 * not retyped from scratch — so the buttons step by the field's own `step`
 * and the box still takes a typed number for anything off-step. Digits,
 * commas and one dot are all that get through: "10,00,000" is how a lakh
 * figure is written here, and the caller strips the commas before saving.
 */
function NumberStepper({
  value,
  step = 1,
  min = 0,
  format,
  placeholder,
  onChange,
}: {
  value: string;
  step?: number;
  min?: number;
  format?: "inr";
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  const current = Number(value.replace(/,/g, ""));
  const valid = value.trim() !== "" && Number.isFinite(current);

  const bump = (dir: 1 | -1) => {
    const base = valid ? current : min;
    // Snap onto the step grid so +/- from a typed 47,500 lands on round
    // numbers rather than carrying the odd 2,500 along forever.
    const next = dir === 1 ? Math.floor(base / step) * step + step : Math.ceil(base / step) * step - step;
    onChange(String(Math.max(min, next)));
  };

  const btnCls =
    "shrink-0 grid place-items-center rounded-lg bg-surface-soft border text-ink-soft hover:text-ink-strong disabled:opacity-35";
  const btnStyle = { width: 34, height: 40, borderColor: BORDER } as const;

  return (
    <div className="flex flex-col">
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          onClick={() => bump(-1)}
          disabled={valid && current <= min}
          aria-label="Decrease"
          title={`Decrease by ${step.toLocaleString("en-IN")}`}
          className={btnCls}
          style={btnStyle}
        >
          <Minus size={15} strokeWidth={2.6} />
        </button>
        <input
          value={value}
          inputMode="numeric"
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "" || /^[0-9,]*\.?[0-9]*$/.test(raw)) onChange(raw);
          }}
          className={`${CONTROL} flex-1 min-w-0 text-right tabular-nums`}
          style={{ borderColor: BORDER }}
        />
        <button
          type="button"
          onClick={() => bump(1)}
          aria-label="Increase"
          title={`Increase by ${step.toLocaleString("en-IN")}`}
          className={btnCls}
          style={btnStyle}
        >
          <Plus size={15} strokeWidth={2.6} />
        </button>
      </div>
      {format === "inr" && (
        <span className="mt-1 text-ink-subtle" style={{ fontSize: 11.5 }}>
          {valid ? formatInr(current) : "Not set"}
        </span>
      )}
    </div>
  );
}

export function RecordEditDialog({
  title,
  fields,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  fields: EditField[];
  initial: EditValues;
  /** Returns the server's answer so the dialog can stay open on failure. */
  onSave: (values: EditValues) => Promise<{ ok: true } | { ok: false; error: string }>;
  onClose: () => void;
}) {
  const [values, setValues] = React.useState<EditValues>(initial);
  const [saving, setSaving] = React.useState(false);
  /** Namespaces the `combo` datalists — two dialogs must not share an id. */
  const listIdBase = React.useId();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, saving]);

  const set = (k: string, v: string | boolean) => setValues((p) => ({ ...p, [k]: v }));

  function submit() {
    setSaving(true);
    void onSave(values)
      .then((res) => {
        if (res.ok) {
          toast.success("Saved.");
          onClose();
        } else {
          // Stays open on failure — closing would throw away the edit along
          // with the error that explains why it didn't take.
          toast.error(res.error);
        }
      })
      .catch(() => toast.error("Couldn't reach the server. Try again in a moment."))
      .finally(() => setSaving(false));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Same treatment as the panel inside it — see the View-details note. */}
      <div
        className="w-full max-w-[820px] max-h-[86vh] flex flex-col rounded-section bg-surface-card"
        style={{
          border: "1px solid var(--color-ink-strong)",
          boxShadow: `0 3px 0 0 ${KYC_ACCENT}, 0 30px 60px -20px rgba(15,23,42,0.4)`,
        }}
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-4">
          <h2
            className="flex-1 min-w-0 font-bold text-ink-strong truncate"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 20 }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="shrink-0 grid place-items-center rounded-full text-ink-subtle hover:text-ink-strong disabled:opacity-40"
            style={{ width: 30, height: 30 }}
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5">
          {/* Matches the View-details panel: dark outline, accent line under
              the bottom edge. The two open from the same bar, so they should
              not look like they came from different apps. */}
          <div
            className="rounded-section px-5 py-5 grid gap-x-3 gap-y-4 grid-cols-1 sm:grid-cols-4"
            style={{
              border: "1px solid var(--color-ink-strong)",
              boxShadow: `0 3px 0 0 ${KYC_ACCENT}`,
            }}
          >
            {fields.map((f) => {
              const span = f.span ?? 2;
              const raw = values[f.key];
              return (
                <label
                  key={f.key}
                  className="min-w-0 flex flex-col"
                  style={{ gridColumn: `span ${span} / span ${span}` }}
                >
                  <span
                    className="uppercase font-bold tracking-[0.08em] text-ink-subtle mb-1.5"
                    style={{ fontSize: 10.5 }}
                  >
                    {f.label}
                  </span>

                  {f.type === "checkbox" ? (
                    <span className="inline-flex items-center gap-2 h-10">
                      <input
                        type="checkbox"
                        checked={raw === true}
                        onChange={(e) => set(f.key, e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: KYC_ACCENT }}
                      />
                      <span className="text-ink-soft" style={{ fontSize: 13 }}>
                        {f.placeholder ?? "Yes"}
                      </span>
                    </span>
                  ) : f.type === "select" ? (
                    <select
                      value={String(raw ?? "")}
                      onChange={(e) => set(f.key, e.target.value)}
                      className={`${CONTROL} appearance-none pr-8`}
                      style={{ borderColor: BORDER }}
                    >
                      <option value="">— none —</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "combo" ? (
                    /* Native datalist rather than a hand-built popover: it
                       filters as you type, works on touch, and — the point
                       here — still accepts a value that isn't on the list. */
                    <>
                      <input
                        value={String(raw ?? "")}
                        onChange={(e) => set(f.key, e.target.value)}
                        list={`${listIdBase}-${f.key}`}
                        placeholder={f.placeholder ?? "Pick one or type"}
                        maxLength={f.maxLength}
                        className={CONTROL}
                        style={{ borderColor: BORDER }}
                      />
                      <datalist id={`${listIdBase}-${f.key}`}>
                        {(f.options ?? []).map((o) => (
                          <option key={o.value} value={o.value} />
                        ))}
                      </datalist>
                    </>
                  ) : f.type === "multi" ? (
                    <MultiPicker
                      value={String(raw ?? "")}
                      options={f.options ?? []}
                      allowCustom={f.allowCustom}
                      label={f.label}
                      onChange={(next) => set(f.key, next)}
                    />
                  ) : f.type === "number" ? (
                    <NumberStepper
                      value={String(raw ?? "")}
                      step={f.step}
                      min={f.min}
                      format={f.format}
                      placeholder={f.placeholder}
                      onChange={(next) => set(f.key, next)}
                    />
                  ) : f.type === "textarea" ? (
                    <textarea
                      value={String(raw ?? "")}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      rows={3}
                      className="w-full rounded-lg px-3 py-2 bg-surface-card border outline-none text-[13.5px] text-ink-strong resize-y"
                      style={{ borderColor: "var(--color-hairline-strong)" }}
                    />
                  ) : (
                    <input
                      value={String(raw ?? "")}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      inputMode={f.inputMode}
                      className={CONTROL}
                      style={{ borderColor: "var(--color-hairline-strong)" }}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <div
          className="flex justify-end gap-2 px-6 py-4"
          style={{ borderTop: "1px solid var(--color-hairline)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-chip px-4 h-10 text-[14px] font-semibold text-ink-soft border border-hairline disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-chip px-5 h-10 text-[14px] font-bold text-white disabled:opacity-60"
            style={{ background: KYC_ACCENT }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
