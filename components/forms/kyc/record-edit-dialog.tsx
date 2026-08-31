"use client";

import * as React from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { KYC_ACCENT } from "./tokens";

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
  type?: "text" | "select" | "textarea" | "checkbox";
  /** For `select`. An empty-value option is prepended automatically. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  maxLength?: number;
  /** Column span out of 4. Defaults to 2 (half width). */
  span?: 1 | 2 | 3 | 4;
  inputMode?: "text" | "tel" | "numeric" | "email";
}

export type EditValues = Record<string, string | boolean>;

const CONTROL =
  "w-full rounded-lg h-10 px-3 bg-surface-card border outline-none text-[13.5px] text-ink-strong";

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
                      style={{ borderColor: "var(--color-hairline-strong)" }}
                    >
                      <option value="">— none —</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
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
