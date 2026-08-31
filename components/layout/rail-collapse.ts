"use client";

import { useSyncExternalStore } from "react";

/**
 * Collapsed/expanded state for the left rails, shared by all three of them —
 * the workspace rail, Masters and Forms.
 *
 * A tiny external store rather than context because the workspace rail and the
 * offset that clears it are siblings in the (app) layout, not parent and
 * child, so there is nothing to put a provider around without restructuring
 * the layout. `useSyncExternalStore` is also what keeps the localStorage read
 * out of an effect: it renders the server snapshot during hydration, then
 * re-renders with the stored value, with no mismatch warning and no flash of
 * the wrong width that a setState-in-effect would produce.
 *
 * One key for every rail on purpose — collapsing in WMS and then opening
 * Masters should not silently expand it again.
 */

const KEY = "jmt-rail-collapsed-v1";

export const RAIL_WIDTH = 216;
export const RAIL_WIDTH_COLLAPSED = 64;

let collapsed = false;

// Read once at module load on the client, before the first render commits.
if (typeof window !== "undefined") {
  try {
    collapsed = window.localStorage.getItem(KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The rail is
    // still perfectly usable; it just starts expanded every time.
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => collapsed;
/** Always expanded on the server — nothing there can read the preference. */
const getServerSnapshot = () => false;

export function setRailCollapsed(next: boolean): void {
  if (next === collapsed) return;
  collapsed = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Not persisting is survivable; the toggle still works for this session.
  }
  for (const l of listeners) l();
}

export function useRailCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
