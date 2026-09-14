/**
 * The Masters module's one accent.
 *
 * WMS blue running into the Employees teal — kept in a single constant because
 * it lands on the sidebar's active row, every primary button and each dialog's
 * header stripe. Three hand-copied gradient strings drift the moment one gets
 * tweaked.
 *
 * Read through a CSS variable rather than baked in, because these screens are
 * rendered by two shells: the Masters module (blue → teal, the default below)
 * and Admin & Master Setup, whose rail is amber. A New Client button in WMS
 * blue sitting under an amber sidebar reads as a foreign widget pasted onto
 * the page. A shell that wants its own accent sets `--masters-accent` and the
 * whole screen follows; one that sets nothing gets the default.
 */
export const MASTERS_GRADIENT =
  "var(--masters-accent, linear-gradient(135deg, #0A6CFF 0%, #0EA5B7 58%, #12B3A0 100%))";

/** Same ramp left-to-right, for the thin rule across a dialog header. */
export const MASTERS_GRADIENT_BAR =
  "var(--masters-accent-bar, linear-gradient(90deg, #0A6CFF 0%, #0EA5B7 58%, #12B3A0 100%))";

/** Flat colour for text links and focus rings, where a gradient can't apply. */
export const MASTERS_INK = "var(--masters-ink, #0A6CFF)";

/**
 * Flat accent and its soft tint, for the Grid View.
 *
 * A sheet needs a colour it can put behind a header row and inside a chip, and
 * a gradient can't be a text colour or a 9%-opacity wash. Both follow
 * `--masters-ink`, so an Admin & Master Setup shell that recolours the module
 * recolours the grid with it.
 */
export const MASTERS_ACCENT = MASTERS_INK;
export const MASTERS_ACCENT_SOFT =
  "color-mix(in srgb, var(--masters-ink, #0A6CFF) 9%, transparent)";
