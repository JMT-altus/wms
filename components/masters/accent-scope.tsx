"use client";

import * as React from "react";

/**
 * Paints a shell's Masters accent onto the document root for as long as that
 * shell is mounted.
 *
 * The layout already sets these variables on its own wrapper, which covers
 * everything rendered in the page. Dialogs don't live there: Radix portals
 * them to `document.body`, outside the wrapper, so a dialog opened from an
 * amber screen would draw its header stripe in the default blue. Setting the
 * same variables at the root closes that gap.
 *
 * Cleaned up on unmount, so navigating out of this module doesn't leave its
 * accent behind on the next one.
 */
export function MastersAccentScope({
  accent,
  accentBar,
  ink,
}: {
  accent: string;
  accentBar: string;
  ink: string;
}) {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--masters-accent", accent);
    root.style.setProperty("--masters-accent-bar", accentBar);
    root.style.setProperty("--masters-ink", ink);
    return () => {
      root.style.removeProperty("--masters-accent");
      root.style.removeProperty("--masters-accent-bar");
      root.style.removeProperty("--masters-ink");
    };
  }, [accent, accentBar, ink]);

  return null;
}
