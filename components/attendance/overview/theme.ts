/**
 * The Attendance page's colour system.
 *
 * Chosen to sit inside the app's existing look — a navy shell around a light
 * workspace — rather than announce itself: a pale cool-gray ground, ONE white
 * surface per section, navy text, a single restrained teal accent, and muted
 * status colours that appear only where a status is actually being reported.
 *
 * Fixed hex, scoped to this page's components, so no other module is affected.
 * (The shared `--color-*` tokens are close but bluer and more saturated; the
 * values below are the ones management asked for.)
 */

import type { CSSProperties } from "react";

/* ── Ink and surfaces ────────────────────────────────────────────────────── */

/** Headings and values: deep navy. Secondary text: muted slate. */
export const NAVY = "#172B4D";
export const SLATE = "#64748B";

/**
 * The one accent: a restrained teal. `ACCENT` is for icons, rules and focus
 * rings; `ACCENT_TEXT` is the same hue darkened so SMALL text in it still
 * reads comfortably on white (AA), and `ACCENT_SOFT` is its pale tint.
 */
export const ACCENT = "#0D9488";
export const ACCENT_TEXT = "#0F766E";
export const ACCENT_SOFT = "#E7F5F3";

/** Separators: a quiet cool gray. `BORDER_SOFT` for lines inside a surface. */
export const BORDER = "#DCE5EF";
export const BORDER_SOFT = "#E9EEF5";

/**
 * The Sunday column's band: a light neutral grey that says "weekly off" without
 * looking disabled. Grey means weekly off and nothing else — absence stays red.
 */
export const WEEKLY_OFF_BAND = "#F1F3F5";

/** A row or cell under the pointer. */
export const HOVER = "#F6F8FB";

/** The page ground. */
export const PAGE_GROUND = "#F3F6FA";

/**
 * A section surface: white, one hairline, a shadow you have to look for.
 * Everything inside a section is separated by space and thin rules — not by
 * more boxes.
 */
export const CARD: CSSProperties = {
  background: "#FFFFFF",
  border: `1px solid ${BORDER}`,
  boxShadow: "0 1px 2px rgba(23, 43, 77, 0.04)",
};

/* ── Status tones ────────────────────────────────────────────────────────── */

export type Tone = "teal" | "coral" | "amber" | "blue" | "violet" | "slate" | "orange" | "rose";

export interface ToneColors {
  /** Text and icon colour — passes AA on white. */
  fg: string;
  /** A pale tint, for the rare cell or pill that needs one. */
  bg: string;
  /** The saturated colour for small dots. */
  solid: string;
}

export const TONE: Record<Tone, ToneColors> = {
  // "teal" is the status for good news (muted green) and the neutral accent.
  teal: { fg: "#1F7A55", bg: "#F0F8F4", solid: "#3A9D74" },
  // The negative colour: `solid` is the muted red; `fg` is a shade darker for text.
  coral: { fg: "#C2403A", bg: "#FCF2F0", solid: "#D94841" },
  amber: { fg: "#946308", bg: "#FEF8E8", solid: "#D9A21C" },
  blue: { fg: "#2F5FB3", bg: "#F0F5FC", solid: "#5B8DD6" },
  violet: { fg: "#6444B0", bg: "#F5F2FC", solid: "#8A6BD0" },
  slate: { fg: "#586679", bg: "#F3F5F8", solid: "#93A0B2" },
  orange: { fg: "#A9531A", bg: "#FEF4EC", solid: "#E58A47" },
  rose: { fg: "#A33A66", bg: "#FCF1F6", solid: "#D2679A" },
};
