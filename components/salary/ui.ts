import type { CSSProperties } from "react";

/**
 * The salary pages' (My Salary, Salary, Employee Salary Report) share of the
 * approved WMS white-and-blue look: navy text, pale blue-grey borders and
 * header fills, WMS blue for focus, links and the primary action, one card
 * surface. Presentation only — fixed values scoped to the salary components,
 * so the Attendance page's own theme (`attendance/overview/theme`) is untouched.
 */

/** Headings and values. */
export const NAVY = "#0B1F44";
/** Body text inside tables. */
export const INK = "#334155";
/** Labels and secondary text. */
export const SLATE = "#5B6B85";
/** Placeholders, dashes, "nothing here". */
export const FAINT = "#94A3B8";

/** A card's outline; `BORDER_SOFT` for lines inside a card. */
export const BORDER = "#DCE4F0";
export const BORDER_SOFT = "#EEF2F7";
/** Table headers and inset rows. */
export const HEAD_BG = "#F5F7FB";

export const BLUE = "#0A6CFF";
export const BLUE_TEXT = "#0B4FB8";
export const BLUE_SOFT = "#EEF4FF";
export const BLUE_LINE = "#C9DAFB";

/** One card surface for every salary section. */
export const SURFACE: CSSProperties = {
  background: "#FFFFFF",
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(11, 31, 68, 0.05)",
};

/** A section's title bar: 14px navy title on the left, controls on the right, a hairline below. */
export const SECTION_HEAD = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[#E6ECF5] px-4 py-2.5";
export const SECTION_TITLE = "flex items-center gap-2 text-[14px] font-semibold text-[#0B1F44]";

/** The white secondary button (36px). */
export const BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 text-[13px] font-semibold transition-colors hover:bg-[#F5F8FC] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20";
/** A small table button (28px). */
export const BTN_SM =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md bg-white px-2 text-[12px] font-semibold transition-colors hover:bg-[#F5F8FC] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20";
/** Selects and inputs in a toolbar (32px). */
export const CONTROL =
  "h-8 rounded-lg border border-[#D6DEEB] bg-white px-2.5 text-[13px] font-medium text-[#0B1F44] transition-[border-color,box-shadow] hover:border-[#B9C6DB] focus:border-[#0A6CFF] focus:outline-none focus:ring-[3px] focus:ring-[#0A6CFF]/15";

/** WMS table cells: header and body. */
export const TH = "whitespace-nowrap px-3 py-2 text-left text-[12px] font-semibold text-[#334155]";
export const TD = "px-3 py-2";
