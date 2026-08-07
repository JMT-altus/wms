"use client";
import * as React from "react";
import { X } from "lucide-react";

/**
 * Right-hand drawer used by every master-data create/edit form.
 *
 * Deliberately not a Radix Dialog: these forms are long (a customer has 14
 * fields) and a centred modal would scroll inside a box. A drawer gets full
 * viewport height, and Escape / backdrop-click still close it.
 */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock the page behind the drawer so a long form doesn't scroll the list.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(15,23,42,0.42)", backdropFilter: "blur(2px)" }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative h-full flex flex-col bg-surface-card"
        style={{
          width: `min(${width}px, 100vw)`,
          borderLeft: "1px solid var(--color-hairline)",
          boxShadow: "-24px 0 60px -30px rgba(15,23,42,0.4)",
        }}
      >
        <header
          className="shrink-0 px-6 py-5 flex items-start justify-between gap-4"
          style={{ borderBottom: "1px solid var(--color-hairline)" }}
        >
          <div className="min-w-0">
            <h2 className="font-bold text-ink-strong" style={{ fontSize: 19 }}>
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 inline-flex items-center justify-center rounded-lg text-ink-muted"
            style={{ width: 34, height: 34, border: "1px solid var(--color-hairline)" }}
          >
            <X size={17} strokeWidth={2.4} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer
            className="shrink-0 px-6 py-4 flex items-center justify-end gap-2.5"
            style={{ borderTop: "1px solid var(--color-hairline)" }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}

/* ── Form primitives, shared by every master form ───────────────────────── */

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
        style={{ fontSize: 11 }}
      >
        {label}
        {required && <span style={{ color: "var(--color-red-deep)" }}> ·&nbsp;required</span>}
      </span>
      {children}
      {hint && (
        <span className="block mt-1 text-ink-subtle" style={{ fontSize: 12 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputCls =
  "w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="w-full rounded-chip px-3.5 py-2.5 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong resize-y"
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4"
      />
      <span className="font-semibold text-ink-soft" style={{ fontSize: 14.5 }}>
        {label}
      </span>
    </label>
  );
}

export function SaveButton({
  pending,
  children = "Save",
  accent = "#0A6CFF",
}: {
  pending: boolean;
  children?: React.ReactNode;
  accent?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl px-5 py-2.5 text-white font-bold disabled:opacity-60"
      style={{ fontSize: 14.5, background: accent }}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

export function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-4 py-2.5 font-semibold text-ink-soft"
      style={{ fontSize: 14.5, border: "1px solid var(--color-hairline)" }}
    >
      Cancel
    </button>
  );
}

/** Row-level edit/delete buttons for the DataTable `actions` slot. */
export function RowBtn({
  children,
  title,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-lg disabled:opacity-40"
      style={{
        width: 30,
        height: 30,
        border: "1px solid var(--color-hairline)",
        background: "var(--color-surface-soft)",
        color: danger ? "var(--color-red-deep)" : "var(--color-ink-muted)",
      }}
    >
      {children}
    </button>
  );
}
