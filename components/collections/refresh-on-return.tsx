"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps an already-open Collection screen in step with the database. Renders
 * nothing.
 *
 * A normal visit needs no help: the page is rendered from the database on every
 * request, and every upload and assignment action revalidates it. What is left
 * is a copy that is ALREADY on screen while the data changes somewhere else:
 *   - the screen was open in another tab (or on another person's desk) while a
 *     file was uploaded or a Sales Coordinator assigned in the Tracker;
 *   - the browser's Back / Forward button brought back the copy it was holding.
 * In both cases this asks the server for the page again — `router.refresh()`,
 * which re-reads the data in place: no full reload, and the screen's own state
 * (its filters) is kept.
 *
 * `loadedAt` is the server render's timestamp, used only as that render's
 * identity. How old a copy is is measured on this device's own clock from when
 * the copy first arrived, so a wrong clock on either side cannot cause a
 * refresh loop or suppress one.
 *
 * A copy younger than `minAgeMs` is left alone, and a refresh is asked for at
 * most once in that time, so switching windows quickly never queues requests.
 */
const firstSeen = new Map<number, number>();

/** Milliseconds since this render's copy first reached this browser; a copy seen for the first time is recorded and is 0 old. */
function ageOf(loadedAt: number, now: number): number {
  const seen = firstSeen.get(loadedAt);
  if (seen !== undefined) return now - seen;
  // Only the copies a Back / Forward step could still bring back matter; keep the record small.
  if (firstSeen.size >= 50) firstSeen.clear();
  firstSeen.set(loadedAt, now);
  return 0;
}

export function RefreshOnReturn({ loadedAt, minAgeMs = 10_000 }: { loadedAt: number; minAgeMs?: number }) {
  const router = useRouter();

  React.useEffect(() => {
    let askedAt = Number.NEGATIVE_INFINITY;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (ageOf(loadedAt, now) < minAgeMs || now - askedAt < minAgeMs) return;
      askedAt = now;
      router.refresh();
    };
    // On arrival: a fresh render is recorded and left alone; a copy the browser brought back is refreshed.
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [router, loadedAt, minAgeMs]);

  return null;
}

/** Test seam: forget every recorded render. */
export function resetRefreshOnReturn(): void {
  firstSeen.clear();
}
