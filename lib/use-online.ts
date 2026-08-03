"use client";
import { useSyncExternalStore } from "react";

/**
 * Browser connectivity as an external store.
 *
 * `useSyncExternalStore` rather than state + an effect: it declares the SSR
 * snapshot (assume online — the server can't know) and the live client snapshot
 * together, so the first client render matches the server's. No hydration
 * mismatch, no one-frame flash of the wrong status.
 *
 * Caveat worth knowing: `navigator.onLine` reports whether the device has a
 * network connection, not whether the internet is actually reachable. Turning
 * off wifi / mobile data flips it reliably; a connected-but-dead router still
 * reads as online. Catching that needs a heartbeat to the server.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
