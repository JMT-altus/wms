"use client";

import { useEffect } from "react";

export function DetailDrawer({
  open,
  onClose,
  eyebrow,
  title,
  accent = "#0a6cff",
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(2,12,30,0.45)", backdropFilter: "blur(2px)", animation: "drawerFade 200ms ease-out" }} onClick={onClose} />
      <div
        className="absolute right-0 top-0 h-full w-full max-w-[540px] flex flex-col"
        style={{ background: "#fff", boxShadow: "-30px 0 80px -20px rgba(2,12,30,0.4)", animation: "drawerIn 280ms cubic-bezier(0.2,0.7,0.3,1)" }}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
          <div>
            {eyebrow && (
              <div style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.2em", color: accent }}>{eyebrow}</div>
            )}
            <div className="text-display-xs text-ink-strong mt-0.5">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 grid place-items-center rounded-full transition-colors"
            style={{ width: 34, height: 34, background: "rgba(15,23,42,0.05)", color: "#334155" }}
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
