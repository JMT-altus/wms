"use client";

import { useSyncExternalStore } from "react";
import { useOnline } from "@/lib/use-online";

const TZ = "Asia/Kolkata";

/**
 * The wall clock as an external store, same shape as `useOnline` below it.
 *
 * Snapshot is whole seconds since the epoch — a number, so React can compare it
 * cheaply, and it only changes once a second no matter how often it's read. The
 * server snapshot is null: there is no "now" the server and client can agree
 * on, so SSR renders the placeholder and the real time arrives on hydration.
 */
function subscribeSecond(onChange: () => void): () => void {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

/**
 * The hub's status cluster: date · time · connectivity, as one glass pill on
 * the left of the launcher's top bar.
 *
 * The hub is the one screen where the navy brand band (which normally carries
 * these) hides itself, so without this there's no clock and no connection
 * indicator anywhere on it. Balancing the bar is the secondary benefit; filling
 * that gap is the point.
 *
 * Times are IST regardless of the viewer's device clock, matching the rest of
 * the app. Rendering starts blank and fills in after mount — the server has no
 * "now" to agree with, so anything else is a hydration mismatch.
 */
export function HubStatus() {
  const epochSecond = useSyncExternalStore(
    subscribeSecond,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
  const online = useOnline();
  const now = epochSecond === null ? null : new Date(epochSecond * 1000);

  const dateLabel = now
    ? now.toLocaleDateString("en-IN", {
        timeZone: TZ,
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "";
  const timeLabel = now
    ? now.toLocaleTimeString("en-IN", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--:--";

  const dot = online ? "#22c55e" : "#ef4444";

  return (
    <div
      className="inline-flex items-center gap-2.5 rounded-full px-4 py-2"
      // Dark glass: the hub's canvas is navy, so a white pill here read as a
      // bright hole in it. Same treatment as the eyebrow pill below the bar.
      style={{
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow:
          "0 10px 24px -12px rgba(10,108,255,0.5), inset 0 1px 0 rgba(255,255,255,0.18)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {/* Date drops on the narrowest screens; the clock and status stay. */}
      <span
        className="text-[13px] font-semibold max-sm:hidden"
        style={{ color: "rgba(255,255,255,0.70)" }}
      >
        {dateLabel || "—"}
      </span>
      <Dot />
      <span
        className="text-[13px] font-bold tabular-nums"
        style={{
          color: "rgba(255,255,255,0.92)",
          fontFamily: "var(--font-mono-display), ui-monospace, monospace",
        }}
      >
        {timeLabel}
      </span>
      <Dot />
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold"
        style={{ color: online ? "#4ADE80" : "#FCA5A5" }}
      >
        <span
          aria-hidden
          className="inline-block size-2 rounded-full"
          style={{ background: dot, boxShadow: `0 0 8px ${dot}` }}
        />
        {online ? "Online" : "Offline"}
      </span>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden style={{ color: "rgba(255,255,255,0.30)", fontSize: 12 }}>
      ·
    </span>
  );
}
