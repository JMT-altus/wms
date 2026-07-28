"use client";

import * as React from "react";
import { Mic } from "lucide-react";
import { useDictation } from "@/lib/hooks/use-dictation";
import { fireToast } from "@/lib/toast";

/**
 * A tap-to-dictate mic button (Gboard / WhatsApp style) powered by the
 * browser's built-in speech recognition — no external API. Tap to start,
 * tap again to stop. Text is written into the field LIVE as you speak
 * (interim results), then finalised. Renders nothing where speech recognition
 * isn't available, so it's safe to drop next to any text field. Errors (mic
 * blocked, offline) surface as a toast.
 *
 * Wire it to a field with `getValue` / `setValue` — dictation appends to
 * whatever is already there when you start.
 */
export function DictateButton({
  getValue,
  setValue,
  title = "Dictate",
  size = 16,
  className,
}: {
  getValue: () => string;
  setValue: (next: string) => void;
  title?: string;
  size?: number;
  className?: string;
}) {
  // `baseRef` is the committed text that interim words are appended to.
  // `lastSetRef` is the last value WE wrote — if the field differs from it,
  // the user typed/edited manually, so we adopt their text as the new base
  // instead of overwriting it (fixes "typed text gets deleted while recording").
  const baseRef = React.useRef("");
  const lastSetRef = React.useRef("");
  const join = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b);

  const reconcile = () => {
    const cur = getValue() ?? "";
    if (cur !== lastSetRef.current) baseRef.current = cur.trim();
  };
  const write = (next: string) => {
    lastSetRef.current = next;
    setValue(next);
  };

  const { recording, supported, start, stop } = useDictation({
    onInterim: (t) => {
      reconcile();
      write(join(baseRef.current, t));
    },
    onFinal: (t) => {
      reconcile();
      baseRef.current = join(baseRef.current, t.trim());
      write(baseRef.current);
    },
    onError: (msg) => fireToast({ message: msg }),
  });

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (recording) {
          stop();
        } else {
          const cur = getValue() || "";
          baseRef.current = cur.trim();
          lastSetRef.current = cur;
          start();
        }
      }}
      aria-pressed={recording}
      title={recording ? "Stop dictation" : title}
      aria-label={recording ? "Stop dictation" : title}
      className={
        className ??
        "inline-flex items-center justify-center rounded-full transition-colors shrink-0"
      }
      style={{
        width: size + 16,
        height: size + 16,
        color: recording ? "#ffffff" : "var(--color-ink-subtle)",
        background: recording ? "var(--color-red)" : "transparent",
        border: recording ? "none" : "1px solid var(--color-hairline)",
        animation: recording ? "dictatePulse 1.4s ease-out infinite" : "none",
      }}
    >
      <Mic size={size} strokeWidth={2.4} />
    </button>
  );
}
