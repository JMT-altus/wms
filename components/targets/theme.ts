/**
 * The Targets & Forecasts accent — violet running into indigo.
 *
 * One constant, for the same reason as components/masters/theme.ts: this lands
 * on the rail's active row, every primary button and each dialog header, and
 * three hand-copied gradient strings drift the moment one gets tweaked.
 *
 * Violet is the one family not already spoken for — WMS blue, Employees green,
 * Incentive indigo-ish, Training cyan, Masters blue-teal.
 */
export const TARGETS_GRADIENT = "linear-gradient(135deg, #7C3AED 0%, #6D4AEA 55%, #4F46E5 100%)";

/** Same ramp left-to-right, for a dialog header's rule. */
export const TARGETS_GRADIENT_BAR = "linear-gradient(90deg, #7C3AED 0%, #6D4AEA 55%, #4F46E5 100%)";

/** Flat violet for links and focus rings, where a gradient can't apply. */
export const TARGETS_INK = "#6D28D9";

/**
 * The three measures, coloured consistently wherever they appear — table
 * pills, chart series, dashboard tiles. Actual is the strongest because it is
 * the only one that already happened.
 */
export const MEASURE_COLORS = {
  forecast: "#7C3AED",
  estimated: "#0EA5B7",
  actual: "#15803D",
  target: "#94A3B8",
} as const;
