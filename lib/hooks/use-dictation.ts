"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice dictation via the browser's built-in Web Speech API — NO external/paid
 * API and no key. Runs fully client-side (Chrome / Edge / most Chromium
 * browsers expose `webkitSpeechRecognition`). Falls back to `supported: false`
 * where it isn't available (e.g. Firefox), so callers can hide the mic button.
 *
 * `start()` / `stop()` toggle listening; `reset()` abandons the current
 * utterance and starts a fresh one (used after a voice command fires, so the
 * spoken command doesn't linger in the buffer). Chrome ends a session on
 * silence — we transparently restart. Fatal errors surface via `onError`.
 */
type Options = {
  onFinal?: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  lang?: string;
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation({ onFinal, onInterim, onError, lang = "en-IN" }: Options = {}) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(false);

  const recRef = useRef<SpeechRec | null>(null);
  const runningRef = useRef(false);
  const cbs = useRef({ onFinal, onInterim, onError });
  cbs.current = { onFinal, onInterim, onError };
  // The session-creation function, held in a ref so start/reset stay stable.
  const beginRef = useRef<() => void>(() => {});

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  useEffect(() => {
    beginRef.current = () => {
      const Ctor = getSpeechRecognition();
      if (!Ctor) {
        cbs.current.onError?.("Voice input isn't supported in this browser. Try Chrome or Edge.");
        return;
      }
      if (recRef.current) return;

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (e: unknown) => {
        const ev = e as {
          resultIndex: number;
          results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
        };
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i]!;
          const txt = res[0]?.transcript ?? "";
          if (res.isFinal) cbs.current.onFinal?.(txt);
          else interim += txt;
        }
        cbs.current.onInterim?.(interim);
      };

      rec.onend = () => {
        if (runningRef.current) {
          try {
            rec.start();
            return;
          } catch {
            /* fall through */
          }
        }
        recRef.current = null;
        setRecording(false);
      };

      rec.onerror = (e: unknown) => {
        const err = (e as { error?: string })?.error;
        if (err === "no-speech" || err === "aborted") return;
        runningRef.current = false;
        recRef.current = null;
        setRecording(false);
        const msg =
          err === "not-allowed" || err === "service-not-allowed"
            ? "Microphone access is blocked. Allow the mic for this site and try again."
            : err === "network"
              ? "Voice input needs an internet connection."
              : `Voice input error${err ? `: ${err}` : ""}.`;
        cbs.current.onError?.(msg);
      };

      recRef.current = rec;
      runningRef.current = true;
      try {
        rec.start();
        setRecording(true);
      } catch {
        recRef.current = null;
        runningRef.current = false;
        setRecording(false);
        cbs.current.onError?.("Couldn't start the microphone. Try again.");
      }
    };
  }, [lang]);

  const start = useCallback(() => {
    beginRef.current();
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Abandon the current utterance and start a fresh session — used right after
  // a spoken command fires, so the command words don't bleed into the next task.
  const reset = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    runningRef.current = true;
    setRecording(true);
    window.setTimeout(() => {
      if (runningRef.current && !recRef.current) beginRef.current();
    }, 60);
  }, []);

  const toggle = useCallback(() => {
    if (runningRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  return { recording, supported, start, stop, toggle, reset };
}
