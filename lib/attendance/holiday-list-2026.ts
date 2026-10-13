/**
 * The JMT Drive Solutions Holiday List 2026, as published (signed by Mihir
 * Veera and Saroj Veera).
 *
 * This is the SOURCE for seeding the `holidays` table (scripts/seed-holidays-2026.ts)
 * — the app itself reads the table, never this file. Names and dates are kept
 * as the list gives them; the weekday printed beside each date is kept too, so
 * a test can prove the two agree instead of anyone trusting it by eye.
 *
 * CLIENT-SAFE: plain data, no imports.
 */

export interface PublishedHoliday {
  /** YYYY-MM-DD. */
  date: string;
  /** As written on the list. */
  label: string;
  /** The weekday the list prints next to the date. */
  weekday: string;
  /** Marked with * on the list: take any ONE optional holiday or a comp-off. */
  optional: boolean;
}

/** Holidays that are settled and ready to store. */
export const HOLIDAYS_2026: readonly PublishedHoliday[] = [
  { date: "2026-01-26", label: "Republic Day", weekday: "Monday", optional: false },
  { date: "2026-03-04", label: "Holi - Rang Panchami", weekday: "Wednesday", optional: false },
  { date: "2026-03-19", label: "Gudi Padwa", weekday: "Thursday", optional: true },
  { date: "2026-05-01", label: "Maharashtra Day & International Labour Day", weekday: "Friday", optional: false },
  { date: "2026-08-15", label: "Independence Day", weekday: "Saturday", optional: false },
  { date: "2026-08-28", label: "Rakshabandhan", weekday: "Friday", optional: false },
  { date: "2026-09-04", label: "Janmashtami", weekday: "Friday", optional: false },
  { date: "2026-09-14", label: "Ganesh Chaturthi", weekday: "Monday", optional: false },
  { date: "2026-10-20", label: "Dussehra", weekday: "Tuesday", optional: true },
  { date: "2026-11-08", label: "Diwali", weekday: "Sunday", optional: false },
  { date: "2026-11-09", label: "Diwali", weekday: "Monday", optional: false },
  { date: "2026-11-10", label: "New Year", weekday: "Tuesday", optional: false },
  { date: "2026-11-11", label: "Bhai Dooj", weekday: "Wednesday", optional: false },
];

/**
 * Listed with TWO possible dates ("Mar-20 or 21", Friday / Saturday). The
 * `holidays` table holds one date per row and has no tentative state, so this
 * is NOT stored until management confirms which day it is — add it afterwards
 * from /admin/holidays. Storing a guess would grade the wrong day as a paid
 * holiday for everyone.
 */
export const HOLIDAYS_PENDING_CONFIRMATION: readonly {
  label: string;
  candidates: readonly { date: string; weekday: string }[];
  optional: boolean;
}[] = [
  {
    label: "Eid Ul Fitr (Ramzan Eid)",
    candidates: [
      { date: "2026-03-20", weekday: "Friday" },
      { date: "2026-03-21", weekday: "Saturday" },
    ],
    optional: false,
  },
];
