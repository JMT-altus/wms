"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { X } from "lucide-react";

export interface PendingLeaveSummary {
  id: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  days: number;
  typeLabel: string;
  reason: string | null;
}

const KEY = "leave-prompt-dismissed";
const EVENT = "leave-prompt-dismissed";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A reminder for approvers that leave requests are waiting. It is only a
 * reminder: dismissing it hides it for this browser session and removes nothing —
 * the requests stay in the pending list on the Leave page, and it comes back on
 * the next sign-in while any are still pending. The list is rendered by the server
 * from the database, so this never invents or caches a request.
 */
export function PendingLeavePrompt({
  requests,
  total,
}: {
  requests: PendingLeaveSummary[];
  total: number;
}) {
  // Hidden on the server and until the browser has been asked, so there is no
  // flash of a popup the person already dismissed this session.
  const dismissed = React.useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed || requests.length === 0) return null;

  function close() {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* private mode: it simply reappears next navigation */
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div
      role="dialog"
      aria-label="Leave requests awaiting your decision"
      className="fixed bottom-5 right-5 z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-4 shadow-xl"
      style={{ border: "1px solid #E8E5DF" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-ink-strong">
            {total} leave request{total === 1 ? "" : "s"} awaiting your decision
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Dismiss" className="shrink-0 text-ink-subtle hover:text-ink-strong">
          <X size={16} />
        </button>
      </div>
      <ul className="mt-2 grid gap-2 max-h-[300px] overflow-y-auto">
        {requests.map((r) => (
          <li key={r.id} className="rounded-lg bg-surface-soft p-2.5">
            <p className="text-[13.5px] font-semibold text-ink-strong">{r.employeeName}</p>
            <p className="text-[12.5px] text-ink-soft tabular-nums">
              {r.startDate} → {r.endDate} · {r.days} day{r.days === 1 ? "" : "s"} · {r.typeLabel}
            </p>
            {r.reason && <p className="mt-0.5 text-[12.5px] text-ink-muted line-clamp-2">{r.reason}</p>}
            <Link
              href={`/attendance/leave#leave-${r.id}` as Route}
              onClick={close}
              className="mt-1 inline-block text-[12.5px] font-semibold underline underline-offset-2 text-ink-strong"
            >
              Open request
            </Link>
          </li>
        ))}
      </ul>
      {total > requests.length && (
        <p className="mt-2 text-[12.5px] text-ink-subtle">and {total - requests.length} more on the Leave page.</p>
      )}
    </div>
  );
}
