"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Zap, X, Check, Loader2, Mic, Settings2, Lock, Globe } from "lucide-react";
import { quickDumpTasks } from "@/app/(app)/tasks/actions";
import { fireToast } from "@/lib/toast";
import { useDictation } from "@/lib/hooks/use-dictation";

const KEYWORDS_STORAGE_KEY = "vp_quickdump_keywords";
const DEFAULT_KEYWORDS = "next task, new task, add";

function parseKeywords(s: string): string[] {
  return s.split(",").map((k) => k.trim()).filter(Boolean);
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Split `text` at any trigger keyword: everything before a keyword is a
 *  finished task; the tail after the last keyword is what's still being typed. */
function splitOnKeywords(text: string, kws: string[]): { commits: string[]; rest: string } {
  const commits: string[] = [];
  if (kws.length === 0) return { commits, rest: text };
  const re = new RegExp(`\\b(?:${kws.map(escapeRegex).join("|")})\\b`, "i");
  let buf = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    const before = buf.slice(0, m.index).trim();
    if (before) commits.push(before);
    buf = buf.slice(m.index + m[0].length);
  }
  return { commits, rest: buf.replace(/^\s+/, "") };
}

/**
 * Quick Dump — rapid capture for Mihir Veera / Altus Corp. Type a task and
 * press Enter, or use the mic to DICTATE hands-free: speak a task, then say a
 * trigger phrase ("next task" / "new task" / "add") — or tap Add — to save it
 * and immediately start capturing the next. Live speech types into the box as
 * you talk. Tasks are saved UNASSIGNED; assign a doer later. The trigger is
 * only rendered for allowlisted users (server enforces it too).
 */
export function QuickDumpDialog({
  open: openProp,
  onOpenChange,
  renderTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  renderTrigger?: boolean;
} = {}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  const [committed, setCommitted] = React.useState("");
  const [interim, setInterim] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [added, setAdded] = React.useState<string[]>([]);
  const [keywordsText, setKeywordsText] = React.useState(DEFAULT_KEYWORDS);
  const [showKw, setShowKw] = React.useState(false);
  // Quick Dump is the capture box for half-formed thoughts, so it gets the
  // simple binary rather than the full picker: keep it to yourself, or don't.
  // Anything finer is a decision for the task's own page later.
  // Personal by default (0078) — the capture box is where half-formed thoughts
  // land, and everyone except the MD and admins now sees only their own work.
  // Toggle to "Everyone" to share a dump with the team.
  const [personal, setPersonal] = React.useState(true);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Refs mirror state so the speech callbacks (which capture once) stay fresh.
  const committedRef = React.useRef("");
  const interimRef = React.useRef("");
  const keywordsRef = React.useRef<string[]>(parseKeywords(DEFAULT_KEYWORDS));

  // Load saved keyword phrases.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEYWORDS_STORAGE_KEY);
      if (saved != null) {
        setKeywordsText(saved);
        keywordsRef.current = parseKeywords(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setCommittedBoth = (v: string) => {
    committedRef.current = v;
    setCommitted(v);
  };
  const setInterimBoth = (v: string) => {
    interimRef.current = v;
    setInterim(v);
  };

  const saveTitles = React.useCallback(
    async (titles: string[]) => {
      const clean = titles.map((t) => t.trim()).filter(Boolean);
      if (clean.length === 0) return;
      setPending(true);
      try {
        const res = await quickDumpTasks(clean, personal ? "private" : "internal");
        if (!res.ok) fireToast({ message: res.error || "Couldn't add." });
        else setAdded((prev) => [...clean, ...prev]);
      } finally {
        setPending(false);
      }
    },
    [personal],
  );

  // Split raw text into task titles: by line, then by any trigger keyword.
  const splitToTitles = React.useCallback((raw: string): string[] => {
    return raw
      .split("\n")
      .flatMap((line) => {
        const { commits, rest } = splitOnKeywords(line.trim(), keywordsRef.current);
        return [...commits, rest];
      })
      .map((t) => t.trim())
      .filter(Boolean);
  }, []);

  // Save whatever's in the box now (finalized + the live interim, so the last
  // spoken word is never dropped), then clear it for the next task.
  const saveCurrent = React.useCallback(() => {
    const raw = `${committedRef.current} ${interimRef.current}`.replace(/\s+/g, " ").trim();
    setCommittedBoth("");
    setInterimBoth("");
    if (raw) void saveTitles(splitToTitles(raw));
    inputRef.current?.focus();
  }, [saveTitles, splitToTitles]);

  // Final speech chunk → append to the finalized buffer + run trigger keywords.
  // Detection runs on FINAL (complete, stable) text so the first and last words
  // of each task are captured intact and the recogniser is never interrupted.
  const handleFinal = React.useCallback(
    (chunk: string) => {
      const merged = `${committedRef.current} ${chunk}`.replace(/\s+/g, " ").trim();
      const { commits, rest } = splitOnKeywords(merged, keywordsRef.current);
      commits.forEach((c) => void saveTitles([c]));
      setCommittedBoth(rest);
      setInterimBoth("");
    },
    [saveTitles],
  );

  // Live interim → just type it into the box (no committing here, so nothing
  // half-heard is ever saved).
  const handleInterim = React.useCallback((t: string) => setInterimBoth(t), []);

  const { recording, supported, start, stop, toggle } = useDictation({
    onFinal: handleFinal,
    onInterim: handleInterim,
    onError: (msg) => fireToast({ message: msg }),
  });

  function done() {
    stop();
    setOpen(false);
    // Save anything still in the box so the last task is never lost.
    const raw = `${committedRef.current} ${interimRef.current}`.replace(/\s+/g, " ").trim();
    const pending = raw ? splitToTitles(raw) : [];
    if (pending.length > 0) void saveTitles(pending);
    const willRefresh = pending.length > 0 || added.length > 0;
    setAdded([]);
    setCommittedBoth("");
    setInterimBoth("");
    if (willRefresh) router.refresh();
  }

  // What the input shows: finalized text + live interim as you speak.
  const displayValue = committed + (interim ? (committed ? " " : "") + interim : "");

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) done();
        else setOpen(true);
      }}
    >
      {renderTrigger && (
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-chip text-[14.5px] font-bold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(135deg, var(--color-amber), var(--color-tangerine))",
              boxShadow: "0 6px 16px -4px color-mix(in srgb, var(--color-amber) 55%, transparent)",
            }}
          >
            <Zap size={16} strokeWidth={2.6} />
            Quick Dump
          </button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card p-6 shadow-xl max-sm:max-h-[90dvh] max-sm:overflow-y-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <Dialog.Title className="text-display-md text-ink-strong">Quick Dump</Dialog.Title>
              <Dialog.Description className="text-[14.5px] text-ink-subtle mt-1.5" style={{ lineHeight: 1.5 }}>
                Type a task and press Enter, or tap the mic and speak. Say{" "}
                <strong>"next task"</strong>, <strong>"new task"</strong> or{" "}
                <strong>"add"</strong> (or tap Add) to save it and start the next.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-full p-1 hover:bg-surface-soft text-ink-subtle hover:text-ink-strong"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex items-stretch gap-2">
            <input
              ref={inputRef}
              autoFocus
              value={displayValue}
              onChange={(e) => {
                setCommittedBoth(e.target.value);
                setInterimBoth("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveCurrent();
                }
              }}
              placeholder="e.g. Chase Sharma Traders payment…"
              className="nt-input flex-1"
            />
            {supported && (
              <button
                type="button"
                onClick={() => toggle()}
                aria-pressed={recording}
                title={recording ? "Stop dictation" : "Dictate"}
                className="inline-flex items-center justify-center rounded-chip shrink-0"
                style={{
                  width: 48,
                  color: recording ? "#ffffff" : "var(--color-ink-soft)",
                  background: recording ? "var(--color-red)" : "var(--color-surface-soft)",
                  border: recording ? "none" : "1px solid var(--color-hairline)",
                  animation: recording ? "dictatePulse 1.4s ease-out infinite" : "none",
                }}
              >
                <Mic size={18} strokeWidth={2.4} />
              </button>
            )}
            <button
              type="button"
              aria-pressed={personal}
              onClick={() => setPersonal((v) => !v)}
              title={
                personal
                  ? "Personal — only you will see these"
                  : "Everyone — the whole team will see these"
              }
              className="inline-flex items-center gap-1.5 px-3 rounded-chip text-[13px] font-bold transition-colors"
              style={
                personal
                  ? { background: "rgba(15,23,42,0.86)", color: "#fff" }
                  : {
                      background: "var(--color-surface-soft)",
                      color: "var(--color-ink-soft)",
                      border: "1px solid var(--color-hairline)",
                    }
              }
            >
              {personal ? <Lock size={14} strokeWidth={2.5} /> : <Globe size={14} strokeWidth={2.5} />}
              {personal ? "Personal" : "Everyone"}
            </button>
            <button
              type="button"
              onClick={() => {
                saveCurrent();
                if (supported) start(); // Add → save + start capturing the next
              }}
              disabled={pending && displayValue.trim().length === 0}
              className="inline-flex items-center justify-center gap-1.5 px-4 rounded-chip text-[14px] font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, var(--color-amber), var(--color-tangerine))" }}
            >
              {pending ? <Loader2 size={16} className="animate-spin" /> : "Add"}
            </button>
          </div>

          {/* Live listening state. */}
          {recording && (
            <p className="mt-2 text-[13px] font-semibold inline-flex items-center gap-2" style={{ color: "var(--color-red-deep)" }}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-red)", animation: "livePulse 1.2s ease-in-out infinite" }} />
              Listening… say a trigger phrase to save and continue.
            </p>
          )}

          {/* Editable trigger phrases. */}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowKw((s) => !s)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-subtle hover:text-ink-strong"
            >
              <Settings2 size={13} strokeWidth={2.2} />
              Voice save phrases
            </button>
            {showKw && (
              <div className="mt-1.5">
                <input
                  type="text"
                  value={keywordsText}
                  onChange={(e) => {
                    setKeywordsText(e.target.value);
                    keywordsRef.current = parseKeywords(e.target.value);
                    try {
                      window.localStorage.setItem(KEYWORDS_STORAGE_KEY, e.target.value);
                    } catch {
                      /* ignore */
                    }
                  }}
                  placeholder={DEFAULT_KEYWORDS}
                  className="nt-input w-full text-[13.5px]"
                />
                <p className="mt-1 text-[12px] text-ink-subtle">
                  Comma-separated. Saying any of these saves the current task and starts the next.
                </p>
              </div>
            )}
          </div>

          {added.length > 0 && (
            <div className="mt-4">
              <p className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-ink-subtle mb-2">
                Added this session · {added.length}
              </p>
              <ul className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                {added.map((t, i) => (
                  <li
                    key={`${t}-${i}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-chip text-[14px] text-ink-strong"
                    style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)" }}
                  >
                    <Check size={15} strokeWidth={2.6} style={{ color: "var(--color-green-deep)" }} />
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 mt-5">
            <button
              type="button"
              onClick={done}
              className="px-5 py-2.5 rounded-chip text-[14px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, rgb(2, 99, 204), rgb(0, 66, 138))" }}
            >
              {added.length > 0 ? `Done · ${added.length} added` : "Done"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
