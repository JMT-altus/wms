/**
 * The Project Plan module's one accent.
 *
 * Kept in a single constant, the way Masters keeps its blue→teal: this red
 * lands on the rail's active row, the five create boxes, row selection, and
 * the "this row carries something" state on the attachment and link cells.
 * Three hand-copied gradient strings drift the moment one gets tweaked.
 *
 * Read through a CSS variable rather than baked in, so a shell that wants its
 * own accent can set `--plan-accent` and the whole screen follows.
 */
export const PLAN_RED = "var(--plan-ink, #E10600)";
export const PLAN_RED_DEEP = "var(--plan-ink-deep, #A80400)";
/** The wash behind a chip, a selected row, or a cell that carries something. */
export const PLAN_RED_SOFT = "var(--plan-soft, #F8C8C7)";

export const PLAN_GRADIENT =
  "var(--plan-accent, linear-gradient(135deg, #E10600 0%, #A80400 100%))";

/** Same ramp left-to-right, for the thin rule across a dialog header. */
export const PLAN_GRADIENT_BAR =
  "var(--plan-accent-bar, linear-gradient(90deg, #E10600 0%, #A80400 100%))";

/**
 * Density over decoration: this is a planning table people read all day.
 * The max width the module's content sits inside.
 */
export const PLAN_MAX_WIDTH = 1600;

/**
 * The rule between two rows.
 *
 * Black rather than the app's blue-tinted hairline: these tables are read for
 * long stretches across a lot of columns, and a faint line stops doing its one
 * job — letting the eye track a single row from the frozen names all the way
 * out to the last date.
 *
 * `--color-ink-strong` is the palette's black; it follows the app into dark
 * mode, which a hard-coded `#000` would not.
 */
export const PLAN_ROW_LINE = "1px solid var(--color-ink-strong)";

/** Tabular numerals for every numeric column, so digits line up down a page. */
export const TABULAR: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
};

/**
 * The two SIDES of a plan row, and the colour each is marked in.
 *
 * A row carries two independent answers — the doer's progress report and the
 * initiator's ruling on it — and every surface that shows both has to say
 * which is which. The tables tint a header band over each run of columns; the
 * board splits into two halves under the same two colours. One pair of tones
 * so the two surfaces teach the same thing.
 *
 * Not the module's red: red is the plan's accent and already means "this row,
 * this module". A third and fourth meaning for it would flatten all of them.
 */
export const PLAN_SIDE: Record<"doer" | "initiator", { label: string; tone: string }> = {
  doer: { label: "Doer", tone: "#0891B2" },
  initiator: { label: "Initiator", tone: "#7C3AED" },
};
