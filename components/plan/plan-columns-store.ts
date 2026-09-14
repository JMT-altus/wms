"use client";

/**
 * The hierarchy table's column order and visibility, kept in localStorage.
 *
 * An external store rather than a read-in-effect, matching the app's rails:
 * `useSyncExternalStore` renders the server snapshot during hydration and
 * re-renders with the stored value, so there is no mismatch warning and no
 * cascading render.
 */

const KEY = "wms_plan_tree_columns_v1";

/** Fired after a write so a second table on the same screen keeps up. */
const EVENT = "wms:plan-columns";

export interface ColumnPrefs {
  order: string[] | null;
  hidden: string[] | null;
}

const EMPTY: ColumnPrefs = { order: null, hidden: null };

// `getSnapshot` runs on every render and loops if the value is not
// referentially stable, so the parsed object is cached against the raw string.
let cachedRaw: string | null | undefined;
let cached: ColumnPrefs = EMPTY;

export function getColumnPrefs(): ColumnPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

/** No storage on the server, so it renders the defaults and hydrates clean. */
export function getColumnPrefsServer(): ColumnPrefs {
  return EMPTY;
}

function parse(raw: string | null): ColumnPrefs {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as ColumnPrefs;
    return {
      order: Array.isArray(value.order) ? value.order.filter((k) => typeof k === "string") : null,
      hidden: Array.isArray(value.hidden) ? value.hidden.filter((k) => typeof k === "string") : null,
    };
  } catch {
    // A hand-edited value costs the defaults, not the screen.
    return EMPTY;
  }
}

export function saveColumnPrefs(prefs: { order: string[]; hidden: string[] }): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Full quota or blocked storage — the preference is lost, the table is not.
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    return;
  }
}

export function subscribeToColumnPrefs(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
